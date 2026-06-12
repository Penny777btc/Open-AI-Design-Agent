from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import CreditLedger

router = APIRouter()

SKILLS = [
    {
        "name": "generate-image",
        "description": "Generate images from a text brief",
        "inputs": ["premise"],
    },
    {
        "name": "brand-kit",
        "description": "Create a small brand kit (logo + poster + social post)",
        "inputs": ["brand_description"],
    },
]


@router.get("/agent-skills")
async def agent_skills():
    return SKILLS


@router.get("/account/balance")
async def balance(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    latest = (
        await db.execute(
            select(CreditLedger.balance_after)
            .where(CreditLedger.user_id == user.id)
            .order_by(CreditLedger.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return {"balance": latest or 0, "email": user.email}
