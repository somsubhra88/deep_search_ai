# Quick Reference Guide

## 🚀 Getting Started

### One-Line Start
```bash
make start
```

### What This Does
1. Checks for `.env` file
2. Builds Docker images
3. Starts all services
4. Opens:
   - Frontend: http://localhost:3001
   - Backend: http://localhost:8000
   - API Docs: http://localhost:8000/docs

---

## 📋 Essential Commands

| Command | Description |
|---------|-------------|
| `make start` | Start everything (build + run) |
| `make restart` | Restart with fresh build |
| `make stop` | Stop all services |
| `make logs` | View live logs |
| `make clean` | Remove all containers/images |
| `make status` | Check running services |

---

## 🔌 LLM Providers

### Quick Setup

1. **OpenRouter (Recommended)** - 200+ models
   ```bash
   # In .env
   OPENROUTER_API_KEY=sk-or-...
   OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
   ```

2. **OpenAI** - GPT models
   ```bash
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini
   ```

3. **Ollama** - Local models
   ```bash
   OLLAMA_BASE_URL=http://localhost:11434/v1
   OLLAMA_MODEL=llama3.2
   ```

### Available Models

#### OpenRouter (200+ models)
- **Anthropic**: claude-3.5-sonnet, claude-3.5-haiku, claude-4
- **OpenAI**: gpt-4o, gpt-4.1, o3, o1
- **Google**: gemini-2.5-pro, gemini-2.0-flash
- **Meta**: llama-3.3-70b, llama-3.1-405b
- **NVIDIA**: nemotron-4-340b, nemotron-70b
- **DeepSeek**: deepseek-r1, deepseek-chat
- **Mistral**: mistral-large, mixtral-8x22b, codestral
- **Qwen**: qwen-2.5-72b
- And 200+ more!

---

## 🔍 Search Providers

### Option 1: SerpAPI (Google)
```bash
SEARCH_PROVIDER=serpapi
SERPAPI_API_KEY=your_key_here
```

### Option 2: Tavily (AI-focused)
```bash
SEARCH_PROVIDER=tavily
TAVILY_API_KEY=tvly-...
```

### Option 3: SearXNG (Free, no key)
```bash
SEARCH_PROVIDER=searxng
# No API key needed!
```

---

## 🧠 Embedding Providers

### Configuration
```bash
# In .env
EMBEDDING_PROVIDER=auto  # or openai, openrouter, ollama, hash
EMBEDDING_MODEL=text-embedding-3-small
```

### Options
- **auto** - Smart fallback (OpenAI → Hash)
- **openai** - Best quality (1536 dim, requires key)
- **openrouter** - Unified API (requires key)
- **ollama** - Local, private (768 dim, no key)
- **hash** - Offline fallback (256 dim, no key)

---

## 🎯 Research Modes

| Mode | Use Case |
|------|----------|
| **Standard** | General research with multiple perspectives |
| **Debate** | AI agents argue for/against with evidence |
| **Timeline** | Chronological event analysis |
| **Academic** | Citation-focused research |
| **Fact Check** | Multi-source verification |
| **Deep Dive** | Comprehensive exploration |
| **Social Media** | Trend analysis |
| **RAG** | Query your uploaded documents |

---

## 🔐 Security Setup

### Generate Security Keys
```bash
python generate_secrets.py
```

This creates:
- `JWT_SECRET_KEY` - For token signing
- `API_KEY_ENCRYPTION_KEY` - For encrypting API keys

### Manage API Keys

**Option 1: Settings Page (Recommended)**
1. Go to http://localhost:3001/settings
2. Add keys for each provider
3. Keys are AES-256 encrypted in database

**Option 2: Environment Variables**
```bash
# In .env (not encrypted)
OPENAI_API_KEY=sk-...
SERPAPI_API_KEY=...
```

---

## 🐳 Docker Commands

### Basic
```bash
docker-compose up -d          # Start
docker-compose down           # Stop
docker-compose logs -f        # Logs
docker-compose ps             # Status
```

### Advanced
```bash
docker-compose up --build -d  # Rebuild & start
docker-compose down -v        # Stop & remove volumes
docker system prune -a        # Clean everything
```

---

## 🔧 Troubleshooting

### Port Already in Use
```bash
# Change ports in .env
BACKEND_PORT=8001
FRONTEND_PORT=3002
```

### Build Fails
```bash
# Clean and rebuild
make clean
docker system prune -a
make start
```

### Models Not Loading (OpenRouter)
```bash
# Test backend endpoint
curl http://localhost:8000/api/models/openrouter | jq

# Check browser console
# Click refresh button in UI
```

### Reset Everything
```bash
make clean
rm .env
make setup
# Edit .env with your keys
make start
```

---

## 📊 Monitoring

### Health Checks
```bash
# Backend health
curl http://localhost:8000/health

# Frontend
open http://localhost:3001
```

### Logs
```bash
make logs              # All services
make logs-backend      # Backend only
make logs-frontend     # Frontend only
```

### Status
```bash
make status            # Docker containers
docker-compose ps      # Detailed status
```

---

## 🎨 UI Features

### Keyboard Shortcuts
- `Ctrl+K` or `Cmd+K` - Command palette
- `Ctrl+/` or `Cmd+/` - Search history
- `Esc` - Close modals

### Themes
- Toggle dark/light mode in top-right
- Preference saved per user

### Real-time Features
- Live research progress streaming
- Instant model search/filter
- Auto-save research sessions

---

## 📁 File Structure

```
search_agent/
├── backend/          # FastAPI backend
├── frontend/         # Next.js frontend
├── executor-rust/    # Optional Rust executor
├── .env              # Your configuration (DON'T COMMIT)
├── .env.example      # Template
├── docker-compose.yml
├── Makefile          # All commands
└── README.md
```

---

## 🔗 Important URLs

- **Frontend**: http://localhost:3001
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **Interactive API**: http://localhost:8000/redoc

---

## 📞 Support

### Getting Help
1. Check this guide
2. Read [README.md](README.md)
3. Check [CHANGELOG.md](CHANGELOG.md)
4. Open an issue on GitHub

### Common Questions

**Q: Which LLM provider should I use?**
A: OpenRouter is recommended - gives access to 200+ models with one API key.

**Q: Do I need API keys?**
A: Yes, at minimum you need:
- One LLM provider (OpenRouter, OpenAI, etc.)
- One search provider (or use SearXNG for free)

**Q: How much does it cost?**
A: Depends on usage. OpenRouter has competitive pricing. SearXNG is free for search.

**Q: Can I run it offline?**
A: Partially. Use Ollama for LLM + SearXNG for search + hash embeddings.

**Q: Is it production-ready?**
A: Yes! Includes authentication, encryption, rate limiting, and error handling.

---

## 🚀 Next Steps

1. **Start the system**: `make start`
2. **Complete setup wizard** in the UI
3. **Add API keys** in Settings
4. **Try a research query**
5. **Explore different modes**
6. **Upload documents** for RAG mode

---

## 📚 Learn More

- [README.md](README.md) - Full documentation
- [CHANGELOG.md](CHANGELOG.md) - Version history
- [OPENROUTER_IMPLEMENTATION.md](OPENROUTER_IMPLEMENTATION.md) - OpenRouter details
- [LLM_INTEGRATION_FIXES_SUMMARY.md](LLM_INTEGRATION_FIXES_SUMMARY.md) - Recent fixes

---

**Happy Researching! 🎉**
