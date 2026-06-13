from dataclasses import dataclass
from typing import Protocol


@dataclass
class GeneratedImage:
    data: bytes
    mime: str
    width: int
    height: int
    model: str


@dataclass
class GeneratedVideo:
    data: bytes
    mime: str  # video/mp4
    width: int
    height: int
    seconds: float
    model: str


class VideoProvider(Protocol):
    async def generate(
        self, prompt: str, *, seconds: float = 5, model: str = "seedance-2-480p",
        resolution: str = "480p", input_image: bytes | None = None,
    ) -> GeneratedVideo:
        ...


class LLMProvider(Protocol):
    async def complete(self, messages: list[dict], json_only: bool = False) -> str:
        """返回 assistant 文本。json_only 时要求模型只输出一个 JSON 对象。"""
        ...


class ImageProvider(Protocol):
    async def generate(
        self,
        prompt: str,
        aspect_ratio: str = "1:1",
        input_images: list[bytes] | None = None,
    ) -> GeneratedImage:
        ...
