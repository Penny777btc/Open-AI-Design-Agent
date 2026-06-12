"""参考文档异步摄取：作为 job 运行，阶段进度通过事件流推送到聊天区。

产品图只入资产库（后续 edit_image 的底图、资产面板可见），不自动铺上画布——
用户要的是"读懂后等我下指令"，而不是把文档里的图全倒出来。
"""

import logging
import uuid as uuidlib

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Asset, ReferenceDoc
from app.services import doc_parser, doc_vision, storage

logger = logging.getLogger(__name__)


async def ingest(job_id: str, session_id: str, user_id: str, filename: str, doc_key: str, emit) -> dict:
    """解析 → 视觉理解 → 产品图入库（不上画布）→ 理解式回执。emit(type, payload) 推进度。"""
    data = (settings.storage_dir / doc_key).read_bytes()

    await emit(job_id, "info", {"content": f"正在解析「{filename}」…"})
    parsed = doc_parser.parse(filename, data)

    vision = None
    if settings.provider_mode != "mock" and parsed.page_renders:
        await emit(job_id, "info", {"content": f"AI 正在通读 {len(parsed.page_renders)} 页内容（约 1-2 分钟）…"})
        vision = await doc_vision.analyze(parsed.page_renders)

    # 摘要前置：截断喂给 planner 时优先保住结构化产品信息，原文殿后
    extracted_text = parsed.text
    if vision and vision.get("summary"):
        extracted_text = ("[AI 视觉解析摘要]\n" + vision["summary"] + "\n\n[文档原文]\n" + parsed.text)[:28_000]

    # 选图三级策略：逐图视觉打标（产品图带品名、其余注明类型）→ 产品页优先 → 文档顺序
    selected = None  # [(bytes, mime, page_no, caption, is_product)]
    if settings.provider_mode != "mock" and parsed.images:
        await emit(job_id, "info", {"content": f"正在从 {len(parsed.images)} 张图中识别产品图…"})
        candidates = sorted(parsed.images, key=lambda im: -len(im[0]))[:16]
        classified = await doc_vision.classify_images([c[0] for c in candidates])
        if classified:
            tagged = {it["index"]: it for it in classified if 0 <= it["index"] < len(candidates)}
            prod_idx = [it["index"] for it in classified if it.get("is_product") and it["index"] in tagged]
            rest_idx = [j for j in range(len(candidates)) if j not in set(prod_idx)]
            selected = [
                (*candidates[i], tagged.get(i, {}).get("caption", ""), i in set(prod_idx))
                for i in (prod_idx + rest_idx)
            ][:8]
    if selected is None:
        selected = [
            (*im, "", False)
            for im in doc_parser.select_images(parsed.images, vision.get("product_pages") if vision else None)
        ]

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
        count = len(existing)
        await db.commit()  # 立即落库并释放写锁（无图文档也要记录 ReferenceDoc；emit 走独立连接）
        for img_bytes, mime, _page, caption, is_product in selected:
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
            url = storage.public_url(key)
            # caption 让 planner 能分辨每张图是什么；「产品图：」前缀是选 edit_image 源图的依据
            if caption:
                prompt = f"{'产品图：' if is_product else ''}{caption}（来自文档 {filename}）"
            else:
                prompt = f"来自文档 {filename}"
            db.add(Asset(
                session_id=session_id, user_id=user_id, asset_label=label,
                url=url, storage_key=key, kind="image", mime=mime,
                width=width, height=height, source_tool="doc_extract",
                prompt=prompt, canvas_x=None, canvas_y=None,
            ))
            await db.commit()
            labels.append(label)

    # 理解式回执：让用户确认"AI 读懂了"，再下设计指令
    note = f"📄 我已通读「{filename}」"
    if vision and vision.get("doc_type"):
        note += f"：{vision['doc_type']}"
    products = (vision or {}).get("products") or []
    if products:
        note += f"\n\n识别到的产品：{('、'.join(products[:6]))}"
    if labels:
        note += f"\n已提取 {len(labels)} 张产品/关键图片备用（在「Session Assets」资产面板可查看，生成时我会自动引用，不占画布）"
    note += "\n\n直接告诉我你要做什么，我会结合文档信息和产品图来设计，例如：「为文档里的产品做一张电商主图海报」。"
    await emit(job_id, "text", {"content": note})
    return {"labels": labels, "text_chars": len(extracted_text)}
