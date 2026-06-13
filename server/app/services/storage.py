"""M1 本地盘存储；M2 换 R2 时保持同一接口（save_bytes/public_url）。"""

from pathlib import Path

from app.config import settings


def _safe_path(key: str) -> Path:
    path = (settings.storage_dir / key).resolve()
    root = settings.storage_dir.resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"illegal storage key: {key}")
    return path


def save_bytes(key: str, data: bytes) -> str:
    path = _safe_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return key


def delete_bytes(key: str) -> None:
    """删除存储对象（内容下架）。不存在时静默——下架要的是结果态而非报错。"""
    path = _safe_path(key)
    path.unlink(missing_ok=True)


def public_url(key: str) -> str:
    return f"{settings.public_base_url}/files/{key}"
