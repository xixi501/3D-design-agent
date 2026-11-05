/** Scene coordinates and lengths are millimetres; x/y are the floor plane, z is up. */
export type RecordData = Record<string, any>;
export interface Entity extends RecordData {
  id: string;
}
export interface Point {
  x: number;
  y: number;
}
export interface Furniture extends Entity, Point {
  key: string;
  type: string;
  name: string;
  w: number;
  d: number;
  h: number;
  rot: number;
  z?: number;
  color: string;
  opt?: RecordData;
  cab?: RecordData;
  kit?: RecordData;
  modelId?: string;
}
export const collections = [
  "nodes",
  "walls",
  "openings",
  "furniture",
  "structs",
  "beams",
  "rooms",
  "measures",
  "elec",
  "voids",
  "comments",
] as const;
export type Collection = (typeof collections)[number];
export interface Plan extends RecordData {
  version: 2;
  name: string;
  height: number;
  nodes: (Entity & Point)[];
  walls: Entity[];
  openings: Entity[];
  furniture: Furniture[];
  structs: Entity[];
  beams: Entity[];
  rooms: Entity[];
  measures: Entity[];
  elec: Entity[];
  voids: Entity[];
  comments: Entity[];
}
export interface SceneState {
  plan: Plan;
  roomLabelArchive: Entity[];
}
export interface Project extends SceneState {
  formatVersion: 1;
  id: string;
  revision: number;
  assets: string[];
  updatedAt: string;
  history: { undo: number; redo: number };
}
export type Command =
  | { type: "add"; collection: Collection; object: Entity }
  | { type: "update"; collection: Collection; id: string; patch: RecordData }
  | { type: "delete"; collection: Collection; id: string }
  | {
      type: "createFurniture";
      key: string;
      x: number;
      y: number;
      overrides?: RecordData;
    }
  | {
      type: "duplicate";
      collection: Collection;
      id: string;
      offset?: { x?: number; y?: number; z?: number };
    }
  | { type: "project"; patch: RecordData };
export interface Mutation {
  operationId: string;
  baseRevision: number;
  summary?: string;
  commands?: Command[];
}
export interface AssetRecord {
  id: string;
  sha256: string;
  name: string;
  bytes: number;
  w: number;
  d: number;
  h: number;
  normalization: { scale: number; center: [number, number, number] };
}
export class SceneError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
