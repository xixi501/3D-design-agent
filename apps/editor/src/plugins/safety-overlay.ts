import * as THREE from "three";

export interface SafetyOverlayData {
  wheelchairCircles: Array<{
    roomId?: string;
    roomName: string;
    x: number;
    y: number;
    maxDiameterMm: number;
    requiredDiameterMm: number;
    passed: boolean;
    blockerIds: string[];
  }>;
  toppleZones: Array<{
    furnitureId: string;
    furnitureName: string;
    heightMm: number;
    slenderness: number;
    anchored: boolean;
    polygon: Array<{ x: number; y: number }>;
    hazardCodes: string[];
    hitObjectIds: string[];
  }>;
  radar: {
    sensors: Array<{
      id: string;
      name: string;
      x: number;
      y: number;
      z: number;
      aimDeg: number;
      fovDeg: number;
      maxRangeMm: number;
    }>;
    coverageRatio: number;
    cells: Array<{
      x: number;
      y: number;
      size: number;
      covered: boolean;
      occluderId?: string;
    }>;
  };
}

function makeTextBadge(
  text: string,
  bgHex: string,
  borderHex: string,
): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Rounded pill background
  const r = 24;
  ctx.fillStyle = bgHex;
  ctx.strokeStyle = borderHex;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(8, 12, canvas.width - 16, canvas.height - 24, r);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px system-ui, -apple-system, 'Microsoft YaHei', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 44);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.65, 0.31, 1);
  sprite.renderOrder = 999;
  return sprite;
}

export class SafetyTwinOverlay {
  public readonly group = new THREE.Group();
  private visibleLayers = {
    radar: true,
    wheelchair: true,
    seismic: true,
  };
  private lastData?: SafetyOverlayData;

  constructor(private scene: THREE.Scene) {
    this.group.name = "actiscape-safety-twin-overlay";
    this.scene.add(this.group);
  }

  public setLayerVisibility(
    layers: Partial<{ radar: boolean; wheelchair: boolean; seismic: boolean }>,
  ) {
    Object.assign(this.visibleLayers, layers);
    if (this.lastData) this.render(this.lastData);
  }

  public clear() {
    while (this.group.children.length > 0) {
      const child = this.group.children.pop()!;
      child.traverse((obj: any) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          for (const m of mats) {
            if (m.map) m.map.dispose();
            m.dispose();
          }
        }
      });
    }
  }

  public hide() {
    this.lastData = undefined;
    this.clear();
  }

  public render(data: SafetyOverlayData) {
    this.lastData = data;
    this.clear();

    if (this.visibleLayers.radar && data.radar) {
      this.renderRadarLayer(data.radar);
    }
    if (this.visibleLayers.wheelchair && data.wheelchairCircles) {
      this.renderWheelchairLayer(data.wheelchairCircles);
    }
    if (this.visibleLayers.seismic && data.toppleZones) {
      this.renderSeismicLayer(data.toppleZones);
    }
  }

  private renderRadarLayer(radar: SafetyOverlayData["radar"]) {
    const covered = radar.cells.filter((c) => c.covered);
    const blind = radar.cells.filter((c) => !c.covered);
    const cellSizeM = ((radar.cells[0]?.size || 250) * 0.001) * 0.88;
    const tileGeom = new THREE.PlaneGeometry(cellSizeM, cellSizeM);
    tileGeom.rotateX(-Math.PI / 2);

    const dummy = new THREE.Object3D();
    if (covered.length > 0) {
      const matOk = new THREE.MeshBasicMaterial({
        color: "#10b981",
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
      });
      const meshOk = new THREE.InstancedMesh(tileGeom.clone(), matOk, covered.length);
      covered.forEach((c, i) => {
        dummy.position.set(c.x * 0.001, 0.014, c.y * 0.001);
        dummy.updateMatrix();
        meshOk.setMatrixAt(i, dummy.matrix);
      });
      meshOk.instanceMatrix.needsUpdate = true;
      this.group.add(meshOk);
    }

    if (blind.length > 0) {
      const matBlind = new THREE.MeshBasicMaterial({
        color: "#ef4444",
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      });
      const meshBlind = new THREE.InstancedMesh(
        tileGeom.clone(),
        matBlind,
        blind.length,
      );
      blind.forEach((c, i) => {
        dummy.position.set(c.x * 0.001, 0.017, c.y * 0.001);
        dummy.updateMatrix();
        meshBlind.setMatrixAt(i, dummy.matrix);
      });
      meshBlind.instanceMatrix.needsUpdate = true;
      this.group.add(meshBlind);
    }
    tileGeom.dispose();

    // Render HarmonyOS mmWave radar hardware pucks & 60GHz FOV cones
    for (const s of radar.sensors) {
      const sx = s.x * 0.001;
      const sy = s.z * 0.001;
      const sz = s.y * 0.001;

      const puck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.085, 0.04, 24),
        new THREE.MeshBasicMaterial({ color: "#06b6d4" }),
      );
      puck.position.set(sx, sy, sz);
      this.group.add(puck);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.09, 0.13, 32),
        new THREE.MeshBasicMaterial({
          color: "#34d399",
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(sx, sy - 0.022, sz);
      this.group.add(halo);

      // Frustum wireframe rays
      const rayVerts: number[] = [];
      const halfFov = (s.fovDeg || 130) / 2;
      const reachM = Math.min(3.6, (s.maxRangeMm || 6800) * 0.001 * 0.55);
      const angles = [
        s.aimDeg - halfFov,
        s.aimDeg - halfFov * 0.5,
        s.aimDeg,
        s.aimDeg + halfFov * 0.5,
        s.aimDeg + halfFov,
      ];
      const arcPts: THREE.Vector3[] = [];
      for (const deg of angles) {
        const rad = (deg * Math.PI) / 180;
        const tx = sx + Math.cos(rad) * reachM;
        const tz = sz + Math.sin(rad) * reachM;
        rayVerts.push(sx, sy, sz, tx, 0.04, tz);
        arcPts.push(new THREE.Vector3(tx, 0.04, tz));
      }
      for (let i = 0; i < arcPts.length - 1; i++) {
        rayVerts.push(
          arcPts[i].x,
          arcPts[i].y,
          arcPts[i].z,
          arcPts[i + 1].x,
          arcPts[i + 1].y,
          arcPts[i + 1].z,
        );
      }
      const lineGeom = new THREE.BufferGeometry();
      lineGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(rayVerts, 3),
      );
      const frustumLines = new THREE.LineSegments(
        lineGeom,
        new THREE.LineBasicMaterial({
          color: "#06b6d4",
          transparent: true,
          opacity: 0.72,
        }),
      );
      this.group.add(frustumLines);

      const badge = makeTextBadge(
        `📡 ${s.name} · 覆盖 ${(radar.coverageRatio * 100).toFixed(0)}%`,
        radar.coverageRatio >= 0.85
          ? "rgba(6, 95, 70, 0.92)"
          : "rgba(153, 27, 27, 0.92)",
        radar.coverageRatio >= 0.85 ? "#34d399" : "#f87171",
      );
      badge.position.set(sx, sy + 0.24, sz);
      this.group.add(badge);
    }
  }

  private renderWheelchairLayer(
    circles: SafetyOverlayData["wheelchairCircles"],
  ) {
    for (const c of circles) {
      const cx = c.x * 0.001;
      const cz = c.y * 0.001;
      const reqRadiusM = (c.requiredDiameterMm * 0.001) / 2;
      const actualRadiusM = Math.max(0.2, (c.maxDiameterMm * 0.001) / 2);

      // Required 1500mm reference ring
      const reqRing = new THREE.Mesh(
        new THREE.RingGeometry(reqRadiusM - 0.028, reqRadiusM, 64),
        new THREE.MeshBasicMaterial({
          color: c.passed ? "#10b981" : "#f59e0b",
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
        }),
      );
      reqRing.rotation.x = -Math.PI / 2;
      reqRing.position.set(cx, 0.024, cz);
      this.group.add(reqRing);

      // Actual available turning disc
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(Math.min(reqRadiusM, actualRadiusM), 48),
        new THREE.MeshBasicMaterial({
          color: c.passed ? "#10b981" : "#ef4444",
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(cx, 0.021, cz);
      this.group.add(disc);

      const label = makeTextBadge(
        c.passed
          ? `♿ 轮椅回转达标 Ø${c.maxDiameterMm}mm (≥${c.requiredDiameterMm})`
          : `♿ 轮椅受阻 Ø${c.maxDiameterMm}mm (<国标${c.requiredDiameterMm}mm)`,
        c.passed ? "rgba(6, 95, 70, 0.92)" : "rgba(185, 28, 28, 0.92)",
        c.passed ? "#34d399" : "#fca5a5",
      );
      label.position.set(cx, 0.42, cz);
      this.group.add(label);
    }
  }

  private renderSeismicLayer(zones: SafetyOverlayData["toppleZones"]) {
    for (const z of zones) {
      if (z.polygon.length < 3) continue;
      const cx =
        (z.polygon.reduce((acc, p) => acc + p.x, 0) / z.polygon.length) * 0.001;
      const cz =
        (z.polygon.reduce((acc, p) => acc + p.y, 0) / z.polygon.length) * 0.001;

      if (z.anchored) {
        const anchorBadge = makeTextBadge(
          `🔩 ${z.furnitureName} · 已装L型防震墙锚`,
          "rgba(30, 58, 138, 0.92)",
          "#60a5fa",
        );
        anchorBadge.position.set(
          ((z.polygon[0].x + z.polygon[1].x) / 2) * 0.001,
          z.heightMm * 0.001 + 0.24,
          ((z.polygon[0].y + z.polygon[1].y) / 2) * 0.001,
        );
        this.group.add(anchorBadge);
        continue;
      }

      const isCritical =
        z.hazardCodes.includes("SEISMIC_TOPPLE_BED_HAZARD") ||
        z.hazardCodes.includes("SEISMIC_TOPPLE_EXIT_BLOCKED");

      // Quad mesh on floor showing exact toppling trajectory
      const positions: number[] = [];
      for (let i = 1; i < z.polygon.length - 1; i++) {
        const p0 = z.polygon[0];
        const p1 = z.polygon[i];
        const p2 = z.polygon[i + 1];
        positions.push(
          p0.x * 0.001,
          0.026,
          p0.y * 0.001,
          p1.x * 0.001,
          0.026,
          p1.y * 0.001,
          p2.x * 0.001,
          0.026,
          p2.y * 0.001,
        );
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geom.computeVertexNormals();
      const shadowMesh = new THREE.Mesh(
        geom,
        new THREE.MeshBasicMaterial({
          color: isCritical ? "#dc2626" : "#f59e0b",
          side: THREE.DoubleSide,
          transparent: true,
          opacity: isCritical ? 0.45 : 0.28,
          depthWrite: false,
        }),
      );
      this.group.add(shadowMesh);

      // Outline border of topple zone
      const borderPts = [...z.polygon, z.polygon[0]].map(
        (p) => new THREE.Vector3(p.x * 0.001, 0.03, p.y * 0.001),
      );
      const borderLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(borderPts),
        new THREE.LineBasicMaterial({
          color: isCritical ? "#fca5a5" : "#fcd34d",
        }),
      );
      this.group.add(borderLine);

      const tag = z.hazardCodes.includes("SEISMIC_TOPPLE_BED_HAZARD")
        ? `⚠️ 震时倾覆砸床高危：${z.furnitureName}`
        : z.hazardCodes.includes("SEISMIC_TOPPLE_EXIT_BLOCKED")
          ? `🚨 震时倾覆堵门高危：${z.furnitureName}`
          : `⚠️ 未锚固高柜 (高宽比 ${z.slenderness})`;
      const badge = makeTextBadge(
        tag,
        isCritical ? "rgba(153, 27, 27, 0.94)" : "rgba(146, 64, 14, 0.92)",
        isCritical ? "#f87171" : "#fbbf24",
      );
      badge.position.set(cx, Math.min(1.8, z.heightMm * 0.0006 + 0.35), cz);
      this.group.add(badge);
    }
  }
}
