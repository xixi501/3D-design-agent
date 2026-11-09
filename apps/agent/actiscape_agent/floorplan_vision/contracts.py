"""Cross-language provider contracts. Pixel evidence only; never formal geometry."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from ..schemas import StrictModel

VisionCapability = Literal[
    "structure.walls",
    "structure.openings",
    "structure.dimensions",
    "structure.rooms",
    "furniture.symbols",
    "ocr.text",
]


class ProviderCapabilities(StrictModel):
    walls: bool = False
    openings: bool = False
    dimensions: bool = False
    rooms: bool = False
    symbols: bool = False
    ocr: bool = False

    def names(self) -> list[VisionCapability]:
        values: list[VisionCapability] = []
        for key, capability in (
            ("walls", "structure.walls"),
            ("openings", "structure.openings"),
            ("dimensions", "structure.dimensions"),
            ("rooms", "structure.rooms"),
            ("symbols", "furniture.symbols"),
            ("ocr", "ocr.text"),
        ):
            if getattr(self, key):
                values.append(capability)
        return values


class ProviderManifest(StrictModel):
    schemaVersion: Literal["actiscape.vision-provider.v1"] = "actiscape.vision-provider.v1"
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    version: str = Field(min_length=1, max_length=100)
    providerKind: Literal["structure", "furniture", "ocr", "composite"]
    status: Literal["production", "experimental", "research-only", "disabled"]
    capabilities: ProviderCapabilities
    repository: str = Field(min_length=1, max_length=500)
    commit: str = Field(default="", max_length=100)
    license: str = Field(min_length=1, max_length=100)
    weightsSha256: list[str] = Field(default_factory=list, max_length=20)
    maxImagePixels: int = Field(default=25_000_000, ge=1, le=100_000_000)
    isolation: Literal["subprocess", "local-process"] = "subprocess"


class ArtifactEnvelopeV1(StrictModel):
    schemaVersion: Literal["actiscape.artifact-envelope.v1"] = "actiscape.artifact-envelope.v1"
    kind: Literal["floorplan-vision"] = "floorplan-vision"
    providerId: str
    providerVersion: str
    inputSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    scopeHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    artifact: dict
    artifactSha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class ProviderRunRecord(StrictModel):
    schemaVersion: Literal["actiscape.provider-run.v1"] = "actiscape.provider-run.v1"
    provider: ProviderManifest
    status: Literal["completed", "failed", "unsupported"]
    inputSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    scopeHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    seconds: float = Field(ge=0)
    modelCalls: int = Field(default=0, ge=0)
    adapterCalls: int = Field(default=1, ge=0)
    envelope: ArtifactEnvelopeV1 | None = None
    warnings: list[str] = Field(default_factory=list, max_length=100)
    error: dict | None = None
