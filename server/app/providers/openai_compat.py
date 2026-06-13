"""sub2api（OpenAI 兼容）客户端：统一重试/超时，附带 M0 能力摸底工具。

返图解析链按计划实现在 parse_image_response()：依次尝试多种已知形态，
首次命中的 parser 会被记录（capabilities 缓存），漂移时回退全链。
"""

import base64
import json
import re

import httpx

from app.config import settings
from app.providers.base import GeneratedImage, GeneratedVideo

_TIMEOUT = httpx.Timeout(120.0, connect=10.0)
_MAGIC = {b"\x89PNG": "image/png", b"\xff\xd8\xff": "image/jpeg", b"RIFF": "image/webp"}


class OpenAICompatClient:
    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self.base_url = (base_url or settings.sub2api_base_url).rstrip("/")
        self.api_key = api_key or settings.codex_api_key

    async def chat(self, model: str, messages: list[dict], **kwargs) -> dict:
        payload = {"model": model, "messages": messages, **kwargs}
        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            last_exc = None
            for attempt in range(3):
                try:
                    resp = await client.post(
                        f"{self.base_url}/v1/chat/completions", json=payload, headers=headers
                    )
                    if resp.status_code == 429 or resp.status_code >= 500:
                        last_exc = RuntimeError(f"upstream {resp.status_code}: {resp.text[:200]}")
                        continue
                    resp.raise_for_status()
                    return resp.json()
                except httpx.RequestError as exc:
                    last_exc = exc
            raise RuntimeError(f"sub2api 请求失败（3 次重试后）: {last_exc}")


class Sub2ApiLLM:
    """Codex 规划/对话。json_only 时优先 response_format，失败回退 prompt 约束。"""

    def __init__(self, client: OpenAICompatClient | None = None, model: str | None = None):
        self.client = client or OpenAICompatClient(api_key=settings.codex_api_key)
        self.model = model or settings.planner_model

    async def complete(self, messages: list[dict], json_only: bool = False) -> str:
        kwargs = {}
        if json_only:
            kwargs["response_format"] = {"type": "json_object"}
        try:
            data = await self.client.chat(self.model, messages, **kwargs)
        except RuntimeError:
            if not json_only:
                raise
            data = await self.client.chat(self.model, messages)  # 不支持 response_format 的降级
        return data["choices"][0]["message"]["content"] or ""


def _sniff_mime(data: bytes) -> str | None:
    for magic, mime in _MAGIC.items():
        if data[: len(magic)] == magic:
            return mime
    return None


async def _fetch(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return resp.content


async def parse_image_response(data: dict) -> tuple[bytes, str] | None:
    """解析链：返回 (bytes, mime)；全部不命中返回 None。"""
    message = (data.get("choices") or [{}])[0].get("message", {})

    # 1. 非标扩展字段 images
    for img in message.get("images") or []:
        url = img.get("image_url", {}).get("url") if isinstance(img, dict) else img
        if isinstance(url, str):
            return await _decode_url(url)

    content = message.get("content")

    # 2. content 为数组：找 image_url part
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "image_url":
                return await _decode_url(part["image_url"]["url"])

    if not isinstance(content, str):
        return None

    # 3. 内联 data URI
    m = re.search(r"data:image/(\w+);base64,([A-Za-z0-9+/=]+)", content)
    if m:
        return base64.b64decode(m.group(2)), f"image/{m.group(1)}"

    # 4. markdown 图片 / 裸图片 URL
    m = re.search(r"!\[[^\]]*\]\((https?://[^)]+)\)", content) or re.search(
        r"(https?://\S+\.(?:png|jpe?g|webp)\S*)", content
    )
    if m:
        return await _decode_url(m.group(1))

    # 5. 整段疑似裸 base64
    stripped = content.strip()
    if len(stripped) > 1000 and re.fullmatch(r"[A-Za-z0-9+/=\s]+", stripped):
        try:
            raw = base64.b64decode(stripped)
        except Exception:
            return None
        if mime := _sniff_mime(raw):
            return raw, mime
    return None


async def _decode_url(url: str) -> tuple[bytes, str]:
    if url.startswith("data:"):
        header, b64 = url.split(",", 1)
        mime = header.split(":")[1].split(";")[0]
        return base64.b64decode(b64), mime
    raw = await _fetch(url)
    return raw, _sniff_mime(raw) or "image/png"


class GptImageProvider:
    """gpt-image 系列：走 /v1/images/generations（站点用 Codex key 提供）。

    M0 实测：返回 {"data": [{"b64_json": ...}]}，样本见 scripts/samples/。
    """

    _SIZES = {"1:1": "1024x1024", "16:9": "1536x1024", "9:16": "1024x1536", "4:3": "1536x1024"}

    def __init__(self, model: str | None = None):
        self.base_url = settings.sub2api_base_url.rstrip("/")
        self.api_key = settings.codex_api_key
        self.model = model or settings.image_model

    async def generate(self, prompt: str, aspect_ratio: str = "1:1", input_images=None) -> GeneratedImage:
        payload = {
            "model": self.model,
            "prompt": prompt,
            "n": 1,
            "size": self._SIZES.get(aspect_ratio, "1024x1024"),
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            resp = await client.post(f"{self.base_url}/v1/images/generations", json=payload, headers=headers)
            if resp.status_code == 400 and payload["size"] != "1024x1024":
                payload["size"] = "1024x1024"  # 尺寸不被支持时回退方图
                resp = await client.post(f"{self.base_url}/v1/images/generations", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        return self._to_generated(data)

    async def edit(
        self, prompt: str, image: bytes, aspect_ratio: str = "1:1", mask: bytes | None = None
    ) -> GeneratedImage:
        """图生图/改图：/v1/images/edits（multipart）。
        mask: RGBA PNG，透明区域 = 重绘范围（局部编辑，实测站点透传可用）。"""
        headers = {"Authorization": f"Bearer {self.api_key}"}
        files = {"image": ("source.png", image, "image/png")}
        if mask:
            files["mask"] = ("mask.png", mask, "image/png")
        form = {"model": self.model, "prompt": prompt}
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            resp = await client.post(
                f"{self.base_url}/v1/images/edits", data=form, files=files, headers=headers
            )
            resp.raise_for_status()
        return self._to_generated(resp.json())

    def _to_generated(self, data: dict) -> GeneratedImage:
        item = (data.get("data") or [{}])[0]
        if b64 := item.get("b64_json"):
            raw = base64.b64decode(b64)
        elif item.get("url"):
            raise RuntimeError("URL 型响应需异步下载，当前站点返回 b64_json；如遇此错请反馈样本")
        else:
            raise RuntimeError(f"images API 无图片字段: {json.dumps(data)[:200]}")

        from io import BytesIO

        from PIL import Image

        with Image.open(BytesIO(raw)) as img:
            width, height = img.size
            fmt = (img.format or "PNG").lower()
        return GeneratedImage(data=raw, mime=f"image/{fmt}", width=width, height=height, model=self.model)


class Sub2ApiImage:
    """Gemini 生图 adapter。"""

    def __init__(self, client: OpenAICompatClient | None = None, model: str | None = None):
        self.client = client or OpenAICompatClient(api_key=settings.gemini_api_key)
        self.model = model or settings.image_model

    async def generate(self, prompt: str, aspect_ratio: str = "1:1", input_images=None) -> GeneratedImage:
        content: list | str
        full_prompt = f"Generate an image. Aspect ratio {aspect_ratio}. {prompt}"
        if input_images:
            content = [{"type": "text", "text": full_prompt}] + [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{base64.b64encode(img).decode()}"},
                }
                for img in input_images
            ]
        else:
            content = full_prompt
        data = await self.client.chat(self.model, [{"role": "user", "content": content}])
        parsed = await parse_image_response(data)
        if parsed is None:
            snippet = json.dumps(data, ensure_ascii=False)[:300]
            raise RuntimeError(f"无法从模型响应中解析图片: {snippet}")
        raw, mime = parsed
        from PIL import Image
        from io import BytesIO

        with Image.open(BytesIO(raw)) as img:
            width, height = img.size
        return GeneratedImage(data=raw, mime=mime, width=width, height=height, model=self.model)


async def probe_capabilities(model: str, api_key: str | None = None) -> dict:
    """M0 摸底：探测 tools / json_object / stream 支持度。"""
    client = OpenAICompatClient(api_key=api_key)
    result = {"model": model}
    try:
        data = await client.chat(
            model,
            [{"role": "user", "content": "What is 2+2? Use the calculator tool."}],
            tools=[{
                "type": "function",
                "function": {
                    "name": "calculator",
                    "description": "evaluate math",
                    "parameters": {"type": "object", "properties": {"expr": {"type": "string"}}},
                },
            }],
        )
        msg = data["choices"][0]["message"]
        result["native_tools"] = bool(msg.get("tool_calls"))
    except Exception as exc:
        result["native_tools"] = False
        result["tools_error"] = str(exc)[:200]
    try:
        data = await client.chat(
            model,
            [{"role": "user", "content": 'Reply with JSON {"ok": true}'}],
            response_format={"type": "json_object"},
        )
        json.loads(data["choices"][0]["message"]["content"])
        result["json_object"] = True
    except Exception as exc:
        result["json_object"] = False
        result["json_error"] = str(exc)[:200]
    return result


_VIDEO_DIMS = {"480p": (854, 480), "720p": (1280, 720), "1080p": (1920, 1080)}


class Sub2ApiVideo:
    """视频生成（Seedance/Grok 等，供应商加白后接入）。

    端点/请求体/返回形态需按供应商文档最终确认——下面按常见 OpenAI 兼容视频接口
    （submit → 轮询 → 取 URL）实现，配置 VIDEO_API_BASE 后即生效。未配置时本类不会
    被实例化（get_video_provider 返回 None，执行层优雅提示「视频开通中」）。
    """

    def __init__(self):
        self.base_url = settings.video_api_base.rstrip("/")
        self.api_key = settings.video_api_key or settings.codex_api_key

    async def generate(
        self, prompt: str, *, seconds: float = 5, model: str = "seedance-2-480p",
        resolution: str = "480p", input_image: bytes | None = None,
    ) -> GeneratedVideo:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        payload = {"model": model, "prompt": prompt, "duration": seconds, "resolution": resolution}
        async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=10.0)) as client:
            resp = await client.post(f"{self.base_url}/v1/video/generations", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()
            # 兼容两种返回：直接给 url，或给 job id 需轮询（视供应商而定）
            url = self._extract_url(data)
            if url is None and (job_id := data.get("id")):
                url = await self._poll(client, job_id, headers)
            if url is None:
                raise RuntimeError("视频接口返回中未找到视频 URL，请核对供应商返回格式")
            vid = await client.get(url)
            vid.raise_for_status()
            video_bytes = vid.content
        w, h = _VIDEO_DIMS.get(resolution, (854, 480))
        return GeneratedVideo(data=video_bytes, mime="video/mp4", width=w, height=h, seconds=seconds, model=model)

    @staticmethod
    def _extract_url(data: dict) -> str | None:
        for path in (("data", 0, "url"), ("url",), ("output", "video_url"), ("video", "url")):
            cur = data
            try:
                for k in path:
                    cur = cur[k]
                if isinstance(cur, str) and cur.startswith("http"):
                    return cur
            except (KeyError, IndexError, TypeError):
                continue
        return None

    async def _poll(self, client, job_id: str, headers: dict) -> str | None:
        import asyncio

        for _ in range(120):  # 最多约 4 分钟
            await asyncio.sleep(2)
            r = await client.get(f"{self.base_url}/v1/video/generations/{job_id}", headers=headers)
            if r.status_code != 200:
                continue
            d = r.json()
            if (d.get("status") in ("succeeded", "completed")) or self._extract_url(d):
                return self._extract_url(d)
            if d.get("status") in ("failed", "error"):
                raise RuntimeError(f"视频生成失败：{d.get('error', '未知')}")
        raise RuntimeError("视频生成超时")
