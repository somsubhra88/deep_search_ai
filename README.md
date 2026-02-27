# Deep Search AI Agent

A modern AI-powered research application that performs deep web searches, scrapes content, and synthesizes structured reports with citations. Built with a multi-agent architecture featuring self-reflection, claim verification, adaptive search depth, and a full Knowledge Base (RAG) pipeline for grounded Q&A over your own documents.

## Features

**Research Modes** (multi-select — combine them)
- **Standard** — Balanced research across diverse sources
- **Debate** — Adversarial pro vs. con analysis with confidence matrix
- **Timeline** — Chronological evolution and historical context
- **Academic** — Scholarly sources, papers, and research-grade analysis
- **Fact Check** — Verify specific claims with evidence-based verdicts
- **Deep Dive** — Exhaustive research with maximum sources and depth
- **Social Media** — Community sentiment, trends, narratives, and hashtag/account signals
- **RAG** — Knowledge Base Q&A: upload your own documents and ask questions grounded in them

**RAG / Knowledge Base**
- Create and manage multiple Knowledge Bases
- Upload files (PDF, DOCX, MD, TXT and more), import folders, or upload zip archives
- Intelligent file detection via magic bytes, MIME sniffing, and printable-character heuristics
- Content-hash caching (SHA-256 on raw bytes) — re-uploading the same file is instant
- Text extraction: PDF (PyMuPDF/pypdf), DOCX (python-docx), text files (with encoding detection)
- Chunking with sentence-aware splitting, overlap, and per-chunk deduplication
- Persistent embeddings stored in SQLite (OpenAI or hash-based fallback)
- Three retrieval scopes: **KB Only**, **Web Only**, **Hybrid** (default)
- Grounded generation with structured citations split by KB vs. Web
- Conflict detection (KB vs. Web disagreements surfaced explicitly)
- Coverage gap analysis with suggested follow-up queries
- Citation verification pass (checks quoted text against source material)
- KG-ready entity/relation extraction for future knowledge graph features

**AI Models**
- OpenAI, Anthropic, Grok, Mistral, Gemini, DeepSeek, Qwen (DashScope), and local Ollama models
- First-run setup modal supports provider selection, model dropdown + custom model ID, and key entry

**Agentic Features**
- **Self-Reflection** — Critic agent evaluates report quality and triggers refinement if needed
- **Claim Verification** — Cross-references key claims against source material
- **Adaptive Search Depth** — Automatically deepens research when results are sparse
- **Follow-Up Questions** — Suggests next research directions you can click to explore
- **Data Void Detection** — Warns about low-quality, echo-chamber, or unverified sources

**Core**
- Live progress streaming via SSE
- Search history and session persistence (localStorage)
- Token usage tracking with cost estimates
- Dark/light theme
- Copy and download reports as Markdown
- Keyboard shortcuts (Cmd+Enter to search, Esc to cancel)
- Safe search filtering
- Snippets-only mode for restricted networks

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, Lucide Icons, Sonner |
| Backend | FastAPI, Python 3.12+, LangChain, SSE |
| AI | OpenAI GPT-4o / Anthropic / Qwen / Ollama, SerpAPI / Tavily |
| Storage | SQLite (WAL mode) for debate sessions, knowledge bases, and semantic cache |
| Deploy | Docker Compose, multi-stage builds |

## Quick Start (Docker)

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- API keys for an LLM provider and a search provider (SerpAPI or Tavily)

### 1. Clone and configure

```bash
git clone <your-repo-url> deep-search-agent
cd deep-search-agent

# Create your config file
make setup
# or: cp .env.example .env
```

Edit `.env` and add your API keys:

```env
OPENAI_API_KEY=sk-your-openai-key
SERPAPI_API_KEY=your-serpapi-key
```

### 2. Start

```bash
make start
# or: docker compose up --build -d
```

### 3. Use

Open **http://localhost:3000** in your browser.

That's it. Both backend and frontend are running with health checks.

On first launch, complete the in-app setup flow:
1. Choose LLM provider + model and provide API key (or Ollama base URL)
2. Choose search provider (SerpAPI or Tavily) and provide key
3. The backend applies settings immediately and persists to `.env` when writable

### Other commands

```bash
make stop        # Stop everything
make restart     # Rebuild and restart
make logs        # Follow live logs
make status      # Check container health
make clean       # Remove containers and images
make dist        # Build clean shareable package in ./dist
```

## Local Development (no Docker)

### Backend

```bash
# Install Python dependencies
uv sync

# Start the backend (auto-reloads on changes)
make dev-backend
# or: cd backend && uv run --project .. uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# or from root: make dev-frontend
```

Open **http://localhost:3000**.

## Configuration

All settings are in `.env`. See `.env.example` for the full list with comments.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | OpenAI model name |
| `OPENAI_TEMPERATURE` | No | `0.3` | LLM temperature (0-1) |
| `ANTHROPIC_API_KEY` | No | — | Anthropic API key |
| `QWEN_API_KEY` | No | — | Alibaba DashScope API key |
| `QWEN_MODEL` | No | `qwen-plus` | Qwen model name |
| `OLLAMA_MODEL` | No | `llama3.2` | Ollama model name |
| `OLLAMA_BASE_URL` | No | `http://host.docker.internal:11434/v1` | Ollama OpenAI-compatible endpoint |
| `SERPAPI_API_KEY` | Yes* | — | SerpAPI key (*or use Tavily) |
| `SERPAPI_GL` | No | `us` | Google search country |
| `SERPAPI_HL` | No | `en` | Google search language |
| `SEARCH_PROVIDER` | No | `serpapi` | `serpapi` or `tavily` |
| `TAVILY_API_KEY` | No | — | Tavily API key (if using Tavily) |
| `SSL_VERIFY` | No | `true` | Set `false` for corporate proxies |
| `DEBUG_TRACEBACK` | No | `false` | Include full backend tracebacks in API errors (dev only) |
| `TRUST_PROXY_HEADERS` | No | `false` | Trust `X-Forwarded-For` only when behind known proxy |
| `TRUSTED_PROXY_IPS` | No | `127.0.0.1,::1` | Comma-separated proxy IP allowlist |
| `BACKEND_PORT` | No | `8000` | Backend port (Docker) |
| `FRONTEND_PORT` | No | `3000` | Frontend port (Docker) |

## Distribution

Build a clean distributable package (without local secrets, local memory data, or build artifacts):

```bash
make dist
```

Outputs:
- `dist/deep-search-agent/` (clean project copy)
- `dist/deep-search-agent.tar.gz` (archive to share)

Before sharing, verify:
- `.env` is not included
- no API keys are present in packaged files
- `chroma_data/memory_store.json` is not included

## API

### `GET /health`

Returns `{"status": "ok", "version": "0.2.0"}`.

### `POST /api/research`

Streams research progress via Server-Sent Events.

```json
{
  "query": "AI safety research",
  "use_snippets_only": false,
  "safe_search": true,
  "modes": ["standard", "academic"],
  "model_id": "openai"
}
```

**Modes**: `standard`, `debate`, `timeline`, `academic`, `fact_check`, `deep_dive`, `social_media`, `rag`
**Models**: `openai`, `anthropic`, `grok`, `mistral`, `gemini`, `deepseek`, `qwen`, `ollama`

### Knowledge Base Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/kb/create` | Create a knowledge base (`{name, description}`) |
| `GET` | `/api/kb/list` | List all knowledge bases |
| `GET` | `/api/kb/{kb_id}/docs` | List documents in a KB |
| `DELETE` | `/api/kb/{kb_id}` | Delete a knowledge base |
| `DELETE` | `/api/kb/{kb_id}/doc/{doc_id}` | Remove a document from a KB |
| `POST` | `/api/kb/{kb_id}/upload` | Upload files (multipart) |
| `POST` | `/api/kb/{kb_id}/upload-directory` | Upload directory contents (multipart with relative paths) |
| `POST` | `/api/kb/{kb_id}/upload-zip` | Upload and extract a zip archive |

Upload responses include per-file status:

```json
{
  "kb_id": "...",
  "results": [
    {"filename": "paper.pdf", "content_hash": "...", "doc_id": "...", "status": "indexed", "chunk_count": 42},
    {"filename": "notes.txt", "content_hash": "...", "doc_id": "...", "status": "skipped_cached", "message": "File already indexed"}
  ],
  "total_files": 2,
  "indexed": 1,
  "skipped_cached": 1,
  "failed": 0
}
```

### RAG Query Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/rag/query` | Synchronous RAG query |
| `POST` | `/api/rag/query/stream` | SSE streaming RAG query |

Request body:

```json
{
  "kb_id": "...",
  "query": "What does the paper say about transformer architectures?",
  "scope": "HYBRID",
  "top_k_kb": 6,
  "top_k_web": 4,
  "model_id": "openai"
}
```

**Scopes**: `KB_ONLY`, `WEB_ONLY`, `HYBRID` (default)

Response:

```json
{
  "answer_markdown": "According to [KB-1], transformers use self-attention...",
  "citations": {
    "kb": [{"chunk_id": "...", "doc_id": "...", "filename": "paper.pdf", "quote": "...", "used_in": ["S1"]}],
    "web": [{"card_id": "...", "url": "...", "quote": "...", "used_in": ["S2"]}]
  },
  "conflicts": [{"statement": "...", "kb_support": ["..."], "web_support": ["..."], "note": "..."}],
  "coverage_gaps": [{"gap": "...", "suggested_query": "..."}]
}
```

SSE events for streaming: `rag.started`, `rag.kb.retrieved`, `rag.web.retrieved`, `rag.generating`, `rag.verifying`, `rag.final`, `rag.error`

## Project Structure

```
deep-search-agent/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, all endpoints, rate limiting, security
│   │   ├── agent.py             # Research pipeline, agentic features
│   │   ├── db.py                # Debate session DB (SQLite)
│   │   ├── kb_models.py         # Knowledge Base DB models + CRUD
│   │   ├── kb_schemas.py        # Pydantic schemas for KB/RAG API
│   │   ├── kb_ingest.py         # File ingestion pipeline (detect, extract, chunk, embed)
│   │   ├── kb_retrieval.py      # RAG retrieval engine (KB/Web/Hybrid + generation)
│   │   ├── memory_graph.py      # Semantic memory storage/recall
│   │   ├── debate_engine.py     # Debate mode orchestrator
│   │   ├── browsing/            # Browser automation
│   │   ├── cache/               # Semantic query cache
│   │   ├── evidence/            # Web evidence collection + distillation
│   │   ├── models/              # Multi-model routing
│   │   ├── rag/                 # Chunking, embeddings, ephemeral store
│   │   ├── rerank/              # BM25 reranking
│   │   ├── schemas/             # Pydantic schemas (evidence, etc.)
│   │   ├── summarize/           # Map-reduce synthesis
│   │   └── tests/               # Test suite (98 tests)
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx         # Main UI (modes, search, reports)
│   │   │   ├── layout.tsx       # Root layout
│   │   │   ├── globals.css      # Tailwind styles
│   │   │   └── api/             # Next.js API proxies (research, debate, kb, rag)
│   │   └── components/
│   │       ├── RAGMode.tsx      # RAG mode UI (KB management, upload, query, results)
│   │       ├── ModeCustomization.tsx
│   │       ├── debate/          # Debate mode components
│   │       └── memory/          # Memory graph components
│   └── Dockerfile
├── docker-compose.yml
├── Makefile
├── requirements.txt
├── pyproject.toml
└── README.md
```

## Data Storage

All persistent data is stored under `data/` (gitignored):

| File | Contents |
|------|----------|
| `data/debate.db` | Debate sessions, agent profiles, messages, artifacts |
| `data/knowledge.db` | Knowledge bases, documents, chunks, embeddings, KG artifacts |
| `data/semantic_cache.db` | Semantic query cache |
| `data/kb_files/<hash>/` | Raw uploaded files (organized by content hash) |

## Security

- SSRF protection blocks requests to private IPs and internal networks
- Per-IP rate limiting (10 requests/minute)
- Input validation and query sanitization
- Security headers (CSP, X-Frame-Options, etc.)
- Error messages sanitized (no API keys or paths leaked)
- Proxy headers are only trusted when explicitly enabled and allowlisted
- Non-root Docker containers
- Secrets excluded from Docker images via `.dockerignore`

## License

MIT
