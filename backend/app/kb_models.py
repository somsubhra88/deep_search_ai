"""
Knowledge Base persistence — SQLite with WAL mode.

Tables: knowledge_base, document, chunk, embedding, kg_artifact, web_evidence_cache
Caching primitive: content_hash_sha256 on raw file bytes.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

_KB_DB_PATH: Optional[Path] = None


def _resolve_kb_db_path() -> Path:
    base = Path(__file__).resolve()
    candidates = [
        base.parents[2] / "data" / "knowledge.db",
        base.parents[1] / "data" / "knowledge.db",
    ]
    for p in candidates:
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            return p
        except PermissionError:
            continue
    return candidates[-1]


def _get_kb_db_path() -> Path:
    global _KB_DB_PATH
    if _KB_DB_PATH is None:
        _KB_DB_PATH = _resolve_kb_db_path()
    return _KB_DB_PATH


def _get_conn() -> sqlite3.Connection:
    db_path = _get_kb_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid() -> str:
    return uuid.uuid4().hex


# ---------------------------------------------------------------------------
# Schema initialization
# ---------------------------------------------------------------------------

def init_kb_db() -> None:
    conn = _get_conn()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS knowledge_base (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document (
        id TEXT PRIMARY KEY,
        kb_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT '',
        file_ext TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        content_hash_sha256 TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'upload'
            CHECK(source_type IN ('upload','folder','zip')),
        relative_path TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending','indexed','failed')),
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_kb_hash
        ON document(kb_id, content_hash_sha256);

    CREATE TABLE IF NOT EXISTS chunk (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        char_count INTEGER NOT NULL DEFAULT 0,
        page_start INTEGER,
        page_end INTEGER,
        section_title TEXT,
        start_offset INTEGER NOT NULL DEFAULT 0,
        end_offset INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_chunk_doc ON chunk(doc_id);
    CREATE INDEX IF NOT EXISTS idx_chunk_text_hash ON chunk(text_hash);

    CREATE TABLE IF NOT EXISTS embedding (
        id TEXT PRIMARY KEY,
        chunk_id TEXT NOT NULL REFERENCES chunk(id) ON DELETE CASCADE,
        embed_model_id TEXT NOT NULL,
        vector BLOB NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_emb_chunk_model
        ON embedding(chunk_id, embed_model_id);

    CREATE TABLE IF NOT EXISTS kg_artifact (
        id TEXT PRIMARY KEY,
        doc_id TEXT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
        chunk_id TEXT,
        entities_json TEXT NOT NULL DEFAULT '[]',
        relations_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kg_doc ON kg_artifact(doc_id);

    CREATE TABLE IF NOT EXISTS web_evidence_cache (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        extracted_at TEXT NOT NULL,
        evidence_card_json TEXT NOT NULL DEFAULT '{}',
        content_hash TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_web_ev_url ON web_evidence_cache(url);
    """)
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Knowledge Base CRUD
# ---------------------------------------------------------------------------

def create_kb(name: str, description: str = "") -> dict:
    conn = _get_conn()
    kb_id = _uuid()
    now = _now()
    conn.execute(
        "INSERT INTO knowledge_base (id, name, description, created_at) VALUES (?,?,?,?)",
        (kb_id, name, description, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM knowledge_base WHERE id=?", (kb_id,)).fetchone()
    conn.close()
    return dict(row)


def list_kbs() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT kb.*, COUNT(d.id) as doc_count "
        "FROM knowledge_base kb LEFT JOIN document d ON d.kb_id=kb.id "
        "GROUP BY kb.id ORDER BY kb.created_at DESC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_kb(kb_id: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute("SELECT * FROM knowledge_base WHERE id=?", (kb_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def delete_kb(kb_id: str) -> bool:
    conn = _get_conn()
    cur = conn.execute("DELETE FROM knowledge_base WHERE id=?", (kb_id,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Document CRUD
# ---------------------------------------------------------------------------

def find_doc_by_hash(kb_id: str, content_hash: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM document WHERE kb_id=? AND content_hash_sha256=?",
        (kb_id, content_hash),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def find_doc_by_hash_any_kb(content_hash: str) -> dict | None:
    """Find a document with this hash in ANY knowledge base (for chunk reuse)."""
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM document WHERE content_hash_sha256=? AND status='indexed' LIMIT 1",
        (content_hash,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def create_document(
    kb_id: str,
    filename: str,
    content_hash: str,
    size_bytes: int,
    mime_type: str = "",
    file_ext: str = "",
    source_type: str = "upload",
    relative_path: str = "",
    status: str = "pending",
) -> dict:
    conn = _get_conn()
    doc_id = _uuid()
    now = _now()
    conn.execute(
        "INSERT INTO document (id,kb_id,filename,mime_type,file_ext,size_bytes,"
        "content_hash_sha256,source_type,relative_path,status,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (doc_id, kb_id, filename, mime_type, file_ext, size_bytes,
         content_hash, source_type, relative_path, status, now, now),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM document WHERE id=?", (doc_id,)).fetchone()
    conn.close()
    return dict(row)


def update_document_status(doc_id: str, status: str, error_message: str | None = None) -> None:
    conn = _get_conn()
    conn.execute(
        "UPDATE document SET status=?, error_message=?, updated_at=? WHERE id=?",
        (status, error_message, _now(), doc_id),
    )
    conn.commit()
    conn.close()


def list_docs(kb_id: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT d.*, COUNT(c.id) as chunk_count "
        "FROM document d LEFT JOIN chunk c ON c.doc_id=d.id "
        "WHERE d.kb_id=? GROUP BY d.id ORDER BY d.created_at DESC",
        (kb_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def delete_document(doc_id: str) -> bool:
    conn = _get_conn()
    cur = conn.execute("DELETE FROM document WHERE id=?", (doc_id,))
    conn.commit()
    conn.close()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Chunk CRUD
# ---------------------------------------------------------------------------

def insert_chunks(doc_id: str, chunks: list[dict]) -> int:
    if not chunks:
        return 0
    conn = _get_conn()
    inserted = 0
    for c in chunks:
        chunk_id = c.get("id") or _uuid()
        try:
            conn.execute(
                "INSERT INTO chunk (id,doc_id,chunk_index,text,text_hash,"
                "token_count,char_count,page_start,page_end,section_title,"
                "start_offset,end_offset) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    chunk_id, doc_id, c["chunk_index"], c["text"], c["text_hash"],
                    c.get("token_count", 0), c.get("char_count", len(c["text"])),
                    c.get("page_start"), c.get("page_end"),
                    c.get("section_title"),
                    c.get("start_offset", 0), c.get("end_offset", 0),
                ),
            )
            inserted += 1
        except sqlite3.IntegrityError:
            pass
    conn.commit()
    conn.close()
    return inserted


def get_chunks_for_doc(doc_id: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM chunk WHERE doc_id=? ORDER BY chunk_index", (doc_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_chunks_for_kb(kb_id: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT c.*, d.filename, d.kb_id FROM chunk c "
        "JOIN document d ON d.id=c.doc_id "
        "WHERE d.kb_id=? AND d.status='indexed' ORDER BY d.filename, c.chunk_index",
        (kb_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Embedding CRUD
# ---------------------------------------------------------------------------

def insert_embedding(chunk_id: str, embed_model_id: str, vector_bytes: bytes) -> str:
    conn = _get_conn()
    emb_id = _uuid()
    now = _now()
    try:
        conn.execute(
            "INSERT INTO embedding (id,chunk_id,embed_model_id,vector,created_at) "
            "VALUES (?,?,?,?,?)",
            (emb_id, chunk_id, embed_model_id, vector_bytes, now),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        row = conn.execute(
            "SELECT id FROM embedding WHERE chunk_id=? AND embed_model_id=?",
            (chunk_id, embed_model_id),
        ).fetchone()
        emb_id = row["id"] if row else emb_id
    conn.close()
    return emb_id


def get_embeddings_for_kb(kb_id: str, embed_model_id: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT e.*, c.text, c.doc_id, c.chunk_index, c.page_start, c.page_end, "
        "c.section_title, c.start_offset, c.end_offset, d.filename "
        "FROM embedding e "
        "JOIN chunk c ON c.id=e.chunk_id "
        "JOIN document d ON d.id=c.doc_id "
        "WHERE d.kb_id=? AND e.embed_model_id=? AND d.status='indexed'",
        (kb_id, embed_model_id),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def embedding_exists(chunk_id: str, embed_model_id: str) -> bool:
    conn = _get_conn()
    row = conn.execute(
        "SELECT 1 FROM embedding WHERE chunk_id=? AND embed_model_id=?",
        (chunk_id, embed_model_id),
    ).fetchone()
    conn.close()
    return row is not None


# ---------------------------------------------------------------------------
# KG Artifact CRUD
# ---------------------------------------------------------------------------

def insert_kg_artifact(doc_id: str, entities_json: str, relations_json: str, chunk_id: str | None = None) -> str:
    conn = _get_conn()
    art_id = _uuid()
    conn.execute(
        "INSERT INTO kg_artifact (id,doc_id,chunk_id,entities_json,relations_json,created_at) "
        "VALUES (?,?,?,?,?,?)",
        (art_id, doc_id, chunk_id, entities_json, relations_json, _now()),
    )
    conn.commit()
    conn.close()
    return art_id


def get_kg_artifacts(doc_id: str) -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        "SELECT * FROM kg_artifact WHERE doc_id=? ORDER BY created_at", (doc_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Copy chunks/embeddings from another doc (for content-hash reuse across KBs)
# ---------------------------------------------------------------------------

def copy_chunks_and_embeddings(source_doc_id: str, target_doc_id: str) -> int:
    """Copy all chunks and their embeddings from source doc to target doc."""
    conn = _get_conn()
    source_chunks = conn.execute(
        "SELECT * FROM chunk WHERE doc_id=? ORDER BY chunk_index", (source_doc_id,)
    ).fetchall()

    copied = 0
    for sc in source_chunks:
        new_chunk_id = _uuid()
        try:
            conn.execute(
                "INSERT INTO chunk (id,doc_id,chunk_index,text,text_hash,"
                "token_count,char_count,page_start,page_end,section_title,"
                "start_offset,end_offset) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    new_chunk_id, target_doc_id, sc["chunk_index"], sc["text"],
                    sc["text_hash"], sc["token_count"], sc["char_count"],
                    sc["page_start"], sc["page_end"], sc["section_title"],
                    sc["start_offset"], sc["end_offset"],
                ),
            )
            # Copy embeddings for this chunk
            source_embs = conn.execute(
                "SELECT * FROM embedding WHERE chunk_id=?", (sc["id"],)
            ).fetchall()
            for se in source_embs:
                try:
                    conn.execute(
                        "INSERT INTO embedding (id,chunk_id,embed_model_id,vector,created_at) "
                        "VALUES (?,?,?,?,?)",
                        (_uuid(), new_chunk_id, se["embed_model_id"], se["vector"], _now()),
                    )
                except sqlite3.IntegrityError:
                    pass
            copied += 1
        except sqlite3.IntegrityError:
            pass

    conn.commit()
    conn.close()
    return copied
