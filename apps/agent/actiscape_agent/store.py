import hashlib
import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from .versions import runtime_versions

ACTIVE = ("queued", "running", "waiting_input", "committing")
TERMINAL = ("completed", "failed", "conflict", "cancelled")


class TaskError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        status: int = 400,
        details: dict | None = None,
    ):
        super().__init__(message)
        self.code, self.status, self.details = code, status, details


def fingerprint(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()


def task_fingerprint(body: dict) -> str:
    # Adding a default mode must not invalidate old request identities.
    value = dict(body)
    if value.get("imageId") is None:
        value.pop("imageId", None)
    if value.get("mode", "edit") == "edit":
        value.pop("mode", None)
    return fingerprint(value)


def public_skill_bundle(bundle: dict) -> dict:
    result = {}
    for key, value in bundle.items():
        if key == "judgements":
            result[key] = [
                {
                    item_key: item_value
                    for item_key, item_value in item.items()
                    if item_key in ("id", "title", "threshold", "source", "checkability")
                }
                for item in value
            ]
            continue
        if isinstance(value, dict) and {"id", "version", "contentHash"}.issubset(value):
            result[key] = {
                item_key: item_value
                for item_key, item_value in value.items()
                if item_key not in ("content", "judgementsData", "licenseText")
            }
            continue
        if isinstance(value, list) and all(
            isinstance(item, dict) and {"id", "version", "contentHash"}.issubset(item)
            for item in value
        ):
            result[key] = [
                {
                    item_key: item_value
                    for item_key, item_value in item.items()
                    if item_key not in ("content", "judgementsData", "licenseText")
                }
                for item in value
            ]
            continue
        result[key] = value
    return result


class TaskStore:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(
            directory / "tasks.sqlite", check_same_thread=False, isolation_level=None
        )
        self.db.row_factory = sqlite3.Row
        if self.db.execute("PRAGMA user_version").fetchone()[0] > 1:
            raise TaskError("UNSUPPORTED_DATABASE", "Agent 数据库版本高于当前程序", 500)
        self.db.executescript("""
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=FULL;
        PRAGMA foreign_keys=ON;
        PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,focus TEXT NOT NULL DEFAULT '[]',created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),project_id TEXT NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,input TEXT NOT NULL,selected TEXT NOT NULL,status TEXT NOT NULL,result TEXT,error TEXT,cancel_requested INTEGER NOT NULL DEFAULT 0,model_calls INTEGER NOT NULL DEFAULT 0,elapsed REAL NOT NULL DEFAULT 0,active_started REAL,created REAL NOT NULL,updated REAL NOT NULL,UNIQUE(conversation_id,request_id));
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_project ON tasks(project_id) WHERE status IN ('queued','running','waiting_input','committing');
        CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL REFERENCES tasks(id),kind TEXT NOT NULL,data TEXT NOT NULL,created REAL NOT NULL);
        CREATE INDEX IF NOT EXISTS events_task ON events(task_id,seq);
        CREATE TABLE IF NOT EXISTS actions(task_id TEXT NOT NULL,request_id TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(task_id,request_id));
        """)
        with self.transaction():
            columns = {row["name"] for row in self.db.execute("PRAGMA table_info(tasks)")}
            if "mode" not in columns:
                self.db.execute("ALTER TABLE tasks ADD COLUMN mode TEXT NOT NULL DEFAULT 'edit'")
            if "generation" not in columns:
                self.db.execute(
                    "ALTER TABLE tasks ADD COLUMN generation TEXT NOT NULL DEFAULT '{}'"
                )
            self.db.execute("PRAGMA user_version=1")

    @contextmanager
    def transaction(self):
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def close(self):
        self.db.close()

    def conversation(self, id: str):
        with self.lock:
            row = self.db.execute("SELECT * FROM conversations WHERE id=?", (id,)).fetchone()
        if row is None:
            raise TaskError("NOT_FOUND", "会话不存在", 404)
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "focusIds": json.loads(row["focus"]),
            "createdAt": row["created"],
        }

    def conversations(self, project: str):
        with self.lock:
            rows = self.db.execute(
                "SELECT id FROM conversations WHERE project_id=? ORDER BY created DESC", (project,)
            ).fetchall()
        return [self.conversation(row["id"]) for row in rows]

    def create_conversation(self, project: str):
        id = str(uuid.uuid4())
        with self.transaction():
            self.db.execute(
                "INSERT INTO conversations(id,project_id,created) VALUES(?,?,?)",
                (id, project, time.time()),
            )
        return self.conversation(id)

    def conversation_for_project(self, project: str):
        """Reuse one conversation per project so requestId remains idempotent."""
        with self.lock:
            row = self.db.execute(
                "SELECT id FROM conversations WHERE project_id=? ORDER BY created LIMIT 1",
                (project,),
            ).fetchone()
        return self.conversation(row["id"]) if row else self.create_conversation(project)

    def task(self, id: str, internal=False):
        with self.lock:
            row = self.db.execute("SELECT * FROM tasks WHERE id=?", (id,)).fetchone()
        if row is None:
            raise TaskError("NOT_FOUND", "任务不存在", 404)
        data = {
            "id": row["id"],
            "conversationId": row["conversation_id"],
            "projectId": row["project_id"],
            "requestId": row["request_id"],
            "input": row["input"],
            "selectedIds": json.loads(row["selected"]),
            "status": row["status"],
            "result": json.loads(row["result"]) if row["result"] else None,
            "error": row["error"],
            "cancelRequested": bool(row["cancel_requested"]),
            "modelCalls": row["model_calls"],
            "elapsedSeconds": row["elapsed"],
            "createdAt": row["created"],
            "updatedAt": row["updated"],
            "mode": row["mode"],
        }
        generation = json.loads(row["generation"])
        data["allowedRoomIds"] = generation.get("allowedRoomIds", [])
        if internal:
            data["generation"] = generation
        else:
            public = {k: v for k, v in generation.items() if k != "skillSnapshot"}
            if public.get("skillBundle"):
                public["skillBundle"] = public_skill_bundle(public["skillBundle"])
            data["generation"] = public
        if internal:
            data["activeStarted"] = row["active_started"]
        return data

    def tasks(self, conversation: str):
        self.conversation(conversation)
        with self.lock:
            rows = self.db.execute(
                "SELECT id FROM tasks WHERE conversation_id=? ORDER BY created", (conversation,)
            ).fetchall()
        return [self.task(row["id"]) for row in rows]

    def create_task(self, conversation: str, body: dict):
        c = self.conversation(conversation)
        mode = body.get("mode", "edit")
        if mode not in (
            "edit",
            "interactive_action",
            "photo_to_scene",
            "generate_rectangular",
            "reconstruct_floorplan",
            "repair_layout",
        ):
            raise TaskError("INVALID_MODE", "未知任务模式")
        if mode == "reconstruct_floorplan" and not body.get("imageId"):
            raise TaskError("MISSING_IMAGE", "户型复现需要上传原图")
        if mode != "reconstruct_floorplan" and body.get("imageId"):
            raise TaskError("INVALID_MODE", "此任务模式不能携带户型图片")
        with self.transaction():
            old = self.db.execute(
                "SELECT id,request_hash FROM tasks WHERE conversation_id=? AND request_id=?",
                (conversation, body["requestId"]),
            ).fetchone()
            if old:
                if old["request_hash"] != task_fingerprint(body):
                    raise TaskError("OPERATION_CONFLICT", "相同请求身份对应不同内容", 409)
                return self.task(old["id"])
            id = str(uuid.uuid4())
            now = time.time()
            try:
                self.db.execute(
                    "INSERT INTO tasks(id,conversation_id,project_id,request_id,request_hash,input,selected,status,created,updated,mode) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (
                        id,
                        conversation,
                        c["projectId"],
                        body["requestId"],
                        task_fingerprint(body),
                        body["input"],
                        json.dumps(body.get("selectedIds", [])),
                        "queued",
                        now,
                        now,
                        mode,
                    ),
                )
            except sqlite3.IntegrityError as e:
                raise TaskError(
                    "PROJECT_BUSY", "此项目已有任务，请先完成澄清或取消该任务", 409
                ) from e
            extra = {key: body[key] for key in ("assetId", "hostId") if body.get(key) is not None}
            if body.get("allowedRoomIds"):
                extra["allowedRoomIds"] = body["allowedRoomIds"]
            if extra:
                # Persist photo hints for every mode so PolicyController can
                # auto-route an ordinary edit request that carries an assetId.
                self.db.execute(
                    "UPDATE tasks SET generation=? WHERE id=?",
                    (json.dumps(extra), id),
                )
            if mode == "photo_to_scene":
                self.db.execute(
                    "UPDATE tasks SET generation=? WHERE id=?",
                    (
                        json.dumps(
                            {
                                "assetId": body.get("assetId"),
                                "hostId": body.get("hostId"),
                                "phase": "reading",
                            }
                        ),
                        id,
                    ),
                )
            if mode == "reconstruct_floorplan":
                self.db.execute(
                    "UPDATE tasks SET generation=? WHERE id=?",
                    (
                        json.dumps(
                            {
                                "imageId": body["imageId"],
                                "phase": "recognizing",
                                "workflowVersion": 4,
                                "recognitionVersion": 4,
                                "floorplanVersion": "s2c-floorplan-v4-2",
                                "candidatePolicyVersion": "geometry-only",
                                "floorplanScope": body.get("floorplanScope")
                                or {
                                    "roomSelection": "all_visible",
                                    "functionalAreas": [],
                                    "excludeFunctionalAreas": [],
                                },
                            }
                        ),
                        id,
                    ),
                )
        self.event(id, "queued", {"message": "任务已持久保存"})
        self.event(id, "runtime", runtime_versions())
        return self.task(id)

    def event(self, task: str, kind: str, data: dict):
        with self.lock:
            self.db.execute(
                "INSERT INTO events(task_id,kind,data,created) VALUES(?,?,?,?)",
                (task, kind, json.dumps(data, ensure_ascii=False), time.time()),
            )

    def events(self, task: str, after=0):
        self.task(task)
        with self.lock:
            rows = self.db.execute(
                "SELECT * FROM events WHERE task_id=? AND seq>? ORDER BY seq LIMIT 500",
                (task, after),
            ).fetchall()
        return [
            {
                "seq": row["seq"],
                "kind": row["kind"],
                "data": json.loads(row["data"]),
                "createdAt": row["created"],
            }
            for row in rows
        ]

    def metrics(self, id: str):
        with self.lock:
            row = self.db.execute(
                "SELECT model_calls,elapsed,active_started FROM tasks WHERE id=?", (id,)
            ).fetchone()
            events = self.db.execute(
                "SELECT kind,data,created FROM events WHERE task_id=? AND kind IN ('phase','evidence','repair','status','interrupted','deterministic_layout','deterministic_assets') ORDER BY seq",
                (id,),
            ).fetchall()
        durations = {}
        render_count = repairs = fallbacks = 0
        rendered = set()
        phase = None
        started = None
        for event in events:
            data = json.loads(event["data"])
            if event["kind"] == "phase":
                if phase and started is not None:
                    durations[phase] = durations.get(phase, 0) + max(0, event["created"] - started)
                phase, started = data["phase"], event["created"]
            elif event["kind"] == "evidence":
                for evidence in data.get("evidence") or []:
                    identity = (
                        data.get("candidateId"),
                        evidence.get("view"),
                        evidence.get("sha256"),
                    )
                    if identity not in rendered:
                        render_count += 1
                        rendered.add(identity)
            elif event["kind"] == "repair":
                repairs += 1
            elif event["kind"] in ("deterministic_layout", "deterministic_assets"):
                fallbacks += 1
            elif phase and started is not None:
                durations[phase] = durations.get(phase, 0) + max(0, event["created"] - started)
                phase, started = None, None
        if phase and started is not None:
            durations[phase] = durations.get(phase, 0) + max(0, time.time() - started)
        return {
            "modelCalls": row["model_calls"],
            "renderCount": render_count,
            "repairCount": repairs,
            "fallbackCount": fallbacks,
            "stageSeconds": {key: round(value, 3) for key, value in durations.items()},
            "elapsedSeconds": round(
                row["elapsed"]
                + (max(0, time.time() - row["active_started"]) if row["active_started"] else 0),
                3,
            ),
        }

    def update(self, id: str, **fields):
        allowed = {
            "status",
            "result",
            "error",
            "cancel_requested",
            "elapsed",
            "active_started",
            "input",
            "selected",
            "generation",
            "mode",
        }
        if set(fields) - allowed:
            raise ValueError("Unknown task fields")
        if fields.get("result") and fields.get("status") in (*TERMINAL, "waiting_input"):
            fields["result"] = {**fields["result"], "metrics": self.metrics(id)}
        values = {
            k: json.dumps(v, ensure_ascii=False)
            if k in ("result", "selected", "generation") and v is not None
            else v
            for k, v in fields.items()
        }
        values["updated"] = time.time()
        with self.lock:
            self.db.execute(
                "UPDATE tasks SET " + ",".join(k + "=?" for k in values) + " WHERE id=?",
                (*values.values(), id),
            )

    def count_model_call(self, id: str, role: str):
        with self.transaction():
            task = self.task(id, internal=True)
            if task["cancelRequested"]:
                raise TaskError("CANCELLED", "任务已请求取消")
            elapsed = task["elapsedSeconds"] + (
                time.time() - task["activeStarted"] if task["activeStarted"] else 0
            )
            if task["modelCalls"] >= 24 or elapsed >= 600:
                raise TaskError("BUDGET_EXHAUSTED", "任务达到模型请求或时间上限")
            self.db.execute(
                "UPDATE tasks SET model_calls=model_calls+1,updated=? WHERE id=?", (time.time(), id)
            )
        self.event(id, "model_start", {"role": role, "request": task["modelCalls"] + 1})

    def mutate_generation(self, id: str, mutate):
        """Read/modify/write the latest JSON under one transaction, never across an await."""
        with self.transaction():
            generation = self.task(id, internal=True)["generation"]
            result = mutate(generation)
            self.update(id, generation=generation)
            return result

    def start(self, id: str):
        task = self.task(id, internal=True)
        if task["activeStarted"]:
            self.update(
                id,
                elapsed=task["elapsedSeconds"] + max(0, time.time() - task["activeStarted"]),
                active_started=None,
            )
        self.update(
            id,
            status="committing" if task["status"] == "committing" else "running",
            error=None,
            active_started=time.time(),
        )

    def pause_clock(self, id: str):
        task = self.task(id, internal=True)
        if task["activeStarted"]:
            self.update(
                id,
                elapsed=task["elapsedSeconds"] + time.time() - task["activeStarted"],
                active_started=None,
            )

    def focus(self, conversation: str, ids: list[str]):
        with self.lock:
            self.db.execute(
                "UPDATE conversations SET focus=? WHERE id=?", (json.dumps(ids), conversation)
            )

    def recoverable(self):
        with self.lock:
            rows = self.db.execute(
                "SELECT id FROM tasks WHERE status IN ('queued','running','committing') ORDER BY created"
            ).fetchall()
        return [row["id"] for row in rows]

    def resume(self, id: str, body: dict):
        with self.transaction():
            old = self.db.execute(
                "SELECT hash FROM actions WHERE task_id=? AND request_id=?", (id, body["requestId"])
            ).fetchone()
            if old:
                if old["hash"] != fingerprint(body):
                    raise TaskError("OPERATION_CONFLICT", "恢复身份对应不同内容", 409)
                return self.task(id)
            task = self.task(id, internal=True)
            if task["status"] not in ("waiting_input", "failed", "conflict"):
                raise TaskError("INVALID_STATE", "当前任务不能恢复", 409)
            if task["modelCalls"] >= 24 or task["elapsedSeconds"] >= 600:
                raise TaskError("BUDGET_EXHAUSTED", "本任务预算已耗尽，请新建任务", 409)
            self.db.execute(
                "INSERT INTO actions VALUES(?,?,?)", (id, body["requestId"], fingerprint(body))
            )
            message = task["input"] + ("\n用户补充：" + body["input"] if body.get("input") else "")
            generation = dict(task.get("generation") or {})
            # A user supplement is a new authorization version. Old
            # candidates remain immutable records but can no longer be used for
            # this task once the new grounding pass starts.
            generation["resumeNonce"] = body["requestId"]
            generation["authorizationVersion"] = int(generation.get("authorizationVersion", 1)) + 1
            if task["mode"] == "reconstruct_floorplan":
                generation["resumeNonce"] = body["requestId"]
            try:
                self.update(
                    id,
                    status="queued",
                    input=message,
                    selected=body.get("selectedIds") or task["selectedIds"],
                    generation=generation,
                    cancel_requested=0,
                    error=None,
                )
            except sqlite3.IntegrityError as e:
                raise TaskError("PROJECT_BUSY", "项目已有其他活动任务", 409) from e
        self.event(id, "resumed", {"message": "任务已恢复"})
        return self.task(id)

    def claim_action(self, id: str, body: dict):
        """Claim one external task action without changing task state."""
        self.task(id)
        with self.transaction():
            old = self.db.execute(
                "SELECT hash FROM actions WHERE task_id=? AND request_id=?",
                (id, body["requestId"]),
            ).fetchone()
            if old:
                if old["hash"] != fingerprint(body):
                    raise TaskError("OPERATION_CONFLICT", "相同请求身份对应不同内容", 409)
                return False
            self.db.execute(
                "INSERT INTO actions VALUES(?,?,?)",
                (id, body["requestId"], fingerprint(body)),
            )
            return True

    def cancel(self, id: str):
        task = self.task(id)
        if task["status"] in TERMINAL:
            return task
        self.update(id, cancel_requested=1)
        if task["status"] in ("queued", "waiting_input"):
            self.update(
                id,
                status="cancelled",
                result={"status": "cancelled", "message": "任务已取消，候选未提交。"},
                error=None,
            )
        self.event(
            id, "cancel_requested", {"message": "将在安全边界停止；已开始的原子提交将确认最终结果"}
        )
        return self.task(id)
