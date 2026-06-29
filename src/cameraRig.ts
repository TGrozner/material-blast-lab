import * as THREE from "three";
import { effectiveGraphicsPixelRatio } from "./settings";

type CameraMode = "cannon" | "projectile" | "aircraft" | "spectacle";

interface CameraRenderer {
  setPixelRatio(value?: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
}

const SPECTACLE_RADIUS = 16.2;
const SPECTACLE_RADIUS_PORTRAIT = 31;
const SPECTACLE_HEIGHT = 8.2;
const SPECTACLE_HEIGHT_PORTRAIT = 17.5;
const DEFAULT_CANNON_ANCHOR = new THREE.Vector3(0, 6.9, 24.55);
const DEFAULT_CITY_TARGET = new THREE.Vector3(0, 0.9, -2.6);

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;

  private readonly desiredPosition = new THREE.Vector3(0, 4, 13);
  private readonly desiredTarget = new THREE.Vector3(0, 1.4, 0);
  private readonly currentTarget = new THREE.Vector3(0, 1.4, 0);
  private readonly previousShake = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private mode: CameraMode = "cannon";
  private spectacleYaw = 0;
  private shakeTime = 0;
  private shakeDuration = 0;
  private shakeMagnitude = 0;
  private shakeScale = 1;
  private pixelRatioCap = 1.5;
  private cinematicCutTime = 0;
  private cinematicCutDuration = 0;
  private cinematicCutStrength = 0;
  private readonly cinematicCutPosition = new THREE.Vector3();
  private readonly cinematicCutTarget = new THREE.Vector3();

  constructor(private readonly renderer: CameraRenderer) {
    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 180);
    this.camera.position.copy(this.desiredPosition);
    this.camera.lookAt(this.desiredTarget);
  }

  setCityAimView(cannonAnchor = DEFAULT_CANNON_ANCHOR, target = DEFAULT_CITY_TARGET): void {
    this.mode = "cannon";
    const portrait = window.innerHeight > window.innerWidth;
    const backDistance = portrait ? 16.8 : 15.2;
    const shoulderHeight = portrait ? 8.9 : 8.2;
    const sideOffset = portrait ? -1.6 : -3.6;
    this.desiredTarget.copy(target);
    this.desiredPosition.set(cannonAnchor.x + sideOffset, cannonAnchor.y + shoulderHeight, cannonAnchor.z + backDistance);
  }

  setCannonView(muzzle: THREE.Vector3, direction: THREE.Vector3): void {
    this.mode = "cannon";
    const back = direction.clone().multiplyScalar(-5.2);
    const target = muzzle.clone().add(direction.clone().multiplyScalar(8));
    target.y += 0.45;
    this.desiredTarget.copy(target);
    this.desiredPosition.copy(muzzle).add(back).add(this.up.clone().multiplyScalar(2.4));
  }

  followProjectile(position: THREE.Vector3, velocity: THREE.Vector3): void {
    this.mode = "projectile";
    const speedDirection = velocity.lengthSq() > 0.01 ? velocity.clone().normalize() : new THREE.Vector3(0, 0, -1);
    this.desiredTarget.copy(position).add(speedDirection.clone().multiplyScalar(2.1));
    this.desiredPosition.copy(position).add(speedDirection.multiplyScalar(-5.6)).add(this.up.clone().multiplyScalar(2.35));
  }

  followAircraft(position: THREE.Vector3, forward: THREE.Vector3, up: THREE.Vector3): void {
    this.mode = "aircraft";
    const speedDirection = forward.lengthSq() > 0.01 ? forward.clone().normalize() : new THREE.Vector3(0, 0, -1);
    const stableUp = up.lengthSq() > 0.01 ? up.clone().normalize().lerp(this.up, 0.78).normalize() : this.up.clone();
    const portrait = this.camera.aspect < 0.75;
    const trailingDistance = portrait ? 8.8 : 7.1;
    const lift = portrait ? 3.75 : 2.85;
    const lookAhead = portrait ? 5.2 : 4.35;
    this.desiredTarget.copy(position).add(speedDirection.clone().multiplyScalar(lookAhead)).add(this.up.clone().multiplyScalar(0.42));
    this.desiredPosition
      .copy(position)
      .add(speedDirection.clone().multiplyScalar(-trailingDistance))
      .add(stableUp.multiplyScalar(lift))
      .add(this.up.clone().multiplyScalar(0.55));
  }

  spectacle(point: THREE.Vector3): void {
    this.mode = "spectacle";
    this.desiredTarget.copy(point);
    this.desiredTarget.y = Math.max(1.0, this.desiredTarget.y);
  }

  cinematicImpact(point: THREE.Vector3, intensity = 1, direction?: THREE.Vector3): void {
    this.spectacle(point);
    const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.45, 2.2);
    const impactDirection = direction && direction.lengthSq() > 0.001
      ? direction.clone().normalize()
      : new THREE.Vector3(Math.sin(this.spectacleYaw + 0.8), -0.18, Math.cos(this.spectacleYaw + 0.8)).normalize();
    const side = new THREE.Vector3(-impactDirection.z, 0, impactDirection.x);
    if (side.lengthSq() < 0.001) {
      side.set(1, 0, 0);
    }
    side.normalize();
    const portrait = this.camera.aspect < 0.75;
    const trailingDistance = portrait ? 10.8 : THREE.MathUtils.lerp(8.4, 6.2, Math.min(1, clampedIntensity * 0.45));
    const sideDistance = portrait ? 4.6 : THREE.MathUtils.lerp(3.8, 2.2, Math.min(1, clampedIntensity * 0.42));
    const lift = portrait ? 7.6 : THREE.MathUtils.lerp(4.9, 3.3, Math.min(1, clampedIntensity * 0.38));
    this.cinematicCutTarget.copy(point);
    this.cinematicCutTarget.y = Math.max(1.05, Math.min(4.4, point.y + 0.58 + clampedIntensity * 0.28));
    this.cinematicCutPosition
      .copy(this.cinematicCutTarget)
      .add(impactDirection.multiplyScalar(-trailingDistance))
      .add(side.multiplyScalar(sideDistance))
      .add(this.up.clone().multiplyScalar(lift));
    this.cinematicCutDuration = THREE.MathUtils.lerp(0.64, 1.16, Math.min(1, clampedIntensity * 0.55));
    this.cinematicCutTime = this.cinematicCutDuration;
    this.cinematicCutStrength = clampedIntensity;
  }

  setFocus(point: THREE.Vector3): void {
    this.spectacle(point);
  }

  setShakeScale(scale: number): void {
    this.shakeScale = THREE.MathUtils.clamp(scale, 0, 1);
    if (this.shakeScale === 0) {
      this.shakeTime = 0;
      this.shakeDuration = 0;
      this.shakeMagnitude = 0;
    }
  }

  setPixelRatioCap(cap: number): void {
    this.pixelRatioCap = Math.max(0.75, cap);
  }

  shake(magnitude: number, duration = 0.7): void {
    if (this.shakeScale <= 0) {
      return;
    }
    this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude * this.shakeScale);
    this.shakeDuration = Math.max(this.shakeDuration, duration);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  resetTransientMotion(): void {
    this.camera.position.sub(this.previousShake);
    this.previousShake.set(0, 0, 0);
    this.spectacleYaw = 0;
    this.cinematicCutTime = 0;
    this.cinematicCutDuration = 0;
    this.cinematicCutStrength = 0;
    this.shakeTime = 0;
    this.shakeDuration = 0;
    this.shakeMagnitude = 0;
  }

  snapToDesiredView(): void {
    this.camera.position.sub(this.previousShake);
    this.previousShake.set(0, 0, 0);
    this.shakeTime = 0;
    this.shakeDuration = 0;
    this.shakeMagnitude = 0;
    this.cinematicCutTime = 0;
    this.cinematicCutDuration = 0;
    this.cinematicCutStrength = 0;
    this.camera.position.copy(this.desiredPosition);
    this.currentTarget.copy(this.desiredTarget);
    this.camera.lookAt(this.currentTarget);
  }

  update(deltaSeconds: number): void {
    this.camera.position.sub(this.previousShake);
    this.previousShake.set(0, 0, 0);

    if (this.mode === "spectacle") {
      this.spectacleYaw += deltaSeconds * 0.34;
      this.currentTarget.lerp(this.desiredTarget, 1 - Math.exp(-deltaSeconds * 2.2));
      const portrait = this.camera.aspect < 0.75;
      const radius = portrait ? SPECTACLE_RADIUS_PORTRAIT : SPECTACLE_RADIUS;
      const height = portrait ? SPECTACLE_HEIGHT_PORTRAIT : SPECTACLE_HEIGHT;
      this.desiredPosition.set(
        this.currentTarget.x + Math.sin(this.spectacleYaw) * radius,
        this.currentTarget.y + height,
        this.currentTarget.z + Math.cos(this.spectacleYaw) * radius
      );
      if (this.cinematicCutTime > 0 && this.cinematicCutDuration > 0) {
        this.cinematicCutTime = Math.max(0, this.cinematicCutTime - deltaSeconds);
        const hold = this.cinematicCutTime / this.cinematicCutDuration;
        const cutBlend = THREE.MathUtils.smoothstep(hold, 0, 1) * THREE.MathUtils.clamp(this.cinematicCutStrength, 0.55, 1.8);
        this.currentTarget.lerp(this.cinematicCutTarget, 1 - Math.exp(-deltaSeconds * 6.8));
        this.camera.position.lerp(this.cinematicCutPosition, 1 - Math.exp(-deltaSeconds * (6.8 + cutBlend * 1.6)));
      } else {
        this.camera.position.lerp(this.desiredPosition, 1 - Math.exp(-deltaSeconds * 2.15));
      }
    } else {
      const stiffness = this.mode === "projectile" ? 7.5 : this.mode === "aircraft" ? 5.9 : 4.6;
      this.camera.position.lerp(this.desiredPosition, 1 - Math.exp(-deltaSeconds * stiffness));
      this.currentTarget.lerp(this.desiredTarget, 1 - Math.exp(-deltaSeconds * stiffness));
    }
    this.camera.lookAt(this.currentTarget);

    if (this.shakeTime > 0 && this.shakeDuration > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - deltaSeconds);
      const t = this.shakeTime / this.shakeDuration;
      const amount = this.shakeMagnitude * t * t;
      this.previousShake.set(
        (Math.random() - 0.5) * amount,
        (Math.random() - 0.5) * amount * 0.65,
        (Math.random() - 0.5) * amount
      );
      this.camera.position.add(this.previousShake);
      if (this.shakeTime === 0) {
        this.shakeMagnitude = 0;
        this.shakeDuration = 0;
      }
    }
  }

  resize(width: number, height: number): void {
    this.camera.fov = height > width ? 70 : 62;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(effectiveGraphicsPixelRatio(this.pixelRatioCap));
    this.renderer.setSize(width, height);
  }
}
