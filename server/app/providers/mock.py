"""无外部依赖的 mock providers：让全链路在拿到 sub2api key 之前就能端到端运行。"""

import asyncio
import hashlib
import json
import re
import textwrap
from io import BytesIO

from PIL import Image, ImageDraw

from app.providers.base import GeneratedImage

_RATIOS = {"1:1": (1024, 1024), "16:9": (1280, 720), "9:16": (720, 1280), "4:3": (1024, 768)}


class MockLLM:
    """规则规划器：把 brief 拆成 2-4 个生图节点，输出与真实 Planner 相同的 JSON。"""

    async def complete(self, messages: list[dict], json_only: bool = False) -> str:
        brief = messages[-1]["content"] if messages else ""
        if not json_only:
            return f"（mock 回复）收到：{brief[:80]}"

        # 改图意图：引用了 asset_N 且带编辑动词 → 出 edit_image 节点
        asset_ref = re.search(r"asset_(\d+)", brief)
        if asset_ref and re.search(r"改|换|调整|edit|change|去掉|加上", brief):
            return json.dumps({
                "mode": "plan",
                "title": f"修改 asset_{asset_ref.group(1)}",
                "nodes": [{
                    "id": "node_1",
                    "tool": "edit_image",
                    "label": f"按要求修改 asset_{asset_ref.group(1)}",
                    "args": {"prompt": brief, "source_asset": f"asset_{asset_ref.group(1)}"},
                    "depends": [],
                }],
                "notes": ["mock edit plan"],
            }, ensure_ascii=False)

        match = re.search(r"(\d+)\s*(?:张|个|幅|x|×)", brief)
        count = min(int(match.group(1)), 8) if match else 3
        variants = ["主视觉", "横版变体", "竖版变体", "细节特写", "备选方案 A", "备选方案 B", "备选方案 C", "备选方案 D"]
        nodes = [
            {
                "id": f"node_{i + 1}",
                "tool": "generate_image",
                "label": f"{variants[i]}：{brief[:40]}",
                "args": {"prompt": f"{brief} — {variants[i]}", "aspect_ratio": "1:1"},
                "depends": [],
            }
            for i in range(count)
        ]
        return json.dumps(
            {"mode": "plan", "title": f"设计计划：{brief[:30]}", "nodes": nodes, "notes": ["mock planner 生成"]},
            ensure_ascii=False,
        )


class PlaceholderImage:
    """生成带 prompt 文字的占位图，模拟真实生图的延迟。"""

    async def generate(self, prompt: str, aspect_ratio: str = "1:1", input_images=None) -> GeneratedImage:
        await asyncio.sleep(1.5)
        width, height = _RATIOS.get(aspect_ratio, _RATIOS["1:1"])
        hue = int(hashlib.md5(prompt.encode()).hexdigest()[:2], 16)
        img = Image.new("RGB", (width, height), color=f"hsl({hue * 360 // 255}, 45%, 82%)")
        draw = ImageDraw.Draw(img)
        text = "\n".join(textwrap.wrap(prompt, width=28)[:10])
        draw.multiline_text((40, 40), f"[MOCK]\n{text}", fill="#333333", spacing=8)
        buf = BytesIO()
        img.save(buf, format="PNG")
        return GeneratedImage(data=buf.getvalue(), mime="image/png", width=width, height=height, model="mock")

    async def edit(
        self, prompt: str, image: bytes, aspect_ratio: str = "1:1", mask: bytes | None = None,
        transparent: bool = False,
    ) -> GeneratedImage:
        """mock 改图：整图编辑加色调蒙层；带 mask 时只给透明区域上色（验证局部性）。
        transparent 参数与真实 provider 对齐，否则 complete_object 在 mock 下会 TypeError。"""
        await asyncio.sleep(1.0)
        src = Image.open(BytesIO(image)).convert("RGB")
        hue = int(hashlib.md5(prompt.encode()).hexdigest()[:2], 16)
        overlay = Image.new("RGB", src.size, color=f"hsl({hue * 360 // 255}, 60%, 50%)")
        if mask:
            mask_img = Image.open(BytesIO(mask)).convert("RGBA").resize(src.size)
            # 透明区域 = 编辑范围：alpha 反转后作为粘贴蒙版
            inverted = mask_img.split()[3].point(lambda a: 255 - a)
            img = src.copy()
            img.paste(Image.blend(src, overlay, 0.55), (0, 0), inverted)
            tag = "[MOCK REGION EDIT]"
        else:
            img = Image.blend(src, overlay, 0.35)
            tag = "[MOCK EDIT]"
        draw = ImageDraw.Draw(img)
        draw.multiline_text((30, 30), tag + "\n" + "\n".join(textwrap.wrap(prompt, width=30)[:6]), fill="#ffffff", spacing=8)
        buf = BytesIO()
        img.save(buf, format="PNG")
        return GeneratedImage(data=buf.getvalue(), mime="image/png", width=img.width, height=img.height, model="mock")
