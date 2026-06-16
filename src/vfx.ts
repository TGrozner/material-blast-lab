import * as THREE from "three";
import { decalAtlasTile } from "./visualAssets";

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

interface Shockwave {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxRadius: number;
}

interface Splatter {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

export class ParticleSystem {
  private static readonly maxBursts = 12;
  private static readonly maxSplatters = 26;

  private readonly bursts: ParticleBurst[] = [];
  private readonly shockwaves: Shockwave[] = [];
  private readonly splatters: Splatter[] = [];
  private readonly flashLight: THREE.PointLight;
  private readonly flashOverlay: HTMLDivElement;
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

  explode(origin: THREE.Vector3, radius: number, dustColors: THREE.Color[]): void {
    this.flashLight.position.copy(origin);
    this.flashLight.intensity = 42 * this.flashScale;
    this.flashOverlay.style.opacity = String(0.42 * this.flashScale);

    this.spawnShockwave(origin, radius);
    this.spawnBurst(origin, 95, 0xffc65a, 0.95, 0.045, 16, 0.9, 0.05, THREE.AdditiveBlending);
    this.spawnBurst(origin, 70, 0x68efff, 0.65, 0.04, 10, 1.1, 0.12, THREE.AdditiveBlending);
    this.spawnBurst(origin, 85, averageColor(dustColors, new THREE.Color(0xa49f94)), 1.25, 0.07, 3.5, 1.7, 0.35);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.45, 0)), 48, 0x6b6f76, 1.8, 0.11, 2.4, 2.3, 0.5);
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
    this.spawnBurst(origin, 68, color, 0.46, 0.065, 13, 0.45, 0.04, THREE.AdditiveBlending);
    this.spawnBurst(origin, 42, 0x707780, 0.9, 0.09, 5.5, 0.7, 0.24);
  }

  bioSplash(origin: THREE.Vector3, intensity = 1, color: THREE.ColorRepresentation = 0xd61f68): void {
    const count = Math.round(80 * intensity);
    this.spawnBurst(origin, count, color, 1.65, 0.085, 7.5 * intensity, 1.5, 0.32);
    this.spawnBurst(origin.clone().add(new THREE.Vector3(0, 0.18, 0)), Math.round(35 * intensity), 0xff7fb3, 0.85, 0.045, 5, 0.7, 0.16, THREE.AdditiveBlending);
    for (let i = 0; i < Math.round(4 + intensity * 5); i += 1) {
      const offset = new THREE.Vector3((Math.random() - 0.5) * 2.4 * intensity, 0.022, (Math.random() - 0.5) * 2.4 * intensity);
      this.spawnSplatter(origin.clone().add(offset), color, THREE.MathUtils.randFloat(0.28, 0.82) * intensity);
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
        burst.points.geometry.dispose();
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

    for (let i = this.shockwaves.length - 1; i >= 0; i -= 1) {
      const shockwave = this.shockwaves[i];
      shockwave.life += deltaSeconds;
      const t = shockwave.life / shockwave.maxLife;
      if (t >= 1) {
        this.scene.remove(shockwave.mesh);
        shockwave.mesh.geometry.dispose();
        (shockwave.mesh.material as THREE.Material).dispose();
        this.shockwaves.splice(i, 1);
        continue;
      }
      const radius = THREE.MathUtils.lerp(0.2, shockwave.maxRadius, easeOutCubic(t));
      shockwave.mesh.scale.setScalar(radius);
      const material = shockwave.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = (1 - t) * 0.32;
    }

    for (let i = this.splatters.length - 1; i >= 0; i -= 1) {
      const splatter = this.splatters[i];
      splatter.life += deltaSeconds;
      const t = splatter.life / splatter.maxLife;
      if (t >= 1) {
        this.scene.remove(splatter.mesh);
        splatter.mesh.geometry.dispose();
        (splatter.mesh.material as THREE.Material).dispose();
        this.splatters.splice(i, 1);
        continue;
      }
      const material = splatter.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 0.58 * (1 - Math.max(0, t - 0.55) / 0.45);
    }

    this.flashLight.intensity = THREE.MathUtils.damp(this.flashLight.intensity, 0, 9, deltaSeconds);
    const overlayOpacity = Number(this.flashOverlay.style.opacity || "0");
    this.flashOverlay.style.opacity = String(THREE.MathUtils.damp(overlayOpacity, 0, 12, deltaSeconds));
  }

  dispose(): void {
    this.flashOverlay.remove();
  }

  private spawnShockwave(origin: THREE.Vector3, radius: number): void {
    const geometry = new THREE.SphereGeometry(1, 48, 24);
    const material = new THREE.MeshBasicMaterial({
      color: 0x9ff4ff,
      transparent: true,
      opacity: 0.32,
      wireframe: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(origin);
    mesh.renderOrder = 3;
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, life: 0, maxLife: 0.55, maxRadius: radius });
  }

  private spawnSplatter(origin: THREE.Vector3, color: THREE.ColorRepresentation, radius: number): void {
    const geometry = new THREE.CircleGeometry(1, 18);
    const material = new THREE.MeshBasicMaterial({
      color,
      map: decalAtlasTile(11),
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      alphaTest: 0.03
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(origin);
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.scale.set(radius * THREE.MathUtils.randFloat(0.65, 1.25), radius * THREE.MathUtils.randFloat(0.35, 0.8), 1);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.splatters.push({ mesh, life: 0, maxLife: 8 });
    this.trimSplatters();
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
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const baseColor = new THREE.Color(color);

    for (let i = 0; i < count; i += 1) {
      const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.15, Math.random() - 0.5).normalize();
      const velocity = direction.multiplyScalar(speed * (0.3 + Math.random() * 0.85));
      velocity.add(new THREE.Vector3((Math.random() - 0.5) * speed * 0.18, Math.random() * speed * 0.15, (Math.random() - 0.5) * speed * 0.18));
      velocities[i * 3] = velocity.x;
      velocities[i * 3 + 1] = velocity.y;
      velocities[i * 3 + 2] = velocity.z;

      positions[i * 3] = origin.x + (Math.random() - 0.5) * 0.24;
      positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.24;
      positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.24;

      const colorJitter = baseColor.clone().offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.16);
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
      burst.points.geometry.dispose();
      burst.material.dispose();
    }
  }

  private trimSplatters(): void {
    while (this.splatters.length > ParticleSystem.maxSplatters) {
      const splatter = this.splatters.shift();
      if (!splatter) {
        return;
      }
      this.scene.remove(splatter.mesh);
      splatter.mesh.geometry.dispose();
      (splatter.mesh.material as THREE.Material).dispose();
    }
  }
}

export class ExplosionSystem {
  constructor(private readonly particles: ParticleSystem) {}

  play(origin: THREE.Vector3, radius: number, dustColors: THREE.Color[]): void {
    this.particles.explode(origin, radius, dustColors);
  }
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

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}
