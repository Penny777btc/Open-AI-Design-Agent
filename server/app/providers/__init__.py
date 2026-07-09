from app.config import settings
from app.providers.base import ImageProvider, LLMProvider, VideoProvider


def get_llm() -> LLMProvider:
    if settings.provider_mode == "sub2api":
        from app.providers.openai_compat import Sub2ApiLLM

        return Sub2ApiLLM()
    from app.providers.mock import MockLLM

    return MockLLM()


def get_image_provider() -> ImageProvider:
    if settings.provider_mode == "sub2api":
        if settings.image_model.startswith("gpt-image"):
            from app.providers.openai_compat import GptImageProvider

            return GptImageProvider()
        from app.providers.openai_compat import Sub2ApiImage

        return Sub2ApiImage()
    from app.providers.mock import PlaceholderImage

    return PlaceholderImage()


# fal 专长文生图模型（对标 Lovart 多模型；需 fal_api_key）——供 generate 节点按 planner
# 选出的 model 路由。仅这些 key 命中 fal；其它/空 → None（调用方回落默认 gpt-image）。
def get_gen_provider_for(model: str | None):
    """按模型名返回专长 generate provider；非 fal 模型返回 None（走默认）。含真人/局部编辑不走这里。"""
    from app.providers.fal_image import FAL_GEN_MODELS

    if model and model in FAL_GEN_MODELS and settings.fal_api_key and settings.provider_mode != "mock":
        from app.providers.fal_image import FalTextToImage

        return FalTextToImage(model)
    return None


def get_person_edit_provider() -> ImageProvider:
    """含真人编辑专用 provider：gemini 系（nano-banana）人物一致性最强。

    优先级：fal.ai（配置了 fal_api_key；官方托管 nano 推理，实测 ~9s/张、拿货 $0.039/张）
    → sub2api Sub2ApiImage（vibetools 中转，走 /v1/chat/completions 图文输入）
    → mock PlaceholderImage（保持既有 mock 端到端流程不破坏）。
    调用侧（job_service edit_image 路由）只在「has_person 且无 mask」时用它，并对失败降级回 gpt-image。
    """
    if settings.fal_api_key and settings.provider_mode != "mock":
        from app.providers.fal_image import FalNanoBanana

        return FalNanoBanana()
    if settings.provider_mode == "sub2api":
        from app.providers.openai_compat import Sub2ApiImage

        return Sub2ApiImage(model=settings.person_edit_model)
    from app.providers.mock import PlaceholderImage

    return PlaceholderImage()


def get_video_provider() -> VideoProvider | None:
    """视频生成 provider。优先 fal（对标 Lovart，用现有 fal key，Kling/Seedance/Wan 图生+文生）
    → 其次 sub2api 中转 → 都没有则 None（执行层优雅提示「视频开通中」，不崩溃）。"""
    if settings.fal_api_key and settings.provider_mode != "mock":
        from app.providers.fal_video import FalVideo

        return FalVideo(default_model=settings.video_model)
    if settings.video_api_base:
        from app.providers.openai_compat import Sub2ApiVideo

        return Sub2ApiVideo()
    return None
