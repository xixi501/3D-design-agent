import { q0 } from "./inherited/catalog.js";
import { Wc, D4 } from "./inherited/topology.js";
import type { Furniture, Plan } from "./types.js";

/** Shared effective bottom elevation; ceiling-mounted catalogue items ignore instance z. */
export function furnitureElevation(
  f: Furniture,
  plan: Plan,
  regions?: any[],
): number {
  // Surface items follow their host's top face; this keeps a vase/lamp on a
  // table even when the host is later moved or resized.
  if (f.parentObjectId) {
    const seen = new Set<string>();
    let current: Furniture | undefined = f;
    let offset = 0;
    while (current?.parentObjectId && !seen.has(current.id)) {
      seen.add(current.id);
      const host = plan.furniture.find(
        (item) => item.id === current!.parentObjectId,
      );
      if (!host || host.id === current.id) break;
      offset += host.h;
      current = host;
    }
    if (current && current.id !== f.id) return offset + (current.z || 0);
  }
  if (!(q0 as Record<string, any>)[f.key]?.ceil) return f.z || 0;
  const room = (regions || D4(plan, Wc(plan)).regions).find((r: any) =>
    r.rects.some(
      (p: any) =>
        f.x >= p.x && f.x <= p.x + p.w && f.y >= p.y && f.y <= p.y + p.h,
    ),
  )?.labels[0];
  const ceiling =
    room?.ceil ??
    (room?.mat === "bath"
      ? { type: "flat", drop: 300 }
      : { type: "none", drop: 0 });
  return plan.height - (ceiling.type === "none" ? 0 : ceiling.drop || 0) - f.h;
}
