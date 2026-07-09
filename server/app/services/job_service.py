"""Job 引擎：异步执行、事件双写（DB 即事实来源）、审批状态机。

前端契约：POST /chat 立即拿 job_id → 轮询 /jobs/{id}/events?since=cursor
→ 收 plan_propose 后 approve/reject → 收 tool_call/tool_result/text → done。
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone

import httpx
from sqlalchemy import func, select

from app.agents.planner import Plan, make_plan
from app.config import settings, tool_cost, node_cost
from app.db import SessionLocal
from app.services import credit_service
from app.models import Asset, CreditLedger, Job, JobEvent
from app.providers import get_gen_provider_for, get_image_provider, get_person_edit_provider, get_video_provider
from app.services import storage
from app.services.placement import PlacementPlanner, display_size

logger = logging.getLogger(__name__)

# 进程内运行时状态（DB 之外的部分）：approve 唤醒、cancel 标记
_runtime: dict[str, dict] = {}

# nano-banana 熔断：认证失效/账号池耗尽时避免每个人物节点都白撞一次（503 退避 ~5s/节点）
_nano_down_until: float = 0.0

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


async def _refund_job_remainder(job_id: str, user_id: str | None, reason: str) -> int:
    """兜底退款：应退 = 预扣 - 已结算成功节点(settled) - 已退流水。

    why：崩溃/取消/审批竞态等非常规退出路径没有逐节点退款轨迹，只能靠账本重算保证
    余额守恒；用「已退流水总额」抵扣使其幂等——与 per-node refund 并存不会双退。
    预扣由 approve 端点写入 job 行，这里必须重读最新行（进程内快照可能落后）。
    """
    settled = int((_runtime.get(job_id) or {}).get("settled") or 0)
    async with SessionLocal() as db:
        job = await db.get(Job, job_id)
        if job is None or not job.credits_reserved:
            return 0
        already_refunded = (
            await db.execute(
                select(func.coalesce(func.sum(CreditLedger.delta), 0)).where(
                    CreditLedger.job_id == job_id, CreditLedger.kind == "refund"
                )
            )
        ).scalar_one()
        remainder = job.credits_reserved - settled - already_refunded
        if remainder <= 0:
            return 0
        await credit_service.apply(
            db, user_id or job.user_id, remainder, "refund",
            job_id=job_id, memo=reason, enforce=False,
        )
        await db.commit()
        return remainder


def _start_heartbeat(job_id: str) -> asyncio.Task:
    """节点执行期保活：单节点真实生成可达 3 分钟+，期间零事件会触发前端 6 分钟死气
    误杀合法长调用。每 45s 发一条 heartbeat（前端已约定忽略该类型，事件持久化可回放）。"""

    async def _beat() -> None:
        while True:
            await asyncio.sleep(45)
            try:
                await emit(job_id, "heartbeat", {})
            except Exception:
                # DB 抖动不能杀掉保活循环本身——下一拍再试
                logger.warning("job %s heartbeat emit failed", job_id, exc_info=True)

    return asyncio.create_task(_beat())


async def _stop_heartbeat(task: asyncio.Task) -> None:
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


async def _next_asset_label(session_id: str, db) -> str:
    """分配下一个 asset_label：取现存 label 数字后缀的 max+1，而非 count+1。

    why：admin 硬删资产后 count 回退，count+1 会与仍存活的旧 label 撞车（前端画布
    按 label 寻址会错乱）。须在 _label_lock(session_id) 内调用，防并行节点拿到同号。
    """
    labels = (
        await db.execute(select(Asset.asset_label).where(Asset.session_id == session_id))
    ).scalars().all()
    mx = 0
    for lb in labels:
        if isinstance(lb, str) and lb.startswith("asset_") and lb[6:].isdigit():
            mx = max(mx, int(lb[6:]))
    return f"asset_{mx + 1}"


async def _run_job(job_id: str) -> None:
    try:
        async with SessionLocal() as db:
            job = await db.get(Job, job_id)
            if job is None:
                return
            job_input, session_id, user_id = job.input, job.session_id, job.user_id

        # 文档摄取：异步解析 + 视觉理解，进度事件推到聊天区（不扣积分）
        if job.kind == "doc_parse":
            from app.services import doc_ingest

            await _set_status(job_id, "running")
            try:
                await doc_ingest.ingest(
                    job_id, session_id, user_id,
                    job_input.get("filename", "document"), job_input.get("doc_key"), emit,
                    lang=job_input.get("lang", "zh"), sha256=job_input.get("sha256"),
                )
                await _set_status(job_id, "done")
            except ValueError as exc:
                await emit(job_id, "error", {"message": str(exc)})
                await _set_status(job_id, "failed")
            return

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
            beat = _start_heartbeat(job_id)
            try:
                ok, failed = await _execute_plan(job_id, session_id, user_id, Plan(nodes=[node]))
            finally:
                await _stop_heartbeat(beat)
            zh_edit = any("一" <= ch <= "鿿" for ch in job_input.get("message", ""))
            if ok:
                await emit(job_id, "text", {"content": "✅ 局部编辑完成，结果已放在原图旁" if zh_edit else "✅ Region edit done — placed next to the original"})
            await _set_status(job_id, "done" if ok else "failed")
            return

        # 画布技能包（对标 Lovart）：移除物体 / 场景 mockup / 扩图。都归结为单节点 edit_image，
        # 差异在 prompt 与源图/蒙版预处理——统一在此分发，走既有 _execute_plan（含心跳/退款/落位）。
        if job.kind == "canvas_skill":
            from app.agents.planner import PlanNode
            from app.agents.split import (
                MOCKUP_SCENES, SKILL_OUTPAINT_PROMPT, SKILL_REMOVE_PROMPT,
                build_outpaint_source_and_mask,
            )

            skill = job_input.get("skill")
            src_label = job_input.get("source_asset")
            args = {"source_asset": src_label}
            skill_labels = {"object_remove": "移除物体", "mockup": "场景合成", "outpaint": "扩图"}

            if skill == "object_remove":
                args["prompt"] = SKILL_REMOVE_PROMPT
                args["mask_key"] = job_input.get("mask_key")  # 用户涂抹的待移除区域
            elif skill == "mockup":
                scene = MOCKUP_SCENES.get(job_input.get("mockup_type", "tshirt"), MOCKUP_SCENES["tshirt"])
                args["prompt"] = (
                    f"Take the provided design/product image and realistically place it onto {scene}. "
                    "Keep the design's colors and details faithful; photorealistic composite, natural "
                    "shadows and lighting, clean professional presentation."
                )
                args["aspect_ratio"] = job_input.get("aspect_ratio", "1:1")
            elif skill == "outpaint":
                # 服务端预处理：垫画幅 + 挖新增区蒙版，落盘后用 source_key/mask_key 交给 edit_image
                target_ar = job_input.get("target_aspect", "1:1")
                src_bytes = await _load_asset_bytes(session_id, src_label)
                _loop = asyncio.get_running_loop()  # _run_job 无 loop 变量（那是 _generate_node 的）
                padded, mask = await _loop.run_in_executor(
                    None, lambda: build_outpaint_source_and_mask(src_bytes, target_ar))
                import uuid as _uuidlib
                pk = f"masks/{session_id}/outpaint_src_{_uuidlib.uuid4().hex[:12]}.png"
                mk = f"masks/{session_id}/outpaint_mask_{_uuidlib.uuid4().hex[:12]}.png"
                storage.save_bytes(pk, padded)
                storage.save_bytes(mk, mask)
                args["source_key"] = pk
                args["mask_key"] = mk
                args["prompt"] = SKILL_OUTPAINT_PROMPT
                args["aspect_ratio"] = target_ar
            else:
                await emit(job_id, "error", {"message": "未知画布技能"})
                await _set_status(job_id, "failed")
                return

            node = PlanNode(id="node_1", tool="edit_image",
                            label=f"{skill_labels.get(skill, skill)} {src_label}", args=args)
            await _set_status(job_id, "running", approved=True)
            beat = _start_heartbeat(job_id)
            try:
                ok, failed = await _execute_plan(job_id, session_id, user_id, Plan(nodes=[node]))
            finally:
                await _stop_heartbeat(beat)
            if ok:
                await emit(job_id, "text", {"content": f"✅ {skill_labels.get(skill, '处理')}完成，结果已放在原图旁"})
            await _set_status(job_id, "done" if ok else "failed")
            return

        await _set_status(job_id, "planning")
        brief = job_input.get("message") or ""  # 末尾总结的语言检测用；set_template 也需有值

        # 套图：跳过 AI 规划器，按固定模板直接构造批量 edit_image 计划（每张注入同一约束），
        # 并用 LLM 根据产品说明 + 文档为每张图生成真实文案（标题/卖点）叠到图层上。
        if job.kind == "set_template":
            from app.agents.set_templates import build_set_plan, generate_set_content

            tpl_key = job_input.get("template")
            labels = job_input.get("asset_labels", [])
            async with SessionLocal() as db:
                rows = (await db.execute(
                    select(Asset).where(Asset.session_id == session_id, Asset.asset_label.in_(labels))
                )).scalars().all()
                cap = {a.asset_label: (a.prompt or "") for a in rows}
                from app.models import ReferenceDoc

                doc = (await db.execute(
                    select(ReferenceDoc).where(ReferenceDoc.session_id == session_id).order_by(ReferenceDoc.created_at.desc())
                )).scalars().first()
            items = [{"label": l, "caption": cap.get(l, "")} for l in labels]
            lang = job_input.get("lang", "zh")
            doc_text = doc.extracted_text if doc else ""
            if tpl_key == "main6":
                # 主图六联：用第一张选中的产品图，出 6 张角色分工主图
                from app.agents.set_templates import build_main_set_plan, generate_main_content

                main_content = await generate_main_content(items[0], doc_text, lang=lang) if items else {}
                # 锁主体（默认）：主体只抠一次、贯穿全套 → 跨图一致（Lovart 招牌能力）。
                # 抠图失败/无源图 → 优雅降级回「约束式重生成」（build_main_set_plan），绝不硬失败。
                plan = None
                try:
                    from app.agents.set_templates import build_main_set_locked_plan
                    from app.agents.split import cut_locked_subject

                    src_bytes = await _load_asset_bytes(session_id, labels[0])
                    subject_png = await cut_locked_subject(src_bytes)
                    if subject_png:
                        # 主体透明层落盘（整套复用同一 key）；沿用 masks/ 落盘 pattern
                        import uuid as _uuidlib
                        subject_key = f"masks/{session_id}/subject_{_uuidlib.uuid4().hex[:12]}.png"
                        storage.save_bytes(subject_key, subject_png)
                        plan = build_main_set_locked_plan(
                            labels[0], subject_key, content_map=main_content, lang=lang)
                except Exception:
                    plan = None  # 任何异常 → 降级
                if plan is None:
                    plan = build_main_set_plan(labels[0], content_map=main_content, lang=lang)
            elif tpl_key == "social5":
                # 社媒五联：一张选中图 → 五大平台封面（小红书/微博/公众号/X/YouTube）
                from app.agents.set_templates import build_social_set_plan

                plan = build_social_set_plan(labels[0])
            elif tpl_key == "detail7":
                # 详情页七段：用第一张产品图，出 7 段暗调详情页
                from app.agents.set_templates import build_detail_set_plan, generate_detail_content

                detail_content = await generate_detail_content(items[0], doc_text, lang=lang) if items else {}
                # 锁主体（默认）：主体只抠一次、贯穿全套 → 跨图一致（与主图六联同理）。
                # 抠图失败/无源图 → 优雅降级回「约束式重生成」（build_detail_set_plan），绝不硬失败。
                plan = None
                try:
                    from app.agents.set_templates import build_detail_set_locked_plan
                    from app.agents.split import cut_locked_subject

                    src_bytes = await _load_asset_bytes(session_id, labels[0])
                    subject_png = await cut_locked_subject(src_bytes)
                    if subject_png:
                        # 主体透明层落盘（整套复用同一 key）；沿用 masks/ 落盘 pattern
                        import uuid as _uuidlib
                        subject_key = f"masks/{session_id}/subject_{_uuidlib.uuid4().hex[:12]}.png"
                        storage.save_bytes(subject_key, subject_png)
                        plan = build_detail_set_locked_plan(
                            labels[0], subject_key, content_map=detail_content, lang=lang)
                except Exception:
                    plan = None  # 任何异常 → 降级
                if plan is None:
                    plan = build_detail_set_plan(labels[0], content_map=detail_content, lang=lang)
            elif job_input.get("set_mode") == "layered":
                # 分层版：背景层(生成) + 产品层(抠图) + 可编辑文字层
                from app.agents.set_templates import build_layered_plan

                content = await generate_set_content(tpl_key, items, doc_text, lang=lang)
                plan = build_layered_plan(tpl_key, labels[0], content_map=content, lang=lang)
            else:
                content = await generate_set_content(tpl_key, items, doc_text, lang=lang)
                plan = build_set_plan(tpl_key, labels, content_map=content, lang=lang, mode=job_input.get("set_mode", "ai"))
        elif job.kind == "split_image":
            # 智能四层拆解：识别在 plan 构造期同步完成（DAG/节点数在审批前定型）→ 背景/装饰/主体/文字
            from app.agents.split import build_smart_split_plan

            src_label = job_input.get("source_asset")
            try:
                src_bytes = await _load_asset_bytes(session_id, src_label)
            except Exception:
                src_bytes = None
            plan = await build_smart_split_plan(session_id, src_label, src_bytes)
        else:
            brief = job_input.get("message") or _skill_brief(job_input)
            async with SessionLocal() as db:
                asset_rows = (
                    await db.execute(select(Asset).where(Asset.session_id == session_id).order_by(Asset.created_at))
                ).scalars().all()
            assets_ctx = [
                {"asset_label": a.asset_label, "kind": a.kind, "prompt": a.prompt, "source_tool": a.source_tool}
                for a in asset_rows
            ]
            async with SessionLocal() as db:
                from app.models import ReferenceDoc

                doc_rows = (
                    await db.execute(
                        select(ReferenceDoc).where(ReferenceDoc.session_id == session_id).order_by(ReferenceDoc.created_at)
                    )
                ).scalars().all()
            docs_ctx = [{"filename": d.filename, "text": d.extracted_text} for d in doc_rows]
            # 品牌套件（对标 Lovart）：用户已激活则注入品牌规范，让整套设计配色/字体/调性统一
            brand_ctx = None
            async with SessionLocal() as db:
                from app.routers.brand import load_active_brand
                brand_ctx = await load_active_brand(db, user_id)
            plan = await make_plan(brief, job_input.get("messages_snapshot"), assets_ctx, docs_ctx, brand_ctx)

        if plan.mode == "direct":
            await emit(job_id, "text", {"content": plan.reply or "好的。"})
            await _set_status(job_id, "done")
            return

        total_credits = sum(node_cost(n) for n in plan.nodes)
        await _set_status(job_id, "awaiting_approval", plan=plan.model_dump())
        await emit(job_id, "plan_propose", {
            "title": plan.title,
            "total_credits": total_credits,
            "nodes": [
                {"id": n.id, "tool": n.tool, "label": n.label, "est_credits": node_cost(n), "depends": n.depends}
                for n in plan.nodes
            ],
            "notes": plan.notes,
        })

        state = _runtime[job_id]
        # 审计 B1：approve 端点预扣成功后，cancel/reject 仍可能翻转运行时标志（cancel 无状态
        # 校验），三个「未跑先终」分支必须全额退预扣（此时零节点已执行），否则整单预扣泄漏。
        # 退款失败只记日志，不能挡住终态落库；credits_reserved 由 approve 端点写入 → helper 重读最新行。
        try:
            await asyncio.wait_for(state["approve"].wait(), timeout=settings.approval_timeout_seconds)
        except asyncio.TimeoutError:
            try:
                # QA P2：reason 直接作为 memo 写进账本、账单页直出 → 全部改中文人话
                await _refund_job_remainder(job_id, user_id, "计划超时未审批，全额退还预扣")
            except Exception:
                logger.error("job %s approval-timeout refund failed", job_id, exc_info=True)
            await emit(job_id, "info", {"content": "Plan expired without approval."})
            await _set_status(job_id, "cancelled", approved=False)
            return

        if state["cancelled"]:
            try:
                await _refund_job_remainder(job_id, user_id, "执行前取消任务，全额退还预扣")
            except Exception:
                logger.error("job %s cancel refund failed", job_id, exc_info=True)
            await emit(job_id, "info", {"content": "Cancelled by user."})
            await _set_status(job_id, "cancelled")
            return
        if not state["approved"]:
            try:
                await _refund_job_remainder(job_id, user_id, "拒绝执行计划，全额退还预扣")
            except Exception:
                logger.error("job %s reject refund failed", job_id, exc_info=True)
            await emit(job_id, "info", {"content": "Plan rejected. Tell me what to change and I'll re-plan."})
            await _set_status(job_id, "rejected", approved=False)
            return

        await _set_status(job_id, "running", approved=True)
        canvas_state = job_input.get("canvas_state") or {}
        beat = _start_heartbeat(job_id)
        try:
            ok, failed = await _execute_plan(
                job_id, session_id, user_id, plan,
                canvas_state.get("nodes"), canvas_state.get("viewport"),
            )
        finally:
            await _stop_heartbeat(beat)

        # 总结语言跟随用户输入（审计 U3）
        zh = any("一" <= ch <= "鿿" for ch in brief)
        # 审计 B7：运行中取消的 job 不能写成 done +「✅ 完成啦」——终态该是 cancelled，
        # 并兜底退掉未执行节点的余量（per-node 已退部分被 already_refunded 抵扣，不会双退）。
        if _runtime.get(job_id, {}).get("cancelled"):
            try:
                await _refund_job_remainder(job_id, user_id, "运行中取消，退还未执行部分")
            except Exception:
                logger.error("job %s mid-run cancel refund failed", job_id, exc_info=True)
            cancel_msg = (f"已取消：完成 {ok} 张，未执行步骤的积分已退回" if zh
                          else f"Cancelled: {ok} finished; credits for unexecuted steps refunded")
            await emit(job_id, "text", {"content": cancel_msg})
            await _set_status(job_id, "cancelled")
            return
        if zh:
            summary = f"✅ 完成啦！{ok} 张已放到画布上" if failed == 0 else (
                f"⚠️ 完成 {ok} 张，有 {failed} 张没成功（积分已退回），其余已放到画布"
            )
        else:
            summary = f"✅ {ok}/{ok + failed} generated · added to canvas" if failed == 0 else (
                f"⚠️ {ok}/{ok + failed} generated ({failed} failed, credits refunded) · added to canvas"
            )
        await emit(job_id, "text", {"content": summary})
        await _set_status(job_id, "done" if failed == 0 else ("done" if ok else "failed"))
    except Exception as exc:
        logger.exception("job %s crashed", job_id)
        # 审计 B2：下面的文案承诺「未完成步骤的积分会退回」，必须真退——按账本重算余量。
        # 退款自身失败不能吞掉原始错误处理（error 事件 + failed 终态照常走）；
        # user_id 在极早期崩溃时可能未绑定 → 传 None 由 helper 从 job 行取。
        try:
            await _refund_job_remainder(job_id, None, "任务异常中止，退还未消耗预扣")
        except Exception:
            logger.error("job %s crash refund failed", job_id, exc_info=True)
        # 失败要说人话（用户曾看到英文 "Internal error" 完全不知所措）：
        # 上游 AI 服务抖动(sub2api 503/超时)是最常见 crash 源 → 明说"稍后重试"；其余给通用中文。
        exc_text = str(exc)
        transient = "sub2api" in exc_text or "503" in exc_text or "timeout" in exc_text.lower()
        msg = ("AI 服务暂时不可用（上游波动），未完成步骤的积分会退回——请点「重试」或稍后再试"
               if transient else "任务执行出错，未完成步骤的积分会退回——请点「重试」，若持续失败请联系支持")
        await emit(job_id, "error", {"message": msg})
        await _set_status(job_id, "failed")
    finally:
        _runtime.pop(job_id, None)


def _skill_brief(job_input: dict) -> str:
    inputs = job_input.get("inputs") or {}
    return " ".join(str(v) for v in inputs.values()) or "design request"


class SkipLayer(Exception):
    """元素被判为「不完整 → 按设计留在背景层」时抛出：这是预期行为，不是失败（走 info 而非 error）。"""


async def _execute_plan(
    job_id: str, session_id: str, user_id: str, plan: Plan,
    canvas_nodes: list | None = None, viewport: dict | None = None,
) -> tuple[int, int]:
    semaphore = asyncio.Semaphore(settings.executor_concurrency)
    done_nodes: set[str] = set()
    results: dict[str, bool] = {}
    skipped: set[str] = set()  # 按设计留在背景的元素（不计入「失败」）
    node_outputs: dict[str, dict] = {}  # 节点产出落位（供 overlay_on 跨节点叠放，如分层版产品叠到背景上）
    planner = PlacementPlanner(canvas_nodes, viewport)
    # 批量出图(≥2 张)走网格摆放：旧逻辑把每张编辑结果都放「源图右侧 32px」同一个点，
    # 批量结果全叠在一起，拖开后满画布乱序(用户实测)。单张编辑仍贴源图旁(改图场景直觉)。
    _img_nodes = [n for n in plan.nodes if n.tool in ("generate_image", "edit_image")]
    planner.batch_grid = len(_img_nodes) > 1

    # 预载编辑源图：套图/主图六联/详情页里 6-7 个角色节点共用同一张产品图，
    # 只读一次进缓存，省掉每节点重复的 DB 查询 + 磁盘/HTTP 读取（批量提速关键）。
    source_cache: dict[str, bytes] = {}
    unique_sources = {
        n.args.get("source_asset")
        for n in plan.nodes
        if n.tool in ("edit_image", "cutout_layer") and n.args.get("source_asset")
    }
    for label in unique_sources:
        try:
            source_cache[label] = await _load_asset_bytes(session_id, label)
        except Exception:
            pass  # 取不到的留到节点里再报错/退款

    async def refund_node(node, reason: str) -> None:
        # QA P2：reason 拼进 memo、账单页直出 → 调用方传中文（已取消/执行失败/…），
        # 分隔符也用中文冒号，整条 memo 读起来是「执行失败：xx图」这样的人话
        async with SessionLocal() as db:
            await credit_service.apply(
                db, user_id, node_cost(node), "refund",
                job_id=job_id, memo=f"{reason}：{node.label[:80]}", enforce=False,
            )
            await db.commit()

    # 依赖健壮性：丢弃悬空依赖（LLM 计划可能引用不存在/被截断的节点），否则等待循环会死等
    node_ids = {n.id for n in plan.nodes}
    for n in plan.nodes:
        n.depends = [d for d in (n.depends or []) if d in node_ids]

    async def run_node(node) -> None:
        try:
            waited = 0.0
            for dep in node.depends:
                while dep not in done_nodes:
                    if _runtime.get(job_id, {}).get("cancelled"):
                        results[node.id] = False
                        await refund_node(node, "已取消")
                        return
                    if waited > 600:  # 兜底：依赖 10 分钟未完成 → 放弃本节点，防 job 永久挂死
                        results[node.id] = False
                        await refund_node(node, "依赖超时未执行")
                        await emit(job_id, "error", {"message": f"{node.label}: 依赖超时已跳过（积分已退还）"})
                        return
                    await asyncio.sleep(0.2)
                    waited += 0.2
            async with semaphore:
                if _runtime.get(job_id, {}).get("cancelled"):
                    results[node.id] = False
                    await refund_node(node, "已取消")
                    return
                est = 180 if node.tool == "edit_image" else 60
                if settings.provider_mode == "mock":
                    est = 3
                await emit(job_id, "tool_call", {"name": node.tool, "args": node.args, "est_seconds": est})
                try:
                    results[node.id] = await _generate_node(job_id, session_id, user_id, node, planner, source_cache, node_outputs)
                    if results[node.id]:
                        # 结算记账（审计 B2）：成功节点按预扣同口径(node_cost)累计到运行时状态，
                        # 崩溃/取消兜底退款用「预扣 - settled - 已退」算余量，已交付的不重复退。
                        st = _runtime.get(job_id)
                        if st is not None:
                            st["settled"] = st.get("settled", 0) + node_cost(node)
                    else:  # 节点返回 False（如视频未开通）也退款——否则预扣积分白扣
                        await refund_node(node, "执行失败")
                except SkipLayer as skip:  # 元素判为「留在背景」是设计行为，非失败
                    results[node.id] = False
                    skipped.add(node.id)
                    # 与失败分支同理（审计 B5）：先退款后通知，emit 抛错不能吞掉退款
                    try:
                        await refund_node(node, "已跳过")
                    except Exception:
                        logger.error("node %s skip refund failed", node.id, exc_info=True)
                    try:
                        await emit(job_id, "info", {"content": str(skip)})
                    except Exception:
                        logger.error("node %s skip info emit failed", node.id, exc_info=True)
                except Exception as exc:
                    logger.exception("node %s failed", node.id)
                    results[node.id] = False
                    # 审计 B5：先 refund 再 emit——原顺序下 emit 抛错（DB 抖动）会跳过退款，
                    # 且异常被 gather(return_exceptions=True) 吞掉。两步各自兜底，互不牵连。
                    try:
                        await refund_node(node, "执行失败")
                    except Exception:
                        logger.error("node %s refund failed", node.id, exc_info=True)
                    try:
                        # 用户可读性：自家抛的中文原因直说；异常天书(KeyError('relX')/英文堆栈)
                        # 一律收敛成人话，技术细节只进日志——聊天窗不该出现代码碎片。
                        _reason = str(exc)[:160]
                        if not any("\u4e00" <= ch <= "\u9fff" for ch in _reason):
                            _reason = "遇到一点技术问题"
                        logger.error("node %s failed: %s", node.label, str(exc)[:300])
                        await emit(job_id, "error", {"message": f"{node.label}：{_reason}，这一步的积分已退还，点「重试」可再来一次"})
                    except Exception:
                        logger.error("node %s error emit failed", node.id, exc_info=True)
        finally:
            done_nodes.add(node.id)  # 无论成功/失败/早退，都标完成，避免依赖节点死等（+ emit/refund 抛错也不悬空）

    await asyncio.gather(*(run_node(node) for node in plan.nodes), return_exceptions=True)
    ok = sum(1 for v in results.values() if v)
    failed = len(results) - ok - len(skipped)  # 「留在背景」的元素不算失败
    return ok, failed


def _decode_frame(src: bytes) -> tuple[int, int]:
    """源图真实解码像素尺寸（背景回帧 / cutout 整帧尺寸用）。"""
    from app.providers.openai_compat import _png_dims

    dims = _png_dims(src)
    if dims is not None:
        return dims
    from io import BytesIO

    from PIL import Image

    with Image.open(BytesIO(src)) as im:
        return im.size


def _resize_to_frame(edit_png: bytes, frame_w: int, frame_h: int) -> bytes:
    """【强制修复①】把 provider.edit 输出（gpt-image 固定档位，如 1024²）强制回到源帧 W×H。

    宽高比相同 → 直接 resize；不同 → cover（铺满）+ 中心裁切，保持铺满不变形。
    所有经 provider.edit 产出、要叠回画布的层（背景层）都必须过此步，否则层间错位、PSD 不对齐。
    异常 → 返回原图（退化但不崩，§7.1 降级 5），调用方据原始尺寸成层。
    """
    if frame_w < 1 or frame_h < 1:
        return edit_png
    try:
        from app.agents.split import resize_cover

        return resize_cover(edit_png, frame_w, frame_h)
    except Exception:
        return edit_png


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
        return storage._safe_path(asset.storage_key).read_bytes()  # 用模块级 storage，过 _safe_path 防穿越
    # 本站自链 /files/<key>：直接读本地盘，不走 HTTP。既省一次自请求，也避开 SSRF 白名单误伤——
    # 上传图注册成资产时 url 是 http://{public_base_url}/files/...，dev 下 public_base_url 是本机
    # 127.0.0.1，之前一律走 fetch_public_bytes 会被内网拦截规则拒掉，导致「以上传图为源」的编辑全失败。
    files_prefix = f"{settings.public_base_url.rstrip('/')}/files/"
    if asset.url and asset.url.startswith(files_prefix):
        key = asset.url[len(files_prefix):].split("?")[0]
        return storage._safe_path(key).read_bytes()
    # 真·外链资产 → 安全拉取（SSRF 白名单 + 禁重定向），防止被诱导访问内网/云元数据
    from app.services.security import fetch_public_bytes

    return await fetch_public_bytes(asset.url)


async def _video_node(job_id: str, session_id: str, user_id: str, node, planner: PlacementPlanner) -> bool:
    """视频生成节点。视频接口未配置（供应商加白前）时优雅失败 → 节点退款，
    用户看到「视频开通中」而非崩溃。配置后真实生成、按秒计费已在 reserve 时算好。"""
    provider = get_video_provider()
    if provider is None:
        await emit(job_id, "error", {"message": "视频生成正在开通中（需接入视频模型 API），积分未扣除"})
        return False  # 节点失败 → refund_node 退还该节点预扣

    prompt = node.args.get("prompt") or node.label
    model = node.args.get("model") or settings.video_model
    seconds = float(node.args.get("seconds") or 5)
    resolution = node.args.get("resolution") or ("480p" if "480" in model else "720p")
    video = await provider.generate(prompt, seconds=seconds, model=model, resolution=resolution)

    key = f"assets/{session_id}/{job_id}_{node.id}.mp4"
    storage.save_bytes(key, video.data)
    url = storage.public_url(key)
    async with _label_lock(session_id), SessionLocal() as db:
        label = await _next_asset_label(session_id, db)  # max+1 而非 count+1：硬删后不撞旧 label
        cx, cy = planner.next(video.width, video.height)
        db.add(Asset(
            session_id=session_id, user_id=user_id, asset_label=label, url=url, storage_key=key,
            kind="video", mime=video.mime, width=video.width, height=video.height,
            model=video.model, prompt=prompt, source_tool="generate_video", job_id=job_id,
            canvas_x=cx, canvas_y=cy,
        ))
        await db.commit()
    await emit(job_id, "tool_result", {
        "name": "generate_video",
        "result": {"ok": True, "model": video.model, "seconds": seconds},
        "asset": {"asset_label": label, "url": url, "kind": "video", "model": video.model, "prompt": prompt, "source_tool": "generate_video"},
    })
    await emit(job_id, "canvas_op", {"op": "arrange", "args": {"moves": [{"asset_id": label, "x": cx, "y": cy}]}})
    return True


async def _generate_node(job_id: str, session_id: str, user_id: str, node, planner: PlacementPlanner,
                         source_cache: dict | None = None, node_outputs: dict | None = None) -> bool:
    if node.tool == "generate_video":
        return await _video_node(job_id, session_id, user_id, node, planner)

    # 智能拆解·文字层：对源图做 OCR，识别叠加文字 → 持久化为 kind=text_layer Asset（刷新不丢）
    # + 发相对坐标给前端立即重建为可编辑文字节点
    if node.tool == "extract_text":
        from app.agents.split import detect_text_blocks

        src_label = node.args.get("source_asset", "")
        src = source_cache.get(src_label) if source_cache else None
        if src is None:
            src = await _load_asset_bytes(session_id, src_label)
        # plan 期已 OCR（背景 mask 也用了同一批框）→ 直接复用，避免二次识别/坐标漂移
        blocks = node.args.get("text_blocks")
        if blocks is None:
            blocks = await detect_text_blocks(src)
        if blocks:
            await emit(job_id, "canvas_op", {"op": "add_texts", "args": {"ref": src_label, "texts": blocks}})
            # 持久化：blocks JSON 存进 prompt，锚源图坐标，url 占位空（序列化容忍空 url 的 text_layer）
            async with _label_lock(session_id), SessionLocal() as db:
                src_row = (
                    await db.execute(
                        select(Asset).where(Asset.session_id == session_id, Asset.asset_label == src_label)
                    )
                ).scalars().first()
                tlabel = await _next_asset_label(session_id, db)  # max+1 而非 count+1：硬删后不撞旧 label
                db.add(Asset(
                    session_id=session_id, user_id=user_id, asset_label=tlabel, url="", storage_key=None,
                    kind="text_layer", mime=None, width=None, height=None, model="ocr-text",
                    prompt=json.dumps(blocks, ensure_ascii=False), source_tool="extract_text", job_id=job_id,
                    canvas_x=(src_row.canvas_x if src_row else None),
                    canvas_y=(src_row.canvas_y if src_row else None),
                    z_index=node.args.get("z_index"),
                ))
                await db.commit()
            # 前端 asset-sync 重建 text_layer 时需要锚到源图：带上 ref（源图 asset_label）
            await emit(job_id, "tool_result", {
                "name": node.tool, "result": {"ok": True, "text_blocks": len(blocks)},
                "asset": {"asset_label": tlabel, "url": "", "kind": "text_layer",
                          "prompt": json.dumps(blocks, ensure_ascii=False), "ref": src_label,
                          "z_index": node.args.get("z_index"), "source_tool": "extract_text"},
            })
        else:
            await emit(job_id, "tool_result", {"name": node.tool, "result": {"ok": True, "text_blocks": 0}, "asset": None})
        return True

    provider = get_image_provider()
    prompt = node.args.get("prompt") or node.label

    image = None
    loop = asyncio.get_running_loop()
    split_role = node.args.get("split_role")
    raw_png = None  # 主体补全前的真实 alpha（供前景元素形状扣除，见 cutout 分支）
    # 必须函数级预初始化：赋值点在 edit/generate 的 else 分支内，compose_subject/cutout_layer
    # 分支不经过它，函数尾部的 `if person_text_blocks:` 会 UnboundLocalError——且发生在资产已
    # 落库、tool_result 已发之后 → 已成功节点被误判失败并退款（审计确认的活回归）。
    person_text_blocks = None

    # 锁主体合成（compose_subject）：AI 生成「无产品的背景/排版」+ 叠回「整套复用的同一主体」。
    # why：约束式重生成让扩散模型每张重画产品 → logo/形态跨图漂移；锁主体后 6 张共用同一像素 → 一致。
    # 主体抠图由 plan 构造期一次性完成并落盘（subject_key），这里只读盘 + 生背景 + 合成（不再抠图）。
    if node.tool == "compose_subject":
        from app.agents.split import place_subject_on_bg
        from app.providers.base import GeneratedImage
        from app.providers.openai_compat import _png_dims

        subject_key = node.args.get("subject_key")
        if not subject_key:
            raise RuntimeError("锁主体缺少 subject_key")
        subject_png = await loop.run_in_executor(
            None, lambda: storage._safe_path(subject_key).read_bytes())  # 过 _safe_path 防穿越
        ar = node.args.get("aspect_ratio", "1:1")

        # 1) 生成无产品背景（节点级重试，与 edit/generate 一致）
        bg = None
        last_exc = None
        for _ in range(2):
            try:
                bg = await provider.generate(prompt, ar)
                break
            except Exception as exc:
                last_exc = exc
        if bg is None:
            raise last_exc or RuntimeError("背景生成失败")

        # 2) 直接把主体透明层交给 place_subject_on_bg（它自己裁透明边→按背景帧等比缩放→落位）。
        # 切勿先 resize_cover 到背景画幅：cover 的中心裁切会把贴近源帧边缘的主体(出血构图/全身人物)
        # 头脚裁掉——合成数据实测 3:4 源→1:1 背景时主体顶部被切 13%。
        composed = await loop.run_in_executor(None, lambda: place_subject_on_bg(
            bg.data, subject_png,
            scale=float(node.args.get("subject_scale", 0.62)),
            anchor=node.args.get("subject_anchor", "center")))
        cw, ch = _png_dims(composed) or (bg.width, bg.height)
        image = GeneratedImage(data=composed, mime="image/png", width=cw, height=ch, model=bg.model)

    # 智能拆解·装饰元素/主体抠图层（纯本地 rembg，cutout_layer 工具）：
    # bbox 裁子图内抠图 → 贴回整帧 → 完整性校验 → 按需 AI 补全（补全后必重抠成透明）
    elif node.tool == "cutout_layer":
        from app.agents.split import cutout_region, cutout_subject_full, dislocation_guard
        from app.providers.base import GeneratedImage
        from app.providers.openai_compat import _png_dims

        src_label = node.args.get("source_asset", "")
        src = source_cache.get(src_label) if source_cache else None
        if src is None:
            src = await _load_asset_bytes(session_id, src_label)
            if source_cache is not None:
                source_cache[src_label] = src
        bbox = node.args.get("bbox") or {}
        other_boxes = node.args.get("other_boxes") or None  # 邻居框：丢掉串入的相邻对象整块
        is_subject = split_role == "subject"
        # 装饰元素用更柔的 alpha 阈值（半透明不毛刺）+ 更激进的碎片清理；主体用硬阈值
        lift_lo, lift_scale, min_frac = (25, 4, 0.05) if is_subject else (10, 2, 0.15)

        if is_subject:
            cut = await loop.run_in_executor(None, lambda: cutout_subject_full(
                src, bbox, lift_lo=lift_lo, lift_scale=lift_scale, min_frac=min_frac,
                other_rel_boxes=other_boxes))
            # 主体抠空护栏：rembg 返回全透明时不能静默产出一张看不见的「主体层」（曾计成功不退款）
            if await loop.run_in_executor(None, lambda: dislocation_guard(cut, bbox)):
                raise RuntimeError("主体抠图为空/错位")
            raw_png = cut
            # 护栏式补全：主体被前景挡住一截 → 在缺口里 inpaint 补成完整产品 → 重抠 → 面积+vision
            # 双护栏，过不了就退回残缺版（永不更差）。仅主体 + 手动标记的关键元素(complete=True)走这里。
            if node.args.get("complete") and node.args.get("occlusion"):
                from app.agents.split import complete_object

                cut = await complete_object(
                    cut, src, bbox, node.args.get("label", "product"), node.args["occlusion"],
                    lift_lo=lift_lo, lift_scale=lift_scale, min_frac=min_frac)
        else:
            cut = await loop.run_in_executor(None, lambda: cutout_region(
                src, bbox, lift_lo=lift_lo, lift_scale=lift_scale, min_frac=min_frac,
                other_rel_boxes=other_boxes))
            label = node.args.get("label", "")
            from app.agents.split import judge_element_complete, subtract_alpha

            subj_out = node_outputs.get("split_subject") if node_outputs else None
            # 用「补全前」的主体 alpha 做扣除：补全会把前景压住主体的缺口填实，若用补全后的 alpha 扣，
            # 会把压在主体上的前景元素整片扣空 → 前景装饰凭空消失。故优先 png_raw。
            subj_png = (subj_out.get("png_raw") or subj_out.get("png")) if subj_out else None
            # 主体形状精确扣除（先于一切判定）：去掉元素里串入的主体像素——透明物(酒杯)抓到的邻
            # 瓶会被整片扣掉 → 变空 → 下面 dislocation_guard 拦下 → 主体不被复制成两层。
            if subj_png:
                cut = await loop.run_in_executor(None, lambda: subtract_alpha(cut, subj_png))
            # 错位防护：明显抠空/抠偏的装饰层直接丢弃（不静默产出错位层）
            if await loop.run_in_executor(None, lambda: dislocation_guard(cut, bbox)):
                raise SkipLayer(f"「{label}」抠不出干净图层，已留在背景层（积分已退还）")
            # 执行期完整性实判（不靠 vision 的 occluded 猜测）：被画框出血 / 被主体遮挡 → 判为
            # 不完整 → 按设计留在背景里（背景 mask 不含它）。零补全、零幻觉。SkipLayer=预期非失败。
            ok = await loop.run_in_executor(None, lambda: judge_element_complete(cut, subj_png))
            if not ok:
                raise SkipLayer(f"「{label}」被遮挡/出血不完整，已按设计留在背景层（积分已退还）")

        w, h = _png_dims(cut) or _decode_frame(src)
        image = GeneratedImage(data=cut, mime="image/png", width=w, height=h, model="rembg-isnet")
    else:
        # 源图与蒙版在重试循环外只读一次（命中 plan 级缓存则零 I/O；也避免重试时重复读盘）
        source = mask = None
        if node.tool == "edit_image":
            source_label = node.args.get("source_asset", "")
            if src_key := node.args.get("source_key"):
                # 扩图等技能预处理好的源图（垫过画幅）直接读盘覆盖——不走 asset 加载，
                # 因为它不是一张已注册资产，只是本次编辑的临时输入。过 _safe_path 防穿越。
                source = storage._safe_path(src_key).read_bytes()
            elif source_cache is not None and source_label in source_cache:
                source = source_cache[source_label]
            else:
                source = await _load_asset_bytes(session_id, source_label)
                if source_cache is not None:
                    source_cache[source_label] = source
            if node.args.get("bg_last") and node_outputs is not None:
                # 背景最后生成：按「真正抠出来的层 alpha 并集 + 文字框」精确挖洞——没抠出来的
                # 不完整元素不在并集里 → 自动留在背景；衬布/场景永远保留。
                from app.agents.split import build_bg_hole_mask_from_layers

                layer_pngs = [node_outputs[nid].get("png") for nid in node.args.get("layer_nodes", [])
                              if nid in node_outputs and node_outputs[nid].get("png")]
                mask = await loop.run_in_executor(None, lambda: build_bg_hole_mask_from_layers(
                    source, layer_pngs, node.args.get("text_blocks") or []))
            elif mask_key := node.args.get("mask_key"):
                # 用模块级 storage（顶部已 import）。绝不能在此再 local import——那会让 storage
                # 在整个 _generate_node 变函数局部，导致 compose_subject 等更早引用它的分支 UnboundLocalError。
                mask = storage._safe_path(mask_key).read_bytes()  # 过 _safe_path 防路径穿越
        # ── 人物编辑路由矩阵（含真人的 edit_image，仅 sub2api 真实出图时；mock 走占位图不改） ──
        #   | 条件                                             | 走法                        |
        #   |--------------------------------------------------|-----------------------------|
        #   | has_person 且无 mask 且 person_mode!="fuse"(默认) | 锁人物合成(本地抠人+AI背景) |
        #   | has_person 且无 mask 且 person_mode=="fuse"       | nano 重绘（融合/风格化）    |
        #   | 带 mask / 无 has_person                           | gpt-image（不变）           |
        # why：默认「锁人物合成」——本地抠出人物原始像素零变形 + AI 只生成背景/排版 + 合成，
        # 彻底规避扩散模型整图重绘造成的人脸/身材变形；仅当用户明确要把人融进画面/风格化时才 fuse。
        # 默认整图重绘(fuse)：用户实测重绘出图人物比例/融合远好于锁人物合成——合成的贴图观感生硬、
        # 占比难控(盖标题/裁断)，重绘则把人自然嵌入海报排版。身份锁 prompt 守住人脸一致。
        # lock 仅当用户明确要「原图抠贴/拼贴风」时用（人像专用抠图+柔边仍保留，供该场景）。
        person_mode = str(node.args.get("person_mode", "fuse")).lower()
        has_person = bool(node.args.get("has_person"))
        person_lock = (
            node.tool == "edit_image"
            and has_person
            and mask is None
            and person_mode == "lock"  # 仅显式 lock 才走抠贴合成
            and settings.provider_mode == "sub2api"
        )
        if person_lock:
            # 锁人物合成：抠人物 → 生成「无人物/留位」背景 → 叠回原人物。任一环节失败 →
            # 优雅降级回 gpt-image edit(原 prompt)，绝不硬失败（下方 person_lock 置 False 走原路由）。
            try:
                from app.agents.split import (
                    cut_locked_person, place_subject_on_bg,
                    rewrite_bg_prompt_no_person,
                )
                from app.providers.base import GeneratedImage
                from app.providers.openai_compat import _png_dims

                # 人像专用抠图（u2net_human_seg 只抠人不带桌子 + 柔边）→ 治拉伸+抠图感。
                person_png = await cut_locked_person(source)  # 抠空/异常返回 None → 降级 gpt-image
                if not person_png:
                    raise RuntimeError("人物抠图失败")  # → 降级 gpt-image edit
                # 人物层沿用 masks/ 落盘 pattern（与套图锁主体一致：可追溯、可复用）
                import uuid as _uuidlib
                person_key = f"masks/{session_id}/person_{_uuidlib.uuid4().hex[:12]}.png"
                await loop.run_in_executor(None, lambda: storage.save_bytes(person_key, person_png))

                ar = node.args.get("aspect_ratio", "1:1")
                bg_prompt = rewrite_bg_prompt_no_person(prompt)  # 改写：NO PERSON + 留位 + 文字照旧
                bg = None
                bg_exc = None
                for _ in range(2):  # 背景生成节点级重试（与 edit/generate 一致）
                    try:
                        bg = await provider.generate(bg_prompt, ar)
                        break
                    except Exception as exc:
                        bg_exc = exc
                if bg is None:
                    raise bg_exc or RuntimeError("背景生成失败")

                # 人物层直接交给 place_subject_on_bg（自带裁透明边+按背景帧等比缩放）。
                # 切勿先 resize_cover：cover 中心裁切会把贴近源帧上下沿的人物头/脚裁掉
                # （合成数据实测 3:4 人像→1:1 背景时头顶被切）。封面场景人物占比大、居中偏下。
                composed = await loop.run_in_executor(None, lambda: place_subject_on_bg(
                    bg.data, person_png, scale=0.78, anchor="center-lower"))
                cw, ch = _png_dims(composed) or (bg.width, bg.height)
                image = GeneratedImage(data=composed, mime="image/png", width=cw, height=ch,
                                       model=bg.model)
            except Exception as exc:
                logger.warning("锁人物合成失败，降级 gpt-image edit：%s", str(exc)[:160])
                person_lock = False  # 降级：走下方常规 edit（gpt-image，原 prompt）

        # fuse 路由：含真人且无 mask 且 person_mode=="fuse" → nano-banana（gemini 系，人物一致性最强），
        # 允许把人物融进画面/风格化。其余（带 mask 的拆图背景/局部编辑/护栏补全，或无人物）→ gpt-image。
        use_person = (
            node.tool == "edit_image"
            and has_person
            and mask is None
            and person_mode == "fuse"
            and settings.provider_mode == "sub2api"  # mock 下路由无意义（占位图），不改动既有 mock 流程
        )
        edit_model = None  # 记录本节点 edit 实际走的模型（预留给日志/资产标注；计价按 plan args 预扣）
        edit_prompt = prompt
        # 人物海报文字策略随 settings.person_text_layers：开=文案叠可编辑文字层（模型禁字）；
        # 关（默认）=模型直接把字画进图（版式感强，nano 中文偶有错字）。执行层双保险：
        # 开关关闭时即使 planner 残留 text_blocks 也忽略，行为完全回到老方式。
        person_text_blocks = (node.args.get("text_blocks")
                              if (settings.person_text_layers and has_person
                                  and node.tool == "edit_image") else None) or None
        # 「留白」二字千万别出现：nano 会太老实地留出一大块纯白死区（用户实测：顶部 1/3 全白、
        # 人物缩到角落）。要的是「设计好的无字标题区」——装饰底(横幅/撕纸/色带)照做、只是不写字。
        _NO_TEXT = (" IMPORTANT: do NOT render, paint or draw ANY words, letters or characters in "
                    "the image — real text will be composited later as separate editable layers. "
                    "Instead of leaving empty space, DESIGN a decorative TITLE AREA at the top "
                    "(a styled banner / ribbon / torn-paper block / color band matching the overall "
                    "art direction) with no letters on it, ready to receive a title. "
                    "The person must remain LARGE and prominent — at least half the canvas height, "
                    "never shrunk into a corner. Fill the composition edge-to-edge with the scene "
                    "and decorative elements; no large blank areas.")
        if has_person and node.tool == "edit_image":
            # 【执行层人物防变形注入】只要节点标了 has_person，一律在指令最前置压上硬约束——
            # 不依赖 planner 是否记得写身份锁（它被 system prompt 要求但偶尔会漏），这里是确定性兜底。
            # 覆盖所有人物路径：nano / 扩图锁人的裸重绘兜底 / 非 fuse 的常规 edit。
            # planner 已写过同义句时跳过（省 token，避免指令重复稀释权重）。
            if "preserve the person" not in prompt.lower():
                # 只锁「身份」（脸/发型/肤色/比例），不冻结全身：旧版的 "do NOT redraw the
                # person" 会让模型不敢让任何素材遮挡人物 → 素材只能摆四周 = 拼贴感生硬
                # （用户实测融合度下降的元凶之一）。明确鼓励场景遮挡与统一光影。
                edit_prompt = (
                    "CRITICAL: keep the person's face, facial features, hairstyle and skin tone "
                    "EXACTLY as in the source photo, with natural undistorted proportions. "
                    "Integrate the person naturally INTO the scene: foreground props and food may "
                    "overlap or partially occlude their body, and the person must share the scene's "
                    "lighting, color grading and perspective — avoid a pasted-on collage look. "
                ) + prompt
            else:
                edit_prompt = prompt
        if person_text_blocks:
            edit_prompt += _NO_TEXT  # 文案交给可编辑文字层，模型只画画面

        # ── 抗拉伸（只靠 gpt-image 就能治）：源图/输出画布比例对齐 ──
        # 形变量 = 源图比例与输出画布比例之差（模型把源图重排进不同比例画布时整体压/拉最省力）。
        # 两步归零：①画布档按「显式 aspect → 就近映射；缺省 → 按源图比例就近推断」（planner 的
        # edit 节点常不带 aspect，旧默认 1:1 方图是竖版人像压扁最狠的选择）；②mask 为空的 edit
        # 把源图 blur-letterbox 垫成该画布比例（原像素零缩放）→ 输入输出同比例，模型没有拉伸动机。
        # 带 mask 的编辑（拆图背景/局部重绘）不垫（mask 与源图坐标必须逐像素对齐），只做①。
        edit_source = source
        edit_ar = node.args.get("aspect_ratio", "1:1")
        if node.tool == "edit_image" and source:
            from app.agents.split import pad_to_aspect, pick_edit_ar
            edit_ar = pick_edit_ar(node.args.get("aspect_ratio"), source)
            if mask is None:
                edit_source = await loop.run_in_executor(
                    None, lambda: pad_to_aspect(source, edit_ar))

        last_exc = None
        person_failed = False  # nano 抛错/解析失败 → 降级 gpt-image 重试一次（宁可变形也别整节点失败）
        gen_failed = False   # 专长模型(fal seedream/ideogram/...)生成失败 → 降级默认，之后不再重试专长
        # image 已由「锁人物合成」产出时跳过重试循环；否则按路由走 nano/gpt/generate。
        for _ in range(0 if image is not None else 2):  # 节点级重试
            try:
                if node.tool == "edit_image":
                    # nano 熔断：失效的 key/耗尽的账号池会让每个人物节点都白撞一次（503 退避
                    # 重试 ~5s/节点，套图批量时成倍浪费）。失败后 15 分钟内直接走扩图锁人。
                    global _nano_down_until
                    # 人物主引擎开关：gpt(默认,用户实测弃选 nano 的中文错字/淡版式) → 直接跳过
                    # nano 尝试,走下方扩图锁人(gpt-image,人物原像素零变形+中文标题准确)。
                    if (use_person and not person_failed and settings.person_engine == "nano"
                            and time.time() >= _nano_down_until):
                        try:
                            provider_p = get_person_edit_provider()
                            image = await provider_p.edit(edit_prompt, edit_source, edit_ar)
                            edit_model = settings.person_edit_model
                        except Exception as exc:  # nano 失败 → 本次及之后都回落 gpt 系
                            last_exc = exc
                            person_failed = True
                            # 审计 B6：熔断只认「服务不可用」信号——传输层故障（超时/连接错）、
                            # 认证/配额（401/402/403/429）、5xx。内容策略拒绝（400/422）、解析/PIL
                            # 错误是单节点问题，全站熔断 15 分钟会误伤其他用户的人物节点。
                            svc_down = isinstance(exc, httpx.TransportError) or (
                                isinstance(exc, httpx.HTTPStatusError)
                                and (exc.response.status_code in {401, 402, 403, 429}
                                     or exc.response.status_code >= 500)
                            )
                            if svc_down:
                                _nano_down_until = time.time() + 900
                                logger.warning("nano-banana edit 失败，熔断 15 分钟，降级扩图锁人：%s", str(exc)[:160])
                            else:
                                logger.warning("nano-banana edit 失败（非服务故障不熔断），降级扩图锁人：%s", str(exc)[:160])
                    if image is None and use_person and settings.person_engine == "outpaint":
                        # 可选路径「扩图锁人」：人物区蒙版保护+原像素回贴，人脸物理零变形——
                        # 但人物保持原照片尺寸、边缘有剪影感（用户实测观感不如整图重绘，故非默认）。
                        try:
                            from app.agents.split import outpaint_person_locked
                            from app.providers.base import GeneratedImage
                            data, w, h, m = await outpaint_person_locked(
                                provider, prompt + _NO_TEXT if person_text_blocks else prompt,
                                source, edit_ar)
                            image = GeneratedImage(data=data, mime="image/png", width=w, height=h, model=m)
                            edit_model = None
                        except Exception as exc:
                            last_exc = exc
                            logger.warning("扩图锁人失败，降级整图重绘：%s", str(exc)[:160])
                    if image is None and use_person:
                        # 默认「最初工作流」：gpt-image 整图重绘（身份锁 prompt 保人脸）。
                        # 人物被模型按海报构图重新安排（画大、融入版式），观感最佳（用户拍板）；
                        # 源图用【原图】而非 letterbox 垫图——垫出的模糊边带会被整图重绘照抄成
                        # 糊边距；画布仍按源图比例就近选档（size 参数保竖版，防压扁）。
                        image = await provider.edit(edit_prompt, source, edit_ar, mask=None)
                        edit_model = None
                    elif image is None:
                        image = await provider.edit(edit_prompt, edit_source, edit_ar, mask=mask)
                else:
                    # 多模型路由（对标 Lovart）：planner 按任务选了专长模型(seedream/ideogram/
                    # flux/recraft)就走 fal，否则默认 gpt-image。专长模型失败 → 降级默认，绝不硬失败。
                    ar = node.args.get("aspect_ratio", "1:1")
                    gen_p = get_gen_provider_for(node.args.get("model")) if not gen_failed else None
                    if gen_p is not None:
                        try:
                            image = await gen_p.generate(prompt, ar)
                            edit_model = node.args.get("model")
                        except Exception as exc:
                            last_exc = exc
                            gen_failed = True
                            logger.warning("专长模型 %s 生成失败，降级默认：%s",
                                           node.args.get("model"), str(exc)[:160])
                            image = await provider.generate(prompt, ar)
                            edit_model = None
                    else:
                        image = await provider.generate(prompt, ar)
                break
            except ValueError:
                raise  # 资产不存在没必要重试
            except Exception as exc:
                last_exc = exc
        if image is None:
            raise last_exc

        # 【强制修复①】智能拆解背景层：provider.edit 输出是 gpt-image 固定档位，
        # 必须回帧到源图真实尺寸，否则与其它整帧透明层错位、PSD 不对齐。
        if split_role == "bg":
            from app.providers.base import GeneratedImage
            from app.providers.openai_compat import _png_dims

            try:
                fw, fh = _decode_frame(source)
                reframed = await loop.run_in_executor(None, lambda: _resize_to_frame(image.data, fw, fh))
                rw, rh = _png_dims(reframed) or (fw, fh)
                image = GeneratedImage(data=reframed, mime="image/png", width=rw, height=rh, model=image.model)
            except Exception:
                pass  # 回帧异常 → 用 edit 原始尺寸成层（§7.1 降级 5，退化但不崩）

    ext = image.mime.split("/")[-1]
    key = f"assets/{session_id}/{job_id}_{node.id}.{ext}"
    storage.save_bytes(key, image.data)
    url = storage.public_url(key)

    # 落位路由按 placed 标志（不再按 tool 名分流）：
    # set_/split_/lay_ = 成套/拆解/分层产物，用 arrange 落到指定坐标；其余 edit = 放在源图旁
    placed = node.id.startswith("set_") or node.id.startswith("split_") or node.id.startswith("lay_")
    # 智能拆解的抠图/背景层都带 source_asset（含 cutout_layer），需要源图坐标做落位
    has_source = bool(node.args.get("source_asset"))

    async with _label_lock(session_id), SessionLocal() as db:
        label = await _next_asset_label(session_id, db)  # max+1 而非 count+1：硬删后不撞旧 label

        # 摆放：普通编辑结果放源图右侧；套图（set_*）是一组成套结果，走行排布成整齐网格
        # 而不是散落在各自源图旁边（否则交错在原图中间显得很乱）。
        canvas_x = canvas_y = None
        # 分层版：产品层「居中叠」到背景层上（overlay_on 指向先完成的背景节点）
        if node.args.get("overlay_on") and node_outputs:
            ref = node_outputs.get(node.args["overlay_on"])
            if ref:
                bg_dw, bg_dh = display_size(ref["width"], ref["height"])
                pr_dw, pr_dh = display_size(image.width, image.height)
                canvas_x = ref["canvas_x"] + (bg_dw - pr_dw) / 2
                canvas_y = ref["canvas_y"] + (bg_dh - pr_dh) / 2
        if (canvas_x is None and has_source and not node.id.startswith("set_")
                and not getattr(planner, "batch_grid", False)):
            source = (
                await db.execute(
                    select(Asset).where(
                        Asset.session_id == session_id,
                        Asset.asset_label == node.args.get("source_asset", ""),
                    )
                )
            ).scalars().first()
            if source and source.canvas_x is not None:
                if node.id.startswith("split_"):
                    # 智能拆解：每层（背景/装饰/主体）叠回源图「同一位置」（重叠 → 还原原图，但已分层）
                    canvas_x = source.canvas_x
                    canvas_y = source.canvas_y
                else:
                    src_w, _ = display_size(source.width, source.height)
                    canvas_x = source.canvas_x + src_w + 32
                    canvas_y = source.canvas_y
        if canvas_x is None:
            canvas_x, canvas_y = planner.next(image.width, image.height)
        if node_outputs is not None:
            entry = {"canvas_x": canvas_x, "canvas_y": canvas_y,
                     "width": image.width, "height": image.height, "label": label}
            if node.id.startswith("split_"):  # 智能拆解：缓存抠出 alpha，供主体遮挡实判 + 背景最后挖洞
                entry["png"] = image.data
                entry["split_role"] = node.args.get("split_role")
                if raw_png:  # 主体：补全前的真实 alpha，供前景元素形状扣除（避免扣掉补出来的缺口）
                    entry["png_raw"] = raw_png
            node_outputs[node.id] = entry

        disp_w, disp_h = display_size(image.width, image.height)  # 统一显示尺寸：批次内外一致
        db.add(Asset(
            session_id=session_id, user_id=user_id, asset_label=label, url=url, storage_key=key,
            kind="image", mime=image.mime, width=image.width, height=image.height,
            model=image.model, prompt=prompt, source_tool=node.tool, job_id=job_id,
            canvas_x=canvas_x, canvas_y=canvas_y, canvas_w=disp_w, canvas_h=disp_h,
            z_index=node.args.get("z_index"),
            split_role=node.args.get("split_role"), split_label=node.args.get("label"),
        ))
        # 计费：审批时已整单预扣（reserve），节点成功无需再记账；失败由 refund_node 退还
        await db.commit()

    # 审计 B5：主资产已落库 = 节点业务上已成功交付。下面的 tool_result/canvas_op 通知与
    # 人物文字层落库只是「收尾」，任何一步抛错（DB 抖动等）都不能让已交付节点被误判失败
    # 而触发退款——只记日志，照常返回 True。
    try:
        # placed（set_*/split_*/lay_*）都用 arrange 落到指定坐标，不走「放在源图旁」逻辑
        result = {"ok": True, "model": image.model}
        if node.tool == "edit_image" and not placed:
            result["source_asset_id"] = node.args.get("source_asset")
        asset_payload = {
            "asset_label": label, "url": url, "kind": "image",
            "model": image.model, "prompt": prompt, "source_tool": node.tool,
        }
        # 落位坐标+显示尺寸恒带：前端照单落位，live 摆放与刷新重建完全一致（后端是唯一权威；
        # 旧的 placeNextToSource 前端自摆是乱序/尺寸漂移的根源，仅作为无坐标时的回退）
        asset_payload["canvas_x"] = canvas_x
        asset_payload["canvas_y"] = canvas_y
        asset_payload["canvas_w"] = disp_w
        asset_payload["canvas_h"] = disp_h
        if node.args.get("split_role"):
            asset_payload["split_role"] = node.args["split_role"]
        if node.args.get("label"):
            # 人类可读层名不再绑死 split_role：社媒套图等也用它标注平台名(画布角标/导出命名)
            asset_payload["split_label"] = node.args["label"]
        if node.args.get("z_index") is not None:
            asset_payload["z_index"] = node.args["z_index"]  # 四层合成：显式 z 序，刷新后仍按层叠正确堆叠
        if node.args.get("set_template"):
            asset_payload["set_template"] = node.args["set_template"]
            if node.args.get("slot_content"):
                asset_payload["set_content"] = node.args["slot_content"]
        await emit(job_id, "tool_result", {
            "name": node.tool,
            "result": result,
            "asset": asset_payload,
        })
        # 普通编辑结果由前端 placeNextToSource 摆放；生成结果与套图/拆图用 arrange 落到指定坐标
        if (node.tool != "edit_image" or placed) and canvas_x is not None:
            await emit(job_id, "canvas_op", {
                "op": "arrange",
                "args": {"moves": [{"asset_id": label, "x": canvas_x, "y": canvas_y}]},
            })

        # 人物海报文字层：模型没画字（_NO_TEXT 留白），把 planner 给的文案叠成前端可编辑文字层。
        # why：nano 中文会写错字（实测「北海道美食」→「北洧道羪食」），文字层字永远正确且用户可改。
        # 复用 extract_text 同一套通路（add_texts 事件 + kind=text_layer 持久化，刷新可恢复）。
        if person_text_blocks:
            texts = _person_text_layout(person_text_blocks)
            if texts:
                # 先落库拿到 tlabel 再发 add_texts：事件带 layer_label，前端把文字节点
                # 与资产行绑定 → 画布删除文字层才能持久化（否则刷新复活）
                async with _label_lock(session_id), SessionLocal() as db:
                    tlabel = await _next_asset_label(session_id, db)  # max+1 而非 count+1：硬删后不撞旧 label
                    db.add(Asset(
                        session_id=session_id, user_id=user_id, asset_label=tlabel, url="", storage_key=None,
                        kind="text_layer", mime=None, width=None, height=None, model="person-poster-text",
                        # prompt 存 {ref, blocks} 对象而非裸数组：刷新重建时前端凭 ref 精确锚定到
                        # 所属海报（旧的坐标匹配法对 canvas_x=None 的普通编辑结果会锚错/丢层）
                        prompt=json.dumps({"ref": label, "blocks": texts}, ensure_ascii=False),
                        source_tool="edit_image", job_id=job_id,
                        canvas_x=canvas_x, canvas_y=canvas_y,
                    ))
                    await db.commit()
                await emit(job_id, "canvas_op", {"op": "add_texts",
                                                 "args": {"ref": label, "texts": texts, "layer_label": tlabel}})
                await emit(job_id, "tool_result", {
                    "name": "text_layers", "result": {"ok": True, "text_blocks": len(texts)},
                    "asset": {"asset_label": tlabel, "url": "", "kind": "text_layer",
                              "prompt": json.dumps({"ref": label, "blocks": texts}, ensure_ascii=False),
                              "ref": label, "source_tool": "edit_image"},
                })
    except Exception:
        logger.error("node %s post-commit notify failed (asset already delivered)", node.id, exc_info=True)
    return True


def _person_text_layout(blocks: list) -> list[dict]:
    """把 planner 的 text_blocks（{text, role}）转成前端 addTextLayers 的标准块。

    布局按人物海报惯例：标题顶部居中大字、副标题其下、caption 底部。相对坐标以锚图为基。
    颜色/字体用前端默认（用户可改）——这里只管「字正确 + 位置合理」。
    """
    out = []
    for b in (blocks or [])[:4]:
        if not isinstance(b, dict):
            continue
        text = str(b.get("text") or "").strip()
        if not text:
            continue
        role = str(b.get("role") or "title").lower()
        if role == "title" and not any(t.get("_role") == "title" for t in out):
            out.append({"_role": "title", "text": text, "relX": 0.06, "relY": 0.045,
                        "relW": 0.88, "relH": 0.085, "align": "center", "fontStyle": "bold"})
        elif role == "subtitle" and not any(t.get("_role") == "subtitle" for t in out):
            out.append({"_role": "subtitle", "text": text, "relX": 0.10, "relY": 0.148,
                        "relW": 0.80, "relH": 0.042, "align": "center"})
        else:
            out.append({"_role": "caption", "text": text, "relX": 0.10, "relY": 0.905,
                        "relW": 0.80, "relH": 0.036, "align": "center"})
    for t in out:
        t.pop("_role", None)
    return out


def _consumed_cost_from_plan(plan, produced_assets: list) -> int:
    """已成功成本按「预扣同口径」重算：plan 节点的 node_cost（含 model/seconds/has_person 等）。

    why（审计 B3）：裸 tool_cost(source_tool) 与预扣口径系统性不符——人物海报节点预扣 45
    按 15 结算=多退，视频按秒预扣按固定 10 结算=乱。做法：产出资产按 source_tool 分组计数，
    对每个 tool 取 plan 中该 tool 的前 N 个节点按 node_cost 求和。kind='text_layer' 是成功
    节点的伴生产物（与主资产同节点落库），不是独立计费节点 → 排除，防同一节点计两次。
    plan 缺失/解析失败由调用方回退旧口径（这里直接抛）。
    """
    if isinstance(plan, str):
        plan = json.loads(plan)
    nodes = (plan or {}).get("nodes") or []
    if not nodes:
        raise ValueError("plan has no nodes")
    counts: dict[str, int] = {}
    for a in produced_assets:
        if a.kind == "text_layer":
            continue
        tool = a.source_tool or ""
        counts[tool] = counts.get(tool, 0) + 1
    by_tool: dict[str, list] = {}
    for n in nodes:
        by_tool.setdefault((n or {}).get("tool") or "", []).append(n)
    total = 0
    for tool, cnt in counts.items():
        total += sum(node_cost(n) for n in by_tool.get(tool, [])[:cnt])
    return total


async def mark_stale_jobs_failed() -> None:
    """服务重启后：遗留非终态 job 标记失败，并补退未消耗的预扣积分（审计 L1）。

    应退金额 = 预扣 - 已成功节点成本（按 plan 节点预扣同口径重算，审计 B3） - 已退金额。
    """
    from sqlalchemy import func as sa_func

    async with SessionLocal() as db:
        rows = (
            await db.execute(select(Job).where(Job.status.in_(["pending", "planning", "awaiting_approval", "approving", "running"])))
        ).scalars().all()
        for job in rows:
            job.status = "failed"
            job.error = "server restarted"

            refunded = 0
            if job.credits_reserved:
                succeeded = (
                    await db.execute(select(Asset).where(Asset.job_id == job.id))
                ).scalars().all()
                try:
                    succeeded_cost = _consumed_cost_from_plan(job.plan, succeeded)
                except Exception:
                    # plan 缺失/解析失败（如 region_edit 无 plan）→ 回退旧口径估算
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
                        # QA P2：memo 在账单页直出，用中文
                        job_id=job.id, memo="服务重启，退还未消耗预扣", enforce=False,
                    )
                    refunded = due
            # 审计 B10：没退钱就别说「credits refunded」——无预扣/无余量时文案要如实
            msg = "Server restarted; unused credits refunded." if refunded else "Server restarted."
            db.add(JobEvent(job_id=job.id, type="error", payload={"message": msg}))
        await db.commit()
