import * as THREE from "three";
import { MaterialCatalog, type MaterialId } from "./materialCatalog";
import { PhysicsWorld, type PhysicsObject } from "./physics";
import { type RandomSource, randomRange } from "./random";
import { materialAtlasTile } from "./visualAssets";

export type ProjectileId = "slug" | "scatter" | "pulse" | "gel" | "gravity";

export interface ProjectileDefinition {
  id: ProjectileId;
  key: string;
  name: string;
  shortName: string;
  color: THREE.Color;
  materialId: MaterialId;
  baseRadius: number;
  density: number;
  speed: number;
  impulse: number;
  blastRadius: number;
  fractureBoost: number;
  scoreModifier: number;
  description: string;
}

export interface ActiveProjectile {
  object: PhysicsObject;
  definition: ProjectileDefinition;
  previousPosition: THREE.Vector3;
  radius: number;
  powerScale: number;
  sizeScale: number;
  age: number;
  piercedObjectIds: Set<number>;
}

export const PROJECTILE_ORDER: ProjectileId[] = ["slug", "scatter", "pulse", "gel", "gravity"];

export const PROJECTILES: Record<ProjectileId, ProjectileDefinition> = {
  slug: {
    id: "slug",
    key: "1",
    name: "Kinetic Slug",
    shortName: "Slug",
    color: new THREE.Color(0x9fb7c8),
    materialId: "metal",
    baseRadius: 0.22,
    density: 7.2,
    speed: 48,
    impulse: 58,
    blastRadius: 2.85,
    fractureBoost: 1.55,
    scoreModifier: 1.05,
    description: "Long-range penetrator for punching through city structures."
  },
  scatter: {
    id: "scatter",
    key: "2",
    name: "Scatter Pod",
    shortName: "Scatter",
    color: new THREE.Color(0xffc961),
    materialId: "foam",
    baseRadius: 0.26,
    density: 1.1,
    speed: 40,
    impulse: 42,
    blastRadius: 4.1,
    fractureBoost: 1.22,
    scoreModifier: 1.2,
    description: "Air-burst pod that scatters hot fragments through a block."
  },
  pulse: {
    id: "pulse",
    key: "3",
    name: "Pulse Orb",
    shortName: "Pulse",
    color: new THREE.Color(0x61f4ff),
    materialId: "glass",
    baseRadius: 0.31,
    density: 0.9,
    speed: 35,
    impulse: 68,
    blastRadius: 7.1,
    fractureBoost: 1.24,
    scoreModifier: 1.12,
    description: "Wide siege shockwave that shoves whole streets at once."
  },
  gel: {
    id: "gel",
    key: "4",
    name: "Gel Burst",
    shortName: "Gel",
    color: new THREE.Color(0xf13d88),
    materialId: "bioGel",
    baseRadius: 0.3,
    density: 0.8,
    speed: 36,
    impulse: 50,
    blastRadius: 5.45,
    fractureBoost: 1.52,
    scoreModifier: 1.35,
    description: "Heavy splash shell for flooding a district with synthetic gel."
  },
  gravity: {
    id: "gravity",
    key: "5",
    name: "Gravity Hammer",
    shortName: "Hammer",
    color: new THREE.Color(0x9c71ff),
    materialId: "metal",
    baseRadius: 0.42,
    density: 9.5,
    speed: 30,
    impulse: 96,
    blastRadius: 5.1,
    fractureBoost: 1.82,
    scoreModifier: 1.22,
    description: "Super-heavy siege hammer with brutal downward authority."
  }
};

export class ProjectileSystem {
  private readonly materialsByProjectile = new Map<ProjectileId, THREE.Material>();
  private active: ActiveProjectile | null = null;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly materials: MaterialCatalog,
    private readonly rng: RandomSource
  ) {}

  getActive(): ActiveProjectile | null {
    return this.active;
  }

  clearActive(): void {
    if (this.active) {
      this.physics.removeObject(this.active.object.id);
      this.active = null;
    }
  }

  launch(
    id: ProjectileId,
    muzzle: THREE.Vector3,
    direction: THREE.Vector3,
    sizeScale: number,
    powerScale: number
  ): ActiveProjectile {
    this.clearActive();
    const definition = PROJECTILES[id];
    const radius = definition.baseRadius * sizeScale;
    const velocity = direction.clone().normalize().multiplyScalar(definition.speed * powerScale);
    const spin = new THREE.Vector3(
      randomRange(this.rng, -3, 3),
      randomRange(this.rng, -3, 3),
      randomRange(this.rng, -3, 3)
    );
    const object = this.physics.addDynamicSphere({
      label: definition.name,
      material: this.materials.get(definition.materialId),
      renderMaterial: this.getRenderMaterial(definition.id),
      position: muzzle,
      radius,
      linearVelocity: velocity,
      angularVelocity: spin,
      category: "projectile",
      destructible: false,
      canFracture: false,
      isDebris: false,
      density: definition.density,
      friction: 0.28,
      restitution: 0.02,
      scoreValue: 0,
      ccd: true,
      segments: 28
    });
    this.active = {
      object,
      definition,
      previousPosition: muzzle.clone(),
      radius,
      powerScale,
      sizeScale,
      age: 0,
      piercedObjectIds: new Set()
    };
    return this.active;
  }

  update(deltaSeconds: number): void {
    if (!this.active) {
      return;
    }
    this.active.age += deltaSeconds;
  }

  removeActive(): void {
    this.clearActive();
  }

  private getRenderMaterial(id: ProjectileId): THREE.Material {
    const existing = this.materialsByProjectile.get(id);
    if (existing) {
      return existing;
    }
    const definition = PROJECTILES[id];
    const material = new THREE.MeshStandardMaterial({
      color: definition.color,
      emissive: definition.color.clone().multiplyScalar(0.45),
      emissiveIntensity: 1.1,
      roughness: id === "slug" || id === "gravity" ? 0.28 : 0.48,
      metalness: id === "slug" || id === "gravity" ? 0.72 : 0.08,
      map: projectileTexture(id)
    });
    this.materialsByProjectile.set(id, material);
    return material;
  }
}

function projectileTexture(id: ProjectileId): THREE.Texture {
  switch (id) {
    case "slug":
      return materialAtlasTile(0);
    case "scatter":
      return materialAtlasTile(7);
    case "pulse":
      return materialAtlasTile(8);
    case "gel":
      return materialAtlasTile(9);
    case "gravity":
      return materialAtlasTile(10);
  }
}
