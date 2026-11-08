from typing import Annotated, Literal

from pydantic import ConfigDict, Field, FiniteFloat

from .generation_schemas import Dimension
from .schemas import StrictModel

CategoryCode = Literal[
    "sofa",
    "armchair",
    "chair",
    "coffeeTable",
    "sideTable",
    "diningTable",
    "tvCabinet",
    "bookshelf",
    "sideboard",
    "cabinet",
    "desk",
    "plant",
    "rug",
    "floorLamp",
    "decor",
    "other",
]

ActivityUnitType = Literal[
    "direct_occupancy",
    "direct_access",
    "seated_work",
    "group_seated",
    "standalone",
]
ActivityRole = Literal["primary", "satellite", "floorCovering", "accessory"]


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
    functionalArea: (
        Literal["living", "dining", "kitchen", "bedroom", "bathroom", "other"] | None
    ) = None


class ImageSymbol(StrictModel):
    functionalArea: Literal["living", "dining", "kitchen", "other"] | None = None
    included: bool | None = None
    exclusionReason: str | None = None
    evidenceRefs: list[str] | None = None
    id: str
    roomId: str
    category: str
    categoryCode: CategoryCode | None = None
    sourceLabel: str | None = None
    objectCandidateId: str | None = None
    activityGroupIds: list[str] | None = Field(default=None, max_length=10)
    activityRole: ActivityRole | None = None
    x: FiniteFloat = Field(ge=0)
    y: FiniteFloat = Field(ge=0)
    w: FiniteFloat = Field(gt=0)
    d: FiniteFloat = Field(gt=0)
    rot: FiniteFloat = Field(ge=-360, le=360)


class ActivityGroup(StrictModel):
    id: str
    type: ActivityUnitType
    primarySymbolId: str
    memberSymbolIds: list[str] = Field(min_length=1, max_length=50)
    roles: dict[str, ActivityRole] = Field(default_factory=dict)
    evidenceRefs: list[str] = Field(default_factory=list, max_length=20)


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
    activityGroups: list[ActivityGroup] = Field(default_factory=list, max_length=50)
    targetRoomIds: list[str] = Field(default_factory=list, max_length=60)
    uncertainties: list[Uncertainty] = Field(default_factory=list, max_length=100)


class StructureSegmentRef(StrictModel):
    analysisId: str
    index: int = Field(ge=0)


class StructureCustomSegment(StrictModel):
    cropId: str
    kind: Literal["H", "V"]
    c: FiniteFloat
    p0: FiniteFloat
    p1: FiniteFloat


class StructureWall(StrictModel):
    id: str
    candidateWallIds: list[str] = Field(default_factory=list, max_length=20)
    customSegments: list[StructureCustomSegment] = Field(default_factory=list, max_length=5)
    thicknessPx: FiniteFloat | None = Field(default=None, gt=0)


class StructureGapRef(StrictModel):
    id: str
    candidateId: str | None = None
    analysisId: str | None = None
    index: int | None = Field(default=None, ge=0)
    type: Literal["door", "window", "hole", "sliding"]
    sill: FiniteFloat | None = None
    head: FiniteFloat | None = None
    side: Literal[-1, 1] | None = None
    hinge: Literal[0, 1] | None = None
    evidenceRefs: list[str] = Field(default_factory=list, max_length=10)


class DimensionRead(StrictModel):
    candidateId: str
    label: str = Field(min_length=2, max_length=40)


class StructureRecognition(StrictModel):
    status: Literal["draft", "unsupported"]
    question: str = ""
    name: str = Field(default="户型图复现", max_length=100)
    height: FiniteFloat | None = Field(default=None, ge=100, le=20000)
    wallThickness: FiniteFloat | None = Field(default=None, ge=20, le=1000)
    anchors: list[ScaleAnchor] = Field(default_factory=list, max_length=20)
    walls: list[StructureWall] = Field(default_factory=list, max_length=150)
    openings: list[StructureGapRef] = Field(default_factory=list, max_length=100)
    rooms: list[ImageRoom] = Field(default_factory=list, max_length=60)
    targetRoomIds: list[str] = Field(default_factory=list, max_length=60)
    dimensionReads: list[DimensionRead] = Field(default_factory=list, max_length=20)
    uncertainties: list[Uncertainty] = Field(default_factory=list, max_length=100)


class FurnitureSymbol(StrictModel):
    id: str
    roomId: str
    categoryCode: CategoryCode
    sourceLabel: str = Field(min_length=1, max_length=100)
    functionalArea: Literal["living", "dining", "kitchen", "other"] | None = None
    included: bool | None = None
    exclusionReason: str | None = None
    evidenceRefs: list[str] = Field(min_length=1, max_length=20)
    x: FiniteFloat = Field(ge=0)
    y: FiniteFloat = Field(ge=0)
    w: FiniteFloat = Field(gt=0)
    d: FiniteFloat = Field(gt=0)
    rot: FiniteFloat = Field(ge=-360, le=360)


class FurnitureRecognition(StrictModel):
    status: Literal["draft", "unsupported"]
    question: str = ""
    symbols: list[FurnitureSymbol] = Field(default_factory=list, max_length=100)


class FurnitureContourSelection(StrictModel):
    id: str
    roomId: str
    categoryCode: CategoryCode
    sourceLabel: str = Field(min_length=1, max_length=100)
    functionalArea: Literal["living", "dining", "kitchen", "other"] | None = None
    included: bool | None = None
    exclusionReason: str | None = None
    contourCandidateIds: list[str] = Field(min_length=1, max_length=20)
    rot: FiniteFloat = Field(ge=-360, le=360)


class FurnitureContourRecognition(StrictModel):
    status: Literal["draft", "unsupported"]
    question: str = ""
    symbols: list[FurnitureContourSelection] = Field(default_factory=list, max_length=100)


class FurnitureObjectSelection(StrictModel):
    id: str
    roomId: str
    categoryCode: CategoryCode
    sourceLabel: str = Field(min_length=1, max_length=100)
    functionalArea: Literal["living", "dining", "kitchen", "other"] | None = None
    included: bool | None = None
    exclusionReason: str | None = None
    objectCandidateId: str
    rot: FiniteFloat = Field(ge=-360, le=360)


class FurnitureActivityGroupSelection(StrictModel):
    id: str
    candidateId: str
    type: ActivityUnitType
    primarySymbolId: str
    memberSymbolIds: list[str] = Field(min_length=1, max_length=50)
    roles: dict[str, ActivityRole] = Field(default_factory=dict)
    excludedObjectCandidateIds: list[str] = Field(default_factory=list, max_length=50)
    exclusionReasons: dict[str, str] = Field(default_factory=dict)


class FurnitureObjectExclusion(StrictModel):
    objectCandidateId: str
    reason: str = Field(min_length=1, max_length=200)


class FurnitureActivityRecognition(StrictModel):
    status: Literal["draft", "unsupported"]
    question: str = ""
    symbols: list[FurnitureObjectSelection] = Field(default_factory=list, max_length=100)
    activityGroups: list[FurnitureActivityGroupSelection] = Field(
        default_factory=list, max_length=50
    )
    excludedObjectCandidates: list[FurnitureObjectExclusion] = Field(
        default_factory=list, max_length=100
    )


class FloorplanReviewIssue(StrictModel):
    code: Literal[
        "WALL_MISMATCH",
        "OPENING_MISMATCH",
        "ROOM_MISMATCH",
        "DIMENSION_MISMATCH",
        "FURNITURE_MISSING",
        "FURNITURE_EXTRA",
        "FURNITURE_POSITION",
        "EVIDENCE_MISSING",
        "REVIEW_CONFLICT",
        "OTHER",
    ]
    source: Literal["code", "model"] = "model"
    severity: Literal["blocking", "advisory"] = "blocking"
    object_ids: list[str] = Field(max_length=20)
    description: str = Field(max_length=300)
    evidenceRefs: list[str] = Field(default_factory=list, max_length=20)
    bbox: list[FiniteFloat] | None = Field(default=None, min_length=4, max_length=4)


class FloorplanReview(StrictModel):
    passed: bool
    summary: str = Field(max_length=800)
    issues: list[FloorplanReviewIssue] = Field(max_length=20)


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


class DimensionObservation(ScaleAnchor):
    id: str
    sourceCandidateId: str
    label: str = Field(min_length=2, max_length=40)
    scaleReference: bool


class RecognitionV2(FloorplanRecognition):
    measurementVersion: Literal[2] = 2
    features: list[MeasurementFeature] = Field(default_factory=list, max_length=500)
    dimensions: list[MeasurementDimension] = Field(default_factory=list, max_length=100)


class RecognitionV3(RecognitionV2):
    recognitionVersion: Literal[3] = 3
    dimensionObservations: list[DimensionObservation] = Field(default_factory=list, max_length=20)


DraftCollection = Literal[
    "walls",
    "openings",
    "rooms",
    "symbols",
    "activityGroups",
    "uncertainties",
    "features",
    "dimensions",
]


class PatchDraft(StrictModel):
    type: Literal["patch"]
    collection: DraftCollection
    id: str
    patch: dict


class UpsertDraft(StrictModel):
    type: Literal["upsert"]
    collection: DraftCollection
    object: dict


class DeleteDraft(StrictModel):
    type: Literal["delete"]
    collection: DraftCollection
    id: str


class CalibrateDraft(StrictModel):
    type: Literal["calibrate"]
    anchors: list[ScaleAnchor]


class TargetsDraft(StrictModel):
    type: Literal["targets"]
    roomIds: list[str]


class DefaultsDraft(StrictModel):
    type: Literal["defaults"]
    values: dict


DraftCommand = Annotated[
    PatchDraft | UpsertDraft | DeleteDraft | CalibrateDraft | TargetsDraft | DefaultsDraft,
    Field(discriminator="type"),
]


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
