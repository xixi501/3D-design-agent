"""Versioned floorplan vision providers with no formal scene write access."""

from __future__ import annotations

from typing import Any

__all__ = [
    "ArtifactEnvelopeV1",
    "ProviderCapabilities",
    "ProviderManifest",
    "ProviderRunRecord",
    "get_provider_registry",
    "run_floorplan_provider",
]


def __getattr__(name: str) -> Any:
    """Keep lightweight evidence-guard imports from loading model configuration."""
    if name in {
        "ArtifactEnvelopeV1",
        "ProviderCapabilities",
        "ProviderManifest",
        "ProviderRunRecord",
    }:
        from . import contracts

        return getattr(contracts, name)
    if name == "get_provider_registry":
        from .registry import get_provider_registry

        return get_provider_registry
    if name == "run_floorplan_provider":
        from .runner import run_floorplan_provider

        return run_floorplan_provider
    raise AttributeError(name)
