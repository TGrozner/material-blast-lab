import * as THREE from "three";
import type { ProjectileDefinition } from "./projectile";

export class Cannon {
  readonly group = new THREE.Group();

  private readonly barrelPivot = new THREE.Group();
  private readonly barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.28, 2.1, 24),
    new THREE.MeshStandardMaterial({
      color: 0x27323d,
      metalness: 0.72,
      roughness: 0.34
    })
  );
  private readonly glowRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.025, 8, 36),
    new THREE.MeshBasicMaterial({ color: 0x8ff7ff })
  );
  private readonly trajectory: THREE.Line;
  private readonly trajectoryPositions = new Float32Array(24 * 3);
  private readonly basePosition = new THREE.Vector3(0, 0.65, 8.15);

  private yaw = 0;
  private pitch = -0.03;
  private recoil = 0;
  private charge = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.group.position.copy(this.basePosition);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.78, 0.98, 0.38, 32),
      new THREE.MeshStandardMaterial({ color: 0x1c242d, metalness: 0.45, roughness: 0.52 })
    );
    base.castShadow = true;
    base.receiveShadow = true;
    base.position.y = -0.19;

    const yoke = new THREE.Mesh(
      new THREE.BoxGeometry(1.35, 0.46, 0.52),
      new THREE.MeshStandardMaterial({ color: 0x2a3440, metalness: 0.55, roughness: 0.44 })
    );
    yoke.castShadow = true;
    yoke.position.y = 0.32;

    this.barrel.rotation.x = Math.PI * 0.5;
    this.barrel.position.z = -0.76;
    this.barrel.castShadow = true;
    this.barrel.receiveShadow = true;

    const muzzle = new THREE.Mesh(
      new THREE.TorusGeometry(0.27, 0.045, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x72ecff })
    );
    muzzle.position.z = -1.85;
    muzzle.rotation.x = Math.PI * 0.5;

    this.glowRing.position.z = -1.15;
    this.glowRing.rotation.x = Math.PI * 0.5;
    this.barrelPivot.add(this.barrel, muzzle, this.glowRing);
    this.barrelPivot.position.y = 0.42;
    this.group.add(base, yoke, this.barrelPivot);
    this.scene.add(this.group);

    const trajectoryGeometry = new THREE.BufferGeometry();
    trajectoryGeometry.setAttribute("position", new THREE.BufferAttribute(this.trajectoryPositions, 3));
    const trajectoryMaterial = new THREE.LineBasicMaterial({
      color: 0x8ff7ff,
      transparent: true,
      opacity: 0.58
    });
    this.trajectory = new THREE.Line(trajectoryGeometry, trajectoryMaterial);
    this.trajectory.frustumCulled = false;
    this.scene.add(this.trajectory);
    this.updateTransforms();
  }

  aim(pointer: THREE.Vector2): void {
    this.yaw = THREE.MathUtils.clamp(pointer.x * 0.42, -0.5, 0.5);
    this.pitch = THREE.MathUtils.clamp(-0.03 + pointer.y * 0.22, -0.2, 0.28);
    this.updateTransforms();
  }

  update(deltaSeconds: number, projectile: ProjectileDefinition, powerScale: number): void {
    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 9, deltaSeconds);
    this.charge = (this.charge + deltaSeconds * 2.2) % 1;
    const material = this.glowRing.material as THREE.MeshBasicMaterial;
    material.color.copy(projectile.color);
    material.opacity = 0.7 + Math.sin(this.charge * Math.PI * 2) * 0.18;
    this.barrel.position.z = -0.76 + this.recoil;
    this.updateTrajectory(projectile, powerScale);
  }

  fireKick(): void {
    this.recoil = 0.42;
  }

  getDirection(): THREE.Vector3 {
    return new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
  }

  getMuzzlePosition(): THREE.Vector3 {
    return this.group.position.clone().add(new THREE.Vector3(0, 0.42, 0)).add(this.getDirection().multiplyScalar(2.05));
  }

  getCameraAnchor(): THREE.Vector3 {
    return this.group.position.clone().add(new THREE.Vector3(0, 0.65, 0));
  }

  setTrajectoryVisible(visible: boolean): void {
    this.trajectory.visible = visible;
  }

  private updateTransforms(): void {
    this.group.rotation.y = this.yaw;
    this.barrelPivot.rotation.x = this.pitch;
  }

  private updateTrajectory(projectile: ProjectileDefinition, powerScale: number): void {
    const origin = this.getMuzzlePosition();
    const velocity = this.getDirection().multiplyScalar(projectile.speed * powerScale);
    const gravity = new THREE.Vector3(0, -9.81, 0);
    for (let i = 0; i < 24; i += 1) {
      const t = i * 0.085;
      const point = origin
        .clone()
        .add(velocity.clone().multiplyScalar(t))
        .add(gravity.clone().multiplyScalar(0.5 * t * t));
      this.trajectoryPositions[i * 3] = point.x;
      this.trajectoryPositions[i * 3 + 1] = Math.max(0.035, point.y);
      this.trajectoryPositions[i * 3 + 2] = point.z;
    }
    this.trajectory.geometry.attributes.position.needsUpdate = true;
  }
}
