"""Resend 邮件发送（未配置 RESEND_API_KEY 时抛 MailNotConfigured）。"""

import httpx

from app.config import settings


class MailNotConfigured(Exception):
    pass


async def send(to: str, subject: str, html: str) -> None:
    if not settings.resend_api_key:
        raise MailNotConfigured()
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
            json={"from": settings.mail_from, "to": [to], "subject": subject, "html": html},
        )
        resp.raise_for_status()
