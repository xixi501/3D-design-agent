import { createHash } from "node:crypto";
import { Box3, Matrix4, Vector3, Quaternion } from "three";
import {
  SceneError,
  type AssetRecord,
} from "../../../packages/scene-core/src/index.js";

/** Apply a user-confirmed millimetre height without rewriting the immutable GLB. */
export function calibrateAssetRecord(
  record: AssetRecord,
  targetHeightMm: number,
): AssetRecord {
  if (
    !Number.isFinite(targetHeightMm) ||
    targetHeightMm < 10 ||
    targetHeightMm > 5000
  )
    throw new SceneError(
      "INVALID_CALIBRATION",
      "目标高度需在 10–5000 mm 之间",
      400,
    );
  if (!(record.h > 0))
    throw new SceneError("INVALID_CALIBRATION", "资产高度无效", 422);
  const factor = targetHeightMm / record.h;
  return {
    ...record,
    w: Math.round(record.w * factor * 1000) / 1000,
    d: Math.round(record.d * factor * 1000) / 1000,
    h: targetHeightMm,
    normalization: {
      scale: record.normalization.scale * factor,
      center: [...record.normalization.center] as [number, number, number],
    },
    scaleCalibrated: true,
    scaleSource: "user_confirmed",
    defaultPlacement: "surface",
  };
}

export function imageMime(bytes: Buffer): string | undefined {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8)
    return "image/jpeg";
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return undefined;
}

/** Validate the self-contained, uncompressed GLB subset and derive bounds from vertex data. */
export function inspectGlb(bytes: Buffer, name: string): AssetRecord {
  const fail = (message: string): never => {
    throw new SceneError("UNSUPPORTED_GLB", message);
  };
  if (
    bytes.length < 20 ||
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    fail("不是完整的 glTF 2.0 GLB 文件");
  let gltf: any, bin: Buffer | undefined;
  for (let off = 12; off < bytes.length;) {
    if (off + 8 > bytes.length) fail("GLB 分块头损坏");
    const length = bytes.readUInt32LE(off),
      type = bytes.readUInt32LE(off + 4);
    off += 8;
    if (off + length > bytes.length || length % 4) fail("GLB 分块长度无效");
    if (type === 0x4e4f534a) {
      try {
        gltf = JSON.parse(
          bytes
            .subarray(off, off + length)
            .toString("utf8")
            .trim(),
        );
      } catch {
        fail("GLB JSON 损坏");
      }
    }
    if (type === 0x004e4942) bin = bytes.subarray(off, off + length);
    off += length;
  }
  if (!gltf || !bin || gltf.asset?.version !== "2.0")
    fail("缺少 GLB 元数据或二进制资源");
  if ((gltf.extensionsRequired || []).length)
    fail(`当前不支持必需扩展：${gltf.extensionsRequired.join(", ")}`);
  if (
    (gltf.extensionsUsed || []).some((x: string) =>
      [
        "KHR_draco_mesh_compression",
        "EXT_meshopt_compression",
        "KHR_texture_basisu",
      ].includes(x),
    )
  )
    fail("首版不支持 Draco、Meshopt 或 KTX2 压缩，请导出未压缩 GLB");
  if (
    (gltf.buffers || []).length !== 1 ||
    gltf.buffers[0].uri ||
    gltf.buffers[0].byteLength > bin!.length
  )
    fail("模型必须把唯一缓冲区完整嵌入 GLB");
  if ((gltf.images || []).some((i: any) => !Number.isInteger(i.bufferView)))
    fail("贴图必须通过 bufferView 嵌入 GLB");
  for (const view of gltf.bufferViews || []) {
    if (
      view.buffer !== 0 ||
      !Number.isInteger(view.byteLength) ||
      view.byteLength < 1 ||
      !Number.isInteger(view.byteOffset ?? 0) ||
      (view.byteOffset || 0) < 0 ||
      (view.byteOffset || 0) + view.byteLength > bin!.length
    )
      fail("缓冲区分段引用超出文件范围");
  }
  for (const accessor of gltf.accessors || []) {
    if (accessor.sparse) fail("首版不支持稀疏 accessor，请导出普通顶点数据");
    const view = gltf.bufferViews?.[accessor.bufferView],
      components = (
        {
          SCALAR: 1,
          VEC2: 2,
          VEC3: 3,
          VEC4: 4,
          MAT2: 4,
          MAT3: 9,
          MAT4: 16,
        } as Record<string, number>
      )[accessor.type],
      bytesPerComponent = (
        { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as Record<
          number,
          number
        >
      )[accessor.componentType];
    if (
      !view ||
      !components ||
      !bytesPerComponent ||
      !Number.isInteger(accessor.count) ||
      accessor.count < 1 ||
      !Number.isInteger(accessor.byteOffset ?? 0) ||
      (accessor.byteOffset || 0) < 0
    )
      fail("accessor 数据格式或缓冲区引用无效");
    const element = components * bytesPerComponent,
      stride = view.byteStride || element;
    if (
      stride < element ||
      (accessor.byteOffset || 0) + (accessor.count - 1) * stride + element >
        view.byteLength
    )
      fail("accessor 数据超出所属缓冲区分段");
  }
  for (const image of gltf.images || []) {
    const view = gltf.bufferViews?.[image.bufferView];
    if (!view) fail("贴图缺少对应缓冲区分段");
    const data = bin!.subarray(
      view.byteOffset || 0,
      (view.byteOffset || 0) + view.byteLength,
    );
    if (image.mimeType === "image/png") {
      if (
        data.length < 33 ||
        data.readUInt32BE(0) !== 0x89504e47 ||
        !data.includes(Buffer.from("IDAT")) ||
        !data.includes(Buffer.from("IEND"))
      )
        fail("PNG 贴图数据不完整");
    } else if (image.mimeType === "image/jpeg") {
      if (
        data.length < 4 ||
        data.readUInt16BE(0) !== 0xffd8 ||
        data.readUInt16BE(data.length - 2) !== 0xffd9
      )
        fail("JPEG 贴图数据不完整");
    } else
      fail(
        `首版贴图支持嵌入的 PNG / JPEG，当前为 ${image.mimeType || "未知格式"}`,
      );
  }
  for (const texture of gltf.textures || [])
    if (!gltf.images?.[texture.source]) fail("纹理缺少对应图像资源");
  const validateTextures = (value: any) => {
    if (!value || typeof value !== "object") return;
    for (const [key, v] of Object.entries(value)) {
      if (
        /Texture$/.test(key) &&
        v &&
        typeof v === "object" &&
        !gltf.textures?.[(v as any).index]
      )
        fail("材质引用了缺失的纹理");
      validateTextures(v);
    }
  };
  for (const material of gltf.materials || []) validateTextures(material);
  if (gltf.skins?.length || gltf.animations?.length)
    fail("首版只支持静态模型；请烘焙骨骼和动画后导出");
  const bounds = new Box3(),
    visited = new Set<number>(),
    active = new Set<number>();
  let vertices = 0;
  const visit = (index: number, parent: Matrix4) => {
    if (active.has(index)) fail("模型节点循环引用");
    const node = gltf.nodes?.[index];
    if (!node) fail("模型节点引用缺失");
    active.add(index);
    visited.add(index);
    const local = node.matrix
      ? new Matrix4().fromArray(node.matrix)
      : new Matrix4().compose(
          new Vector3().fromArray(node.translation || [0, 0, 0]),
          new Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
          new Vector3().fromArray(node.scale || [1, 1, 1]),
        );
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes?.[node.mesh];
      if (!mesh) fail("网格引用缺失");
      for (const primitive of mesh.primitives || []) {
        if (primitive.targets?.length) fail("首版不支持形变目标，请先烘焙");
        for (const index of Object.values(primitive.attributes || {}))
          if (!gltf.accessors?.[index as number])
            fail("网格引用了缺失的顶点属性");
        if (
          primitive.indices !== undefined &&
          !gltf.accessors?.[primitive.indices]
        )
          fail("网格引用了缺失的索引");
        if (
          primitive.material !== undefined &&
          !gltf.materials?.[primitive.material]
        )
          fail("网格引用了缺失的材质");
        const accessor = gltf.accessors?.[primitive.attributes?.POSITION];
        if (
          !accessor ||
          accessor.componentType !== 5126 ||
          accessor.type !== "VEC3" ||
          accessor.sparse
        )
          fail("位置数据必须是普通 FLOAT VEC3");
        const view = gltf.bufferViews?.[accessor.bufferView];
        if (!view || view.buffer !== 0) fail("位置缓冲区引用缺失");
        const stride = view.byteStride || 12,
          start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
        if (
          stride < 12 ||
          accessor.count < 1 ||
          start + (accessor.count - 1) * stride + 12 > bin!.length
        )
          fail("位置数据超出缓冲区");
        vertices += accessor.count;
        if (vertices > 3000000) fail("模型顶点超过 300 万，请先简化");
        for (let i = 0; i < accessor.count; i++) {
          const p = new Vector3(
            bin!.readFloatLE(start + i * stride),
            bin!.readFloatLE(start + i * stride + 4),
            bin!.readFloatLE(start + i * stride + 8),
          ).applyMatrix4(world);
          if (![p.x, p.y, p.z].every(Number.isFinite))
            fail("模型含非法顶点坐标");
          bounds.expandByPoint(p);
        }
      }
    }
    for (const child of node.children || []) visit(child, world);
    active.delete(index);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (!scene?.nodes?.length) fail("模型没有默认场景");
  for (const index of scene.nodes) visit(index, new Matrix4());
  const size = bounds.getSize(new Vector3()),
    center = bounds.getCenter(new Vector3()),
    max = Math.max(size.x, size.y, size.z);
  if (!vertices || max <= 0 || Math.min(size.x, size.y, size.z) <= 0)
    fail("模型没有有效的三维体积");
  // Same unit heuristic as the pinned original; recipe records it explicitly.
  const scale = max > 100 ? 0.001 : max > 12 ? 0.01 : 1;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    id: `asset-${sha256}`,
    sha256,
    name: name.replace(/[\\/]/g, "_").slice(0, 180),
    bytes: bytes.length,
    w: size.x * scale * 1000,
    d: size.z * scale * 1000,
    h: size.y * scale * 1000,
    normalization: { scale, center: [center.x, bounds.min.y, center.z] },
  };
}
