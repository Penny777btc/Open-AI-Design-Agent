from app.config import settings
from app.providers.base import ImageProvider, LLMProvider


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
