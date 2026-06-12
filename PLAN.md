# 项目规划：类 Lovart 的 AI 设计 Agent 网站

> 基于 fork 的 Open-AI-Design-Agent（MIT），去除 Muapi 依赖，
> 模型层走自有 sub2api token 站点（https://app.vibetools.ai，实测结论见 server/docs/sub2api-findings.md）。

## 产品定位（2026-06-11 确定）

- **垂直场景**：电商设计（主图/详情页/活动海报/多平台尺寸）+ Logo 设计 + 自媒体配图（公众号/小红书/视频封面）
- **体验对标 Lovart**：改图迭代、元素级编辑、画布标注输入（简化版 ChatCanvas）、多模型路由、批量变体
- **不做**：RunningHub 式工作流市场（UGC 平台是另一个物种）；只借鉴其增长机制（邀请奖励、每日免费积分）
- **体验差距优先级**：① 改图/迭代（M1 核心交付）② 画布标注式局部重绘（M2）③ 视频生成（等站点模型供给）④ 模板库（垂直三场景的预置模板，M2-M3 内容运营）

## 总体架构（目标态）

```
浏览器
  │
  ├─ Next.js 前端（复用 fork 的画布 + 会话 UI，新增官网/登录/计费页）
  │       │ HTTPS (REST + 事件轮询/SSE)
  ▼
FastAPI 后端（自建，替换 Muapi 云端）
  ├─ Auth 模块（JWT，邮箱 + OAuth）
  ├─ Agent 编排（Codex 规划 → 任务图 → 逐步执行）
  ├─ Job 队列 + 事件流（前端轮询 /jobs/{id}/events）
  ├─ 生成调用层（OpenAI 兼容客户端 → sub2api 站点）
  │     ├─ 规划/对话: Codex
  │     └─ 生图/改图: Gemini (nano banana)
  ├─ 计费模块（积分扣减、用量记录、支付回调）
  ▼
PostgreSQL（users / sessions / messages / jobs / assets / credits / orders）
S3 兼容存储（生成图片，推荐 Cloudflare R2，免出口流量费）
```

## 模型映射（当前 sub2api 可用模型）

| 用途 | 模型 | 接口 |
|---|---|---|
| Agent 规划、对话、需求拆解 | Codex | `/v1/chat/completions` |
| 文生图、图生图、改图 | Gemini（图像输出） | `/v1/chat/completions`（返回 base64/URL，按 sub2api 实际行为适配） |
| 视频生成 | 暂缺，站点加模型后接入 | - |

## 分阶段计划

### Phase 0 — 跑通现状（半天）
- [ ] 本地起前端，确认画布/会话 UI 可用（可临时用假数据）
- [ ] 用 curl 摸清 sub2api 站点两个模型的真实请求/响应格式（尤其 Gemini 返图方式）
- 产出：确认前端可复用范围 + 站点 API 行为文档

### Phase 1 — MVP：自建 Agent 后端（1~2 周）
单用户、无认证、本地存储，先让"输入 brief → 出图到画布"全链路跑通。
- [ ] FastAPI 骨架，实现前端既有契约：
      `/sessions` CRUD、`/sessions/{id}/messages`、`/sessions/{id}/chat`、
      `/jobs/{id}/status|events|approve|reject|cancel`、`/sessions/{id}/assets`、`/agent-skills`
- [ ] Agent 规划循环：Codex 把 brief 拆成资产清单（JSON 计划），用户确认后逐项执行
- [ ] 生图执行器：调 Gemini 生图，结果存本地盘，注册为 asset
- [ ] Job 事件流：内存队列 + SQLite 持久化，事件供前端轮询
- [ ] 文件上传：替换 Muapi S3 预签名逻辑为本地存储
- 产出：本地可用的完整设计 Agent

### Phase 2 — 用户体系（1 周）
- [ ] SQLite → PostgreSQL，所有表加 user_id，行级隔离
- [ ] 注册/登录：邮箱+密码 + Google/GitHub OAuth，后端签发 JWT
- [ ] 前端登录页、会话守卫、个人资产页
- [ ] 文件存储迁移 Cloudflare R2，私有文件走签名 URL
- 产出：可注册的多用户站点（内测态）

### Phase 3 — 支付与计费（1 周）
- [ ] 积分模型：每次生图/规划按模型扣积分，用量表记录成本
- [ ] 支付渠道（按主体二选一或并行）：
      - 海外/有公司主体：Stripe 或 Paddle/Lemon Squeezy（MoR，免税务麻烦）
      - 国内/个人主体：易支付类聚合 或 虎皮椒（微信/支付宝）
- [ ] 订阅 + 积分包两种 SKU；Webhook 回调入账；防重放
- [ ] 免费额度 + 限流（防刷）
- 产出：可收钱的 Beta

### Phase 4 — 上线与打磨（1 周+）
- [ ] 部署：前端 Vercel；后端 + Postgres 用 Railway / 自有 VPS（Docker Compose）；R2 存储
- [ ] 官网落地页、模板库、SEO 基础
- [ ] 监控（Sentry）、日志、备份；服务条款/隐私政策
- [ ] 灰度放量

## 关键风险与对策
1. **Gemini 经 sub2api 的返图格式不确定** → Phase 0 先实测，生成调用层做成 adapter 模式，换模型只改 adapter
2. **token 站点稳定性/配额** → 调用层做重试 + 降级提示；用量表能对账
3. **生图延迟长（10~60s）** → Job 异步化 + 事件轮询从第一天就做（前端契约本来就是这么设计的）
4. **上游 fork 同步** → 保留 upstream remote，前端组件改动尽量收敛在 packages/design-agent

## 不做的事（MVP 阶段）
- 视频生成（等站点加模型）
- 实时多人协作画布
- 移动端适配深度优化
- 自建 ComfyUI / 本地模型
