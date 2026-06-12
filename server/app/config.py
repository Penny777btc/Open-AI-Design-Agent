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

    dev_user_email: str = "dev@local"
    signup_grant_credits: int = 500
    image_credits: int = 10
    edit_credits: int = 15
    max_plan_nodes: int = 12
    executor_concurrency: int = 2

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


settings = Settings()
