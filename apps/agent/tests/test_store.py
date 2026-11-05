import pytest

from actiscape_agent.store import TaskError, TaskStore


def test_task_identity_project_serialization_and_persistent_budget(tmp_path):
    store = TaskStore(tmp_path)
    c = store.create_conversation("project")
    body = {"requestId": "one", "input": "move the chair", "selectedIds": ["chair"]}
    first = store.create_task(c["id"], body)
    assert store.create_task(c["id"], body)["id"] == first["id"]
    with pytest.raises(TaskError, match="不同内容"):
        store.create_task(c["id"], {**body, "input": "different"})
    other = store.create_conversation("project")
    with pytest.raises(TaskError, match="已有任务"):
        store.create_task(other["id"], body)
    store.cancel(first["id"])
    next_task = store.create_task(other["id"], body)
    for _ in range(24):
        store.count_model_call(next_task["id"], "controlled-test")
    with pytest.raises(TaskError, match="上限"):
        store.count_model_call(next_task["id"], "controlled-test")
    store.update(next_task["id"], status="failed")
    store.close()
    store = TaskStore(tmp_path)
    try:
        assert store.task(next_task["id"])["modelCalls"] == 24
        with pytest.raises(TaskError, match="预算"):
            store.resume(
                next_task["id"], {"requestId": "resume", "input": "retry", "selectedIds": []}
            )
        assert store.task(first["id"])["status"] == "cancelled"
    finally:
        store.close()


def test_clarification_resume_is_idempotent_and_does_not_reset_calls(tmp_path):
    store = TaskStore(tmp_path)
    try:
        c = store.create_conversation("project")
        task = store.create_task(
            c["id"], {"requestId": "one", "input": "move chair", "selectedIds": []}
        )
        store.count_model_call(task["id"], "main")
        store.update(task["id"], status="waiting_input")
        body = {"requestId": "clarify", "input": "this chair", "selectedIds": ["chair-2"]}
        result = store.resume(task["id"], body)
        assert result["selectedIds"] == ["chair-2"] and result["modelCalls"] == 1
        assert store.resume(task["id"], body) == result
        with pytest.raises(TaskError, match="不同内容"):
            store.resume(task["id"], {**body, "input": "another"})
    finally:
        store.close()
