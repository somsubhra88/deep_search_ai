"""
Model Registry Management
Loads model lists from txt files and updates them from provider APIs on startup.
"""
import logging
from pathlib import Path
from typing import Dict, List

logger = logging.getLogger(__name__)

# Path to model registry files
REGISTRY_DIR = Path(__file__).resolve().parents[2] / "llm_service_provider"


def load_models_from_file(provider_id: str) -> List[str]:
    """Load model list from txt file for a given provider."""
    file_path = REGISTRY_DIR / f"{provider_id}.txt"

    if not file_path.exists():
        logger.warning(f"Model file not found for {provider_id}: {file_path}")
        return []

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            models = [line.strip() for line in f if line.strip() and not line.startswith("#")]
        logger.info(f"Loaded {len(models)} models from {provider_id}.txt")
        return models
    except Exception as e:
        logger.error(f"Error loading models from {provider_id}.txt: {e}")
        return []


def save_models_to_file(provider_id: str, models: List[str]) -> bool:
    """Save model list to txt file for a given provider."""
    file_path = REGISTRY_DIR / f"{provider_id}.txt"

    try:
        # Ensure directory exists
        REGISTRY_DIR.mkdir(parents=True, exist_ok=True)

        with open(file_path, "w", encoding="utf-8") as f:
            f.write("\n".join(models) + "\n")

        logger.info(f"Saved {len(models)} models to {provider_id}.txt")
        return True
    except Exception as e:
        logger.error(f"Error saving models to {provider_id}.txt: {e}")
        return False


def load_all_model_registries() -> Dict[str, List[str]]:
    """Load all model registries from txt files."""
    registries = {}

    if not REGISTRY_DIR.exists():
        logger.warning(f"Registry directory not found: {REGISTRY_DIR}")
        return registries

    for file_path in REGISTRY_DIR.glob("*.txt"):
        provider_id = file_path.stem
        models = load_models_from_file(provider_id)
        if models:
            registries[provider_id] = models

    logger.info(f"Loaded model registries for {len(registries)} providers")
    return registries


def update_registry_from_api(provider_id: str, api_models: List[dict]) -> bool:
    """
    Update model registry file with latest models from API.
    Only updates if new models are found.
    """
    if not api_models:
        logger.debug(f"No API models to update for {provider_id}")
        return False

    # Extract model IDs from API response
    new_model_ids = []
    for m in api_models:
        model_id = m.get("id") or m.get("name")
        if model_id:
            new_model_ids.append(model_id)

    if not new_model_ids:
        logger.warning(f"No valid model IDs extracted from API for {provider_id}")
        return False

    # Load existing models
    existing_models = load_models_from_file(provider_id)

    # Check if update is needed
    if set(new_model_ids) == set(existing_models):
        logger.debug(f"Model list for {provider_id} is up to date ({len(existing_models)} models)")
        return False

    # Update the file with new models
    logger.info(f"Updating {provider_id} models: {len(existing_models)} -> {len(new_model_ids)}")
    return save_models_to_file(provider_id, new_model_ids)


def get_model_catalog() -> Dict[str, List[str]]:
    """
    Get the complete model catalog from registry files.
    This is used as the source of truth for available models.
    """
    return load_all_model_registries()
