/**
 * Curated, flattened OpenAPI 3.0.3 specification tailored specifically for
 * Huawei Cloud AgentArts MCP Gateway import (8 core tools, zero anyOf/oneOf).
 */
export function buildMcpOpenApiSpec(serverUrl?: string) {
  const resolvedUrl =
    serverUrl ||
    process.env.PUBLIC_BASE_URL ||
    process.env.ACTISCAPE_SCENE_URL ||
    "https://actiscape-bnu.serveousercontent.com";

  return {
    openapi: "3.0.3",
    info: {
      title: "ActiScape Safety & 3D Digital Twin MCP Tools",
      version: "2.0.0",
      description:
        "Deterministic 0.01mm spatial gatekeeper, elderly/seismic/HarmonyOS-radar safety auditor, and Hunyuan3D multi-view asset tools for Huawei Cloud AgentArts.",
    },
    servers: [{ url: resolvedUrl.replace(/\/+$/, "") }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/projects/{id}": {
        get: {
          operationId: "get_scene_snapshot",
          summary:
            "Read complete 3D room walls, openings, furniture coordinates (mm), and current revision.",
          tags: ["actiscape-scene-gatekeeper"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project UUID",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Current immutable project snapshot",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/api/projects/{id}/safety-audit": {
        post: {
          operationId: "run_safety_and_geometry_audit",
          summary:
            "Run deterministic collision, 1500mm wheelchair turning, 7-degree seismic topple, and HarmonyOS mmWave radar blind-spot checks.",
          tags: ["actiscape-scene-gatekeeper"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project UUID",
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    elderlyWheelchair: {
                      type: "boolean",
                      description:
                        "Check 1500mm wheelchair turning circle and 850mm accessible corridor",
                    },
                    seismicIntensity: {
                      type: "integer",
                      description: "Seismic fortification intensity (6, 7, or 8)",
                    },
                    radarCheck: {
                      type: "boolean",
                      description:
                        "Evaluate HarmonyOS mmWave fall-detection radar occlusion coverage",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Deterministic geometry + elderly/seismic/radar audit report with GB standard citations",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/api/projects/{id}/candidates": {
        post: {
          operationId: "propose_layout_candidate",
          summary:
            "Create an immutable layout candidate with deterministic preflight checks without mutating the formal project.",
          tags: ["actiscape-scene-gatekeeper"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Project UUID",
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["requestId", "taskId", "baseRevision"],
                  properties: {
                    requestId: { type: "string" },
                    taskId: { type: "string" },
                    baseRevision: { type: "integer" },
                    summary: { type: "string" },
                    verification: {
                      type: "string",
                      enum: ["screenshots", "deterministic"],
                    },
                    scope: { type: "object" },
                    edits: {
                      type: "array",
                      items: { type: "object" },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Immutable candidate record and preflight check result",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/api/projects/{id}/candidates/{candidate}/render": {
        post: {
          operationId: "render_candidate_views",
          summary:
            "Render SHA256-verified top and oblique PNG evidence screenshots via pooled Chromium.",
          tags: ["actiscape-scene-gatekeeper"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "candidate",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Top and oblique evidence descriptors with SHA256",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/projects/{id}/candidates/{candidate}/commit": {
        post: {
          operationId: "commit_reviewed_candidate",
          summary:
            "Atomically commit a reviewed candidate after re-verifying revision, hash, and zero blocking checks.",
          tags: ["actiscape-scene-gatekeeper"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "candidate",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["operationId", "baseRevision", "candidateHash"],
                  properties: {
                    operationId: { type: "string" },
                    baseRevision: { type: "integer" },
                    candidateHash: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Committed project revision",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/api/assets/jobs": {
        get: {
          operationId: "list_3d_asset_jobs",
          summary:
            "List asynchronous Hunyuan3D-2 / 2mv image-to-3D generation jobs and cache status.",
          tags: ["actiscape-hunyuan3d-asset"],
          responses: {
            "200": {
              description: "Asset generation job list",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/api/assets/jobs/{id}": {
        get: {
          operationId: "poll_3d_asset_job",
          summary:
            "Poll an asynchronous 3D asset generation job (<1s non-blocking) and import GLB upon completion.",
          tags: ["actiscape-hunyuan3d-asset"],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              description: "Asset Job UUID",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Job status and normalized GLB asset metadata",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/api/assets/{assetId}/calibrate": {
        post: {
          operationId: "calibrate_3d_asset_height",
          summary:
            "Calibrate physical height (mm) of a generated 3D GLB asset while preserving aspect ratio and bottom-center pivot.",
          tags: ["actiscape-hunyuan3d-asset"],
          parameters: [
            {
              name: "assetId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["targetHeightMm"],
                  properties: {
                    targetHeightMm: {
                      type: "number",
                      description: "Target physical height in millimeters",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Calibrated asset metadata",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
    },
  };
}
