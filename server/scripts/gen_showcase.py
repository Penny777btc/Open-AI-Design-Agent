"""批量生成落地页案例素材（直接走 provider，输出到 client/public/showcase/）。

跑法: cd server && .venv/bin/python scripts/gen_showcase.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.providers.openai_compat import GptImageProvider  # noqa: E402

OUT = Path(__file__).resolve().parent.parent.parent / "client" / "public" / "showcase"

GENERATIONS = [
    # 电商
    ("ec-thermos-hero.png", "1:1",
     "E-commerce hero product photograph of a premium brushed stainless steel thermos bottle, centered, pure white seamless background, soft studio lighting, crisp subtle shadow, photorealistic, high detail"),
    ("ec-skincare-scene.png", "1:1",
     "Lifestyle product photo of a minimalist amber glass serum bottle standing on a wet stone slab, soft morning sunlight, water droplets, blurred green leaves background, premium skincare advertising photography"),
    ("ec-promo-poster.png", "9:16",
     "Vertical e-commerce promotional poster, bold Chinese headline 年中大促 and subheading 全场5折起, render the Chinese text exactly and correctly, energetic red and gold color scheme, floating gift boxes and confetti, clean modern layout, festive shopping atmosphere"),
    ("ec-banner-coffee.png", "16:9",
     "Wide e-commerce banner for artisan coffee beans, kraft paper coffee bag on the left, scattered roasted beans, warm brown tones, elegant serif text FRESHLY ROASTED rendered exactly, negative space on the right for copy"),
    # Logo 三方案
    ("logo-minimal.png", "1:1",
     "Minimalist logo design for specialty coffee brand Mori Coffee, simple geometric coffee cup mark, thin clean lines, black on cream background, flat vector style, centered, generous whitespace"),
    ("logo-badge.png", "1:1",
     "Vintage badge logo for coffee brand Mori Coffee, circular emblem with coffee plant illustration, hand-drawn line art, cream lines on deep forest green, render the brand name MORI COFFEE exactly"),
    ("logo-wordmark.png", "1:1",
     "Modern wordmark logo MORI, custom bold geometric letterforms, single black ink on white, coffee bean negative space hidden in the letter O, flat vector style"),
    # 自媒体
    ("social-rednote.png", "9:16",
     "Social media cover image, bold Chinese title 7天收纳改造计划 rendered exactly and correctly in large readable typography, bright airy photo of beautifully organized shelves, pastel palette, cozy healing aesthetic, xiaohongshu cover style"),
    ("social-youtube.png", "16:9",
     "YouTube thumbnail, excited young person pointing at a glowing smartphone, bold text AI TOOLS 2026 rendered exactly, high contrast saturated colors, dramatic rim lighting, clickable energy"),
    ("social-podcast.png", "1:1",
     "Podcast cover art titled Night Talks, retro condenser microphone illustration, deep navy and warm orange palette, art deco geometric frame, render the title text NIGHT TALKS exactly"),
]

EDITS = [
    # 改图对比：白底主图 → 户外场景（产品保持一致）
    ("ec-thermos-hero.png", "ec-thermos-scene.png",
     "Place this exact thermos bottle on a mossy rock beside a mountain stream at golden hour, keep the product completely identical, outdoor camping atmosphere, photorealistic"),
]


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    provider = GptImageProvider()
    sem = asyncio.Semaphore(2)
    results = []

    async def gen(name, ratio, prompt):
        async with sem:
            try:
                img = await provider.generate(prompt, ratio)
                (OUT / name).write_bytes(img.data)
                results.append((name, "ok", f"{img.width}x{img.height}"))
                print(f"✅ {name} {img.width}x{img.height}", flush=True)
            except Exception as exc:
                results.append((name, "fail", str(exc)[:120]))
                print(f"❌ {name}: {str(exc)[:120]}", flush=True)

    await asyncio.gather(*(gen(*g) for g in GENERATIONS))

    for src, dst, prompt in EDITS:
        src_path = OUT / src
        if not src_path.exists():
            print(f"⏭️  跳过编辑 {dst}（源图 {src} 不存在）", flush=True)
            continue
        try:
            img = await provider.edit(prompt, src_path.read_bytes())
            (OUT / dst).write_bytes(img.data)
            print(f"✅ {dst} (edit) {img.width}x{img.height}", flush=True)
        except Exception as exc:
            print(f"❌ {dst}: {str(exc)[:120]}", flush=True)

    ok = sum(1 for r in results if r[1] == "ok")
    print(f"\n完成: {ok}/{len(GENERATIONS)} 生成 + 编辑见上", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
