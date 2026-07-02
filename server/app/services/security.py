"""安全辅助：SSRF 防护（外链拉取白名单）等。"""

import ipaddress
import socket
from urllib.parse import urlparse


def _ip_is_private(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True  # 解析不出 IP → 保守判危
    return (
        addr.is_private or addr.is_loopback or addr.is_link_local
        or addr.is_reserved or addr.is_multicast or addr.is_unspecified
    )


def assert_public_url(url: str) -> None:
    """校验一个可被服务端拉取的外链是否安全：必须 http(s)、有主机名、且解析出的所有 IP 都是公网。

    拦截 SSRF：内网段 / 回环 / link-local(169.254 云元数据) / 保留段。不通过则抛 ValueError。
    注意：这挡住直连内网；DNS 重绑定(解析后再变)属残余风险，配合 follow_redirects=False 使用。
    """
    if not url or not isinstance(url, str):
        raise ValueError("空 URL")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"不允许的协议: {parsed.scheme}")
    host = parsed.hostname
    if not host:
        raise ValueError("URL 缺少主机名")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError(f"域名解析失败: {host}") from exc
    for info in infos:
        ip = info[4][0]
        if _ip_is_private(ip):
            raise ValueError(f"拒绝访问内网/保留地址: {host} -> {ip}")


async def fetch_public_bytes(url: str, *, timeout: float = 60.0, max_bytes: int = 40 * 1024 * 1024) -> bytes:
    """安全拉取外链字节：先过 assert_public_url，再禁重定向（防 302 跳内网），限制体积。"""
    import httpx

    assert_public_url(url)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        resp = await client.get(url)
        if resp.is_redirect:
            raise ValueError("拒绝跟随重定向的外链")
        resp.raise_for_status()
        data = resp.content
        if len(data) > max_bytes:
            raise ValueError("外链文件过大")
        return data
