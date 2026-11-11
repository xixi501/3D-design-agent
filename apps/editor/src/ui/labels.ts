import { detectRooms, type Plan } from "../../../../packages/scene-core/src/index.js";

const projectNames: Record<string, string> = {
  "Evaluation only: 2BHK bungalow development reference": "全屋 · 2BHK 样板间",
  "Evaluation only: 2BHK bungalow development reference ": "全屋 · 2BHK 样板间",
  新户型: "未命名空间",
};

const roomNames: Record<string, string> = {
  "LIVING ROOM / DINING / KITCHEN": "客餐厅",
  "ENT. LOBBY": "玄关",
  UTILITY: "家政间",
  UP: "楼梯厅",
  WC: "客卫",
  BATH: "浴室",
  TOILET: "卫生间",
  "BED ROOM": "卧室",
};

export function displayProjectName(name?: string) {
  if (!name) return "未命名空间";
  if (projectNames[name]) return projectNames[name];
  if (name.startsWith("Evaluation only:")) return "全屋 · 2BHK 样板间";
  return name;
}

export function displayRoomName(room?: any) {
  if (!room) return "空间";
  if (room.roomType === "master_bedroom") return "主卧";
  if (room.roomType === "guest_bedroom") return "次卧";
  if (room.roomType === "living_dining") return "客餐厅";
  if (room.roomType === "entry") return "玄关";
  if (room.roomType === "utility") return "家政间";
  if (room.roomType === "circulation") return "楼梯厅";
  if (room.roomType === "bathroom") {
    if (room.name === "WC") return "客卫";
    if (room.name === "BATH") return "浴室";
    return "卫生间";
  }
  return roomNames[room.name || ""] || room.name || "空间";
}

export function roomArea(plan: Plan, roomId: string) {
  try {
    const rooms = detectRooms(plan);
    const region = rooms.regions.find((r: any) =>
      r.labels?.some((label: any) => label.id === roomId),
    );
    if (!region) return undefined;
    return Math.round(((region.bb.w * region.bb.h) / 1_000_000) * 10) / 10;
  } catch {
    return undefined;
  }
}
