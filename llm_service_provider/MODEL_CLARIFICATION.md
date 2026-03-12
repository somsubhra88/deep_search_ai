# Model Name Clarification

## OpenAI Models

**Current Available Models (as of March 2026):**

### GPT-4o Series (Latest)
- `gpt-4o` - Latest GPT-4 Optimized model
- `gpt-4o-mini` - Smaller, faster variant
- `chatgpt-4o-latest` - Rolling latest version
- Dated versions: `gpt-4o-2024-11-20`, `gpt-4o-2024-08-06`, etc.

### o1 Series (Reasoning Models)
- `o1` - Latest reasoning model
- `o1-preview` - Preview version
- `o1-mini` - Smaller reasoning model

### o3 Series (New Reasoning Models)
- `o3-mini` - Latest small reasoning model (2025)

### GPT-4 Turbo
- `gpt-4-turbo` - Fast GPT-4
- `gpt-4-turbo-preview` - Preview version

### Legacy Models
- `gpt-4` - Original GPT-4
- `gpt-3.5-turbo` - Fast legacy model

**Note:** There is NO "GPT-5" or "GPT-5.x" series yet. The naming goes:
- GPT-3.5 → GPT-4 → GPT-4 Turbo → GPT-4o (Optimized) → o1 (Reasoning) → o3 (New Reasoning)

---

## Google Gemini Models

**Current Available Models (as of March 2026):**

### Gemini 2.5 Series (Latest)
- `gemini-2.5-pro` - Most capable Gemini
- `gemini-2.5-flash` - Fast Gemini 2.5

### Gemini 2.0 Series
- `gemini-2.0-flash-exp` - Experimental flash
- `gemini-2.0-flash-thinking-exp` - Reasoning variant
- `gemini-2.0-flash` - Standard 2.0 flash

### Experimental Models
- `gemini-exp-1206` - December 2024 experiment
- `gemini-exp-1121` - November 2024 experiment

### Gemini 1.5 Series
- `gemini-1.5-pro` - Pro version
- `gemini-1.5-pro-002` - Updated pro
- `gemini-1.5-flash` - Fast version
- `gemini-1.5-flash-002` - Updated flash
- `gemini-1.5-flash-8b` - 8B parameter variant

### Legacy
- `gemini-1.0-pro` - Original Gemini

**Note:** There is NO "Gemini 3" series yet. The current progression is:
- Gemini 1.0 → Gemini 1.5 → Gemini 2.0 → Gemini 2.5

---

## How to Verify Available Models

### Check Registry Files
The txt files in this directory show which models are currently configured.

### Debug Endpoint
Access `http://localhost:8000/api/models/{provider_id}/debug` to see:
- What the API is returning
- What's in the registry
- Whether they match

Example:
```bash
curl http://localhost:8000/api/models/openai/debug
curl http://localhost:8000/api/models/gemini/debug
```

### Force Update
POST to `http://localhost:8000/api/models/registry/update` to force fetch latest models:
```bash
curl -X POST http://localhost:8000/api/models/registry/update
```

---

## If Models Are Missing

1. **Check if the model actually exists** - Verify on the provider's official documentation
2. **Check API key** - Some providers require valid API keys to list models
3. **Force update** - Use the update endpoint or restart the application
4. **Manual edit** - Add the model to the appropriate `.txt` file manually
5. **Check logs** - Look at backend startup logs for error messages

---

## Common Misconceptions

❌ **"OpenAI 5.x models"** - Don't exist. Latest is GPT-4o series and o1/o3 reasoning models.

❌ **"Gemini 3"** - Doesn't exist yet. Latest is Gemini 2.5 series.

❌ **"GPT-5"** - Not released. The progression went GPT-4 → GPT-4o → o1 → o3.

✅ **Always check official documentation** for the most up-to-date model names.
