"""
BM25-based re-ranking for pre-LLM chunk filtering.

Pluggable interface: swap in FlashRank or a cross-encoder later by
implementing the same ``rerank(query, chunks) -> sorted chunks`` API.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass
from typing import Protocol, Sequence

from app.rag.chunking import TextChunk


class Reranker(Protocol):
    """Pluggable reranker interface."""
    def rerank(self, query: str, chunks: list[TextChunk], top_k: int | None = None) -> list[TextChunk]: ...


def _tokenize(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())


@dataclass
class _BM25Index:
    """Lightweight BM25 index built per query session."""
    doc_freqs: Counter
    doc_lens: list[int]
    avg_dl: float
    tf_per_doc: list[Counter]
    n_docs: int


def _build_index(docs: list[list[str]]) -> _BM25Index:
    n = len(docs)
    doc_freqs: Counter = Counter()
    tf_per_doc: list[Counter] = []
    doc_lens: list[int] = []

    for tokens in docs:
        tf = Counter(tokens)
        tf_per_doc.append(tf)
        doc_lens.append(len(tokens))
        for term in tf:
            doc_freqs[term] += 1

    avg_dl = sum(doc_lens) / max(n, 1)
    return _BM25Index(
        doc_freqs=doc_freqs, doc_lens=doc_lens,
        avg_dl=avg_dl, tf_per_doc=tf_per_doc, n_docs=n,
    )


def _bm25_score(
    query_tokens: list[str], doc_idx: int, index: _BM25Index,
    k1: float = 1.5, b: float = 0.75,
) -> float:
    score = 0.0
    tf = index.tf_per_doc[doc_idx]
    dl = index.doc_lens[doc_idx]

    for term in query_tokens:
        df = index.doc_freqs.get(term, 0)
        if df == 0:
            continue
        idf = math.log((index.n_docs - df + 0.5) / (df + 0.5) + 1.0)
        term_tf = tf.get(term, 0)
        tf_norm = (term_tf * (k1 + 1)) / (term_tf + k1 * (1 - b + b * dl / index.avg_dl))
        score += idf * tf_norm

    return score


class BM25Reranker:
    """
    BM25 re-ranker that discards low-relevance chunks before
    they reach the embedding stage or the LLM prompt.
    """

    def __init__(self, k1: float = 1.5, b: float = 0.75, discard_ratio: float = 0.5):
        self.k1 = k1
        self.b = b
        self.discard_ratio = discard_ratio

    def rerank(
        self,
        query: str,
        chunks: list[TextChunk],
        top_k: int | None = None,
    ) -> list[TextChunk]:
        if not chunks:
            return []

        query_tokens = _tokenize(query)
        if not query_tokens:
            return chunks

        doc_tokens = [_tokenize(c.text) for c in chunks]
        index = _build_index(doc_tokens)

        scored = [
            (i, _bm25_score(query_tokens, i, index, self.k1, self.b))
            for i in range(len(chunks))
        ]
        scored.sort(key=lambda x: x[1], reverse=True)

        if top_k is not None:
            keep = top_k
        else:
            keep = max(1, int(len(chunks) * (1 - self.discard_ratio)))

        return [chunks[i] for i, _ in scored[:keep]]

    def score_chunks(
        self, query: str, chunks: list[TextChunk],
    ) -> list[tuple[TextChunk, float]]:
        """Return chunks with their BM25 scores (for debugging)."""
        if not chunks:
            return []

        query_tokens = _tokenize(query)
        doc_tokens = [_tokenize(c.text) for c in chunks]
        index = _build_index(doc_tokens)

        return [
            (chunks[i], _bm25_score(query_tokens, i, index, self.k1, self.b))
            for i in range(len(chunks))
        ]
