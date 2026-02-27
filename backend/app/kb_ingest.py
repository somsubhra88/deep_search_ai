"""
Knowledge Base file ingestion pipeline.

Responsibilities:
  1. Intelligent file type detection (MIME + heuristics)
  2. Text extraction (PDF, DOCX, MD, TXT)
  3. Content-hash caching (sha256 on raw bytes)
  4. Chunking with deduplication
  5. Embedding generation and persistence
  6. KG-ready entity/relation extraction (lightweight MVP)
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import re
import zipfile
from pathlib import Path
from typing import BinaryIO, Optional

import numpy as np

from app.kb_models import (
    create_document,
    copy_chunks_and_embeddings,
    embedding_exists,
    find_doc_by_hash,
    find_doc_by_hash_any_kb,
    get_chunks_for_doc,
    insert_chunks,
    insert_embedding,
    insert_kg_artifact,
    update_document_status,
)
from app.rag.chunking import chunk_text, TextChunk
from app.rag.embeddings import Embedder, get_embedder

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".md", ".txt", ".markdown", ".rst", ".csv", ".json", ".xml", ".html", ".htm", ".log"}
IGNORED_FILES = {".DS_Store", "Thumbs.db", ".gitignore", ".gitkeep", "__MACOSX"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
CHUNK_SIZE = 600
CHUNK_OVERLAP = 80

_DATA_DIR: Optional[Path] = None


def _get_data_dir() -> Path:
    global _DATA_DIR
    if _DATA_DIR is None:
        base = Path(__file__).resolve()
        candidates = [
            base.parents[2] / "data" / "kb_files",
            base.parents[1] / "data" / "kb_files",
        ]
        for p in candidates:
            try:
                p.mkdir(parents=True, exist_ok=True)
                _DATA_DIR = p
                return p
            except PermissionError:
                continue
        _DATA_DIR = candidates[-1]
        _DATA_DIR.mkdir(parents=True, exist_ok=True)
    return _DATA_DIR


# ---------------------------------------------------------------------------
# File type detection
# ---------------------------------------------------------------------------

def _is_hidden_or_ignored(filename: str) -> bool:
    name = Path(filename).name
    if name.startswith("."):
        return True
    if name in IGNORED_FILES:
        return True
    for ign in IGNORED_FILES:
        if ign in filename:
            return True
    return False


def detect_mime_type(file_bytes: bytes, filename: str) -> str:
    """Detect MIME type using magic bytes, then extension fallback, then heuristic."""
    ext = Path(filename).suffix.lower()

    # Magic byte signatures
    if file_bytes[:4] == b"%PDF":
        return "application/pdf"
    if file_bytes[:4] == b"PK\x03\x04":
        if ext == ".docx":
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if ext == ".zip":
            return "application/zip"
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if file_bytes[:5] == b"{\rtf":
        return "application/rtf"

    ext_map = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".txt": "text/plain",
        ".rst": "text/x-rst",
        ".csv": "text/csv",
        ".json": "application/json",
        ".xml": "application/xml",
        ".html": "text/html",
        ".htm": "text/html",
        ".log": "text/plain",
    }
    if ext in ext_map:
        return ext_map[ext]

    # Heuristic: check if file is mostly printable text
    sample = file_bytes[:4096]
    if len(sample) > 0:
        try:
            sample.decode("utf-8")
            printable = sum(1 for b in sample if b >= 32 or b in (9, 10, 13))
            if printable / len(sample) > 0.90:
                return "text/plain"
        except UnicodeDecodeError:
            pass

    return "application/octet-stream"


def is_supported_file(file_bytes: bytes, filename: str) -> bool:
    if _is_hidden_or_ignored(filename):
        return False
    if len(file_bytes) > MAX_FILE_SIZE:
        return False
    if len(file_bytes) == 0:
        return False
    mime = detect_mime_type(file_bytes, filename)
    return mime != "application/octet-stream"


# ---------------------------------------------------------------------------
# Text extraction
# ---------------------------------------------------------------------------

def extract_text_from_pdf(file_bytes: bytes) -> tuple[str, dict]:
    """Extract text from PDF. Returns (text, metadata dict with page_count)."""
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                pages.append(text)
        doc.close()
        full_text = "\n\n".join(pages)
        if not full_text.strip():
            return "[OCR not supported — no extractable text found in PDF]", {"page_count": len(doc)}
        return full_text, {"page_count": len(pages)}
    except ImportError:
        # Fallback: try pypdf
        try:
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(file_bytes))
            pages = []
            for page in reader.pages:
                text = page.extract_text() or ""
                if text.strip():
                    pages.append(text)
            full_text = "\n\n".join(pages)
            if not full_text.strip():
                return "[OCR not supported — no extractable text found in PDF]", {"page_count": len(reader.pages)}
            return full_text, {"page_count": len(pages)}
        except ImportError:
            return "[PDF extraction unavailable — install PyMuPDF or pypdf]", {}
    except Exception as e:
        logger.warning("PDF extraction failed: %s", e)
        return f"[PDF extraction error: {e}]", {}


def extract_text_from_docx(file_bytes: bytes) -> str:
    try:
        from docx import Document
        doc = Document(io.BytesIO(file_bytes))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n\n".join(paragraphs)
    except ImportError:
        return "[DOCX extraction unavailable — install python-docx]"
    except Exception as e:
        logger.warning("DOCX extraction failed: %s", e)
        return f"[DOCX extraction error: {e}]"


def extract_text_from_text(file_bytes: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig", "latin-1", "cp1252"):
        try:
            return file_bytes.decode(encoding)
        except (UnicodeDecodeError, ValueError):
            continue
    return file_bytes.decode("utf-8", errors="replace")


def extract_text(file_bytes: bytes, filename: str, mime_type: str) -> tuple[str, dict]:
    """Extract text from a file. Returns (text, extraction_metadata)."""
    meta: dict = {}

    if mime_type == "application/pdf" or filename.lower().endswith(".pdf"):
        text, meta = extract_text_from_pdf(file_bytes)
        return text, meta

    if "wordprocessingml" in mime_type or filename.lower().endswith(".docx"):
        text = extract_text_from_docx(file_bytes)
        return text, meta

    # All text-like files
    text = extract_text_from_text(file_bytes)
    return text, meta


# ---------------------------------------------------------------------------
# Content hash
# ---------------------------------------------------------------------------

def compute_content_hash(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()


# ---------------------------------------------------------------------------
# Chunking + deduplication
# ---------------------------------------------------------------------------

def chunk_and_dedupe(
    text: str,
    source_url: str = "",
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> list[dict]:
    """Chunk text and deduplicate by text_hash."""
    chunks = chunk_text(
        text,
        chunk_size=chunk_size,
        overlap=overlap,
        source_url=source_url,
        remove_boilerplate=False,
    )
    seen_hashes: set[str] = set()
    result: list[dict] = []
    for c in chunks:
        text_hash = hashlib.sha256(c.text.encode("utf-8")).hexdigest()[:32]
        if text_hash in seen_hashes:
            continue
        seen_hashes.add(text_hash)
        result.append({
            "chunk_index": c.index,
            "text": c.text,
            "text_hash": text_hash,
            "char_count": len(c.text),
            "token_count": len(c.text.split()),
            "start_offset": c.start_char,
            "end_offset": c.end_char,
        })
    return result


# ---------------------------------------------------------------------------
# Embedding persistence
# ---------------------------------------------------------------------------

def embed_and_store_chunks(
    doc_id: str,
    chunk_rows: list[dict],
    embedder: Embedder | None = None,
) -> int:
    """Embed chunks and store in DB. Skips if embedding already exists."""
    if not chunk_rows:
        return 0

    if embedder is None:
        embedder = get_embedder()

    model_id = type(embedder).__name__

    # Filter chunks needing embeddings
    to_embed = []
    chunk_ids = []
    for c in chunk_rows:
        cid = c["id"] if "id" in c else c.get("chunk_id", "")
        if not cid:
            continue
        if not embedding_exists(cid, model_id):
            to_embed.append(c["text"])
            chunk_ids.append(cid)

    if not to_embed:
        return 0

    # Batch embed
    BATCH = 64
    stored = 0
    for i in range(0, len(to_embed), BATCH):
        batch_texts = to_embed[i:i + BATCH]
        batch_ids = chunk_ids[i:i + BATCH]
        try:
            vectors = embedder.embed(batch_texts)
            for cid, vec in zip(batch_ids, vectors):
                vec_bytes = vec.astype(np.float32).tobytes()
                insert_embedding(cid, model_id, vec_bytes)
                stored += 1
        except Exception as e:
            logger.error("Embedding batch failed: %s", e)

    return stored


# ---------------------------------------------------------------------------
# KG-ready extraction (lightweight MVP)
# ---------------------------------------------------------------------------

def extract_kg_artifacts(doc_id: str, text: str, chunk_rows: list[dict]) -> None:
    """
    Lightweight entity/relation extraction from text.
    Uses simple NER-like heuristics (capitalized phrases, quoted terms).
    """
    entities: list[dict] = []
    relations: list[dict] = []

    # Simple entity extraction: find capitalized multi-word phrases
    cap_pattern = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b")
    entity_counts: dict[str, int] = {}
    for match in cap_pattern.finditer(text[:10000]):
        name = match.group(1)
        entity_counts[name] = entity_counts.get(name, 0) + 1

    for name, count in sorted(entity_counts.items(), key=lambda x: -x[1])[:50]:
        if count >= 2:
            entities.append({
                "name": name,
                "type": "ENTITY",
                "mention_count": count,
            })

    # Simple relation extraction: "X is Y", "X was Y"
    rel_pattern = re.compile(r"([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:is|was|are|were)\s+(?:a|an|the)?\s*([a-z]+(?:\s+[a-z]+){0,3})", re.IGNORECASE)
    seen_rels: set[str] = set()
    for match in rel_pattern.finditer(text[:10000]):
        subj = match.group(1).strip()
        obj = match.group(2).strip()
        key = f"{subj}|{obj}"
        if key not in seen_rels and len(subj) > 2 and len(obj) > 2:
            seen_rels.add(key)
            relations.append({
                "subj": subj,
                "rel": "is_a",
                "obj": obj,
            })
            if len(relations) >= 30:
                break

    try:
        insert_kg_artifact(
            doc_id=doc_id,
            entities_json=json.dumps(entities),
            relations_json=json.dumps(relations),
        )
    except Exception as e:
        logger.warning("KG artifact insertion failed: %s", e)


# ---------------------------------------------------------------------------
# Main ingestion orchestrator
# ---------------------------------------------------------------------------

def store_raw_file(content_hash: str, filename: str, file_bytes: bytes) -> Path:
    """Store raw file under data/kb_files/<content_hash>/<original_filename>."""
    data_dir = _get_data_dir()
    file_dir = data_dir / content_hash
    file_dir.mkdir(parents=True, exist_ok=True)
    file_path = file_dir / Path(filename).name
    file_path.write_bytes(file_bytes)
    return file_path


def ingest_single_file(
    kb_id: str,
    filename: str,
    file_bytes: bytes,
    source_type: str = "upload",
    relative_path: str = "",
    embedder: Embedder | None = None,
    force_reindex: bool = False,
) -> dict:
    """
    Ingest a single file into a knowledge base.

    Returns dict with: filename, content_hash, doc_id, status, message, chunk_count
    """
    content_hash = compute_content_hash(file_bytes)
    ext = Path(filename).suffix.lower()
    mime_type = detect_mime_type(file_bytes, filename)

    result = {
        "filename": filename,
        "content_hash": content_hash,
        "doc_id": "",
        "status": "failed",
        "message": "",
        "chunk_count": 0,
    }

    # Check if already in this KB
    if not force_reindex:
        existing = find_doc_by_hash(kb_id, content_hash)
        if existing and existing["status"] == "indexed":
            result["doc_id"] = existing["id"]
            result["status"] = "skipped_cached"
            result["message"] = "File already indexed (content hash match)"
            chunks = get_chunks_for_doc(existing["id"])
            result["chunk_count"] = len(chunks)
            return result

    # Check if file type is supported
    if not is_supported_file(file_bytes, filename):
        result["message"] = f"Unsupported file type: {mime_type}"
        return result

    # Store raw file
    try:
        store_raw_file(content_hash, filename, file_bytes)
    except Exception as e:
        logger.warning("Failed to store raw file %s: %s", filename, e)

    # Create document record
    try:
        doc = create_document(
            kb_id=kb_id,
            filename=filename,
            content_hash=content_hash,
            size_bytes=len(file_bytes),
            mime_type=mime_type,
            file_ext=ext,
            source_type=source_type,
            relative_path=relative_path,
            status="pending",
        )
    except Exception as e:
        # Likely a UNIQUE constraint violation — doc already exists
        existing = find_doc_by_hash(kb_id, content_hash)
        if existing:
            result["doc_id"] = existing["id"]
            result["status"] = "skipped_cached"
            result["message"] = "File already indexed"
            return result
        result["message"] = f"DB error: {e}"
        return result

    doc_id = doc["id"]
    result["doc_id"] = doc_id

    # Check if same content was indexed in another KB — reuse chunks/embeddings
    if not force_reindex:
        other_doc = find_doc_by_hash_any_kb(content_hash)
        if other_doc and other_doc["id"] != doc_id:
            try:
                copied = copy_chunks_and_embeddings(other_doc["id"], doc_id)
                if copied > 0:
                    update_document_status(doc_id, "indexed")
                    result["status"] = "indexed"
                    result["message"] = f"Reused {copied} chunks from existing index"
                    result["chunk_count"] = copied
                    extract_kg_artifacts(doc_id, "", [])
                    return result
            except Exception as e:
                logger.warning("Chunk reuse failed, will re-process: %s", e)

    # Extract text
    try:
        text, extraction_meta = extract_text(file_bytes, filename, mime_type)
    except Exception as e:
        update_document_status(doc_id, "failed", str(e))
        result["message"] = f"Text extraction failed: {e}"
        return result

    if not text or not text.strip() or text.startswith("["):
        if text.startswith("["):
            update_document_status(doc_id, "failed", text)
            result["message"] = text
        else:
            update_document_status(doc_id, "failed", "No text extracted")
            result["message"] = "No extractable text found"
        return result

    # Chunk
    chunk_dicts = chunk_and_dedupe(text, source_url=filename)
    if not chunk_dicts:
        update_document_status(doc_id, "failed", "No chunks produced")
        result["message"] = "Text too short to chunk"
        return result

    # Insert chunks
    inserted = insert_chunks(doc_id, chunk_dicts)

    # Get chunks back with IDs for embedding
    stored_chunks = get_chunks_for_doc(doc_id)

    # Embed
    if embedder is None:
        embedder = get_embedder()

    try:
        embed_and_store_chunks(doc_id, stored_chunks, embedder)
    except Exception as e:
        logger.error("Embedding failed for doc %s: %s", doc_id, e)
        update_document_status(doc_id, "failed", f"Embedding error: {e}")
        result["message"] = f"Embedding failed: {e}"
        return result

    # KG extraction
    try:
        extract_kg_artifacts(doc_id, text, stored_chunks)
    except Exception as e:
        logger.warning("KG extraction failed (non-fatal): %s", e)

    # Mark indexed
    update_document_status(doc_id, "indexed")
    result["status"] = "indexed"
    result["message"] = f"Indexed {inserted} chunks"
    result["chunk_count"] = inserted
    return result


# ---------------------------------------------------------------------------
# Batch ingestion (for directory / zip uploads)
# ---------------------------------------------------------------------------

def ingest_files(
    kb_id: str,
    files: list[tuple[str, bytes]],
    source_type: str = "upload",
    embedder: Embedder | None = None,
    force_reindex: bool = False,
) -> list[dict]:
    """
    Ingest multiple files. Each item is (filename, file_bytes).
    Returns list of status dicts.
    """
    if embedder is None:
        embedder = get_embedder()

    results = []
    for filename, file_bytes in files:
        if _is_hidden_or_ignored(filename):
            continue
        try:
            r = ingest_single_file(
                kb_id=kb_id,
                filename=filename,
                file_bytes=file_bytes,
                source_type=source_type,
                relative_path=filename,
                embedder=embedder,
                force_reindex=force_reindex,
            )
            results.append(r)
        except Exception as e:
            logger.error("Ingestion failed for %s: %s", filename, e)
            results.append({
                "filename": filename,
                "content_hash": "",
                "doc_id": "",
                "status": "failed",
                "message": str(e),
                "chunk_count": 0,
            })
    return results


def ingest_zip(
    kb_id: str,
    zip_bytes: bytes,
    embedder: Embedder | None = None,
    force_reindex: bool = False,
) -> list[dict]:
    """Extract a zip file and ingest all supported files."""
    files: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                if _is_hidden_or_ignored(info.filename):
                    continue
                try:
                    data = zf.read(info.filename)
                    if len(data) > 0:
                        files.append((info.filename, data))
                except Exception as e:
                    logger.warning("Failed to read %s from zip: %s", info.filename, e)
    except zipfile.BadZipFile:
        return [{"filename": "archive.zip", "content_hash": "", "doc_id": "",
                 "status": "failed", "message": "Invalid zip file", "chunk_count": 0}]

    return ingest_files(kb_id, files, source_type="zip", embedder=embedder, force_reindex=force_reindex)
