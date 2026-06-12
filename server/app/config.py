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
    cors_origins: list[str] = ["http://localhost:3100", "http://localhost:3000"]

    # mock: 占位图 + 规则规划器（无外部依赖）；sub2api: 走自有中转站
    provider_mode: str = "mock"
    sub2api_base_url: str = ""
    # 站点按模型订阅发 key：Codex（规划）与 Gemini（生图）各一个
    codex_api_key: str = ""
    gemini_api_key: str = ""
    planner_model: str = "codex"
    image_model: str = "gemini"

    # development | production（production 下启动时强校验安全配置）
    environment: str = "development"

    dev_user_email: str = "dev@local"
    signup_grant_credits: int = 200  # 审计 R3：降低薅羊毛收益
    image_credits: int = 10
    edit_credits: int = 15
    max_plan_nodes: int = 12
    executor_concurrency: int = 2
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


def tool_cost(tool: str) -> int:
    return settings.edit_credits if tool == "edit_image" else settings.image_credits


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
    return errors


settings = Settings()
