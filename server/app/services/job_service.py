"""Job 引擎：异步执行、事件双写（DB 即事实来源）、审批状态机。

前端契约：POST /chat 立即拿 job_id → 轮询 /jobs/{id}/events?since=cursor
→ 收 plan_propose 后 approve/reject → 收 tool_call/tool_result/text → done。
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.agents.planner import Plan, make_plan
from app.config import settings, tool_cost, node_cost
from app.db import SessionLocal
from app.services import credit_service
from app.models import Asset, CreditLedger, Job, JobEvent
from app.providers import get_image_provider, get_video_provider
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
            ok, failed = await _execute_plan(job_id, session_id, user_id, Plan(nodes=[node]))
            zh_edit = any("一" <= ch <= "鿿" for ch in job_input.get("message", ""))
            if ok:
                await emit(job_id, "text", {"content": "✅ 局部编辑完成，结果已放在原图旁" if zh_edit else "✅ Region edit done — placed next to the original"})
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
                plan = build_main_set_plan(labels[0], content_map=main_content, lang=lang)
            elif tpl_key == "detail7":
                # 详情页七段：用第一张产品图，出 7 段暗调详情页
                from app.agents.set_templates import build_detail_set_plan, generate_detail_content

                detail_content = await generate_detail_content(items[0], doc_text, lang=lang) if items else {}
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
            plan = await make_plan(brief, job_input.get("messages_snapshot"), assets_ctx, docs_ctx)

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
            summary = f"✅ 完成啦！{ok} 张已放到画布上" if failed == 0 else (
                f"⚠️ 完成 {ok} 张，有 {failed} 张没成功（积分已退回），其余已放到画布"
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
    node_outputs: dict[str, dict] = {}  # 节点产出落位（供 overlay_on 跨节点叠放，如分层版产品叠到背景上）
    planner = PlacementPlanner(canvas_nodes, viewport)

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
        async with SessionLocal() as db:
            await credit_service.apply(
                db, user_id, node_cost(node), "refund",
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
                results[node.id] = await _generate_node(job_id, session_id, user_id, node, planner, source_cache, node_outputs)
            except Exception as exc:
                logger.exception("node %s failed", node.id)
                await emit(job_id, "error", {"message": f"{node.label}: 生成失败（{str(exc)[:160]}），该节点积分已退还"})
                results[node.id] = False
                await refund_node(node, "failed")
            done_nodes.add(node.id)

    await asyncio.gather(*(run_node(node) for node in plan.nodes))
    ok = sum(1 for v in results.values() if v)
    return ok, len(results) - ok


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
        from app.config import settings as cfg

        return (cfg.storage_dir / asset.storage_key).read_bytes()
    import httpx

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        resp = await client.get(asset.url)
        resp.raise_for_status()
        return resp.content


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
        count = (await db.execute(select(func.count()).select_from(Asset).where(Asset.session_id == session_id))).scalar_one()
        label = f"asset_{count + 1}"
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
                count = (
                    await db.execute(select(func.count()).select_from(Asset).where(Asset.session_id == session_id))
                ).scalar_one()
                tlabel = f"asset_{count + 1}"
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

    # 智能拆解·装饰元素/主体抠图层（纯本地 rembg，cutout_layer 工具）：
    # bbox 裁子图内抠图 → 贴回整帧 → 完整性校验 → 按需 AI 补全（补全后必重抠成透明）
    if node.tool == "cutout_layer":
        from app.agents.split import (
            complete_object, cutout_region, cutout_subject_full, dislocation_guard, verify_complete,
        )
        from app.providers.base import GeneratedImage
        from app.providers.openai_compat import _png_dims

        src_label = node.args.get("source_asset", "")
        src = source_cache.get(src_label) if source_cache else None
        if src is None:
            src = await _load_asset_bytes(session_id, src_label)
            if source_cache is not None:
                source_cache[src_label] = src
        bbox = node.args.get("bbox") or {}
        is_subject = split_role == "subject"
        # 装饰元素用更柔的 alpha 阈值（半透明不毛刺）+ 更激进的碎片清理；主体用硬阈值
        lift_lo, lift_scale, min_frac = (25, 4, 0.05) if is_subject else (10, 2, 0.15)

        if is_subject:
            cut = await loop.run_in_executor(None, lambda: cutout_subject_full(
                src, bbox, lift_lo=lift_lo, lift_scale=lift_scale, min_frac=min_frac))
        else:
            cut = await loop.run_in_executor(None, lambda: cutout_region(
                src, bbox, lift_lo=lift_lo, lift_scale=lift_scale, min_frac=min_frac))
            # 错位防护：明显抠空/抠偏的装饰层直接丢弃（不静默产出错位层）
            if await loop.run_in_executor(None, lambda: dislocation_guard(cut, bbox)):
                raise RuntimeError(f"装饰元素「{node.args.get('label', '')}」抠图错位/为空，跳过该层")

        # 完整性校验 + 按需补全——**仅对主体**：主体是关键且语义明确，inpaint 补全可靠；
        # 装饰元素小而语义模糊，补全时 gpt-image 易幻觉成别的东西（实测把"金色餐具"补成小酒瓶），
        # 得不偿失 → 装饰元素只用干净抠图、宁可略残不冒幻觉风险。
        if is_subject:
            incomplete, _missing = await verify_complete(cut, bbox, bool(node.args.get("occluded")))
            if incomplete:
                cut = await complete_object(cut, src, bbox, "product",
                                            lift_lo=lift_lo, lift_scale=lift_scale, min_frac=min_frac)

        w, h = _png_dims(cut) or _decode_frame(src)
        image = GeneratedImage(data=cut, mime="image/png", width=w, height=h, model="rembg-isnet")
    else:
        # 源图与蒙版在重试循环外只读一次（命中 plan 级缓存则零 I/O；也避免重试时重复读盘）
        source = mask = None
        if node.tool == "edit_image":
            source_label = node.args.get("source_asset", "")
            if source_cache is not None and source_label in source_cache:
                source = source_cache[source_label]
            else:
                source = await _load_asset_bytes(session_id, source_label)
                if source_cache is not None:
                    source_cache[source_label] = source
            if mask_key := node.args.get("mask_key"):
                mask = (settings.storage_dir / mask_key).read_bytes()
        last_exc = None
        for _ in range(2):  # 节点级重试
            try:
                if node.tool == "edit_image":
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
        count = (
            await db.execute(select(func.count()).select_from(Asset).where(Asset.session_id == session_id))
        ).scalar_one()
        label = f"asset_{count + 1}"

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
        if canvas_x is None and has_source and not node.id.startswith("set_"):
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
            node_outputs[node.id] = {"canvas_x": canvas_x, "canvas_y": canvas_y,
                                     "width": image.width, "height": image.height, "label": label}

        db.add(Asset(
            session_id=session_id, user_id=user_id, asset_label=label, url=url, storage_key=key,
            kind="image", mime=image.mime, width=image.width, height=image.height,
            model=image.model, prompt=prompt, source_tool=node.tool, job_id=job_id,
            canvas_x=canvas_x, canvas_y=canvas_y, z_index=node.args.get("z_index"),
            split_role=node.args.get("split_role"), split_label=node.args.get("label"),
        ))
        # 计费：审批时已整单预扣（reserve），节点成功无需再记账；失败由 refund_node 退还
        await db.commit()

    # placed（set_*/split_*/lay_*）都用 arrange 落到指定坐标，不走「放在源图旁」逻辑
    result = {"ok": True, "model": image.model}
    if node.tool == "edit_image" and not placed:
        result["source_asset_id"] = node.args.get("source_asset")
    asset_payload = {
        "asset_label": label, "url": url, "kind": "image",
        "model": image.model, "prompt": prompt, "source_tool": node.tool,
    }
    # 套图/拆图落位坐标。可编辑版套图还带模板 key + 文案 → 前端叠可编辑文字层
    if node.args.get("set_member") or node.args.get("set_template") or placed:
        asset_payload["canvas_x"] = canvas_x
        asset_payload["canvas_y"] = canvas_y
    if node.args.get("split_role"):
        asset_payload["split_role"] = node.args["split_role"]
        if node.args.get("label"):
            asset_payload["split_label"] = node.args["label"]  # 元素人类名 → PSD 语义层名
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
