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
        conn = sqlite3.connect(str(path))
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
        conn.close()

    def _load_from_sqlite(self) -> None:
        try:
            conn = sqlite3.connect(self._sqlite_path)
            cutoff = time.time() - self._ttl
            rows = conn.execute(
                "SELECT query, mode, model_id, embedding, artifact, timestamp "
                "FROM cache_entries WHERE timestamp > ? ORDER BY timestamp DESC LIMIT ?",
                (cutoff, self._max_entries),
            ).fetchall()
            conn.close()

            for row in rows:
                query, mode, model_id, emb_bytes, art_json, ts = row
                emb = np.frombuffer(emb_bytes, dtype=np.float32)
                artifact = json.loads(art_json)
                self._entries.append(CacheEntry(
                    query=query, mode=mode, model_id=model_id,
                    embedding=emb, artifact=artifact, timestamp=ts,
                ))
        except Exception as e:
            logger.warning("Failed to load SQLite cache: %s", e)

    def get(
        self,
        query: str,
        mode: str = "standard",
        model_id: str = "openai",
    ) -> Optional[dict]:
        """Check cache for a semantically similar query. Returns artifact or None."""
        q_emb = self._embedder.embed_one(query)
        q_norm = np.linalg.norm(q_emb)
        if q_norm > 0:
            q_emb = q_emb / q_norm

        cutoff = time.time() - self._ttl
        best_score = 0.0
        best_entry: Optional[CacheEntry] = None

        for entry in self._entries:
            if entry.timestamp < cutoff:
                continue
            if entry.mode != mode or entry.model_id != model_id:
                continue

            e_norm = np.linalg.norm(entry.embedding)
            e_emb = entry.embedding / e_norm if e_norm > 0 else entry.embedding
            sim = float(np.dot(q_emb, e_emb))

            if sim > best_score:
                best_score = sim
                best_entry = entry

        if best_entry and best_score >= self._threshold:
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
        q_emb = self._embedder.embed_one(query)
        q_norm = np.linalg.norm(q_emb)
        if q_norm > 0:
            q_emb = q_emb / q_norm

        entry = CacheEntry(
            query=query, mode=mode, model_id=model_id,
            embedding=q_emb, artifact=artifact, timestamp=time.time(),
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

            conn = sqlite3.connect(self._sqlite_path)
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
            conn.close()
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
                conn = sqlite3.connect(self._sqlite_path)
                conn.execute("DELETE FROM cache_entries")
                conn.commit()
                conn.close()
            except Exception:
                pass

    @property
    def size(self) -> int:
        return len(self._entries)
