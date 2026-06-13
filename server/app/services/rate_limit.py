"""轻量限流（审计 R3）：进程内滑动窗口。多实例部署时换 Redis。"""

import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request

from app.deps import get_current_user

_buckets: dict[str, deque] = defaultdict(deque)


def _retry_hint(seconds: int) -> str:
    """把窗口长度说成「何时可重试」，给前端可直接展示的中文文案。"""
    if seconds % 86400 == 0:
        return f"{seconds // 86400} 天"
    if seconds % 3600 == 0:
        return f"{seconds // 3600} 小时"
    if seconds % 60 == 0:
        return f"{seconds // 60} 分钟"
    return f"{seconds} 秒"


def rate_limit(scope: str, times: int, seconds: int, by: str = "ip", override_attr: str | None = None):
    """FastAPI 依赖工厂：同一 key（scope+IP 或 scope+user）窗口内最多 times 次。

    by="user" 时按用户 id 计数——文档/媒体上传这类「按账号配额」的限流不能按 IP，
    否则同一办公网络下的多个用户会互相挤占；登录态又能防匿名换 IP 绕过。
    可叠多个本依赖实现多级窗口（如每小时 + 每天）。
    """

    if by == "user":
        async def dependency(user=Depends(get_current_user)):
            key = f"{scope}:user:{user.id}"
            # 管理员可给单个用户放宽配额（大客户场景）：User 上的覆盖列优先于全局默认
            limit = times
            if override_attr and getattr(user, override_attr, None):
                limit = getattr(user, override_attr)
            # 带「何时可重试」的中文文案：上传是按账号配额，用户需要知道等多久
            _check(key, limit, seconds, detail=f"上传太频繁，请 {_retry_hint(seconds)}后再试")

        return dependency

    async def dependency(request: Request):
        ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
        key = f"{scope}:{ip}"
        _check(key, times, seconds, detail="请求太频繁，请稍后再试")

    return dependency


def _check(key: str, times: int, seconds: int, detail: str) -> None:
    now = time.monotonic()
    bucket = _buckets[key]
    while bucket and now - bucket[0] > seconds:
        bucket.popleft()
    if len(bucket) >= times:
        raise HTTPException(status_code=429, detail=detail)
    bucket.append(now)
