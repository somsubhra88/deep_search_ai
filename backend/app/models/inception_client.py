from __future__ import annotations

from typing import Literal, Optional, Any

from pydantic import BaseModel, HttpUrl, SecretStr
from openai import AsyncOpenAI


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatCompletionResult(BaseModel):
    content: str
    model: str
    raw: dict


class InceptionConfig(BaseModel):
    provider: Literal["inception"] = "inception"
    api_key: SecretStr
    base_url: HttpUrl = "https://api.inceptionlabs.ai/v1"
    timeout_seconds: int = 60


class InceptionLLMClient:
    """Minimal client for Inception Labs mercury-2 (OpenAI-compatible SDK)."""

    def __init__(self, config: InceptionConfig, client: Optional[AsyncOpenAI] = None):
        self.config = config
        # Inception exposes an OpenAI-compatible API; use OpenAI SDK with base_url override.
        self._client = client or AsyncOpenAI(
            api_key=self.config.api_key.get_secret_value(),
            base_url=str(self.config.base_url),
            timeout=self.config.timeout_seconds,
        )

    @staticmethod
    def _serialize_messages(messages: list[ChatMessage]) -> list[dict]:
        return [{"role": m.role, "content": m.content} for m in messages]

    @staticmethod
    def _to_raw_dict(obj: Any) -> dict:
        # Newer OpenAI SDK responses support `model_dump()` (pydantic v2).
        if hasattr(obj, "model_dump"):
            return obj.model_dump()
        # Fallbacks for older SDK shapes.
        if hasattr(obj, "to_dict_recursive"):
            return obj.to_dict_recursive()
        if hasattr(obj, "dict"):
            return obj.dict()
        return {"response": str(obj)}

    async def chat_completion(
        self,
        messages: list[ChatMessage],
        model: str = "mercury-2",
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> ChatCompletionResult:
        payload: dict = {
            "model": model,
            "messages": self._serialize_messages(messages),
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        resp = await self._client.chat.completions.create(**payload)

        content = ""
        if getattr(resp, "choices", None):
            msg = getattr(resp.choices[0], "message", None)
            if msg is not None:
                content = getattr(msg, "content", "") or ""

        raw = self._to_raw_dict(resp)
        # The response may or may not echo the model name; keep a safe default.
        resolved_model = raw.get("model", model) if isinstance(raw, dict) else model

        return ChatCompletionResult(
            content=content,
            model=resolved_model,
            raw=raw if isinstance(raw, dict) else {"raw": raw},
        )
