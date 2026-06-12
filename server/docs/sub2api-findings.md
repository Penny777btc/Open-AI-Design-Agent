# sub2api 站点摸底结论（2026-06-11 实测）

站点：`https://app.vibetools.ai`（key 在 `server/.env`，不进 git）

## 模型与端点矩阵

| 用途 | 模型 | 端点 | key | 状态 |
|---|---|---|---|---|
| Agent 规划/对话 | `gpt-5.5` | `POST /v1/chat/completions` | Codex key | ✅ **A 档**：原生 `tools` + `response_format: json_object` 都支持 |
| 轻量/便宜文本 | `gpt-5.4-mini` | 同上 | Codex key | ✅ 可用（备用） |
| **生图（主力）** | `gpt-image-2` | `POST /v1/images/generations` | Codex key | ✅ 返回 `{"data":[{"b64_json": ...}]}`，PNG 1024×1024，单张约 35-75s |
| Gemini 文本 | `gemini-2.5-flash` 等 | `POST /v1beta/models/{model}:generateContent` | Gemini key | ✅ 原生协议，`contents[].role` 必填 |
| Gemini 生图 | `gemini-2.5-flash-image` 等 | - | Gemini key | ❌ 站点暂不支持（上游 404 NOT_FOUND） |

## 关键坑（绕过过程）

1. `/v1/models` 列出的名字 ≠ 可调用：`gpt-5.3-codex`、`gpt-5.2` 等会报
   "not supported when using Codex with a ChatGPT account"。**可用的是 gpt-5.5 / gpt-5.4-mini**。
2. Gemini key 不走 OpenAI 兼容路径（`/v1/chat/completions` 404），必须用原生
   `generateContent`，且 `contents` 里必须带 `role`（否则 400 INVALID_ARGUMENT）。
3. `/v1/images/generations` 对 Gemini key 返回 "Images API is not supported for this
   platform" —— 图像能力目前只在 Codex key 上（gpt-image-1/1.5/2）。
4. `/v1/responses` 端点存在但返回 upstream_error，未深究（chat/completions 够用）。

## 当前生产配置（server/.env）

- `PLANNER_MODEL=gpt-5.5`（A 档：后续可启用原生 tool-calling 循环做对话式改图）
- `IMAGE_MODEL=gpt-image-2` → `GptImageProvider`（images API）
- `PROVIDER_MODE=sub2api`

## 样本（解析链快照测试用）

- `scripts/samples/gpt_image_2_probe.png` — 真实生成的 PNG
- `scripts/samples/gpt_image_2_response_shape.json` — images API 响应结构（b64 截断）

## 后续

- 站点支持 Gemini 生图后：`Sub2ApiImage` 改走原生 generateContent（解析链已备好），
  并把 `IMAGE_MODEL` 切到 nano banana 系（图生图/改图比 gpt-image 灵活）
- gpt-image-2 的图生图（编辑）走 `/v1/images/edits`（multipart），M1 后期接入
