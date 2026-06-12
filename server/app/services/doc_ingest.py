"""参考文档异步摄取：作为 job 运行，阶段进度通过事件流推送到聊天区。"""

import logging
import uuid as uuidlib

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Asset, ReferenceDoc
from app.services import doc_parser, doc_vision, storage
from app.services.placement import PlacementPlanner, display_size

logger = logging.getLogger(__name__)


async def ingest(job_id: str, session_id: str, user_id: str, filename: str, doc_key: str, emit) -> dict:
    """解析 → 视觉理解 → 选图登画布 → 文字入库。emit(type, payload) 推进度。"""
    data = (settings.storage_dir / doc_key).read_bytes()

    await emit(job_id, "info", {"content": f"正在解析「{filename}」…"})
    parsed = doc_parser.parse(filename, data)

    vision = None
    if settings.provider_mode != "mock" and parsed.page_renders:
        await emit(job_id, "info", {"content": f"AI 正在通读 {len(parsed.page_renders)} 页内容（约 1-2 分钟）…"})
        vision = await doc_vision.analyze(parsed.page_renders)

    extracted_text = parsed.text
    if vision and vision.get("summary"):
        extracted_text = (extracted_text + "\n\n[AI 视觉解析摘要]\n" + vision["summary"])[:28_000]

    # 选图三级策略：逐图视觉分类 → 产品页优先 → 文档顺序
    selected = None
    if settings.provider_mode != "mock" and parsed.images:
        await emit(job_id, "info", {"content": f"正在从 {len(parsed.images)} 张图中识别产品图…"})
        candidates = sorted(parsed.images, key=lambda im: -len(im[0]))[:16]
        product_idx = await doc_vision.classify_images([c[0] for c in candidates])
        if product_idx is not None:
            product = [candidates[i] for i in product_idx if i < len(candidates)]
            rest = [c for j, c in enumerate(candidates) if j not in set(product_idx)]
            selected = (product + rest)[:8] if product else None
    if selected is None:
        selected = doc_parser.select_images(parsed.images, vision.get("product_pages") if vision else None)

    if not extracted_text.strip() and not selected:
        raise ValueError("未能从文档中提取到内容（文件可能已加密或为空）")

    labels = []
    async with SessionLocal() as db:
        db.add(ReferenceDoc(
            session_id=session_id, user_id=user_id, filename=filename[:255],
            extracted_text=extracted_text, image_count=len(selected),
        ))
        existing = (
            await db.execute(select(Asset).where(Asset.session_id == session_id))
        ).scalars().all()
        nodes = [
            {"x": a.canvas_x, "y": a.canvas_y, "h": display_size(a.width, a.height)[1]}
            for a in existing if a.canvas_x is not None
        ]
        planner = PlacementPlanner(nodes)
        count = len(existing)
        await db.commit()  # 立即落库并释放写锁（无图文档也要记录 ReferenceDoc）
        for img_bytes, mime, _page in selected:
            from io import BytesIO

            from PIL import Image

            try:
                with Image.open(BytesIO(img_bytes)) as im:
                    width, height = im.size
            except Exception:
                continue
            key = f"assets/{session_id}/doc_{uuidlib.uuid4().hex[:10]}.{mime.split('/')[-1]}"
            storage.save_bytes(key, img_bytes)
            count += 1
            label = f"asset_{count}"
            cx, cy = planner.next(width, height)
            url = storage.public_url(key)
            prompt = f"来自文档 {filename}"
            db.add(Asset(
                session_id=session_id, user_id=user_id, asset_label=label,
                url=url, storage_key=key, kind="image", mime=mime,
                width=width, height=height, source_tool="doc_extract",
                prompt=prompt, canvas_x=cx, canvas_y=cy,
            ))
            # SQLite 单写锁：emit 走独立连接写 job_events，必须先提交释放本事务的锁
            await db.commit()
            labels.append(label)
            # 像生图一样逐张推送：前端实时把图放上画布
            await emit(job_id, "tool_result", {
                "name": "doc_extract",
                "result": {"ok": True, "model": "doc"},
                "asset": {
                    "asset_label": label, "url": url, "kind": "image",
                    "model": "doc", "prompt": prompt, "source_tool": "doc_extract",
                },
            })

    note = f"📄 已解析「{filename}」：提取 {len(extracted_text)} 字"
    if vision:
        note += "（含 AI 视觉摘要）"
    if labels:
        note += f"，{len(labels)} 张产品/关键图片已添加到画布"
    note += "。后续设计将自动参考该文档。"
    await emit(job_id, "text", {"content": note})
    return {"labels": labels, "text_chars": len(extracted_text)}
