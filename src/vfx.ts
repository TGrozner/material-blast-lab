import * as THREE from "three";
import type { ExplosionResult } from "./destruction";
import type { MaterialId } from "./materialCatalog";
import { perfMonitor } from "./perf";
import type { ProjectileId } from "./projectile";
import type { GraphicsQuality } from "./settings";
import { uniqueGraphicTexture, type GraphicAssetId } from "./visualAssets";

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
  flipbook?: FlipbookState;
  life: number;
  maxLife: number;
  maxOpacity: number;
  startSize: number;
  endSize: number;
  aspect: number;
  rise: number;
  delay: number;
  fadeIn: number;
  velocity: THREE.Vector3;
  rotationSpeed: number;
}

interface FlipbookState {
  assetId: Extract<GraphicAssetId, "vfxExplosionAtlas" | "vfxExplosionNoFireAtlas" | "vfxFireballAtlas" | "vfxSmokeAtlas">;
  columns: number;
  rows: number;
  frameCount: number;
  startFrame: number;
  frameSpan: number;
  loop: boolean;
  randomStart: boolean;
}

type FlipbookOptions = Partial<Pick<FlipbookState, "startFrame" | "frameSpan" | "loop" | "randomStart">> & {
  color?: THREE.ColorRepresentation;
  delay?: number;
  fadeIn?: number;
};

interface SpriteOptions {
  delay?: number;
  fadeIn?: number;
}

interface CompositionProfile {
  fire: number;
  smoke: number;
  streaks: number;
  materialResponses: number;
  overlayMax: number;
};

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
  densityScale?: number;
  hitMaterialId?: MaterialId;
  impactDirection?: THREE.Vector3;
  role?: "primary" | "secondary" | "ignition";
  variant?: "mushroom";
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
const DEFAULT_DUST_COLOR = new THREE.Color(0xa49f94);
const DEFAULT_CITY_DUST_COLOR = new THREE.Color(0x8d8880);
const WARMUP_ROLES: readonly NonNullable<ExplosionFxContext["role"]>[] = ["primary", "secondary", "ignition"];
const WARMUP_PROJECTILE_COLORS: Record<ProjectileId, THREE.ColorRepresentation> = {
  slug: 0x9fb7c8,
  scatter: 0xffc961,
  pulse: 0x61f4ff,
  gravity: 0x9c71ff,
  ignite: 0xff7a35
};
const VFX_FLIPBOOK_TEXTURE_KIND = "flipbook";
const VFX_FLIPBOOK_PROFILES = {
  explosion: {
    assetId: "vfxExplosionAtlas",
    columns: 5,
    rows: 5,
    frameCount: 25
  },
  dustShell: {
    assetId: "vfxExplosionNoFireAtlas",
    columns: 5,
    rows: 5,
    frameCount: 25
  },
  fireball: {
    assetId: "vfxFireballAtlas",
    columns: 8,
    rows: 8,
    frameCount: 64
  },
  smoke: {
    assetId: "vfxSmokeAtlas",
    columns: 8,
    rows: 8,
    frameCount: 64
  }
} as const satisfies Record<string, Pick<FlipbookState, "assetId" | "columns" | "rows" | "frameCount">>;

export class ParticleSystem {
  private static readonly maxBursts = 32;
  private static readonly maxSprites = 72;
  private static readonly maxStreaks = 18;
  private static readonly maxPressureWaves = 10;
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
  private readonly burstBaseColor = new THREE.Color();
  private readonly burstColorJitter = new THREE.Color();
  private readonly explosionCoreOrigin = new THREE.Vector3();
  private readonly fxScratchOrigin = new THREE.Vector3();
  private readonly smokeOffset = new THREE.Vector3();
  private readonly smokeDrift = new THREE.Vector3();
  private readonly directionForward = new THREE.Vector3();
  private readonly directionSide = new THREE.Vector3();
  private readonly directionUp = new THREE.Vector3();
  private readonly blastDirection = new THREE.Vector3();
  private readonly signatureDirection = new THREE.Vector3();
  private readonly signatureLiftedDirection = new THREE.Vector3();
  private readonly responseDirection = new THREE.Vector3();
  private readonly radialRingVelocity = new THREE.Vector3();
  private readonly flipbookVelocity = new THREE.Vector3();
  private readonly spriteVelocity = new THREE.Vector3();
  private readonly plumeDrift = new THREE.Vector3();
  private readonly explosionDustColor = new THREE.Color();
  private readonly explosionSmokeColor = new THREE.Color();
  private readonly cityDustColor = new THREE.Color();
  private readonly cityFacadeColor = new THREE.Color();

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
    this.ensureWarmupFlipbookTextures(objects);
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
      this.parkBurstForPipeline(burst, true);
    }
    for (const sprite of this.spritePool) {
      this.parkSpriteForPipeline(sprite, true);
    }
    for (const streak of this.streakPool) {
      this.parkStreakForPipeline(streak, true);
    }
    for (const wave of this.pressureWavePool) {
      this.parkPressureWaveForPipeline(wave, true);
    }
  }

  hidePooledEffects(): void {
    for (const burst of this.burstPool) {
      this.parkBurstForPipeline(burst, false);
    }
    for (const sprite of this.spritePool) {
      this.parkSpriteForPipeline(sprite, false);
    }
    for (const streak of this.streakPool) {
      this.parkStreakForPipeline(streak, false);
    }
    for (const wave of this.pressureWavePool) {
      this.parkPressureWaveForPipeline(wave, false);
    }
  }

  getVisiblePooledEffectCount(): number {
    let visible = 0;
    for (const burst of this.burstPool) {
      visible += visibleSceneObjectCount(this.scene, burst.points);
    }
    for (const sprite of this.spritePool) {
      visible += visibleSceneObjectCount(this.scene, sprite.sprite);
    }
    for (const streak of this.streakPool) {
      visible += visibleSceneObjectCount(this.scene, streak.lines);
    }
    for (const wave of this.pressureWavePool) {
      visible += visibleSceneObjectCount(this.scene, wave.mesh);
    }
    return visible;
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

  private ensureWarmupFlipbookTextures(objects: THREE.Object3D[]): void {
    const profiles = [
      VFX_FLIPBOOK_PROFILES.explosion,
      VFX_FLIPBOOK_PROFILES.dustShell,
      VFX_FLIPBOOK_PROFILES.fireball,
      VFX_FLIPBOOK_PROFILES.smoke
    ];
    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      const sprite = this.createFlipbookSprite(profile.assetId);
      configureFlipbookMap(sprite.material.map, profile.columns, profile.rows, Math.min(index * 3, profile.frameCount - 1));
      sprite.sprite.position.set(-0.85 + index * 0.26, VFX_POOL_PARK_Y, 0);
      sprite.sprite.scale.set(0.08, 0.08, 1);
      sprite.sprite.visible = true;
      sprite.sprite.frustumCulled = false;
      objects.push(sprite.sprite);
      this.spritePool.push(sprite);
    }
  }

  explode(origin: THREE.Vector3, radius: number, dustColors: THREE.Color[], context: ExplosionFxContext = {}): void {
    const startedAt = perfMonitor.timeStart();
    const profile = explosionProfile(context.projectileId, context.hitMaterialId);
    const composition = this.explosionComposition(context);
    const impactScale = this.explosionScale(context);
    const particleScale = impactScale * this.explosionParticleDensity(context);
    const visualRadius = radius * THREE.MathUtils.clamp(0.95 + impactScale * 0.08 + profile.shockBias * 0.08, 0.9, 1.28);
    const coreOrigin = this.explosionCoreOrigin.set(origin.x, origin.y + 0.35 + Math.min(0.85, radius * 0.06), origin.z);
    const dustColor = averageColorInto(this.explosionDustColor, dustColors, DEFAULT_DUST_COLOR);
    const smokeColor = this.explosionSmokeColor.set(profile.smokeColor).lerp(dustColor, 0.28);

    this.flashLight.position.copy(origin);
    this.flashLight.color.set(profile.coreColor);
    this.flashLight.distance = THREE.MathUtils.clamp(visualRadius * (5.4 + profile.shockBias * 1.2), 14, 58);
    this.flashLight.intensity =
      THREE.MathUtils.clamp(56 * impactScale * (1 + profile.fireBias * 0.18 + profile.shockBias * 0.12), 30, 145) * this.flashScale;
    this.setFlashOverlay(profile, impactScale, composition.overlayMax);

    const shockOnlyGlowScale = context.projectileId === "pulse" ? 0.58 : 1;
    const shockOnlySizeScale = context.projectileId === "pulse" ? 0.82 : 1;
    this.spawnSprite(
      coreOrigin,
      CORE_TEXTURE,
      profile.coreColor,
      visualRadius * 0.28 * shockOnlySizeScale,
      visualRadius * 1.06 * shockOnlySizeScale,
      0.42 * shockOnlyGlowScale,
      0.26,
      0.34,
      THREE.AdditiveBlending
    );
    this.spawnSprite(
      this.offsetOrigin(coreOrigin, 0, 0.16, 0),
      CORE_TEXTURE,
      profile.edgeColor,
      visualRadius * 0.24 * shockOnlySizeScale,
      visualRadius * 1.22 * shockOnlySizeScale,
      0.34 * shockOnlyGlowScale,
      0.46,
      0.24,
      THREE.AdditiveBlending
    );
    this.spawnSprite(
      this.offsetOrigin(coreOrigin, 0, 0.32, 0),
      CORE_TEXTURE,
      profile.hotColor,
      visualRadius * 0.18 * shockOnlySizeScale,
      visualRadius * 1.44 * shockOnlySizeScale,
      0.28 * shockOnlyGlowScale,
      0.56,
      0.48,
      THREE.AdditiveBlending,
      1.25
    );
    this.spawnImpactPunch(origin, coreOrigin, visualRadius, profile, dustColor, context, impactScale);
    this.spawnCinematicDetonationLayers(origin, coreOrigin, visualRadius, profile, dustColor, smokeColor, context, impactScale, composition);
    this.spawnBoomFireball(origin, coreOrigin, visualRadius, profile, context, impactScale);
    this.spawnRollingExplosionCloud(origin, coreOrigin, visualRadius, smokeColor, dustColor, context, impactScale);

    const fireAmount = particleScale * (0.75 + profile.fireBias) * composition.fire;
    const smokeAmount = particleScale * (0.8 + profile.smokeBias) * composition.smoke;
    const streakAmount = particleScale * (0.85 + profile.streakBias) * composition.streaks;
    this.spawnBurst(origin, Math.round(142 * fireAmount), profile.hotColor, 0.92, 0.06, 21 * impactScale, 0.78, 0.055, THREE.AdditiveBlending);
    this.spawnBurst(origin, Math.round(82 * fireAmount), profile.coreColor, 0.56, 0.042, 27 * impactScale, 0.46, 0.035, THREE.AdditiveBlending);
    this.spawnBurst(origin, Math.round(52 * streakAmount), profile.emberColor, 0.52, 0.026, 34 * impactScale, 0.74, 0.03, THREE.AdditiveBlending);
    this.spawnBurst(origin, Math.round(92 * smokeAmount), dustColor, 1.38, 0.075, 4.6 * impactScale, 1.55, 0.32);
    this.spawnBurst(coreOrigin, Math.round(64 * smokeAmount), smokeColor, 2.25, 0.13, 2.5 * impactScale, 1.05, 0.55);
    this.spawnPressureWave(origin, visualRadius * (1.04 + profile.shockBias * 0.18), profile.shockColor, context.role === "primary" ? 0.58 : 0.38, impactScale);
    this.spawnDirectionalBlast(origin, normalizedImpactDirectionInto(this.responseDirection, context.impactDirection), visualRadius, profile, dustColor, particleScale);
    this.spawnStreaks(origin, visualRadius, profile.streakColor, Math.round(14 * streakAmount), 0.52);
    this.spawnSmokePuffs(coreOrigin, visualRadius, smokeColor, smokeAmount);
    this.spawnAftermathBloom(origin, visualRadius, dustColor, smokeColor, particleScale);
    if (context.variant === "mushroom") {
      this.spawnMushroomCloud(origin, visualRadius, profile, smokeColor, dustColor, impactScale);
    }

    if (profile.fireBias > 0.08 || context.projectileId === "ignite" || context.projectileId === "slug" || context.projectileId === "scatter") {
      this.fireBurst(origin, 1.15 * particleScale + profile.fireBias);
    }
    this.spawnProjectileSignature(origin, coreOrigin, visualRadius, profile, context, particleScale);
    this.spawnMaterialResponse(origin, visualRadius, context, profile, dustColor, particleScale, composition);
    perfMonitor.addTiming("vfx.explode", startedAt);
  }

  cityDebrisSpray(origin: THREE.Vector3, dustColors: THREE.Color[], intensity = 1): void {
    const amount = THREE.MathUtils.clamp(intensity, 0.35, 2.35);
    const baseDust = averageColorInto(this.cityDustColor, dustColors, DEFAULT_CITY_DUST_COLOR);
    const facadeColor = this.cityFacadeColor.copy(baseDust).offsetHSL(0, -0.08, 0.08);
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.35, 0), Math.round(54 * amount), facadeColor, 1.1, 0.052, 7.5, 1.25, 0.22);
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.55, 0), Math.round(28 * amount), 0xd8fbff, 0.72, 0.03, 12, 0.72, 0.08, THREE.AdditiveBlending);
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.2, 0), Math.round(42 * amount), 0x25282b, 1.35, 0.07, 4.6, 1.65, 0.28);
  }

  muzzleFlash(origin: THREE.Vector3, color: THREE.ColorRepresentation): void {
    this.flashLight.position.copy(origin);
    this.flashLight.color.set(color);
    this.flashLight.intensity = 32 * this.flashScale;
    this.flashOverlay.style.opacity = String(0.16 * this.flashScale);
    this.spawnSprite(this.offsetOrigin(origin, 0, 0.05, 0), CORE_TEXTURE, color, 0.28, 1.55, 0.72, 0.18, 0.12, THREE.AdditiveBlending);
    this.spawnBurst(origin, 68, color, 0.46, 0.065, 13, 0.45, 0.04, THREE.AdditiveBlending);
    this.spawnBurst(origin, 42, 0x707780, 0.9, 0.09, 5.5, 0.7, 0.24);
  }

  ruptureDebrisSplash(origin: THREE.Vector3, intensity = 1, color: THREE.ColorRepresentation = 0xc08a4a): void {
    const count = Math.round(80 * intensity);
    this.spawnBurst(origin, count, color, 1.65, 0.085, 7.5 * intensity, 1.5, 0.32);
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.18, 0), Math.round(35 * intensity), 0xffc36a, 0.85, 0.045, 5, 0.7, 0.16, THREE.AdditiveBlending);
  }

  fireBurst(origin: THREE.Vector3, intensity = 1): void {
    const amount = THREE.MathUtils.clamp(intensity, 0.35, 3.2);
    this.spawnSprite(this.offsetOrigin(origin, 0, 0.45, 0), CORE_TEXTURE, 0xff8f38, 0.46 * amount, 2.05 * amount, 0.64, 0.46, 0.55, THREE.AdditiveBlending);
    this.spawnSprite(this.offsetOrigin(origin, 0, 0.82, 0), CORE_TEXTURE, 0xffd15c, 0.18 * amount, 1.25 * amount, 0.36, 0.58, 0.86, THREE.AdditiveBlending, 0.72);
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.28, 0), Math.round(64 * amount), 0xff7a35, 0.72, 0.075, 8.8 * amount, 0.22, 0.12, THREE.AdditiveBlending);
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.48, 0), Math.round(42 * amount), 0xffd15c, 0.52, 0.045, 7.2 * amount, 0.16, 0.07, THREE.AdditiveBlending);
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.32, 0), Math.round(48 * amount), 0x1d1b19, 1.75, 0.12, 2.8 * amount, -0.18, 0.44);
  }

  fireLick(origin: THREE.Vector3, intensity = 1): void {
    const amount = THREE.MathUtils.clamp(intensity, 0.25, 2.1);
    this.spawnSprite(this.offsetOrigin(origin, 0, 0.36, 0), CORE_TEXTURE, 0xff7a35, 0.2 * amount, 0.96 * amount, 0.42, 0.32, 0.42, THREE.AdditiveBlending);
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.34, 0), Math.round(22 * amount), 0xff8f38, 0.42, 0.055, 4.8 * amount, 0.1, 0.1, THREE.AdditiveBlending);
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.48, 0), Math.round(14 * amount), 0x2d2824, 1.15, 0.1, 1.8 * amount, -0.12, 0.4);
  }

  armingPulse(origin: THREE.Vector3, intensity = 1, color: THREE.ColorRepresentation = 0xff9a42): void {
    const amount = THREE.MathUtils.clamp(intensity, 0.1, 1.25);
    const lifted = this.offsetOrigin(origin, 0, 0.26, 0);
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
      const activeLife = sprite.life - sprite.delay;
      if (activeLife < 0) {
        sprite.sprite.visible = false;
        sprite.material.opacity = 0;
        continue;
      }
      sprite.sprite.visible = true;
      const t = activeLife / sprite.maxLife;
      if (t >= 1) {
        this.retireSpriteAt(i);
        continue;
      }
      const size = THREE.MathUtils.lerp(sprite.startSize, sprite.endSize, easeOutCubic(t));
      sprite.sprite.scale.set(size * sprite.aspect, size, 1);
      sprite.sprite.position.y += sprite.rise * deltaSeconds;
      sprite.sprite.position.addScaledVector(sprite.velocity, deltaSeconds);
      sprite.material.rotation += sprite.rotationSpeed * deltaSeconds;
      if (sprite.flipbook) {
        updateFlipbookSprite(sprite, t);
      }
      const fadeIn = sprite.fadeIn > 0 ? THREE.MathUtils.clamp(activeLife / sprite.fadeIn, 0, 1) : 1;
      sprite.material.opacity = sprite.maxOpacity * fadeIn * (1 - t) ** 1.65;
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
    velocity?: THREE.Vector3,
    options: SpriteOptions = {}
  ): void {
    if (this.sprites.length >= ParticleSystem.maxSprites) {
      this.retireReusableSprite(textureKind, blending);
    }
    const delay = options.delay ?? 0;
    const fadeIn = options.fadeIn ?? 0;
    const fx = this.acquireSprite(textureKind, blending);
    fx.material.color.set(color);
    fx.material.opacity = delay > 0 || fadeIn > 0 ? 0 : opacity;
    fx.material.rotation = 0;
    fx.sprite.position.copy(origin);
    fx.sprite.scale.set(startSize, startSize, 1);
    fx.sprite.renderOrder = blending === THREE.AdditiveBlending ? 8 : 5;
    fx.sprite.visible = delay <= 0;
    fx.sprite.frustumCulled = false;
    fx.life = 0;
    fx.maxLife = maxLife;
    fx.maxOpacity = opacity;
    fx.startSize = startSize;
    fx.endSize = endSize;
    fx.aspect = aspect;
    fx.rise = rise;
    fx.delay = delay;
    fx.fadeIn = fadeIn;
    fx.velocity.copy(velocity ?? ZERO_VECTOR);
    fx.rotationSpeed = THREE.MathUtils.randFloat(-1.8, 1.8);
    addToSceneIfNeeded(this.scene, fx.sprite);
    this.sprites.push(fx);
    perfMonitor.addCount("vfx.spritesSpawned");
    this.trimSprites();
  }

  private spawnFlipbookSprite(
    origin: THREE.Vector3,
    profile: Pick<FlipbookState, "assetId" | "columns" | "rows" | "frameCount">,
    startSize: number,
    endSize: number,
    opacity: number,
    maxLife: number,
    rise: number,
    blending: THREE.Blending = THREE.AdditiveBlending,
    aspect = 1,
    velocity?: THREE.Vector3,
    options: FlipbookOptions = {}
  ): void {
    while (this.countActiveFlipbookSprites(profile.assetId, blending) >= this.flipbookActiveLimit(profile.assetId, blending)) {
      if (!this.retireOldestFlipbookSprite(profile.assetId, blending)) {
        break;
      }
    }
    if (this.sprites.length >= ParticleSystem.maxSprites) {
      this.retireReusableSprite(VFX_FLIPBOOK_TEXTURE_KIND, blending);
    }
    const delay = options.delay ?? 0;
    const fadeIn = options.fadeIn ?? 0;
    const fx = this.acquireFlipbookSprite(profile.assetId, blending);
    fx.material.opacity = delay > 0 || fadeIn > 0 ? 0 : opacity;
    fx.material.color.set(options.color ?? 0xffffff);
    fx.material.rotation = 0;
    fx.sprite.position.copy(origin);
    fx.sprite.scale.set(startSize * aspect, startSize, 1);
    fx.sprite.renderOrder = blending === THREE.AdditiveBlending ? 8 : 5;
    fx.sprite.visible = delay <= 0;
    fx.sprite.frustumCulled = false;
    fx.life = 0;
    fx.maxLife = maxLife;
    fx.maxOpacity = opacity;
    fx.startSize = startSize;
    fx.endSize = endSize;
    fx.aspect = aspect;
    fx.rise = rise;
    fx.delay = delay;
    fx.fadeIn = fadeIn;
    fx.velocity.copy(velocity ?? ZERO_VECTOR);
    fx.rotationSpeed = THREE.MathUtils.randFloat(-0.48, 0.48);
    fx.flipbook = {
      assetId: profile.assetId,
      columns: profile.columns,
      rows: profile.rows,
      frameCount: profile.frameCount,
      startFrame: options.startFrame ?? 0,
      frameSpan: options.frameSpan ?? profile.frameCount,
      loop: options.loop ?? false,
      randomStart: options.randomStart ?? false
    };
    updateFlipbookSprite(fx, 0);
    addToSceneIfNeeded(this.scene, fx.sprite);
    this.sprites.push(fx);
    perfMonitor.addCount("vfx.flipbooksSpawned");
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
      const angleCos = Math.cos(angle);
      const angleSin = Math.sin(angle);
      const offset = this.smokeOffset.set(angleCos * distance, THREE.MathUtils.randFloat(0.05, radius * 0.12), angleSin * distance);
      const startSize = THREE.MathUtils.randFloat(radius * 0.18, radius * 0.34);
      const drift = this.smokeDrift.set(
        angleCos * THREE.MathUtils.randFloat(0.08, 0.22),
        THREE.MathUtils.randFloat(0.02, 0.08),
        angleSin * THREE.MathUtils.randFloat(0.08, 0.22)
      );
      this.spawnSprite(
        this.offsetOrigin(origin, offset.x, offset.y, offset.z),
        SMOKE_TEXTURE,
        color,
        startSize,
        startSize * THREE.MathUtils.randFloat(2.1, 3.4),
        THREE.MathUtils.randFloat(0.22, 0.38),
        THREE.MathUtils.randFloat(1.1, 1.9),
        THREE.MathUtils.randFloat(0.16, 0.46),
        THREE.NormalBlending,
        THREE.MathUtils.randFloat(0.72, 1.38),
        drift,
        { delay: THREE.MathUtils.randFloat(0.06, 0.18), fadeIn: THREE.MathUtils.randFloat(0.12, 0.22) }
      );
    }

    const lingerCount = this.quality === "performance" ? 2 : this.quality === "balanced" ? 3 : 5;
    for (let i = 0; i < lingerCount; i += 1) {
      const angle = (i / lingerCount) * Math.PI * 2 + THREE.MathUtils.randFloatSpread(0.72);
      const distance = THREE.MathUtils.randFloat(radius * 0.04, radius * 0.2);
      const angleCos = Math.cos(angle);
      const angleSin = Math.sin(angle);
      const offset = this.smokeOffset.set(angleCos * distance, THREE.MathUtils.randFloat(radius * 0.05, radius * 0.18), angleSin * distance);
      const startSize = THREE.MathUtils.randFloat(radius * 0.22, radius * 0.42);
      const drift = this.smokeDrift.set(
        angleCos * THREE.MathUtils.randFloat(0.04, 0.15),
        THREE.MathUtils.randFloat(0.04, 0.14),
        angleSin * THREE.MathUtils.randFloat(0.04, 0.15)
      );
      this.spawnSprite(
        this.offsetOrigin(origin, offset.x, offset.y, offset.z),
        SMOKE_TEXTURE,
        color,
        startSize,
        startSize * THREE.MathUtils.randFloat(3.1, 4.8),
        THREE.MathUtils.randFloat(0.12, 0.2),
        THREE.MathUtils.randFloat(2.8, 4.4),
        THREE.MathUtils.randFloat(0.08, 0.2),
        THREE.NormalBlending,
        THREE.MathUtils.randFloat(0.58, 1.45),
        drift,
        { delay: THREE.MathUtils.randFloat(0.16, 0.36), fadeIn: THREE.MathUtils.randFloat(0.22, 0.36) }
      );
    }
  }

  private spawnAftermathBloom(
    origin: THREE.Vector3,
    radius: number,
    dustColor: THREE.Color,
    smokeColor: THREE.Color,
    intensity: number
  ): void {
    if (this.quality === "performance") {
      return;
    }
    const amount = THREE.MathUtils.clamp(intensity, 0.45, 1.85) * (this.quality === "cinematic" ? 1.2 : 0.86);
    const sheetCount = this.quality === "cinematic" ? 5 : 3;
    this.spawnPressureWave(this.offsetOrigin(origin, 0, 0.01, 0), radius * 0.78, dustColor, 0.16, amount);
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.08, 0), Math.round(38 * amount), dustColor, 1.95, 0.105, 4.1 * amount, 1.85, 0.48);

    for (let i = 0; i < sheetCount; i += 1) {
      const angle = (i / sheetCount) * Math.PI * 2 + THREE.MathUtils.randFloatSpread(0.5);
      const distance = THREE.MathUtils.randFloat(radius * 0.06, radius * 0.22);
      const angleCos = Math.cos(angle);
      const angleSin = Math.sin(angle);
      const offset = this.smokeOffset.set(angleCos * distance, THREE.MathUtils.randFloat(0.02, radius * 0.055), angleSin * distance);
      const drift = this.smokeDrift.set(
        angleCos * THREE.MathUtils.randFloat(0.03, 0.12),
        THREE.MathUtils.randFloat(0.015, 0.055),
        angleSin * THREE.MathUtils.randFloat(0.03, 0.12)
      );
      const startSize = THREE.MathUtils.randFloat(radius * 0.24, radius * 0.38);
      this.spawnSprite(
        this.offsetOrigin(origin, offset.x, offset.y, offset.z),
        SMOKE_TEXTURE,
        i % 2 === 0 ? dustColor : smokeColor,
        startSize,
        startSize * THREE.MathUtils.randFloat(3.4, 5.2),
        THREE.MathUtils.randFloat(0.1, 0.17),
        THREE.MathUtils.randFloat(3.1, 5.3),
        THREE.MathUtils.randFloat(0.025, 0.085),
        THREE.NormalBlending,
        THREE.MathUtils.randFloat(0.55, 1.55),
        drift,
        { delay: THREE.MathUtils.randFloat(0.2, 0.42), fadeIn: THREE.MathUtils.randFloat(0.24, 0.42) }
      );
    }
  }

  private spawnMushroomCloud(
    origin: THREE.Vector3,
    radius: number,
    profile: ExplosionProfile,
    smokeColor: THREE.Color,
    dustColor: THREE.Color,
    impactScale: number
  ): void {
    if (this.quality === "performance") {
      this.spawnPressureWave(origin, radius * 1.85, profile.hotColor, 0.32, impactScale);
      return;
    }
    const amount = THREE.MathUtils.clamp(impactScale * (this.quality === "cinematic" ? 1.18 : 0.88), 0.72, 2.05);
    const stemHeight = radius * THREE.MathUtils.clamp(0.78 + amount * 0.12, 0.82, 1.16);
    this.spawnPressureWave(origin, radius * 2.05, profile.hotColor, 0.36, amount);
    this.spawnPressureWave(this.offsetOrigin(origin, 0, 0.04, 0), radius * 2.6, smokeColor, 0.18, amount);

    for (let layer = 0; layer < 4; layer += 1) {
      const y = radius * (0.22 + layer * 0.22);
      const startSize = radius * (0.18 + layer * 0.035) * amount;
      const endSize = radius * (0.72 + layer * 0.16) * amount;
      const drift = this.smokeDrift.set(THREE.MathUtils.randFloatSpread(0.08), 0.22 + layer * 0.08, THREE.MathUtils.randFloatSpread(0.08));
      this.spawnSprite(
        this.offsetOrigin(origin, THREE.MathUtils.randFloatSpread(radius * 0.05), y, THREE.MathUtils.randFloatSpread(radius * 0.05)),
        SMOKE_TEXTURE,
        layer < 2 ? dustColor : smokeColor,
        startSize,
        endSize,
        THREE.MathUtils.lerp(0.22, 0.14, layer / 3),
        2.2 + layer * 0.42,
        0.24,
        THREE.NormalBlending,
        1.08,
        drift,
        { delay: layer * 0.08, fadeIn: 0.16 }
      );
    }

    const capCount = this.quality === "cinematic" ? 7 : 5;
    for (let i = 0; i < capCount; i += 1) {
      const angle = (i / capCount) * Math.PI * 2 + THREE.MathUtils.randFloatSpread(0.26);
      const angleCos = Math.cos(angle);
      const angleSin = Math.sin(angle);
      const distance = THREE.MathUtils.randFloat(radius * 0.12, radius * 0.34);
      const drift = this.smokeDrift.set(angleCos * 0.1, 0.14, angleSin * 0.1);
      this.spawnSprite(
        this.offsetOrigin(origin, angleCos * distance, stemHeight, angleSin * distance),
        SMOKE_TEXTURE,
        i % 3 === 0 ? dustColor : smokeColor,
        radius * THREE.MathUtils.randFloat(0.26, 0.42) * amount,
        radius * THREE.MathUtils.randFloat(1.05, 1.55) * amount,
        0.2,
        THREE.MathUtils.randFloat(3.2, 4.8),
        0.16,
        THREE.NormalBlending,
        THREE.MathUtils.randFloat(0.78, 1.4),
        drift,
        { delay: 0.22 + Math.random() * 0.28, fadeIn: 0.28 }
      );
    }

    this.spawnBurst(this.offsetOrigin(origin, 0, radius * 0.12, 0), Math.round(52 * amount), profile.emberColor, 0.74, 0.045, 18 * amount, 0.82, 0.07, THREE.AdditiveBlending);
    this.spawnFlipbookSprite(
      this.offsetOrigin(origin, 0, stemHeight * 0.72, 0),
      VFX_FLIPBOOK_PROFILES.smoke,
      radius * 0.58 * amount,
      radius * 1.8 * amount,
      0.18,
      3.4,
      0.36,
      THREE.NormalBlending,
      1.2,
      this.smokeDrift.set(0, 0.18, 0),
      { startFrame: 6, frameSpan: 44, color: 0xffffff, delay: 0.18, fadeIn: 0.26 }
    );
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
    wave.mesh.visible = true;
    wave.mesh.frustumCulled = false;
    wave.life = 0;
    wave.maxLife = THREE.MathUtils.lerp(0.26, 0.52, THREE.MathUtils.clamp(intensity, 0, 1));
    wave.startRadius = radius * 0.16;
    wave.endRadius = radius * THREE.MathUtils.randFloat(1.22, 1.82);
    wave.maxOpacity = maxOpacity;
    addToSceneIfNeeded(this.scene, wave.mesh);
    this.pressureWaves.push(wave);
    perfMonitor.addCount("vfx.pressureWavesSpawned");
    this.trimPressureWaves();
  }

  private spawnImpactPunch(
    origin: THREE.Vector3,
    coreOrigin: THREE.Vector3,
    visualRadius: number,
    profile: ExplosionProfile,
    dustColor: THREE.Color,
    context: ExplosionFxContext,
    impactScale: number
  ): void {
    const roleScale = context.role === "primary" ? 1 : context.role === "ignition" ? 0.82 : 0.62;
    const amount = THREE.MathUtils.clamp(impactScale * projectileBoomScale(context.projectileId) * roleScale, 0.36, 2.25);
    const hotOpacity = context.role === "primary" ? 0.26 : 0.2;
    this.spawnSprite(
      this.offsetOrigin(coreOrigin, 0, 0.04, 0),
      CORE_TEXTURE,
      profile.coreColor,
      visualRadius * 0.08,
      visualRadius * (0.42 + amount * 0.16),
      hotOpacity,
      0.14,
      0.06,
      THREE.AdditiveBlending,
      1.25
    );
    if (context.role === "primary") {
      this.spawnSprite(coreOrigin, CORE_TEXTURE, 0xfff4d8, visualRadius * 0.035, visualRadius * 0.32, 0.14, 0.08, 0.01, THREE.AdditiveBlending);
    }
    this.spawnPressureWave(origin, visualRadius * (0.7 + amount * 0.2), profile.edgeColor, 0.22, amount);

    if (this.quality === "performance" && context.role !== "primary") {
      return;
    }

    this.spawnPressureWave(this.offsetOrigin(origin, 0, 0.03, 0), visualRadius * (0.52 + amount * 0.16), dustColor, 0.1, amount);
    this.spawnBurst(
      this.offsetOrigin(origin, 0, 0.12, 0),
      Math.round(36 * amount),
      profile.hotColor,
      0.42,
      0.04,
      22 * amount,
      0.52,
      0.04,
      THREE.AdditiveBlending
    );
  }

  private spawnCinematicDetonationLayers(
    origin: THREE.Vector3,
    coreOrigin: THREE.Vector3,
    visualRadius: number,
    profile: ExplosionProfile,
    dustColor: THREE.Color,
    smokeColor: THREE.Color,
    context: ExplosionFxContext,
    impactScale: number,
    composition: CompositionProfile
  ): void {
    const isPrimary = context.role === "primary";
    if (this.quality === "performance" && !isPrimary) {
      perfMonitor.addCount("vfx.heroLayersSuppressed");
      return;
    }

    const qualityScale = this.quality === "cinematic" ? 1.16 : this.quality === "balanced" ? 0.78 : 0.42;
    const roleScale = isPrimary ? 1 : context.role === "ignition" ? 0.76 : 0.58;
    const amount = THREE.MathUtils.clamp(impactScale * qualityScale * roleScale, 0.26, 1.55);
    const isShockOnly = context.projectileId === "pulse";

    this.spawnSprite(
      coreOrigin,
      CORE_TEXTURE,
      isShockOnly ? profile.shockColor : 0xfff1c8,
      visualRadius * 0.035,
      visualRadius * (0.38 + amount * 0.2),
      (isShockOnly ? 0.08 : 0.18) * amount,
      0.11,
      0.025,
      THREE.AdditiveBlending,
      1.4
    );
    this.spawnPressureWave(origin, visualRadius * (1.18 + profile.shockBias * 0.22), profile.shockColor, isPrimary ? 0.24 : 0.16, amount);
    this.spawnPressureWave(this.offsetOrigin(origin, 0, 0.025, 0), visualRadius * (0.74 + amount * 0.2), dustColor, 0.13, amount);

    if (this.quality === "performance") {
      perfMonitor.addCount("vfx.heroLayersSuppressed");
      return;
    }

    this.radialRingVelocity.set(0, isShockOnly ? 0.14 : 0.2, 0);
    this.spawnFlipbookSprite(
      this.offsetOrigin(coreOrigin, 0, visualRadius * 0.08, 0),
      isShockOnly ? VFX_FLIPBOOK_PROFILES.smoke : VFX_FLIPBOOK_PROFILES.dustShell,
      visualRadius * (isShockOnly ? 0.3 : 0.42) * amount,
      visualRadius * (isShockOnly ? 1.7 : 2.35) * amount,
      isShockOnly ? 0.1 : 0.24,
      isShockOnly ? 1.6 : 1.25,
      isShockOnly ? 0.18 : 0.28,
      THREE.NormalBlending,
      isShockOnly ? 1.5 : 1.65,
      this.radialRingVelocity,
      {
        startFrame: isShockOnly ? 8 : 1,
        frameSpan: isShockOnly ? 42 : 23,
        color: isShockOnly ? 0xbaffff : 0xffffff,
        delay: 0.04,
        fadeIn: 0.12
      }
    );

    this.spawnGroundRollRing(origin, visualRadius, dustColor, smokeColor, amount, context);

    if (this.quality === "cinematic" && isPrimary && !isShockOnly && composition.fire > 0.35) {
      this.radialRingVelocity.set(0.04, 0.52, -0.03);
      this.spawnFlipbookSprite(
        this.offsetOrigin(coreOrigin, visualRadius * 0.08, visualRadius * 0.16, -visualRadius * 0.04),
        VFX_FLIPBOOK_PROFILES.fireball,
        visualRadius * 0.24 * amount,
        visualRadius * 1.42 * amount,
        0.28,
        0.68,
        0.48,
        THREE.AdditiveBlending,
        1.28,
        this.radialRingVelocity,
        { startFrame: 8, frameSpan: 30, color: 0xffffff, delay: 0.05, fadeIn: 0.04 }
      );
    }
    perfMonitor.addCount("vfx.heroLayersSpawned");
  }

  private spawnGroundRollRing(
    origin: THREE.Vector3,
    radius: number,
    dustColor: THREE.Color,
    smokeColor: THREE.Color,
    amount: number,
    context: ExplosionFxContext
  ): void {
    const ringCount = this.quality === "cinematic" ? (context.role === "primary" ? 8 : 5) : 4;
    for (let i = 0; i < ringCount; i += 1) {
      const angle = (i / ringCount) * Math.PI * 2 + THREE.MathUtils.randFloatSpread(0.34);
      const angleCos = Math.cos(angle);
      const angleSin = Math.sin(angle);
      const distance = THREE.MathUtils.randFloat(radius * 0.12, radius * 0.36);
      const startSize = THREE.MathUtils.randFloat(radius * 0.13, radius * 0.24) * amount;
      this.radialRingVelocity.set(
        angleCos * THREE.MathUtils.randFloat(0.08, 0.26),
        THREE.MathUtils.randFloat(0.03, 0.13),
        angleSin * THREE.MathUtils.randFloat(0.08, 0.26)
      );
      this.spawnSprite(
        this.offsetOrigin(origin, angleCos * distance, THREE.MathUtils.randFloat(0.025, 0.09), angleSin * distance),
        SMOKE_TEXTURE,
        i % 2 === 0 ? dustColor : smokeColor,
        startSize,
        startSize * THREE.MathUtils.randFloat(3.0, 4.8),
        THREE.MathUtils.randFloat(0.11, 0.19),
        THREE.MathUtils.randFloat(1.9, 3.4),
        THREE.MathUtils.randFloat(0.02, 0.09),
        THREE.NormalBlending,
        THREE.MathUtils.randFloat(0.78, 1.56),
        this.radialRingVelocity,
        { delay: THREE.MathUtils.randFloat(0.08, 0.22), fadeIn: THREE.MathUtils.randFloat(0.16, 0.3) }
      );
    }
    this.spawnBurst(this.offsetOrigin(origin, 0, 0.055, 0), Math.round(34 * amount), dustColor, 1.48, 0.1, 4.8 * amount, 1.8, 0.46);
    perfMonitor.addCount("vfx.groundRollRingsSpawned");
  }

  private spawnBoomFireball(
    origin: THREE.Vector3,
    coreOrigin: THREE.Vector3,
    visualRadius: number,
    profile: ExplosionProfile,
    context: ExplosionFxContext,
    impactScale: number
  ): void {
    const heat = THREE.MathUtils.clamp((0.9 + profile.fireBias * 0.95) * impactScale * projectileBoomScale(context.projectileId), 0.35, 3.05);
    const isShockOnly = context.projectileId === "pulse";
    const isCrush = context.projectileId === "gravity";
    if (isCrush && context.role === "secondary") {
      return;
    }
    const spriteCount =
      this.quality === "performance" ? (context.role === "primary" ? 1 : 0) : this.quality === "balanced" ? 4 : 6;
    const flameColor = isShockOnly ? profile.shockColor : isCrush ? 0x9c71ff : profile.hotColor;
    const coreColor = isShockOnly ? 0xd9feff : isCrush ? 0xd8c6ff : profile.coreColor;
    const flipbookScale = context.role === "primary" ? 1 : 0.68;

    if (context.role === "primary" || this.quality !== "performance") {
      this.spawnFlipbookSprite(
        coreOrigin,
        isShockOnly ? VFX_FLIPBOOK_PROFILES.smoke : isCrush ? VFX_FLIPBOOK_PROFILES.dustShell : VFX_FLIPBOOK_PROFILES.explosion,
        visualRadius * (isShockOnly ? 0.52 : 0.82) * flipbookScale,
        visualRadius * (isShockOnly ? 1.45 : 2.85) * flipbookScale,
        isShockOnly ? 0.12 : isCrush ? 0.54 : 0.62,
        isShockOnly ? 0.92 : 1.05,
        isShockOnly ? 0.18 : 0.44,
        isShockOnly ? THREE.NormalBlending : THREE.AdditiveBlending,
        isShockOnly ? 1.35 : 1.1,
        this.flipbookVelocity.set(0, isShockOnly ? 0.2 : 0.48, 0),
        {
          startFrame: 1,
          frameSpan: isShockOnly ? 42 : 24,
          color: isShockOnly ? 0x8ffcff : isCrush ? 0xc2a6ff : 0xffffff,
          fadeIn: isShockOnly ? 0.08 : 0.04
        }
      );
      this.spawnFlipbookSprite(
        this.offsetOrigin(coreOrigin, 0, visualRadius * 0.18, 0),
        VFX_FLIPBOOK_PROFILES.fireball,
        visualRadius * (isShockOnly ? 0.42 : 0.58) * flipbookScale,
        visualRadius * (isShockOnly ? 1.35 : 2.05) * flipbookScale,
        isShockOnly ? 0.12 : isCrush ? 0.46 : 0.58,
        0.92,
        isShockOnly ? 0.18 : 0.76,
        THREE.AdditiveBlending,
        0.92,
        this.flipbookVelocity.set(0, isShockOnly ? 0.28 : 0.82, 0),
        { startFrame: 4, frameSpan: 42, color: isShockOnly ? 0x61f4ff : isCrush ? 0x7b52ff : 0xffffff, fadeIn: 0.04 }
      );
    }

    for (let i = 0; i < spriteCount; i += 1) {
      const angle = (i / spriteCount) * Math.PI * 2 + THREE.MathUtils.randFloatSpread(0.34);
      const distance = THREE.MathUtils.randFloat(visualRadius * 0.03, visualRadius * 0.22);
      const lift = THREE.MathUtils.randFloat(visualRadius * 0.02, visualRadius * 0.18) + i * 0.015;
      const originOffset = this.offsetOrigin(coreOrigin, Math.cos(angle) * distance, lift, Math.sin(angle) * distance);
      const start = visualRadius * THREE.MathUtils.randFloat(0.18, 0.34) * heat;
      const end = start * THREE.MathUtils.randFloat(isShockOnly ? 2.2 : 2.6, isShockOnly ? 3.7 : 4.8);
      this.spawnSprite(
        originOffset,
        CORE_TEXTURE,
        i % 4 === 0 ? coreColor : i % 2 === 0 ? profile.edgeColor : flameColor,
        start,
        end,
        isShockOnly ? 0.14 : 0.24,
        THREE.MathUtils.randFloat(0.58, 1.05),
        THREE.MathUtils.randFloat(0.36, 0.95),
        THREE.AdditiveBlending,
        THREE.MathUtils.randFloat(0.68, 1.35),
        this.spriteVelocity.set(
          Math.cos(angle) * THREE.MathUtils.randFloat(0.18, 0.52),
          THREE.MathUtils.randFloat(0.28, 0.96),
          Math.sin(angle) * THREE.MathUtils.randFloat(0.18, 0.52)
        )
      );
    }

    if (isShockOnly) {
      return;
    }

    const lickCount = this.quality === "performance" ? 1 : this.quality === "balanced" ? 6 : 9;
    for (let i = 0; i < lickCount; i += 1) {
      const angle = (i / lickCount) * Math.PI * 2 + THREE.MathUtils.randFloatSpread(0.45);
      const distance = THREE.MathUtils.randFloat(visualRadius * 0.05, visualRadius * 0.32);
      this.fireLick(this.offsetOrigin(origin, Math.cos(angle) * distance, 0.05, Math.sin(angle) * distance), heat * 0.96);
    }

    this.spawnBurst(
      this.offsetOrigin(origin, 0, 0.18, 0),
      Math.round(82 * heat),
      isCrush ? 0xb08aff : 0xffb34f,
      0.78,
      0.07,
      12 * heat,
      isCrush ? 0.42 : 0.2,
      0.075,
      THREE.AdditiveBlending
    );
  }

  private spawnRollingExplosionCloud(
    origin: THREE.Vector3,
    coreOrigin: THREE.Vector3,
    visualRadius: number,
    smokeColor: THREE.Color,
    dustColor: THREE.Color,
    context: ExplosionFxContext,
    impactScale: number
  ): void {
    if (this.quality === "performance" && context.role !== "primary") {
      return;
    }
    if (context.projectileId === "gravity" && context.role === "secondary") {
      return;
    }

    const amount = THREE.MathUtils.clamp(impactScale * (0.9 + (context.projectileId === "gravity" ? 0.34 : 0)), 0.45, 2.4);
    const pulseCloudScale = context.projectileId === "pulse" ? 0.58 : 1;
    if (context.role === "primary" || this.quality !== "performance") {
      this.spawnFlipbookSprite(
        this.offsetOrigin(coreOrigin, 0, visualRadius * 0.28, 0),
        VFX_FLIPBOOK_PROFILES.smoke,
        visualRadius * 0.68 * amount * pulseCloudScale,
        visualRadius * 3.9 * amount * pulseCloudScale,
        context.projectileId === "pulse" ? 0.13 : 0.42,
        2.8,
        0.72,
        THREE.NormalBlending,
        1.25,
        this.flipbookVelocity.set(0, 0.46, 0),
        {
          startFrame: 2,
          frameSpan: 54,
          randomStart: context.role !== "primary",
          color: context.projectileId === "pulse" ? 0xaaffff : context.projectileId === "gravity" ? 0x9c71ff : 0xffffff,
          delay: context.projectileId === "pulse" ? 0.16 : 0.12,
          fadeIn: context.projectileId === "pulse" ? 0.32 : 0.24
        }
      );
      this.spawnFlipbookSprite(
        this.offsetOrigin(origin, 0, 0.08, 0),
        VFX_FLIPBOOK_PROFILES.dustShell,
        visualRadius * 0.58 * amount * pulseCloudScale,
        visualRadius * 2.7 * amount * pulseCloudScale,
        context.projectileId === "pulse" ? 0.14 : 0.28,
        1.55,
        0.18,
        THREE.NormalBlending,
        1.45,
        this.flipbookVelocity.set(0, 0.18, 0),
        {
          startFrame: 1,
          frameSpan: 23,
          color: context.projectileId === "gravity" ? 0x8d6cff : 0xffffff,
          delay: 0.08,
          fadeIn: 0.18
        }
      );
    }
    const plumeCount = this.quality === "performance" ? 2 : this.quality === "balanced" ? 5 : 7;
    for (let i = 0; i < plumeCount; i += 1) {
      const angle = (i / plumeCount) * Math.PI * 2 + THREE.MathUtils.randFloatSpread(0.5);
      const distance = THREE.MathUtils.randFloat(visualRadius * 0.04, visualRadius * 0.34);
      const lifted = this.offsetOrigin(
        coreOrigin,
        Math.cos(angle) * distance,
        THREE.MathUtils.randFloat(visualRadius * 0.04, visualRadius * 0.24),
        Math.sin(angle) * distance
      );
      const startSize = THREE.MathUtils.randFloat(visualRadius * 0.24, visualRadius * 0.54) * amount;
      this.spawnSprite(
        lifted,
        SMOKE_TEXTURE,
        i % 2 === 0 ? smokeColor : dustColor,
        startSize,
        startSize * THREE.MathUtils.randFloat(2.8, 5.6),
        THREE.MathUtils.randFloat(0.18, 0.32),
        THREE.MathUtils.randFloat(1.8, 3.6),
        THREE.MathUtils.randFloat(0.22, 0.62),
        THREE.NormalBlending,
        THREE.MathUtils.randFloat(0.7, 1.55),
        this.plumeDrift.set(
          Math.cos(angle) * THREE.MathUtils.randFloat(0.08, 0.32),
          THREE.MathUtils.randFloat(0.2, 0.72),
          Math.sin(angle) * THREE.MathUtils.randFloat(0.08, 0.32)
        ),
        { delay: THREE.MathUtils.randFloat(0.1, 0.24), fadeIn: THREE.MathUtils.randFloat(0.16, 0.28) }
      );
    }

    if (context.projectileId === "slug" || context.projectileId === "scatter" || context.projectileId === "ignite") {
      this.spawnBurst(this.offsetOrigin(origin, 0, 0.24, 0), Math.round(54 * amount), 0x1d1b19, 2.1, 0.14, 4.2 * amount, -0.2, 0.42);
    }
  }

  private spawnDirectionalBlast(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    radius: number,
    profile: ExplosionProfile,
    dustColor: THREE.Color,
    impactScale: number
  ): void {
    const blastDirection = this.blastDirection.copy(direction);
    blastDirection.y += 0.16;
    blastDirection.normalize();
    this.spawnDirectionalBurst(origin, blastDirection, Math.round(52 * impactScale), profile.hotColor, 0.58, 0.034, 26 * impactScale, 0.52, 0.035, 0.44, THREE.AdditiveBlending);
    this.spawnDirectionalBurst(origin, blastDirection, Math.round(48 * impactScale), dustColor, 1.25, 0.09, 8.5 * impactScale, 1.55, 0.25, 0.62);
    if (this.quality !== "performance") {
      this.spawnDirectionalBurst(
        this.offsetOrigin(origin, 0, 0.08, 0),
        blastDirection,
        Math.round(26 * impactScale),
        dustColor,
        1.65,
        0.12,
        5.8 * impactScale,
        1.9,
        0.42,
        0.78
      );
    }
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
    const direction = normalizedImpactDirectionInto(this.signatureDirection, context.impactDirection);
    switch (context.projectileId) {
      case "slug":
        this.spawnPressureWave(origin, visualRadius * 0.92, 0xd8f1ff, 0.28, impactScale);
        this.spawnDirectionalStreaks(origin, direction, visualRadius * 1.32, 0xd8f1ff, Math.round(22 * impactScale), 0.36, 0.16);
        this.spawnDirectionalBurst(origin, direction, Math.round(38 * impactScale), 0xfff0c2, 0.44, 0.03, 38 * impactScale, 0.48, 0.026, 0.18, THREE.AdditiveBlending);
        this.spawnSprite(coreOrigin, CORE_TEXTURE, 0xfff4d8, visualRadius * 0.2, visualRadius * 1.28, 0.34, 0.28, 0.2, THREE.AdditiveBlending, 0.42);
        break;
      case "scatter":
        this.signatureLiftedDirection.copy(direction);
        this.signatureLiftedDirection.y += 0.2;
        this.signatureLiftedDirection.normalize();
        this.spawnDirectionalStreaks(origin, this.signatureLiftedDirection, visualRadius * 1.55, 0xffdd8a, Math.round(36 * impactScale), 0.52, 0.82);
        this.spawnStreaks(origin, visualRadius * 1.38, 0xfff0a8, Math.round(28 * impactScale), 0.48);
        this.spawnBurst(origin, Math.round(62 * impactScale), 0xffd26b, 0.48, 0.028, 38 * impactScale, 0.62, 0.03, THREE.AdditiveBlending);
        this.spawnPressureWave(origin, visualRadius * 0.7, 0xffc961, 0.24, impactScale);
        break;
      case "pulse":
        this.spawnPressureWave(origin, visualRadius * 1.22, 0xd9feff, 0.34, impactScale * 1.18);
        this.spawnPressureWave(origin, visualRadius * 1.55, profile.shockColor, 0.18, impactScale);
        this.spawnArcWeb(origin, visualRadius * 1.08, profile.shockColor, Math.round(24 * impactScale), 0.5);
        this.spawnArcWeb(origin, visualRadius * 0.62, 0xd9feff, Math.round(10 * impactScale), 0.34);
        this.spawnSprite(coreOrigin, CORE_TEXTURE, profile.shockColor, visualRadius * 0.28, visualRadius * 1.18, 0.12, 0.34, 0.08, THREE.AdditiveBlending, 1.65);
        break;
      case "gravity":
        {
          const crushScale = context.role === "secondary" ? 0.62 : 1;
          this.spawnPressureWave(origin, visualRadius * 1.1 * crushScale, 0x9c71ff, 0.34, impactScale);
          this.spawnArcWeb(origin, visualRadius * 0.96 * crushScale, 0x8d6cff, Math.round(18 * impactScale * crushScale), 0.54);
          this.spawnSprite(coreOrigin, SMOKE_TEXTURE, 0x251a35, visualRadius * 0.5 * crushScale, visualRadius * 1.85 * crushScale, 0.34, 0.78, -0.1, THREE.NormalBlending, 1.18);
          this.spawnSprite(this.offsetOrigin(coreOrigin, 0, 0.16, 0), CORE_TEXTURE, 0xb08aff, visualRadius * 0.16 * crushScale, visualRadius * 1.1 * crushScale, 0.26, 0.24, 0.04, THREE.AdditiveBlending, 0.62);
          this.spawnBurst(this.offsetOrigin(origin, 0, -0.05, 0), Math.round(58 * impactScale * crushScale), 0x2a143d, 1.05, 0.052, 13 * impactScale, -0.35, 0.12, THREE.AdditiveBlending);
        }
        break;
      case "ignite":
        this.spawnPressureWave(origin, visualRadius * 0.95, 0xffb16b, 0.3, impactScale);
        this.spawnSprite(this.offsetOrigin(coreOrigin, 0, 0.18, 0), CORE_TEXTURE, 0xff7a35, visualRadius * 0.28, visualRadius * 2.05, 0.48, 0.58, 0.72, THREE.AdditiveBlending, 0.52);
        this.spawnBurst(coreOrigin, Math.round(66 * impactScale), 0xffd25c, 0.74, 0.033, 20 * impactScale, 0.14, 0.04, THREE.AdditiveBlending);
        this.spawnBurst(this.offsetOrigin(coreOrigin, 0, 0.32, 0), Math.round(44 * impactScale), 0xff5b24, 0.62, 0.07, 8.5 * impactScale, -0.1, 0.2, THREE.AdditiveBlending);
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
    impactScale: number,
    composition: CompositionProfile
  ): void {
    const responseDirection = normalizedImpactDirectionInto(this.responseDirection, context.impactDirection);
    for (const materialId of dominantMaterials(context.result, context.hitMaterialId).slice(0, this.materialResponseBudget(context, composition))) {
      switch (materialId) {
        case "glass":
          this.spawnBurst(this.offsetOrigin(origin, 0, 0.18, 0), Math.round(46 * impactScale), 0xd8fbff, 0.64, 0.024, 22 * impactScale, 0.28, 0.04, THREE.AdditiveBlending);
          this.spawnArcWeb(origin, visualRadius * 0.52, 0xb9fbff, Math.round(8 * impactScale), 0.42);
          if (this.quality !== "performance") {
            this.spawnStreaks(origin, visualRadius * 0.58, 0xecffff, Math.round(6 * impactScale), 0.24);
          }
          break;
        case "metal":
          this.spawnDirectionalStreaks(origin, responseDirection, visualRadius * 0.8, 0xfff0a8, Math.round(10 * impactScale), 0.36, 0.34);
          this.spawnBurst(origin, Math.round(32 * impactScale), 0xffd25c, 0.42, 0.022, 28 * impactScale, 0.5, 0.03, THREE.AdditiveBlending);
          if (this.quality !== "performance") {
            this.spawnDirectionalBurst(this.offsetOrigin(origin, 0, 0.08, 0), responseDirection, Math.round(14 * impactScale), 0xff8f38, 0.34, 0.018, 36 * impactScale, 0.34, 0.022, 0.2, THREE.AdditiveBlending);
          }
          break;
        case "concrete":
          this.spawnBurst(this.offsetOrigin(origin, 0, 0.08, 0), Math.round(58 * impactScale), dustColor, 1.55, 0.09, 5.2 * impactScale, 1.75, 0.34);
          if (this.quality !== "performance") {
            this.spawnBurst(this.offsetOrigin(origin, 0, 0.04, 0), Math.round(24 * impactScale), dustColor, 2.2, 0.13, 3.2 * impactScale, 1.35, 0.56);
          }
          break;
        case "wood":
          this.spawnDirectionalStreaks(origin, responseDirection, visualRadius * 0.62, 0xffb36a, Math.round(9 * impactScale), 0.48, 0.5);
          this.spawnBurst(origin, Math.round(34 * impactScale), 0xc08a4a, 0.9, 0.055, 10 * impactScale, 0.82, 0.16);
          if (this.quality === "cinematic") {
            this.fireLick(this.offsetOrigin(origin, 0, 0.08, 0), 0.28 * impactScale);
          }
          break;
        case "foam":
          this.spawnBurst(origin, Math.round(42 * impactScale), 0xffe8a8, 1.1, 0.075, 9 * impactScale, 0.32, 0.22);
          if (this.quality !== "performance") {
            this.spawnSprite(this.offsetOrigin(origin, 0, 0.22, 0), SMOKE_TEXTURE, 0xfff0c8, visualRadius * 0.16, visualRadius * 0.78, 0.16, 1.35, 0.18, THREE.NormalBlending, 1.2);
          }
          break;
        case "rubber":
          this.spawnBurst(origin, Math.round(30 * impactScale), 0xff6c92, 0.82, 0.06, 11 * impactScale, 0.38, 0.18, THREE.AdditiveBlending);
          if (this.quality !== "performance") {
            this.spawnSprite(this.offsetOrigin(origin, 0, 0.16, 0), SMOKE_TEXTURE, 0x2b2530, visualRadius * 0.2, visualRadius * 0.95, 0.18, 1.5, 0.12, THREE.NormalBlending, 1.35);
          }
          break;
      }
    }

    if (profile.shockBias > 0.5 && composition.materialResponses > 0) {
      this.spawnArcWeb(origin, visualRadius * 0.7, profile.shockColor, Math.round(8 * impactScale * profile.shockBias * composition.materialResponses), 0.42);
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
    const forward = normalizedImpactDirectionInto(this.directionForward, direction);
    const side = this.directionSide.set(-forward.z, 0, forward.x);
    if (side.lengthSq() < 0.0001) {
      side.set(1, 0, 0);
    }
    side.normalize();
    const up = this.directionUp.crossVectors(side, forward).normalize();
    const streak = this.acquireStreak(scaledCount, color, 1);
    const positions = streak.positions;
    for (let i = 0; i < scaledCount; i += 1) {
      const sideJitter = THREE.MathUtils.randFloatSpread(radius * spread);
      const upJitter = THREE.MathUtils.randFloatSpread(radius * spread * 0.72);
      const startForward = THREE.MathUtils.randFloat(0.04, radius * 0.12);
      const endForward = THREE.MathUtils.randFloat(radius * 0.34, radius * 1.16);
      const base = i * 6;
      positions[base] = forward.x * startForward + side.x * sideJitter * 0.16 + up.x * upJitter * 0.16;
      positions[base + 1] = forward.y * startForward + side.y * sideJitter * 0.16 + up.y * upJitter * 0.16;
      positions[base + 2] = forward.z * startForward + side.z * sideJitter * 0.16 + up.z * upJitter * 0.16;
      positions[base + 3] = forward.x * endForward + side.x * sideJitter + up.x * upJitter;
      positions[base + 4] = forward.y * endForward + side.y * sideJitter + up.y * upJitter;
      positions[base + 5] = forward.z * endForward + side.z * sideJitter + up.z * upJitter;
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
    writeDirectionBasis(direction, this.directionForward, this.directionSide, this.directionUp);
    const forward = this.directionForward;
    const side = this.directionSide;
    const up = this.directionUp;
    const burst = this.acquireBurst(scaledCount, size, blending);
    const positions = burst.positions;
    const colors = burst.colors;
    const velocities = burst.velocities;
    const baseColor = this.burstBaseColor.set(color);
    const colorJitter = this.burstColorJitter;

    for (let i = 0; i < scaledCount; i += 1) {
      const sideScale = THREE.MathUtils.randFloatSpread(spread);
      const upScale = THREE.MathUtils.randFloatSpread(spread * 0.72);
      const velocityScale = speed * THREE.MathUtils.randFloat(0.42, 1.08);
      const velocitySide = sideScale * speed;
      const velocityUp = (0.12 + upScale) * speed;
      const base = i * 3;
      velocities[base] = forward.x * velocityScale + side.x * velocitySide + up.x * velocityUp;
      velocities[base + 1] = forward.y * velocityScale + side.y * velocitySide + up.y * velocityUp;
      velocities[base + 2] = forward.z * velocityScale + side.z * velocitySide + up.z * velocityUp;

      const startForward = THREE.MathUtils.randFloat(-0.08, 0.18);
      positions[base] = origin.x + forward.x * startForward + side.x * sideScale * 0.18 + up.x * upScale * 0.12;
      positions[base + 1] = origin.y + forward.y * startForward + side.y * sideScale * 0.18 + up.y * upScale * 0.12;
      positions[base + 2] = origin.z + forward.z * startForward + side.z * sideScale * 0.18 + up.z * upScale * 0.12;

      colorJitter.copy(baseColor).offsetHSL((Math.random() - 0.5) * 0.035, 0, (Math.random() - 0.5) * 0.14);
      colors[base] = colorJitter.r;
      colors[base + 1] = colorJitter.g;
      colors[base + 2] = colorJitter.b;
    }

    this.activateBurst(burst, scaledCount, maxLife, gravity, drag);
    perfMonitor.addCount("vfx.burstsSpawned");
    perfMonitor.addCount("vfx.particlesSpawned", scaledCount);
    this.trimBursts();
  }

  private materialResponseBudget(context: ExplosionFxContext, composition: CompositionProfile): number {
    if (composition.materialResponses <= 0 || (context.projectileId === "gravity" && context.role === "secondary")) {
      return 0;
    }
    const base = this.quality === "performance" ? 1 : this.quality === "balanced" ? 2 : 3;
    return Math.max(1, Math.round(base * composition.materialResponses));
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
    const baseColor = this.burstBaseColor.set(color);
    const colorJitter = this.burstColorJitter;

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
    const burst = poolIndex >= 0 ? takeUnordered(this.burstPool, poolIndex) : this.createBurst(pooledCapacity(count, 32), blending);
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
    addToSceneIfNeeded(this.scene, burst.points);
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
      const sprite = takeUnordered(this.spritePool, poolIndex);
      perfMonitor.addCount("vfx.spritePoolReuse");
      return sprite;
    }
    perfMonitor.addCount("vfx.spritePoolCreate");
    return this.createSprite(textureKind, blending);
  }

  private acquireFlipbookSprite(assetId: FlipbookState["assetId"], blending: THREE.Blending): FxSprite {
    const poolIndex = this.findFlipbookSpritePoolIndex(assetId, blending);
    if (poolIndex >= 0) {
      const sprite = takeUnordered(this.spritePool, poolIndex);
      perfMonitor.addCount("vfx.spritePoolReuse");
      return sprite;
    }
    perfMonitor.addCount("vfx.spritePoolCreate");
    return this.createFlipbookSprite(assetId, blending);
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
      delay: 0,
      fadeIn: 0,
      velocity: new THREE.Vector3(),
      rotationSpeed: 0
    };
  }

  private createFlipbookSprite(assetId: FlipbookState["assetId"], blending: THREE.Blending = THREE.AdditiveBlending): FxSprite {
    const texture = uniqueGraphicTexture(assetId, {
      wrap: THREE.ClampToEdgeWrapping,
      colorSpace: THREE.SRGBColorSpace,
      anisotropy: 2
    });
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.015,
      opacity: 1,
      depthWrite: false,
      blending
    });
    return {
      sprite: new THREE.Sprite(material),
      material,
      textureKind: VFX_FLIPBOOK_TEXTURE_KIND,
      blending,
      flipbook: {
        assetId,
        columns: 1,
        rows: 1,
        frameCount: 1,
        startFrame: 0,
        frameSpan: 1,
        loop: false,
        randomStart: false
      },
      life: 0,
      maxLife: 1,
      maxOpacity: 1,
      startSize: 1,
      endSize: 1,
      aspect: 1,
      rise: 0,
      delay: 0,
      fadeIn: 0,
      velocity: new THREE.Vector3(),
      rotationSpeed: 0
    };
  }

  private findSpritePoolIndex(textureKind: string, blending: THREE.Blending): number {
    return this.spritePool.findIndex((sprite) => !sprite.flipbook && sprite.textureKind === textureKind && sprite.blending === blending);
  }

  private findFlipbookSpritePoolIndex(assetId: FlipbookState["assetId"], blending: THREE.Blending): number {
    return this.spritePool.findIndex((sprite) => sprite.flipbook?.assetId === assetId && sprite.blending === blending);
  }

  private countActiveFlipbookSprites(assetId: FlipbookState["assetId"], blending: THREE.Blending): number {
    return this.sprites.reduce((total, sprite) => total + Number(sprite.flipbook?.assetId === assetId && sprite.blending === blending), 0);
  }

  private countPooledFlipbookSprites(assetId: FlipbookState["assetId"], blending: THREE.Blending): number {
    return this.spritePool.reduce((total, sprite) => total + Number(sprite.flipbook?.assetId === assetId && sprite.blending === blending), 0);
  }

  private retireOldestFlipbookSprite(assetId: FlipbookState["assetId"], blending: THREE.Blending): boolean {
    const index = this.sprites.findIndex((sprite) => sprite.flipbook?.assetId === assetId && sprite.blending === blending);
    if (index < 0) {
      return false;
    }
    this.retireSpriteAt(index);
    perfMonitor.addCount("vfx.flipbookActiveRetired");
    return true;
  }

  private flipbookActiveLimit(assetId: FlipbookState["assetId"], blending: THREE.Blending): number {
    const base = this.quality === "performance" ? 1 : this.quality === "balanced" ? 2 : 3;
    if (assetId === "vfxSmokeAtlas" || blending === THREE.NormalBlending) {
      return base + (this.quality === "cinematic" ? 1 : 0);
    }
    return base;
  }

  private flipbookPoolLimit(assetId: FlipbookState["assetId"], blending: THREE.Blending): number {
    return this.flipbookActiveLimit(assetId, blending) + 1;
  }

  private acquireStreak(count: number, color: THREE.ColorRepresentation, opacity: number): StreakBurst {
    const poolIndex = this.findStreakPoolIndex(count);
    const streak = poolIndex >= 0 ? takeUnordered(this.streakPool, poolIndex) : this.createStreak(pooledCapacity(count, 8));
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
    streak.lines.visible = true;
    streak.lines.frustumCulled = false;
    addToSceneIfNeeded(this.scene, streak.lines);
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
    const burst = takeUnordered(this.bursts, index);
    if (burst) {
      this.releaseBurst(burst);
    }
  }

  private retireSpriteAt(index: number): void {
    const sprite = takeUnordered(this.sprites, index);
    if (sprite) {
      this.releaseSprite(sprite);
    }
  }

  private retireStreakAt(index: number): void {
    const streak = takeUnordered(this.streaks, index);
    if (streak) {
      this.releaseStreak(streak);
    }
  }

  private retirePressureWaveAt(index: number): void {
    const wave = takeUnordered(this.pressureWaves, index);
    if (wave) {
      this.releasePressureWave(wave);
    }
  }

  private releaseBurst(burst: ParticleBurst): void {
    burst.count = 0;
    if (this.burstPool.length < ParticleSystem.maxBurstPool) {
      this.parkBurstForPipeline(burst, false);
      this.burstPool.push(burst);
      return;
    }
    this.disposeBurst(burst);
  }

  private releaseSprite(sprite: FxSprite): void {
    if (sprite.flipbook && this.countPooledFlipbookSprites(sprite.flipbook.assetId, sprite.blending) >= this.flipbookPoolLimit(sprite.flipbook.assetId, sprite.blending)) {
      perfMonitor.addCount("vfx.flipbookPoolOverflowDisposed");
      this.disposeSprite(sprite);
      return;
    }
    if (this.spritePool.length < ParticleSystem.maxSpritePool) {
      this.parkSpriteForPipeline(sprite, false);
      this.spritePool.push(sprite);
      return;
    }
    this.disposeSprite(sprite);
  }

  private releaseStreak(streak: StreakBurst): void {
    streak.count = 0;
    if (this.streakPool.length < ParticleSystem.maxStreakPool) {
      this.parkStreakForPipeline(streak, false);
      this.streakPool.push(streak);
      return;
    }
    this.disposeStreak(streak);
  }

  private releasePressureWave(wave: PressureWave): void {
    if (this.pressureWavePool.length < ParticleSystem.maxPressureWavePool) {
      this.parkPressureWaveForPipeline(wave, false);
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
    if (sprite.flipbook) {
      sprite.material.map?.dispose();
    }
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

  private parkBurstForPipeline(burst: ParticleBurst, visible: boolean): void {
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
    burst.geometry.setDrawRange(0, burst.capacity > 0 ? 1 : 0);
    burst.points.visible = visible;
    burst.points.frustumCulled = false;
    burst.points.position.set(0, VFX_POOL_PARK_Y, 0);
    attachOrDetachPooledObject(this.scene, burst.points, visible);
  }

  private parkSpriteForPipeline(sprite: FxSprite, visible: boolean): void {
    sprite.life = 0;
    sprite.delay = 0;
    sprite.fadeIn = 0;
    sprite.material.opacity = 1;
    sprite.material.rotation = 0;
    if (sprite.flipbook) {
      configureFlipbookMap(sprite.material.map, Math.max(1, sprite.flipbook.columns), Math.max(1, sprite.flipbook.rows), 0);
    }
    sprite.sprite.visible = visible;
    sprite.sprite.frustumCulled = false;
    sprite.sprite.position.set(0, VFX_POOL_PARK_Y, 0);
    sprite.sprite.scale.set(0.05, 0.05, 1);
    attachOrDetachPooledObject(this.scene, sprite.sprite, visible);
  }

  private parkStreakForPipeline(streak: StreakBurst, visible: boolean): void {
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
    streak.geometry.setDrawRange(0, streak.capacity > 0 ? 2 : 0);
    streak.lines.visible = visible;
    streak.lines.frustumCulled = false;
    streak.lines.position.set(0, VFX_POOL_PARK_Y, 0);
    streak.lines.scale.setScalar(1);
    attachOrDetachPooledObject(this.scene, streak.lines, visible);
  }

  private parkPressureWaveForPipeline(wave: PressureWave, visible: boolean): void {
    wave.life = 0;
    wave.material.opacity = 1;
    wave.mesh.visible = visible;
    wave.mesh.frustumCulled = false;
    wave.mesh.position.set(0, VFX_POOL_PARK_Y, 0);
    wave.mesh.scale.set(0.05, 0.05, 1);
    attachOrDetachPooledObject(this.scene, wave.mesh, visible);
  }

  private trimBursts(): void {
    while (this.bursts.length > ParticleSystem.maxBursts) {
      this.retireBurstAt(0);
    }
  }

  private trimSprites(): void {
    while (this.sprites.length > ParticleSystem.maxSprites) {
      this.retireSpriteAt(0);
    }
  }

  private trimStreaks(): void {
    while (this.streaks.length > ParticleSystem.maxStreaks) {
      this.retireStreakAt(0);
    }
  }

  private trimPressureWaves(): void {
    while (this.pressureWaves.length > ParticleSystem.maxPressureWaves) {
      this.retirePressureWaveAt(0);
    }
  }

  private setFlashOverlay(profile: ExplosionProfile, impactScale: number, overlayMax: number): void {
    const core = colorToCss(profile.coreColor, 0.62);
    const shock = colorToCss(profile.shockColor, 0.22);
    this.flashOverlay.style.background = `radial-gradient(circle at center, ${core} 0%, ${core} 12%, ${shock} 34%, transparent 66%)`;
    const opacity = profile.overlayOpacity * THREE.MathUtils.clamp(impactScale, 0.72, 1.48) * this.flashScale;
    this.flashOverlay.style.opacity = String(Math.min(overlayMax, opacity));
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

  private explosionComposition(context: ExplosionFxContext): CompositionProfile {
    const composition: CompositionProfile = {
      fire: 1,
      smoke: 1,
      streaks: 1,
      materialResponses: 0.8,
      overlayMax: 0.58
    };

    if (context.role === "secondary") {
      composition.fire *= 0.72;
      composition.smoke *= 0.68;
      composition.streaks *= 0.92;
      composition.materialResponses *= 0.55;
      composition.overlayMax = 0.42;
    } else if (context.role === "ignition") {
      composition.fire *= 0.86;
      composition.smoke *= 0.72;
      composition.streaks *= 0.78;
      composition.materialResponses *= 0.55;
      composition.overlayMax = 0.46;
    }

    switch (context.projectileId) {
      case "slug":
        composition.fire *= 1.08;
        composition.smoke *= 0.84;
        composition.streaks *= 0.9;
        composition.overlayMax = Math.min(composition.overlayMax, 0.6);
        break;
      case "scatter":
        composition.fire *= 0.68;
        composition.smoke *= 0.54;
        composition.streaks *= 1.26;
        composition.materialResponses *= 0.72;
        composition.overlayMax = Math.min(composition.overlayMax, 0.46);
        break;
      case "pulse":
        composition.fire *= 0.24;
        composition.smoke *= 0.34;
        composition.streaks *= 1.18;
        composition.materialResponses *= 0.42;
        composition.overlayMax = Math.min(composition.overlayMax, 0.36);
        break;
      case "gravity":
        composition.fire *= 0.2;
        composition.smoke *= 0.5;
        composition.streaks *= 1.06;
        composition.materialResponses *= 0.45;
        composition.overlayMax = Math.min(composition.overlayMax, 0.48);
        if (context.role === "secondary") {
          composition.fire = 0.08;
          composition.smoke = 0.16;
          composition.streaks = 0.82;
          composition.materialResponses = 0;
          composition.overlayMax = 0.26;
        }
        break;
      case "ignite":
        composition.fire *= 1.05;
        composition.smoke *= 0.8;
        composition.streaks *= 0.76;
        composition.overlayMax = Math.min(composition.overlayMax, 0.52);
        break;
      case undefined:
        break;
    }

    if (this.quality === "performance" && context.role === "secondary") {
      composition.fire *= 0.7;
      composition.smoke *= 0.65;
      composition.streaks *= 0.75;
      composition.materialResponses *= 0.5;
      composition.overlayMax = Math.min(composition.overlayMax, 0.32);
    }

    return composition;
  }

  private explosionParticleDensity(context: ExplosionFxContext): number {
    const roleDensity = context.role === "secondary" ? 0.72 : context.role === "ignition" ? 0.62 : 1;
    return THREE.MathUtils.clamp(context.densityScale ?? roleDensity, 0.32, 1);
  }

  private qualityDensity(): number {
    switch (this.quality) {
      case "performance":
        return 0.5;
      case "balanced":
        return 0.9;
      case "cinematic":
        return 1.15;
    }
  }

  private offsetOrigin(origin: THREE.Vector3, x: number, y: number, z: number): THREE.Vector3 {
    return this.fxScratchOrigin.set(origin.x + x, origin.y + y, origin.z + z);
  }
}

export class ExplosionSystem {
  constructor(private readonly particles: ParticleSystem) {}

  play(origin: THREE.Vector3, radius: number, dustColors: THREE.Color[], context: ExplosionFxContext = {}): void {
    this.particles.explode(origin, radius, dustColors, context);
  }
}

function normalizedImpactDirectionInto(target: THREE.Vector3, direction?: THREE.Vector3): THREE.Vector3 {
  if (!direction || direction.lengthSq() < 0.0001) {
    return target.set(0, 0.08, -1).normalize();
  }
  return target.copy(direction).normalize();
}

function writeDirectionBasis(direction: THREE.Vector3, forward: THREE.Vector3, side: THREE.Vector3, up: THREE.Vector3): void {
  normalizedImpactDirectionInto(forward, direction);
  side.set(-forward.z, 0, forward.x);
  if (side.lengthSq() < 0.0001) {
    side.set(1, 0, 0);
  }
  side.normalize();
  up.crossVectors(side, forward);
  if (up.y < 0) {
    up.multiplyScalar(-1);
  }
  if (up.lengthSq() < 0.0001) {
    up.set(0, 1, 0);
  } else {
    up.normalize();
  }
}

function updateFlipbookSprite(sprite: FxSprite, normalizedAge: number): void {
  const flipbook = sprite.flipbook;
  if (!flipbook) {
    return;
  }
  const frameSpan = Math.max(1, Math.min(flipbook.frameSpan, flipbook.frameCount - flipbook.startFrame));
  const clampedAge = flipbook.loop ? normalizedAge % 1 : THREE.MathUtils.clamp(normalizedAge, 0, 0.999);
  const startOffset = flipbook.randomStart ? Math.floor((sprite.rotationSpeed + 1.8) * 1000) % frameSpan : 0;
  const localFrame = (Math.floor(clampedAge * frameSpan) + startOffset) % frameSpan;
  const frame = THREE.MathUtils.clamp(flipbook.startFrame + localFrame, 0, flipbook.frameCount - 1);
  configureFlipbookMap(sprite.material.map, flipbook.columns, flipbook.rows, frame);
}

function configureFlipbookMap(texture: THREE.Texture | null, columns: number, rows: number, frame: number): void {
  if (!texture) {
    return;
  }
  const safeColumns = Math.max(1, columns);
  const safeRows = Math.max(1, rows);
  const safeFrame = Math.max(0, frame);
  const tileX = safeFrame % safeColumns;
  const tileY = Math.floor(safeFrame / safeColumns);
  texture.repeat.set(1 / safeColumns, 1 / safeRows);
  texture.offset.set(tileX / safeColumns, 1 - (tileY + 1) / safeRows);
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

function averageColorInto(target: THREE.Color, colors: THREE.Color[], fallback: THREE.Color): THREE.Color {
  if (colors.length === 0) {
    return target.copy(fallback);
  }
  target.setRGB(0, 0, 0);
  for (const entry of colors) {
    target.r += entry.r;
    target.g += entry.g;
    target.b += entry.b;
  }
  target.multiplyScalar(1 / colors.length);
  return target;
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
      return {
        ...profile,
        coreColor: 0xffd86a,
        edgeColor: 0xff6a24,
        shockColor: 0xd8f1ff,
        hotColor: 0xff4f18,
        emberColor: 0xfff0a8,
        smokeColor: 0x303943,
        overlayOpacity: 0.58,
        fireBias: 0.92,
        smokeBias: 0.44,
        streakBias: 0.62,
        shockBias: 0.24
      };
    case "scatter":
      return {
        ...profile,
        coreColor: 0xfff0a8,
        edgeColor: 0xffb637,
        shockColor: 0xffc961,
        hotColor: 0xffd26b,
        emberColor: 0xfff0a8,
        smokeColor: 0x332a1e,
        streakColor: 0xfff0a8,
        overlayOpacity: 0.48,
        streakBias: 1.25,
        fireBias: 0.72,
        smokeBias: 0.26,
        shockBias: 0.26
      };
    case "pulse":
      return {
        ...profile,
        coreColor: 0x9effff,
        edgeColor: 0x42eaff,
        shockColor: 0x61f4ff,
        hotColor: 0x49f2ff,
        emberColor: 0xbaffff,
        smokeColor: 0x22333b,
        overlayOpacity: 0.24,
        fireBias: 0.04,
        smokeBias: 0.02,
        streakBias: 0.24,
        shockBias: 1.05
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
        overlayOpacity: 0.56,
        fireBias: 0.02,
        smokeBias: 0.66,
        streakBias: 0.22,
        shockBias: 0.86
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
        overlayOpacity: 0.5,
        fireBias: 1.05,
        smokeBias: 0.48,
        streakBias: 0.48,
        shockBias: 0.24
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

function projectileBoomScale(projectileId?: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 1.22;
    case "scatter":
      return 1.08;
    case "pulse":
      return 1.18;
    case "gravity":
      return 1.32;
    case "ignite":
      return 1.28;
    case undefined:
      return 1;
  }
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

function addToSceneIfNeeded(scene: THREE.Scene, object: THREE.Object3D): void {
  if (object.parent !== scene) {
    scene.add(object);
  }
}

function attachOrDetachPooledObject(scene: THREE.Scene, object: THREE.Object3D, visible: boolean): void {
  if (visible) {
    addToSceneIfNeeded(scene, object);
    return;
  }
  object.parent?.remove(object);
}

function visibleSceneObjectCount(scene: THREE.Scene, object: THREE.Object3D): number {
  if (!object.visible) {
    return 0;
  }
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current === scene) {
      return 1;
    }
    current = current.parent;
  }
  return 0;
}

function takeUnordered<T>(items: T[], index: number): T {
  const item = items[index];
  const last = items.pop();
  if (index < items.length && last !== undefined) {
    items[index] = last;
  }
  return item;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
