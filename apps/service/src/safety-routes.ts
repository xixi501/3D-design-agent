import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  auditSafety,
  checkScene,
  exportPlanToMujocoXml,
  SceneError,
  type SafetyProfile,
} from "../../../packages/scene-core/src/index.js";
import { buildMcpOpenApiSpec } from "./mcp-openapi.js";
import type { ProjectStore } from "./store.js";

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
        (i) => i.level === "error" && i.blocking !== false,
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
