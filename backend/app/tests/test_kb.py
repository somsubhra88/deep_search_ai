"""
Tests for the Knowledge Base + RAG pipeline.

Covers:
- Content hash caching (same file -> skipped)
- File type recognition heuristics
- Chunking + caps
- Embeddings uniqueness (no duplicates per model)
- Hybrid merge logic
- Citation verifier
- Upload -> index -> query KB_ONLY integration
"""

import hashlib
import json
import os
import tempfile

import pytest
import numpy as np

os.environ.setdefault("OPENAI_API_KEY", "test-key-not-real")
os.environ.setdefault("SERPAPI_API_KEY", "test-key-not-real")

from app.kb_models import (
    init_kb_db,
    create_kb,
    list_kbs,
    get_kb,
    delete_kb,
    create_document,
    find_doc_by_hash,
    insert_chunks,
    get_chunks_for_doc,
    get_chunks_for_kb,
    insert_embedding,
    embedding_exists,
    get_embeddings_for_kb,
    _get_kb_db_path,
)
from app.kb_ingest import (
    compute_content_hash,
    detect_mime_type,
    is_supported_file,
    chunk_and_dedupe,
    ingest_single_file,
    ingest_files,
    ingest_zip,
)
from app.kb_retrieval import (
    retrieve_kb_chunks,
    _verify_citations,
    _build_kb_context,
    _build_web_context,
)
from app.kb_schemas import (
    KBChunkResult,
    KBCitation,
    WebCitation,
    RAGCitations,
    RAGResponse,
)
from app.rag.embeddings import HashEmbedder


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _setup_test_db(tmp_path):
    """Use a temporary DB for each test."""
    import app.kb_models as kb_mod
    kb_mod._KB_DB_PATH = tmp_path / "test_knowledge.db"
    init_kb_db()
    yield


@pytest.fixture
def sample_kb():
    return create_kb("Test KB", "A test knowledge base")


@pytest.fixture
def embedder():
    return HashEmbedder(dim=64)


# ---------------------------------------------------------------------------
# A) Data model tests
# ---------------------------------------------------------------------------

class TestKBModels:
    def test_create_and_list_kbs(self):
        kb = create_kb("My KB", "desc")
        assert kb["name"] == "My KB"
        assert kb["description"] == "desc"
        kbs = list_kbs()
        assert len(kbs) == 1
        assert kbs[0]["id"] == kb["id"]

    def test_get_and_delete_kb(self):
        kb = create_kb("Del KB", "")
        assert get_kb(kb["id"]) is not None
        assert delete_kb(kb["id"])
        assert get_kb(kb["id"]) is None

    def test_create_document_and_find_by_hash(self, sample_kb):
        doc = create_document(
            kb_id=sample_kb["id"],
            filename="test.txt",
            content_hash="abc123",
            size_bytes=100,
            mime_type="text/plain",
            file_ext=".txt",
        )
        assert doc["filename"] == "test.txt"
        found = find_doc_by_hash(sample_kb["id"], "abc123")
        assert found is not None
        assert found["id"] == doc["id"]
        assert find_doc_by_hash(sample_kb["id"], "nonexistent") is None

    def test_insert_and_get_chunks(self, sample_kb):
        doc = create_document(
            kb_id=sample_kb["id"],
            filename="test.txt",
            content_hash="chunk_test_hash",
            size_bytes=50,
        )
        chunks = [
            {"chunk_index": 0, "text": "Hello world", "text_hash": "h1",
             "token_count": 2, "char_count": 11, "start_offset": 0, "end_offset": 11},
            {"chunk_index": 1, "text": "Goodbye world", "text_hash": "h2",
             "token_count": 2, "char_count": 13, "start_offset": 12, "end_offset": 25},
        ]
        inserted = insert_chunks(doc["id"], chunks)
        assert inserted == 2
        stored = get_chunks_for_doc(doc["id"])
        assert len(stored) == 2
        assert stored[0]["text"] == "Hello world"

    def test_embedding_uniqueness(self, sample_kb, embedder):
        doc = create_document(
            kb_id=sample_kb["id"],
            filename="emb_test.txt",
            content_hash="emb_hash",
            size_bytes=20,
        )
        chunks = [{"chunk_index": 0, "text": "Test text", "text_hash": "et1",
                    "start_offset": 0, "end_offset": 9}]
        insert_chunks(doc["id"], chunks)
        stored = get_chunks_for_doc(doc["id"])
        cid = stored[0]["id"]

        vec = np.random.randn(64).astype(np.float32).tobytes()
        model_id = "HashEmbedder"
        insert_embedding(cid, model_id, vec)
        assert embedding_exists(cid, model_id)

        # Inserting again should not raise (idempotent)
        insert_embedding(cid, model_id, vec)
        assert embedding_exists(cid, model_id)


# ---------------------------------------------------------------------------
# B) File ingestion tests
# ---------------------------------------------------------------------------

class TestFileIngestion:
    def test_content_hash_deterministic(self):
        data = b"Hello, world!"
        h1 = compute_content_hash(data)
        h2 = compute_content_hash(data)
        assert h1 == h2
        assert h1 == hashlib.sha256(data).hexdigest()

    def test_content_hash_differs_for_different_content(self):
        h1 = compute_content_hash(b"File A")
        h2 = compute_content_hash(b"File B")
        assert h1 != h2

    def test_detect_mime_pdf(self):
        assert detect_mime_type(b"%PDF-1.4...", "doc.pdf") == "application/pdf"

    def test_detect_mime_docx(self):
        assert detect_mime_type(b"PK\x03\x04...", "doc.docx") == \
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    def test_detect_mime_text_by_extension(self):
        assert detect_mime_type(b"Just text", "readme.md") == "text/markdown"
        assert detect_mime_type(b"Just text", "notes.txt") == "text/plain"

    def test_detect_mime_text_by_heuristic(self):
        text_data = ("This is a plaintext file with no extension " * 100).encode("utf-8")
        assert detect_mime_type(text_data, "unknownfile") == "text/plain"

    def test_detect_mime_binary(self):
        binary = bytes(range(256)) * 20
        mime = detect_mime_type(binary, "mystery")
        assert mime == "application/octet-stream"

    def test_is_supported_file(self):
        assert is_supported_file(b"Hello", "test.txt")
        assert not is_supported_file(b"Hello", ".DS_Store")
        assert not is_supported_file(b"", "empty.txt")
        binary = bytes(range(256)) * 20
        assert not is_supported_file(binary, "file.bin")

    def test_chunk_and_dedupe(self):
        text = "This is sentence one. " * 50 + "This is sentence two. " * 50
        chunks = chunk_and_dedupe(text, chunk_size=200)
        assert len(chunks) > 1
        hashes = [c["text_hash"] for c in chunks]
        assert len(hashes) == len(set(hashes)), "Chunks should be deduplicated by hash"

    def test_chunking_respects_size_cap(self):
        text = "Word " * 500
        chunks = chunk_and_dedupe(text, chunk_size=300)
        for c in chunks:
            assert c["char_count"] <= 1200  # MAX_CHUNK_SIZE from chunking module

    def test_ingest_single_file_caching(self, sample_kb, embedder):
        text = "This is a test document with enough content to produce chunks for the knowledge base."
        file_bytes = text.encode("utf-8")

        r1 = ingest_single_file(
            kb_id=sample_kb["id"],
            filename="test.txt",
            file_bytes=file_bytes,
            embedder=embedder,
        )
        assert r1["status"] == "indexed"
        assert r1["chunk_count"] > 0

        # Re-uploading same file should be cached
        r2 = ingest_single_file(
            kb_id=sample_kb["id"],
            filename="test_copy.txt",
            file_bytes=file_bytes,
            embedder=embedder,
        )
        assert r2["status"] == "skipped_cached"

    def test_ingest_unsupported_file(self, sample_kb, embedder):
        binary = bytes(range(256)) * 20
        r = ingest_single_file(
            kb_id=sample_kb["id"],
            filename="binary.exe",
            file_bytes=binary,
            embedder=embedder,
        )
        assert r["status"] == "failed"
        assert "Unsupported" in r["message"]

    def test_ingest_files_batch(self, sample_kb, embedder):
        files = [
            ("a.txt", b"Content of file A " * 20),
            ("b.txt", b"Content of file B " * 20),
            (".DS_Store", b"hidden"),
        ]
        results = ingest_files(
            kb_id=sample_kb["id"],
            files=files,
            embedder=embedder,
        )
        # .DS_Store should be filtered out
        assert len(results) == 2
        statuses = [r["status"] for r in results]
        assert "indexed" in statuses

    def test_ingest_zip(self, sample_kb, embedder):
        import zipfile
        import io

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("docs/file1.txt", "Hello from file 1. " * 20)
            zf.writestr("docs/file2.txt", "Hello from file 2. " * 20)
            zf.writestr(".DS_Store", "hidden")
        zip_bytes = buf.getvalue()

        results = ingest_zip(
            kb_id=sample_kb["id"],
            zip_bytes=zip_bytes,
            embedder=embedder,
        )
        assert len(results) == 2
        assert all(r["status"] == "indexed" for r in results)


# ---------------------------------------------------------------------------
# C) Retrieval tests
# ---------------------------------------------------------------------------

class TestRetrieval:
    def _setup_kb_with_data(self, sample_kb, embedder):
        """Helper: create a KB with some indexed documents."""
        from app.kb_models import update_document_status

        doc = create_document(
            kb_id=sample_kb["id"],
            filename="knowledge.txt",
            content_hash="retrieval_test_hash",
            size_bytes=100,
        )
        chunks_data = [
            {"chunk_index": 0, "text": "Python is a programming language used for AI and web development.",
             "text_hash": "r1", "start_offset": 0, "end_offset": 65},
            {"chunk_index": 1, "text": "Machine learning uses algorithms to learn patterns from data.",
             "text_hash": "r2", "start_offset": 66, "end_offset": 127},
            {"chunk_index": 2, "text": "FastAPI is a modern Python web framework for building APIs.",
             "text_hash": "r3", "start_offset": 128, "end_offset": 187},
        ]
        insert_chunks(doc["id"], chunks_data)
        stored_chunks = get_chunks_for_doc(doc["id"])

        model_id = type(embedder).__name__
        for c in stored_chunks:
            vec = embedder.embed_one(c["text"])
            insert_embedding(c["id"], model_id, vec.astype(np.float32).tobytes())

        update_document_status(doc["id"], "indexed")
        return doc, stored_chunks

    def test_retrieve_kb_chunks(self, sample_kb, embedder):
        self._setup_kb_with_data(sample_kb, embedder)
        results = retrieve_kb_chunks(
            kb_id=sample_kb["id"],
            query="What programming language is good for AI?",
            top_k=3,
            embedder=embedder,
        )
        assert len(results) > 0
        assert all(isinstance(r, KBChunkResult) for r in results)
        assert results[0].score > 0

    def test_retrieve_empty_kb(self, sample_kb, embedder):
        results = retrieve_kb_chunks(
            kb_id=sample_kb["id"],
            query="anything",
            top_k=3,
            embedder=embedder,
        )
        assert results == []

    def test_build_kb_context(self):
        chunks = [
            KBChunkResult(chunk_id="c1", doc_id="d1", filename="test.pdf",
                          page_range="p.1", text_snippet="Some text.", score=0.9),
            KBChunkResult(chunk_id="c2", doc_id="d1", filename="test.pdf",
                          page_range="p.2", text_snippet="More text.", score=0.8),
        ]
        ctx = _build_kb_context(chunks, max_chars=500)
        assert "[KB-1]" in ctx
        assert "[KB-2]" in ctx
        assert "test.pdf" in ctx

    def test_build_web_context(self):
        cards = [
            {"title": "Article 1", "url": "https://example.com", "snippet": "Web content here."},
            {"title": "Article 2", "url": "https://other.com", "snippet": "Other content."},
        ]
        ctx = _build_web_context(cards, max_chars=500)
        assert "[WEB-1]" in ctx
        assert "[WEB-2]" in ctx


# ---------------------------------------------------------------------------
# D) Citation verifier tests
# ---------------------------------------------------------------------------

class TestCitationVerifier:
    def test_valid_citation_passes(self):
        chunks = [
            KBChunkResult(chunk_id="c1", doc_id="d1", filename="f.txt",
                          text_snippet="Python is great for machine learning.", score=0.9),
        ]
        response = RAGResponse(
            answer_markdown="Python is useful.",
            citations=RAGCitations(
                kb=[KBCitation(chunk_id="c1", doc_id="d1", quote="Python is great for machine learning", used_in=["S1"])],
                web=[],
            ),
        )
        verified = _verify_citations(response, chunks, [])
        assert len(verified.citations.kb) == 1
        assert "[unverified]" not in verified.citations.kb[0].quote

    def test_invalid_citation_marked(self):
        chunks = [
            KBChunkResult(chunk_id="c1", doc_id="d1", filename="f.txt",
                          text_snippet="Python is great for machine learning.", score=0.9),
        ]
        response = RAGResponse(
            answer_markdown="Something",
            citations=RAGCitations(
                kb=[KBCitation(chunk_id="c1", doc_id="d1",
                               quote="Completely unrelated quote about cooking", used_in=["S1"])],
                web=[],
            ),
        )
        verified = _verify_citations(response, chunks, [])
        assert "[unverified]" in verified.citations.kb[0].quote

    def test_web_citation_verification(self):
        cards = [{"card_id": "w1", "snippet": "AI is transforming healthcare", "quote": ""}]
        response = RAGResponse(
            answer_markdown="Healthcare uses AI.",
            citations=RAGCitations(
                kb=[],
                web=[WebCitation(card_id="w1", url="https://example.com",
                                 quote="AI is transforming healthcare", used_in=["S1"])],
            ),
        )
        verified = _verify_citations(response, [], cards)
        assert len(verified.citations.web) == 1
        assert "[unverified]" not in verified.citations.web[0].quote


# ---------------------------------------------------------------------------
# E) Integration test
# ---------------------------------------------------------------------------

class TestIntegration:
    def test_upload_index_query_flow(self, sample_kb, embedder):
        """End-to-end: upload file -> index -> query KB_ONLY."""
        text = (
            "Artificial intelligence encompasses machine learning, deep learning, "
            "and natural language processing. Neural networks are the backbone of "
            "modern AI systems. Transformers revolutionized NLP with attention mechanisms. "
            "Large language models like GPT use transformer architectures for text generation."
        )
        file_bytes = text.encode("utf-8")

        result = ingest_single_file(
            kb_id=sample_kb["id"],
            filename="ai_overview.txt",
            file_bytes=file_bytes,
            embedder=embedder,
        )
        assert result["status"] == "indexed"
        assert result["chunk_count"] > 0

        chunks = retrieve_kb_chunks(
            kb_id=sample_kb["id"],
            query="What are transformers in AI?",
            top_k=3,
            embedder=embedder,
        )
        assert len(chunks) > 0
        all_text = " ".join(c.text_snippet for c in chunks)
        assert any(word in all_text.lower() for word in ["transformer", "neural", "ai", "nlp"])
