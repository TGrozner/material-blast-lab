import * as THREE from "three";
import { effectiveGraphicsPixelRatio } from "./settings";

type CameraMode = "cannon" | "projectile" | "spectacle";

interface CameraRenderer {
  setPixelRatio(value?: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
}

const SPECTACLE_RADIUS = 31.5;
const SPECTACLE_RADIUS_PORTRAIT = 35.5;
const SPECTACLE_HEIGHT = 16.2;
const SPECTACLE_HEIGHT_PORTRAIT = 21.2;
const SPECTACLE_ENTRY_YAW = -0.82;
const SPECTACLE_ROTATION_SPEED = 0.14;
const SPECTACLE_PULLBACK_SECONDS = 1.15;
const SPECTACLE_OVERVIEW_TARGET = new THREE.Vector3(0, 2.2, 0.9);
const SPECTACLE_IMPACT_BIAS = 0.12;
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
  private spectaclePullbackTime = 0;
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

  spectacle(point: THREE.Vector3): void {
    const enteringSpectacle = this.mode !== "spectacle";
    this.mode = "spectacle";
    if (enteringSpectacle) {
      this.spectacleYaw = SPECTACLE_ENTRY_YAW;
      this.spectaclePullbackTime = SPECTACLE_PULLBACK_SECONDS;
      this.cinematicCutTime = 0;
      this.cinematicCutDuration = 0;
      this.cinematicCutStrength = 0;
    }
    this.desiredTarget.copy(SPECTACLE_OVERVIEW_TARGET);
    this.desiredTarget.x += THREE.MathUtils.clamp(point.x, -18, 18) * SPECTACLE_IMPACT_BIAS;
    this.desiredTarget.z += THREE.MathUtils.clamp(point.z, -18, 18) * SPECTACLE_IMPACT_BIAS;
    this.desiredTarget.y += THREE.MathUtils.clamp(point.y - 1.2, -1, 4) * 0.08;
  }

  cinematicImpact(point: THREE.Vector3, intensity = 1, _direction?: THREE.Vector3): void {
    this.spectacle(point);
    const clampedIntensity = THREE.MathUtils.clamp(intensity, 0.45, 2.2);
    this.spectaclePullbackTime = Math.max(this.spectaclePullbackTime, SPECTACLE_PULLBACK_SECONDS + clampedIntensity * 0.08);
    this.cinematicCutTime = 0;
    this.cinematicCutDuration = 0;
    this.cinematicCutStrength = 0;
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
    this.spectaclePullbackTime = 0;
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
    this.spectaclePullbackTime = 0;
    this.camera.position.copy(this.desiredPosition);
    this.currentTarget.copy(this.desiredTarget);
    this.camera.lookAt(this.currentTarget);
  }

  update(deltaSeconds: number): void {
    this.camera.position.sub(this.previousShake);
    this.previousShake.set(0, 0, 0);

    if (this.mode === "spectacle") {
      this.spectacleYaw += deltaSeconds * SPECTACLE_ROTATION_SPEED;
      this.spectaclePullbackTime = Math.max(0, this.spectaclePullbackTime - deltaSeconds);
      const pullingBack = this.spectaclePullbackTime > 0;
      this.currentTarget.lerp(this.desiredTarget, 1 - Math.exp(-deltaSeconds * (pullingBack ? 1.9 : 0.75)));
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
        this.camera.position.lerp(this.desiredPosition, 1 - Math.exp(-deltaSeconds * (pullingBack ? 3.35 : 1.2)));
      }
    } else {
      const stiffness = this.mode === "projectile" ? 7.5 : 4.6;
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
