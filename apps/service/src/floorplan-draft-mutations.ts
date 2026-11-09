import { createHash } from "node:crypto";
import { clone, SceneError } from "../../../packages/scene-core/src/index.js";
import {
  validateFloorplan,
  type FloorplanData,
} from "../../../packages/scene-core/src/floorplan.js";
import { canonical } from "./store.js";

const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

const identity = (value: unknown) => {
  if (typeof value !== "string" || !value || value.length > 200)
    throw new SceneError("INVALID_REQUEST", "需要有效 requestId");
};

export interface FloorplanDraftRecord {
  id: string;
  projectId: string;
  baseRevision: number;
  revision: number;
  data: FloorplanData;
  hash: string;
  confirmed: Record<string, unknown> | null;
  sourceReview?: Record<string, unknown> | null;
  corrections: number;
  changeLedger?: Array<Record<string, unknown>>;
  agentEdits?: number;
  createdAt: string;
}

export interface FloorplanMutationOptions {
  evidenceRefVerifier?: (
    data: FloorplanData,
    refs: string[],
    draftHash?: string,
  ) => void;
}

export function applyFloorplanCommands(
  record: FloorplanDraftRecord,
  body: any,
  options: FloorplanMutationOptions & { system?: boolean } = {},
): FloorplanDraftRecord {
  const system = Boolean(options.system);
  if (
    !Array.isArray(body.commands) ||
    (!system && !body.commands.length) ||
    body.commands.length > 100
  )
    throw new SceneError("INVALID_REQUEST", "需要 1–100 条草稿校正");
  const data = clone(record.data) as FloorplanData;
  if (
    system &&
    (data.measurementVersion !== 2 || body.draftHash !== record.hash)
  )
    throw new SceneError(
      "DRAFT_CONFLICT",
      "测量更新须绑定当前第二版草稿哈希",
      409,
    );
  let corrections = record.corrections;
  for (const command of body.commands) {
    if (!command || typeof command !== "object" || Array.isArray(command))
      throw new SceneError("INVALID_REQUEST", "草稿命令必须是对象");
    const allowed: Record<string, string[]> = {
      calibrate: ["type", "anchors"],
      targets: ["type", "roomIds"],
      defaults: ["type", "values"],
      upsert: ["type", "collection", "object"],
      delete: ["type", "collection", "id"],
      patch: ["type", "collection", "id", "patch"],
    };
    if (
      !allowed[command.type] ||
      Object.keys(command).some((key) => !allowed[command.type].includes(key))
    )
      throw new SceneError("INVALID_REQUEST", "草稿命令包含未知类型或字段");
    if (command.type === "calibrate") data.anchors = clone(command.anchors);
    else if (command.type === "targets")
      data.targetRoomIds = clone(command.roomIds);
    else if (command.type === "defaults") {
      if (
        !command.values ||
        typeof command.values !== "object" ||
        Array.isArray(command.values) ||
        !Object.keys(command.values).length
      )
        throw new SceneError("INVALID_REQUEST", "草稿默认值需要非空对象");
      for (const key of Object.keys(command.values || {})) {
        if (!["height", "wallThickness", "name"].includes(key))
          throw new SceneError("INVALID_REQUEST", "未知草稿默认字段");
        (data as any)[key] = clone(command.values[key]);
      }
    } else if (
      command.type === "upsert" ||
      command.type === "delete" ||
      command.type === "patch"
    ) {
      if (
        ![
          "walls",
          "openings",
          "rooms",
          "symbols",
          "activityGroups",
          "uncertainties",
          ...(data.measurementVersion === 2 ? ["features", "dimensions"] : []),
        ].includes(command.collection)
      )
        throw new SceneError("INVALID_REQUEST", "未知草稿集合");
      const list = (data as any)[command.collection] as any[];
      const objectId =
        command.type === "upsert" ? command.object?.id : command.id;
      const index = list.findIndex((item) => item.id === objectId);
      identity(objectId);
      if (command.type === "delete") {
        if (index < 0) throw new SceneError("NOT_FOUND", "草稿对象不存在", 404);
        list.splice(index, 1);
      } else if (command.type === "patch") {
        if (
          index < 0 ||
          !command.patch ||
          typeof command.patch !== "object" ||
          Array.isArray(command.patch) ||
          Object.hasOwn(command.patch, "id")
        )
          throw new SceneError("INVALID_REQUEST", "对象字段修改无效");
        list[index] = { ...list[index], ...clone(command.patch) };
      } else if (index < 0) list.push(clone(command.object));
      else list[index] = clone(command.object);
      if (!system) corrections += 1;
    } else throw new SceneError("INVALID_REQUEST", "未知草稿操作");
  }
  validateFloorplan(data);
  const ledger = clone(record.changeLedger || []);
  if (system)
    options.evidenceRefVerifier?.(
      data,
      [
        ...(body.evidenceRefs || []),
        ...(body.changeReasons || []).flatMap(
          (reason: any) => reason.evidenceRefs || [],
        ),
      ],
      record.hash,
    );
  if (system) {
    const reasons = body.changeReasons || [];
    for (const field of ["name", "height", "wallThickness", "targetRoomIds"]) {
      const before = (record.data as any)[field] ?? null;
      const after = (data as any)[field] ?? null;
      if (canonical(before) === canonical(after)) continue;
      const reason = reasons.find(
        (item: any) => item.collection === "defaults" && item.id === field,
      );
      if (
        !reason?.reason?.trim() ||
        !Array.isArray(reason.evidenceRefs) ||
        !reason.evidenceRefs.length
      )
        throw new SceneError(
          "CHANGE_EVIDENCE_REQUIRED",
          "默认值或目标区域变化须说明依据",
          422,
          { collection: "defaults", id: field },
        );
      ledger.push({
        collection: "defaults",
        id: field,
        beforeHash: hash(before),
        afterHash: hash(after),
        reason: reason.reason,
        evidenceRefs: reason.evidenceRefs,
      });
    }
    for (const collection of [
      "anchors",
      "walls",
      "openings",
      "rooms",
      "symbols",
      "activityGroups",
      "features",
      "dimensions",
    ]) {
      const old = ((record.data as any)[collection] || []) as any[];
      const next = ((data as any)[collection] || []) as any[];
      for (const [index, prior] of old.entries()) {
        const objectId = String(prior.id ?? index);
        const after = prior.id
          ? next.find((item) => item.id === prior.id)
          : next[index];
        if (canonical(prior) === canonical(after ?? null)) continue;
        const beforeHash = hash(prior);
        const afterHash = hash(after ?? null);
        const saved = ledger.find(
          (entry: any) =>
            entry.collection === collection &&
            entry.id === objectId &&
            entry.beforeHash === beforeHash &&
            entry.afterHash === afterHash,
        );
        const reason = reasons.find(
          (item: any) => item.collection === collection && item.id === objectId,
        );
        if (
          !saved &&
          (!reason ||
            typeof reason.reason !== "string" ||
            !reason.reason.trim() ||
            !Array.isArray(reason.evidenceRefs) ||
            !reason.evidenceRefs.length)
        )
          throw new SceneError(
            "CHANGE_EVIDENCE_REQUIRED",
            "修改已有观测必须附对应原图依据",
            422,
            { collection, id: objectId, beforeHash, afterHash },
          );
        if (!saved)
          ledger.push({
            collection,
            id: objectId,
            beforeHash,
            afterHash,
            reason: reason.reason,
            evidenceRefs: reason.evidenceRefs,
          });
      }
    }
  }
  const revision = record.revision + 1;
  return {
    ...record,
    data,
    revision,
    hash: hash({ id: record.id, revision, data }),
    confirmed: null,
    sourceReview: null,
    ...(system
      ? {
          changeLedger: ledger,
          agentEdits: (record.agentEdits || 0) + body.commands.length,
        }
      : {}),
    corrections,
  };
}

export function applyFloorplanReview(
  record: FloorplanDraftRecord,
  body: any,
  options: FloorplanMutationOptions = {},
): FloorplanDraftRecord {
  if (
    record.data.measurementVersion !== 2 ||
    body.draftHash !== record.hash ||
    typeof body.review?.passed !== "boolean" ||
    !Array.isArray(body.review?.issues) ||
    typeof body.review?.summary !== "string" ||
    (body.review.passed &&
      body.review.issues.some(
        (issue: any) =>
          !issue ||
          typeof issue !== "object" ||
          (issue.severity ?? "blocking") !== "advisory",
      ))
  )
    throw new SceneError(
      "DRAFT_CONFLICT",
      "审核必须绑定当前草稿，且结果完整",
      409,
    );
  options.evidenceRefVerifier?.(
    record.data,
    body.evidenceRefs || [],
    record.hash,
  );
  return {
    ...record,
    sourceReview: {
      hash: record.hash,
      review: body.review,
      evidenceRefs: body.evidenceRefs || [],
    },
  };
}
