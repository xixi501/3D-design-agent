from typing import Literal

from pydantic import Field, FiniteFloat

from .generation_schemas import Dimension
from .schemas import StrictModel


class PixelPoint(StrictModel):
    x: FiniteFloat = Field(ge=0)
    y: FiniteFloat = Field(ge=0)


class ScaleAnchor(StrictModel):
    a: PixelPoint
    b: PixelPoint
    distance: Dimension
    basis: Literal["interior", "centerline", "exterior"]
    evidence: str = Field(min_length=1, max_length=200)


class ImageWall(StrictModel):
    id: str
    a: PixelPoint
    b: PixelPoint
    thicknessPx: FiniteFloat | None = Field(default=None, gt=0)


class ImageOpening(StrictModel):
    id: str
    wallId: str
    type: Literal["door", "window", "hole", "sliding"]
    offset: FiniteFloat = Field(ge=0, description="沿原墙 a 到 b，开口中心距 a 的原图像素距离")
    width: FiniteFloat = Field(gt=0)
    sill: FiniteFloat | None = None
    head: FiniteFloat | None = None
    side: Literal[-1, 1] | None = None
    hinge: Literal[0, 1] | None = None


class ImageRoom(StrictModel):
    id: str
    at: PixelPoint
    name: str


class ImageSymbol(StrictModel):
    id: str
    roomId: str
    category: str
    x: FiniteFloat = Field(ge=0)
    y: FiniteFloat = Field(ge=0)
    w: FiniteFloat = Field(gt=0)
    d: FiniteFloat = Field(gt=0)
    rot: FiniteFloat = Field(ge=-360, le=360)


class Uncertainty(StrictModel):
    id: str
    message: str
    blocking: bool


class FloorplanRecognition(StrictModel):
    status: Literal["draft", "unsupported"]
    question: str = ""
    name: str = Field(default="户型图复现", max_length=100)
    height: FiniteFloat | None = None
    wallThickness: FiniteFloat | None = None
    anchors: list[ScaleAnchor] = Field(default_factory=list, max_length=20)
    walls: list[ImageWall] = Field(default_factory=list, max_length=150)
    openings: list[ImageOpening] = Field(default_factory=list, max_length=100)
    rooms: list[ImageRoom] = Field(default_factory=list, max_length=60)
    symbols: list[ImageSymbol] = Field(default_factory=list, max_length=100)
    targetRoomIds: list[str] = Field(default_factory=list, max_length=60)
    uncertainties: list[Uncertainty] = Field(default_factory=list, max_length=100)


class DraftCorrections(StrictModel):
    question: str
    commands: list[dict] = Field(default_factory=list, max_length=100)


class SymbolMatch(StrictModel):
    symbolId: str
    key: str


class ReconstructionProposal(StrictModel):
    summary: str = Field(max_length=200)
    matches: list[SymbolMatch] = Field(min_length=1, max_length=50)
