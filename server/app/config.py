from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = f"sqlite+aiosqlite:///{BASE_DIR / 'dev.db'}"
    storage_dir: Path = BASE_DIR / "storage"
    public_base_url: str = "http://127.0.0.1:8000"
    # 仅当部署在可信反代（会注入真实客户端 IP 的 X-Forwarded-For）后面时设 True；
    # 否则限流按 request.client.host，防攻击者伪造 XFF 绕过登录爆破/刷量限速。
    trust_proxy: bool = False
    cors_origins: list[str] = [
        "http://localhost:3100", "http://localhost:3000",
        "http://127.0.0.1:3100", "http://127.0.0.1:3000",
    ]

    # mock: 占位图 + 规则规划器（无外部依赖）；sub2api: 走自有中转站
    provider_mode: str = "mock"
    sub2api_base_url: str = ""
    # 站点按模型订阅发 key：Codex（规划）与 Gemini（生图）各一个
    codex_api_key: str = ""
    gemini_api_key: str = ""
    # fal.ai key（官方托管 nano-banana 推理；配置后人物编辑优先走它，~9s/张 vs 中转 2min+）
    fal_api_key: str = ""
    planner_model: str = "codex"
    image_model: str = "gpt-image-2"  # 需支持带 mask 局部编辑（拆图背景/局部编辑/补全）；gemini 不支持 edit
    # gpt-image 生成质量档（low|medium|high|auto，空=不传由站点默认）。用户实测 medium 的
    # 场景复杂度/素材融合度明显低于站点默认(high)——最初那批高融合海报都是 high 出的，
    # 且实测 medium 并没有更快(瓶颈在站点排队)。默认留空=high。
    image_quality: str = ""
    # 含真人的编辑专用模型：gemini 系（nano-banana）人物一致性业界最强，避免 gpt-image 整图重绘导致人脸/身材变形。
    # 仅用于「has_person 且无 mask」的 edit_image 节点（见 job_service 路由）；其余仍走 image_model。
    person_edit_model: str = "gemini-3.1-flash-image"  # Nano Banana 官方 id（vibetools 后台实际暴露名）
    # 人物海报文字策略开关：False=模型直接把标题画进图里（版式感强，nano 中文偶有错字）；
    # True=模型只画装饰标题区，文案叠为前端可编辑文字层（字永远正确、可改，用户实测观感偏平）。
    person_text_layers: bool = False
    # 人物编辑主引擎：gpt=整图重绘(最初工作流,人物画大融入版式+中文标题准,人脸偶有轻微漂移,默认)；
    # outpaint=扩图锁人(人脸物理零变形,但人物保持原照尺寸/边缘剪影感)；nano=fal nano-banana(快
    # ~20s,中文错字+版式偏简,用户实测弃选)。
    person_engine: str = "gpt"
    # 视频生成：供应商加白后给的 endpoint；为空 = 视频未开通（执行层优雅提示）
    video_api_base: str = ""
    video_api_key: str = ""
    video_model: str = "seedance-2-480p"

    # development | production（production 下启动时强校验安全配置）
    environment: str = "development"

    # 管理员邮箱白名单（逗号分隔）：启动时把这些账号提为 admin。
    # 不提供任何接口自助升级——管理权只能由部署者通过环境变量授予。
    admin_emails: str = ""
    # 客服只读角色：可查看管理台全部数据，不能做任何变更操作
    support_emails: str = ""

    dev_user_email: str = "dev@local"
    signup_grant_credits: int = 200  # 审计 R3：降低薅羊毛收益
    image_credits: int = 10
    edit_credits: int = 15
    max_plan_nodes: int = 12
    # 一个计划内并发生图的张数。套图/主图六联(6)/详情页(7)等批量任务靠它并行提速；
    # 受 sub2api 并发上限约束，超限的请求由 _post_retry 退避重试（不会失败，只是排队）。
    # 站点余量大可调高（设环境变量 EXECUTOR_CONCURRENCY），见 429 多则调低。
    executor_concurrency: int = 6
    approval_timeout_seconds: int = 1800  # 审计 L6：余额不足去充值后仍可回来批准

    # Resend 邮件（邮箱验证/密码找回；未配置时相关接口返回 503）
    resend_api_key: str = ""
    mail_from: str = "Picsmith <noreply@picsmith.app>"

    # 认证：jwt = 强制登录；dev = 无 token 时回落到 dev 用户（本地调试）
    auth_mode: str = "jwt"
    jwt_secret: str = "dev-secret-change-me-in-production"
    jwt_expire_days: int = 30
    google_client_id: str = ""
    google_client_secret: str = ""

    # Stripe（未配置时计费接口返回「支付通道未开通」）
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""


def tool_cost(tool: str, model: str | None = None, seconds: float | None = None,
              complete: bool = False, has_person: bool = False,
              person_mode: str = "fuse") -> int:
    """节点积分价。按模型差异化：高级图片模型/视频不能再走统一 10 积分（会亏）。

    向后兼容：旧调用 tool_cost(tool) 不传 model → 默认图片模型（gpt-image-2，10 积分）。

    含真人 edit_image 的三态计价（与 job_service 路由矩阵一一对应，别倒挂）：
    - has_person 且 person_mode!="fuse"(默认 lock) → 锁人物合成 = 一次背景生图 + 本地合成 + 摊抠图，
      按 compose_subject 同量级（image_credits + 4）。比 nano 重绘便宜，因为不用贵的人物一致性模型。
    - has_person 且 person_mode=="fuse" → nano-banana 重绘（人物一致性，拿货更贵）→ 按其 edit 分价(45)。
    - 无 has_person → 默认 gpt-image edit（EDIT_CREDITS）。
    """
    from app.services import model_catalog

    if tool == "edit_image":
        if has_person and str(person_mode).lower() != "fuse":
            # 锁人物合成：≈ compose_subject（背景生图 + 本地合成 + 摊抠图/合成开销）
            return model_catalog.image_credits(model) + 4
        # 含真人且 fuse：按主引擎计价——nano 拿货贵按其 edit 分价(45)；gpt(扩图锁人,默认)
        # 成本≈一次 gpt edit,按默认 EDIT_CREDITS(15),不再让用户为没用上的 nano 买单。
        use_nano = has_person and settings.person_engine == "nano"
        return model_catalog.edit_credits(settings.person_edit_model if use_nano else None)
    if tool == "cutout_layer":
        # 纯本地 rembg 抠图层便宜(3)；但带护栏式补全(complete=True)时会跑最多 2 次 edit + 2 次
        # vision，成本≈一次 edit，须按 edit 计价，否则成本倒挂。
        return 3 + model_catalog.EDIT_CREDITS if complete else 3
    if tool == "compose_subject":
        # 锁主体套图：每节点跑一次背景生成(=一张生图) + 本地合成，另摊上「整套一次性抠主体
        # (+按需一次护栏式补全)」的成本。按 生图价+4 计：+4 覆盖本地合成与摊到各节点的抠图/补全，
        # 既不成本倒挂（远高于纯生图价，含摊销）、又比旧约束式重生成(edit 15/张)略省——主体不再每张重画。
        return model_catalog.image_credits(model) + 4
    if tool == "extract_text":
        return 3  # AI 拆图文字层：一次 OCR 视觉调用，便宜
    if tool == "generate_video":
        return model_catalog.video_credits(model or "seedance-2-480p", seconds or 5)
    return model_catalog.image_credits(model)


def node_cost(node) -> int:
    """从计划节点（Pydantic 或 dict）算积分价——视频要取 args 里的 model/秒数。"""
    if isinstance(node, dict):
        tool, args = node.get("tool", ""), (node.get("args") or {})
    else:
        tool, args = getattr(node, "tool", ""), (getattr(node, "args", {}) or {})
    return tool_cost(tool, args.get("model"), args.get("seconds"), bool(args.get("complete")),
                     has_person=bool(args.get("has_person")),
                     person_mode=str(args.get("person_mode", "fuse")))  # 默认与 planner/路由一致：fuse 重绘


def validate_production_config() -> list[str]:
    """生产环境启动安全校验（审计 R1/R2/L8）：返回致命错误列表。"""
    errors = []
    if settings.environment != "production":
        return errors
    if settings.jwt_secret == "dev-secret-change-me-in-production":
        errors.append("JWT_SECRET 仍是默认值——任何人都能伪造登录态")
    if settings.auth_mode != "jwt":
        errors.append("生产环境 AUTH_MODE 必须为 jwt（dev 模式存在共享账号后门）")
    if settings.stripe_secret_key and not settings.stripe_webhook_secret:
        errors.append("启用了 Stripe 但未配置 STRIPE_WEBHOOK_SECRET——webhook 可被伪造刷积分")
    if any("localhost" in o or "127.0.0.1" in o for o in settings.cors_origins):
        errors.append("CORS_ORIGINS 仍包含 localhost——生产域名未配置，前端将无法访问")
    if settings.provider_mode == "mock":
        errors.append("PROVIDER_MODE 仍是 mock——用户将拿到占位图而非真实生成结果")
    if "sqlite" in settings.database_url:
        import logging

        logging.getLogger(__name__).warning(
            "生产环境仍在使用 SQLite + 本地磁盘存储：单点、无备份冗余，仅适合软启动期，"
            "请尽快完成 Postgres + R2 迁移（M4）并启用 scripts/backup.sh 定时备份"
        )
    return errors


settings = Settings()
