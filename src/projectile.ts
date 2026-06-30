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
  role: string;
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
  usageTip: string;
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

export const IGNITE_UNLOCK_LEVEL_COUNT = 5;
export const IGNITE_CHAIN_OBJECTIVE_ID = "ignite-ignition-chain";
export const IGNITE_ARMING_LABEL = "Hazard lattice armed";
export const IGNITE_CHAIN_LABEL = "Ignition Chain";
export const PROJECTILE_ORDER: ProjectileId[] = ["slug", "scatter", "pulse", "gravity"];
export const LATE_GAME_PROJECTILE_ORDER: ProjectileId[] = [...PROJECTILE_ORDER, "ignite"];

export function projectileOrderForUnlockedLevels(unlockedLevelCount: number): readonly ProjectileId[] {
  return unlockedLevelCount >= IGNITE_UNLOCK_LEVEL_COUNT ? LATE_GAME_PROJECTILE_ORDER : PROJECTILE_ORDER;
}

export const PROJECTILES: Record<ProjectileId, ProjectileDefinition> = {
  slug: {
    id: "slug",
    key: "1",
    name: "Normal Shell",
    shortName: "Normal",
    role: "Classic fireball",
    color: new THREE.Color(0x9fb7c8),
    materialId: "metal",
    baseRadius: 0.24,
    density: 7.2,
    speed: 48,
    impulse: 64,
    blastRadius: 3.75,
    fractureBoost: 1.38,
    scoreModifier: 1.08,
    description: "Classic orange-white breacher with a harder first hit and clean debris shove.",
    usageTip: "Aim at the named core or weak point first, then let the blast shove debris through nearby targets."
  },
  scatter: {
    id: "scatter",
    key: "2",
    name: "Fragmentation Cluster",
    shortName: "Frag",
    role: "Shrapnel pops",
    color: new THREE.Color(0xffc961),
    materialId: "foam",
    baseRadius: 0.26,
    density: 1.1,
    speed: 43,
    impulse: 44,
    blastRadius: 3.05,
    fractureBoost: 0.98,
    scoreModifier: 1.22,
    description: "Bright fragmentation burst that throws visible shrapnel and chained mini-pops.",
    usageTip: "Fire into clustered props, tankers, or glass lanes so fragments create secondary hits."
  },
  pulse: {
    id: "pulse",
    key: "3",
    name: "Impulse Orb",
    shortName: "Impulse",
    role: "Cyan shockwave",
    color: new THREE.Color(0x61f4ff),
    materialId: "glass",
    baseRadius: 0.31,
    density: 0.9,
    speed: 35,
    impulse: 74,
    blastRadius: 7.8,
    fractureBoost: 0.72,
    scoreModifier: 1.12,
    description: "Wide cyan pressure dome with electric rings and a lower-fire shove.",
    usageTip: "Shoot low into vehicles or foam redirects to push one wide wave through storefronts and lanes."
  },
  gravity: {
    id: "gravity",
    key: "4",
    name: "Heavy Penetrator",
    shortName: "Heavy",
    role: "Purple crush",
    color: new THREE.Color(0x9c71ff),
    materialId: "metal",
    baseRadius: 0.42,
    density: 10.2,
    speed: 34,
    impulse: 108,
    blastRadius: 0.95,
    fractureBoost: 1.55,
    scoreModifier: 1.25,
    description: "Dense penetrator that punches deeper through towers with a violet crush shock.",
    usageTip: "Line up dense structures and boss shields; it scores best when it pierces several targets in one path."
  },
  ignite: {
    id: "ignite",
    key: "5",
    name: "Ignite Lattice",
    shortName: "Ignite",
    role: "Sci-fi ignition",
    color: new THREE.Color(0xff7a35),
    materialId: "rubber",
    baseRadius: 0.24,
    density: 1.4,
    speed: 42,
    impulse: 46,
    blastRadius: 4.65,
    fractureBoost: 1.18,
    scoreModifier: 1.18,
    description: "Late-game sci-fi lattice that arms fictional hazards, then scores on delayed ignition chains.",
    usageTip: "Arm a fuel, power, or hazard lane first, then wait for the delayed Ignition Chain before scoring."
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

  createWarmupObjects(): THREE.Object3D[] {
    const geometry = new THREE.SphereGeometry(1, 28, 16);
    geometry.userData.renderWarmupOwned = true;
    return (Object.keys(PROJECTILES) as ProjectileId[]).map((id, index) => {
      const definition = PROJECTILES[id];
      const mesh = new THREE.Mesh(geometry, this.getRenderMaterial(id));
      mesh.name = `${definition.name} warmup`;
      mesh.scale.setScalar(definition.baseRadius);
      mesh.position.set(index * 0.35, 0, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      return mesh;
    });
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

  getRenderMaterial(id: ProjectileId): THREE.Material {
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
