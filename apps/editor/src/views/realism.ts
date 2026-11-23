import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { SSRPass } from "three/addons/postprocessing/SSRPass.js";

export class RealismPipeline {
  private composer: EffectComposer;
  private environmentTarget: THREE.WebGLRenderTarget;
  private ssr: SSRPass;
  private bounce?: THREE.RectAreaLight;
  private scene: THREE.Scene;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.scene = scene;
    RectAreaLightUniformsLib.init();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment(renderer);
    this.environmentTarget = pmrem.fromScene(room, 0.04);
    scene.environment = this.environmentTarget.texture;
    room.dispose();
    pmrem.dispose();

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.ssr = new SSRPass({
      renderer,
      scene,
      camera,
      width: 1,
      height: 1,
      selects: [],
      groundReflector: null,
    });
    this.ssr.opacity = 0.12;
    this.ssr.maxDistance = 1.5;
    this.ssr.thickness = 0.04;
    this.ssr.fresnel = true;
    this.ssr.distanceAttenuation = true;
    this.composer.addPass(this.ssr);
    const ao = new GTAOPass(scene, camera, 1, 1);
    ao.updateGtaoMaterial({
      radius: 0.3,
      distanceExponent: 1.5,
      thickness: 0.6,
      distanceFallOff: 1,
      scale: 1,
      samples: 16,
    });
    ao.updatePdMaterial({ radius: 5, rings: 2, samples: 16 });
    ao.blendIntensity = 0.75;
    this.composer.addPass(ao);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new SMAAPass(1, 1));
    new RGBELoader().load(
      "/textures/kloofendal_48d_partly_cloudy_puresky_1k.hdr",
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.environmentTarget.dispose();
        const generator = new THREE.PMREMGenerator(renderer);
        this.environmentTarget = generator.fromEquirectangular(texture);
        scene.environment = this.environmentTarget.texture;
        scene.background = texture;
        scene.userData.realismBackground = texture;
        scene.backgroundIntensity = 0.8;
        scene.backgroundBlurriness = 0.03;
        texture.dispose();
        generator.dispose();
      },
      undefined,
      () => {
        scene.background = new THREE.Color("#d9d5ce");
      },
    );
  }

  setRoomBounds(bounds: { x: number; y: number; w: number; h: number }) {
    const width = bounds.w / 1000;
    const depth = bounds.h / 1000;
    if (!this.bounce) {
      this.bounce = new THREE.RectAreaLight("#d8c2a0", 0.65, 1, 1);
      this.bounce.rotation.x = Math.PI / 2;
      this.scene.add(this.bounce);
    }
    this.bounce.width = Math.min(width, 8);
    this.bounce.height = Math.min(depth, 6);
    this.bounce.position.set(
      (bounds.x + bounds.w / 2) / 1000,
      0.06,
      (bounds.y + bounds.h / 2) / 1000,
    );
  }

  tuneMaterials(root: THREE.Object3D) {
    const reflective: THREE.Mesh[] = [];
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (object.userData.isOverlay || material.transparent) continue;
        material.envMapIntensity = material.transparent ? 0.8 : 0.55;
        const physical = material as THREE.MeshPhysicalMaterial;
        if (physical.transmission > 0.01 || material.metalness >= 0.45) {
          reflective.push(object);
        }
      }
    });
    this.ssr.selects = reflective;
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.environmentTarget.dispose();
    this.composer.dispose();
    this.bounce?.dispose();
  }
}

export function createWindowLight(width: number, height: number) {
  RectAreaLightUniformsLib.init();
  return new THREE.RectAreaLight("#e8f1ff", 3, width, height);
}
