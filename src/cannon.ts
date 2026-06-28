import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ProjectileDefinition } from "./projectile";
import { materialAtlasTile } from "./visualAssets";

const LAUNCH_MUZZLE_CLEARANCE = 0.58;
const CANNON_MODEL_PATH = "assets/models/cannon-quaternius/cannon.glb";
const CANNON_MUZZLE_LOCAL_Y = 0.38;
// Matches the static "High siege battery" deck: top y=-0.38, front edge z=-0.5 in cannon-local space.
const CANNON_DECK_TOP_LOCAL_Y = -0.38;
const CANNON_DECK_FRONT_EDGE_LOCAL_Z = -0.5;
// Measured from the scaled and normalized Quaternius Turret Cannon GLB contact ring.
const CANNON_MODEL_CONTACT_MIN_Z = -1.9519;
const CANNON_MODEL_DECK_CONTACT_MARGIN_Z = 0.04;
const CANNON_MODEL_OFFSET_Y = CANNON_DECK_TOP_LOCAL_Y;
const CANNON_MODEL_OFFSET_Z = CANNON_DECK_FRONT_EDGE_LOCAL_Z - CANNON_MODEL_CONTACT_MIN_Z + CANNON_MODEL_DECK_CONTACT_MARGIN_Z;
const CANNON_TURRET_PIVOT_LOCAL_Z = CANNON_MODEL_OFFSET_Z;
const CANNON_MUZZLE_DISTANCE = 1.91;
const CANNON_MODEL_SCALE = new THREE.Vector3(2.4, 1.75, 3.6);
const CANNON_MODEL_FORWARD_ROTATION = Math.PI;
const CANNON_MODEL_MATERIAL_COLORS: Record<string, number> = {
  Black: 0x20252a,
  Grey: 0x626c72,
  LightGrey: 0xa8adb0,
  Orange: 0xb8793f
};

export type CannonVisualState = "loading" | "ready" | "fallback";

export class Cannon {
  readonly group = new THREE.Group();

  private readonly fallbackBaseVisuals = new THREE.Group();
  private readonly fallbackTurretVisuals = new THREE.Group();
  private readonly barrelShell = new THREE.Group();
  private readonly modelBaseMount = new THREE.Group();
  private readonly modelTurretMount = new THREE.Group();
  private readonly turretYawPivot = new THREE.Group();
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
  private readonly trajectory: THREE.Line;
  private readonly trajectoryPositions = new Float32Array(48 * 3);
  private readonly basePosition = new THREE.Vector3(0, 6.08, 24.55);

  private yaw = 0;
  private pitch = -0.18;
  private recoil = 0;
  private charge = 0;
  private trajectoryDirty = true;
  private trajectoryKey = "";
  private modelLoadState: CannonVisualState = "loading";
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
    this.fallbackBaseVisuals.add(base);

    const yoke = new THREE.Mesh(
      new THREE.BoxGeometry(1.78, 0.62, 0.68),
      new THREE.MeshStandardMaterial({ color: 0x2a3440, metalness: 0.55, roughness: 0.44, map: materialAtlasTile(0) })
    );
    yoke.castShadow = true;
    yoke.position.y = 0.42;
    this.fallbackTurretVisuals.add(yoke);

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

    const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 2.35), accentMaterial);
    leftRail.position.set(-0.34, 0.02, -1.32);
    const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 2.35), accentMaterial);
    rightRail.position.set(0.34, 0.02, -1.32);
    const rearBand = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.028, 8, 32), accentMaterial);
    rearBand.position.z = -0.28;
    const muzzleBand = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.026, 8, 32), accentMaterial);
    muzzleBand.position.z = -2.62;
    this.barrelShell.add(this.barrel, muzzle, leftRail, rightRail, rearBand, muzzleBand);
    this.barrelPivot.position.y = CANNON_MUZZLE_LOCAL_Y;
    this.modelBaseMount.position.set(0, CANNON_MODEL_OFFSET_Y, CANNON_MODEL_OFFSET_Z);
    this.modelBaseMount.visible = false;
    this.turretYawPivot.position.z = CANNON_TURRET_PIVOT_LOCAL_Z;
    this.modelTurretMount.position.set(0, CANNON_MODEL_OFFSET_Y, 0);
    this.modelTurretMount.visible = false;
    this.barrelPivot.add(this.barrelShell);
    this.turretYawPivot.add(this.modelTurretMount, this.fallbackTurretVisuals, this.barrelPivot);
    this.group.add(this.modelBaseMount, this.fallbackBaseVisuals, this.turretYawPivot);
    this.scene.add(this.group);
    this.loadCannonModel();

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
    const chargePulse = Math.sin(this.charge * Math.PI * 2);
    const pressure = THREE.MathUtils.clamp(0.76 + powerScale * 0.2 + sizeScale * 0.12, 0.85, 1.35);
    const trajectoryMaterial = this.trajectory.material as THREE.LineBasicMaterial;
    trajectoryMaterial.color.copy(projectile.color);
    trajectoryMaterial.opacity = THREE.MathUtils.clamp(0.64 + pressure * 0.1 + chargePulse * 0.08, 0.55, 0.9);
    this.barrel.position.z = -1.18 + this.recoil;
    this.modelTurretMount.position.z = this.recoil * 0.32;
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
    return this.getPivotOrigin().add(this.getDirection().multiplyScalar(CANNON_MUZZLE_DISTANCE));
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

  getVisualState(): CannonVisualState {
    return this.modelLoadState;
  }

  private updateTransforms(): void {
    this.turretYawPivot.rotation.y = -this.yaw;
    this.barrelPivot.rotation.x = this.pitch;
  }

  private loadCannonModel(): void {
    const loader = new GLTFLoader();
    loader.load(
      assetUrl(CANNON_MODEL_PATH),
      (gltf) => {
        const model = gltf.scene;
        model.name = "Quaternius CC0 turret cannon";
        model.rotation.y = CANNON_MODEL_FORWARD_ROTATION;
        model.scale.copy(CANNON_MODEL_SCALE);
        normalizeModelToDeck(model);
        model.traverse((object) => {
          if (!isMesh(object)) {
            return;
          }
          object.castShadow = true;
          object.receiveShadow = true;
          object.frustumCulled = false;
          applyModelMaterialSettings(object.material);
        });
        const baseNode = model.getObjectByName("Turret_Cannon_Base");
        const topNode = model.getObjectByName("Turret_Cannon_Top");
        if (baseNode && topNode) {
          addNormalizedModelPart(model, baseNode, this.modelBaseMount);
          addNormalizedModelPart(model, topNode, this.modelTurretMount);
        } else {
          this.modelTurretMount.add(model);
        }
        this.modelBaseMount.visible = Boolean(baseNode && topNode);
        this.modelTurretMount.visible = true;
        this.fallbackBaseVisuals.visible = false;
        this.fallbackTurretVisuals.visible = false;
        this.barrelShell.visible = false;
        this.modelLoadState = "ready";
      },
      undefined,
      () => {
        this.modelBaseMount.visible = false;
        this.modelTurretMount.visible = false;
        this.fallbackBaseVisuals.visible = true;
        this.fallbackTurretVisuals.visible = true;
        this.barrelShell.visible = true;
        this.modelLoadState = "fallback";
      }
    );
  }

  private getPivotOrigin(): THREE.Vector3 {
    return this.group.position.clone().add(new THREE.Vector3(0, CANNON_MUZZLE_LOCAL_Y, CANNON_TURRET_PIVOT_LOCAL_Z));
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
    const endpoint = this.trajectoryAimPointActive ? this.trajectoryAimPoint : null;
    const endpointOffsetX = endpoint ? endpoint.x - origin.x : 0;
    const endpointOffsetZ = endpoint ? endpoint.z - origin.z : 0;
    const endpointHorizontalDistance = endpoint ? Math.hypot(endpointOffsetX, endpointOffsetZ) : 0;
    const endpointDirectionX = endpoint && endpointHorizontalDistance > 0.001 ? endpointOffsetX / endpointHorizontalDistance : 0;
    const endpointDirectionZ = endpoint && endpointHorizontalDistance > 0.001 ? endpointOffsetZ / endpointHorizontalDistance : 0;
    let impactPointActive = false;
    let impactX = 0;
    let impactY = 0.035;
    let impactZ = 0;
    for (let i = 0; i < 48; i += 1) {
      const t = i * 0.105;
      let x: number;
      let y: number;
      let z: number;
      if (impactPointActive) {
        x = impactX;
        y = impactY;
        z = impactZ;
      } else {
        x = origin.x + velocity.x * t;
        y = origin.y + velocity.y * t - 4.905 * t * t;
        z = origin.z + velocity.z * t;
      }
      if (!impactPointActive && endpoint && endpointHorizontalDistance > 0.001) {
        const horizontalProgress = (x - origin.x) * endpointDirectionX + (z - origin.z) * endpointDirectionZ;
        if (horizontalProgress >= endpointHorizontalDistance) {
          x = endpoint.x;
          y = endpoint.y;
          z = endpoint.z;
          impactX = x;
          impactY = y;
          impactZ = z;
          impactPointActive = true;
        }
      }
      if (!impactPointActive && y <= 0.035) {
        y = 0.035;
        impactX = x;
        impactY = y;
        impactZ = z;
        impactPointActive = true;
      }
      this.trajectoryPositions[i * 3] = x;
      this.trajectoryPositions[i * 3 + 1] = Math.max(0.035, y);
      this.trajectoryPositions[i * 3 + 2] = z;
    }
    this.trajectory.geometry.attributes.position.needsUpdate = true;
  }
}

function normalizeModelToDeck(model: THREE.Object3D): void {
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  model.position.set(-center.x, -bounds.min.y, -center.z);
}

function addNormalizedModelPart(model: THREE.Object3D, part: THREE.Object3D, target: THREE.Object3D): void {
  model.updateMatrix();
  part.applyMatrix4(model.matrix);
  target.add(part);
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function applyModelMaterialSettings(material: THREE.Material | THREE.Material[]): void {
  const materials = Array.isArray(material) ? material : [material];
  for (const entry of materials) {
    if (entry instanceof THREE.MeshStandardMaterial) {
      const color = CANNON_MODEL_MATERIAL_COLORS[entry.name];
      if (color !== undefined) {
        entry.color.setHex(color);
      }
      entry.roughness = Math.max(entry.roughness, 0.58);
      entry.metalness = Math.min(entry.metalness, 0.22);
      if (entry.map) {
        entry.map.colorSpace = THREE.SRGBColorSpace;
        entry.map.anisotropy = 8;
        entry.map.needsUpdate = true;
      }
    }
  }
}

function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${base}${path}`;
}
