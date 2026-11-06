"""Version-two workflow tests use controlled inputs, never live-image acceptance."""

import asyncio
import base64
import hashlib
from types import SimpleNamespace

import pytest

from actiscape_agent.floorplan_evidence import FloorplanEvidence
from actiscape_agent.store import TaskError, TaskStore


@pytest.mark.asyncio
async def test_four_concurrent_crops_are_atomic_shared_idempotent_and_restartable(tmp_path):
    class Client:
        calls = 0

        async def request(self, path, body):
            self.calls += 1
            await asyncio.sleep(0.01 if body["box"][0] == 1 else 0.02)
            key = str(body["box"][0])
            raw = ("controlled crop " + key).encode()
            return {
                "id": key,
                "box": body["box"],
                "cropToPixel": {"x0": body["box"][0], "y0": 0, "scaleX": 1, "scaleY": 1},
                "path": key,
                "sha256": hashlib.sha256(raw).hexdigest(),
            }

        async def image(self, path):
            return ("controlled crop " + path).encode()

    store = TaskStore(tmp_path)
    c = store.create_conversation("p")
    task = store.create_task(c["id"], {"requestId": "crops", "input": "test"})
    client = Client()
    base = SimpleNamespace(store=store, client=client)
    image = {"id": "image", "sha256": "a" * 64}
    main = FloorplanEvidence(base, task, image, "main")
    design = FloorplanEvidence(base, task, image, "design")
    await asyncio.gather(
        *[
            owner.crop_tool().ainvoke({"x0": i, "y0": 0, "x1": i + 1, "y1": 1})
            for owner, i in [(main, 1), (main, 2), (design, 3), (design, 4)]
        ]
    )
    g = store.task(task["id"], internal=True)["generation"]
    assert len(g["evidenceIndex"]) == 4 and len(g["cropRequests"]) == 4
    assert len(await design.images()) == 4
    with pytest.raises(TaskError, match="预算"):
        await design.crop_tool().ainvoke({"x0": 5, "y0": 0, "x1": 6, "y1": 1})
    store.close()
    store = TaskStore(tmp_path)
    try:
        base.store = store
        restored = FloorplanEvidence(base, task, image, "check")
        parts = await restored.crop_tool().ainvoke({"x0": 1, "y0": 0, "x1": 2, "y1": 1})
        assert (
            base64.b64decode(parts[1]["image_url"]["url"].split(",")[1]) == b"controlled crop 1.0"
        )
        assert client.calls == 4
    finally:
        store.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("recover", [True, False])
async def test_one_structured_exit_recovers_bad_envelope_once_without_terminal_tool(
    tmp_path, recover
):
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage
    from langchain_core.outputs import ChatGeneration, ChatResult

    from actiscape_agent.floorplan_schemas import MeasuredDraftUpdate
    from actiscape_agent.roles import Roles

    class Model(BaseChatModel):
        calls: int = 0

        @property
        def _llm_type(self):
            return "controlled-v2-envelope"

        def bind_tools(self, tools, **kwargs):
            return self

        def _generate(self, messages, stop=None, run_manager=None, **kwargs):
            self.calls += 1
            good = {
                "baseDraftRevision": 0,
                "baseDraftHash": "a" * 64,
                "commands": [],
                "changeReasons": [],
                "evidenceRefs": [],
                "summary": "controlled",
            }
            args = (
                good
                if recover and self.calls > 1
                else {"draft": {"change_reasons": {}}, "summary": "wrong envelope"}
            )
            return ChatResult(
                generations=[
                    ChatGeneration(
                        message=AIMessage(
                            content="",
                            tool_calls=[
                                {
                                    "name": "MeasuredDraftUpdate",
                                    "id": "result-" + str(self.calls),
                                    "args": args,
                                }
                            ],
                        )
                    )
                ]
            )

    store = TaskStore(tmp_path)
    c = store.create_conversation("p")
    task = store.create_task(c["id"], {"requestId": "format", "input": "test"})
    model = Model()
    try:

        async def run():
            return await Roles(store, None, model_factory=lambda: model).invoke(
                "design",
                "Use the typed output",
                MeasuredDraftUpdate,
                [],
                {},
                task["id"],
                bounded_schema=True,
            )

        if recover:
            result = await run()
            assert result["commands"] == []
        else:
            with pytest.raises(TaskError, match="结构化参数"):
                await run()
        assert model.calls == 2
        assert store.task(task["id"])["modelCalls"] == 2
        assert not any(e["kind"] == "model_format_retry" for e in store.events(task["id"]))
    finally:
        store.close()


@pytest.mark.asyncio
async def test_pending_v2_update_recovers_after_lost_response_without_repeating_model_or_patch(
    tmp_path,
):
    import copy

    from actiscape_agent.floorplan_v2 import FloorplanV2
    from actiscape_agent.store import fingerprint

    class Client:
        draft = None
        actions = {}
        lose = True

        async def request(self, path, body=None):
            if path == "/floorplan-images/image":
                return {"id": "image", "sha256": "a" * 64, "width": 100, "height": 100}
            if path.endswith("/floorplan-drafts"):
                self.draft = {
                    "id": "d",
                    "revision": 0,
                    "hash": "0" * 64,
                    "data": body["data"],
                    "confirmed": None,
                }
                return copy.deepcopy(self.draft)
            if path.endswith("/measurement-updates"):
                key = body["requestId"]
                if key not in self.actions:
                    self.draft.update(revision=1, hash="1" * 64)
                    self.actions[key] = copy.deepcopy(self.draft)
                if self.lose:
                    self.lose = False
                    raise asyncio.CancelledError()
                return copy.deepcopy(self.actions[key])
            if path.endswith("/diagnostics"):
                return {
                    "id": fingerprint(self.draft["hash"]),
                    "draftHash": self.draft["hash"],
                    "files": [],
                    "checks": {"passed": self.draft["revision"] > 0, "issues": []},
                }
            if path.endswith("/review"):
                self.draft["sourceReview"] = {"hash": body["draftHash"], "review": body["review"]}
                return copy.deepcopy(self.draft)
            if path.endswith("/d"):
                return copy.deepcopy(self.draft)
            raise AssertionError(path)

    client = Client()
    store = TaskStore(tmp_path)
    conv = store.create_conversation("p")
    task = store.create_task(
        conv["id"],
        {
            "requestId": "recover",
            "mode": "reconstruct_floorplan",
            "imageId": "image",
            "input": "test",
        },
    )
    state = {"project": {"revision": 0, "plan": {}}}

    async def legacy(*args):
        raise AssertionError("Not confirmed")

    counts = {"main": 0, "measure": 0, "review": 0}

    def flow(store):
        base = SimpleNamespace(store=store, client=client)
        value = FloorplanV2(store, client, base)

        async def recognize(task, image):
            counts["main"] += 1
            store.count_model_call(task["id"], "main")
            return {
                "status": "draft",
                "measurementVersion": 2,
                "name": "controlled",
                "anchors": [],
                "features": [],
                "dimensions": [],
                "walls": [],
                "openings": [],
                "rooms": [],
                "symbols": [],
                "uncertainties": [],
                "targetRoomIds": [],
            }

        async def measure(task, image, draft, diagnostics, report):
            counts["measure"] += 1
            store.count_model_call(task["id"], "design")
            return {
                "baseDraftRevision": draft["revision"],
                "baseDraftHash": draft["hash"],
                "commands": [],
                "changeReasons": [],
                "evidenceRefs": [],
                "summary": "controlled",
            }

        async def review(task, *args):
            counts["review"] += 1
            store.count_model_call(task["id"], "check")
            return {"passed": True, "summary": "controlled", "issues": []}

        value.recognize, value.measure, value.review = recognize, measure, review
        return value

    with pytest.raises(asyncio.CancelledError):
        await flow(store).ground(state, task, legacy)
    saved = store.task(task["id"], internal=True)
    assert saved["generation"]["pendingMeasurement"]
    assert saved["modelCalls"] == 3
    store.close()
    store = TaskStore(tmp_path)
    try:
        result = await flow(store).ground(state, store.task(task["id"], internal=True), legacy)
        assert result["final"]["status"] == "waiting_input"
        g = store.task(task["id"], internal=True)["generation"]
        assert g["measurementComplete"]
        assert g["measurementAttempts"] == 1 and g["repairsUsed"] == 0
        assert counts == {"main": 1, "measure": 1, "review": 2}
        assert len(client.actions) == 1
    finally:
        store.close()
