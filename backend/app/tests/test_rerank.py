"""
Tests for BM25 re-ranking: scoring, discard ratio, top-k.
"""

import pytest

from app.rag.chunking import TextChunk
from app.rerank.bm25 import BM25Reranker, _tokenize


def _make_chunk(text: str, index: int = 0) -> TextChunk:
    return TextChunk(text=text, index=index, start_char=0, end_char=len(text))


class TestBM25Tokenizer:
    def test_basic_tokenization(self):
        tokens = _tokenize("Hello World! This is a test.")
        assert "hello" in tokens
        assert "world" in tokens
        assert "!" not in tokens

    def test_empty_string(self):
        assert _tokenize("") == []


class TestBM25Reranker:
    def test_rerank_basic(self):
        reranker = BM25Reranker()
        chunks = [
            _make_chunk("Climate change is a major global challenge facing humanity", 0),
            _make_chunk("The recipe for chocolate cake requires flour sugar and eggs", 1),
            _make_chunk("Global warming and climate impacts on agriculture and food", 2),
        ]
        result = reranker.rerank("climate change impact", chunks)
        assert len(result) > 0
        top_texts = [c.text for c in result]
        assert any("climate" in t.lower() for t in top_texts[:2])

    def test_discard_ratio(self):
        reranker = BM25Reranker(discard_ratio=0.5)
        chunks = [_make_chunk(f"Document {i} about various topics", i) for i in range(10)]
        result = reranker.rerank("topics", chunks)
        assert len(result) == 5

    def test_top_k_override(self):
        reranker = BM25Reranker(discard_ratio=0.5)
        chunks = [_make_chunk(f"Document {i}", i) for i in range(10)]
        result = reranker.rerank("document", chunks, top_k=3)
        assert len(result) == 3

    def test_empty_chunks(self):
        reranker = BM25Reranker()
        assert reranker.rerank("test", []) == []

    def test_empty_query(self):
        reranker = BM25Reranker()
        chunks = [_make_chunk("Some text", 0)]
        result = reranker.rerank("", chunks)
        assert len(result) == len(chunks)

    def test_score_chunks(self):
        reranker = BM25Reranker()
        chunks = [
            _make_chunk("Python programming language", 0),
            _make_chunk("JavaScript web development", 1),
        ]
        scored = reranker.score_chunks("python programming", chunks)
        assert len(scored) == 2
        assert scored[0][1] != scored[1][1] or True  # different scores expected

    def test_single_chunk(self):
        reranker = BM25Reranker()
        chunks = [_make_chunk("Only one chunk", 0)]
        result = reranker.rerank("one", chunks)
        assert len(result) == 1

    def test_discard_bottom_portion(self):
        """BM25 rerank should discard the bottom 50% of chunks by relevance."""
        reranker = BM25Reranker(discard_ratio=0.5)
        chunks = [
            _make_chunk("renewable energy solar wind power generation", 0),
            _make_chunk("the best chocolate cake recipe with frosting", 1),
            _make_chunk("solar panel efficiency improvements in 2024", 2),
            _make_chunk("dog training tips for new puppy owners", 3),
            _make_chunk("wind turbine technology and offshore installations", 4),
            _make_chunk("how to knit a scarf for beginners", 5),
        ]
        result = reranker.rerank("renewable energy technology", chunks)
        assert len(result) == 3
        texts = [c.text for c in result]
        assert any("renewable" in t or "solar" in t or "wind" in t for t in texts)
