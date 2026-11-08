import hashlib
import json
from typing import Literal

from .scene_contracts import (
    EvidenceGraph,
    InputBundle,
    InputSource,
    IntentConstraint,
    IntentSpec,
    SceneDraftPayload,
)
from .scene_registry import get_scene_registry


def text_source(task_id: str, text: str) -> InputSource:
    return InputSource(
        sourceId=f"task:{task_id}:text",
        kind="text_brief",
        adapterVersion="text-intent-v1",
        sha256=hashlib.sha256(text.encode()).hexdigest(),
        uri=f"task:{task_id}:input",
        metadata={"text": text},
    )


def project_source(project: dict) -> InputSource:
    return InputSource(
        sourceId=f"project:{project['id']}:revision:{project['revision']}",
        kind="project_import",
        adapterVersion="project-baseline-v1",
        sha256=hashlib.sha256(
            json.dumps(
                project["plan"],
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        ).hexdigest(),
        uri=f"project:{project['id']}:revision:{project['revision']}",
        metadata={"revision": project["revision"]},
    )


def floorplan_source(task: dict) -> InputSource:
    image = (task.get("generation") or {}).get("floorplan", {}).get("data", {}).get("image")
    if not image:
        raise ValueError("户型图任务缺少冻结原图")
    return InputSource(
        sourceId=f"floorplan:{image['id']}",
        kind="floorplan_image",
        adapterVersion=(task.get("generation") or {}).get("adapterVersion") or "hpd-adapter-6-1",
        sha256=image["sha256"],
        uri=f"floorplan-image:{image['id']}",
        metadata={"width": image["width"], "height": image["height"]},
    )


def text_intent(task_id: str, generation: dict, request_text: str) -> IntentSpec:
    brief = generation["brief"]
    source_id = f"task:{task_id}:text"
    evidence = generation.get("evidence") or {}
    constraints: list[IntentConstraint] = []
    for kind, field, text in (
        ("room_type", "purpose", evidence.get("purpose") or brief.get("roomName")),
        ("width", "width", evidence.get("width")),
        ("depth", "depth", evidence.get("depth")),
        ("doors", "doors", evidence.get("doors")),
        ("windows", "windows", evidence.get("windows")),
        ("style", "style", generation.get("style")),
    ):
        value = brief.get(field) if field in brief else generation.get(field)
        if value is None or value == [] or not text:
            continue
        constraints.append(
            IntentConstraint(
                id=f"intent:{kind}",
                kind=kind,
                text=str(text),
                strict=True,
                sourceRefs=[source_id],
            )
        )
    for index, item in enumerate(
        generation.get("furniture") or generation.get("brief", {}).get("furniture") or []
    ):
        constraints.append(
            IntentConstraint(
                id=f"intent:furniture:{index}",
                kind="furniture",
                text=f"{item.get('query', item.get('key', '家具'))} × {item.get('count', 1)}",
                strict=True,
                sourceRefs=[source_id],
            )
        )
    return IntentSpec(
        request=request_text,
        constraints=constraints,
        unknowns=list(generation.get("missing") or []),
    )


def blank_scene_program() -> dict:
    return {
        "schemaVersion": "actiscape.scene-program.v1",
        "units": "mm",
        "levels": [],
        "objects": [],
        "unknowns": [],
        "authority": [],
    }


def catalog_asset_resolutions(plan: dict) -> list[dict]:
    return [
        {
            "objectId": item["id"],
            "status": "catalogCandidates",
            "catalogKeys": [item["key"]],
        }
        for item in plan.get("furniture") or []
        if item.get("key")
    ]


def initial_scene_draft(
    *,
    task: dict,
    project: dict,
    generation: dict,
    room_type: str | None,
) -> SceneDraftPayload:
    source = text_source(task["id"], task["input"])
    return SceneDraftPayload(
        projectId=project["id"],
        baseProjectRevision=project["revision"],
        inputBundle=InputBundle(sources=[source]),
        evidenceGraph=EvidenceGraph(facts=[]),
        intentSpec=text_intent(task["id"], generation, task["input"]),
        program=blank_scene_program(),
        budgetLedger={
            "modelCalls": task.get("modelCalls", 0),
            "activeSeconds": task.get("elapsedSeconds", 0),
            "repairRounds": generation.get("repairsUsed", 0),
            "adapterCalls": 0,
            "assetJobs": 0,
        },
        fieldAuthorities=[
            {
                "path": "program.levels.0.roomSeeds.0.roomType",
                "authority": "user_intent",
                "sourceIds": [source.sourceId],
            }
        ],
    ).model_dump(mode="json")


def initial_edit_scene_draft(
    *,
    task: dict,
    project: dict,
    intent: dict,
) -> SceneDraftPayload:
    text = text_source(task["id"], task["input"])
    baseline = project_source(project)
    constraints = []
    for index, target_id in enumerate(intent.get("target_ids") or []):
        fields = intent.get("field_permissions", {}).get(target_id) or []
        constraints.append(
            IntentConstraint(
                id=f"intent:target:{index}",
                kind="edit_furniture",
                text=f"{target_id}: {','.join(fields) or 'delete'}",
                strict=True,
                sourceRefs=[text.sourceId],
            )
        )
    for index, addition in enumerate(intent.get("additions") or []):
        constraints.append(
            IntentConstraint(
                id=f"intent:add:{index}",
                kind="add_furniture",
                text=f"{addition['query']} × {addition['count']}",
                strict=True,
                sourceRefs=[text.sourceId],
            )
        )
    program = plan_to_scene_program(
        project["plan"],
        source_id=baseline.sourceId,
        authority="baseline",
        room_type=None,
    )
    resolutions = catalog_asset_resolutions(project["plan"])
    return SceneDraftPayload(
        projectId=project["id"],
        baseProjectRevision=project["revision"],
        inputBundle=InputBundle(sources=[text, baseline]),
        evidenceGraph=EvidenceGraph(facts=[]),
        intentSpec=IntentSpec(
            request=task["input"],
            constraints=constraints,
            unknowns=[],
        ),
        program=program,
        assetResolutions=resolutions,
        budgetLedger={
            "modelCalls": task.get("modelCalls", 0),
            "activeSeconds": task.get("elapsedSeconds", 0),
            "repairRounds": 0,
            "adapterCalls": 0,
            "assetJobs": 0,
        },
        fieldAuthorities=[
            {
                "path": "program.levels",
                "authority": "baseline",
                "sourceIds": [baseline.sourceId],
            },
            {
                "path": "intentSpec.constraints",
                "authority": "user_intent",
                "sourceIds": [text.sourceId],
            },
        ],
    ).model_dump(mode="json")


def plan_to_scene_program(
    plan: dict,
    *,
    source_id: str,
    authority: Literal["baseline", "observed", "inferred", "user_intent", "manual"],
    room_type: str | None,
) -> dict:
    registry = get_scene_registry()
    nodes = {item["id"]: item for item in plan.get("nodes") or []}
    source_refs = [{"sourceId": source_id, "authority": authority}]
    walls = []
    for wall in plan.get("walls") or []:
        a = nodes.get(wall.get("a"))
        b = nodes.get(wall.get("b"))
        if a is None or b is None:
            continue
        walls.append(
            {
                "id": wall["id"],
                "a": {"x": float(a["x"]), "y": float(a["y"])},
                "b": {"x": float(b["x"]), "y": float(b["y"])},
                "thickness": float(wall.get("t") or 200),
                "bearing": bool(wall.get("bearing")),
                "status": wall.get("status") or "existing",
                "sourceRefs": source_refs,
            }
        )
    openings = [
        {
            "id": item["id"],
            "wallId": item["wall"],
            "type": "door" if item["type"] not in ("window",) else "window",
            "offset": float(item.get("pos") or 0),
            "width": float(item.get("width") or 1),
            "sill": float(item.get("sill") or 0),
            "head": float(item.get("head") or 2100),
            **({"hinge": item["hinge"]} if item.get("hinge") in (0, 1) else {}),
            **({"side": item["side"]} if item.get("side") in (-1, 1) else {}),
            "sourceRefs": source_refs,
        }
        for item in plan.get("openings") or []
    ]
    room_seeds = [
        {
            "id": room["id"],
            "at": {"x": float(room["x"]), "y": float(room["y"])},
            "name": room.get("name") or room_type,
            "roomType": room_type or registry.room_type_for_label(room.get("name") or ""),
            "included": True,
            "sourceRefs": source_refs,
        }
        for room in plan.get("rooms") or []
    ]
    objects = []
    for item in plan.get("furniture") or []:
        room_id = (
            min(
                room_seeds,
                key=lambda room: (
                    (room["at"]["x"] - item["x"]) ** 2 + (room["at"]["y"] - item["y"]) ** 2
                ),
            )["id"]
            if room_seeds
            else None
        )
        objects.append(
            {
                "id": item["id"],
                "levelId": "level-1",
                **({"roomSeedId": room_id} if room_id else {}),
                "categoryId": registry.category_for_catalog_key(
                    item.get("key") or item.get("type") or ""
                ),
                "sourceLabel": item.get("name") or item.get("type") or item["id"],
                "included": True,
                "placement": "wall"
                if item.get("type") in ("wallTV", "wallArt", "wallLamp", "wallClock")
                else "floor",
                "x": float(item["x"]),
                "y": float(item["y"]),
                **({"z": float(item["z"])} if item.get("z") is not None else {}),
                "w": float(item["w"]),
                "d": float(item["d"]),
                **({"h": float(item["h"])} if item.get("h") is not None else {}),
                "rot": float(item.get("rot") or 0),
                **({"catalogKey": item["key"]} if item.get("key") else {}),
                "sourceRefs": source_refs,
            }
        )
    return {
        "schemaVersion": "actiscape.scene-program.v1",
        "units": "mm",
        "levels": [
            {
                "id": "level-1",
                "name": "一层",
                "elevation": 0,
                "height": float(plan.get("height") or 2800),
                "walls": walls,
                "openings": openings,
                "roomSeeds": room_seeds,
            }
        ],
        "objects": objects,
        "unknowns": [],
        "authority": [
            {"path": "program.levels", "authority": authority, "sourceIds": [source_id]},
        ],
    }


async def ensure_text_scene_draft(
    *,
    store,
    client,
    task: dict,
    project: dict,
    generation: dict,
    room_type: str,
) -> dict:
    if generation.get("sceneDraftId"):
        return generation
    draft = initial_scene_draft(
        task=task,
        project=project,
        generation=generation,
        room_type=room_type,
    )
    created = await client.request(
        f"/projects/{project['id']}/scene-drafts",
        {
            "requestId": f"{task['id']}:generic-scene",
            "draft": draft,
        },
    )
    generation.update(
        sceneDraftId=created["id"],
        sceneDraftRevision=created["revision"],
        sceneDraftHash=created["hash"],
        sceneDraftBaseProjectRevision=project["revision"],
    )
    store.update(task["id"], generation=generation)
    store.event(
        task["id"],
        "scene_draft",
        {
            "id": created["id"],
            "revision": created["revision"],
            "hash": created["hash"],
        },
    )
    return generation


async def sync_text_scene_program(
    *,
    store,
    client,
    task: dict,
    plan: dict,
    selection_id: str,
    room_type: str,
    stage: str,
) -> dict:
    generation = store.task(task["id"], internal=True).get("generation") or {}
    if not generation.get("sceneDraftId"):
        return generation
    program = plan_to_scene_program(
        plan,
        source_id=f"task:{task['id']}:text",
        authority="user_intent",
        room_type=room_type,
    )
    patched = await client.request(
        f"/projects/{task['projectId']}/scene-drafts/{generation['sceneDraftId']}/patches",
        {
            "requestId": f"{task['id']}:generic-scene:{selection_id}",
            "draftRevision": generation["sceneDraftRevision"],
            "commands": [
                {"op": "replaceProgram", "program": program},
                {
                    "op": "replaceAssetResolutions",
                    "assetResolutions": catalog_asset_resolutions(plan),
                },
            ],
        },
    )
    generation.update(
        sceneDraftRevision=patched["revision"],
        sceneDraftHash=patched["hash"],
    )
    store.update(task["id"], generation=generation)
    store.event(
        task["id"],
        "scene_draft",
        {
            "id": patched["id"],
            "revision": patched["revision"],
            "hash": patched["hash"],
            "stage": stage,
        },
    )
    return generation


async def ensure_edit_scene_draft(
    *,
    store,
    client,
    task: dict,
    project: dict,
    intent: dict,
) -> dict:
    generation = store.task(task["id"], internal=True).get("generation") or {}
    if generation.get("sceneDraftId"):
        return generation
    draft = initial_edit_scene_draft(task=task, project=project, intent=intent)
    created = await client.request(
        f"/projects/{project['id']}/scene-drafts",
        {
            "requestId": f"{task['id']}:generic-scene",
            "draft": draft,
        },
    )
    generation.update(
        sceneDraftId=created["id"],
        sceneDraftRevision=created["revision"],
        sceneDraftHash=created["hash"],
        sceneDraftBaseProjectRevision=project["revision"],
    )
    store.update(task["id"], generation=generation)
    store.event(
        task["id"],
        "scene_draft",
        {
            "id": created["id"],
            "revision": created["revision"],
            "hash": created["hash"],
        },
    )
    return generation


async def sync_edit_scene_program(
    *,
    store,
    client,
    task: dict,
    plan: dict,
    selection_id: str,
) -> dict:
    generation = store.task(task["id"], internal=True).get("generation") or {}
    if not generation.get("sceneDraftId"):
        return generation
    baseline = project_source(
        {
            "id": task["projectId"],
            "revision": generation["sceneDraftBaseProjectRevision"],
            "plan": plan,
        }
    )
    program = plan_to_scene_program(
        plan,
        source_id=baseline.sourceId,
        authority="manual",
        room_type=None,
    )
    patched = await client.request(
        f"/projects/{task['projectId']}/scene-drafts/{generation['sceneDraftId']}/patches",
        {
            "requestId": f"{task['id']}:generic-scene:{selection_id}",
            "draftRevision": generation["sceneDraftRevision"],
            "commands": [
                {"op": "replaceProgram", "program": program},
                {
                    "op": "replaceAssetResolutions",
                    "assetResolutions": catalog_asset_resolutions(plan),
                },
            ],
        },
    )
    generation.update(
        sceneDraftRevision=patched["revision"],
        sceneDraftHash=patched["hash"],
    )
    store.update(task["id"], generation=generation)
    store.event(
        task["id"],
        "scene_draft",
        {
            "id": patched["id"],
            "revision": patched["revision"],
            "hash": patched["hash"],
            "stage": "candidate",
        },
    )
    return generation


async def project_floorplan_candidate(
    *,
    store,
    client,
    task: dict,
    plan: dict,
    selection_id: str,
    project_revision: int,
) -> dict:
    generation = store.task(task["id"], internal=True).get("generation") or {}
    image_source = floorplan_source({**task, "generation": generation})
    text = text_source(task["id"], task["input"])
    program = plan_to_scene_program(
        plan,
        source_id=image_source.sourceId,
        authority="observed",
        room_type=None,
    )
    resolutions = catalog_asset_resolutions(plan)
    if not generation.get("sceneDraftId"):
        draft = SceneDraftPayload(
            projectId=task["projectId"],
            baseProjectRevision=project_revision,
            inputBundle=InputBundle(sources=[text, image_source]),
            evidenceGraph=EvidenceGraph(
                facts=[
                    {
                        "id": f"floorplan:{image_source.sha256}:scene",
                        "sourceId": image_source.sourceId,
                        "kind": "confirmed_floorplan_candidate",
                        "data": {
                            "rooms": len(program["levels"][0]["roomSeeds"]),
                            "objects": len(program["objects"]),
                        },
                        "locator": image_source.uri,
                    }
                ]
            ),
            intentSpec=IntentSpec(request=task["input"], constraints=[], unknowns=[]),
            program=program,
            assetResolutions=resolutions,
            budgetLedger={
                "modelCalls": generation.get("modelCalls", 0),
                "activeSeconds": generation.get("elapsedSeconds", 0),
                "repairRounds": generation.get("repairsUsed", 0),
                "adapterCalls": 0,
                "assetJobs": 0,
            },
            fieldAuthorities=[
                {
                    "path": "program.levels",
                    "authority": "observed",
                    "sourceIds": [image_source.sourceId],
                }
            ],
        ).model_dump(mode="json")
        created = await client.request(
            f"/projects/{task['projectId']}/scene-drafts",
            {
                "requestId": f"{task['id']}:generic-scene",
                "draft": draft,
            },
        )
        generation.update(
            sceneDraftId=created["id"],
            sceneDraftRevision=created["revision"],
            sceneDraftHash=created["hash"],
            sceneDraftBaseProjectRevision=draft["baseProjectRevision"],
        )
    else:
        created = await client.request(
            f"/projects/{task['projectId']}/scene-drafts/{generation['sceneDraftId']}/patches",
            {
                "requestId": f"{task['id']}:generic-scene:{selection_id}",
                "draftRevision": generation["sceneDraftRevision"],
                "commands": [
                    {"op": "replaceProgram", "program": program},
                    {
                        "op": "replaceAssetResolutions",
                        "assetResolutions": resolutions,
                    },
                ],
            },
        )
        generation.update(
            sceneDraftRevision=created["revision"],
            sceneDraftHash=created["hash"],
        )
    store.update(task["id"], generation=generation)
    store.event(
        task["id"],
        "scene_draft",
        {
            "id": created["id"],
            "revision": created["revision"],
            "hash": created["hash"],
            "stage": "floorplan-candidate",
        },
    )
    return generation
