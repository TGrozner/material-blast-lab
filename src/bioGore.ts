import * as THREE from "three";
import type { ExplosionAffectedObject } from "./destruction";
import { MaterialCatalog } from "./materialCatalog";
import { PhysicsWorld } from "./physics";
import { ParticleSystem } from "./vfx";

export class BioGoreSystem {
  private readonly colors = [0xd62872, 0x8f3dff, 0x29d28c];

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly materials: MaterialCatalog,
    private readonly particles: ParticleSystem
  ) {}

  spawnDummy(position: THREE.Vector3, scale = 1): void {
    const material = this.materials.get("bioGel");
    const renderMaterial = this.materials.getRenderMaterial("bioGel");
    const scoreBase = Math.round(80 * scale);

    this.physics.addDynamicBox({
      label: "Bio-gel core",
      material,
      renderMaterial,
      position: position.clone().add(new THREE.Vector3(0, 0.74 * scale, 0)),
      size: new THREE.Vector3(0.48 * scale, 0.86 * scale, 0.36 * scale),
      category: "bio",
      destructible: true,
      canFracture: true,
      scoreValue: scoreBase
    });
    this.physics.addDynamicSphere({
      label: "Bio-gel sensor pod",
      material,
      renderMaterial,
      position: position.clone().add(new THREE.Vector3(0, 1.34 * scale, 0)),
      radius: 0.23 * scale,
      category: "bio",
      destructible: true,
      canFracture: true,
      restitution: 0.36,
      scoreValue: Math.round(scoreBase * 0.8)
    });

    const podOffsets = [
      new THREE.Vector3(-0.34 * scale, 0.82 * scale, 0.06 * scale),
      new THREE.Vector3(0.34 * scale, 0.82 * scale, -0.06 * scale),
      new THREE.Vector3(0, 0.45 * scale, 0.31 * scale)
    ];
    for (const offset of podOffsets) {
      this.physics.addDynamicSphere({
        label: "Bio-gel lobe",
        material,
        renderMaterial,
        position: position.clone().add(offset),
        radius: 0.16 * scale,
        category: "bio",
        destructible: true,
        canFracture: true,
        restitution: 0.42,
        scoreValue: Math.round(scoreBase * 0.35)
      });
    }
  }

  reactToExplosion(affected: ExplosionAffectedObject[]): number {
    let splashScore = 0;
    for (const object of affected) {
      if (object.category !== "bio" && object.materialId !== "bioGel") {
        continue;
      }
      const intensity = object.fractured ? 1.15 : 0.45;
      this.particles.bioSplash(object.position, intensity, this.randomBioColor());
      splashScore += Math.round(object.scoreValue * (object.fractured ? 1.25 : 0.45));
    }
    return splashScore;
  }

  splashAt(position: THREE.Vector3, intensity = 1): void {
    this.particles.bioSplash(position, intensity, this.randomBioColor());
  }

  private randomBioColor(): THREE.ColorRepresentation {
    return this.colors[Math.floor(Math.random() * this.colors.length)];
  }
}
