import * as THREE from "three";

type CameraMode = "cannon" | "projectile" | "spectacle";

const SPECTACLE_RADIUS = 14.5;
const SPECTACLE_RADIUS_PORTRAIT = 24;
const SPECTACLE_HEIGHT = 7.4;
const SPECTACLE_HEIGHT_PORTRAIT = 13.2;
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

  constructor(private readonly renderer: THREE.WebGLRenderer) {
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
    this.mode = "spectacle";
    this.desiredTarget.copy(point);
    this.desiredTarget.y = Math.max(1.0, this.desiredTarget.y);
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

  update(deltaSeconds: number): void {
    this.camera.position.sub(this.previousShake);
    this.previousShake.set(0, 0, 0);

    if (this.mode === "spectacle") {
      this.spectacleYaw += deltaSeconds * 0.34;
      const portrait = this.camera.aspect < 0.75;
      const radius = portrait ? SPECTACLE_RADIUS_PORTRAIT : SPECTACLE_RADIUS;
      const height = portrait ? SPECTACLE_HEIGHT_PORTRAIT : SPECTACLE_HEIGHT;
      this.desiredPosition.set(
        this.desiredTarget.x + Math.sin(this.spectacleYaw) * radius,
        this.desiredTarget.y + height,
        this.desiredTarget.z + Math.cos(this.spectacleYaw) * radius
      );
    }

    const stiffness = this.mode === "projectile" ? 7.5 : 4.6;
    this.camera.position.lerp(this.desiredPosition, 1 - Math.exp(-deltaSeconds * stiffness));
    this.currentTarget.lerp(this.desiredTarget, 1 - Math.exp(-deltaSeconds * stiffness));
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
    this.camera.fov = height > width ? 62 : 60;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.pixelRatioCap));
    this.renderer.setSize(width, height);
  }
}
