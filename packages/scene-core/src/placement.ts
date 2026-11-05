import { q0 } from "./inherited/catalog.js";
import { Wc, D4 } from "./inherited/topology.js";
import type { Furniture, Plan } from "./types.js";

/** Shared effective bottom elevation; ceiling-mounted catalogue items ignore instance z. */
export function furnitureElevation(
  f: Furniture,
  plan: Plan,
  regions?: any[],
): number {
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
