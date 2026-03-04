"""
Semantic Memory Graph — long-term research memory via a lightweight file-based
vector store + OpenAI embeddings.

Stores a distilled 10-15 word "Essence" of each completed research session and
recalls semantically similar past context to enrich future searches.

Uses a simple JSON-backed store with cosine similarity instead of ChromaDB to
avoid compatibility issues with Python 3.14.
"""

import os
import uuid
import json
import math
import logging
import asyncio
import pathlib
import threading
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration — tuneable via env vars, sensible defaults
# ---------------------------------------------------------------------------

RECALL_THRESHOLD = float(os.getenv("MEMORY_RECALL_THRESHOLD", "0.55"))
RECALL_MAX_RESULTS = int(os.getenv("MEMORY_RECALL_MAX_RESULTS", "8"))
GRAPH_EDGE_THRESHOLD = float(os.getenv("MEMORY_GRAPH_EDGE_THRESHOLD", "0.3"))
MAX_QUERY_STORE_LEN = int(os.getenv("MEMORY_MAX_QUERY_LEN", "500"))

# ---------------------------------------------------------------------------
# Lightweight File-Backed Vector Store
# ---------------------------------------------------------------------------

_STORE_PATH = pathlib.Path(__file__).resolve().parents[2] / "chroma_data" / "memory_store.json"


class _VectorStore:
    """Thread-safe, file-backed vector store with cosine similarity search."""

    def __init__(self, path: pathlib.Path):
        self._path = path
        self._lock = threading.Lock()
        self._entries: list[dict] = []
        self._load()

    def _load(self):
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if self._path.exists():
            try:
                with open(self._path, "r") as f:
                    self._entries = json.load(f)
                logger.info("Loaded %d memories from %s", len(self._entries), self._path)
            except (json.JSONDecodeError, IOError) as e:
                logger.warning("Failed to load memory store, starting fresh: %s", e)
                self._entries = []
        else:
            self._entries = []

    def _save(self):
        tmp = self._path.with_suffix(".tmp")
        with open(tmp, "w") as f:
            json.dump(self._entries, f)
        tmp.replace(self._path)

    def count(self) -> int:
        return len(self._entries)

    def add(self, doc_id: str, embedding: list[float], document: str, metadata: dict):
        with self._lock:
            self._entries.append({
                "id": doc_id,
                "embedding": embedding,
                "document": document,
                "metadata": metadata,
            })
            self._save()

    def query(self, query_embedding: list[float], n_results: int = 5) -> list[dict]:
        """Return the top-n entries by cosine similarity, each augmented with a ``similarity`` key."""
        if not self._entries:
            return []

        scored = []
        for entry in self._entries:
            sim = _cosine_similarity(query_embedding, entry["embedding"])
            scored.append({**entry, "similarity": sim})

        scored.sort(key=lambda e: e["similarity"], reverse=True)
        return scored[:n_results]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


try:
    _store = _VectorStore(_STORE_PATH)
except Exception as _init_err:
    logger.error("Vector store initialization failed: %s", _init_err)
    _store = None


# ---------------------------------------------------------------------------
# Embedding — uses OpenAI when available, hash-based fallback otherwise
# ---------------------------------------------------------------------------

_embedder = None

def _get_embedder():
    global _embedder
    if _embedder is None:
        from app.rag.embeddings import get_embedder
        _embedder = get_embedder()
        logger.info("Memory graph using embedder: %s (dim=%d)", type(_embedder).__name__, _embedder.dim)
    return _embedder


async def _get_embedding(text: str) -> list[float]:
    """Generate an embedding vector using the best available embedder."""
    embedder = _get_embedder()
    vec = await asyncio.to_thread(embedder.embed_one, text)
    return vec.tolist()


# ---------------------------------------------------------------------------
# Essence Distillation
# ---------------------------------------------------------------------------

_ESSENCE_PROMPT = (
    "You are a distillation AI. Condense the following research summary into "
    "exactly 10 to 15 words that capture the absolute core essence of the findings. "
    "Output ONLY the words, no introductory text."
)


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

async def store_search_memory(
    original_query: str,
    full_summary: str,
    active_llm=None,
) -> str:
    """
    Distill a research report into a 10-15 word essence, embed it, and persist
    to the file-backed vector store.

    Returns the essence string (empty string on total failure).
    """
    if _store is None:
        logger.warning("Vector store not available — skipping memory storage")
        return ""

    if not full_summary.strip():
        return ""

    prompt = f"{_ESSENCE_PROMPT}\n\nResearch summary:\n{full_summary[:4000]}"
    try:
        if active_llm is None:
            from app.agent import _get_llm  # noqa: lazy to avoid circular import
            active_llm = _get_llm("openai")
        response = await asyncio.to_thread(active_llm.invoke, prompt)
        essence_text = (response.content or "").strip().strip('"').strip("'")
    except Exception as e:
        logger.warning("Essence distillation failed, using fallback: %s", e)
        essence_text = " ".join(full_summary.split()[:15])

    if not essence_text:
        return ""

    try:
        embedding = await _get_embedding(essence_text)
    except Exception as e:
        logger.warning("Embedding generation failed: %s", e)
        return essence_text

    doc_id = str(uuid.uuid4())
    timestamp = datetime.now(timezone.utc).isoformat()

    try:
        _store.add(
            doc_id=doc_id,
            embedding=embedding,
            document=essence_text,
            metadata={
                "original_query": original_query[:MAX_QUERY_STORE_LEN],
                "timestamp": timestamp,
                "essence_text": essence_text,
            },
        )
        logger.info("Stored memory [%s]: %s", doc_id[:8], essence_text[:80])
    except Exception as e:
        logger.warning("Memory store insert failed: %s", e)

    return essence_text


# ---------------------------------------------------------------------------
# Semantic Recall
# ---------------------------------------------------------------------------

async def recall_past_context(
    new_query: str,
    threshold: float | None = None,
    max_results: int | None = None,
) -> list[dict]:
    """
    Find past research memories semantically related to *new_query*.

    Returns a list of dicts sorted by descending similarity::

        {"query": str, "essence": str, "timestamp": str, "similarity": float}

    Only memories whose cosine similarity >= *threshold* are included.
    """
    if threshold is None:
        threshold = RECALL_THRESHOLD
    if max_results is None:
        max_results = RECALL_MAX_RESULTS

    if _store is None or _store.count() == 0:
        return []

    try:
        query_embedding = await _get_embedding(new_query)
    except Exception as e:
        logger.warning("Recall embedding failed: %s", e)
        return []

    try:
        results = _store.query(query_embedding, n_results=max_results)
    except Exception as e:
        logger.warning("Vector store query failed: %s", e)
        return []

    memories: list[dict] = []
    for entry in results:
        similarity = entry.get("similarity", 0.0)
        if similarity < threshold:
            continue

        meta = entry.get("metadata", {})
        memories.append({
            "query": meta.get("original_query", ""),
            "essence": meta.get("essence_text", entry.get("document", "")),
            "timestamp": meta.get("timestamp", ""),
            "similarity": round(similarity, 3),
        })

    return memories


# ---------------------------------------------------------------------------
# Memory Graph — pairwise cosine similarity from stored embeddings
# ---------------------------------------------------------------------------

def get_memory_graph(threshold: float | None = None) -> dict:
    """
    Compute pairwise cosine similarity between all stored memory embeddings.

    Returns::

        {
            "nodes": [{"id": str, "query": str, "essence": str, "timestamp": str}, ...],
            "edges": [{"source": str, "target": str, "similarity": float}, ...],
        }

    Only edges with similarity >= *threshold* are included.
    Runs entirely from the in-memory vector store — no API calls needed.
    """
    if threshold is None:
        threshold = GRAPH_EDGE_THRESHOLD

    if _store is None or _store.count() == 0:
        return {"nodes": [], "edges": []}

    with _store._lock:
        entries = list(_store._entries)

    nodes = []
    for entry in entries:
        meta = entry.get("metadata", {})
        nodes.append({
            "id": entry["id"],
            "query": meta.get("original_query", ""),
            "essence": meta.get("essence_text", entry.get("document", "")),
            "timestamp": meta.get("timestamp", ""),
        })

    edges = []
    n = len(entries)
    for i in range(n):
        emb_i = entries[i].get("embedding")
        if not emb_i:
            continue
        for j in range(i + 1, n):
            emb_j = entries[j].get("embedding")
            if not emb_j:
                continue
            sim = _cosine_similarity(emb_i, emb_j)
            if sim >= threshold:
                edges.append({
                    "source": entries[i]["id"],
                    "target": entries[j]["id"],
                    "similarity": round(sim, 4),
                })

    edges.sort(key=lambda e: e["similarity"], reverse=True)
    return {"nodes": nodes, "edges": edges}
