"""重试 batch2 失败的 5 张。跑法: cd server && .venv/bin/python scripts/retry_failed.py"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.providers.openai_compat import GptImageProvider  # noqa: E402

OUT = Path(__file__).resolve().parent.parent.parent / "client" / "public" / "showcase"

RETRY = [
    ("ppt-section.png", "16:9",
     "Minimal presentation section divider slide, huge number 03 and Chinese text 市场分析 rendered exactly, split layout with architectural photography on the right half, premium consulting deck style"),
    ("ppt-team.png", "16:9",
     "Team introduction presentation slide, four circular portrait placeholders in a row with name and title labels, clean grid layout, soft gradient background, modern corporate design"),
    ("logo-tech.png", "1:1",
     "Modern tech startup logo, abstract geometric hexagon mark formed by interlocking lines, gradient from cyan to violet, on dark background, flat vector style, centered"),
    ("logo-restaurant.png", "1:1",
     "Chinese restaurant logo, elegant circular emblem with a stylized steaming bowl and chopsticks, the Chinese character 膳 rendered exactly in the center, vermillion red and gold on cream, traditional-modern fusion style"),
    ("logo-fitness.png", "1:1",
     "Dynamic fitness brand logo, abstract running figure formed by sharp speed strokes, electric lime green on charcoal black, bold athletic energy, flat vector style"),
]


async def main() -> None:
    provider = GptImageProvider()
    sem = asyncio.Semaphore(2)

    async def gen(name, ratio, prompt):
        async with sem:
            for _ in range(2):
                try:
                    img = await provider.generate(prompt, ratio)
                    (OUT / name).write_bytes(img.data)
                    print(f"OK {name} {img.width}x{img.height}", flush=True)
                    return
                except Exception as exc:
                    print(f"retrying {name}: {str(exc)[:80]}", flush=True)
                    await asyncio.sleep(5)
            print(f"FAIL {name}", flush=True)

    await asyncio.gather(*(gen(*x) for x in RETRY))


if __name__ == "__main__":
    asyncio.run(main())
