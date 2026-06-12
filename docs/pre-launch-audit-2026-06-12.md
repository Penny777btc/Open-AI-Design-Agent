
---

## 修复记录（2026-06-12 当日完成）

| 项 | 状态 |
|---|---|
| R1 webhook 强制验签 | ✅ 无 secret 时拒绝一切回调（实测 503） |
| R2 JWT 默认 secret | ✅ production 环境启动校验，默认值拒绝启动（实测拦截） |
| L8 AUTH_MODE 后门 | ✅ production 强制 jwt（同上校验） |
| L1 重启不退款 | ✅ 启动补退未消耗预扣（实测：预扣80/消耗20/补退60） |
| L4 双击双扣 | ✅ 原子状态抢占（并发实测 200+409，仅一笔 reserve） |
| R3 薅羊毛 | ✅ 注册 5/h/IP、登录 10/15min、chat 20/min 限流（实测 429）；赠送 500→200；邮箱验证+密码找回完整实现（Resend 配置后激活） |
| L2 密码找回 | ✅ /auth/request-reset + /reset 页（防枚举、1h token） |
| L5 删会话不取消任务 | ✅ 软删时取消全部进行中任务并退积分 |
| L6 审批超时 | ✅ 10min → 30min（可配） |
| P1 落地页 52MB | ✅ WebP 化 54.3MB → 1.7MB（-97%） |
| R5 法务三件套 | ✅ /legal/terms, /legal/privacy, /legal/refund + footer 链接 |
| U1 余额不刷新 | ✅ onBalanceChange 回调（审批/完成/退还后刷新） |
| U2 402 无充值入口 | ✅ toast 内嵌「去充值 →」直达 billing |
| U3 语言混杂 | ✅ 任务总结跟随用户输入语言 |
| U5 移动端画布 | ✅ 可关闭的桌面端建议横幅（触屏适配仍为后续项） |

## 遗留（依赖外部账号/M4）
- P2 Postgres + R2（Cloudflare 账号）｜ P5 Sentry/备份（M4）｜ L7 双标签页覆盖（低频，M4 后）｜ R7 国内内容审核（国内版前置）
