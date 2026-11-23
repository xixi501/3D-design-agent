import crypto from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import {
  auditSafety,
  autoRepairScene,
  checkScene,
  clone,
  collections,
  exportPlanToMujocoXml,
  SceneError,
  type Command,
  type Plan,
  type SafetyProfile,
} from "../../../packages/scene-core/src/index.js";
import { businessDiff } from "../../../packages/scene-core/src/candidate.js";
import { buildMcpOpenApiSpec } from "./mcp-openapi.js";
import {
  applyStylePackToPlan,
  buildTemplatePlan,
  compileSafeHouseSpec,
  SHOWCASE_TEMPLATES,
  STYLE_THEME_PACKS,
} from "./showcase-templates.js";
import type { ProjectStore } from "./store.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../../../fixtures");

function buildPlanReplaceCommands(before: Plan, after: Plan): Command[] {
  const commands: Command[] = [
    {
      type: "project",
      patch: {
        name: after.name,
        height: after.height,
        phase: after.phase,
        look: clone(after.look) ?? null,
        north: clone(after.north) ?? null,
        ...(after.source ? { source: clone(after.source) } : {}),
      },
    },
  ];
  // Delete dependents BEFORE walls and nodes so node/wall cascade-delete never triggers NOT_FOUND
  const deleteOrder = [
    ...collections.filter((k) => k !== "walls" && k !== "nodes"),
    "walls" as const,
    "nodes" as const,
  ];
  for (const key of deleteOrder) {
    if (!collections.includes(key)) continue;
    for (const oldItem of before[key]) {
      commands.push({ type: "delete", collection: key, id: oldItem.id });
    }
  }
  for (const key of collections) {
    for (const newItem of after[key]) {
      commands.push({ type: "add", collection: key, object: clone(newItem) });
    }
  }
  return commands;
}

function buildStyleUpdateCommands(before: Plan, styled: Plan): Command[] {
  const commands: Command[] = [];
  for (const afterRoom of styled.rooms) {
    if (before.rooms.some((r) => r.id === afterRoom.id)) {
      const { id, ...patch } = clone(afterRoom) as any;
      commands.push({ type: "update", collection: "rooms", id, patch });
    }
  }
  for (const afterFurn of styled.furniture) {
    if (before.furniture.some((f) => f.id === afterFurn.id)) {
      const { id, ...patch } = clone(afterFurn) as any;
      commands.push({ type: "update", collection: "furniture", id, patch });
    }
  }
  return commands;
}

export function safetyRoutes(
  app: FastifyInstance,
  store: ProjectStore,
  notify: (id: string, revision: number) => void,
) {
  app.get("/api/mcp/openapi.json", async (req) => {
    const queryUrl = (req.query as any)?.serverUrl as string | undefined;
    const forwardedProto = req.headers["x-forwarded-proto"] as string | undefined;
    const forwardedHost = req.headers["x-forwarded-host"] as string | undefined;
    const inferredServer =
      queryUrl ||
      (forwardedProto && forwardedHost
        ? `${forwardedProto.split(",")[0].trim()}://${forwardedHost.split(",")[0].trim()}`
        : undefined);
    return buildMcpOpenApiSpec(inferredServer);
  });

  app.get("/api/style-packs", async () => ({
    stylePacks: Object.values(STYLE_THEME_PACKS),
  }));

  app.get("/api/templates", async () => ({
    templates: SHOWCASE_TEMPLATES.map(({ spec, ...meta }) => meta),
  }));

  app.get("/api/templates/:templateId/plan", async (req) => {
    const templateId = String((req.params as any).templateId || "");
    const { meta, plan } = buildTemplatePlan(templateId, FIXTURES_DIR);
    return { meta: { ...meta, spec: undefined }, plan };
  });

  app.post("/api/projects/:id/auto-repair", async (req) => {
    const id = (req.params as any).id;
    const project = store.get(id);
    const body = (req.body as any) || {};
    const roomId =
      typeof body.roomId === "string" && body.roomId.trim()
        ? body.roomId.trim()
        : undefined;
    const targetIds = Array.isArray(body.targetIds)
      ? body.targetIds.filter((x: unknown): x is string => typeof x === "string")
      : undefined;
    const preferredMoveIds = Array.isArray(body.preferredMoveIds)
      ? body.preferredMoveIds.filter(
          (x: unknown): x is string => typeof x === "string",
        )
      : undefined;
    const includeSafety = Boolean(
      body.includeSafety || project.plan.source?.safetyProfile?.enabled,
    );
    const repaired = autoRepairScene(project.plan, {
      roomId,
      targetIds,
      preferredMoveIds,
      includeSafety,
    });
    let finalProject = project;
    let applied = false;
    if (repaired.commands.length > 0) {
      const result = store.mutate(id, "commands", {
        operationId:
          body.operationId || `auto-repair-${crypto.randomUUID()}`,
        baseRevision: body.baseRevision ?? project.revision,
        summary: repaired.summary.slice(0, 200),
        commands: repaired.commands,
      });
      finalProject = result.project;
      applied = true;
      if (!result.replayed) notify(id, result.project.revision);
    }
    return {
      project: finalProject,
      applied,
      changes: repaired.changes,
      issuesBefore: repaired.issuesBefore,
      issuesAfter: repaired.issuesAfter,
      fixableBefore: repaired.fixableBefore,
      fixableAfter: repaired.fixableAfter,
      resolvedCodes: repaired.resolvedCodes,
      remainingIssues: repaired.remainingIssues,
      elapsedMs: repaired.elapsedMs,
      summary: repaired.summary,
      checks: checkScene(finalProject.plan),
      ...(includeSafety ? { safetyAudit: auditSafety(finalProject.plan) } : {}),
    };
  });

  app.post("/api/projects/:id/apply-style-pack", async (req) => {
    const id = (req.params as any).id;
    const project = store.get(id);
    const body = (req.body as any) || {};
    const styleId = String(body.styleId || "modern");
    if (!STYLE_THEME_PACKS[styleId]) {
      throw new SceneError("UNKNOWN_STYLE_PACK", `未知风格主题包: ${styleId}`, 400);
    }
    const pack = STYLE_THEME_PACKS[styleId];
    const styledPlan = applyStylePackToPlan(project.plan, styleId);
    const commands = buildStyleUpdateCommands(project.plan, styledPlan);
    const result = store.mutate(id, "commands", {
      operationId: body.operationId || `style-pack-${styleId}-${crypto.randomUUID()}`,
      baseRevision: body.baseRevision ?? project.revision,
      summary: `应用「${pack.label}」全屋硬装材质与三维家具风格`,
      commands,
    });
    if (!result.replayed) notify(id, result.project.revision);
    return {
      project: result.project,
      stylePack: pack,
      checks: checkScene(result.project.plan),
    };
  });

  app.post("/api/projects/:id/apply-template", async (req) => {
    const id = (req.params as any).id;
    const project = store.get(id);
    const body = (req.body as any) || {};
    const templateId = String(body.templateId || "");
    const { meta, plan: rawPlan } = buildTemplatePlan(templateId, FIXTURES_DIR);
    const finalPlan =
      body.styleId && STYLE_THEME_PACKS[body.styleId]
        ? applyStylePackToPlan(rawPlan, body.styleId)
        : rawPlan;
    const commands = buildPlanReplaceCommands(project.plan, finalPlan);
    const result = store.mutate(id, "commands", {
      operationId: body.operationId || `tpl-${templateId}-${crypto.randomUUID()}`,
      baseRevision: body.baseRevision ?? project.revision,
      summary: `载入精品样板场景：${meta.name}`,
      commands,
    });
    if (!result.replayed) notify(id, result.project.revision);
    return {
      project: result.project,
      template: { ...meta, spec: undefined },
      checks: checkScene(result.project.plan),
      safetyAudit: auditSafety(result.project.plan),
    };
  });

  app.post("/api/projects/:id/initialize-housespec", async (req) => {
    const id = (req.params as any).id;
    const project = store.get(id);
    const body = (req.body as any) || {};
    if (!body.spec || typeof body.spec !== "object") {
      throw new SceneError("INVALID_HOUSESPEC", "缺少有效的 HouseSpec 结构定义", 400);
    }
    const beforePlan = clone(project.plan);
    const compiledPlan = compileSafeHouseSpec(body.spec, {
      styleId: body.styleId,
      furnitureStyle: body.furnitureStyle,
      safetyProfile: body.safetyProfile,
      anchorTallCabinets: body.anchorTallCabinets ?? true,
      autoHealCollisions: body.autoHealCollisions ?? true,
    });
    const diff = businessDiff(beforePlan, compiledPlan);
    const commands = buildPlanReplaceCommands(beforePlan, compiledPlan);
    const result = store.mutate(id, "commands", {
      operationId: body.operationId || `housespec-init-${crypto.randomUUID()}`,
      baseRevision: body.baseRevision ?? project.revision,
      summary: String(body.summary || compiledPlan.name || "AI 多房间全屋场景生成").slice(0, 200),
      commands,
    });
    if (!result.replayed) notify(id, result.project.revision);
    const checks = checkScene(result.project.plan);
    return {
      project: result.project,
      diff,
      checks,
      safetyAudit: auditSafety(result.project.plan),
      roomCount: result.project.plan.rooms.length,
      furnitureCount: result.project.plan.furniture.length,
    };
  });

  app.post("/api/projects/:id/safety-audit", async (req) => {
    const id = (req.params as any).id;
    const project = store.get(id);
    const body = ((req.body as Partial<SafetyProfile> | undefined) || {});
    const geometry = checkScene(project.plan);
    const safety = auditSafety(project.plan, {
      ...body,
      enabled: body.enabled ?? true,
    });

    const seen = new Set<string>();
    const combinedIssues: any[] = [];
    for (const issue of [...geometry.issues, ...safety.issues]) {
      const key = `${issue.code}:${(issue.objectIds || []).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combinedIssues.push(issue);
    }

    return {
      projectId: project.id,
      revision: project.revision,
      geometryChecks: geometry,
      safetyAudit: safety,
      combinedIssues,
      blockingCount: combinedIssues.filter(
        (i: any) => i.level === "error" && i.blocking !== false,
      ).length,
    };
  });

  app.post("/api/projects/:id/safety-profile", async (req) => {
    const id = (req.params as any).id;
    const project = store.get(id);
    const body = (req.body as any) || {};
    const profilePatch: SafetyProfile = {
      enabled: body.enabled ?? true,
      elderlyWheelchair: body.elderlyWheelchair ?? true,
      wheelchairDiameterMm: body.wheelchairDiameterMm ?? 1500,
      accessibleCorridorMm: body.accessibleCorridorMm ?? 850,
      seismicIntensity: body.seismicIntensity ?? 7,
      radarCheck: body.radarCheck ?? true,
      minRadarCoverageRatio: body.minRadarCoverageRatio ?? 0.85,
      ...(Array.isArray(body.radarSensors)
        ? { radarSensors: body.radarSensors }
        : {}),
    };

    const existingSource = project.plan.source || { kind: "safety-profile" };
    const nextSource = {
      ...existingSource,
      kind: existingSource.kind || "safety-profile",
      safetyProfile: profilePatch,
    };

    const result = store.mutate(id, "commands", {
      operationId: body.operationId || `safety-profile-${crypto.randomUUID()}`,
      baseRevision: body.baseRevision ?? project.revision,
      summary: profilePatch.enabled
        ? "启用适老无障碍、抗震防倾覆与鸿蒙雷达安全门禁"
        : "关闭扩展居家安全门禁",
      commands: [
        {
          type: "project",
          patch: { source: nextSource },
        },
      ],
    });
    if (!result.replayed) notify(id, result.project.revision);
    return {
      project: result.project,
      safetyAudit: auditSafety(result.project.plan),
    };
  });

  app.post("/api/projects/:id/anchor-furniture", async (req) => {
    const id = (req.params as any).id;
    const project = store.get(id);
    const body = (req.body as any) || {};
    const anchored = body.anchored ?? true;
    const targetIds: string[] = Array.isArray(body.furnitureIds)
      ? body.furnitureIds
      : project.plan.furniture
          .filter(
            (f) =>
              f.h >= 1400 &&
              f.h / Math.max(1, Math.min(f.w, f.d)) >= 2.0,
          )
          .map((f) => f.id);

    if (!targetIds.length) {
      throw new SceneError(
        "NO_ANCHORABLE_FURNITURE",
        "当前场景没有需要墙体防震锚固的高大柜体",
        400,
      );
    }

    const commands = targetIds
      .map((fid) => {
        const f = project.plan.furniture.find((item) => item.id === fid);
        if (!f) return null;
        return {
          type: "update" as const,
          collection: "furniture" as const,
          id: fid,
          patch: {
            opt: {
              ...(f.opt || {}),
              wallAnchored: Boolean(anchored),
            },
          },
        };
      })
      .filter(Boolean) as any[];

    const result = store.mutate(id, "commands", {
      operationId: body.operationId || `anchor-${crypto.randomUUID()}`,
      baseRevision: body.baseRevision ?? project.revision,
      summary: anchored
        ? `为 ${commands.length} 件高柜加装 L 型防震墙锚`
        : `移除 ${commands.length} 件高柜的防震墙锚`,
      commands,
    });
    if (!result.replayed) notify(id, result.project.revision);
    return {
      project: result.project,
      anchoredCount: commands.length,
      safetyAudit: auditSafety(result.project.plan, { enabled: true }),
    };
  });

  app.get("/api/projects/:id/export-mujoco", async (req, reply) => {
    const id = (req.params as any).id;
    const project = store.get(id);
    const dynamic = (req.query as any)?.dynamic !== "false";
    const xml = exportPlanToMujocoXml(project.plan, {
      dynamicFurniture: dynamic,
      modelName: project.plan.name || `actiscape_${id.slice(0, 8)}`,
    });
    return reply
      .type("application/xml; charset=utf-8")
      .header(
        "content-disposition",
        `attachment; filename="actiscape-${id.slice(0, 8)}-mujoco.xml"`,
      )
      .send(xml);
  });
}
