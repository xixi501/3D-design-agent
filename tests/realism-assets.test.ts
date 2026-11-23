import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { applySurfaceRecipe, surfaceFamily } from "../apps/editor/src/modeling/surface-materials.js";
import type { Furniture } from "../packages/scene-core/src/index.js";

const furniture = (type: string, mat?: string) =>
  ({ key: type, type, opt: mat ? { mat } : {} }) as Furniture;

function glbJson(file: string) {
  const data = fs.readFileSync(file);
  const length = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + length).toString("utf8").trim());
}

test("20 licensed hero assets are embedded static GLBs within the face budget", () => {
  const root = path.resolve("apps/editor/public/hero-assets");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.assets.length, 20);
  for (const entry of manifest.assets) {
    assert.equal(entry.license, "CC0");
    assert.ok(entry.source.startsWith("https://polyhaven.com/a/"));
    const file = path.join(root, `${entry.id}.glb`);
    assert.ok(fs.statSync(file).size > 100);
    const document = glbJson(file);
    assert.equal(document.animations?.length || 0, 0);
    assert.equal(document.skins?.length || 0, 0);
    assert.ok(document.images.every((image: any) => Number.isInteger(image.bufferView)));
    const faces = document.meshes.flatMap((mesh: any) => mesh.primitives).reduce(
      (sum: number, primitive: any) => sum + document.accessors[primitive.indices].count / 3,
      0,
    );
    assert.ok(faces <= 15000, `${entry.id} has ${faces} faces`);
    for (const mesh of document.meshes) {
      for (const primitive of mesh.primitives) {
        assert.ok(Number.isInteger(primitive.attributes.NORMAL), `${entry.id} lost normals`);
        if (document.materials[primitive.material]?.pbrMetallicRoughness?.baseColorTexture) {
          assert.ok(Number.isInteger(primitive.attributes.TEXCOORD_0), `${entry.id} lost UV coordinates`);
        }
      }
    }
  }
});

test("material families cover transparent, metal, stone, leather and explicit options", () => {
  assert.equal(surfaceFamily(furniture("diningTable", "glass"), new THREE.MeshStandardMaterial()), "glass");
  assert.equal(surfaceFamily(furniture("diningTable", "steel"), new THREE.MeshStandardMaterial()), "metal");
  assert.equal(surfaceFamily(furniture("diningTable", "marble"), new THREE.MeshStandardMaterial()), "stone");
  assert.equal(surfaceFamily(furniture("sofa", "leather"), new THREE.MeshStandardMaterial()), "leather");
  assert.equal(surfaceFamily(furniture("sofa", "linen"), new THREE.MeshStandardMaterial()), "fabric");
  assert.equal(surfaceFamily(furniture("diningTable", "oak"), new THREE.MeshStandardMaterial()), "wood");
  assert.equal(surfaceFamily(furniture("vase"), new THREE.MeshStandardMaterial()), "ceramic");
  assert.equal(surfaceFamily(furniture("television"), new THREE.MeshStandardMaterial()), "plastic");
  assert.equal(surfaceFamily(furniture("plant"), new THREE.MeshStandardMaterial()), "foliage");
  assert.equal(surfaceFamily(furniture("free"), new THREE.MeshStandardMaterial()), "paint");
});

test("surface recipes attach linear data textures without replacing base color", () => {
  const material = new THREE.MeshStandardMaterial({ color: "#775533" });
  const files: string[] = [];
  applySurfaceRecipe(furniture("sofa", "leather"), material, (file) => {
    files.push(file);
    return new THREE.Texture();
  });
  assert.equal(material.color.getHexString(), "775533");
  assert.equal(material.metalness, 0);
  assert.equal(material.roughness, 1);
  assert.ok(material.normalMap);
  assert.ok(material.roughnessMap);
  assert.deepEqual(files, ["leather_red_02_nor_gl_1k.jpg", "leather_red_02_rough_1k.jpg"]);
});
