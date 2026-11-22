import * as THREE from "three";
import type { Furniture, Plan } from "../../../../packages/scene-core/src/index.js";
import type { ThreeView } from "../views/three-view.js";

export interface SeismicDrillEvent {
  timeSec: number;
  furnitureId: string;
  furnitureName: string;
  kind: "rocking" | "toppled_bed" | "toppled_exit" | "toppled_floor" | "anchored_safe";
  message: string;
}

export interface SeismicDrillStatus {
  running: boolean;
  finished: boolean;
  elapsedSec: number;
  durationSec: number;
  intensity: 6 | 7 | 8;
  pgaG: number;
  events: SeismicDrillEvent[];
}

interface SavedTransform {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
}

interface BodySimState {
  f: Furniture;
  obj: THREE.Object3D;
  basePos: THREE.Vector3;
  baseQuat: THREE.Quaternion;
  anchored: boolean;
  slender: boolean;
  halfB: number; // half thickness along weak axis (m)
  hCom: number; // elevated center of mass height 0.62*H (m)
  radiusR: number;
  critAlpha: number;
  maxTheta: number; // resting angle on bed (~58 deg) or floor (88 deg)
  frontDirX: number; // Three.js X
  frontDirZ: number; // Three.js Z
  hingeAxis: THREE.Vector3; // horizontal axis perpendicular to frontDir
  theta: number;
  omega: number;
  slipX: number;
  slipZ: number;
  hazardKind: "bed" | "exit" | "floor";
  targetName?: string;
  reportedRocking: boolean;
  reportedTopple: boolean;
  tintedMaterials: Array<{ mat: any; origEmissive: THREE.Color; origIntensity: number }>;
}

export class SeismicWaveDrillController {
  private rafId = 0;
  private running = false;
  private finished = false;
  private startTimeMs = 0;
  private lastFrameMs = 0;
  private readonly durationSec = 8.0;
  private intensity: 6 | 7 | 8 = 7;
  private savedRootPos = new THREE.Vector3();
  private savedTransforms = new Map<string, SavedTransform>();
  private bodies: BodySimState[] = [];
  private events: SeismicDrillEvent[] = [];
  private onUpdate?: (status: SeismicDrillStatus) => void;

  constructor(private three: ThreeView) {}

  public isActive(): boolean {
    return this.running || this.finished;
  }

  public start(
    plan: Plan,
    options: {
      intensity?: 6 | 7 | 8;
      toppleZones?: Array<{
        furnitureId: string;
        anchored: boolean;
        hazardCodes: string[];
        hitObjectIds: string[];
      }>;
      onUpdate?: (status: SeismicDrillStatus) => void;
    } = {},
  ) {
    this.reset();
    this.intensity = options.intensity ?? 7;
    this.onUpdate = options.onUpdate;
    this.events = [];

    this.savedRootPos.copy(this.three.root.position);
    const zoneMap = new Map(
      (options.toppleZones || []).map((z) => [z.furnitureId, z]),
    );

    const beds = plan.furniture.filter((item) =>
      /bed|crib|bunk/i.test(`${item.key} ${item.type}`),
    );

    for (const f of plan.furniture) {
      const obj = (this.three as any).furniture?.get(f.id) as
        | THREE.Object3D
        | undefined;
      if (!obj) continue;

      this.savedTransforms.set(f.id, {
        pos: obj.position.clone(),
        quat: obj.quaternion.clone(),
      });

      const rad = ((f.rot || 0) * Math.PI) / 180;
      // Plan rot=0 -> front is +Y (Three.js +Z); rot=90 -> front is -X (Three.js -X)
      const frontDirX = -Math.sin(rad);
      const frontDirZ = Math.cos(rad);
      // Right-hand rule in Three.js (Y-up): rotating top toward (frontDirX, 0, frontDirZ)
      // uses axis = Y x frontDir = (0,1,0) x (fx, 0, fz) = (fz, 0, -fx)!
      // Wait: let's verify! At rot=0, frontDir = (0, 0, +1).
      // Cross((1, 0, 0), (0, 1, 0)) = (0, 0, 1); rotating (0, 1, 0) around +X by +theta gives (0, cos, +sin)!
      // And (fz, 0, -fx) at fx=0, fz=1 is (+1, 0, 0) = +X! Exact right-hand match!
      const hingeAxis = new THREE.Vector3(frontDirZ, 0, -frontDirX).normalize();

      const minBaseMm = Math.max(80, Math.min(f.w, f.d));
      const slenderness = f.h / minBaseMm;
      const minSlender =
        this.intensity >= 8 ? 1.9 : this.intensity === 7 ? 2.2 : 2.6;
      const slender = f.h >= 1400 && slenderness >= minSlender && (f.z || 0) < 300;
      const anchored = Boolean(f.opt?.wallAnchored) || f.placement === "wall";

      const halfB = (f.d * 0.001) / 2;
      const hCom = f.h * 0.001 * 0.62; // Elevated CoM 0.62 * H
      const radiusR = Math.hypot(halfB, hCom);
      const critAlpha = Math.atan2(halfB, hCom);

      const zone = zoneMap.get(f.id);
      let hazardKind: "bed" | "exit" | "floor" = "floor";
      let maxTheta = (87 * Math.PI) / 180;
      let targetName: string | undefined;

      if (zone?.hazardCodes.includes("SEISMIC_TOPPLE_BED_HAZARD")) {
        hazardKind = "bed";
        const hitBed = beds.find((b) => zone.hitObjectIds.includes(b.id)) || beds[0];
        targetName = hitBed?.name || "卧床";
        const bedH = (hitBed?.h || 900) * 0.001;
        const cabinetH = Math.max(bedH + 0.2, f.h * 0.001);
        // Rests diagonally onto the mattress top surface
        maxTheta = Math.acos(Math.min(0.85, (bedH * 0.78) / cabinetH));
      } else if (zone?.hazardCodes.includes("SEISMIC_TOPPLE_EXIT_BLOCKED")) {
        hazardKind = "exit";
        targetName = "逃生门洞内侧生命通道";
        maxTheta = (86 * Math.PI) / 180;
      }

      if (slender && anchored) {
        this.events.push({
          timeSec: 0,
          furnitureId: f.id,
          furnitureName: f.name,
          kind: "anchored_safe",
          message: `🔩 ${f.name} 已启用 L 型防震墙锚（wallAnchored），墙体拉结约束生效`,
        });
      }

      this.bodies.push({
        f,
        obj,
        basePos: obj.position.clone(),
        baseQuat: obj.quaternion.clone(),
        anchored,
        slender,
        halfB,
        hCom,
        radiusR,
        critAlpha,
        maxTheta,
        frontDirX,
        frontDirZ,
        hingeAxis,
        theta: 0,
        omega: 0,
        slipX: 0,
        slipZ: 0,
        hazardKind,
        targetName,
        reportedRocking: false,
        reportedTopple: false,
        tintedMaterials: [],
      });

      if (slender && anchored) {
        this.tintObject(this.bodies[this.bodies.length - 1], "#2563eb", 0.35);
      }
    }

    this.running = true;
    this.finished = false;
    this.startTimeMs = performance.now();
    this.lastFrameMs = this.startTimeMs;
    this.emitStatus(0);
    this.rafId = requestAnimationFrame((now) => this.step(now));
  }

  private tintObject(body: BodySimState, hex: string, intensity: number) {
    const color = new THREE.Color(hex);
    body.obj.traverse((node: any) => {
      if (!node.isMesh || !node.material) return;
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) {
        if (m.emissive) {
          if (!body.tintedMaterials.some((x) => x.mat === m)) {
            body.tintedMaterials.push({
              mat: m,
              origEmissive: m.emissive.clone(),
              origIntensity: m.emissiveIntensity ?? 1,
            });
          }
          m.emissive.copy(color);
          m.emissiveIntensity = intensity;
        }
      }
    });
  }

  private step(nowMs: number) {
    if (!this.running) return;
    const elapsedSec = Math.min(
      this.durationSec,
      (nowMs - this.startTimeMs) / 1000,
    );
    const dt = Math.min(0.035, Math.max(0.004, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;

    // Intensity scale: 6 deg -> 0.55x, 7 deg (rare) -> 1.0x (~0.36g), 8 deg -> 1.45x (~0.52g)
    const ampScale =
      this.intensity >= 8 ? 1.45 : this.intensity === 7 ? 1.05 : 0.6;
    const env = Math.pow(Math.sin((Math.PI * elapsedSec) / this.durationSec), 1.25);

    // Ground displacement (meters) for visual structural shaking
    const ux =
      env *
      ampScale *
      (0.038 * Math.sin(2 * Math.PI * 2.15 * elapsedSec) +
        0.021 * Math.sin(2 * Math.PI * 3.8 * elapsedSec + 0.7));
    const uz =
      env *
      ampScale *
      (0.034 * Math.cos(2 * Math.PI * 1.9 * elapsedSec) +
        0.019 * Math.sin(2 * Math.PI * 3.4 * elapsedSec + 1.3));
    this.three.root.position.set(
      this.savedRootPos.x + ux,
      this.savedRootPos.y,
      this.savedRootPos.z + uz,
    );

    // Ground horizontal acceleration components (m/s^2)
    const ax =
      env *
      ampScale *
      (3.4 * Math.sin(2 * Math.PI * 2.15 * elapsedSec + 0.3) +
        2.1 * Math.cos(2 * Math.PI * 3.9 * elapsedSec));
    const az =
      env *
      ampScale *
      (3.2 * Math.cos(2 * Math.PI * 1.9 * elapsedSec + 0.2) +
        2.0 * Math.sin(2 * Math.PI * 3.4 * elapsedSec));

    const g = 9.81;
    const rotQuat = new THREE.Quaternion();
    const offsetVec = new THREE.Vector3();

    for (const b of this.bodies) {
      if (b.anchored) {
        // Wall-anchored cabinet: tiny elastic structural flex (< 0.3 deg), zero topple
        const microFlex = env * 0.004 * Math.sin(2 * Math.PI * 6.0 * elapsedSec);
        rotQuat.setFromAxisAngle(b.hingeAxis, microFlex);
        b.obj.quaternion.copy(b.baseQuat).premultiply(rotQuat);
        continue;
      }

      if (!b.slender) {
        // Low CoM furniture: micro frictional floorjitter
        if (Math.hypot(ax, az) > 2.4 && elapsedSec < 6.8) {
          b.slipX = THREE.MathUtils.clamp(b.slipX + ax * dt * 0.0018, -0.025, 0.025);
          b.slipZ = THREE.MathUtils.clamp(b.slipZ + az * dt * 0.0018, -0.025, 0.025);
          b.obj.position.set(
            b.basePos.x + b.slipX,
            b.basePos.y,
            b.basePos.z + b.slipZ,
          );
        }
        continue;
      }

      // Unanchored slender tall cabinet: Housner inverted-pendulum overturning dynamics
      // Forward ground inertia pulse pushing the elevated CoM (+0.62H) past its narrow toe
      const forwardDrive =
        Math.abs(ax * b.frontDirX + az * b.frontDirZ) * 1.35 +
        (elapsedSec > 1.3 && elapsedSec < 4.8 ? env * ampScale * 2.35 : 0);

      if (b.theta < b.maxTheta) {
        const inertia = (4 / 3) * b.radiusR;
        const accelTorque =
          forwardDrive * Math.cos(Math.max(-0.5, b.critAlpha - b.theta));
        const gravityTorque = g * Math.sin(b.critAlpha - b.theta);
        const alphaDot = (accelTorque - gravityTorque) / Math.max(0.25, inertia);

        if (b.theta > 0.001 || alphaDot > 0) {
          b.omega += alphaDot * dt - b.omega * 0.55 * dt;
          b.theta += b.omega * dt;
          if (b.theta < 0) {
            b.theta = 0;
            b.omega = Math.max(0, -b.omega * 0.25);
          }
        }

        if (!b.reportedRocking && b.theta > 0.09) {
          b.reportedRocking = true;
          this.tintObject(b, "#f59e0b", 0.45);
          this.events.push({
            timeSec: Number(elapsedSec.toFixed(1)),
            furnitureId: b.f.id,
            furnitureName: b.f.name,
            kind: "rocking",
            message: `t=${elapsedSec.toFixed(1)}s ⚠️ ${b.f.name} 高重心（0.62H）失稳开始剧烈摇摆`,
          });
        }

        if (b.theta >= b.maxTheta) {
          b.theta = b.maxTheta;
          b.omega = 0;
          if (!b.reportedTopple) {
            b.reportedTopple = true;
            this.tintObject(b, "#dc2626", 0.72);
            const kind =
              b.hazardKind === "bed"
                ? "toppled_bed"
                : b.hazardKind === "exit"
                  ? "toppled_exit"
                  : "toppled_floor";
            const msg =
              b.hazardKind === "bed"
                ? `t=${elapsedSec.toFixed(1)}s 🚨 严重震害：${b.f.name} 倾覆直接砸中 ${b.targetName}！`
                : b.hazardKind === "exit"
                  ? `t=${elapsedSec.toFixed(1)}s 🚨 严重震害：${b.f.name} 倾覆彻底封堵 ${b.targetName}！`
                  : `t=${elapsedSec.toFixed(1)}s ⚠️ ${b.f.name} 未锚固发生整体翻倒！`;
            this.events.push({
              timeSec: Number(elapsedSec.toFixed(1)),
              furnitureId: b.f.id,
              furnitureName: b.f.name,
              kind,
              message: msg,
            });
          }
        }
      }

      // Pivot transform around front-bottom toe edge so the cabinet never sinks below y=0
      const pivotX = b.basePos.x + b.frontDirX * b.halfB;
      const pivotY = b.basePos.y;
      const pivotZ = b.basePos.z + b.frontDirZ * b.halfB;

      rotQuat.setFromAxisAngle(b.hingeAxis, b.theta);
      offsetVec
        .set(
          b.basePos.x - pivotX,
          b.basePos.y - pivotY,
          b.basePos.z - pivotZ,
        )
        .applyQuaternion(rotQuat);

      b.obj.position.set(
        pivotX + offsetVec.x,
        pivotY + offsetVec.y,
        pivotZ + offsetVec.z,
      );
      b.obj.quaternion.copy(b.baseQuat).premultiply(rotQuat);
    }

    if (elapsedSec >= this.durationSec) {
      this.running = false;
      this.finished = true;
      // Restore ground root offset while keeping post-quake fallen furniture state visible for inspection
      this.three.root.position.copy(this.savedRootPos);
      this.emitStatus(this.durationSec);
      return;
    }

    this.emitStatus(elapsedSec);
    this.rafId = requestAnimationFrame((now) => this.step(now));
  }

  private emitStatus(elapsedSec: number) {
    if (!this.onUpdate) return;
    const pgaG =
      this.intensity >= 8 ? 0.48 : this.intensity === 7 ? 0.34 : 0.18;
    this.onUpdate({
      running: this.running,
      finished: this.finished,
      elapsedSec,
      durationSec: this.durationSec,
      intensity: this.intensity,
      pgaG,
      events: [...this.events],
    });
  }

  /** Instantaneous (< 1ms) zero-mutation restoration of all Three.js transforms & materials. */
  public reset() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.running || this.finished || this.savedTransforms.size > 0) {
      this.three.root.position.copy(this.savedRootPos);
      for (const b of this.bodies) {
        for (const item of b.tintedMaterials) {
          item.mat.emissive.copy(item.origEmissive);
          item.mat.emissiveIntensity = item.origIntensity;
        }
      }
      for (const [fid, saved] of this.savedTransforms) {
        const obj = (this.three as any).furniture?.get(fid) as
          | THREE.Object3D
          | undefined;
        if (obj) {
          obj.position.copy(saved.pos);
          obj.quaternion.copy(saved.quat);
        }
      }
    }
    this.running = false;
    this.finished = false;
    this.bodies = [];
    this.savedTransforms.clear();
    this.events = [];
  }
}
