from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator

from .skill_registry import SkillSelection


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Addition(StrictModel):
    query: str = Field(description="用户要求新增的家具类型，例如落地灯")
    count: int = Field(ge=1, le=6, description="需要新增的件数，不是已有总数")


class Intent(StrictModel):
    status: Literal["ready", "clarify", "unsupported"]
    summary: str
    question: str = Field(default="", description="不明确时向用户提出的问题")
    target_ids: list[str] = Field(
        default_factory=list, description="明确获得本次修改授权的已有家具 ID"
    )
    reference_ids: list[str] = Field(
        default_factory=list, description="定位区域的只读参考对象 ID，不授权修改它们"
    )
    delete_ids: list[str] = Field(default_factory=list)
    field_permissions: dict[str, list[Literal["x", "y", "z", "rot", "w", "d", "h", "color"]]] = (
        Field(
            default_factory=dict,
            description="每个目标本次获准修改的字段。移动只给 x/y，旋转给 rot，不额外授权尺寸或颜色",
        )
    )
    additions: list[Addition] = Field(default_factory=list)
    area: Literal["local", "room"] = "local"
    skillSelection: SkillSelection = Field(default_factory=SkillSelection)

    @model_validator(mode="after")
    def consistent_authorization(self):
        if self.status != "ready":
            return self
        if any(id not in self.target_ids for id in self.delete_ids):
            raise ValueError("删除 ID 必须同时出现在 target_ids 和 delete_ids，不能仅填 delete_ids")
        if not self.target_ids and not self.additions:
            raise ValueError("ready 需要明确目标或新增请求；不明确请返回 clarify")
        if any(id not in self.target_ids for id in self.field_permissions):
            raise ValueError("字段授权不能超出 target_ids")
        if any(
            id not in self.delete_ids and not self.field_permissions.get(id)
            for id in self.target_ids
        ):
            raise ValueError("非删除目标需要明确字段授权；只作参考的对象放 reference_ids")
        return self


class AssetChoice(StrictModel):
    request_index: int = Field(ge=0)
    key: str
    reason: str


class AssetSelection(StrictModel):
    choices: list[AssetChoice]


class Patch(StrictModel):
    x: FiniteFloat | None = None
    y: FiniteFloat | None = None
    z: FiniteFloat | None = None
    rot: FiniteFloat | None = None
    w: FiniteFloat | None = Field(default=None, ge=1, le=50000)
    d: FiniteFloat | None = Field(default=None, ge=1, le=50000)
    h: FiniteFloat | None = Field(default=None, ge=1, le=50000)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class CreateEdit(StrictModel):
    type: Literal["create"]
    key: str
    values: Patch


class UpdateEdit(StrictModel):
    type: Literal["update"]
    id: str
    values: Patch


class DeleteEdit(StrictModel):
    type: Literal["delete"]
    id: str


Edit = Annotated[CreateEdit | UpdateEdit | DeleteEdit, Field(discriminator="type")]


class ActivityGroupProposal(StrictModel):
    name: str = Field(min_length=1, max_length=100)
    memberIds: list[str] = Field(min_length=1, max_length=50)


class Proposal(StrictModel):
    summary: str = Field(max_length=200)
    edits: list[Edit] = Field(min_length=1, max_length=50)
    activityGroups: list[ActivityGroupProposal] = Field(default_factory=list, max_length=20)


class ReviewIssue(StrictModel):
    object_ids: list[str]
    description: str


class Review(StrictModel):
    passed: bool
    summary: str
    issues: list[ReviewIssue]


class TaskInput(StrictModel):
    requestId: str = Field(min_length=1, max_length=200)
    input: str = Field(min_length=1, max_length=4000)
    selectedIds: list[str] = Field(default_factory=list, max_length=20)
    mode: Literal["edit", "generate_rectangular", "reconstruct_floorplan"] = "edit"
    imageId: str | None = Field(default=None, min_length=1, max_length=200)


class ResumeInput(StrictModel):
    requestId: str = Field(min_length=1, max_length=200)
    input: str = Field(default="", max_length=4000)
    selectedIds: list[str] = Field(default_factory=list, max_length=20)
