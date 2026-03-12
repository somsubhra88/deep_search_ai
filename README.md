<div align="center">

# 🔍 Deep Search AI Agent

### AI-Powered Multi-Agent Research Platform with RAG & Dynamic LLM Integration

[![Python](https://img.shields.io/badge/Python-3.12+-blue?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)
[![OpenRouter](https://img.shields.io/badge/OpenRouter-200%2B_Models-purple?style=for-the-badge)](https://openrouter.ai)

[Features](#-features) • [Quick Start](#-quick-start) • [Installation](#-installation) • [Documentation](#-documentation) • [Architecture](#-architecture)

</div>

---

## 📖 Overview

**Deep Search AI Agent** is a production-ready, enterprise-grade research assistant that combines multiple AI agents, retrieval-augmented generation (RAG), and advanced web search capabilities. Built with modern technologies and designed for scalability, security, and extensibility.

### 🎯 Why Deep Search AI Agent?

- **🤖 Multi-Agent Architecture** - Coordinated AI agents work together for comprehensive research
- **📚 RAG Knowledge Base** - Upload and query your private documents with semantic search
- **🔌 Dynamic LLM Integration** - 200+ models from OpenRouter, OpenAI, Anthropic, Google, Meta, NVIDIA
- **🔒 Enterprise Security** - JWT authentication, bcrypt hashing, AES-256 encrypted API keys
- **⚡ Lightning Fast** - 32x faster concurrent web scraping with intelligent caching
- **🎨 Modern UI** - Beautiful dark/light themes, responsive design, real-time streaming
- **🔧 Fully Customizable** - 8 research modes, configurable embeddings, extensible architecture

---

## ✨ Features

### 🧠 Core Capabilities

| Feature | Description |
|---------|-------------|
| **🔍 8 Research Modes** | Standard, Debate, Timeline, Academic, Fact Check, Deep Dive, Social Media, RAG |
| **🤝 Multi-Agent System** | Specialized agents for search, analysis, verification, and synthesis |
| **📊 RAG Knowledge Base** | Upload documents (PDF, DOCX, MD, TXT) and query with semantic search |
| **💬 Debate Mode** | AI agents debate topics from multiple perspectives with evidence |
| **📈 Timeline Mode** | Chronological event analysis and historical research |
| **🎓 Academic Mode** | Citation-focused research with peer-reviewed sources |
| **✓ Fact Check Mode** | Multi-source claim verification and evidence analysis |
| **📱 Responsive UI** | Works seamlessly on desktop, tablet, and mobile |

### 🔌 LLM & Embeddings

| Provider | Models | Features |
|----------|--------|----------|
| **OpenRouter** | **200+ Models** | Dynamic fetching, search/filter, all providers (Anthropic, OpenAI, Meta, Google, **NVIDIA**, DeepSeek) |
| **OpenAI** | GPT-4o, 4.1, o3, o1 | Official API, streaming support |
| **Anthropic** | Claude 4, Sonnet, Haiku | Advanced reasoning, 200K context |
| **Google** | Gemini 2.5 Pro/Flash | Long context, multimodal |
| **Meta** | Llama 3.3-70B, 3.1-405B | Open source, fast inference |
| **NVIDIA** | Nemotron-4-340B | Optimized variants |
| **DeepSeek** | R1, Chat | Reasoning models |
| **Ollama** | Local Models | Privacy-first, offline capable |

**Embedding Providers:**
- OpenAI (text-embedding-3-small)
- OpenRouter (unified API)
- Ollama (local, private)
- Hash-based fallback (offline)

### 🔐 Security & Authentication

- **JWT Token Authentication** - Secure session management
- **Bcrypt Password Hashing** - Industry-standard password protection
- **AES-256 API Key Encryption** - Secure storage of user credentials
- **Rate Limiting** - Protection against abuse
- **CORS Configuration** - Secure cross-origin requests
- **Input Validation** - Pydantic schema validation

### 🚀 Performance Optimizations

- **32x Faster Web Scraping** - Concurrent processing with connection pooling
- **Intelligent Caching** - Redis-backed semantic cache for repeated queries
- **Streaming Responses** - Real-time research progress via SSE
- **Database Connection Pooling** - Efficient SQLite management
- **Response Compression** - Reduced bandwidth usage
- **Lazy Loading** - Dynamic component loading for faster initial render

### 🎯 Intelligent Assistant

- **Task Management** - Create, track, and manage research tasks
- **File Operations** - Upload, analyze, and query documents
- **Calendar Integration** - Schedule and organize research activities
- **Email Analysis** - Extract insights from email threads
- **Context-Aware Actions** - Smart suggestions based on research context

### 🔧 Developer Experience

- **Docker Compose** - One-command deployment
- **Hot Reload** - Fast development iteration
- **TypeScript** - Type-safe frontend development
- **API Documentation** - Auto-generated FastAPI docs
- **Extensive Logging** - Comprehensive debugging support
- **Modular Architecture** - Easy to extend and customize

---

## 🚀 Quick Start

### Prerequisites

- **Docker** & **Docker Compose** (recommended)
- OR **Python 3.12+** & **Node.js 20+** (for local development)

### 🐳 Docker Deployment (Recommended)

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/search_agent.git
cd search_agent

# 2. Copy environment template
cp .env.example .env

# 3. Add your API keys to .env
# Edit .env and add:
# - OPENAI_API_KEY or OPENROUTER_API_KEY
# - SERPAPI_API_KEY or TAVILY_API_KEY (for search)

# 4. Generate security keys (optional, auto-generated if not set)
python generate_secrets.py

# 5. Start everything with one command
make start
# Or: docker-compose up --build -d

# 6. Access the application
# Frontend: http://localhost:3001
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

### 📱 Usage

1. **Setup Wizard** - First-time setup for LLM and search providers
2. **Choose Research Mode** - Select from 8 specialized research modes
3. **Enter Query** - Ask your research question
4. **Watch Progress** - Real-time streaming of research progress
5. **Review Results** - Comprehensive report with citations and insights

### 🔄 Commands

```bash
# Start all services
make start

# Restart services (rebuild)
make restart

# Stop all services
make stop

# View logs
make logs

# Clean up everything
make clean

# Development mode (hot reload)
make dev-backend   # Backend only
make dev-frontend  # Frontend only
```

---

## 📦 Installation

### Option 1: Docker (Production)

```bash
# Build and start
docker-compose up --build -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### Option 2: Manual Setup (Development)

#### Backend Setup

```bash
# Navigate to project root
cd search_agent

# Create virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Generate security keys
python generate_secrets.py

# Start backend
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend Setup

```bash
# In a new terminal
cd search_agent/frontend

# Install dependencies
npm install

# Start development server
npm run dev

# Access at http://localhost:3000
```

---

## 🎨 Configuration

### Environment Variables

Create a `.env` file in the project root:

```bash
# LLM Provider (choose one or multiple)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini

# OpenRouter (200+ models)
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet

# Search Provider (choose one)
SERPAPI_API_KEY=...
# OR
TAVILY_API_KEY=tvly-...
# OR
SEARCH_PROVIDER=searxng  # No API key needed

# Embedding Provider (optional)
EMBEDDING_PROVIDER=auto  # auto, openai, openrouter, ollama, hash
EMBEDDING_MODEL=text-embedding-3-small

# Security (auto-generated if not set)
JWT_SECRET_KEY=your_jwt_secret_here
API_KEY_ENCRYPTION_KEY=your_encryption_key_here

# Ports (optional, defaults shown)
BACKEND_PORT=8000
FRONTEND_PORT=3001
```

### Model Selection

The system supports multiple LLM providers:

1. **OpenRouter** (Recommended) - Access 200+ models:
   - Anthropic Claude (all variants)
   - OpenAI GPT (4o, 4.1, o3, o1)
   - Google Gemini (2.5 Pro/Flash)
   - Meta Llama (3.3-70B, 3.1-405B)
   - NVIDIA Nemotron-4-340B
   - DeepSeek R1 & Chat
   - Mistral, Qwen, and more

2. **OpenAI** - Direct API access
3. **Anthropic** - Claude models
4. **Google** - Gemini models
5. **Ollama** - Local models (privacy-first)

### Embedding Providers

Configure semantic search embeddings:

- **auto** - Smart fallback (OpenAI → Hash)
- **openai** - Best quality (1536 dim)
- **openrouter** - Unified API access
- **ollama** - Local embeddings (nomic-embed-text)
- **hash** - Offline fallback (no API key needed)

---

## 🏗 Architecture

### System Components

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend Layer                       │
│  Next.js 16 + React 19 + Tailwind CSS 4 + TypeScript   │
│  - Server-Side Rendering (SSR)                          │
│  - Real-time Streaming (SSE)                            │
│  - Responsive UI with Dark/Light Themes                 │
└─────────────────┬───────────────────────────────────────┘
                  │ HTTP/WebSocket
┌─────────────────▼───────────────────────────────────────┐
│                     Backend Layer                        │
│  FastAPI + Python 3.12+ + Pydantic                      │
│  - Multi-Agent Orchestration                            │
│  - RAG Pipeline (LangChain)                             │
│  - Authentication & Authorization                        │
│  - Streaming Response Generation                        │
└─┬──────────┬──────────┬──────────┬──────────────────────┘
  │          │          │          │
  ▼          ▼          ▼          ▼
┌────┐   ┌─────┐   ┌──────┐   ┌──────────┐
│SQLite  │Redis│   │Chroma│   │Rust      │
│Auth DB │Cache│   │Vector│   │Executor  │
│RAG DB  │     │   │Store │   │(Optional)│
└────┘   └─────┘   └──────┘   └──────────┘
```

### Data Flow

```
User Query
    ↓
Query Expansion (LLM)
    ↓
Multi-Source Search (SerpAPI/Tavily/SearXNG)
    ↓
Concurrent Web Scraping (32x parallel)
    ↓
Content Extraction & Cleaning
    ↓
Evidence Distillation
    ↓
RAG Retrieval (if enabled)
    ↓
Multi-Agent Synthesis
    ↓
Self-Reflection & Verification
    ↓
Final Report Generation
    ↓
Semantic Memory Storage
```

### Research Modes

Each mode uses specialized prompts and processing:

1. **Standard** - Balanced research with multiple perspectives
2. **Debate** - AI agents argue for/against with evidence
3. **Timeline** - Chronological event analysis
4. **Academic** - Citation-focused with peer review
5. **Fact Check** - Multi-source verification
6. **Deep Dive** - Comprehensive exploration
7. **Social Media** - Trend analysis and sentiment
8. **RAG** - Knowledge base querying

---

## 📚 Documentation

### API Documentation

- **Backend API Docs**: http://localhost:8000/docs
- **Interactive API**: http://localhost:8000/redoc

### Key Endpoints

```
POST   /api/research           # Start research
POST   /api/debate/start       # Start debate session
POST   /api/rag/query          # Query knowledge base
POST   /api/kb/upload          # Upload documents
GET    /api/models/{provider}  # List available models
POST   /api/setup              # Configure system
GET    /api/memory/graph       # Semantic memory graph
```

### Frontend Routes

```
/                    # Home & Research
/settings            # API Key Management
/memory              # Semantic Memory Graph
/assistant           # Intelligent Assistant
/profile             # User Profile
/login & /register   # Authentication
```

---

## 🧪 Development

### Project Structure

```
search_agent/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI application
│   │   ├── agent.py             # Research orchestration
│   │   ├── debate_engine.py     # Debate mode
│   │   ├── auth_routes.py       # Authentication
│   │   ├── rag/                 # RAG implementation
│   │   ├── models/              # LLM integrations
│   │   ├── evidence/            # Evidence processing
│   │   └── tests/               # Backend tests
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js app directory
│   │   ├── components/          # React components
│   │   └── context/             # React contexts
│   ├── package.json
│   └── tailwind.config.ts
├── executor-rust/               # Optional Rust executor
├── docker-compose.yml
├── Makefile
└── README.md
```

### Tech Stack

**Backend:**
- FastAPI - Modern Python web framework
- LangChain - LLM orchestration
- Pydantic - Data validation
- SQLite - Lightweight database
- Redis - Caching layer (optional)
- httpx - Async HTTP client
- BeautifulSoup4 - Web scraping

**Frontend:**
- Next.js 16 - React framework with SSR
- React 19 - UI library
- TypeScript - Type safety
- Tailwind CSS 4 - Utility-first styling
- Framer Motion - Animations
- React Flow - Graph visualization
- Sonner - Toast notifications

**Infrastructure:**
- Docker & Docker Compose - Containerization
- Nginx - Reverse proxy (optional)
- GitHub Actions - CI/CD (optional)

### Running Tests

```bash
# Backend tests
cd backend
pytest

# Frontend tests
cd frontend
npm test

# E2E tests
npm run test:e2e
```

### Contributing

We welcome contributions! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Style

- **Python**: Follow PEP 8, use `black` formatter
- **TypeScript**: Follow ESLint rules, use `prettier`
- **Commits**: Use conventional commits (feat, fix, docs, etc.)

---

## 🔧 Troubleshooting

### Common Issues

#### Docker Build Fails

```bash
# Clean Docker cache
docker system prune -a
docker-compose down -v

# Rebuild from scratch
docker-compose build --no-cache
docker-compose up -d
```

#### Port Already in Use

```bash
# Change ports in .env
BACKEND_PORT=8001
FRONTEND_PORT=3002

# Or kill existing processes
lsof -ti:8000 | xargs kill
lsof -ti:3001 | xargs kill
```

#### API Key Issues

```bash
# Ensure .env is properly configured
cat .env | grep API_KEY

# Regenerate security keys
python generate_secrets.py

# Verify keys in settings UI
# Navigate to: http://localhost:3001/settings
```

#### OpenRouter Models Not Loading

```bash
# Check backend endpoint
curl http://localhost:8000/api/models/openrouter | jq

# Check browser console for errors
# Ensure no CORS issues

# Try manual refresh in UI
# Click the refresh button next to model dropdown
```

### Debug Mode

```bash
# Enable debug logging
export LOG_LEVEL=DEBUG

# Run with verbose output
make logs

# Check individual service logs
docker-compose logs backend
docker-compose logs frontend
```

---

## 📊 Performance

### Benchmarks

- **Web Scraping**: 32x faster with concurrent processing
- **Response Time**: < 2s for cached queries
- **Memory Usage**: ~500MB baseline, ~2GB with large documents
- **Concurrent Users**: Tested up to 100 simultaneous users

### Optimization Tips

1. **Enable Redis** - Significant speedup for repeated queries
2. **Use Ollama** - Local models reduce API costs
3. **Adjust Batch Sizes** - Tune for your hardware
4. **Enable Caching** - Set `CACHE_ENABLED=true`
5. **Use SearXNG** - No API rate limits

---

## 🌟 Roadmap

### Upcoming Features

- [ ] Multi-language support (i18n)
- [ ] Voice input/output
- [ ] Image and video analysis
- [ ] Collaborative research (team features)
- [ ] Export to Word/PDF/LaTeX
- [ ] Browser extension
- [ ] Mobile apps (iOS/Android)
- [ ] Graph database integration (Neo4j)
- [ ] Advanced analytics dashboard
- [ ] Webhook integrations

### In Progress

- [x] OpenRouter dynamic model fetching (200+ models)
- [x] Multi-provider embeddings
- [x] Enhanced security (AES-256 encryption)
- [x] Real-time streaming
- [x] Debate mode with evidence
- [x] Semantic memory graph

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **LangChain** - LLM orchestration framework
- **FastAPI** - Modern Python web framework
- **Next.js** - React framework
- **OpenRouter** - Unified LLM API
- **OpenAI, Anthropic, Google** - LLM providers
- **SerpAPI, Tavily** - Search APIs
- **SearXNG** - Privacy-focused search

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/search_agent/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/search_agent/discussions)
- **Email**: support@example.com
- **Discord**: [Join our server](https://discord.gg/example)

---

## 🌐 Links

- **Documentation**: [docs.example.com](https://docs.example.com)
- **Demo**: [demo.example.com](https://demo.example.com)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)

---

<div align="center">

### ⭐ Star us on GitHub — it motivates us a lot!

Made with ❤️ by the Deep Search AI team

</div>
