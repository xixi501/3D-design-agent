"""Static, reviewable provider manifests. No dynamic runtime discovery."""

from __future__ import annotations

from .contracts import ProviderCapabilities, ProviderManifest, VisionCapability


class ProviderRegistry:
    def __init__(self, manifests: list[ProviderManifest]):
        self._manifests = {manifest.id: manifest for manifest in manifests}
        if len(self._manifests) != len(manifests):
            raise ValueError("provider ID 重复")

    def get(self, provider_id: str) -> ProviderManifest:
        manifest = self._manifests.get(provider_id)
        if manifest is None:
            raise KeyError(provider_id)
        return manifest

    def all(self) -> list[ProviderManifest]:
        return list(self._manifests.values())

    def public_records(self, *, status: str = "all") -> list[dict]:
        output = []
        for manifest in self._manifests.values():
            if status != "all" and manifest.status != status:
                continue
            output.append(
                {
                    **manifest.model_dump(),
                    "capabilityNames": manifest.capabilities.names(),
                }
            )
        return output

    def candidates(self, capability: VisionCapability) -> list[ProviderManifest]:
        return [
            manifest
            for manifest in self._manifests.values()
            if manifest.status in ("production", "experimental")
            and capability in manifest.capabilities.names()
        ]


HPD_MANIFEST = ProviderManifest(
    id="hpd-adapter-6-1",
    name="house-plan-designer deterministic image adapter",
    version="6.1.0",
    providerKind="structure",
    status="experimental",
    capabilities=ProviderCapabilities(
        walls=True,
        openings=True,
        dimensions=True,
        rooms=False,
        symbols=False,
        ocr=False,
    ),
    repository="https://github.com/ZWD11/house-plan-designer",
    commit="b94183f9ce2215db9a178da89a90d2ecefb18497",
    license="MIT",
    isolation="subprocess",
)


_REGISTRY = ProviderRegistry([HPD_MANIFEST])


def get_provider_registry() -> ProviderRegistry:
    return _REGISTRY
