"""
Test script to check what models are actually returned by provider APIs
Run: python -m app.test_models_api
"""
import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from dotenv import load_dotenv
load_dotenv()

from app.agent import list_available_models, MODEL_REGISTRY

def test_provider_models(provider_id: str):
    """Test fetching models from a specific provider"""
    print(f"\n{'='*60}")
    print(f"Testing: {provider_id}")
    print(f"{'='*60}")

    cfg = MODEL_REGISTRY.get(provider_id)
    if not cfg:
        print(f"❌ Provider {provider_id} not found in registry")
        return

    if not cfg.get("supports_list_models"):
        print(f"⚠️  Provider {provider_id} does not support listing models")
        return

    api_key_env = cfg.get("api_key_env")
    has_key = bool(os.getenv(api_key_env, "")) if api_key_env else True

    if not has_key and provider_id != "openrouter":
        print(f"❌ No API key found for {api_key_env}")
        return

    print(f"Fetching models from {cfg.get('label')}...")
    try:
        models = list_available_models(provider_id, force_refresh=True)
        print(f"\n✅ Found {len(models)} models:\n")

        for i, model in enumerate(models[:20], 1):  # Show first 20
            if isinstance(model, dict):
                model_id = model.get('id', 'unknown')
                model_name = model.get('name', model_id)
                context = model.get('context_length', 'N/A')
                print(f"{i:3}. {model_id:50} (context: {context})")
            else:
                print(f"{i:3}. {model}")

        if len(models) > 20:
            print(f"\n... and {len(models) - 20} more models")

    except Exception as e:
        print(f"❌ Error fetching models: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    providers_to_test = ["openai", "gemini", "openrouter", "mistral", "deepseek", "qwen"]

    for provider in providers_to_test:
        test_provider_models(provider)

    print(f"\n{'='*60}")
    print("Test complete!")
    print(f"{'='*60}\n")
