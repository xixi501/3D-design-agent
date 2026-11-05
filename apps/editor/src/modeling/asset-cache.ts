import { Group, Mesh } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AssetRecord } from "../../../../packages/scene-core/src/index.js";
const records = new Map<string, AssetRecord>(),
  models = new Map<string, Group>(),
  pending = new Map<string, Promise<void>>();
export const DC = (id: string) => {
  const root = models.get(id)?.clone(true);
  root?.traverse((o) => {
    if (o instanceof Mesh)
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => m.clone())
        : o.material.clone();
  });
  return root ?? null;
};
export const fv = (id: string) => records.get(id);
export const LC = (_id: string) => null;
export async function ensureAsset(id: string) {
  if (models.has(id)) return;
  if (pending.has(id)) return pending.get(id);
  const task = (async () => {
    const response = await fetch(`/api/assets/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`模型资产 ${id} 不可用`);
    const record: AssetRecord = await response.json();
    const gltf = await new GLTFLoader().loadAsync(
      `/api/assets/${encodeURIComponent(id)}/file`,
    );
    const wrapper = new Group(),
      content = new Group();
    content.add(gltf.scene);
    const [x, y, z] = record.normalization.center;
    content.position.set(-x, -y, -z);
    wrapper.add(content);
    wrapper.scale.setScalar(record.normalization.scale);
    // Preserve normalized scale inside a parent; Ov sets the instance parent's scale.
    const root = new Group();
    root.add(wrapper);
    root.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = o.receiveShadow = true;
        o.geometry.userData.shared = true;
      }
    });
    records.set(id, record);
    models.set(id, root);
  })();
  pending.set(id, task);
  try {
    await task;
  } finally {
    pending.delete(id);
  }
}
export const ensureAssets = (ids: string[]) =>
  Promise.all(ids.map(ensureAsset));
