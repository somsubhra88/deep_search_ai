# 👋 START HERE - Deep Search AI Agent

## 🚀 Quick Start (3 Steps)

### 1️⃣ Setup Environment
```bash
make setup
```
This creates `.env` from template.

### 2️⃣ Add Your API Keys
Edit `.env` and add at minimum:
```bash
# Choose ONE LLM provider:
OPENROUTER_API_KEY=sk-or-...     # RECOMMENDED: 200+ models
# OR
OPENAI_API_KEY=sk-...            # OpenAI only

# Choose ONE search provider:
SERPAPI_API_KEY=...              # Google search
# OR
TAVILY_API_KEY=tvly-...          # AI search
# OR
SEARCH_PROVIDER=searxng          # FREE (no key needed)
```

### 3️⃣ Start Everything
```bash
make start
```

**That's it!** Open http://localhost:3001 and start researching!

---

## 🎯 What Can It Do?

### 🤖 200+ AI Models
- **OpenRouter** - One API, 200+ models from:
  - Anthropic Claude (all versions)
  - OpenAI GPT (4o, 4.1, o3, o1)
  - Google Gemini (2.5 Pro/Flash)
  - Meta Llama (3.3-70B, 3.1-405B)
  - **NVIDIA** (Nemotron-4-340B)
  - DeepSeek, Qwen, Mistral
  - And 180+ more!

### 📚 8 Research Modes
1. **Standard** - General research
2. **Debate** - AI agents argue with evidence
3. **Timeline** - Historical analysis
4. **Academic** - Citation-focused
5. **Fact Check** - Verification
6. **Deep Dive** - Comprehensive
7. **Social Media** - Trends
8. **RAG** - Query your documents

### 🔐 Enterprise Features
- JWT authentication
- AES-256 encrypted API keys
- Rate limiting
- Real-time streaming
- Semantic memory
- Document upload (RAG)

---

## 📖 Essential Commands

```bash
make start    # Start everything (build + run)
make restart  # Restart with fresh build
make stop     # Stop all services
make logs     # View live logs
make status   # Check what's running
make clean    # Remove everything
```

---

## 🔌 Recommended Setup

### Option 1: Cloud (Easy)
```bash
# .env configuration
OPENROUTER_API_KEY=sk-or-...     # $5 credit to start
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
SEARCH_PROVIDER=searxng          # FREE
EMBEDDING_PROVIDER=auto          # Smart fallback
```
**Cost**: ~$0.10-$1 per research session depending on model

### Option 2: Hybrid (Balanced)
```bash
# .env configuration
OPENROUTER_API_KEY=sk-or-...     # For LLM
SEARCH_PROVIDER=searxng          # FREE
EMBEDDING_PROVIDER=hash          # FREE, offline
```
**Cost**: Only LLM costs, everything else free

### Option 3: Local (Private)
```bash
# .env configuration
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=llama3.2
SEARCH_PROVIDER=searxng          # FREE
EMBEDDING_PROVIDER=ollama        # FREE, local
```
**Cost**: FREE! Everything runs locally

---

## 🆘 Troubleshooting

### Build Fails
```bash
make clean
docker system prune -a
make start
```

### Port In Use
```bash
# Change in .env
FRONTEND_PORT=3002
BACKEND_PORT=8001
```

### Models Not Loading
```bash
# Test backend
curl http://localhost:8000/api/models/openrouter

# Check logs
make logs
```

---

## 📚 Documentation

- **[README.md](README.md)** - Complete documentation
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - All commands & configs
- **[RECENT_CHANGES.md](RECENT_CHANGES.md)** - What's new in v2.0
- **[CHANGELOG.md](CHANGELOG.md)** - Version history

---

## 🎓 Learn More

### New to OpenRouter?
1. Sign up at https://openrouter.ai
2. Get $5 free credit
3. Use one API key for 200+ models
4. Pay-as-you-go pricing

### Want Local Setup?
1. Install Ollama: https://ollama.ai
2. Pull a model: `ollama pull llama3.2`
3. Set `OLLAMA_BASE_URL` in .env
4. No API keys needed!

---

## 🌟 Key Features

| Feature | Description |
|---------|-------------|
| **Dynamic Models** | 200+ models, auto-fetched, searchable |
| **Multi-Provider** | OpenAI, Anthropic, Google, Meta, NVIDIA |
| **Search & Filter** | Find models instantly |
| **Encrypted Keys** | AES-256 secure storage |
| **Real-time Streaming** | Watch research progress live |
| **8 Research Modes** | Specialized for different needs |
| **RAG Knowledge Base** | Upload & query your documents |
| **Semantic Memory** | Connects related research |

---

## 💡 Quick Tips

1. **Use OpenRouter** - Best value, 200+ models
2. **Try SearXNG** - Free search, no limits
3. **Enable dark mode** - Better for long sessions
4. **Use Debate Mode** - Great for controversial topics
5. **Upload documents** - RAG mode for private data
6. **Check Settings** - Encrypt your API keys

---

## 🚀 Next Steps

1. ✅ Run `make start`
2. ✅ Complete setup wizard in UI
3. ✅ Add API keys in Settings
4. ✅ Try a research query
5. ✅ Explore different modes
6. ✅ Upload a document for RAG

---

## ❓ Need Help?

- **Docs**: Check [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
- **Issues**: GitHub Issues
- **Discord**: Community server
- **Logs**: Run `make logs`

---

**Ready? Let's start researching! 🎉**

```bash
make start
```

Then open: http://localhost:3001

---

*Made with ❤️ by the Deep Search AI team*
