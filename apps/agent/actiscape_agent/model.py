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


def create_model(**overrides: Any) -> ActiDeepSeek:
    settings = model_settings()
    # MODEL_URL/MODEL_API_KEY are the AgentArts standard names. Passing the
    # resolved key explicitly avoids relying on ChatDeepSeek's DEEPSEEK_* env
    # lookup when only MODEL_API_KEY is present.
    if "api_key" not in overrides and not settings.get("api_key"):
        settings.pop("api_key", None)
    merged = {**settings, **overrides}
    merged.pop("provider", None)
    if "deepseek.com" not in str(merged.get("base_url", "")).lower():
        eb = dict(merged.get("extra_body") or {})
        thinking_cfg = eb.pop("thinking", None)
        if isinstance(thinking_cfg, dict) and thinking_cfg.get("type") == "disabled":
            eb["enable_thinking"] = False
        if "qwen" in str(merged.get("model", "")).lower() and "enable_thinking" not in eb:
            eb["enable_thinking"] = False
        merged["extra_body"] = eb
    return ActiDeepSeek(**merged)
