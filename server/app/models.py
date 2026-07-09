import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    locale: Mapped[str] = mapped_column(String(8), default="en")
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 运营侧：admin/support 由 ADMIN_EMAILS/SUPPORT_EMAILS 启动引导，不开放接口自助升级。
    # support 只读（可查不可改）；封禁即设 disabled_at
    role: Mapped[str] = mapped_column(String(16), default="user")
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 每日文档解析配额覆盖（空=用全局默认 20）：给大客户放宽用
    doc_daily_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DesignSession(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), default="Untitled")
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class SessionMessages(Base):
    """前端以整包 PATCH 的方式保存消息历史，按 session 存一行 JSON。"""

    __tablename__ = "session_messages"

    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.id"), primary_key=True)
    payload: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="chat")  # chat | skill
    client_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # pending | planning | awaiting_approval | running | done | failed | cancelled | rejected
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    input: Mapped[dict] = mapped_column(JSON, default=dict)
    plan: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    approved: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    credits_reserved: Mapped[int] = mapped_column(Integer, default=0)
    credits_settled: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    TERMINAL = {"done", "failed", "cancelled", "rejected"}


class JobEvent(Base):
    __tablename__ = "job_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(String(36), ForeignKey("jobs.id"), index=True)
    type: Mapped[str] = mapped_column(String(24))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    asset_label: Mapped[str] = mapped_column(String(32))
    url: Mapped[str] = mapped_column(Text)
    storage_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(16), default="image")
    mime: Mapped[str | None] = mapped_column(String(64), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_tool: Mapped[str | None] = mapped_column(String(64), nullable=True)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # 画布世界坐标（前端 addImage 用；空则前端走默认摆放）
    canvas_x: Mapped[int | None] = mapped_column(Integer, nullable=True)
    canvas_y: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 画布显示尺寸（用户手动拖拽/缩放后由前端回写；空=按图片自然比例默认尺寸）
    canvas_w: Mapped[int | None] = mapped_column(Integer, nullable=True)
    canvas_h: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 层叠序（四层合成：背景<装饰<阴影<主体<前景<文案）。空=不参与显式堆叠，按插入序渲染
    z_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 智能拆解的语义角色与人类可读名（供 PSD 语义命名/分组；空=非拆解层）
    split_role: Mapped[str | None] = mapped_column(String(16), nullable=True)   # bg | element | subject | text
    split_label: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 如「金色餐叉」
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class CreditLedger(Base):
    __tablename__ = "credit_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(16))  # grant | purchase | reserve | settle | refund | adjust(管理员)
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    order_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    balance_after: Mapped[int] = mapped_column(Integer)
    memo: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String(16), default="stripe")
    provider_session_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    amount_cents: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="usd")
    credits: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Package(Base):
    """充值套餐/价格档位。从代码硬编码迁到库里，管理后台可增删改。

    type 与 billing_period 是订阅制的预留口子：现在只用 one_time，
    将来加订阅时复用同一张表（subscription + monthly/yearly），不改结构。
    """

    __tablename__ = "packages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(48), unique=True, index=True)  # 稳定标识，前端/Stripe 引用
    label: Mapped[str] = mapped_column(String(64))
    credits: Mapped[int] = mapped_column(Integer)
    amount_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(8), default="usd")
    type: Mapped[str] = mapped_column(String(16), default="one_time")  # one_time | subscription（预留）
    billing_period: Mapped[str | None] = mapped_column(String(16), nullable=True)  # null | monthly | yearly（预留）
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class RedeemCode(Base):
    """兑换码/卡密：运营发券，核销即向积分账本写一条 grant 流水。"""

    __tablename__ = "redeem_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    credits: Mapped[int] = mapped_column(Integer)
    batch: Mapped[str | None] = mapped_column(String(48), nullable=True, index=True)  # 批次号，便于成批管理
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | redeemed | disabled
    redeemed_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AdminAuditLog(Base):
    """管理员操作审计：谁、对谁、做了什么——积分补偿/封禁必须可追溯。"""

    __tablename__ = "admin_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    admin_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(32))  # adjust_credits | ban | unban
    target_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ReferenceDoc(Base):
    """上传的参考文档：解析出的文字进入规划上下文。"""

    __tablename__ = "reference_docs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    extracted_text: Mapped[str] = mapped_column(Text, default="")
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    # 文件内容指纹：同一 session 重复上传同一文档时跳过解析（省两次 Gemini 视觉调用）。
    # 可空——旧数据及迁移补列的行没有指纹，按「未去重」对待。
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class UploadedFile(Base):
    __tablename__ = "upload_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    storage_key: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(String(255))
    mime: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class BrandKit(Base):
    """品牌套件（对标 Lovart Brand Kit）：每用户一份，激活后 planner 生成时自动注入品牌规范
    （主色/辅助色/字体气质/品牌名/slogan/logo 说明），让整套设计风格统一。"""

    __tablename__ = "brand_kits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(80), nullable=True)          # 品牌名
    primary_color: Mapped[str | None] = mapped_column(String(16), nullable=True)  # 主色 #RRGGBB
    accent_colors: Mapped[list | None] = mapped_column(JSON, nullable=True)       # 辅助色 ["#..","#.."]
    font_hint: Mapped[str | None] = mapped_column(String(80), nullable=True)      # 字体气质（如"圆润无衬线"）
    slogan: Mapped[str | None] = mapped_column(String(160), nullable=True)        # 品牌 slogan / 调性
    logo_asset_label: Mapped[str | None] = mapped_column(String(64), nullable=True)  # 会话内 logo 资产（可选）
    active: Mapped[bool] = mapped_column(Boolean, default=False)                  # 是否在生成时注入
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)
