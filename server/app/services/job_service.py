"""Job 引擎：异步执行、事件双写（DB 即事实来源）、审批状态机。

前端契约：POST /chat 立即拿 job_id → 轮询 /jobs/{id}/events?since=cursor
→ 收 plan_propose 后 approve/reject → 收 tool_call/tool_result/text → done。
"""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.agents.planner import Plan, make_plan
from app.config import settings, tool_cost
from app.db import SessionLocal
from app.services import credit_service
from app.models import Asset, CreditLedger, Job, JobEvent
from app.providers import get_image_provider
from app.services import storage
from app.services.placement import PlacementPlanner, display_size

logger = logging.getLogger(__name__)

# 进程内运行时状态（DB 之外的部分）：approve 唤醒、cancel 标记
_runtime: dict[str, dict] = {}

# asset_label 分配锁：防止并行节点取到相同计数（多实例部署时改为 DB 序列）
_label_locks: dict[str, asyncio.Lock] = {}


def _label_lock(session_id: str) -> asyncio.Lock:
    return _label_locks.setdefault(session_id, asyncio.Lock())


async def emit(job_id: str, type_: str, payload: dict) -> None:
    async with SessionLocal() as db:
        db.add(JobEvent(job_id=job_id, type=type_, payload=payload))
        await db.commit()


async def _set_status(job_id: str, status: str, **fields) -> None:
    async with SessionLocal() as db:
        job = await db.get(Job, job_id)
        if job is None:
            return
        job.status = status
        for key, value in fields.items():
            setattr(job, key, value)
        if status in Job.TERMINAL:
            job.finished_at = datetime.now(timezone.utc)
        await db.commit()


def start_job(job_id: str) -> None:
    _runtime[job_id] = {"approve": asyncio.Event(), "approved": None, "cancelled": False}
    task = asyncio.create_task(_run_job(job_id))
    _runtime[job_id]["task"] = task


def resolve_approval(job_id: str, approved: bool) -> bool:
    state = _runtime.get(job_id)
    if state is None:
        return False
    state["approved"] = approved
    state["approve"].set()
    return True


def cancel_job(job_id: str) -> bool:
    state = _runtime.get(job_id)
    if state is None:
        return False
    state["cancelled"] = True
    state["approve"].set()
    return True


async def _run_job(job_id: str) -> None:
    try:
        async with SessionLocal() as db:
            job = await db.get(Job, job_id)
            if job is None:
                return
            job_input, session_id, user_id = job.input, job.session_id, job.user_id

        # 局部编辑：用户已圈选区域并确认消耗，跳过规划与审批直接执行
        if job.kind == "region_edit":
            from app.agents.planner import PlanNode

            node = PlanNode(
                id="node_1",
                tool="edit_image",
                label=f"局部编辑 {job_input.get('source_asset')}",
                args={
                    "prompt": job_input.get("message", ""),
                    "source_asset": job_input.get("source_asset"),
                    "mask_key": job_input.get("mask_key"),
                },
            )
            await _set_status(job_id, "running", approved=True)
            ok, failed = await _execute_plan(job_id, session_id, user_id, Plan(nodes=[node]))
            zh_edit = any("一" <= ch <= "鿿" for ch in job_input.get("message", ""))
            if ok:
                await emit(job_id, "text", {"content": "✅ 局部编辑完成，结果已放在原图旁" if zh_edit else "✅ Region edit done — placed next to the original"})
            await _set_status(job_id, "done" if ok else "failed")
            return

        await _set_status(job_id, "planning")
        brief = job_input.get("message") or _skill_brief(job_input)
        async with SessionLocal() as db:
            asset_rows = (
                await db.execute(select(Asset).where(Asset.session_id == session_id).order_by(Asset.created_at))
            ).scalars().all()
        assets_ctx = [
            {"asset_label": a.asset_label, "kind": a.kind, "prompt": a.prompt, "source_tool": a.source_tool}
            for a in asset_rows
        ]
        plan = await make_plan(brief, job_input.get("messages_snapshot"), assets_ctx)

        if plan.mode == "direct":
            await emit(job_id, "text", {"content": plan.reply or "好的。"})
            await _set_status(job_id, "done")
            return

        total_credits = sum(tool_cost(n.tool) for n in plan.nodes)
        await _set_status(job_id, "awaiting_approval", plan=plan.model_dump())
        await emit(job_id, "plan_propose", {
            "title": plan.title,
            "total_credits": total_credits,
            "nodes": [
                {"id": n.id, "tool": n.tool, "label": n.label, "est_credits": tool_cost(n.tool), "depends": n.depends}
                for n in plan.nodes
            ],
            "notes": plan.notes,
        })

        state = _runtime[job_id]
        try:
            await asyncio.wait_for(state["approve"].wait(), timeout=settings.approval_timeout_seconds)
        except asyncio.TimeoutError:
            await emit(job_id, "info", {"content": "Plan expired without approval."})
            await _set_status(job_id, "cancelled", approved=False)
            return

        if state["cancelled"]:
            await emit(job_id, "info", {"content": "Cancelled by user."})
            await _set_status(job_id, "cancelled")
            return
        if not state["approved"]:
            await emit(job_id, "info", {"content": "Plan rejected. Tell me what to change and I'll re-plan."})
            await _set_status(job_id, "rejected", approved=False)
            return

        await _set_status(job_id, "running", approved=True)
        canvas_state = job_input.get("canvas_state") or {}
        ok, failed = await _execute_plan(
            job_id, session_id, user_id, plan,
            canvas_state.get("nodes"), canvas_state.get("viewport"),
        )

        # 总结语言跟随用户输入（审计 U3）
        zh = any("一" <= ch <= "鿿" for ch in brief)
        if zh:
            summary = f"✅ 全部完成：{ok}/{ok + failed} 张已添加到画布" if failed == 0 else (
                f"⚠️ 完成 {ok}/{ok + failed} 张（{failed} 张失败，积分已退还），已添加到画布"
            )
        else:
            summary = f"✅ {ok}/{ok + failed} generated · added to canvas" if failed == 0 else (
                f"⚠️ {ok}/{ok + failed} generated ({failed} failed, credits refunded) · added to canvas"
            )
        await emit(job_id, "text", {"content": summary})
        await _set_status(job_id, "done" if failed == 0 else ("done" if ok else "failed"))
    except Exception:
        logger.exception("job %s crashed", job_id)
        await emit(job_id, "error", {"message": "Internal error while running the job."})
        await _set_status(job_id, "failed")
    finally:
        _runtime.pop(job_id, None)


def _skill_brief(job_input: dict) -> str:
    inputs = job_input.get("inputs") or {}
    return " ".join(str(v) for v in inputs.values()) or "design request"


async def _execute_plan(
    job_id: str, session_id: str, user_id: str, plan: Plan,
    canvas_nodes: list | None = None, viewport: dict | None = None,
) -> tuple[int, int]:
    semaphore = asyncio.Semaphore(settings.executor_concurrency)
    done_nodes: set[str] = set()
    results: dict[str, bool] = {}
    planner = PlacementPlanner(canvas_nodes, viewport)

    async def refund_node(node, reason: str) -> None:
        async with SessionLocal() as db:
            await credit_service.apply(
                db, user_id, tool_cost(node.tool), "refund",
                job_id=job_id, memo=f"{reason}: {node.label[:80]}", enforce=False,
            )
            await db.commit()

    async def run_node(node) -> None:
        for dep in node.depends:
            while dep not in done_nodes:
                await asyncio.sleep(0.2)
        async with semaphore:
            if _runtime.get(job_id, {}).get("cancelled"):
                results[node.id] = False
                done_nodes.add(node.id)
                await refund_node(node, "cancelled")
                return
            est = 180 if node.tool == "edit_image" else 60
            if settings.provider_mode == "mock":
                est = 3
            await emit(job_id, "tool_call", {"name": node.tool, "args": node.args, "est_seconds": est})
            try:
                results[node.id] = await _generate_node(job_id, session_id, user_id, node, planner)
            except Exception as exc:
                logger.exception("node %s failed", node.id)
                await emit(job_id, "error", {"message": f"{node.label}: 生成失败（{str(exc)[:160]}），该节点积分已退还"})
                results[node.id] = False
                await refund_node(node, "failed")
            done_nodes.add(node.id)

    await asyncio.gather(*(run_node(node) for node in plan.nodes))
    ok = sum(1 for v in results.values() if v)
    return ok, len(results) - ok


async def _load_asset_bytes(session_id: str, asset_label: str) -> bytes:
    """编辑源图：优先本地 storage，其次按 URL 拉取（上传到外部存储的情况）。"""
    async with SessionLocal() as db:
        asset = (
            await db.execute(
                select(Asset).where(Asset.session_id == session_id, Asset.asset_label == asset_label)
            )
        ).scalars().first()
    if asset is None:
        raise ValueError(f"找不到资产 {asset_label}")
    if asset.storage_key:
        from app.config import settings as cfg

        return (cfg.storage_dir / asset.storage_key).read_bytes()
    import httpx

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        resp = await client.get(asset.url)
        resp.raise_for_status()
        return resp.content


async def _generate_node(job_id: str, session_id: str, user_id: str, node, planner: PlacementPlanner) -> bool:
    provider = get_image_provider()
    prompt = node.args.get("prompt") or node.label
    image = None
    last_exc = None
    for _ in range(2):  # 节点级重试
        try:
            if node.tool == "edit_image":
                source_label = node.args.get("source_asset", "")
                source = await _load_asset_bytes(session_id, source_label)
                mask = None
                if mask_key := node.args.get("mask_key"):
                    mask = (settings.storage_dir / mask_key).read_bytes()
                image = await provider.edit(prompt, source, node.args.get("aspect_ratio", "1:1"), mask=mask)
            else:
                image = await provider.generate(prompt, node.args.get("aspect_ratio", "1:1"))
            break
        except ValueError:
            raise  # 资产不存在没必要重试
        except Exception as exc:
            last_exc = exc
    if image is None:
        raise last_exc

    ext = image.mime.split("/")[-1]
    key = f"assets/{session_id}/{job_id}_{node.id}.{ext}"
    storage.save_bytes(key, image.data)
    url = storage.public_url(key)

    async with _label_lock(session_id), SessionLocal() as db:
        count = (
            await db.execute(select(func.count()).select_from(Asset).where(Asset.session_id == session_id))
        ).scalar_one()
        label = f"asset_{count + 1}"

        # 摆放：编辑结果放源图右侧，新生成走行排布
        canvas_x = canvas_y = None
        if node.tool == "edit_image":
            source = (
                await db.execute(
                    select(Asset).where(
                        Asset.session_id == session_id,
                        Asset.asset_label == node.args.get("source_asset", ""),
                    )
                )
            ).scalars().first()
            if source and source.canvas_x is not None:
                src_w, _ = display_size(source.width, source.height)
                canvas_x = source.canvas_x + src_w + 32
                canvas_y = source.canvas_y
        if canvas_x is None:
            canvas_x, canvas_y = planner.next(image.width, image.height)

        db.add(Asset(
            session_id=session_id, user_id=user_id, asset_label=label, url=url, storage_key=key,
            kind="image", mime=image.mime, width=image.width, height=image.height,
            model=image.model, prompt=prompt, source_tool=node.tool, job_id=job_id,
            canvas_x=canvas_x, canvas_y=canvas_y,
        ))
        # 计费：审批时已整单预扣（reserve），节点成功无需再记账；失败由 refund_node 退还
        await db.commit()

    result = {"ok": True, "model": image.model}
    if node.tool == "edit_image":
        result["source_asset_id"] = node.args.get("source_asset")
    await emit(job_id, "tool_result", {
        "name": node.tool,
        "result": result,
        "asset": {
            "asset_label": label, "url": url, "kind": "image",
            "model": image.model, "prompt": prompt, "source_tool": node.tool,
        },
    })
    # 编辑结果由前端 placeNextToSource 实时摆放；生成结果用 arrange 事件落位
    if node.tool != "edit_image" and canvas_x is not None:
        await emit(job_id, "canvas_op", {
            "op": "arrange",
            "args": {"moves": [{"asset_id": label, "x": canvas_x, "y": canvas_y}]},
        })
    return True


async def mark_stale_jobs_failed() -> None:
    """服务重启后：遗留非终态 job 标记失败，并补退未消耗的预扣积分（审计 L1）。

    应退金额 = 预扣 - 已成功节点成本（按该 job 产出的资产计） - 已退金额。
    """
    from sqlalchemy import func as sa_func

    async with SessionLocal() as db:
        rows = (
            await db.execute(select(Job).where(Job.status.in_(["pending", "planning", "awaiting_approval", "approving", "running"])))
        ).scalars().all()
        for job in rows:
            job.status = "failed"
            job.error = "server restarted"
            db.add(JobEvent(job_id=job.id, type="error", payload={"message": "Server restarted; unused credits refunded."}))

            if job.credits_reserved:
                succeeded = (
                    await db.execute(select(Asset).where(Asset.job_id == job.id))
                ).scalars().all()
                succeeded_cost = sum(tool_cost(a.source_tool or "") for a in succeeded)
                already_refunded = (
                    await db.execute(
                        select(sa_func.coalesce(sa_func.sum(CreditLedger.delta), 0)).where(
                            CreditLedger.job_id == job.id, CreditLedger.kind == "refund"
                        )
                    )
                ).scalar_one()
                due = job.credits_reserved - succeeded_cost - already_refunded
                if due > 0:
                    await credit_service.apply(
                        db, job.user_id, due, "refund",
                        job_id=job.id, memo="server restart: unused reserve", enforce=False,
                    )
        await db.commit()
