<p align="center">
  <img src="https://img.shields.io/badge/Deep_Search-AI_Agent-10b981?style=for-the-badge&logo=search&logoColor=white" alt="Deep Search AI Agent" />
</p>

<h1 align="center">🔬 Deep Search AI Agent</h1>

<p align="center">
  <strong>AI-powered research that goes deeper.</strong> Multi-agent architecture with self-reflection, claim verification, and RAG over your documents.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" />
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat-square&logo=fastapi" />
  <img src="https://img.shields.io/badge/Python-3.12+-3776AB?style=flat-square&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?style=flat-square&logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" />
</p>

---

## 📑 Table of Contents

- [🎬 Video Demo](#-video-demo)
- [✨ Features](#-features)
- [🛠️ Tech Stack](#️-tech-stack)
- [🚀 Quick Start](#-quick-start-docker)
- [⚙️ Configuration](#-configuration)
- [📁 Project Structure](#-project-structure)
- [🔒 Security](#-security)
- [📄 API Reference](#-api-reference)
- [🤖 Assistant Usage](#-assistant-usage)
- [📦 Distribution](#-distribution)

---

## 🎬 Video Demo

> **📹 Demo video coming soon!**  
> A walkthrough of the Deep Search AI Agent will be uploaded here. Stay tuned for:
> - Live research flow with multiple modes
> - RAG Knowledge Base setup and Q&A
> - Debate mode in action
> - Assistant with real tool execution

<!-- 
  PLACEHOLDER: Add your video here when ready.
  Example formats:
  - YouTube: [![Demo](https://img.youtube.com/vi/YOUR_VIDEO_ID/maxresdefault.jpg)](https://www.youtube.com/watch?v=YOUR_VIDEO_ID)
  - Direct link: <video src="path/to/demo.mp4" controls width="100%"></video>
-->

<div align="center">
  <img src="https://placehold.co/800x450/0f172a/64748b?text=Video+Demo+Coming+Soon&font=roboto" alt="Video placeholder" width="80%" style="border-radius: 12px; border: 2px dashed #475569;" />
</div>

---

## ✨ Features

### 🔍 Research Modes *(multi-select — combine them)*

| Mode | Description |
|------|-------------|
| **Standard** | Balanced research across diverse sources |
| **Debate** | Adversarial pro vs. con analysis with confidence matrix |
| **Timeline** | Chronological evolution and historical context |
| **Academic** | Scholarly sources, papers, and research-grade analysis |
| **Fact Check** | Verify specific claims with evidence-based verdicts |
| **Deep Dive** | Exhaustive research with maximum sources and depth |
| **Social Media** | Community sentiment, trends, narratives, hashtag/account signals |
| **RAG** | Knowledge Base Q&A: upload documents and ask grounded questions |

### 📚 RAG / Knowledge Base

- Create and manage multiple Knowledge Bases
- Upload files (PDF, DOCX, MD, TXT and more), import folders, or zip archives
- Intelligent file detection via magic bytes, MIME sniffing, and heuristics
- Content-hash caching (SHA-256) — re-uploading the same file is instant
- Text extraction: PDF (PyMuPDF/pypdf), DOCX (python-docx), text with encoding detection
- Chunking with sentence-aware splitting, overlap, and per-chunk deduplication
- Persistent embeddings in SQLite (OpenAI or hash-based fallback)
- Three retrieval scopes: **KB Only**, **Web Only**, **Hybrid** (default)
- Conflict detection (KB vs. Web disagreements surfaced explicitly)
- Citation verification pass and coverage gap analysis

### 🤖 AI Models

OpenAI, Anthropic, Grok, Mistral, Gemini, DeepSeek, Qwen (DashScope), Inception Labs, and local Ollama. First-run setup modal for provider selection and key entry.

### 🤖 AI Assistant

A multi-skill assistant that can take real actions on your computer via a local Rust executor.

| Skill | Description |
|-------|-------------|
| **Notes & Tasks** | Add, complete, and manage to-do items. Data persists locally in the browser. |
| **Calendar** | Add events, view today's agenda, find free time slots, weekly overview. |
| **Files & Folders** | Scan a local folder, list files by type (CSV, PDF, etc.), organise into subfolders, find large/duplicate/old files, generate archive and cleanup scripts. |
| **Email** | Connect Gmail (OAuth, read-only) to summarise unread, clean newsletters, search inbox. |
| **Research** | Query and synthesise findings from past Deep Search sessions. |
| **Actions** | Execute real operations via the Rust executor: list/read/write/delete files, create/search notes, run shell commands, copy to clipboard. Destructive actions (delete, shell) require explicit approval. |

**How it works:**
1. User sends a natural-language message (e.g. "put data.csv in trash")
2. The backend LLM selects the appropriate tool and parameters
3. The Rust executor runs the tool with policy enforcement (risk levels R0-R3)
4. Destructive actions (R2/R3) trigger an approval prompt in the UI
5. Results stream back via SSE with undo support

### 🧠 Agentic Features

- **Self-Reflection** — Critic agent evaluates report quality and triggers refinement
- **Claim Verification** — Cross-references key claims against source material
- **Adaptive Search Depth** — Automatically deepens research when results are sparse
- **Follow-Up Questions** — Suggests next research directions you can click to explore
- **Data Void Detection** — Warns about low-quality, echo-chamber, or unverified sources

### ⚡ Core

Live progress streaming via SSE • Search history and session persistence • Token usage tracking • Dark/light theme • Copy and download reports as Markdown • Keyboard shortcuts (⌘+Enter to search, Esc to cancel) • Safe search filtering • Snippets-only mode for restricted networks

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16, React 19, Tailwind CSS 4, Lucide Icons, Sonner |
| **Backend** | FastAPI, Python 3.12+, LangChain, SSE |
| **AI** | OpenAI GPT-4o / Anthropic / Qwen / Ollama / Inception, SerpAPI / Tavily |
| **Storage** | SQLite (WAL mode) for debate sessions, knowledge bases, semantic cache |
| **Executor** | Rust (Axum), 16 tools with sandbox, approval flows, undo/rollback |
| **Deploy** | Docker Compose, multi-stage builds, Redis, Rust executor |

---

## 🚀 Quick Start (Docker)

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

---

## ⚙️ Configuration

All settings are in `.env`. See `.env.example` for the full list with comments.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | OpenAI model name |
| `SERPAPI_API_KEY` | Yes* | — | SerpAPI key (*or use Tavily) |
| `SEARCH_PROVIDER` | No | `serpapi` | `serpapi` or `tavily` |
| `TAVILY_API_KEY` | No | — | Tavily API key (if using Tavily) |
| `SSL_VERIFY` | No | `true` | Set `false` for corporate proxies |
| `BACKEND_PORT` | No | `8000` | Backend port (Docker) |
| `FRONTEND_PORT` | No | `3000` | Frontend port (Docker) |
| `EXECUTOR_URL` | No | `http://127.0.0.1:7777` | Rust executor URL for Assistant actions |

---

## 📁 Project Structure

```
deep-search-agent/
├── backend/               # FastAPI app, research pipeline, KB, debate
│   ├── app/
│   │   ├── main.py                # Endpoints, rate limiting, security
│   │   ├── agent.py               # Research pipeline, agentic features
│   │   ├── assistant_agent.py     # LLM-based tool selection for assistant
│   │   ├── executor_client.py     # Rust executor HTTP client
│   │   ├── kb_*.py                # Knowledge Base models, ingest, retrieval
│   │   ├── debate_engine.py       # Debate mode orchestrator
│   │   └── ...
│   └── Dockerfile
├── executor-rust/         # Rust local executor (Axum, 16 tools)
│   ├── src/
│   │   ├── main.rs                # HTTP server, approval flow, SSE events
│   │   ├── models.rs              # Request/response types, tool enum
│   │   ├── policy.rs              # Risk levels, workspace sandbox, ~ expansion
│   │   ├── tools/                 # fs, shell, net, notes, clipboard, archive
│   │   ├── approval.rs            # Pending approval store with oneshot channels
│   │   ├── audit.rs               # JSONL audit logs with secret redaction
│   │   ├── rollback.rs            # Undo/backup store
│   │   ├── scheduler.rs           # SQLite-backed scheduled tasks
│   │   └── config.rs              # Cross-OS storage paths
│   ├── Cargo.toml
│   └── Dockerfile
├── frontend/              # Next.js app
│   ├── src/app/
│   │   ├── assistant/page.tsx     # Multi-skill assistant UI
│   │   ├── search/page.tsx        # Research UI
│   │   └── api/assistant/         # API route proxies (act, approve, status, events)
│   └── Dockerfile
├── docker-compose.yml
├── Makefile
└── README.md
```

---

## 🔒 Security

- **SSRF protection** — Blocks requests to private IPs and internal networks
- **Per-IP rate limiting** — 10 requests/minute
- **Input validation** — Query sanitization, UUID validation for run IDs, control character stripping
- **Security headers** — CSP, X-Frame-Options, X-Content-Type-Options, etc.
- **Error sanitization** — No API keys or paths leaked in responses
- **Proxy headers** — Trusted only when explicitly enabled and allowlisted
- **Non-root Docker** — Containers run as non-root
- **Secrets excluded** — `.env` and API keys excluded from images via `.dockerignore`
- **Executor sandbox** — Workspace-scoped file access, `~` expansion with home-dir validation, path traversal prevention
- **Risk-based approval** — Tools classified R0 (read) to R3 (shell/download); R2+ require user approval
- **Audit logging** — All tool executions logged to JSONL with automatic secret redaction
- **Download safety** — URL scheme validation (http/https only), localhost/private host blocking
- **Shell limits** — Command length capped at 8KB, notes title/folder sanitized against traversal

> ⚠️ **Never commit `.env`** — It contains API keys. Ensure it is in `.gitignore`.

---

## 📄 API Reference

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
**Models**: `openai`, `anthropic`, `grok`, `mistral`, `gemini`, `deepseek`, `qwen`, `ollama`, `inception`

### Knowledge Base Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/kb/create` | Create a knowledge base |
| `GET` | `/api/kb/list` | List all knowledge bases |
| `GET` | `/api/kb/{kb_id}/docs` | List documents in a KB |
| `DELETE` | `/api/kb/{kb_id}` | Delete a knowledge base |
| `POST` | `/api/kb/{kb_id}/upload` | Upload files (multipart) |
| `POST` | `/api/kb/{kb_id}/upload-zip` | Upload and extract zip archive |

### RAG Query

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/rag/query` | Synchronous RAG query |
| `POST` | `/api/rag/query/stream` | SSE streaming RAG query |

**Scopes**: `KB_ONLY`, `WEB_ONLY`, `HYBRID` (default)

### Assistant Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/assistant/status` | Check if the Rust executor is available |
| `POST` | `/api/assistant/act` | Execute an action from a natural-language message |
| `POST` | `/api/assistant/approve` | Approve or deny a pending destructive action |
| `GET` | `/api/assistant/runs/{run_id}/events` | SSE stream for run events (approval prompts, results) |

**Act request:**

```json
{
  "message": "list files in ~/Downloads",
  "run_id": "optional-uuid",
  "context": { "path": "~/Downloads" }
}
```

**Available tools**: `fs_list`, `fs_read`, `fs_stat`, `fs_write`, `fs_append`, `fs_copy`, `fs_move`, `fs_rename`, `fs_delete`, `net_download`, `archive_extract`, `shell_run`, `notes_create`, `notes_update`, `notes_search`, `clipboard_read`, `clipboard_write`

### Executor (Rust)

The executor runs on `127.0.0.1:7777` (local) or `executor:7777` (Docker) and provides:

- **16 tools** with workspace sandbox enforcement
- **Policy engine** — R0-R3 risk classification, rule-based auto-allow/deny
- **Approval flow** — Destructive actions pause and wait for user confirmation via SSE
- **Undo/rollback** — File operations create backups; undo via `/v1/undo`
- **Scheduled tasks** — SQLite-backed scheduler for deferred tool execution
- **Audit trail** — JSONL logs per run with automatic secret redaction

---

## 🤖 Assistant Usage

The Assistant is available at `/assistant` in the web UI. It provides six skills accessible from the sidebar.

### Getting started

1. **Start the stack**: `make start` (Docker) or run backend + frontend + executor separately
2. Navigate to **http://localhost:3000/assistant**
3. Select a skill from the sidebar and start chatting

### Files & Folders skill

1. Click **"Scan a folder"** and select a folder (e.g. Downloads)
2. Ask natural-language questions:
   - "List CSV files" / "Please list down the CSV files"
   - "Organise my files into subfolders"
   - "Generate a script to archive old stale files"
   - "Remove large files" / "Generate script for large files"
   - "Remove duplicates"
3. The assistant generates ready-to-run bash scripts you can copy and execute

### Actions skill (requires executor)

The Actions skill connects to the Rust executor for real operations:

```
cd executor-rust && cargo run    # Start executor locally
```

Or via Docker (`make start` handles this automatically).

Example commands:
- "List files in ~/Downloads"
- "Read the file ~/notes.txt"
- "Put data.csv in trash" (requires approval)
- "Create a note titled Meeting Notes with content ..."
- "Search notes for project"
- "Run ls -la in ~/Documents" (requires approval)

Destructive actions show an **Approve / Deny** prompt at the bottom of the chat.

### Tasks skill

- "Add task: Buy groceries"
- "Show my tasks"
- "Complete Buy groceries" or "Done #1"
- "Clear completed"
- "What's next?"

### Calendar skill

- "Add event: Team standup tomorrow at 10am"
- "Today's agenda"
- "This week"
- "Free slots"

### Email skill

1. Click **"Connect Email"** in the sidebar
2. Sign in with Google (read-only OAuth)
3. "Summarise my unread emails"
4. "Search for emails about project deadline"

---

## 📦 Distribution

Build a clean distributable package (no secrets, no build artifacts):

```bash
make dist
```

Outputs:
- `dist/deep-search-agent/` — Clean project copy
- `dist/deep-search-agent.tar.gz` — Archive to share

Before sharing, verify `.env` is not included and no API keys are present.

---

## License

**MIT**
