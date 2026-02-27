"""
Tests for ephemeral RAG: chunking, embeddings, vector store retrieval.
"""

import pytest
import numpy as np

from app.rag.chunking import chunk_text, TextChunk, _remove_boilerplate
from app.rag.embeddings import HashEmbedder, Embedder
from app.rag.ephemeral_store import InMemoryVectorStore


class TestChunking:
    def test_basic_chunking(self):
        text = "This is sentence one. This is sentence two. This is sentence three. " * 20
        chunks = chunk_text(text, chunk_size=200, overlap=40)
        assert len(chunks) > 1
        assert all(isinstance(c, TextChunk) for c in chunks)

    def test_short_text_single_chunk(self):
        text = "Short text that fits in one chunk."
        chunks = chunk_text(text, chunk_size=600)
        assert len(chunks) == 1
        assert chunks[0].text == text

    def test_empty_text(self):
        assert chunk_text("") == []
        assert chunk_text("   ") == []

    def test_boilerplate_removal(self):
        text = (
            "Accept all cookies\n"
            "Privacy Policy\n"
            "This is the actual content of the article about climate change.\n"
            "Subscribe to our newsletter\n"
            "© 2025 All rights reserved"
        )
        cleaned = _remove_boilerplate(text)
        assert "Accept all cookies" not in cleaned
        assert "Privacy Policy" not in cleaned
        assert "climate change" in cleaned

    def test_chunk_overlap(self):
        text = "A" * 300 + ". " + "B" * 300 + ". " + "C" * 300
        chunks = chunk_text(text, chunk_size=350, overlap=50)
        assert len(chunks) >= 2

    def test_source_url_preserved(self):
        text = "Some content here. " * 30
        chunks = chunk_text(text, chunk_size=200, source_url="https://example.com")
        assert all(c.source_url == "https://example.com" for c in chunks)

    def test_max_chunk_size_enforced(self):
        text = "word " * 1000
        chunks = chunk_text(text, chunk_size=2000)
        for c in chunks:
            assert len(c.text) <= 1200 + 50  # MAX_CHUNK_SIZE + some slack for sentence boundary


class TestHashEmbedder:
    def test_embedding_shape(self):
        embedder = HashEmbedder(dim=128)
        vecs = embedder.embed(["hello world", "foo bar"])
        assert vecs.shape == (2, 128)

    def test_embedding_normalized(self):
        embedder = HashEmbedder(dim=128)
        vecs = embedder.embed(["test text"])
        norm = np.linalg.norm(vecs[0])
        assert abs(norm - 1.0) < 1e-5

    def test_same_text_same_embedding(self):
        embedder = HashEmbedder(dim=128)
        v1 = embedder.embed(["identical text"])[0]
        v2 = embedder.embed(["identical text"])[0]
        assert np.allclose(v1, v2)

    def test_different_text_different_embedding(self):
        embedder = HashEmbedder(dim=128)
        v1 = embedder.embed(["climate change"])[0]
        v2 = embedder.embed(["quantum computing"])[0]
        sim = float(np.dot(v1, v2))
        assert sim < 0.95  # different texts should not be nearly identical

    def test_embed_one(self):
        embedder = HashEmbedder(dim=64)
        v = embedder.embed_one("single text")
        assert v.shape == (64,)


class TestInMemoryVectorStore:
    def _make_store(self) -> InMemoryVectorStore:
        return InMemoryVectorStore(embedder=HashEmbedder(dim=64))

    def test_add_and_query(self):
        store = self._make_store()
        chunks = chunk_text(
            "Climate change is a major global challenge. "
            "Renewable energy sources include solar and wind power. "
            "Carbon emissions continue to rise worldwide.",
            chunk_size=80,
            source_url="https://example.com",
        )
        added = store.add_chunks(chunks)
        assert added > 0
        assert store.size == added

        results = store.query("renewable energy", top_k=2)
        assert len(results) > 0
        assert all(isinstance(r, TextChunk) for r in results)

    def test_empty_store_query(self):
        store = self._make_store()
        results = store.query("anything")
        assert results == []

    def test_max_chunks_enforced(self):
        store = InMemoryVectorStore(embedder=HashEmbedder(dim=32), max_chunks=5)
        chunks = [TextChunk(text=f"chunk {i}", index=i, start_char=0, end_char=10) for i in range(10)]
        added = store.add_chunks(chunks)
        assert added == 5
        assert store.size == 5
        more_added = store.add_chunks(chunks)
        assert more_added == 0

    def test_char_budget_respected(self):
        store = self._make_store()
        chunks = [
            TextChunk(text="x" * 500, index=i, start_char=0, end_char=500)
            for i in range(10)
        ]
        store.add_chunks(chunks)
        results = store.query("test", top_k=10, max_total_chars=1200)
        total_chars = sum(len(r.text) for r in results)
        assert total_chars <= 1200

    def test_query_with_scores(self):
        store = self._make_store()
        chunks = chunk_text(
            "Python is a programming language. JavaScript is used for web development.",
            chunk_size=50,
        )
        store.add_chunks(chunks)
        results = store.query_with_scores("programming language", top_k=3)
        assert all(isinstance(r, tuple) and len(r) == 2 for r in results)

    def test_clear(self):
        store = self._make_store()
        chunks = [TextChunk(text="data", index=0, start_char=0, end_char=4)]
        store.add_chunks(chunks)
        assert store.size == 1
        store.clear()
        assert store.size == 0
