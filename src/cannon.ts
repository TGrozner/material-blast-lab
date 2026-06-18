import * as THREE from "three";
import type { ProjectileDefinition } from "./projectile";
import { materialAtlasTile } from "./visualAssets";

const LAUNCH_MUZZLE_CLEARANCE = 0.58;

export class Cannon {
  readonly group = new THREE.Group();

  private readonly barrelPivot = new THREE.Group();
  private readonly barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.42, 3.5, 28),
    new THREE.MeshStandardMaterial({
      color: 0x27323d,
      metalness: 0.72,
      roughness: 0.34,
      map: materialAtlasTile(0)
    })
  );
  private readonly glowRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.46, 0.035, 8, 36),
    new THREE.MeshBasicMaterial({ color: 0x8ff7ff, transparent: true, opacity: 0.8 })
  );
  private readonly trajectory: THREE.Line;
  private readonly trajectoryPositions = new Float32Array(48 * 3);
  private readonly basePosition = new THREE.Vector3(0, 6.08, 24.55);

  private yaw = 0;
  private pitch = -0.18;
  private recoil = 0;
  private charge = 0;
  private trajectoryDirty = true;
  private trajectoryKey = "";
  private readonly trajectoryAimPoint = new THREE.Vector3();
  private trajectoryAimPointActive = false;

  constructor(private readonly scene: THREE.Scene) {
    this.group.position.copy(this.basePosition);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(1.04, 1.34, 0.42, 36),
      new THREE.MeshStandardMaterial({ color: 0x1c242d, metalness: 0.45, roughness: 0.52, map: materialAtlasTile(10) })
    );
    base.castShadow = true;
    base.receiveShadow = true;
    base.position.y = -0.19;

    const yoke = new THREE.Mesh(
      new THREE.BoxGeometry(1.78, 0.62, 0.68),
      new THREE.MeshStandardMaterial({ color: 0x2a3440, metalness: 0.55, roughness: 0.44, map: materialAtlasTile(0) })
    );
    yoke.castShadow = true;
    yoke.position.y = 0.42;

    this.barrel.rotation.x = Math.PI * 0.5;
    this.barrel.position.z = -1.18;
    this.barrel.castShadow = true;
    this.barrel.receiveShadow = true;

    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x3a4754, metalness: 0.78, roughness: 0.28, map: materialAtlasTile(10) });
    const muzzle = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.06, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x72ecff })
    );
    muzzle.position.z = -3.08;
    muzzle.rotation.x = Math.PI * 0.5;

    this.glowRing.position.z = -2.0;
    this.glowRing.rotation.x = Math.PI * 0.5;
    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 2.35), accentMaterial);
    leftRail.position.set(-0.34, 0.02, -1.32);
    const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 2.35), accentMaterial);
    rightRail.position.set(0.34, 0.02, -1.32);
    const rearBand = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.028, 8, 32), accentMaterial);
    rearBand.position.z = -0.28;
    const muzzleBand = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.026, 8, 32), accentMaterial);
    muzzleBand.position.z = -2.62;
    this.barrelPivot.add(this.barrel, muzzle, this.glowRing, leftRail, rightRail, rearBand, muzzleBand);
    this.barrelPivot.position.y = 0.62;
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
    this.yaw = THREE.MathUtils.clamp(pointer.x * 0.52, -0.72, 0.72);
    this.pitch = THREE.MathUtils.clamp(-0.18 + pointer.y * 0.24, -0.38, 0.42);
    this.updateTransforms();
    this.trajectoryAimPointActive = false;
    this.trajectoryDirty = true;
  }

  aimAtWorldPoint(point: THREE.Vector3, muzzleSpeed?: number): void {
    const origin = this.getPivotOrigin();
    const direction = point.clone().sub(origin);
    if (direction.lengthSq() < 0.001) {
      return;
    }
    this.yaw = THREE.MathUtils.clamp(Math.atan2(direction.x, -direction.z), -0.72, 0.72);
    this.pitch = THREE.MathUtils.clamp(this.solveBallisticPitch(direction, muzzleSpeed), -0.38, 0.42);
    this.trajectoryAimPoint.copy(point);
    this.trajectoryAimPointActive = true;
    this.updateTransforms();
    this.trajectoryDirty = true;
  }

  update(deltaSeconds: number, projectile: ProjectileDefinition, powerScale: number, sizeScale: number): void {
    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 9, deltaSeconds);
    this.charge = (this.charge + deltaSeconds * 2.2) % 1;
    const material = this.glowRing.material as THREE.MeshBasicMaterial;
    const chargePulse = Math.sin(this.charge * Math.PI * 2);
    const pressure = THREE.MathUtils.clamp(0.76 + powerScale * 0.2 + sizeScale * 0.12, 0.85, 1.35);
    material.color.copy(projectile.color);
    material.opacity = THREE.MathUtils.clamp(0.54 + pressure * 0.22 + chargePulse * 0.16, 0.42, 0.95);
    this.glowRing.scale.setScalar(0.88 + pressure * 0.16 + chargePulse * 0.035);
    const trajectoryMaterial = this.trajectory.material as THREE.LineBasicMaterial;
    trajectoryMaterial.color.copy(projectile.color);
    trajectoryMaterial.opacity = THREE.MathUtils.clamp(0.64 + pressure * 0.1 + chargePulse * 0.08, 0.55, 0.9);
    this.barrel.position.z = -1.18 + this.recoil;
    const barrelPressure = 1 + (powerScale - 1) * 0.045 + (sizeScale - 1) * 0.035;
    this.barrel.scale.set(1 + (sizeScale - 1) * 0.045, barrelPressure, 1);
    const nextTrajectoryKey = `${projectile.id}:${powerScale.toFixed(3)}:${sizeScale.toFixed(3)}`;
    if (this.trajectory.visible && (this.trajectoryDirty || nextTrajectoryKey !== this.trajectoryKey)) {
      this.updateTrajectory(projectile, powerScale, sizeScale);
      this.trajectoryDirty = false;
      this.trajectoryKey = nextTrajectoryKey;
    }
  }

  fireKick(powerScale = 1, sizeScale = 1): void {
    this.recoil = 0.58 + powerScale * 0.18 + sizeScale * 0.1;
    this.charge = 0.72;
  }

  getDirection(): THREE.Vector3 {
    return new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();
  }

  getMuzzlePosition(): THREE.Vector3 {
    return this.getPivotOrigin().add(this.getDirection().multiplyScalar(3.28));
  }

  getLaunchPosition(projectileRadius: number): THREE.Vector3 {
    return this.getMuzzlePosition().add(this.getDirection().multiplyScalar(projectileRadius + LAUNCH_MUZZLE_CLEARANCE));
  }

  getCameraAnchor(): THREE.Vector3 {
    return this.group.position.clone().add(new THREE.Vector3(0, 0.85, 0));
  }

  setBasePosition(position: THREE.Vector3): void {
    this.basePosition.copy(position);
    this.group.position.copy(this.basePosition);
    this.updateTransforms();
    this.trajectoryDirty = true;
  }

  setTrajectoryVisible(visible: boolean): void {
    if (visible && !this.trajectory.visible) {
      this.trajectoryDirty = true;
    }
    this.trajectory.visible = visible;
  }

  private updateTransforms(): void {
    this.group.rotation.y = -this.yaw;
    this.barrelPivot.rotation.x = this.pitch;
  }

  private getPivotOrigin(): THREE.Vector3 {
    return this.group.position.clone().add(new THREE.Vector3(0, 0.62, 0));
  }

  private solveBallisticPitch(directionToTarget: THREE.Vector3, muzzleSpeed?: number): number {
    const horizontalDistance = Math.hypot(directionToTarget.x, directionToTarget.z);
    if (horizontalDistance < 0.001 || !muzzleSpeed || muzzleSpeed <= 0) {
      return Math.atan2(directionToTarget.y, Math.max(0.001, horizontalDistance));
    }

    const gravity = 9.81;
    const speedSq = muzzleSpeed * muzzleSpeed;
    const discriminant = speedSq * speedSq - gravity * (gravity * horizontalDistance * horizontalDistance + 2 * directionToTarget.y * speedSq);
    if (discriminant < 0) {
      return Math.atan2(directionToTarget.y, horizontalDistance) + 0.12;
    }
    const lowArc = Math.atan((speedSq - Math.sqrt(discriminant)) / (gravity * horizontalDistance));
    return lowArc;
  }

  private updateTrajectory(projectile: ProjectileDefinition, powerScale: number, sizeScale: number): void {
    const origin = this.getLaunchPosition(projectile.baseRadius * sizeScale);
    const velocity = this.getDirection().multiplyScalar(projectile.speed * powerScale);
    const gravity = new THREE.Vector3(0, -9.81, 0);
    const endpoint = this.trajectoryAimPointActive ? this.trajectoryAimPoint : null;
    const endpointOffset = endpoint?.clone().sub(origin);
    const endpointHorizontalDistance = endpointOffset ? Math.hypot(endpointOffset.x, endpointOffset.z) : 0;
    const endpointDirectionX = endpointOffset && endpointHorizontalDistance > 0.001 ? endpointOffset.x / endpointHorizontalDistance : 0;
    const endpointDirectionZ = endpointOffset && endpointHorizontalDistance > 0.001 ? endpointOffset.z / endpointHorizontalDistance : 0;
    let impactPoint: THREE.Vector3 | null = null;
    for (let i = 0; i < 48; i += 1) {
      const t = i * 0.105;
      let point: THREE.Vector3;
      if (impactPoint) {
        point = impactPoint;
      } else {
        point = origin
          .clone()
          .add(velocity.clone().multiplyScalar(t))
          .add(gravity.clone().multiplyScalar(0.5 * t * t));
      }
      if (!impactPoint && endpoint && endpointHorizontalDistance > 0.001) {
        const pointOffset = point.clone().sub(origin);
        const horizontalProgress = pointOffset.x * endpointDirectionX + pointOffset.z * endpointDirectionZ;
        if (horizontalProgress >= endpointHorizontalDistance) {
          point.copy(endpoint);
          impactPoint = endpoint.clone();
        }
      }
      if (!impactPoint && point.y <= 0.035) {
        point.y = 0.035;
        impactPoint = point.clone();
      }
      this.trajectoryPositions[i * 3] = point.x;
      this.trajectoryPositions[i * 3 + 1] = Math.max(0.035, point.y);
      this.trajectoryPositions[i * 3 + 2] = point.z;
    }
    this.trajectory.geometry.attributes.position.needsUpdate = true;
  }
}
