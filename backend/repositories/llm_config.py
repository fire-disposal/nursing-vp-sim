from models import LLMConfig
from repositories.base import Repository


class LLMConfigRepository(Repository[LLMConfig]):
    model = LLMConfig
