from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from actiscape_agent.model import ActiDeepSeek


def test_tool_images_remain_image_parts_and_thinking_protocol_is_preserved():
    model = ActiDeepSeek(api_key="test-only-not-a-credential", model="deepseek-flash")
    images = [
        {"type": "text", "text": "real crop"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}},
    ]
    messages = [
        HumanMessage("inspect crop"),
        AIMessage(
            "",
            tool_calls=[{"id": "crop1", "name": "crop", "args": {}}],
            additional_kwargs={"reasoning_content": "keep this reasoning field"},
        ),
        ToolMessage(images, tool_call_id="crop1"),
    ]
    wire = model._get_request_payload(messages)
    assert isinstance(wire["messages"][2]["content"], list)
    assert wire["messages"][2]["content"][1]["type"] == "image_url"
    assert wire["messages"][1]["reasoning_content"] == "keep this reasoning field"
    assert wire["messages"][2]["tool_call_id"] == "crop1"
    text = ToolMessage(
        '[{"type":"image_url","image_url":{"url":"https://example.invalid"}}]', tool_call_id="text1"
    )
    assert isinstance(
        model._get_request_payload([HumanMessage("read text"), text])["messages"][1]["content"], str
    )
