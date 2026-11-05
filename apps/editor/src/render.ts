import * as THREE from "three";
import { ThreeView } from "./views/three-view.js";
import { wallGeometry } from "../../../packages/scene-core/src/index.js";

const w = window as any;
try {
  const params = new URLSearchParams(location.search),
    project = params.get("project"),
    id = params.get("candidate");
  if (!project || !id) throw new Error("缺少候选身份");
  const response = await fetch(
    `/api/projects/${encodeURIComponent(project)}/candidates/${encodeURIComponent(id)}`,
  );
  if (!response.ok) throw new Error("候选不可用");
  const c = await response.json(),
    view = new ThreeView(
      document.querySelector("#render")!,
      () => {},
      () => {},
      async () => {
        throw new Error("只读渲染禁止编辑");
      },
    );
  await view.rebuild(c.state.plan, {
    projectId: project,
    revision: c.baseRevision,
  });
  view.root.traverse((object) => {
    if (object.userData.evidenceCeiling) object.visible = false;
    if (
      object instanceof THREE.Mesh &&
      (object.userData.wallId || object.userData.collection === "openings")
    ) {
      const materials = (
        Array.isArray(object.material) ? object.material : [object.material]
      ).map((material) => {
        const copy = material.clone();
        copy.transparent = true;
        copy.opacity = 0.15;
        copy.depthWrite = false;
        return copy;
      });
      object.material = Array.isArray(object.material)
        ? materials
        : materials[0];
      object.castShadow = false;
    }
  });
  view.controls.enabled = false;
  view.controls.enableDamping = false;
  const bounds = wallGeometry(c.state.plan).bounds,
    center = new THREE.Vector3(
      (bounds.x + bounds.w / 2) / 1000,
      0,
      (bounds.y + bounds.h / 2) / 1000,
    );
  const extent = Math.max(bounds.w, bounds.h, 4000) / 1000;
  w.__captureCandidate = () =>
    ["top", "oblique"].map((preset) => {
      view.renderer.setPixelRatio(1);
      view.renderer.setSize(960, 720);
      view.controls.target.copy(center);
      view.camera.up.set(
        0,
        preset === "top" ? 0 : 1,
        preset === "top" ? -1 : 0,
      );
      view.camera.position
        .copy(center)
        .add(
          preset === "top"
            ? new THREE.Vector3(0, extent * 1.4, 0.001)
            : new THREE.Vector3(extent * 1.1, extent * 1.1, extent * 1.25),
        );
      view.camera.aspect = 960 / 720;
      view.camera.lookAt(center);
      view.camera.updateProjectionMatrix();
      view.camera.updateMatrixWorld();
      view.renderer.render(view.scene, view.camera);
      if (
        !view.renderer.info.render.calls ||
        view.renderer.getContext().isContextLost()
      )
        throw new Error("没有有效 WebGL 绘制");
      return {
        view: preset,
        image: view.renderer.domElement.toDataURL("image/png"),
      };
    });
  w.__candidateReady = true;
} catch (e) {
  w.__candidateError = (e as Error).message;
}
