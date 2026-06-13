"""参考文档异步摄取：作为 job 运行，阶段进度通过事件流推送到聊天区。

产品图只入资产库（后续 edit_image 的底图、资产面板可见），不自动铺上画布——
用户要的是"读懂后等我下指令"，而不是把文档里的图全倒出来。
"""

import asyncio
import logging
import uuid as uuidlib

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Asset, ReferenceDoc
from app.services import doc_parser, doc_vision, storage

logger = logging.getLogger(__name__)

# 回执双语文案：lang 由前端语言设置经上传端点透传（默认 zh）
_T = {
    "zh": {
        "parsing": "正在解析「{f}」…",
        "reading": "AI 正在通读 {n} 页内容（约 1-2 分钟）…",
        "still_reading": "仍在阅读文档（已用时 {s} 秒）…",
        "picking": "正在从 {n} 张图中识别产品图…",
        "empty": "未能从文档中提取到内容（文件可能已加密或为空）",
        "read_done": "📄 我已通读「{f}」",
        "products": "\n\n识别到的产品：{p}",
        "images_kept": "\n已提取 {n} 张产品/关键图片备用（点下方缩略图可引用，生成时我会自动参考，不占画布）",
        "next": "\n\n直接告诉我你要做什么，我会结合文档信息和产品图来设计，例如：「为文档里的产品做一张电商主图海报」。",
        "degraded": "\n⚠️ 本次 AI 视觉理解未成功（已按基础模式提取文字和图片），如效果不佳可删除后重新上传。",
    },
    "en": {
        "parsing": "Parsing \"{f}\"…",
        "reading": "Reading all {n} pages with AI (takes 1-2 minutes)…",
        "still_reading": "Still reading the document ({s}s elapsed)…",
        "picking": "Identifying product photos among {n} images…",
        "empty": "No content could be extracted (the file may be encrypted or empty)",
        "read_done": "📄 I've read \"{f}\"",
        "products": "\n\nProducts identified: {p}",
        "images_kept": "\n{n} product/key images saved for reference (click a thumbnail below to cite one; I'll use them automatically — your canvas stays clean)",
        "next": "\n\nJust tell me what to create and I'll design from the document, e.g. \"Make a hero banner for the product in the doc\".",
        "degraded": "\n⚠️ AI visual analysis failed this time (fell back to basic extraction). Re-upload the document if results look off.",
    },
}


async def _with_heartbeat(coro, emit_progress, interval: int = 45):
    """分钟级等待期间周期性报平安——静止的进度文本会让用户怀疑卡死。"""
    import time

    task = asyncio.ensure_future(coro)
    start = time.monotonic()
    while True:
        try:
            return await asyncio.wait_for(asyncio.shield(task), timeout=interval)
        except asyncio.TimeoutError:
            await emit_progress(int(time.monotonic() - start))


async def ingest(
    job_id: str, session_id: str, user_id: str, filename: str, doc_key: str, emit,
    lang: str = "zh", sha256: str | None = None,
) -> dict:
    """解析 → 视觉理解 → 产品图入库（不上画布）→ 理解式回执。emit(type, payload) 推进度。"""
    t = _T["en" if lang == "en" else "zh"]
    data = (settings.storage_dir / doc_key).read_bytes()

    await emit(job_id, "info", {"content": t["parsing"].format(f=filename)})
    # pypdf 抽取 + PyMuPDF 逐页渲染是纯 CPU 同步操作（数秒级），
    # 直接调用会冻结整个事件循环——所有用户的请求都会卡住
    parsed = await asyncio.to_thread(doc_parser.parse, filename, data)

    vision = None
    vision_attempted = False
    if settings.provider_mode != "mock" and parsed.page_renders:
        vision_attempted = True
        await emit(job_id, "info", {"content": t["reading"].format(n=len(parsed.page_renders))})
        vision = await _with_heartbeat(
            doc_vision.analyze(parsed.page_renders, lang=lang),
            lambda s: emit(job_id, "info", {"content": t["still_reading"].format(s=s)}),
        )

    # 摘要前置：截断喂给 planner 时优先保住结构化产品信息，原文殿后
    extracted_text = parsed.text
    if vision and vision.get("summary"):
        extracted_text = ("[AI 视觉解析摘要]\n" + vision["summary"] + "\n\n[文档原文]\n" + parsed.text)[:28_000]

    # 选图三级策略：逐图视觉打标（产品图带品名、其余注明类型）→ 产品页优先 → 文档顺序
    selected = None  # [(bytes, mime, page_no, caption, is_product)]
    if settings.provider_mode != "mock" and parsed.images:
        await emit(job_id, "info", {"content": t["picking"].format(n=len(parsed.images))})
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
        raise ValueError(t["empty"])

    labels = []
    strip_assets = []  # 回执缩略图条：[{label, url, caption, is_product}]
    async with SessionLocal() as db:
        db.add(ReferenceDoc(
            session_id=session_id, user_id=user_id, filename=filename[:255],
            extracted_text=extracted_text, image_count=len(selected),
            sha256=sha256,  # 成品行带指纹：上传端点据此对已完成的解析去重
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
            strip_assets.append({"label": label, "url": url, "caption": caption, "is_product": is_product})

    # 理解式回执：让用户确认"AI 读懂了"，再下设计指令
    note = t["read_done"].format(f=filename)
    if vision and vision.get("doc_type"):
        note += f"：{vision['doc_type']}" if lang != "en" else f": {vision['doc_type']}"
    products = (vision or {}).get("products") or []
    if products:
        sep = "、" if lang != "en" else ", "
        note += t["products"].format(p=sep.join(products[:6]))
    if labels:
        note += t["images_kept"].format(n=len(labels))
    if vision_attempted and vision is None:
        note += t["degraded"]
    note += t["next"]
    # assets 字段驱动前端在回执内渲染可点击的缩略图条（产品图排前）
    await emit(job_id, "text", {"content": note, "assets": strip_assets})
    return {"labels": labels, "text_chars": len(extracted_text)}
