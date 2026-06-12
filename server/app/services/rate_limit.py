"""轻量限流（审计 R3）：进程内滑动窗口。多实例部署时换 Redis。"""

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_buckets: dict[str, deque] = defaultdict(deque)


def rate_limit(scope: str, times: int, seconds: int):
    """FastAPI 依赖工厂：同一 key（scope+IP 或 scope+user）窗口内最多 times 次。"""

    async def dependency(request: Request):
        ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
        key = f"{scope}:{ip}"
        now = time.monotonic()
        bucket = _buckets[key]
        while bucket and now - bucket[0] > seconds:
            bucket.popleft()
        if len(bucket) >= times:
            raise HTTPException(status_code=429, detail="请求太频繁，请稍后再试")
        bucket.append(now)

    return dependency
