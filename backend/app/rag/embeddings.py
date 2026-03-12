"""
Embedding abstraction with multiple provider support.

Supported providers:
  1. OpenAI text-embedding-3-small
  2. OpenRouter (via OpenAI-compatible API)
  3. Ollama (local embeddings)
  4. Hash-based fallback (zero-dependency, works offline)

Provider selection priority:
  1. User-configured provider (from setup/env)
  2. OpenAI (if API key available)
  3. Hash-based fallback
"""

from __future__ import annotations

import hashlib
import logging
import os
from abc import ABC, abstractmethod
from typing import Sequence

import numpy as np

logger = logging.getLogger(__name__)

EMBEDDING_DIM = 256
EMBEDDING_PROVIDERS = {
    "openai": {
        "label": "OpenAI Embeddings",
        "model": "text-embedding-3-small",
        "dim": 1536,
        "requires_key": True,
    },
    "openrouter": {
        "label": "OpenRouter Embeddings",
        "model": "text-embedding-3-small",
        "dim": 1536,
        "requires_key": True,
    },
    "ollama": {
        "label": "Ollama Local Embeddings",
        "model": "nomic-embed-text",
        "dim": 768,
        "requires_key": False,
    },
    "hash": {
        "label": "Hash-based Fallback (Offline)",
        "model": "hash",
        "dim": 256,
        "requires_key": False,
    },
}


class Embedder(ABC):
    """Base class for all embedding strategies."""

    @property
    @abstractmethod
    def dim(self) -> int: ...

    @abstractmethod
    def embed(self, texts: list[str]) -> np.ndarray:
        """Return (N, dim) float32 array."""
        ...

    def embed_one(self, text: str) -> np.ndarray:
        return self.embed([text])[0]


class HashEmbedder(Embedder):
    """
    Deterministic hash-based pseudo-embeddings.

    NOT semantically meaningful — only preserves token overlap via hashing.
    Good enough as a fallback for development and testing.
    """

    def __init__(self, dim: int = EMBEDDING_DIM):
        self._dim = dim

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, texts: list[str]) -> np.ndarray:
        vecs = np.zeros((len(texts), self._dim), dtype=np.float32)
        for i, text in enumerate(texts):
            tokens = text.lower().split()
            for token in tokens:
                h = int(hashlib.md5(token.encode()).hexdigest(), 16)
                idx = h % self._dim
                sign = 1.0 if (h >> 128) % 2 == 0 else -1.0
                vecs[i, idx] += sign
            norm = np.linalg.norm(vecs[i])
            if norm > 0:
                vecs[i] /= norm
        return vecs


class OpenAIEmbedder(Embedder):
    """OpenAI text-embedding-3-small via the REST API."""

    MODEL = "text-embedding-3-small"
    BATCH_SIZE = 64

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self._api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        if not self._api_key:
            raise ValueError("OPENAI_API_KEY required for OpenAIEmbedder")
        self._model = model or self.MODEL
        self._dim = 1536

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, texts: list[str]) -> np.ndarray:
        import httpx

        ssl_verify = os.getenv("SSL_VERIFY", "true").lower() not in ("0", "false", "no")
        all_vecs: list[list[float]] = []

        for start in range(0, len(texts), self.BATCH_SIZE):
            batch = texts[start : start + self.BATCH_SIZE]
            resp = httpx.post(
                "https://api.openai.com/v1/embeddings",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"model": self._model, "input": batch},
                timeout=30.0,
                verify=ssl_verify,
            )
            resp.raise_for_status()
            data = resp.json()
            batch_vecs = [item["embedding"] for item in sorted(data["data"], key=lambda x: x["index"])]
            all_vecs.extend(batch_vecs)

        return np.array(all_vecs, dtype=np.float32)


class OpenRouterEmbedder(Embedder):
    """OpenRouter embeddings via OpenAI-compatible API."""

    MODEL = "text-embedding-3-small"
    BATCH_SIZE = 64

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self._api_key = api_key or os.getenv("OPENROUTER_API_KEY", "")
        if not self._api_key:
            raise ValueError("OPENROUTER_API_KEY required for OpenRouterEmbedder")
        self._model = model or self.MODEL
        self._dim = 1536

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, texts: list[str]) -> np.ndarray:
        import httpx

        ssl_verify = os.getenv("SSL_VERIFY", "true").lower() not in ("0", "false", "no")
        all_vecs: list[list[float]] = []

        for start in range(0, len(texts), self.BATCH_SIZE):
            batch = texts[start : start + self.BATCH_SIZE]
            resp = httpx.post(
                "https://openrouter.ai/api/v1/embeddings",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"model": self._model, "input": batch},
                timeout=30.0,
                verify=ssl_verify,
            )
            resp.raise_for_status()
            data = resp.json()
            batch_vecs = [item["embedding"] for item in sorted(data["data"], key=lambda x: x["index"])]
            all_vecs.extend(batch_vecs)

        return np.array(all_vecs, dtype=np.float32)


class OllamaEmbedder(Embedder):
    """Ollama local embeddings."""

    MODEL = "nomic-embed-text"

    def __init__(self, model: str | None = None, base_url: str | None = None):
        self._model = model or self.MODEL
        base = base_url or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self._base_url = base.rstrip("/v1").rstrip("/")
        self._dim = 768  # Default for nomic-embed-text

    @property
    def dim(self) -> int:
        return self._dim

    def embed(self, texts: list[str]) -> np.ndarray:
        import httpx

        ssl_verify = os.getenv("SSL_VERIFY", "true").lower() not in ("0", "false", "no")
        all_vecs: list[list[float]] = []

        for text in texts:
            resp = httpx.post(
                f"{self._base_url}/api/embeddings",
                json={"model": self._model, "prompt": text},
                timeout=30.0,
                verify=ssl_verify,
            )
            resp.raise_for_status()
            data = resp.json()
            all_vecs.append(data["embedding"])

        return np.array(all_vecs, dtype=np.float32)


def get_embedder(
    provider: str | None = None,
    api_key: str | None = None,
    model: str | None = None,
) -> Embedder:
    """
    Return an embedder based on provider configuration.

    Priority:
      1. Explicitly specified provider
      2. EMBEDDING_PROVIDER env var
      3. OpenAI if key available
      4. Hash-based fallback

    Args:
        provider: One of "openai", "openrouter", "ollama", "hash", or None for auto
        api_key: Optional API key override (uses env var if not provided)
        model: Optional model override
    """
    # Determine provider
    if not provider:
        provider = os.getenv("EMBEDDING_PROVIDER", "").lower()

    if not provider or provider == "auto":
        # Auto-detect: try OpenAI first, fallback to hash
        openai_key = api_key or os.getenv("OPENAI_API_KEY", "")
        if openai_key:
            provider = "openai"
        else:
            provider = "hash"

    # Validate provider
    if provider not in EMBEDDING_PROVIDERS:
        logger.warning("Unknown embedding provider '%s', falling back to hash", provider)
        provider = "hash"

    # Create embedder based on provider
    try:
        if provider == "openai":
            key = api_key or os.getenv("OPENAI_API_KEY", "")
            if not key:
                raise ValueError("OPENAI_API_KEY not set")
            embedder = OpenAIEmbedder(api_key=key, model=model)
            # Validate with test request
            embedder.embed(["test"])
            logger.info("Using OpenAI embedder (model=%s, dim=%d)",
                       embedder._model, embedder.dim)
            return embedder

        elif provider == "openrouter":
            key = api_key or os.getenv("OPENROUTER_API_KEY", "")
            if not key:
                raise ValueError("OPENROUTER_API_KEY not set")
            embedder = OpenRouterEmbedder(api_key=key, model=model)
            embedder.embed(["test"])
            logger.info("Using OpenRouter embedder (model=%s, dim=%d)",
                       embedder._model, embedder.dim)
            return embedder

        elif provider == "ollama":
            base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            embedder = OllamaEmbedder(model=model, base_url=base_url)
            embedder.embed(["test"])
            logger.info("Using Ollama embedder (model=%s, dim=%d)",
                       embedder._model, embedder.dim)
            return embedder

        elif provider == "hash":
            logger.info("Using hash-based fallback embedder (dim=%d)", EMBEDDING_DIM)
            return HashEmbedder()

    except Exception as e:
        logger.warning(
            "Embedder '%s' unavailable (error: %s), falling back to hash",
            provider, e
        )

    logger.info("Using hash-based fallback embedder (no API key required)")
    return HashEmbedder()
