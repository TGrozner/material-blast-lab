import * as THREE from "three";
import { MaterialCatalog, type MaterialId } from "./materialCatalog";
import { PhysicsWorld, type PhysicsObject } from "./physics";
import { type RandomSource, randomRange } from "./random";
import { materialAtlasTile } from "./visualAssets";

export type ProjectileId = "slug" | "scatter" | "pulse" | "gravity" | "ignite";

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

export const PROJECTILE_ORDER: ProjectileId[] = ["slug", "scatter", "pulse", "gravity"];

export const PROJECTILES: Record<ProjectileId, ProjectileDefinition> = {
  slug: {
    id: "slug",
    key: "1",
    name: "Normal Shell",
    shortName: "Normal",
    color: new THREE.Color(0x9fb7c8),
    materialId: "metal",
    baseRadius: 0.24,
    density: 7.2,
    speed: 46,
    impulse: 56,
    blastRadius: 3.35,
    fractureBoost: 1.24,
    scoreModifier: 1.05,
    description: "Standard cannon shell with a readable medium explosion."
  },
  scatter: {
    id: "scatter",
    key: "2",
    name: "Fragmentation Cluster",
    shortName: "Frag",
    color: new THREE.Color(0xffc961),
    materialId: "foam",
    baseRadius: 0.26,
    density: 1.1,
    speed: 40,
    impulse: 36,
    blastRadius: 2.75,
    fractureBoost: 0.82,
    scoreModifier: 1.2,
    description: "Weak first hit that seeds explosive clusters around the impact."
  },
  pulse: {
    id: "pulse",
    key: "3",
    name: "Impulse Orb",
    shortName: "Impulse",
    color: new THREE.Color(0x61f4ff),
    materialId: "glass",
    baseRadius: 0.31,
    density: 0.9,
    speed: 35,
    impulse: 74,
    blastRadius: 7.8,
    fractureBoost: 0.72,
    scoreModifier: 1.12,
    description: "Large pressure radius with low destructive force outside the core."
  },
  gravity: {
    id: "gravity",
    key: "4",
    name: "Heavy Penetrator",
    shortName: "Heavy",
    color: new THREE.Color(0x9c71ff),
    materialId: "metal",
    baseRadius: 0.4,
    density: 9.5,
    speed: 32,
    impulse: 96,
    blastRadius: 0.8,
    fractureBoost: 1.35,
    scoreModifier: 1.22,
    description: "Dense penetrator that punches through solid buildings without exploding."
  },
  ignite: {
    id: "ignite",
    key: "0",
    name: "Hazard Ignition",
    shortName: "Ignite",
    color: new THREE.Color(0xff7a35),
    materialId: "rubber",
    baseRadius: 0.24,
    density: 1.4,
    speed: 42,
    impulse: 46,
    blastRadius: 4.65,
    fractureBoost: 1.18,
    scoreModifier: 1.18,
    description: "Internal hazard ignition profile for gas and fire chain reactions."
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

  releaseActive(): ActiveProjectile | null {
    const active = this.active;
    this.active = null;
    return active;
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
    case "gravity":
      return materialAtlasTile(10);
    case "ignite":
      return materialAtlasTile(11);
  }
}
