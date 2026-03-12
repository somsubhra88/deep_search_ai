"""
Semantic query cache — returns cached artifacts for near-duplicate queries.

Storage backends:
  1. Redis (if available)
  2. SQLite fallback (local file)

Cache key: cosine similarity of query embeddings.
Hit threshold: configurable (default 0.95).
TTL: configurable (default 24h).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np

from app.rag.embeddings import Embedder, get_embedder

logger = logging.getLogger(__name__)

DEFAULT_SIMILARITY_THRESHOLD = 0.95
DEFAULT_TTL_SECONDS = 86_400  # 24 hours
CACHE_DB_PATH = os.getenv("SEMANTIC_CACHE_DB", "/app/data/semantic_cache.db")


@dataclass
class CacheEntry:
    query: str
    mode: str
    model_id: str
    embedding: np.ndarray
    artifact: dict
    timestamp: float


class SemanticCache:
    """
    Semantic similarity cache for query results.

    Check before running expensive pipeline:
        hit = cache.get(query, mode, model_id)
        if hit:
            return hit  # skip pipeline
    """

    def __init__(
        self,
        embedder: Optional[Embedder] = None,
        similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
        ttl_seconds: int = DEFAULT_TTL_SECONDS,
        max_entries: int = 500,
    ):
        self._embedder = embedder or get_embedder()
        self._threshold = similarity_threshold
        self._ttl = ttl_seconds
        self._max_entries = max_entries
        self._redis = self._try_connect_redis()
        self._sqlite_path = CACHE_DB_PATH
        self._entries: list[CacheEntry] = []

        if not self._redis:
            self._init_sqlite()
            self._load_from_sqlite()

    def _try_connect_redis(self):
        """Try connecting to Redis; return client or None."""
        redis_url = os.getenv("REDIS_URL", "")
        if not redis_url:
            return None
        try:
            import redis
            client = redis.from_url(redis_url, decode_responses=False)
            client.ping()
            logger.info("Semantic cache: using Redis at %s", redis_url)
            return client
        except Exception as e:
            logger.info("Redis unavailable, using SQLite fallback: %s", e)
            return None

    def _init_sqlite(self) -> None:
        path = Path(self._sqlite_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(str(path)) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cache_entries (
                    id TEXT PRIMARY KEY,
                    query TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    artifact TEXT NOT NULL,
                    timestamp REAL NOT NULL
                )
            """)
            conn.commit()

    def _load_from_sqlite(self) -> None:
        try:
            with sqlite3.connect(self._sqlite_path) as conn:
                cutoff = time.time() - self._ttl
                rows = conn.execute(
                    "SELECT query, mode, model_id, embedding, artifact, timestamp "
                    "FROM cache_entries WHERE timestamp > ? ORDER BY timestamp DESC LIMIT ?",
                    (cutoff, self._max_entries),
                ).fetchall()

            for query, mode, model_id, emb_bytes, art_json, ts in rows:
                self._entries.append(CacheEntry(
                    query=query, mode=mode, model_id=model_id,
                    embedding=np.frombuffer(emb_bytes, dtype=np.float32),
                    artifact=json.loads(art_json), timestamp=ts,
                ))
        except Exception as e:
            logger.warning("Failed to load SQLite cache: %s", e)

    def _normalize_embedding(self, emb: np.ndarray) -> np.ndarray:
        """Normalize embedding vector."""
        norm = np.linalg.norm(emb)
        return emb / norm if norm > 0 else emb

    def get(
        self,
        query: str,
        mode: str = "standard",
        model_id: str = "openai",
    ) -> Optional[dict]:
        """Check cache for a semantically similar query. Returns artifact or None."""
        q_emb = self._normalize_embedding(self._embedder.embed_one(query))
        cutoff = time.time() - self._ttl
        best_score = self._threshold
        best_entry: Optional[CacheEntry] = None

        for entry in self._entries:
            if entry.timestamp < cutoff or entry.mode != mode or entry.model_id != model_id:
                continue

            sim = float(np.dot(q_emb, self._normalize_embedding(entry.embedding)))
            if sim > best_score:
                best_score = sim
                best_entry = entry
                # Early exit if we find a perfect match
                if sim >= 0.99:
                    break

        if best_entry:
            logger.info(
                "Semantic cache HIT (sim=%.3f) for query: %s",
                best_score, query[:50],
            )
            return best_entry.artifact

        return None

    def put(
        self,
        query: str,
        mode: str,
        model_id: str,
        artifact: dict,
    ) -> None:
        """Store a query result in the cache."""
        entry = CacheEntry(
            query=query, mode=mode, model_id=model_id,
            embedding=self._normalize_embedding(self._embedder.embed_one(query)),
            artifact=artifact, timestamp=time.time(),
        )
        self._entries.append(entry)

        if len(self._entries) > self._max_entries:
            self._entries = self._entries[-self._max_entries:]

        if self._redis:
            self._store_redis(entry)
        else:
            self._store_sqlite(entry)

    def _store_redis(self, entry: CacheEntry) -> None:
        try:
            key = f"semcache:{hashlib.sha256(entry.query.encode()).hexdigest()[:16]}:{entry.mode}"
            data = {
                "query": entry.query,
                "mode": entry.mode,
                "model_id": entry.model_id,
                "embedding": entry.embedding.tobytes(),
                "artifact": json.dumps(entry.artifact),
                "timestamp": str(entry.timestamp),
            }
            self._redis.hset(key, mapping=data)
            self._redis.expire(key, self._ttl)
        except Exception as e:
            logger.warning("Redis cache store failed: %s", e)

    def _store_sqlite(self, entry: CacheEntry) -> None:
        try:
            entry_id = hashlib.sha256(
                f"{entry.query}:{entry.mode}:{entry.model_id}".encode()
            ).hexdigest()[:16]

            with sqlite3.connect(self._sqlite_path) as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO cache_entries "
                    "(id, query, mode, model_id, embedding, artifact, timestamp) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        entry_id, entry.query, entry.mode, entry.model_id,
                        entry.embedding.tobytes(),
                        json.dumps(entry.artifact),
                        entry.timestamp,
                    ),
                )
                conn.execute(
                    "DELETE FROM cache_entries WHERE timestamp < ?",
                    (time.time() - self._ttl,),
                )
                conn.commit()
        except Exception as e:
            logger.warning("SQLite cache store failed: %s", e)

    def clear(self) -> None:
        """Clear all cache entries."""
        self._entries.clear()
        if self._redis:
            try:
                keys = self._redis.keys("semcache:*")
                if keys:
                    self._redis.delete(*keys)
            except Exception:
                pass
        else:
            try:
                with sqlite3.connect(self._sqlite_path) as conn:
                    conn.execute("DELETE FROM cache_entries")
                    conn.commit()
            except Exception:
                pass

    @property
    def size(self) -> int:
        return len(self._entries)
