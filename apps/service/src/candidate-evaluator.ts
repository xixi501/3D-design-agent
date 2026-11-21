import { createHash } from "node:crypto";
import { ProjectStore, canonical } from "./store.js";
import { EditAuthorizations, checkExpected } from "./edit-authorizations.js";
import {
  SceneError,
  type SceneState,
} from "../../../packages/scene-core/src/index.js";
import {
  checkFloorplanInitialization,
  type FloorplanBinding,
  type SymbolMatch,
} from "../../../packages/scene-core/src/floorplan.js";
import {
  checkInitialization,
  type RectangularBrief,
} from "../../../packages/scene-core/src/rectangular.js";
import {
  checkCandidate,
  type CheckReport,
  type EditScope,
} from "../../../packages/scene-core/src/candidate.js";

export const sha256 = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export type CandidateKind = "edit" | "initialize" | "initialize_floorplan";

export interface CandidateEvaluationInput {
  kind: CandidateKind;
  before: SceneState;
  after: SceneState;
  taskId: string;
  scope: EditScope;
  authorization?: any;
  brief?: RectangularBrief;
  floorplan?: {
    data: any;
    binding: FloorplanBinding;
    matches: SymbolMatch[];
  };
}

/**
 * Single source of truth for candidate deterministic rule evaluation,
 * shared across both CandidateStore.create() preflight and commit() replay.
 */
export class CandidateRuleEvaluator {
  evaluate(input: CandidateEvaluationInput): CheckReport {
    if (input.kind === "initialize_floorplan") {
      const fp = input.floorplan!;
      const raw = checkFloorplanInitialization(
        input.before,
        input.after,
        fp.data,
        input.taskId,
        fp.binding,
        fp.matches,
      );
      return checkExpected(raw, input.after, input.authorization);
    }
    if (input.kind === "initialize") {
      const raw = checkInitialization(
        input.before,
        input.after,
        input.brief!,
        input.taskId,
        input.scope,
      );
      return checkExpected(raw, input.after, input.authorization);
    }
    const raw = checkCandidate(input.before, input.after, input.scope);
    return checkExpected(raw, input.after, input.authorization);
  }

  hasIndependentAuthorizationHead(
    projects: ProjectStore,
    project: string,
    taskId: string,
  ): boolean {
    return Boolean(
      projects.db
        .prepare(
          "SELECT 1 FROM edit_authorization_heads WHERE project=? AND task_id=?",
        )
        .get(project, taskId),
    );
  }

  assertVersionedAuthorization(
    projects: ProjectStore,
    params: {
      project: string;
      taskId: string;
      version: number;
      baseRevision: number;
      scopeHash: string;
      scope: EditScope;
      kind: "edit" | "initialize";
    },
  ) {
    return new EditAuthorizations(projects).assert(
      params.project,
      params.taskId,
      params.version,
      params.baseRevision,
      params.scopeHash,
      params.scope,
      params.kind,
    );
  }
}
