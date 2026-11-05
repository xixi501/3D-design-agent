from typing import Any, Sequence
from langchain_deepseek import ChatDeepSeek
from .config import model_settings

class ActiDeepSeek(ChatDeepSeek):
    """DeepSeek thinking accepts automatic tool selection, not forced schema-tool calls."""
    def bind_tools(self, tools: Sequence[Any], *, tool_choice: Any = None, **kwargs: Any):
        return super().bind_tools(tools, tool_choice="auto", **kwargs)

def create_model() -> ActiDeepSeek:
    return ActiDeepSeek(**model_settings())
