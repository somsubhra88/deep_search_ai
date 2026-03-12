# LLM Service Provider Model Registry

This directory contains model lists for each LLM provider. These files serve as the source of truth for available models and are automatically updated on application startup.

## How It Works

1. **On Startup**: The backend fetches the latest model lists from each provider's API
2. **Registry Update**: If new models are found, the corresponding `.txt` file is updated
3. **Frontend Loading**: The frontend loads models from the registry and uses them as fallback
4. **Caching**: Model lists are cached for 1 hour to reduce API calls

## File Format

Each file is a simple text file with one model ID per line:

```
gpt-4o
gpt-4o-mini
gpt-4.1
```

## Providers

- `openai.txt` - OpenAI models (GPT-4, o3, etc.)
- `anthropic.txt` - Anthropic Claude models
- `gemini.txt` - Google Gemini models
- `mistral.txt` - Mistral AI models
- `deepseek.txt` - DeepSeek models
- `qwen.txt` - Alibaba Qwen models
- `grok.txt` - xAI Grok models
- `inception.txt` - Inception Labs models
- `openrouter.txt` - OpenRouter unified API (200+ models)
- `ollama.txt` - Ollama local models

## Manual Updates

You can manually edit these files to add or remove models. Changes will be picked up on the next restart. The system will not overwrite your manual changes unless it detects new models from the API.

## Auto-Update on Restart

Every time you restart the application with `make start` or `make restart`, the system will:

1. Check each provider's API for available models
2. Compare with the current registry
3. Update the files if new models are detected
4. Log the changes to the console

This ensures your model lists are always up to date with the latest releases from each provider.
