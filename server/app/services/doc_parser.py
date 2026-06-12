"""参考文档解析：PDF / DOCX → 文字 + 内嵌图片。

提取的文字进入 Agent 规划上下文；图片作为画布资产供参考与改图。
"""

from dataclasses import dataclass, field
from io import BytesIO


@dataclass
class ParsedDoc:
    text: str = ""
    images: list[tuple[bytes, str]] = field(default_factory=list)  # (data, mime)


_MIN_IMAGE_BYTES = 8 * 1024  # 过滤图标/装饰小图
_MAX_IMAGES = 8
_MAX_TEXT_CHARS = 20_000


def parse_pdf(data: bytes) -> ParsedDoc:
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(data))
    out = ParsedDoc()
    texts = []
    for page in reader.pages:
        try:
            if t := page.extract_text():
                texts.append(t)
        except Exception:
            continue
        if len(out.images) < _MAX_IMAGES:
            try:
                for img in page.images:
                    raw = img.data
                    if len(raw) < _MIN_IMAGE_BYTES or len(out.images) >= _MAX_IMAGES:
                        continue
                    mime = _sniff(raw)
                    if mime:
                        out.images.append((raw, mime))
            except Exception:
                continue
    out.text = "\n".join(texts)[:_MAX_TEXT_CHARS]
    return out


def parse_docx(data: bytes) -> ParsedDoc:
    import docx

    document = docx.Document(BytesIO(data))
    out = ParsedDoc()
    paragraphs = [p.text for p in document.paragraphs if p.text.strip()]
    for table in document.tables:
        for row in table.rows:
            paragraphs.append(" | ".join(c.text.strip() for c in row.cells if c.text.strip()))
    out.text = "\n".join(paragraphs)[:_MAX_TEXT_CHARS]

    for rel in document.part.rels.values():
        if "image" in rel.reltype and len(out.images) < _MAX_IMAGES:
            try:
                raw = rel.target_part.blob
                if len(raw) >= _MIN_IMAGE_BYTES and (mime := _sniff(raw)):
                    out.images.append((raw, mime))
            except Exception:
                continue
    return out


def _sniff(data: bytes) -> str | None:
    if data[:4] == b"\x89PNG":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def parse(filename: str, data: bytes) -> ParsedDoc:
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "pdf":
        return parse_pdf(data)
    if ext in ("docx", "doc"):
        return parse_docx(data)  # .doc 旧格式大概率失败，由调用方兜底报错
    raise ValueError(f"unsupported document type: {ext}")
