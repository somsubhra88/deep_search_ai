"""
Tests for semantic query cache: hit/miss, threshold, TTL.
"""

import os
import time
import tempfile
import pytest
import numpy as np

from app.rag.embeddings import HashEmbedder
from app.cache.semantic_cache import SemanticCache, CacheEntry


class TestSemanticCache:
    _counter = 0

    def _make_cache(self, threshold: float = 0.95, ttl: int = 3600) -> SemanticCache:
        TestSemanticCache._counter += 1
        db_path = os.path.join(
            tempfile.gettempdir(),
            f"test_cache_{TestSemanticCache._counter}_{os.getpid()}.db",
        )
        if os.path.exists(db_path):
            os.remove(db_path)
        cache = SemanticCache(
            embedder=HashEmbedder(dim=64),
            similarity_threshold=threshold,
            ttl_seconds=ttl,
            max_entries=50,
        )
        cache._sqlite_path = db_path
        cache._entries = []
        cache._init_sqlite()
        return cache

    def test_cache_miss(self):
        cache = self._make_cache()
        result = cache.get("what is climate change?", mode="standard", model_id="openai")
        assert result is None

    def test_cache_put_and_exact_hit(self):
        cache = self._make_cache(threshold=0.90)
        artifact = {"report": "Climate change report content"}
        cache.put("what is climate change?", "standard", "openai", artifact)

        hit = cache.get("what is climate change?", "standard", "openai")
        assert hit is not None
        assert hit["report"] == "Climate change report content"

    def test_cache_near_miss_different_topic(self):
        cache = self._make_cache(threshold=0.95)
        cache.put("climate change effects", "standard", "openai", {"data": "climate"})

        result = cache.get("quantum computing applications", "standard", "openai")
        assert result is None

    def test_cache_mode_mismatch(self):
        cache = self._make_cache(threshold=0.90)
        cache.put("test query", "standard", "openai", {"data": "test"})

        result = cache.get("test query", "debate", "openai")
        assert result is None

    def test_cache_model_mismatch(self):
        cache = self._make_cache(threshold=0.90)
        cache.put("test query", "standard", "openai", {"data": "test"})

        result = cache.get("test query", "standard", "anthropic")
        assert result is None

    def test_cache_ttl_expiry(self):
        cache = self._make_cache(threshold=0.90, ttl=1)
        cache.put("test", "standard", "openai", {"data": "old"})

        time.sleep(1.1)
        result = cache.get("test", "standard", "openai")
        assert result is None

    def test_cache_clear(self):
        cache = self._make_cache(threshold=0.90)
        cache.put("query1", "standard", "openai", {"data": "1"})
        cache.put("query2", "standard", "openai", {"data": "2"})
        assert cache.size == 2

        cache.clear()
        assert cache.size == 0

    def test_max_entries_limit(self):
        cache = SemanticCache(
            embedder=HashEmbedder(dim=32),
            similarity_threshold=0.95,
            max_entries=5,
        )
        for i in range(10):
            cache.put(f"query {i}", "standard", "openai", {"data": i})
        assert cache.size <= 5
