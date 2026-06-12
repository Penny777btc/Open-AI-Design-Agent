"""积分账本：余额只能通过流水变更（审计与对账的唯一事实来源）。

模型：审批时整单预扣（reserve），节点失败逐个返还（refund），
充值入账（purchase），注册赠送（grant）。
"""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CreditLedger

# 单进程内按用户串行化账本写入；多实例部署时换 DB 行锁
_user_locks: dict[str, asyncio.Lock] = {}


def _lock(user_id: str) -> asyncio.Lock:
    return _user_locks.setdefault(user_id, asyncio.Lock())


async def get_balance(db: AsyncSession, user_id: str) -> int:
    latest = (
        await db.execute(
            select(CreditLedger.balance_after)
            .where(CreditLedger.user_id == user_id)
            .order_by(CreditLedger.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return latest or 0


class InsufficientCredits(Exception):
    def __init__(self, balance: int, required: int):
        self.balance = balance
        self.required = required
        super().__init__(f"balance {balance} < required {required}")


async def apply(
    db: AsyncSession,
    user_id: str,
    delta: int,
    kind: str,
    *,
    job_id: str | None = None,
    order_id: str | None = None,
    memo: str | None = None,
    enforce: bool = True,
) -> int:
    """写一条流水并返回新余额。扣减时校验余额（enforce）。调用方负责 commit。"""
    async with _lock(user_id):
        balance = await get_balance(db, user_id)
        if enforce and delta < 0 and balance + delta < 0:
            raise InsufficientCredits(balance, -delta)
        new_balance = balance + delta
        db.add(CreditLedger(
            user_id=user_id, delta=delta, kind=kind, job_id=job_id,
            order_id=order_id, balance_after=new_balance, memo=(memo or "")[:255],
        ))
        await db.flush()
        return new_balance
