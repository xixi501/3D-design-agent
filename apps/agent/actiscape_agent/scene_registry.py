import json
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCENE_REGISTRY_SCHEMA = "actiscape.scene-registry.v1"
SCENE_REGISTRY_PATH = Path(__file__).with_name("scene-registry.v1.json")


class RegistryModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DefaultFurniture(RegistryModel):
    query: str = Field(min_length=1, max_length=100)
    count: int = Field(ge=1, le=50)


class RoomPolicy(RegistryModel):
    geometry: Literal["rectangular_v1"]
    checks: list[str] = Field(default_factory=list, max_length=50)


class RoomType(RegistryModel):
    id: str = Field(pattern=r"^[a-z0-9]+(?:_[a-z0-9]+)*$", max_length=64)
    label: str = Field(min_length=1, max_length=100)
    status: Literal["active", "reserved"]
    skillRoomKind: str = Field(min_length=1, max_length=64)
    skillIds: list[str] = Field(default_factory=list, max_length=20)
    floorMaterial: str = Field(min_length=1, max_length=64)
    wallMaterial: str = Field(min_length=1, max_length=64)
    policy: RoomPolicy
    defaultFurniture: list[DefaultFurniture] = Field(default_factory=list, max_length=50)


class FurnitureCategory(RegistryModel):
    id: str = Field(pattern=r"^[a-zA-Z][a-zA-Z0-9]*$", max_length=64)
    label: str = Field(min_length=1, max_length=100)
    parent: str | None = Field(default=None, max_length=64)
    catalogKeys: list[str] = Field(default_factory=list, max_length=100)


class SceneRegistryDocument(RegistryModel):
    schemaVersion: Literal["actiscape.scene-registry.v1"]
    version: str = Field(min_length=1, max_length=40)
    roomTypes: list[RoomType] = Field(min_length=1, max_length=100)
    categories: list[FurnitureCategory] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def unique_ids_and_parents(self):
        room_ids = [item.id for item in self.roomTypes]
        category_ids = [item.id for item in self.categories]
        if len(room_ids) != len(set(room_ids)):
            raise ValueError("房间类型 ID 重复")
        if len(category_ids) != len(set(category_ids)):
            raise ValueError("家具类别 ID 重复")
        known = set(category_ids)
        missing = {
            item.parent for item in self.categories if item.parent and item.parent not in known
        }
        if missing:
            raise ValueError(f"家具类别父级不存在：{sorted(missing)}")
        return self


class SceneRegistry:
    def __init__(self, path: Path = SCENE_REGISTRY_PATH):
        self.path = path
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            self.document = SceneRegistryDocument.model_validate(raw)
        except (OSError, ValueError) as exc:
            raise ValueError(f"场景注册表无效：{path}") from exc
        self._rooms = {item.id: item for item in self.document.roomTypes}
        self._room_labels = {item.label: item.id for item in self.document.roomTypes}
        self._categories = {item.id: item for item in self.document.categories}
        self._catalog_categories = {
            key: item.id for item in self.document.categories for key in item.catalogKeys
        }

    def room(self, room_type_id: str) -> RoomType | None:
        return self._rooms.get(room_type_id)

    def category(self, category_id: str) -> FurnitureCategory | None:
        return self._categories.get(category_id)

    def category_for_catalog_key(self, key: str) -> str:
        return self._catalog_categories.get(key, "other")

    def room_type_for_label(self, label: str) -> str:
        return self._room_labels.get(label, "other")

    def public_rooms(self, *, active_only: bool = True) -> list[dict]:
        return [
            item.model_dump(mode="json")
            for item in self.document.roomTypes
            if not active_only or item.status == "active"
        ]

    def public_categories(self) -> list[dict]:
        return [item.model_dump(mode="json") for item in self.document.categories]


@lru_cache(maxsize=1)
def get_scene_registry() -> SceneRegistry:
    return SceneRegistry()
