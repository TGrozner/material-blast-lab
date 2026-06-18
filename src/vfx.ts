import * as THREE from "three";
import type { ExplosionResult } from "./destruction";
import type { MaterialId } from "./materialCatalog";
import type { ProjectileId } from "./projectile";
import type { GraphicsQuality } from "./settings";

interface ParticleBurst {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  positions: Float32Array;
  velocities: Float32Array;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
}

interface FxSprite {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
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

export class ParticleSystem {
  private static readonly maxBursts = 24;
  private static readonly maxSprites = 48;
  private static readonly maxStreaks = 14;
  private static readonly maxPressureWaves = 8;

  private readonly bursts: ParticleBurst[] = [];
  private readonly sprites: FxSprite[] = [];
  private readonly streaks: StreakBurst[] = [];
  private readonly pressureWaves: PressureWave[] = [];
  private readonly flashLight: THREE.PointLight;
  private readonly flashOverlay: HTMLDivElement;
  private quality: GraphicsQuality = "balanced";
  private flashScale = 1;

  constructor(private readonly scene: THREE.Scene) {
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

  explode(origin: THREE.Vector3, radius: number, dustColors: THREE.Color[], context: ExplosionFxContext = {}): void {
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
        this.scene.remove(burst.points);
        disposeGeometry(burst.points.geometry);
        burst.material.dispose();
        this.bursts.splice(i, 1);
        continue;
      }

      const damping = Math.max(0, 1 - burst.drag * deltaSeconds);
      for (let p = 0; p < burst.velocities.length; p += 3) {
        burst.velocities[p + 1] -= burst.gravity * deltaSeconds;
        burst.velocities[p] *= damping;
        burst.velocities[p + 1] *= damping;
        burst.velocities[p + 2] *= damping;
        burst.positions[p] += burst.velocities[p] * deltaSeconds;
        burst.positions[p + 1] += burst.velocities[p + 1] * deltaSeconds;
        burst.positions[p + 2] += burst.velocities[p + 2] * deltaSeconds;
      }
      burst.points.geometry.attributes.position.needsUpdate = true;
      burst.material.opacity = (1 - t) ** 1.25;
    }

    for (let i = this.sprites.length - 1; i >= 0; i -= 1) {
      const sprite = this.sprites[i];
      sprite.life += deltaSeconds;
      const t = sprite.life / sprite.maxLife;
      if (t >= 1) {
        this.scene.remove(sprite.sprite);
        sprite.material.dispose();
        this.sprites.splice(i, 1);
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
        this.scene.remove(streak.lines);
        disposeGeometry(streak.lines.geometry);
        streak.material.dispose();
        this.streaks.splice(i, 1);
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
        this.scene.remove(wave.mesh);
        wave.material.dispose();
        this.pressureWaves.splice(i, 1);
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
    const material = new THREE.SpriteMaterial({
      map: radialTexture(textureKind),
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(origin);
    sprite.scale.set(startSize, startSize, 1);
    sprite.renderOrder = blending === THREE.AdditiveBlending ? 8 : 5;
    this.scene.add(sprite);
    this.sprites.push({
      sprite,
      material,
      life: 0,
      maxLife,
      maxOpacity: opacity,
      startSize,
      endSize,
      aspect,
      rise,
      velocity: velocity?.clone() ?? new THREE.Vector3(),
      rotationSpeed: THREE.MathUtils.randFloat(-1.8, 1.8)
    });
    this.trimSprites();
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
    const material = new THREE.MeshBasicMaterial({
      color,
      map: radialTexture(SHOCK_TEXTURE),
      transparent: true,
      opacity: opacity * THREE.MathUtils.clamp(intensity, 0.55, 1.35),
      depthWrite: false,
      alphaTest: 0.035,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(SHARED_PLANE_GEOMETRY, material);
    mesh.position.set(origin.x, Math.max(0.035, origin.y + 0.025), origin.z);
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.scale.set(radius * 0.16, radius * 0.16, 1);
    mesh.renderOrder = 4;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.pressureWaves.push({
      mesh,
      material,
      life: 0,
      maxLife: THREE.MathUtils.lerp(0.24, 0.44, THREE.MathUtils.clamp(intensity, 0, 1)),
      startRadius: radius * 0.16,
      endRadius: radius * THREE.MathUtils.randFloat(1.15, 1.65),
      maxOpacity: material.opacity
    });
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
    const positions = new Float32Array(count * 6);
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
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.position.copy(origin);
    lines.frustumCulled = false;
    lines.renderOrder = 7;
    this.scene.add(lines);
    this.streaks.push({ lines, material, life: 0, maxLife, expansion: THREE.MathUtils.randFloat(0.18, 0.45) });
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
    const positions = new Float32Array(scaledCount * 6);
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
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.position.copy(origin);
    lines.frustumCulled = false;
    lines.renderOrder = 7;
    this.scene.add(lines);
    this.streaks.push({ lines, material, life: 0, maxLife, expansion: THREE.MathUtils.randFloat(0.08, 0.28) });
    this.trimStreaks();
  }

  private spawnArcWeb(origin: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, count: number, maxLife: number): void {
    if (count <= 0) {
      return;
    }
    const scaledCount = Math.max(1, Math.round(count * this.qualityDensity()));
    const positions = new Float32Array(scaledCount * 6);
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
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.position.copy(origin);
    lines.frustumCulled = false;
    lines.renderOrder = 7;
    this.scene.add(lines);
    this.streaks.push({ lines, material, life: 0, maxLife, expansion: THREE.MathUtils.randFloat(0.12, 0.32) });
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
    const positions = new Float32Array(scaledCount * 3);
    const colors = new Float32Array(scaledCount * 3);
    const velocities = new Float32Array(scaledCount * 3);
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

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({ points, material, positions, velocities, life: 0, maxLife, gravity, drag });
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
    const positions = new Float32Array(scaledCount * 3);
    const colors = new Float32Array(scaledCount * 3);
    const velocities = new Float32Array(scaledCount * 3);
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

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending
    });

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.scene.add(points);
    this.bursts.push({ points, material, positions, velocities, life: 0, maxLife, gravity, drag });
    this.trimBursts();
  }

  private trimBursts(): void {
    while (this.bursts.length > ParticleSystem.maxBursts) {
      const burst = this.bursts.shift();
      if (!burst) {
        return;
      }
      this.scene.remove(burst.points);
      disposeGeometry(burst.points.geometry);
      burst.material.dispose();
    }
  }

  private trimSprites(): void {
    while (this.sprites.length > ParticleSystem.maxSprites) {
      const sprite = this.sprites.shift();
      if (!sprite) {
        return;
      }
      this.scene.remove(sprite.sprite);
      sprite.material.dispose();
    }
  }

  private trimStreaks(): void {
    while (this.streaks.length > ParticleSystem.maxStreaks) {
      const streak = this.streaks.shift();
      if (!streak) {
        return;
      }
      this.scene.remove(streak.lines);
      disposeGeometry(streak.lines.geometry);
      streak.material.dispose();
    }
  }

  private trimPressureWaves(): void {
    while (this.pressureWaves.length > ParticleSystem.maxPressureWaves) {
      const wave = this.pressureWaves.shift();
      if (!wave) {
        return;
      }
      this.scene.remove(wave.mesh);
      wave.material.dispose();
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
      this.scene.remove(burst.points);
      disposeGeometry(burst.points.geometry);
      burst.material.dispose();
    }
    for (const sprite of this.sprites) {
      this.scene.remove(sprite.sprite);
      sprite.material.dispose();
    }
    for (const streak of this.streaks) {
      this.scene.remove(streak.lines);
      disposeGeometry(streak.lines.geometry);
      streak.material.dispose();
    }
    for (const wave of this.pressureWaves) {
      this.scene.remove(wave.mesh);
      wave.material.dispose();
    }
    this.bursts.length = 0;
    this.sprites.length = 0;
    this.streaks.length = 0;
    this.pressureWaves.length = 0;
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
