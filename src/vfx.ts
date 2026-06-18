import * as THREE from "three";
import type { ExplosionResult } from "./destruction";
import type { MaterialId } from "./materialCatalog";
import { perfMonitor } from "./perf";
import type { ProjectileId } from "./projectile";
import type { GraphicsQuality } from "./settings";

interface ParticleBurst {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  geometry: THREE.BufferGeometry;
  positionAttribute: THREE.BufferAttribute;
  colorAttribute: THREE.BufferAttribute;
  positions: Float32Array;
  colors: Float32Array;
  velocities: Float32Array;
  count: number;
  capacity: number;
  blending: THREE.Blending;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  warmedSize: number;
}

interface FxSprite {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  textureKind: string;
  blending: THREE.Blending;
  life: number;
  maxLife: number;
  maxOpacity: number;
  startSize: number;
  endSize: number;
  aspect: number;
  rise: number;
  velocity: THREE.Vector3;
  rotationSpeed: number;
}

interface StreakBurst {
  lines: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
  geometry: THREE.BufferGeometry;
  positionAttribute: THREE.BufferAttribute;
  positions: Float32Array;
  count: number;
  capacity: number;
  life: number;
  maxLife: number;
  expansion: number;
}

interface PressureWave {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  startRadius: number;
  endRadius: number;
  maxOpacity: number;
}

export interface ExplosionFxContext {
  projectileId?: ProjectileId;
  result?: ExplosionResult;
  powerScale?: number;
  sizeScale?: number;
  hitMaterialId?: MaterialId;
  impactDirection?: THREE.Vector3;
  role?: "primary" | "secondary" | "ignition";
}

interface ExplosionProfile {
  coreColor: THREE.ColorRepresentation;
  edgeColor: THREE.ColorRepresentation;
  shockColor: THREE.ColorRepresentation;
  hotColor: THREE.ColorRepresentation;
  emberColor: THREE.ColorRepresentation;
  smokeColor: THREE.ColorRepresentation;
  streakColor: THREE.ColorRepresentation;
  overlayOpacity: number;
  fireBias: number;
  smokeBias: number;
  streakBias: number;
  shockBias: number;
}

function sharedPlaneGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.userData.sharedGeometry = true;
  return geometry;
}

const CORE_TEXTURE = "core";
const SMOKE_TEXTURE = "smoke";
const SHOCK_TEXTURE = "shock";
const RADIAL_TEXTURE_SIZE = 128;
const radialTextures = new Map<string, THREE.Texture>();
const SHARED_PLANE_GEOMETRY = sharedPlaneGeometry();
const ZERO_VECTOR = new THREE.Vector3();
const WARMUP_BURST_CAPACITY = 512;
const WARMUP_BURSTS_PER_BLEND = 36;
const WARMUP_BURST_SIZES = [
  0.022, 0.024, 0.026, 0.028, 0.03, 0.033, 0.034, 0.038, 0.04, 0.045, 0.052, 0.055, 0.06, 0.065, 0.07, 0.075, 0.085,
  0.09, 0.1, 0.12, 0.13
] as const;
const WARMUP_SPRITES_PER_VARIANT = 48;
const WARMUP_STREAK_CAPACITY = 128;
const VFX_POOL_PARK_Y = -10000;
const WARMUP_PROJECTILE_IDS: readonly ProjectileId[] = ["slug", "scatter", "pulse", "gravity", "ignite"];
const WARMUP_MATERIAL_IDS: readonly MaterialId[] = ["glass", "metal", "concrete", "wood", "foam", "rubber"];
const WARMUP_ROLES: readonly NonNullable<ExplosionFxContext["role"]>[] = ["primary", "secondary", "ignition"];
const WARMUP_PROJECTILE_COLORS: Record<ProjectileId, THREE.ColorRepresentation> = {
  slug: 0x9fb7c8,
  scatter: 0xffc961,
  pulse: 0x61f4ff,
  gravity: 0x9c71ff,
  ignite: 0xff7a35
};

export class ParticleSystem {
  private static readonly maxBursts = 24;
  private static readonly maxSprites = 48;
  private static readonly maxStreaks = 14;
  private static readonly maxPressureWaves = 8;
  private static readonly maxBurstPool = 96;
  private static readonly maxSpritePool = 384;
  private static readonly maxStreakPool = 32;
  private static readonly maxPressureWavePool = 12;

  private readonly bursts: ParticleBurst[] = [];
  private readonly sprites: FxSprite[] = [];
  private readonly streaks: StreakBurst[] = [];
  private readonly pressureWaves: PressureWave[] = [];
  private readonly burstPool: ParticleBurst[] = [];
  private readonly spritePool: FxSprite[] = [];
  private readonly streakPool: StreakBurst[] = [];
  private readonly pressureWavePool: PressureWave[] = [];
  private readonly flashLight: THREE.PointLight;
  private readonly flashOverlay: HTMLDivElement;
  private quality: GraphicsQuality = "balanced";
  private flashScale = 1;

  constructor(private readonly scene: THREE.Scene) {
    radialTexture(CORE_TEXTURE);
    radialTexture(SMOKE_TEXTURE);
    radialTexture(SHOCK_TEXTURE);
    this.flashLight = new THREE.PointLight(0xbdf7ff, 0, 12, 2.3);
    this.scene.add(this.flashLight);

    this.flashOverlay = document.createElement("div");
    this.flashOverlay.className = "screen-flash";
    this.flashOverlay.style.opacity = "0";
    document.body.appendChild(this.flashOverlay);
  }

  setFlashScale(scale: number): void {
    this.flashScale = THREE.MathUtils.clamp(scale, 0, 1);
    if (this.flashScale === 0) {
      this.flashLight.intensity = 0;
      this.flashOverlay.style.opacity = "0";
    }
  }

  setQuality(quality: GraphicsQuality): void {
    this.quality = quality;
  }

  createWarmupObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const blending of [THREE.NormalBlending, THREE.AdditiveBlending]) {
      this.ensureWarmupBursts(blending, objects);
    }
    for (const textureKind of [CORE_TEXTURE, SMOKE_TEXTURE, SHOCK_TEXTURE]) {
      for (const blending of [THREE.NormalBlending, THREE.AdditiveBlending]) {
        this.ensureWarmupSprites(textureKind, blending, objects);
      }
    }
    this.ensureWarmupStreaks(objects);
    this.ensureWarmupPressureWaves(objects);
    return objects;
  }

  warmupAllRuntimeFxProfiles(pass = 0): void {
    const baseDirection = new THREE.Vector3(0.2 + pass * 0.05, 0.18, -1).normalize();
    let comboIndex = 0;
    for (const projectileId of WARMUP_PROJECTILE_IDS) {
      this.muzzleFlash(new THREE.Vector3(-1.1 + comboIndex * 0.12, 0.28, 0.7), WARMUP_PROJECTILE_COLORS[projectileId]);
      for (const materialId of WARMUP_MATERIAL_IDS) {
        for (const role of WARMUP_ROLES) {
          const origin = new THREE.Vector3(
            ((comboIndex % 11) - 5) * 0.28,
            0.16 + ((comboIndex + pass) % 5) * 0.055,
            -0.95 - Math.floor(comboIndex / 11) * 0.12
          );
          const direction = baseDirection
            .clone()
            .add(new THREE.Vector3((comboIndex % 3) * 0.11 - 0.11, (comboIndex % 4) * 0.045, ((comboIndex + 1) % 5) * 0.035))
            .normalize();
          const result = createWarmupExplosionResult(origin, materialId, comboIndex);
          this.explode(origin, 7.2 + (comboIndex % 4) * 1.15, result.dustColors, {
            projectileId,
            result,
            hitMaterialId: materialId,
            impactDirection: direction,
            powerScale: role === "primary" ? 2.4 : role === "ignition" ? 1.85 : 1.55,
            sizeScale: role === "primary" ? 1.8 : role === "ignition" ? 1.55 : 1.35,
            role
          });
          comboIndex += 1;
        }
      }
    }

    const heavyOrigin = new THREE.Vector3(0.35 + pass * 0.08, 0.18, -1.65);
    this.spawnPressureWave(heavyOrigin, 12, 0x8ff7ff, 0.72, 1.35);
    this.spawnArcWeb(heavyOrigin, 7.5, 0xb9fbff, 64, 0.68);
    this.spawnDirectionalBurst(
      heavyOrigin,
      baseDirection,
      256,
      0xfff0a8,
      0.72,
      0.022,
      42,
      0.56,
      0.025,
      0.68,
      THREE.AdditiveBlending
    );
    this.spawnDirectionalBurst(
      heavyOrigin.clone().add(new THREE.Vector3(0.16, 0.1, 0.1)),
      baseDirection.clone().multiplyScalar(-1),
      256,
      0x8d8880,
      1.7,
      0.13,
      9,
      1.9,
      0.34,
      0.78,
      THREE.NormalBlending
    );
    this.spawnSmokePuffs(heavyOrigin.clone().add(new THREE.Vector3(-0.22, 0.28, 0.08)), 9.5, 0x34383c, 1.85);
    this.cityDebrisSpray(heavyOrigin.clone().add(new THREE.Vector3(-0.55, 0.08, 0.18)), warmupDustColors(), 2.35);
    this.ruptureDebrisSplash(heavyOrigin.clone().add(new THREE.Vector3(0.58, 0.08, 0.22)), 2.15, 0xc08a4a);
    this.fireBurst(heavyOrigin.clone().add(new THREE.Vector3(0.8, 0.1, -0.1)), 2.2);
    this.fireLick(heavyOrigin.clone().add(new THREE.Vector3(1.05, 0.1, -0.1)), 1.4);
    this.armingPulse(heavyOrigin.clone().add(new THREE.Vector3(-0.85, 0.1, -0.1)), 1.25, 0xff9a42);
    this.spark(heavyOrigin.clone().add(new THREE.Vector3(0.1, 0.1, -0.55)), 0xffd25c, 2.5);
  }

  keepPoolPipelinesResident(): void {
    for (const burst of this.burstPool) {
      this.parkBurstForPipeline(burst);
    }
    for (const sprite of this.spritePool) {
      this.parkSpriteForPipeline(sprite);
    }
    for (const streak of this.streakPool) {
      this.parkStreakForPipeline(streak);
    }
    for (const wave of this.pressureWavePool) {
      this.parkPressureWaveForPipeline(wave);
    }
  }

  clearTransientEffects(): void {
    while (this.bursts.length > 0) {
      const burst = this.bursts.pop();
      if (burst) {
        this.releaseBurst(burst);
      }
    }
    while (this.sprites.length > 0) {
      const sprite = this.sprites.pop();
      if (sprite) {
        this.releaseSprite(sprite);
      }
    }
    while (this.streaks.length > 0) {
      const streak = this.streaks.pop();
      if (streak) {
        this.releaseStreak(streak);
      }
    }
    while (this.pressureWaves.length > 0) {
      const wave = this.pressureWaves.pop();
      if (wave) {
        this.releasePressureWave(wave);
      }
    }
    this.flashLight.intensity = 0;
    this.flashOverlay.style.opacity = "0";
  }

  private ensureWarmupBursts(blending: THREE.Blending, objects: THREE.Object3D[]): void {
    let matchingBursts = this.burstPool.filter((burst) => burst.blending === blending && burst.capacity >= WARMUP_BURST_CAPACITY);
    while (matchingBursts.length < WARMUP_BURSTS_PER_BLEND) {
      const burst = this.createBurst(WARMUP_BURST_CAPACITY, blending);
      this.burstPool.push(burst);
      matchingBursts.push(burst);
    }
    const warmupBursts = matchingBursts.slice(0, WARMUP_BURSTS_PER_BLEND);
    for (let index = 0; index < warmupBursts.length; index += 1) {
      const burst = warmupBursts[index];
      const drawCount = Math.min(burst.capacity, WARMUP_BURST_CAPACITY);
      warmupFillBurst(burst, drawCount, WARMUP_BURST_SIZES[index % WARMUP_BURST_SIZES.length]);
      objects.push(burst.points);
    }
  }

  private ensureWarmupSprites(textureKind: string, blending: THREE.Blending, objects: THREE.Object3D[]): void {
    let matchingSprites = this.spritePool.filter((sprite) => sprite.textureKind === textureKind && sprite.blending === blending);
    while (matchingSprites.length < WARMUP_SPRITES_PER_VARIANT) {
      const sprite = this.createSprite(textureKind, blending);
      this.spritePool.push(sprite);
      matchingSprites.push(sprite);
    }
    for (const sprite of matchingSprites.slice(0, WARMUP_SPRITES_PER_VARIANT)) {
      sprite.material.opacity = 1;
      sprite.material.rotation = 0;
      sprite.sprite.visible = true;
      sprite.sprite.scale.set(1, 1, 1);
      sprite.sprite.renderOrder = blending === THREE.AdditiveBlending ? 8 : 5;
      objects.push(sprite.sprite);
    }
  }

  private ensureWarmupStreaks(objects: THREE.Object3D[]): void {
    let matchingStreaks = this.streakPool.filter((streak) => streak.capacity >= WARMUP_STREAK_CAPACITY);
    while (matchingStreaks.length < ParticleSystem.maxStreaks) {
      const streak = this.createStreak(WARMUP_STREAK_CAPACITY);
      this.streakPool.push(streak);
      matchingStreaks.push(streak);
    }
    for (const streak of matchingStreaks.slice(0, ParticleSystem.maxStreaks)) {
      warmupFillStreak(streak, Math.min(streak.capacity, WARMUP_STREAK_CAPACITY));
      objects.push(streak.lines);
    }
  }

  private ensureWarmupPressureWaves(objects: THREE.Object3D[]): void {
    while (this.pressureWavePool.length < ParticleSystem.maxPressureWaves) {
      this.pressureWavePool.push(this.createPressureWave());
    }
    for (const wave of this.pressureWavePool.slice(0, ParticleSystem.maxPressureWaves)) {
      wave.material.opacity = 1;
      wave.mesh.visible = true;
      wave.mesh.scale.set(1, 1, 1);
      objects.push(wave.mesh);
    }
  }

  explode(origin: THREE.Vector3, radius: number, dustColors: THREE.Color[], context: ExplosionFxContext = {}): void {
    const startedAt = perfMonitor.timeStart();
    const profile = explosionProfile(context.projectileId, context.hitMaterialId);
    const impactScale = this.explosionScale(context);
    const visualRadius = radius * THREE.MathUtils.clamp(0.95 + impactScale * 0.08 + profile.shockBias * 0.08, 0.9, 1.28);
    const coreOrigin = origin.clone().add(new THREE.Vector3(0, 0.35 + Math.min(0.85, radius * 0.06), 0));
    const dustColor = averageColor(dustColors, new THREE.Color(0xa49f94));
    const smokeColor = new THREE.Color(profile.smokeColor).lerp(dustColor, 0.28);

    this.flashLight.position.copy(origin);
    this.flashLight.color.set(profile.coreColor);
    this.flashLight.distance = THREE.MathUtils.clamp(visualRadius * 4.8, 12, 42);
    this.flashLight.intensity = THREE.MathUtils.clamp(46 * impactScale, 24, 110) * this.flashScale;
    this.setFlashOverlay(profile, impactScale);

    this.spawnSprite(coreOrigin, CORE_TEXTURE, profile.coreColor, visualRadius * 0.34, visualRadius * 1.15, 0.74, 0.34, 0.42, THREE.AdditiveBlending);
    this.spawnSprite(coreOrigin.clone().add(new THREE.Vector3(0, 0.16, 0)), CORE_TEXTURE, profile.edgeColor, visualRadius * 0.16, visualRadius * 0.9, 0.34, 0.42, 0.16, THREE.AdditiveBlending);

    const fireAmount = impactScale * (0.75 + profile.fireBias);
    const smokeAmount = impactScale * (0.8 + profile.smokeBias);
    const streakAmount = impactScale * (0.85 + profile.streakBias);
    this.spawnBurst(origin, Math.round(108 * fireAmount), profile.hotColor, 0.82, 0.052, 17 * impactScale, 0.82, 0.06, THREE.AdditiveBlending);
    this.spawnBurst(origin, Math.round(58 * fireAmount), profile.coreColor, 0.48, 0.038, 22 * impactScale, 0.5, 0.04, THREE.AdditiveBlending);
    this.spawnBurst(origin, Math.round(42 * streakAmount), profile.emberColor, 0.5, 0.026, 31 * impactScale, 0.74, 0.03, THREE.AdditiveBlending);
    this.spawnBurst(origin, Math.round(92 * smokeAmount), dustColor, 1.38, 0.075, 4.6 * impactScale, 1.55, 0.32);
    this.spawnBurst(coreOrigin, Math.round(64 * smokeAmount), smokeColor, 2.25, 0.13, 2.5 * impactScale, 1.05, 0.55);
    this.spawnPressureWave(origin, visualRadius, profile.shockColor, context.role === "primary" ? 0.5 : 0.34, impactScale);
    this.spawnDirectionalBlast(origin, normalizedImpactDirection(context.impactDirection), visualRadius, profile, dustColor, impactScale);
    this.spawnStreaks(origin, visualRadius, profile.streakColor, Math.round(14 * streakAmount), 0.52);
    this.spawnSmokePuffs(coreOrigin, visualRadius, smokeColor, smokeAmount);

    if (profile.fireBias > 0.2 || context.projectileId === "ignite") {
      this.fireBurst(origin, 0.75 * impactScale + profile.fireBias);
    }
    this.spawnProjectileSignature(origin, coreOrigin, visualRadius, profile, context, impactScale);
    this.spawnMaterialResponse(origin, visualRadius, context, profile, dustColor, impactScale);
    perfMonitor.addTiming("vfx.explode", startedAt);
  }

  cityDebrisSpray(origin: THREE.Vector3, dustColors: THREE.Color[], intensity = 1): void {
    const amount = THREE.MathUtils.clamp(intensity, 0.35, 2.35);
    const baseDust = averageColor(dustColors, new THREE.Color(0x8d8880));
    const facadeColor = baseDust.clone().offsetHSL(0, -0.08, 0.08);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.35, 0)), Math.round(54 * amount), facadeColor, 1.1, 0.052, 7.5, 1.25, 0.22);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.55, 0)), Math.round(28 * amount), 0xd8fbff, 0.72, 0.03, 12, 0.72, 0.08, THREE.AdditiveBlending);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.2, 0)), Math.round(42 * amount), 0x25282b, 1.35, 0.07, 4.6, 1.65, 0.28);
  }

  muzzleFlash(origin: THREE.Vector3, color: THREE.ColorRepresentation): void {
    this.flashLight.position.copy(origin);
    this.flashLight.color.set(color);
    this.flashLight.intensity = 32 * this.flashScale;
    this.flashOverlay.style.opacity = String(0.16 * this.flashScale);
    this.spawnSprite(origin.clone().add(new THREE.Vector3(0, 0.05, 0)), CORE_TEXTURE, color, 0.28, 1.55, 0.72, 0.18, 0.12, THREE.AdditiveBlending);
    this.spawnBurst(origin, 68, color, 0.46, 0.065, 13, 0.45, 0.04, THREE.AdditiveBlending);
    this.spawnBurst(origin, 42, 0x707780, 0.9, 0.09, 5.5, 0.7, 0.24);
  }

  ruptureDebrisSplash(origin: THREE.Vector3, intensity = 1, color: THREE.ColorRepresentation = 0xc08a4a): void {
    const count = Math.round(80 * intensity);
    this.spawnBurst(origin, count, color, 1.65, 0.085, 7.5 * intensity, 1.5, 0.32);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.18, 0)), Math.round(35 * intensity), 0xffc36a, 0.85, 0.045, 5, 0.7, 0.16, THREE.AdditiveBlending);
  }

  fireBurst(origin: THREE.Vector3, intensity = 1): void {
    const amount = THREE.MathUtils.clamp(intensity, 0.35, 2.2);
    this.spawnSprite(origin.clone().add(new THREE.Vector3(0, 0.45, 0)), CORE_TEXTURE, 0xff8f38, 0.38 * amount, 1.5 * amount, 0.5, 0.32, 0.38, THREE.AdditiveBlending);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.28, 0)), Math.round(48 * amount), 0xff7a35, 0.62, 0.075, 6.8 * amount, 0.28, 0.14, THREE.AdditiveBlending);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.48, 0)), Math.round(30 * amount), 0xffd15c, 0.42, 0.045, 5.2 * amount, 0.2, 0.08, THREE.AdditiveBlending);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.32, 0)), Math.round(34 * amount), 0x1d1b19, 1.45, 0.12, 2.2 * amount, -0.18, 0.48);
  }

  fireLick(origin: THREE.Vector3, intensity = 1): void {
    const amount = THREE.MathUtils.clamp(intensity, 0.25, 1.4);
    this.spawnSprite(origin.clone().add(new THREE.Vector3(0, 0.36, 0)), CORE_TEXTURE, 0xff7a35, 0.16 * amount, 0.72 * amount, 0.36, 0.24, 0.28, THREE.AdditiveBlending);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.34, 0)), Math.round(16 * amount), 0xff8f38, 0.36, 0.055, 3.8 * amount, 0.15, 0.12, THREE.AdditiveBlending);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.48, 0)), Math.round(10 * amount), 0x2d2824, 0.95, 0.1, 1.5 * amount, -0.12, 0.44);
  }

  armingPulse(origin: THREE.Vector3, intensity = 1, color: THREE.ColorRepresentation = 0xff9a42): void {
    const amount = THREE.MathUtils.clamp(intensity, 0.1, 1.25);
    const lifted = origin.clone().add(new THREE.Vector3(0, 0.26, 0));
    this.spawnSprite(lifted, CORE_TEXTURE, color, 0.18 * amount, 0.78 * amount, 0.28 * amount, 0.22, 0.08, THREE.AdditiveBlending, 1.25);
    if (amount > 0.55) {
      this.spawnArcWeb(origin, 0.58 * amount, color, Math.round(4 + amount * 7), 0.24);
      this.spawnPressureWave(origin, 0.72 * amount, color, 0.22, amount);
    }
  }

  spark(origin: THREE.Vector3, color: THREE.ColorRepresentation = 0xffd25c, intensity = 1): void {
    this.spawnBurst(origin, Math.round(45 * intensity), color, 0.55, 0.04, 10 * intensity, 0.6, 0.08, THREE.AdditiveBlending);
  }

  update(deltaSeconds: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const burst = this.bursts[i];
      burst.life += deltaSeconds;
      const t = burst.life / burst.maxLife;

      if (t >= 1) {
        this.retireBurstAt(i);
        continue;
      }

      const damping = Math.max(0, 1 - burst.drag * deltaSeconds);
      const activeLength = burst.count * 3;
      for (let p = 0; p < activeLength; p += 3) {
        burst.velocities[p + 1] -= burst.gravity * deltaSeconds;
        burst.velocities[p] *= damping;
        burst.velocities[p + 1] *= damping;
        burst.velocities[p + 2] *= damping;
        burst.positions[p] += burst.velocities[p] * deltaSeconds;
        burst.positions[p + 1] += burst.velocities[p + 1] * deltaSeconds;
        burst.positions[p + 2] += burst.velocities[p + 2] * deltaSeconds;
      }
      burst.positionAttribute.needsUpdate = true;
      burst.material.opacity = (1 - t) ** 1.25;
    }

    for (let i = this.sprites.length - 1; i >= 0; i -= 1) {
      const sprite = this.sprites[i];
      sprite.life += deltaSeconds;
      const t = sprite.life / sprite.maxLife;
      if (t >= 1) {
        this.retireSpriteAt(i);
        continue;
      }
      const size = THREE.MathUtils.lerp(sprite.startSize, sprite.endSize, easeOutCubic(t));
      sprite.sprite.scale.set(size * sprite.aspect, size, 1);
      sprite.sprite.position.y += sprite.rise * deltaSeconds;
      sprite.sprite.position.addScaledVector(sprite.velocity, deltaSeconds);
      sprite.material.rotation += sprite.rotationSpeed * deltaSeconds;
      sprite.material.opacity = sprite.maxOpacity * (1 - t) ** 1.65;
    }

    for (let i = this.streaks.length - 1; i >= 0; i -= 1) {
      const streak = this.streaks[i];
      streak.life += deltaSeconds;
      const t = streak.life / streak.maxLife;
      if (t >= 1) {
        this.retireStreakAt(i);
        continue;
      }
      streak.lines.scale.setScalar(1 + easeOutCubic(t) * streak.expansion);
      streak.material.opacity = (1 - t) ** 1.8;
    }

    for (let i = this.pressureWaves.length - 1; i >= 0; i -= 1) {
      const wave = this.pressureWaves[i];
      wave.life += deltaSeconds;
      const t = wave.life / wave.maxLife;
      if (t >= 1) {
        this.retirePressureWaveAt(i);
        continue;
      }
      const radius = THREE.MathUtils.lerp(wave.startRadius, wave.endRadius, easeOutCubic(t));
      wave.mesh.scale.set(radius, radius, 1);
      wave.material.opacity = wave.maxOpacity * (1 - t) ** 1.7;
    }

    this.flashLight.intensity = THREE.MathUtils.damp(this.flashLight.intensity, 0, 9, deltaSeconds);
    const overlayOpacity = Number(this.flashOverlay.style.opacity || "0");
    this.flashOverlay.style.opacity = String(THREE.MathUtils.damp(overlayOpacity, 0, 12, deltaSeconds));
  }

  dispose(): void {
    this.scene.remove(this.flashLight);
    this.flashOverlay.remove();
    this.disposeAllTransientObjects();
  }

  private spawnSprite(
    origin: THREE.Vector3,
    textureKind: string,
    color: THREE.ColorRepresentation,
    startSize: number,
    endSize: number,
    opacity: number,
    maxLife: number,
    rise: number,
    blending: THREE.Blending = THREE.NormalBlending,
    aspect = 1,
    velocity?: THREE.Vector3
  ): void {
    if (this.sprites.length >= ParticleSystem.maxSprites) {
      this.retireReusableSprite(textureKind, blending);
    }
    const fx = this.acquireSprite(textureKind, blending);
    fx.material.color.set(color);
    fx.material.opacity = opacity;
    fx.material.rotation = 0;
    fx.sprite.position.copy(origin);
    fx.sprite.scale.set(startSize, startSize, 1);
    fx.sprite.renderOrder = blending === THREE.AdditiveBlending ? 8 : 5;
    fx.life = 0;
    fx.maxLife = maxLife;
    fx.maxOpacity = opacity;
    fx.startSize = startSize;
    fx.endSize = endSize;
    fx.aspect = aspect;
    fx.rise = rise;
    fx.velocity.copy(velocity ?? ZERO_VECTOR);
    fx.rotationSpeed = THREE.MathUtils.randFloat(-1.8, 1.8);
    this.scene.add(fx.sprite);
    this.sprites.push(fx);
    perfMonitor.addCount("vfx.spritesSpawned");
    this.trimSprites();
  }

  private retireReusableSprite(textureKind: string, blending: THREE.Blending): void {
    const matchingIndex = this.sprites.findIndex((sprite) => sprite.textureKind === textureKind && sprite.blending === blending);
    this.retireSpriteAt(matchingIndex >= 0 ? matchingIndex : 0);
  }

  private spawnSmokePuffs(origin: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, intensity: number): void {
    const puffCount = Math.round(THREE.MathUtils.clamp(4 + intensity * this.qualityDensity() * 5, 3, 11));
    for (let i = 0; i < puffCount; i += 1) {
      const angle = (i / puffCount) * Math.PI * 2 + Math.random() * 0.6;
      const distance = THREE.MathUtils.randFloat(radius * 0.06, radius * 0.28);
      const offset = new THREE.Vector3(Math.cos(angle) * distance, THREE.MathUtils.randFloat(0.05, radius * 0.12), Math.sin(angle) * distance);
      const startSize = THREE.MathUtils.randFloat(radius * 0.18, radius * 0.34);
      const drift = new THREE.Vector3(
        Math.cos(angle) * THREE.MathUtils.randFloat(0.08, 0.22),
        THREE.MathUtils.randFloat(0.02, 0.08),
        Math.sin(angle) * THREE.MathUtils.randFloat(0.08, 0.22)
      );
      this.spawnSprite(
        origin.clone().add(offset),
        SMOKE_TEXTURE,
        color,
        startSize,
        startSize * THREE.MathUtils.randFloat(2.1, 3.4),
        THREE.MathUtils.randFloat(0.22, 0.38),
        THREE.MathUtils.randFloat(1.1, 1.9),
        THREE.MathUtils.randFloat(0.16, 0.46),
        THREE.NormalBlending,
        THREE.MathUtils.randFloat(0.72, 1.38),
        drift
      );
    }

    const lingerCount = this.quality === "performance" ? 2 : this.quality === "balanced" ? 3 : 5;
    for (let i = 0; i < lingerCount; i += 1) {
      const angle = (i / lingerCount) * Math.PI * 2 + THREE.MathUtils.randFloatSpread(0.72);
      const distance = THREE.MathUtils.randFloat(radius * 0.04, radius * 0.2);
      const offset = new THREE.Vector3(Math.cos(angle) * distance, THREE.MathUtils.randFloat(radius * 0.05, radius * 0.18), Math.sin(angle) * distance);
      const startSize = THREE.MathUtils.randFloat(radius * 0.22, radius * 0.42);
      const drift = new THREE.Vector3(
        Math.cos(angle) * THREE.MathUtils.randFloat(0.04, 0.15),
        THREE.MathUtils.randFloat(0.04, 0.14),
        Math.sin(angle) * THREE.MathUtils.randFloat(0.04, 0.15)
      );
      this.spawnSprite(
        origin.clone().add(offset),
        SMOKE_TEXTURE,
        color,
        startSize,
        startSize * THREE.MathUtils.randFloat(3.1, 4.8),
        THREE.MathUtils.randFloat(0.12, 0.2),
        THREE.MathUtils.randFloat(2.8, 4.4),
        THREE.MathUtils.randFloat(0.08, 0.2),
        THREE.NormalBlending,
        THREE.MathUtils.randFloat(0.58, 1.45),
        drift
      );
    }
  }

  private spawnPressureWave(
    origin: THREE.Vector3,
    radius: number,
    color: THREE.ColorRepresentation,
    opacity: number,
    intensity: number
  ): void {
    if (this.quality === "performance" && this.pressureWaves.length > 3) {
      return;
    }
    const maxOpacity = opacity * THREE.MathUtils.clamp(intensity, 0.55, 1.35);
    const wave = this.acquirePressureWave();
    wave.material.color.set(color);
    wave.material.opacity = maxOpacity;
    wave.mesh.position.set(origin.x, Math.max(0.035, origin.y + 0.025), origin.z);
    wave.mesh.rotation.x = -Math.PI * 0.5;
    wave.mesh.rotation.z = Math.random() * Math.PI * 2;
    wave.mesh.scale.set(radius * 0.16, radius * 0.16, 1);
    wave.life = 0;
    wave.maxLife = THREE.MathUtils.lerp(0.24, 0.44, THREE.MathUtils.clamp(intensity, 0, 1));
    wave.startRadius = radius * 0.16;
    wave.endRadius = radius * THREE.MathUtils.randFloat(1.15, 1.65);
    wave.maxOpacity = maxOpacity;
    this.scene.add(wave.mesh);
    this.pressureWaves.push(wave);
    perfMonitor.addCount("vfx.pressureWavesSpawned");
    this.trimPressureWaves();
  }

  private spawnDirectionalBlast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    radius: number,
    profile: ExplosionProfile,
    dustColor: THREE.Color,
    impactScale: number
  ): void {
    const blastDirection = direction.clone().add(new THREE.Vector3(0, 0.16, 0)).normalize();
    this.spawnDirectionalBurst(origin, blastDirection, Math.round(52 * impactScale), profile.hotColor, 0.58, 0.034, 26 * impactScale, 0.52, 0.035, 0.44, THREE.AdditiveBlending);
    this.spawnDirectionalBurst(origin, blastDirection, Math.round(48 * impactScale), dustColor, 1.25, 0.09, 8.5 * impactScale, 1.55, 0.25, 0.62);
    this.spawnDirectionalStreaks(origin, blastDirection, radius * 1.22, profile.streakColor, Math.round(10 * impactScale), 0.42, 0.24);
  }

  private spawnStreaks(origin: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, count: number, maxLife: number): void {
    if (count <= 0) {
      return;
    }
    const streak = this.acquireStreak(count, color, 1);
    const positions = streak.positions;
    for (let i = 0; i < count; i += 1) {
      const directionX = Math.random() - 0.5;
      const directionY = Math.random() * 0.78 + 0.12;
      const directionZ = Math.random() - 0.5;
      const invLength = 1 / Math.max(0.0001, Math.hypot(directionX, directionY, directionZ));
      const normalizedX = directionX * invLength;
      const normalizedY = directionY * invLength;
      const normalizedZ = directionZ * invLength;
      const startScale = THREE.MathUtils.randFloat(0.08, radius * 0.12);
      const endScale = THREE.MathUtils.randFloat(radius * 0.28, radius * 0.72);
      const base = i * 6;
      positions[base] = normalizedX * startScale;
      positions[base + 1] = normalizedY * startScale;
      positions[base + 2] = normalizedZ * startScale;
      positions[base + 3] = normalizedX * endScale;
      positions[base + 4] = normalizedY * endScale;
      positions[base + 5] = normalizedZ * endScale;
    }
    this.activateStreak(streak, origin, count, maxLife, THREE.MathUtils.randFloat(0.18, 0.45), 1);
    perfMonitor.addCount("vfx.streaksSpawned");
    perfMonitor.addCount("vfx.streakVertices", count * 2);
    this.trimStreaks();
  }

  private spawnProjectileSignature(
    origin: THREE.Vector3,
    coreOrigin: THREE.Vector3,
    visualRadius: number,
    profile: ExplosionProfile,
    context: ExplosionFxContext,
    impactScale: number
  ): void {
    const direction = normalizedImpactDirection(context.impactDirection);
    switch (context.projectileId) {
      case "slug":
        this.spawnDirectionalStreaks(origin, direction, visualRadius * 1.22, 0xd8f1ff, Math.round(16 * impactScale), 0.34, 0.18);
        this.spawnSprite(coreOrigin, CORE_TEXTURE, 0xd8f1ff, visualRadius * 0.18, visualRadius * 1.15, 0.28, 0.28, 0.18, THREE.AdditiveBlending, 0.38);
        break;
      case "scatter":
        this.spawnDirectionalStreaks(origin, direction.clone().add(new THREE.Vector3(0, 0.2, 0)).normalize(), visualRadius * 1.16, 0xffdd8a, Math.round(18 * impactScale), 0.36, 0.62);
        this.spawnBurst(origin, Math.round(46 * impactScale), 0xffd26b, 0.46, 0.028, 34 * impactScale, 0.62, 0.03, THREE.AdditiveBlending);
        break;
      case "pulse":
        this.spawnArcWeb(origin, visualRadius * 0.96, profile.shockColor, Math.round(22 * impactScale), 0.56);
        this.spawnSprite(coreOrigin, CORE_TEXTURE, profile.shockColor, visualRadius * 0.4, visualRadius * 1.65, 0.24, 0.42, 0.08, THREE.AdditiveBlending, 1.55);
        break;
      case "gravity":
        this.spawnArcWeb(origin, visualRadius * 0.88, 0x8d6cff, Math.round(16 * impactScale), 0.62);
        this.spawnSprite(coreOrigin, SMOKE_TEXTURE, 0x251a35, visualRadius * 0.48, visualRadius * 1.82, 0.36, 0.82, -0.1, THREE.NormalBlending, 1.18);
        this.spawnBurst(origin.clone().add(new THREE.Vector3(0, -0.05, 0)), Math.round(62 * impactScale), 0x2a143d, 1.05, 0.06, 13 * impactScale, -0.35, 0.12, THREE.AdditiveBlending);
        break;
      case "ignite":
        this.spawnSprite(coreOrigin.clone().add(new THREE.Vector3(0, 0.18, 0)), CORE_TEXTURE, 0xff7a35, visualRadius * 0.22, visualRadius * 1.75, 0.38, 0.54, 0.64, THREE.AdditiveBlending, 0.52);
        this.spawnBurst(coreOrigin, Math.round(50 * impactScale), 0xffd25c, 0.72, 0.033, 18 * impactScale, 0.14, 0.04, THREE.AdditiveBlending);
        break;
      case undefined:
        break;
    }
  }

  private spawnMaterialResponse(
    origin: THREE.Vector3,
    visualRadius: number,
    context: ExplosionFxContext,
    profile: ExplosionProfile,
    dustColor: THREE.Color,
    impactScale: number
  ): void {
    for (const materialId of dominantMaterials(context.result, context.hitMaterialId).slice(0, this.materialResponseBudget())) {
      switch (materialId) {
        case "glass":
          this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.18, 0)), Math.round(46 * impactScale), 0xd8fbff, 0.64, 0.024, 22 * impactScale, 0.28, 0.04, THREE.AdditiveBlending);
          this.spawnArcWeb(origin, visualRadius * 0.52, 0xb9fbff, Math.round(8 * impactScale), 0.42);
          break;
        case "metal":
          this.spawnDirectionalStreaks(origin, normalizedImpactDirection(context.impactDirection), visualRadius * 0.8, 0xfff0a8, Math.round(10 * impactScale), 0.36, 0.34);
          this.spawnBurst(origin, Math.round(32 * impactScale), 0xffd25c, 0.42, 0.022, 28 * impactScale, 0.5, 0.03, THREE.AdditiveBlending);
          break;
        case "concrete":
          this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.08, 0)), Math.round(58 * impactScale), dustColor, 1.55, 0.09, 5.2 * impactScale, 1.75, 0.34);
          break;
        case "wood":
          this.spawnDirectionalStreaks(origin, normalizedImpactDirection(context.impactDirection), visualRadius * 0.62, 0xffb36a, Math.round(9 * impactScale), 0.48, 0.5);
          this.spawnBurst(origin, Math.round(34 * impactScale), 0xc08a4a, 0.9, 0.055, 10 * impactScale, 0.82, 0.16);
          break;
        case "foam":
          this.spawnBurst(origin, Math.round(42 * impactScale), 0xffe8a8, 1.1, 0.075, 9 * impactScale, 0.32, 0.22);
          break;
        case "rubber":
          this.spawnBurst(origin, Math.round(30 * impactScale), 0xff6c92, 0.82, 0.06, 11 * impactScale, 0.38, 0.18, THREE.AdditiveBlending);
          break;
      }
    }

    if (profile.shockBias > 0.5) {
      this.spawnArcWeb(origin, visualRadius * 0.7, profile.shockColor, Math.round(10 * impactScale * profile.shockBias), 0.5);
    }
  }

  private spawnDirectionalStreaks(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    radius: number,
    color: THREE.ColorRepresentation,
    count: number,
    maxLife: number,
    spread = 0.28
  ): void {
    if (count <= 0) {
      return;
    }
    const scaledCount = Math.max(1, Math.round(count * this.qualityDensity()));
    const forward = normalizedImpactDirection(direction);
    const side = new THREE.Vector3(-forward.z, 0, forward.x);
    if (side.lengthSq() < 0.0001) {
      side.set(1, 0, 0);
    }
    side.normalize();
    const up = new THREE.Vector3().crossVectors(side, forward).normalize();
    const streak = this.acquireStreak(scaledCount, color, 1);
    const positions = streak.positions;
    for (let i = 0; i < scaledCount; i += 1) {
      const sideJitter = side.clone().multiplyScalar(THREE.MathUtils.randFloatSpread(radius * spread));
      const upJitter = up.clone().multiplyScalar(THREE.MathUtils.randFloatSpread(radius * spread * 0.72));
      const start = forward.clone().multiplyScalar(THREE.MathUtils.randFloat(0.04, radius * 0.12)).add(sideJitter.clone().multiplyScalar(0.16)).add(upJitter.clone().multiplyScalar(0.16));
      const end = forward.clone().multiplyScalar(THREE.MathUtils.randFloat(radius * 0.34, radius * 1.16)).add(sideJitter).add(upJitter);
      const base = i * 6;
      positions[base] = start.x;
      positions[base + 1] = start.y;
      positions[base + 2] = start.z;
      positions[base + 3] = end.x;
      positions[base + 4] = end.y;
      positions[base + 5] = end.z;
    }
    this.activateStreak(streak, origin, scaledCount, maxLife, THREE.MathUtils.randFloat(0.08, 0.28), 1);
    perfMonitor.addCount("vfx.streaksSpawned");
    perfMonitor.addCount("vfx.streakVertices", scaledCount * 2);
    this.trimStreaks();
  }

  private spawnArcWeb(origin: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, count: number, maxLife: number): void {
    if (count <= 0) {
      return;
    }
    const scaledCount = Math.max(1, Math.round(count * this.qualityDensity()));
    const streak = this.acquireStreak(scaledCount, color, 0.88);
    const positions = streak.positions;
    for (let i = 0; i < scaledCount; i += 1) {
      const angle = (i / scaledCount) * Math.PI * 2 + THREE.MathUtils.randFloatSpread(0.28);
      const nextAngle = angle + THREE.MathUtils.randFloat(0.24, 0.54);
      const y = THREE.MathUtils.randFloat(radius * 0.03, radius * 0.64);
      const wobble = THREE.MathUtils.randFloat(0.55, 1.05);
      const nextWobble = wobble + THREE.MathUtils.randFloatSpread(0.18);
      const base = i * 6;
      positions[base] = Math.cos(angle) * radius * wobble;
      positions[base + 1] = y;
      positions[base + 2] = Math.sin(angle) * radius * wobble;
      positions[base + 3] = Math.cos(nextAngle) * radius * nextWobble;
      positions[base + 4] = y + THREE.MathUtils.randFloatSpread(radius * 0.16);
      positions[base + 5] = Math.sin(nextAngle) * radius * nextWobble;
    }
    this.activateStreak(streak, origin, scaledCount, maxLife, THREE.MathUtils.randFloat(0.12, 0.32), 0.88);
    perfMonitor.addCount("vfx.streaksSpawned");
    perfMonitor.addCount("vfx.streakVertices", scaledCount * 2);
    this.trimStreaks();
  }

  private spawnDirectionalBurst(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    count: number,
    color: THREE.ColorRepresentation,
    maxLife: number,
    size: number,
    speed: number,
    gravity: number,
    drag: number,
    spread: number,
    blending: THREE.Blending = THREE.NormalBlending
  ): void {
    const scaledCount = Math.max(1, Math.round(count * this.qualityDensity()));
    const { forward, side, up } = directionBasis(direction);
    const burst = this.acquireBurst(scaledCount, size, blending);
    const positions = burst.positions;
    const colors = burst.colors;
    const velocities = burst.velocities;
    const baseColor = new THREE.Color(color);
    const colorJitter = new THREE.Color();

    for (let i = 0; i < scaledCount; i += 1) {
      const sideScale = THREE.MathUtils.randFloatSpread(spread);
      const upScale = THREE.MathUtils.randFloatSpread(spread * 0.72);
      const velocityScale = speed * THREE.MathUtils.randFloat(0.42, 1.08);
      const velocity = forward
        .clone()
        .multiplyScalar(velocityScale)
        .add(side.clone().multiplyScalar(sideScale * speed))
        .add(up.clone().multiplyScalar((0.12 + upScale) * speed));
      velocities[i * 3] = velocity.x;
      velocities[i * 3 + 1] = velocity.y;
      velocities[i * 3 + 2] = velocity.z;

      const startOffset = forward
        .clone()
        .multiplyScalar(THREE.MathUtils.randFloat(-0.08, 0.18))
        .add(side.clone().multiplyScalar(sideScale * 0.18))
        .add(up.clone().multiplyScalar(upScale * 0.12));
      positions[i * 3] = origin.x + startOffset.x;
      positions[i * 3 + 1] = origin.y + startOffset.y;
      positions[i * 3 + 2] = origin.z + startOffset.z;

      colorJitter.copy(baseColor).offsetHSL((Math.random() - 0.5) * 0.035, 0, (Math.random() - 0.5) * 0.14);
      colors[i * 3] = colorJitter.r;
      colors[i * 3 + 1] = colorJitter.g;
      colors[i * 3 + 2] = colorJitter.b;
    }

    this.activateBurst(burst, scaledCount, maxLife, gravity, drag);
    perfMonitor.addCount("vfx.burstsSpawned");
    perfMonitor.addCount("vfx.particlesSpawned", scaledCount);
    this.trimBursts();
  }

  private materialResponseBudget(): number {
    return this.quality === "performance" ? 1 : this.quality === "balanced" ? 2 : 3;
  }

  private spawnBurst(
    origin: THREE.Vector3,
    count: number,
    color: THREE.ColorRepresentation,
    maxLife: number,
    size: number,
    speed: number,
    gravity: number,
    drag: number,
    blending: THREE.Blending = THREE.NormalBlending
  ): void {
    const scaledCount = Math.max(1, Math.round(count * this.qualityDensity()));
    const burst = this.acquireBurst(scaledCount, size, blending);
    const positions = burst.positions;
    const colors = burst.colors;
    const velocities = burst.velocities;
    const baseColor = new THREE.Color(color);
    const colorJitter = new THREE.Color();

    for (let i = 0; i < scaledCount; i += 1) {
      const directionX = Math.random() - 0.5;
      const directionY = Math.random() * 0.9 + 0.15;
      const directionZ = Math.random() - 0.5;
      const invLength = 1 / Math.max(0.0001, Math.hypot(directionX, directionY, directionZ));
      const velocityScale = speed * (0.3 + Math.random() * 0.85);
      velocities[i * 3] = directionX * invLength * velocityScale + (Math.random() - 0.5) * speed * 0.18;
      velocities[i * 3 + 1] = directionY * invLength * velocityScale + Math.random() * speed * 0.15;
      velocities[i * 3 + 2] = directionZ * invLength * velocityScale + (Math.random() - 0.5) * speed * 0.18;

      positions[i * 3] = origin.x + (Math.random() - 0.5) * 0.24;
      positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.24;
      positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.24;

      colorJitter.copy(baseColor).offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.16);
      colors[i * 3] = colorJitter.r;
      colors[i * 3 + 1] = colorJitter.g;
      colors[i * 3 + 2] = colorJitter.b;
    }

    this.activateBurst(burst, scaledCount, maxLife, gravity, drag);
    perfMonitor.addCount("vfx.burstsSpawned");
    perfMonitor.addCount("vfx.particlesSpawned", scaledCount);
    this.trimBursts();
  }

  private acquireBurst(count: number, size: number, blending: THREE.Blending): ParticleBurst {
    const warmedSize = nearestWarmupBurstSize(size);
    const poolIndex = this.findBurstPoolIndex(count, warmedSize, blending);
    const burst = poolIndex >= 0 ? this.burstPool.splice(poolIndex, 1)[0] : this.createBurst(pooledCapacity(count, 32), blending);
    if (poolIndex >= 0) {
      perfMonitor.addCount("vfx.burstPoolReuse");
    } else {
      perfMonitor.addCount("vfx.burstPoolCreate");
    }

    burst.material.size = warmedSize;
    burst.warmedSize = warmedSize;
    burst.material.opacity = 1;
    burst.geometry.setDrawRange(0, count);
    return burst;
  }

  private createBurst(capacity: number, blending: THREE.Blending): ParticleBurst {
    const positions = new Float32Array(capacity * 3);
    const colors = new Float32Array(capacity * 3);
    const velocities = new Float32Array(capacity * 3);
    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    const colorAttribute = new THREE.BufferAttribute(colors, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    colorAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", positionAttribute);
    geometry.setAttribute("color", colorAttribute);
    geometry.setDrawRange(0, 0);
    const material = new THREE.PointsMaterial({
      size: 1,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return {
      points,
      material,
      geometry,
      positionAttribute,
      colorAttribute,
      positions,
      colors,
      velocities,
      count: 0,
      capacity,
      blending,
      life: 0,
      maxLife: 1,
      gravity: 0,
      drag: 0,
      warmedSize: 1
    };
  }

  private activateBurst(burst: ParticleBurst, count: number, maxLife: number, gravity: number, drag: number): void {
    burst.count = count;
    burst.life = 0;
    burst.maxLife = maxLife;
    burst.gravity = gravity;
    burst.drag = drag;
    burst.geometry.setDrawRange(0, count);
    burst.positionAttribute.needsUpdate = true;
    burst.colorAttribute.needsUpdate = true;
    burst.points.position.set(0, 0, 0);
    burst.points.visible = true;
    this.scene.add(burst.points);
    this.bursts.push(burst);
  }

  private findBurstPoolIndex(count: number, size: number, blending: THREE.Blending): number {
    const exactSizeIndex = this.findBurstPoolIndexBySize(count, size, blending);
    if (exactSizeIndex >= 0) {
      return exactSizeIndex;
    }
    return this.findBurstPoolIndexBySize(count, null, blending);
  }

  private findBurstPoolIndexBySize(count: number, size: number | null, blending: THREE.Blending): number {
    let bestIndex = -1;
    let bestCapacity = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.burstPool.length; i += 1) {
      const capacity = this.burstPool[i].capacity;
      const sizeMatches = size === null || Math.abs(this.burstPool[i].warmedSize - size) < 0.000001;
      if (this.burstPool[i].blending === blending && sizeMatches && capacity >= count && capacity < bestCapacity) {
        bestIndex = i;
        bestCapacity = capacity;
      }
    }
    return bestIndex;
  }

  private acquireSprite(textureKind: string, blending: THREE.Blending): FxSprite {
    const poolIndex = this.findSpritePoolIndex(textureKind, blending);
    if (poolIndex >= 0) {
      const sprite = this.spritePool.splice(poolIndex, 1)[0];
      perfMonitor.addCount("vfx.spritePoolReuse");
      return sprite;
    }
    perfMonitor.addCount("vfx.spritePoolCreate");
    return this.createSprite(textureKind, blending);
  }

  private createSprite(textureKind: string, blending: THREE.Blending): FxSprite {
    const material = new THREE.SpriteMaterial({
      map: radialTexture(textureKind),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending
    });
    return {
      sprite: new THREE.Sprite(material),
      material,
      textureKind,
      blending,
      life: 0,
      maxLife: 1,
      maxOpacity: 1,
      startSize: 1,
      endSize: 1,
      aspect: 1,
      rise: 0,
      velocity: new THREE.Vector3(),
      rotationSpeed: 0
    };
  }

  private findSpritePoolIndex(textureKind: string, blending: THREE.Blending): number {
    return this.spritePool.findIndex((sprite) => sprite.textureKind === textureKind && sprite.blending === blending);
  }

  private acquireStreak(count: number, color: THREE.ColorRepresentation, opacity: number): StreakBurst {
    const poolIndex = this.findStreakPoolIndex(count);
    const streak = poolIndex >= 0 ? this.streakPool.splice(poolIndex, 1)[0] : this.createStreak(pooledCapacity(count, 8));
    if (poolIndex >= 0) {
      perfMonitor.addCount("vfx.streakPoolReuse");
    } else {
      perfMonitor.addCount("vfx.streakPoolCreate");
    }
    streak.material.color.set(color);
    streak.material.opacity = opacity;
    streak.geometry.setDrawRange(0, count * 2);
    return streak;
  }

  private createStreak(capacity: number): StreakBurst {
    const positions = new Float32Array(capacity * 6);
    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", positionAttribute);
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 7;
    return {
      lines,
      material,
      geometry,
      positionAttribute,
      positions,
      count: 0,
      capacity,
      life: 0,
      maxLife: 1,
      expansion: 0
    };
  }

  private activateStreak(streak: StreakBurst, origin: THREE.Vector3, count: number, maxLife: number, expansion: number, opacity: number): void {
    streak.count = count;
    streak.life = 0;
    streak.maxLife = maxLife;
    streak.expansion = expansion;
    streak.material.opacity = opacity;
    streak.geometry.setDrawRange(0, count * 2);
    streak.positionAttribute.needsUpdate = true;
    streak.lines.position.copy(origin);
    streak.lines.scale.setScalar(1);
    this.scene.add(streak.lines);
    this.streaks.push(streak);
  }

  private findStreakPoolIndex(count: number): number {
    let bestIndex = -1;
    let bestCapacity = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.streakPool.length; i += 1) {
      const capacity = this.streakPool[i].capacity;
      if (capacity >= count && capacity < bestCapacity) {
        bestIndex = i;
        bestCapacity = capacity;
      }
    }
    return bestIndex;
  }

  private acquirePressureWave(): PressureWave {
    const wave = this.pressureWavePool.pop();
    if (wave) {
      perfMonitor.addCount("vfx.pressureWavePoolReuse");
      return wave;
    }
    perfMonitor.addCount("vfx.pressureWavePoolCreate");
    return this.createPressureWave();
  }

  private createPressureWave(): PressureWave {
    const material = new THREE.MeshBasicMaterial({
      map: radialTexture(SHOCK_TEXTURE),
      transparent: true,
      opacity: 1,
      depthWrite: false,
      alphaTest: 0.035,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(SHARED_PLANE_GEOMETRY, material);
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    return {
      mesh,
      material,
      life: 0,
      maxLife: 1,
      startRadius: 1,
      endRadius: 1,
      maxOpacity: 1
    };
  }

  private retireBurstAt(index: number): void {
    const [burst] = this.bursts.splice(index, 1);
    if (burst) {
      this.releaseBurst(burst);
    }
  }

  private retireSpriteAt(index: number): void {
    const [sprite] = this.sprites.splice(index, 1);
    if (sprite) {
      this.releaseSprite(sprite);
    }
  }

  private retireStreakAt(index: number): void {
    const [streak] = this.streaks.splice(index, 1);
    if (streak) {
      this.releaseStreak(streak);
    }
  }

  private retirePressureWaveAt(index: number): void {
    const [wave] = this.pressureWaves.splice(index, 1);
    if (wave) {
      this.releasePressureWave(wave);
    }
  }

  private releaseBurst(burst: ParticleBurst): void {
    burst.count = 0;
    if (this.burstPool.length < ParticleSystem.maxBurstPool) {
      this.parkBurstForPipeline(burst);
      this.burstPool.push(burst);
      return;
    }
    this.disposeBurst(burst);
  }

  private releaseSprite(sprite: FxSprite): void {
    if (this.spritePool.length < ParticleSystem.maxSpritePool) {
      this.parkSpriteForPipeline(sprite);
      this.spritePool.push(sprite);
      return;
    }
    this.disposeSprite(sprite);
  }

  private releaseStreak(streak: StreakBurst): void {
    streak.count = 0;
    if (this.streakPool.length < ParticleSystem.maxStreakPool) {
      this.parkStreakForPipeline(streak);
      this.streakPool.push(streak);
      return;
    }
    this.disposeStreak(streak);
  }

  private releasePressureWave(wave: PressureWave): void {
    if (this.pressureWavePool.length < ParticleSystem.maxPressureWavePool) {
      this.parkPressureWaveForPipeline(wave);
      this.pressureWavePool.push(wave);
      return;
    }
    this.disposePressureWave(wave);
  }

  private disposeBurst(burst: ParticleBurst): void {
    this.scene.remove(burst.points);
    disposeGeometry(burst.geometry);
    burst.material.dispose();
  }

  private disposeSprite(sprite: FxSprite): void {
    this.scene.remove(sprite.sprite);
    sprite.material.dispose();
  }

  private disposeStreak(streak: StreakBurst): void {
    this.scene.remove(streak.lines);
    disposeGeometry(streak.geometry);
    streak.material.dispose();
  }

  private disposePressureWave(wave: PressureWave): void {
    this.scene.remove(wave.mesh);
    wave.material.dispose();
  }

  private parkBurstForPipeline(burst: ParticleBurst): void {
    burst.count = 0;
    burst.life = 0;
    burst.material.opacity = 1;
    if (burst.capacity > 0) {
      burst.positions[0] = 0;
      burst.positions[1] = 0;
      burst.positions[2] = 0;
      burst.colors[0] = 1;
      burst.colors[1] = 1;
      burst.colors[2] = 1;
      burst.positionAttribute.needsUpdate = true;
      burst.colorAttribute.needsUpdate = true;
    }
    burst.geometry.setDrawRange(0, Math.min(WARMUP_BURST_CAPACITY, burst.capacity));
    burst.points.visible = true;
    burst.points.frustumCulled = false;
    burst.points.position.set(0, VFX_POOL_PARK_Y, 0);
    this.scene.add(burst.points);
  }

  private parkSpriteForPipeline(sprite: FxSprite): void {
    sprite.life = 0;
    sprite.material.opacity = 1;
    sprite.material.rotation = 0;
    sprite.sprite.visible = true;
    sprite.sprite.frustumCulled = false;
    sprite.sprite.position.set(0, VFX_POOL_PARK_Y, 0);
    sprite.sprite.scale.set(0.05, 0.05, 1);
    this.scene.add(sprite.sprite);
  }

  private parkStreakForPipeline(streak: StreakBurst): void {
    streak.count = 0;
    streak.life = 0;
    streak.material.opacity = 1;
    if (streak.capacity > 0) {
      streak.positions[0] = 0;
      streak.positions[1] = 0;
      streak.positions[2] = 0;
      streak.positions[3] = 0.05;
      streak.positions[4] = 0;
      streak.positions[5] = 0;
      streak.positionAttribute.needsUpdate = true;
    }
    streak.geometry.setDrawRange(0, Math.min(WARMUP_STREAK_CAPACITY * 2, streak.capacity * 2));
    streak.lines.visible = true;
    streak.lines.frustumCulled = false;
    streak.lines.position.set(0, VFX_POOL_PARK_Y, 0);
    streak.lines.scale.setScalar(1);
    this.scene.add(streak.lines);
  }

  private parkPressureWaveForPipeline(wave: PressureWave): void {
    wave.life = 0;
    wave.material.opacity = 1;
    wave.mesh.visible = true;
    wave.mesh.frustumCulled = false;
    wave.mesh.position.set(0, VFX_POOL_PARK_Y, 0);
    wave.mesh.scale.set(0.05, 0.05, 1);
    this.scene.add(wave.mesh);
  }

  private trimBursts(): void {
    while (this.bursts.length > ParticleSystem.maxBursts) {
      const burst = this.bursts.shift();
      if (!burst) {
        return;
      }
      this.releaseBurst(burst);
    }
  }

  private trimSprites(): void {
    while (this.sprites.length > ParticleSystem.maxSprites) {
      const sprite = this.sprites.shift();
      if (!sprite) {
        return;
      }
      this.releaseSprite(sprite);
    }
  }

  private trimStreaks(): void {
    while (this.streaks.length > ParticleSystem.maxStreaks) {
      const streak = this.streaks.shift();
      if (!streak) {
        return;
      }
      this.releaseStreak(streak);
    }
  }

  private trimPressureWaves(): void {
    while (this.pressureWaves.length > ParticleSystem.maxPressureWaves) {
      const wave = this.pressureWaves.shift();
      if (!wave) {
        return;
      }
      this.releasePressureWave(wave);
    }
  }

  private setFlashOverlay(profile: ExplosionProfile, impactScale: number): void {
    const core = colorToCss(profile.coreColor, 0.72);
    const shock = colorToCss(profile.shockColor, 0.22);
    this.flashOverlay.style.background = `radial-gradient(circle at center, ${core}, ${shock} 34%, transparent 68%)`;
    this.flashOverlay.style.opacity = String(profile.overlayOpacity * THREE.MathUtils.clamp(impactScale, 0.72, 1.5) * this.flashScale);
  }

  private disposeAllTransientObjects(): void {
    for (const burst of this.bursts) {
      this.disposeBurst(burst);
    }
    for (const sprite of this.sprites) {
      this.disposeSprite(sprite);
    }
    for (const streak of this.streaks) {
      this.disposeStreak(streak);
    }
    for (const wave of this.pressureWaves) {
      this.disposePressureWave(wave);
    }
    for (const burst of this.burstPool) {
      this.disposeBurst(burst);
    }
    for (const sprite of this.spritePool) {
      this.disposeSprite(sprite);
    }
    for (const streak of this.streakPool) {
      this.disposeStreak(streak);
    }
    for (const wave of this.pressureWavePool) {
      this.disposePressureWave(wave);
    }
    this.bursts.length = 0;
    this.sprites.length = 0;
    this.streaks.length = 0;
    this.pressureWaves.length = 0;
    this.burstPool.length = 0;
    this.spritePool.length = 0;
    this.streakPool.length = 0;
    this.pressureWavePool.length = 0;
  }

  private explosionScale(context: ExplosionFxContext): number {
    const result = context.result;
    const fractureBoost = (result?.fracturedBodies ?? 0) * 0.055;
    const bodyBoost = Math.min(0.36, (result?.affectedBodies ?? 0) * 0.012);
    const damageBoost = Math.min(
      0.42,
      ((result?.structureDamage ?? 0) + (result?.materialChaos ?? 0)) / 1300
    );
    const roleBoost = context.role === "primary" ? 0.18 : context.role === "ignition" ? 0.08 : -0.04;
    return THREE.MathUtils.clamp(0.82 + fractureBoost + bodyBoost + damageBoost + roleBoost + (context.powerScale ?? 1) * 0.08 + (context.sizeScale ?? 1) * 0.08, 0.72, 1.85);
  }

  private qualityDensity(): number {
    switch (this.quality) {
      case "performance":
        return 0.66;
      case "balanced":
        return 0.9;
      case "cinematic":
        return 1.15;
    }
  }
}

export class ExplosionSystem {
  constructor(private readonly particles: ParticleSystem) {}

  play(origin: THREE.Vector3, radius: number, dustColors: THREE.Color[], context: ExplosionFxContext = {}): void {
    this.particles.explode(origin, radius, dustColors, context);
  }
}

function normalizedImpactDirection(direction?: THREE.Vector3): THREE.Vector3 {
  if (!direction || direction.lengthSq() < 0.0001) {
    return new THREE.Vector3(0, 0.08, -1).normalize();
  }
  return direction.clone().normalize();
}

function directionBasis(direction: THREE.Vector3): { forward: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3 } {
  const forward = normalizedImpactDirection(direction);
  const side = new THREE.Vector3(-forward.z, 0, forward.x);
  if (side.lengthSq() < 0.0001) {
    side.set(1, 0, 0);
  }
  side.normalize();
  const up = new THREE.Vector3().crossVectors(side, forward);
  if (up.y < 0) {
    up.multiplyScalar(-1);
  }
  if (up.lengthSq() < 0.0001) {
    up.set(0, 1, 0);
  } else {
    up.normalize();
  }
  return { forward, side, up };
}

function pooledCapacity(count: number, bucketSize: number): number {
  return Math.max(bucketSize, Math.ceil(count / bucketSize) * bucketSize);
}

function nearestWarmupBurstSize(size: number): number {
  let nearest: number = WARMUP_BURST_SIZES[0];
  let nearestDistance = Math.abs(size - nearest);
  for (let index = 1; index < WARMUP_BURST_SIZES.length; index += 1) {
    const candidate = WARMUP_BURST_SIZES[index];
    const distance = Math.abs(size - candidate);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function warmupDustColors(): THREE.Color[] {
  return [new THREE.Color(0xa49f94), new THREE.Color(0xd8fbff), new THREE.Color(0xffb36a), new THREE.Color(0x8d8880)];
}

function createWarmupExplosionResult(origin: THREE.Vector3, dominantMaterialId: MaterialId, seed: number): ExplosionResult {
  const affectedObjects = WARMUP_MATERIAL_IDS.map((materialId, index) => ({
    id: 10000 + seed * 10 + index,
    label: `${materialId} warmup target`,
    materialId,
    category: index % 3 === 0 ? "debris" : "structure",
    scoreRole: index % 2 === 0 ? "target" : "neutral",
    zoneId: index % 2 === 0 ? "render-warmup-power-grid" : "render-warmup",
    position: origin.clone().add(new THREE.Vector3((index - 2.5) * 0.22, 0.08 + index * 0.03, (index % 3) * 0.12)),
    energy: 320 + index * 95 + (materialId === dominantMaterialId ? 260 : 0),
    weightedDamage: 190 + index * 38 + (materialId === dominantMaterialId ? 180 : 0),
    scoreValue: 260 + index * 34,
    fractured: true
  })) satisfies ExplosionResult["affectedObjects"];
  return {
    origin: origin.clone(),
    affectedBodies: affectedObjects.length + 34,
    fracturedBodies: affectedObjects.length + 12,
    dustColors: warmupDustColors(),
    affectedObjects,
    structureDamage: 2600,
    materialChaos: 2100
  };
}

function dominantMaterials(result?: ExplosionResult, hitMaterialId?: MaterialId): MaterialId[] {
  const scores = new Map<MaterialId, number>();
  if (hitMaterialId) {
    scores.set(hitMaterialId, 4);
  }
  for (const object of result?.affectedObjects ?? []) {
    const current = scores.get(object.materialId) ?? 0;
    const fractureWeight = object.fractured ? 2.8 : 0.7;
    scores.set(object.materialId, current + fractureWeight + object.weightedDamage / Math.max(80, object.scoreValue * 2));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([materialId]) => materialId);
}

function averageColor(colors: THREE.Color[], fallback: THREE.Color): THREE.Color {
  if (colors.length === 0) {
    return fallback;
  }
  const color = new THREE.Color(0, 0, 0);
  for (const entry of colors) {
    color.r += entry.r;
    color.g += entry.g;
    color.b += entry.b;
  }
  color.multiplyScalar(1 / colors.length);
  return color;
}

function explosionProfile(projectileId?: ProjectileId, hitMaterialId?: MaterialId): ExplosionProfile {
  const profile: ExplosionProfile = {
    coreColor: 0xfff4c2,
    edgeColor: 0xff8a36,
    shockColor: 0x93ecff,
    hotColor: 0xffb34f,
    emberColor: 0xffdf7a,
    smokeColor: 0x34383c,
    streakColor: 0xffd98a,
    overlayOpacity: 0.36,
    fireBias: 0.22,
    smokeBias: 0.2,
    streakBias: 0.18,
    shockBias: 0.24
  };

  switch (projectileId) {
    case "slug":
      return { ...profile, edgeColor: 0xd8f1ff, smokeColor: 0x303943, streakBias: 0.45, shockBias: 0.08 };
    case "scatter":
      return { ...profile, coreColor: 0xfff0a8, edgeColor: 0xffb637, streakColor: 0xfff0a8, streakBias: 0.78, fireBias: 0.36 };
    case "pulse":
      return {
        ...profile,
        coreColor: 0xd9feff,
        edgeColor: 0x61f4ff,
        shockColor: 0x8ff7ff,
        hotColor: 0x7fffff,
        emberColor: 0xbaffff,
        smokeColor: 0x22333b,
        overlayOpacity: 0.3,
        fireBias: 0.04,
        smokeBias: 0.02,
        shockBias: 0.82
      };
    case "gravity":
      return {
        ...profile,
        coreColor: 0xd8c6ff,
        edgeColor: 0x9c71ff,
        shockColor: 0x7e65ff,
        hotColor: 0xb08aff,
        emberColor: 0xe2d5ff,
        smokeColor: 0x251a35,
        overlayOpacity: 0.4,
        fireBias: 0.02,
        smokeBias: 0.48,
        streakBias: 0.12,
        shockBias: 0.64
      };
    case "ignite":
      return {
        ...profile,
        coreColor: 0xfff2ad,
        edgeColor: 0xff7a35,
        shockColor: 0xffb16b,
        hotColor: 0xff5b24,
        emberColor: 0xffd25c,
        smokeColor: 0x2b221d,
        overlayOpacity: 0.42,
        fireBias: 0.82,
        smokeBias: 0.38,
        streakBias: 0.38,
        shockBias: 0.18
      };
    case undefined:
      break;
  }

  if (hitMaterialId === "glass") {
    return { ...profile, edgeColor: 0xc9f8ff, shockColor: 0xb9fbff, streakColor: 0xd8fbff, streakBias: profile.streakBias + 0.28 };
  }
  if (hitMaterialId === "metal") {
    return { ...profile, streakColor: 0xfff0a8, streakBias: profile.streakBias + 0.22 };
  }
  return profile;
}

function disposeGeometry(geometry: THREE.BufferGeometry): void {
  if (geometry.userData.sharedGeometry !== true) {
    geometry.dispose();
  }
}

function radialTexture(kind: string): THREE.Texture {
  const cached = radialTextures.get(kind);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = RADIAL_TEXTURE_SIZE;
  canvas.height = RADIAL_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create FX texture canvas");
  }

  const half = RADIAL_TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(half, half, 1, half, half, half);
  if (kind === SMOKE_TEXTURE) {
    gradient.addColorStop(0, "rgba(255,255,255,0.58)");
    gradient.addColorStop(0.38, "rgba(220,220,220,0.22)");
    gradient.addColorStop(0.74, "rgba(120,120,120,0.07)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
  } else if (kind === SHOCK_TEXTURE) {
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.32, "rgba(255,255,255,0)");
    gradient.addColorStop(0.48, "rgba(255,255,255,0.78)");
    gradient.addColorStop(0.62, "rgba(255,255,255,0.24)");
    gradient.addColorStop(0.82, "rgba(255,255,255,0.06)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
  } else {
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.18, "rgba(255,245,210,0.95)");
    gradient.addColorStop(0.52, "rgba(255,170,80,0.42)");
    gradient.addColorStop(1, "rgba(255,80,20,0)");
  }

  context.fillStyle = gradient;
  context.fillRect(0, 0, RADIAL_TEXTURE_SIZE, RADIAL_TEXTURE_SIZE);
  if (kind === SMOKE_TEXTURE) {
    drawSmokeTextureBreakup(context);
  } else if (kind === SHOCK_TEXTURE) {
    drawShockTextureBreakup(context);
  } else {
    drawCoreTextureBreakup(context);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  radialTextures.set(kind, texture);
  return texture;
}

function warmupFillBurst(burst: ParticleBurst, count: number, size: number): void {
  burst.count = count;
  burst.life = 0;
  burst.maxLife = 1;
  burst.gravity = 0;
  burst.drag = 0;
  burst.material.size = size;
  burst.warmedSize = size;
  burst.material.opacity = 1;
  burst.points.visible = true;
  burst.points.frustumCulled = false;
  burst.points.position.set(0, 0, 0);
  burst.geometry.setDrawRange(0, count);
  const color = new THREE.Color(0xffd98a);
  for (let i = 0; i < count; i += 1) {
    const angle = i * 2.399963;
    const radius = 0.025 + (i % 32) * 0.002;
    const offset = i * 3;
    burst.positions[offset] = Math.cos(angle) * radius;
    burst.positions[offset + 1] = ((i % 16) - 8) * 0.003;
    burst.positions[offset + 2] = Math.sin(angle) * radius;
    burst.colors[offset] = color.r;
    burst.colors[offset + 1] = color.g;
    burst.colors[offset + 2] = color.b;
    burst.velocities[offset] = 0;
    burst.velocities[offset + 1] = 0;
    burst.velocities[offset + 2] = 0;
  }
  burst.positionAttribute.needsUpdate = true;
  burst.colorAttribute.needsUpdate = true;
}

function warmupFillStreak(streak: StreakBurst, count: number): void {
  streak.count = count;
  streak.life = 0;
  streak.maxLife = 1;
  streak.expansion = 0;
  streak.material.color.set(0xffd98a);
  streak.material.opacity = 1;
  streak.lines.visible = true;
  streak.lines.frustumCulled = false;
  streak.lines.position.set(0, 0, 0);
  streak.lines.scale.setScalar(1);
  streak.geometry.setDrawRange(0, count * 2);
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const base = i * 6;
    streak.positions[base] = Math.cos(angle) * 0.04;
    streak.positions[base + 1] = 0;
    streak.positions[base + 2] = Math.sin(angle) * 0.04;
    streak.positions[base + 3] = Math.cos(angle) * 0.42;
    streak.positions[base + 4] = 0.08;
    streak.positions[base + 5] = Math.sin(angle) * 0.42;
  }
  streak.positionAttribute.needsUpdate = true;
}

function drawSmokeTextureBreakup(context: CanvasRenderingContext2D): void {
  context.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 18; i += 1) {
    const angle = i * 2.39996;
    const distance = 18 + ((i * 17) % 38);
    const x = 64 + Math.cos(angle) * distance;
    const y = 64 + Math.sin(angle) * distance * 0.82;
    context.fillStyle = `rgba(0,0,0,${0.08 + (i % 4) * 0.035})`;
    context.beginPath();
    context.ellipse(x, y, 8 + (i % 5) * 2.2, 5 + (i % 3) * 2.6, angle, 0, Math.PI * 2);
    context.fill();
  }
  context.globalCompositeOperation = "source-over";
}

function drawShockTextureBreakup(context: CanvasRenderingContext2D): void {
  context.strokeStyle = "rgba(255,255,255,0.26)";
  context.lineWidth = 1.8;
  for (let i = 0; i < 20; i += 1) {
    const angle = i * 0.314 + ((i % 3) - 1) * 0.03;
    const inner = 44 + (i % 4) * 1.3;
    const outer = 62 - (i % 5) * 1.1;
    context.beginPath();
    context.moveTo(64 + Math.cos(angle) * inner, 64 + Math.sin(angle) * inner);
    context.lineTo(64 + Math.cos(angle + 0.035) * outer, 64 + Math.sin(angle + 0.035) * outer);
    context.stroke();
  }
}

function drawCoreTextureBreakup(context: CanvasRenderingContext2D): void {
  context.globalCompositeOperation = "lighter";
  for (let i = 0; i < 16; i += 1) {
    const angle = i * 2.39996;
    const length = 28 + ((i * 19) % 34);
    context.strokeStyle = `rgba(255,${180 + (i % 4) * 16},90,${0.12 + (i % 3) * 0.06})`;
    context.lineWidth = 3 + (i % 4);
    context.beginPath();
    context.moveTo(64 + Math.cos(angle) * 8, 64 + Math.sin(angle) * 8);
    context.lineTo(64 + Math.cos(angle + 0.08) * length, 64 + Math.sin(angle + 0.08) * length);
    context.stroke();
  }
  context.globalCompositeOperation = "source-over";
}

function colorToCss(color: THREE.ColorRepresentation, alpha: number): string {
  const parsed = new THREE.Color(color);
  return `rgba(${Math.round(parsed.r * 255)}, ${Math.round(parsed.g * 255)}, ${Math.round(parsed.b * 255)}, ${alpha})`;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
