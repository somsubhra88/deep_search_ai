"""
Embedding abstraction with remote (OpenAI) and local fallback strategies.

Priority:
  1. OpenAI text-embedding-3-small (if API key available)
  2. Deterministic hash-based fallback (zero-dependency, works offline)

The hash fallback produces *structurally valid* vectors that preserve
simple term-overlap similarity — enough for an MVP before real embeddings.
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

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        if not self._api_key:
            raise ValueError("OPENAI_API_KEY required for OpenAIEmbedder")
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
                json={"model": self.MODEL, "input": batch},
                timeout=30.0,
                verify=ssl_verify,
            )
            resp.raise_for_status()
            data = resp.json()
            batch_vecs = [item["embedding"] for item in sorted(data["data"], key=lambda x: x["index"])]
            all_vecs.extend(batch_vecs)

        return np.array(all_vecs, dtype=np.float32)


def get_embedder() -> Embedder:
    """Return the best available embedder.

    Uses OpenAI when OPENAI_API_KEY is set and valid; otherwise uses the
    hash-based fallback (no API key needed, works offline). If the key
    is set but invalid (e.g. 401), falls back to HashEmbedder so indexing
    does not fail.
    """
    api_key = os.getenv("OPENAI_API_KEY", "")
    if api_key:
        try:
            embedder = OpenAIEmbedder(api_key)
            # Validate key with a minimal request; invalid/expired key causes 401
            embedder.embed(["test"])
            logger.info("Using OpenAI embedder (text-embedding-3-small)")
            return embedder
        except Exception as e:
            logger.warning(
                "OpenAI embedder unavailable (invalid key or network), falling back to hash: %s",
                e,
            )

    logger.info("Using hash-based fallback embedder (no API key required)")
    return HashEmbedder()
