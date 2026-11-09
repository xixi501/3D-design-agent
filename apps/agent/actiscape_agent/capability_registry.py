"""Public capability matrix. Only verified or explicitly experimental claims are exposed."""

from __future__ import annotations

from .floorplan_vision import get_provider_registry
from .scene_registry import get_scene_registry


def capability_document() -> dict:
    scene_registry = get_scene_registry()
    providers = get_provider_registry()
    return {
        "schemaVersion": "actiscape.capabilities.v1",
        "inputs": [
            {
                "kind": "text_brief",
                "status": "active",
                "geometry": "rectangular_v1",
                "rooms": [room["id"] for room in scene_registry.public_rooms(active_only=True)],
            },
            {
                "kind": "project_import",
                "status": "active",
                "geometry": "orthogonal_single_level",
                "scope": "baseline_selection_and_edit",
            },
            {
                "kind": "floorplan_image",
                "status": "verified_limited",
                "geometry": "orthogonal_single_level",
                "verifiedVersion": "s2c-floorplan-v3-6-1",
                "experimentalVersion": "s2c-floorplan-v4-2",
                "limitation": "V3-6 只通过两张冻结客餐厅图片；V4-2 尚未通过全屋自动零校正",
            },
            {
                "kind": "reference_photo",
                "status": "reserved",
                "geometry": "hypothesis_only",
            },
            {
                "kind": "object_photo",
                "status": "reserved",
                "capability": "asset_generation_request_only",
            },
        ],
        "scene": {
            "singleLevelOrthogonal": "active",
            "multiLevel": "reserved",
            "nonOrthogonal": "reserved",
            "multiRoomTextGeneration": "reserved",
        },
        "rooms": {
            "active": [room["id"] for room in scene_registry.public_rooms(active_only=True)],
            "reserved": [
                room["id"]
                for room in scene_registry.public_rooms(active_only=False)
                if room["status"] != "active"
            ],
        },
        "visionProviders": providers.public_records(status="all"),
    }
