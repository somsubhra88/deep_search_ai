"""
Ephemeral in-memory vector store — one instance per request/session.

Stores chunked text with embeddings and supports top-k retrieval
via cosine similarity. Destroyed when the request ends.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

from app.rag.chunking import TextChunk
from app.rag.embeddings import Embedder, get_embedder

logger = logging.getLogger(__name__)


@dataclass
class StoredChunk:
    chunk: TextChunk
    embedding: np.ndarray


class InMemoryVectorStore:
    """
    Per-request vector store.

    Usage:
        store = InMemoryVectorStore(embedder)
        store.add_chunks(chunks)
        top = store.query("some question", top_k=6)
    """

    def __init__(self, embedder: Embedder | None = None, max_chunks: int = 500):
        self._embedder = embedder or get_embedder()
        self._entries: list[StoredChunk] = []
        self._matrix: np.ndarray | None = None
        self._dirty = True
        self._max_chunks = max_chunks

    @property
    def size(self) -> int:
        return len(self._entries)

    @property
    def embedder(self) -> Embedder:
        return self._embedder

    def add_chunks(self, chunks: list[TextChunk]) -> int:
        """Embed and store chunks. Returns number actually stored."""
        if not chunks:
            return 0

        remaining = self._max_chunks - len(self._entries)
        if remaining <= 0:
            logger.warning("Ephemeral store full (%d chunks), skipping", self._max_chunks)
            return 0

        to_add = chunks[:remaining]
        texts = [c.text for c in to_add]
        embeddings = self._embedder.embed(texts)

        for chunk, emb in zip(to_add, embeddings):
            self._entries.append(StoredChunk(chunk=chunk, embedding=emb))

        self._dirty = True
        return len(to_add)

    def _rebuild_matrix(self) -> None:
        if not self._entries:
            self._matrix = None
            return
        self._matrix = np.stack([e.embedding for e in self._entries])
        norms = np.linalg.norm(self._matrix, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1, norms)
        self._matrix = self._matrix / norms
        self._dirty = False

    def query(
        self,
        query_text: str,
        top_k: int = 6,
        max_total_chars: int = 4_000,
    ) -> list[TextChunk]:
        """
        Retrieve top-k chunks by cosine similarity, respecting char budget.
        """
        if not self._entries:
            return []

        if self._dirty:
            self._rebuild_matrix()

        q_emb = self._embedder.embed_one(query_text)
        q_norm = np.linalg.norm(q_emb)
        if q_norm > 0:
            q_emb = q_emb / q_norm

        scores = self._matrix @ q_emb
        top_indices = np.argsort(scores)[::-1][:top_k * 2]

        results: list[TextChunk] = []
        total_chars = 0
        for idx in top_indices:
            if len(results) >= top_k:
                break
            chunk = self._entries[int(idx)].chunk
            if total_chars + len(chunk.text) > max_total_chars:
                continue
            results.append(chunk)
            total_chars += len(chunk.text)

        return results

    def query_with_scores(
        self, query_text: str, top_k: int = 10,
    ) -> list[tuple[TextChunk, float]]:
        """Return chunks with similarity scores (for debugging)."""
        if not self._entries:
            return []

        if self._dirty:
            self._rebuild_matrix()

        q_emb = self._embedder.embed_one(query_text)
        q_norm = np.linalg.norm(q_emb)
        if q_norm > 0:
            q_emb = q_emb / q_norm

        scores = self._matrix @ q_emb
        top_indices = np.argsort(scores)[::-1][:top_k]

        return [
            (self._entries[int(i)].chunk, float(scores[i]))
            for i in top_indices
        ]

    def clear(self) -> None:
        self._entries.clear()
        self._matrix = None
        self._dirty = True
