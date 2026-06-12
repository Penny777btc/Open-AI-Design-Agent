"""M0 摸底脚本：实测 sub2api 的 Codex 能力与 Gemini 返图格式。

跑法: cd server && .venv/bin/python scripts/probe_sub2api.py
输出: 终端报告 + scripts/samples/ 下的原始响应样本（供解析链快照测试用）
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import settings  # noqa: E402
from app.providers.openai_compat import (  # noqa: E402
    OpenAICompatClient,
    parse_image_response,
    probe_capabilities,
)

SAMPLES = Path(__file__).parent / "samples"


async def main() -> None:
    print(f"base_url = {settings.sub2api_base_url}")
    if not settings.sub2api_base_url:
        print("!! SUB2API_BASE_URL 未配置（server/.env）")
        return
    SAMPLES.mkdir(exist_ok=True)

    print("\n=== /v1/models 模型发现 ===")
    import httpx

    for name, key in (("codex key", settings.codex_api_key), ("gemini key", settings.gemini_api_key)):
        try:
            async with httpx.AsyncClient(timeout=15.0) as http:
                resp = await http.get(
                    f"{settings.sub2api_base_url.rstrip('/')}/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
            models = [m.get("id") for m in resp.json().get("data", [])]
            print(f"{name}: {models}")
        except Exception as exc:
            print(f"{name}: /v1/models 不可用（{str(exc)[:80]}）")

    print(f"\n=== Codex ({settings.planner_model}) 能力探测 ===")
    caps = await probe_capabilities(settings.planner_model, settings.codex_api_key)
    print(json.dumps(caps, ensure_ascii=False, indent=2))
    tier = "A (原生 tools)" if caps.get("native_tools") else (
        "B (json_object)" if caps.get("json_object") else "C (prompt 约束)"
    )
    print(f"→ Agent 循环档位: {tier}")

    print(f"\n=== Gemini ({settings.image_model}) 生图探测 ===")
    client = OpenAICompatClient(api_key=settings.gemini_api_key)
    data = await client.chat(
        settings.image_model,
        [{"role": "user", "content": "Generate an image of a red apple on a white table, minimalist photography."}],
    )
    sample_path = SAMPLES / "gemini_image_response.json"
    slim = json.loads(json.dumps(data))
    sample_path.write_text(json.dumps(slim, ensure_ascii=False, indent=2)[:200_000])
    print(f"原始响应已存: {sample_path}")

    parsed = await parse_image_response(data)
    if parsed:
        raw, mime = parsed
        out = SAMPLES / f"gemini_probe.{mime.split('/')[-1]}"
        out.write_bytes(raw)
        print(f"✅ 解析链命中: {mime}, {len(raw)} bytes → {out}")
    else:
        message = (data.get("choices") or [{}])[0].get("message", {})
        content = message.get("content")
        print("❌ 解析链未命中，message 结构概要:")
        print("  keys:", list(message.keys()))
        if isinstance(content, str):
            print("  content[:400]:", content[:400])
        else:
            print("  content type:", type(content).__name__)


if __name__ == "__main__":
    asyncio.run(main())
