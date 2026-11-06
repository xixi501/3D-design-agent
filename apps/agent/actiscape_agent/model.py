import json
from typing import Any, Sequence

from langchain_core.messages import AIMessage, ToolMessage
from langchain_deepseek import ChatDeepSeek

from .config import model_settings


class ActiDeepSeek(ChatDeepSeek):
    """Preserve automatic thinking-mode tools and genuine image blocks in tool replies."""

    def bind_tools(self, tools: Sequence[Any], *, tool_choice: Any = None, **kwargs: Any):
        return super().bind_tools(tools, tool_choice="auto", **kwargs)

    def _get_request_payload(self, input_: Any, *, stop=None, **kwargs: Any):
        payload = super()._get_request_payload(input_, stop=stop, **kwargs)
        # langchain-deepseek 1.1.1 serializes every tool content array as JSON text.
        # The official Chat Completions API now accepts actual image parts in tool
        # replies. Restore only genuine ToolMessage image arrays, leaving text tools
        # and all parent-generated reasoning/tool-call protocol fields unchanged.
        messages = self._convert_input(input_).to_messages()
        # The generic OpenAI serializer also omits this DeepSeek-specific field.
        for original, wire in zip(messages, payload["messages"]):
            if (
                isinstance(original, AIMessage)
                and "reasoning_content" in original.additional_kwargs
            ):
                wire["reasoning_content"] = original.additional_kwargs["reasoning_content"]
            if (
                isinstance(original, ToolMessage)
                and isinstance(original.content, list)
                and isinstance(wire.get("content"), str)
            ):
                try:
                    content = json.loads(wire["content"])
                except ValueError:
                    continue
                if isinstance(content, list) and any(
                    isinstance(part, dict) and part.get("type") == "image_url" for part in content
                ):
                    wire["content"] = content
        return payload


def create_model() -> ActiDeepSeek:
    return ActiDeepSeek(**model_settings())
