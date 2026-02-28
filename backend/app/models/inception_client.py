from __future__ import annotations

from typing import Literal, Optional

import httpx
from pydantic import BaseModel, HttpUrl, SecretStr


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
    """Minimal client for Inception Labs mercury-2."""

    def __init__(self, config: InceptionConfig, client: Optional[httpx.AsyncClient] = None):
        self.config = config
        self._client = client

    @staticmethod
    def _serialize_messages(messages: list[ChatMessage]) -> list[dict]:
        return [{"role": m.role, "content": m.content} for m in messages]

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

        headers = {
            "Authorization": f"Bearer {self.config.api_key.get_secret_value()}",
            "Content-Type": "application/json",
        }

        client = self._client or httpx.AsyncClient(timeout=self.config.timeout_seconds)
        close_client = self._client is None
        try:
            resp = await client.post(
                f"{self.config.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
            choices = data.get("choices") or []
            content = ""
            if choices:
                message = choices[0].get("message") or {}
                content = message.get("content") or ""
            return ChatCompletionResult(
                content=content,
                model=data.get("model", model),
                raw=data,
            )
        finally:
            if close_client:
                await client.aclose()
