"""模型目录与差异化计费（单一事实来源）。

为什么存在：早先全站「10 积分/张」是按 GPTImage2（¥0.07/张）定的，毛利 ~90%；
但 Nano Banana 2 拿货 ¥0.8/张、视频按秒计——统一 10 积分会在高级模型/视频上亏钱。
这里按每个模型的真实拿货成本 + 目标毛利定积分价，并设毛利地板做护栏：
任何人改价若把某模型毛利压到 MIN_MARGIN 以下，import 即报错，杜绝「改着改着就亏了」。

积分锚点：套餐 $9.9 / 1000 积分 → 1 积分 ≈ $0.0099。
成本以人民币拿货价记（供应商口径），按 RMB_PER_USD 折算后算毛利。
"""

CREDIT_USD = 0.0099          # 1 积分对应的售价（美元）
RMB_PER_USD = 7.2            # 拿货价是人民币，折算成美元算毛利
MIN_MARGIN = 0.65            # 毛利地板：低于此值视为定价错误

# 每个模型：kind（image|video）、拿货成本、积分价、单位。
# 图片按张计；视频按秒计（cost_rmb / credits 即「每秒」）。
MODELS = {
    "gpt-image-2": {
        "label": "GPT Image 2", "kind": "image", "unit": "image",
        "cost_rmb": 0.07, "credits": 10, "default": True,
    },
    "nano-banana-2": {
        "label": "Nano Banana 2 · 高清", "kind": "image", "unit": "image",
        "cost_rmb": 0.8, "credits": 40,
    },
    # Nano Banana 的官方模型 id（vibetools 后台实际暴露的名字 = Gemini 3.x Flash Image）。
    # 与 nano-banana-2 同拿货成本；人物一致性编辑路由到它，用官方 id 最稳。
    "gemini-3.1-flash-image": {
        "label": "Nano Banana · Gemini 3.1 Flash Image", "kind": "image", "unit": "image",
        "cost_rmb": 0.8, "credits": 40,
    },
    "seedance-2-480p": {
        "label": "Seedance 2.0 · 480p", "kind": "video", "unit": "second",
        "cost_rmb": 0.45, "credits": 22,
    },
    "seedance-2-720p": {
        "label": "Seedance 2.0 · 720p（无音频）", "kind": "video", "unit": "second",
        "cost_rmb": 0.07, "credits": 4,
    },
}

# 编辑用图片模型的 edits 端点，成本与生图同量级，单独计价（默认 gpt-image edits，保留原 15 积分）
EDIT_CREDITS = 15

# 按模型分价的编辑积分：nano-banana（gemini）edit 拿货 ¥0.8/张，若沿用 15 积分毛利仅 ~25%（远低于地板）。
# 含真人的编辑路由到 nano（人物一致性优先），须按其真实成本单独定价，避免 node_cost 对 has_person 节点倒挂。
# 每个模型：max(该模型生图价 + 编辑加成, EDIT_CREDITS)——编辑通道成本≈生图，另摊图文往返开销。
_EDIT_CREDITS_BY_MODEL = {
    "nano-banana-2": 45,  # 生图 40 + 5；45 积分毛利 = 1 - (0.8/7.2)/(45*0.0099) ≈ 75%，达标
    "gemini-3.1-flash-image": 45,  # 同 nano-banana（官方 id），同价同毛利
}


def edit_credits(model: str | None = None) -> int:
    """单次编辑的积分价（未指定或未知模型 → 默认 gpt-image edits 的 EDIT_CREDITS）。"""
    return _EDIT_CREDITS_BY_MODEL.get(model or "", EDIT_CREDITS)


# 护栏：编辑分价也要过毛利地板（复用生图成本口径），改价写错当场暴露
for _mid, _ec in _EDIT_CREDITS_BY_MODEL.items():
    _rev = _ec * CREDIT_USD
    _cost = MODELS[_mid]["cost_rmb"] / RMB_PER_USD
    assert _rev > 0 and (1 - _cost / _rev) >= MIN_MARGIN, (
        f"编辑模型 {_mid} 积分 {_ec} 毛利低于地板 {MIN_MARGIN:.0%}，需上调"
    )


def margin(model_id: str) -> float:
    """该模型的毛利率（0-1）。"""
    m = MODELS[model_id]
    revenue = m["credits"] * CREDIT_USD
    cost = m["cost_rmb"] / RMB_PER_USD
    return 1 - cost / revenue if revenue > 0 else 0.0


# 护栏：模块加载即校验所有模型毛利达标，定价写错当场暴露
for _mid in MODELS:
    _mg = margin(_mid)
    assert _mg >= MIN_MARGIN, f"模型 {_mid} 毛利 {_mg:.0%} 低于地板 {MIN_MARGIN:.0%}，定价需上调"

_DEFAULT_IMAGE = next((mid for mid, m in MODELS.items() if m.get("default")), "gpt-image-2")


def image_credits(model: str | None = None) -> int:
    """单张生图的积分价（未指定模型用默认图片模型）。"""
    m = MODELS.get(model or _DEFAULT_IMAGE)
    if m is None or m["kind"] != "image":
        m = MODELS[_DEFAULT_IMAGE]
    return m["credits"]


def video_credits(model: str, seconds: float) -> int:
    """一段视频的积分价 = 每秒积分 × 秒数（向上取整）。"""
    import math

    m = MODELS.get(model)
    if m is None or m["kind"] != "video":
        raise ValueError(f"未知视频模型：{model}")
    return max(1, math.ceil(m["credits"] * max(seconds, 0)))


def catalog() -> list[dict]:
    """供管理后台展示：每个模型的成本/积分/毛利。"""
    out = []
    for mid, m in MODELS.items():
        out.append({
            "id": mid, "label": m["label"], "kind": m["kind"], "unit": m["unit"],
            "cost_rmb": m["cost_rmb"], "credits": m["credits"],
            "margin": round(margin(mid), 3), "default": bool(m.get("default")),
        })
    return out
