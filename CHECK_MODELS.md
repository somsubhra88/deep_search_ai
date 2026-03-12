# How to Check and Update Model Lists

## Current Status

### OpenAI Models
Latest models included:
- ✅ GPT-4o series (gpt-4o, gpt-4o-mini, chatgpt-4o-latest)
- ✅ o1 series (o1, o1-preview, o1-mini) - Reasoning models
- ✅ o3-mini - New reasoning model (2025)
- ✅ GPT-4 Turbo and legacy models

**Note:** There is NO "GPT-5.x" series. If you're looking for the latest models, they are:
- GPT-4o (latest language model)
- o1 / o3-mini (reasoning models)

### Google Gemini Models
Latest models included:
- ✅ Gemini 2.5 series (gemini-2.5-pro, gemini-2.5-flash)
- ✅ Gemini 2.0 series with thinking/experimental variants
- ✅ Gemini 1.5 series (pro, flash, flash-8b)

**Note:** There is NO "Gemini 3" yet. Latest is Gemini 2.5 series.

---

## How to Update Models

### Method 1: Restart Application (Automatic)
```bash
make restart
```

This will:
1. Stop all containers
2. Rebuild with latest code
3. Fetch latest models from all provider APIs
4. Update registry files automatically

**Check the logs** for output like:
```
============================================================
Updating model registries from provider APIs...
============================================================
→ Fetching models from OpenAI (openai)...
✓ Updated openai registry: 25 models
→ Fetching models from Google Gemini (gemini)...
✓ Updated gemini registry: 18 models
...
============================================================
Model registry update complete:
  - Updated: 6 providers
  - Skipped: 2 providers
============================================================
```

### Method 2: Force Update Via API (While Running)
```bash
# Force update all model registries
curl -X POST http://localhost:8000/api/models/registry/update
```

### Method 3: Debug Specific Provider
```bash
# Check what models OpenAI API is returning
curl http://localhost:8000/api/models/openai/debug

# Check Gemini models
curl http://localhost:8000/api/models/gemini/debug

# Check OpenRouter models
curl http://localhost:8000/api/models/openrouter/debug
```

This will show you:
- How many models the API returned
- Sample of models
- What's in the registry file
- Whether they match

---

## Troubleshooting

### "Models not showing up"

1. **Check if model names are correct**
   - Read `llm_service_provider/MODEL_CLARIFICATION.md`
   - Verify model exists on provider's official docs

2. **Check API keys**
   ```bash
   # Make sure these are set in your .env file:
   OPENAI_API_KEY=sk-...
   GEMINI_API_KEY=...
   MISTRAL_API_KEY=...
   etc.
   ```

3. **Check logs during startup**
   ```bash
   make logs-backend
   ```
   Look for:
   - ✓ Success messages
   - ⚠ Warning about missing API keys
   - ✗ Error messages

4. **Force refresh**
   ```bash
   # While app is running:
   curl -X POST http://localhost:8000/api/models/registry/update
   ```

5. **Manual override**
   Edit the txt file directly:
   ```bash
   # Add your model to the file
   echo "your-model-name" >> llm_service_provider/openai.txt

   # Restart
   make restart
   ```

---

## Model Naming Reference

### OpenAI
- **Current:** gpt-4o, o1, o3-mini
- **NOT:** gpt-5, gpt-5.2, gpt-5.3 (don't exist)

### Google Gemini
- **Current:** gemini-2.5-pro, gemini-2.5-flash
- **NOT:** gemini-3 (doesn't exist yet)

### If You See Model Names I Don't Recognize

The model lists are fetched from official APIs. If you see a model name in:
- Provider's official documentation
- Provider's playground/API explorer
- But NOT in the app

Then:
1. Check if you have the API key configured
2. Use the debug endpoint to see what API returns
3. Manually add it to the txt file if needed
4. Report it as an issue

---

## Live Testing

Start your app and visit:
- Frontend: http://localhost:3000
- API docs: http://localhost:8000/docs

Try selecting different providers and check:
1. Does the model dropdown populate?
2. Do you see the models you expect?
3. Can you search for models (OpenRouter)?
4. Does refresh button work?

---

## What Models Are Actually Available?

The **source of truth** is:
1. Provider's API (checked on startup)
2. Registry txt files (updated automatically)
3. Frontend static catalog (hardcoded fallback)

Priority: API > Registry > Static Catalog

---

## Need Help?

1. Check `llm_service_provider/MODEL_CLARIFICATION.md` for model naming
2. Use debug endpoints to see API responses
3. Check backend logs for error messages
4. Manually edit txt files if needed
