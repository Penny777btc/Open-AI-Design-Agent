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


def get_video_provider() -> VideoProvider | None:
    """视频生成 provider。未配置视频接口（供应商加白后给的 endpoint）时返回 None，
    执行层据此优雅提示「视频开通中」而不是崩溃——与 Stripe 未配置时的处理一致。"""
    if settings.video_api_base:
        from app.providers.openai_compat import Sub2ApiVideo

        return Sub2ApiVideo()
    return None
