"""落地页案例第二批：扩容电商/自媒体 + 新增 PPT 品类 + Logo 补充。

跑法: cd server && .venv/bin/python scripts/gen_showcase_batch2.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.providers.openai_compat import GptImageProvider  # noqa: E402

OUT = Path(__file__).resolve().parent.parent.parent / "client" / "public" / "showcase"

GENERATIONS = [
    # 电商扩容
    ("ec-sneaker-hero.png", "1:1",
     "E-commerce hero shot of a modern white-and-orange running sneaker floating at a dynamic angle, pure white background, sharp studio lighting, subtle ground shadow, photorealistic product photography"),
    ("ec-lipstick-luxury.png", "1:1",
     "Luxury cosmetics advertising photo, a rose-gold lipstick standing on black silk fabric with soft dramatic spotlight, deep shadows, premium beauty editorial style"),
    ("ec-food-poster.png", "9:16",
     "Vertical food delivery promotional poster, bold Chinese headline 新店开业 and subheading 第二份半价, render the Chinese text exactly and correctly, appetizing burger and bubble tea photography, warm vibrant orange palette, modern bold layout"),
    ("ec-watch-detail.png", "16:9",
     "Macro detail photograph of a luxury mechanical watch face, dramatic side lighting revealing texture of the dial and hands, dark moody background, horizontal e-commerce detail banner"),
    # 自媒体扩容
    ("social-bilibili.png", "16:9",
     "Video platform thumbnail, bold Chinese title 3分钟看懂AI rendered exactly and correctly in huge readable typography, curious young person with lightbulb graphics, bright blue and white tech aesthetic, high contrast clickable composition"),
    ("social-wechat-banner.png", "16:9",
     "WeChat article header banner, minimal editorial illustration of an open book turning into a city skyline, muted morandi color palette, generous negative space, sophisticated flat illustration style"),
    ("social-douyin.png", "9:16",
     "Vertical short-video knowledge cover, bold Chinese title 早起的5个习惯 rendered exactly and correctly, energetic sunrise gradient background, clean modern typography layout, motivational aesthetic"),
    ("social-quote-card.png", "1:1",
     "Minimal quote card design, short Chinese text 慢慢来比较快 rendered exactly in elegant serif typography, textured cream paper background, small red seal stamp accent, zen aesthetic"),
    # PPT 品类（新）
    ("ppt-cover.png", "16:9",
     "Business presentation cover slide, bold Chinese title 2026 年度战略规划 rendered exactly and correctly, dark navy background with glowing abstract data visualization lines, professional corporate keynote design, clean layout with title hierarchy"),
    ("ppt-data.png", "16:9",
     "Presentation slide design showing elegant data dashboard, abstract 3D bar charts and line graphs glowing on dark background, annotations and percentage callouts, modern analytics keynote aesthetic"),
    ("ppt-section.png", "16:9",
     "Minimal presentation section divider slide, huge number 03 and Chinese text 市场分析 rendered exactly, split layout with architectural photography on the right half, premium consulting deck style"),
    ("ppt-team.png", "16:9",
     "Team introduction presentation slide, four circular portrait placeholders in a row with name and title labels, clean grid layout, soft gradient background, modern corporate design"),
    # Logo 补充
    ("logo-tech.png", "1:1",
     "Modern tech startup logo, abstract geometric hexagon mark formed by interlocking lines, gradient from cyan to violet, on dark background, flat vector style, centered"),
    ("logo-restaurant.png", "1:1",
     "Chinese restaurant logo, elegant circular emblem with a stylized steaming bowl and chopsticks, the Chinese character 膳 rendered exactly in the center, vermillion red and gold on cream, traditional-modern fusion style"),
    ("logo-fitness.png", "1:1",
     "Dynamic fitness brand logo, abstract running figure formed by sharp speed strokes, electric lime green on charcoal black, bold athletic energy, flat vector style"),
]


async def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    provider = GptImageProvider()
    sem = asyncio.Semaphore(2)
    ok = 0

    async def gen(name, ratio, prompt):
        nonlocal ok
        async with sem:
            try:
                img = await provider.generate(prompt, ratio)
                (OUT / name).write_bytes(img.data)
                ok += 1
                print(f"✅ {name} {img.width}x{img.height}", flush=True)
            except Exception as exc:
                print(f"❌ {name}: {str(exc)[:120]}", flush=True)

    await asyncio.gather(*(gen(*g) for g in GENERATIONS))
    print(f"\n完成: {ok}/{len(GENERATIONS)}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
