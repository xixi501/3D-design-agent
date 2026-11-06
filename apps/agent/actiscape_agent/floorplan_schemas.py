from typing import Literal

from pydantic import ConfigDict, Field, FiniteFloat

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
    functionalArea: Literal["living", "dining", "kitchen", "other"] | None = None
    included: bool | None = None
    exclusionReason: str | None = None
    evidenceRefs: list[str] | None = None
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
    height: FiniteFloat | None = Field(
        default=None, ge=100, le=20000, description="层高毫米；图中未知则 null，不得填0"
    )
    wallThickness: FiniteFloat | None = Field(
        default=None, ge=20, le=1000, description="默认墙厚毫米；未知则 null，不能填写像素墙宽"
    )
    anchors: list[ScaleAnchor] = Field(default_factory=list, max_length=20)
    walls: list[ImageWall] = Field(default_factory=list, max_length=150)
    openings: list[ImageOpening] = Field(default_factory=list, max_length=100)
    rooms: list[ImageRoom] = Field(default_factory=list, max_length=60)
    symbols: list[ImageSymbol] = Field(default_factory=list, max_length=100)
    targetRoomIds: list[str] = Field(default_factory=list, max_length=60)
    uncertainties: list[Uncertainty] = Field(default_factory=list, max_length=100)


def floorplan_recognition_schema(width: int, height: int):
    """Bound image-space recipes before tool acceptance; never infer a mm conversion."""

    class PixelSymbol(ImageSymbol):
        w: FiniteFloat = Field(
            gt=0, le=width, description="旋转前横向占地，原图像素；禁止填写毫米或目录默认尺寸"
        )
        d: FiniteFloat = Field(
            gt=0, le=height, description="旋转前纵向占地，原图像素；禁止填写毫米或目录默认尺寸"
        )

    class PixelFloorplanRecognition(FloorplanRecognition):
        symbols: list[PixelSymbol] = Field(default_factory=list, max_length=100)

    return PixelFloorplanRecognition


class DraftCorrections(StrictModel):
    question: str
    commands: list[dict] = Field(default_factory=list, max_length=100)


class SymbolMatch(StrictModel):
    symbolId: str
    key: str


class ReconstructionProposal(StrictModel):
    summary: str = Field(max_length=200)
    matches: list[SymbolMatch] = Field(min_length=1, max_length=50)


class MeasurementFeature(StrictModel):
    id: str
    objectId: str
    kind: Literal["wall_center", "wall_face", "wall_end", "opening_edge"]
    axis: Literal["x", "y"]
    side: Literal["min", "max"] | None = None
    endpoint: Literal["a", "b"] | None = None
    evidenceRefs: list[str] = Field(min_length=1, max_length=20)


class MeasurementDimension(StrictModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    id: str
    anchorIndex: int = Field(ge=0, le=19)
    from_: str = Field(alias="from")
    to: str
    distance: Dimension
    basis: Literal["interior", "centerline", "exterior"]
    evidenceRefs: list[str] = Field(min_length=1, max_length=20)


class RecognitionV2(FloorplanRecognition):
    measurementVersion: Literal[2] = 2
    features: list[MeasurementFeature] = Field(default_factory=list, max_length=500)
    dimensions: list[MeasurementDimension] = Field(default_factory=list, max_length=100)


class DraftCommand(StrictModel):
    type: Literal["patch", "upsert", "delete", "calibrate", "targets", "defaults"]
    collection: (
        Literal["walls", "openings", "rooms", "symbols", "uncertainties", "features", "dimensions"]
        | None
    ) = None
    id: str | None = None
    patch: dict | None = None
    object: dict | None = None
    anchors: list[ScaleAnchor] | None = None
    roomIds: list[str] | None = None
    values: dict | None = None


class ChangeEvidence(StrictModel):
    collection: str
    id: str
    reason: str
    evidenceRefs: list[str] = Field(min_length=1, max_length=20)


class MeasuredDraftUpdate(StrictModel):
    baseDraftRevision: int = Field(ge=0)
    baseDraftHash: str
    commands: list[DraftCommand] = Field(max_length=100)
    changeReasons: list[ChangeEvidence] = Field(default_factory=list, max_length=100)
    evidenceRefs: list[str] = Field(default_factory=list, max_length=100)
    summary: str
