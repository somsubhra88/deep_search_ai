import json
from typing import Optional

import pytest
import httpx

from app.models.inception_client import InceptionLLMClient, InceptionConfig, ChatMessage
from app.models.router import ModelRouter, ModelCascadeConfig, TaskTier


@pytest.mark.asyncio
async def test_chat_completion_success():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode())
        assert payload["model"] == "mercury-2"
        assert isinstance(payload["messages"], list)
        return httpx.Response(
            200,
            json={"model": "mercury-2", "choices": [{"message": {"content": "pong"}}]},
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as async_client:
        cfg = InceptionConfig(provider="inception", api_key="sk-test", base_url="https://api.inceptionlabs.ai/v1")
        client = InceptionLLMClient(cfg, client=async_client)
        result = await client.chat_completion([ChatMessage(role="user", content="ping")])
        assert result.content == "pong"
        assert result.model == "mercury-2"


@pytest.mark.asyncio
async def test_invalid_api_key_raises():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "unauthorized"})

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as async_client:
        cfg = InceptionConfig(provider="inception", api_key="bad-key", base_url="https://api.inceptionlabs.ai/v1")
        client = InceptionLLMClient(cfg, client=async_client)
        with pytest.raises(httpx.HTTPStatusError):
            await client.chat_completion([ChatMessage(role="user", content="test")])


def test_router_prefers_inception_for_medium_tasks():
    cascade = ModelCascadeConfig(medium_model_id="inception", medium_model_name="mercury-2")

    calls = []

    def fake_get_llm(model_id: str, model_name: Optional[str] = None):
        calls.append((model_id, model_name))
        return f"{model_id}:{model_name}"

    router = ModelRouter(
        main_llm="main",
        main_model_id="openai",
        main_model_name="gpt-4o",
        cascade_config=cascade,
        get_llm_fn=fake_get_llm,
    )

    # Debate and map-reduce map stage should use medium tier (mercury-2)
    router.get_llm("debate_dialogue")
    router.get_llm("map_summarization")

    assert ("inception", "mercury-2") in calls
    assert router.get_tier("debate_dialogue") == TaskTier.MEDIUM
    assert router.get_tier("map_summarization") == TaskTier.MEDIUM
