/**
 * Whole-home room vocabulary shared by rectangular generation, floorplan
 * recognition and the agent scene registry. These are spatial kinds (what the
 * room is used for), not catalogue or project IDs.
 */
export const SCENE_ROOM_KINDS = [
  "living_dining",
  "reading_lounge",
  "bedroom",
  "study",
  "kitchen",
  "bathroom",
  "entry",
  "circulation",
  "balcony",
  "utility",
  "multipurpose",
  "other",
] as const;

export type SceneRoomKind = (typeof SCENE_ROOM_KINDS)[number];

const ROOM_KIND_BY_TYPE: Record<string, SceneRoomKind> = {
  living_dining: "living_dining",
  reading_lounge: "reading_lounge",
  master_bedroom: "bedroom",
  guest_bedroom: "bedroom",
  kids_room: "bedroom",
  nursery: "bedroom",
  study: "study",
  kitchen: "kitchen",
  bathroom: "bathroom",
  entry: "entry",
  circulation: "circulation",
  hallway: "circulation",
  balcony: "balcony",
  utility: "utility",
  storage: "utility",
  multipurpose: "multipurpose",
  dining_hall: "living_dining",
  tea_room: "multipurpose",
  media_room: "multipurpose",
  teaching_lab: "multipurpose",
  seminar_classroom: "multipurpose",
  other: "other",
};

const ROOM_KIND_BY_FUNCTIONAL_AREA: Record<string, SceneRoomKind> = {
  living: "living_dining",
  dining: "living_dining",
  bedroom: "bedroom",
  study: "study",
  kitchen: "kitchen",
  bathroom: "bathroom",
  entry: "entry",
  circulation: "circulation",
  balcony: "balcony",
  storage: "utility",
  utility: "utility",
  multipurpose: "multipurpose",
  other: "other",
};

/**
 * Resolve a stable spatial kind from either a scene-registry room type or a
 * floorplan functional area. Unknown values stay explicit as `other` instead
 * of silently defaulting to the legacy living/dining scope.
 */
export function sceneRoomKind(
  roomType?: string | null,
  functionalArea?: string | null,
): SceneRoomKind {
  if (roomType) {
    const kind = ROOM_KIND_BY_TYPE[roomType];
    if (kind) return kind;
  }
  if (functionalArea) {
    const kind = ROOM_KIND_BY_FUNCTIONAL_AREA[functionalArea];
    if (kind) return kind;
  }
  return "other";
}

export function isSceneRoomKind(value: unknown): value is SceneRoomKind {
  return (
    typeof value === "string" &&
    (SCENE_ROOM_KINDS as readonly string[]).includes(value)
  );
}
