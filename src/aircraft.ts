import * as THREE from "three";

export interface AircraftInputState {
  pitch: number;
  yaw: number;
  boost: boolean;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const BASE_SPEED = 18;
const BOOST_SPEED = 25.5;
const MIN_SPEED = 14;
const MAX_SPEED = 27;
const PITCH_RATE = 1.05;
const YAW_RATE = 1.28;
const AUTO_LEVEL_PITCH = -0.055;
const MIN_PITCH = -0.68;
const MAX_PITCH = 0.46;
const MAX_BANK = 0.62;
const CONTROL_SMOOTHING = 8.5;
const SPEED_SMOOTHING = 4.2;
const BANK_SMOOTHING = 7.8;
const BOUNDS_X = 17.2;
const BOUNDS_MIN_Z = -18.5;
const BOUNDS_MAX_Z = 33.5;
const BOUNDS_SOFT_ZONE = 4.8;
const HIGH_ALTITUDE = 17.5;
const LOW_ALTITUDE_ASSIST = 1.6;

export class AircraftController {
  private readonly object = createAircraftVisual();
  private readonly position = new THREE.Vector3();
  private readonly previousPosition = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly right = new THREE.Vector3(1, 0, 0);
  private readonly visualRight = new THREE.Vector3(1, 0, 0);
  private readonly visualUp = new THREE.Vector3(0, 1, 0);
  private readonly visualBackward = new THREE.Vector3(0, 0, 1);
  private readonly rotationMatrix = new THREE.Matrix4();
  private readonly rollQuaternion = new THREE.Quaternion();

  private yaw = 0;
  private pitch = AUTO_LEVEL_PITCH;
  private roll = 0;
  private speed = BASE_SPEED;
  private smoothedPitchInput = 0;
  private smoothedYawInput = 0;
  private crashed = false;

  reset(startPosition: THREE.Vector3, startDirection: THREE.Vector3): void {
    const direction = startDirection.lengthSq() > 0.0001 ? startDirection.clone().normalize() : new THREE.Vector3(0, -0.05, -1).normalize();
    this.position.copy(startPosition);
    this.previousPosition.copy(startPosition);
    this.velocity.copy(direction).multiplyScalar(BASE_SPEED);
    this.yaw = Math.atan2(direction.x, -direction.z);
    this.pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(direction.y, -0.95, 0.95)), MIN_PITCH, MAX_PITCH);
    this.roll = 0;
    this.speed = BASE_SPEED;
    this.smoothedPitchInput = 0;
    this.smoothedYawInput = 0;
    this.crashed = false;
    setObjectVisible(this.object, true);
    this.updateAxes();
    this.syncObject();
  }

  update(input: AircraftInputState, deltaSeconds: number): void {
    if (this.crashed) {
      return;
    }

    const delta = Math.min(0.05, Math.max(0, deltaSeconds));
    this.previousPosition.copy(this.position);
    const smoothing = 1 - Math.exp(-CONTROL_SMOOTHING * delta);
    this.smoothedPitchInput = THREE.MathUtils.lerp(this.smoothedPitchInput, THREE.MathUtils.clamp(input.pitch, -1, 1), smoothing);
    this.smoothedYawInput = THREE.MathUtils.lerp(this.smoothedYawInput, THREE.MathUtils.clamp(input.yaw, -1, 1), smoothing);

    const boundCorrection = this.boundaryYawCorrection();
    this.yaw += (this.smoothedYawInput * YAW_RATE + boundCorrection) * delta;

    const pitchAssist = this.altitudePitchAssist();
    const targetPitch =
      Math.abs(this.smoothedPitchInput) > 0.04
        ? this.pitch + (this.smoothedPitchInput * PITCH_RATE + pitchAssist) * delta
        : THREE.MathUtils.lerp(this.pitch, AUTO_LEVEL_PITCH + pitchAssist * 0.22, 1 - Math.exp(-2.8 * delta));
    this.pitch = THREE.MathUtils.clamp(targetPitch, MIN_PITCH, MAX_PITCH);

    const targetSpeed = input.boost ? BOOST_SPEED : BASE_SPEED;
    this.speed = THREE.MathUtils.clamp(
      THREE.MathUtils.damp(this.speed, targetSpeed, SPEED_SMOOTHING, delta),
      MIN_SPEED,
      MAX_SPEED
    );
    this.updateAxes();
    this.velocity.copy(this.forward).multiplyScalar(this.speed);
    this.position.addScaledVector(this.velocity, delta);

    const targetRoll = THREE.MathUtils.clamp(this.smoothedYawInput * MAX_BANK + boundCorrection * 0.18, -MAX_BANK, MAX_BANK);
    this.roll = THREE.MathUtils.damp(this.roll, targetRoll, BANK_SMOOTHING, delta);
    this.syncObject();
  }

  markCrashed(): void {
    this.crashed = true;
    setObjectVisible(this.object, false);
  }

  isCrashed(): boolean {
    return this.crashed;
  }

  getPosition(): THREE.Vector3 {
    return this.position.clone();
  }

  getPreviousPosition(): THREE.Vector3 {
    return this.previousPosition.clone();
  }

  getVelocity(): THREE.Vector3 {
    return this.velocity.clone();
  }

  getForward(): THREE.Vector3 {
    return this.forward.clone();
  }

  getUp(): THREE.Vector3 {
    return this.up.clone();
  }

  getObject3D(): THREE.Object3D {
    return this.object;
  }

  setVisible(visible: boolean): void {
    setObjectVisible(this.object, visible);
  }

  dispose(): void {
    disposeObject3D(this.object);
  }

  private updateAxes(): void {
    const cosPitch = Math.cos(this.pitch);
    this.forward.set(Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), -Math.cos(this.yaw) * cosPitch).normalize();
    this.right.copy(this.forward).cross(WORLD_UP);
    if (this.right.lengthSq() < 0.0001) {
      this.right.set(1, 0, 0);
    } else {
      this.right.normalize();
    }
    this.up.copy(this.right).cross(this.forward).normalize();
  }

  private syncObject(): void {
    this.rollQuaternion.setFromAxisAngle(this.forward, this.roll);
    this.visualRight.copy(this.right).applyQuaternion(this.rollQuaternion).normalize();
    this.visualUp.copy(this.up).applyQuaternion(this.rollQuaternion).normalize();
    this.visualBackward.copy(this.forward).multiplyScalar(-1);
    this.rotationMatrix.makeBasis(this.visualRight, this.visualUp, this.visualBackward);
    this.object.position.copy(this.position);
    this.object.quaternion.setFromRotationMatrix(this.rotationMatrix);
  }

  private boundaryYawCorrection(): number {
    const center = new THREE.Vector3(0, THREE.MathUtils.clamp(this.position.y, 2.5, 8), 2.5);
    let influence = 0;
    influence = Math.max(influence, smoothBoundaryInfluence(Math.abs(this.position.x), BOUNDS_X, BOUNDS_SOFT_ZONE));
    influence = Math.max(influence, smoothBoundaryInfluence(this.position.z, BOUNDS_MAX_Z, BOUNDS_SOFT_ZONE));
    influence = Math.max(influence, smoothBoundaryInfluence(-this.position.z, -BOUNDS_MIN_Z, BOUNDS_SOFT_ZONE));
    if (influence <= 0) {
      return 0;
    }
    const toCenter = center.sub(this.position);
    const targetYaw = Math.atan2(toCenter.x, -toCenter.z);
    return shortestAngleDelta(this.yaw, targetYaw) * THREE.MathUtils.clamp(influence * 0.95, 0, 1);
  }

  private altitudePitchAssist(): number {
    if (this.position.y > HIGH_ALTITUDE) {
      return -THREE.MathUtils.clamp((this.position.y - HIGH_ALTITUDE) / 4, 0, 0.75);
    }
    if (this.position.y < LOW_ALTITUDE_ASSIST && this.pitch > -0.22) {
      return THREE.MathUtils.clamp((LOW_ALTITUDE_ASSIST - this.position.y) / LOW_ALTITUDE_ASSIST, 0, 0.42);
    }
    return 0;
  }
}

function setObjectVisible(object: THREE.Object3D, visible: boolean): void {
  object.visible = visible;
  object.traverse((child) => {
    child.visible = visible;
  });
}

function smoothBoundaryInfluence(value: number, limit: number, softZone: number): number {
  return THREE.MathUtils.smoothstep(value, limit - softZone, limit + softZone);
}

function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function createAircraftVisual(): THREE.Group {
  const group = new THREE.Group();
  group.name = "RC crash plane";

  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xdde9ef, roughness: 0.42, metalness: 0.08 });
  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0x39a7ff, roughness: 0.36, metalness: 0.04 });
  const tailMaterial = new THREE.MeshStandardMaterial({ color: 0xffcf5d, roughness: 0.34, metalness: 0.05 });
  const noseMaterial = new THREE.MeshStandardMaterial({ color: 0xff5757, roughness: 0.32, metalness: 0.1 });
  const canopyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e4b65,
    emissive: 0x113850,
    emissiveIntensity: 0.24,
    roughness: 0.22,
    metalness: 0.02
  });

  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 1.34), bodyMaterial);
  fuselage.name = "RC plane fuselage";
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.38, 18), noseMaterial);
  nose.name = "RC plane nose";
  nose.rotation.x = -Math.PI * 0.5;
  nose.position.z = -0.86;
  nose.castShadow = true;

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.28), canopyMaterial);
  canopy.name = "RC plane canopy";
  canopy.position.set(0, 0.22, -0.22);
  canopy.castShadow = true;

  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.075, 0.42), wingMaterial);
  wing.name = "RC plane wing";
  wing.position.z = -0.06;
  wing.castShadow = true;
  wing.receiveShadow = true;

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.06, 0.28), tailMaterial);
  tailWing.name = "RC plane tail wing";
  tailWing.position.set(0, 0.08, 0.58);
  tailWing.castShadow = true;

  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.44, 0.28), tailMaterial);
  tailFin.name = "RC plane tail fin";
  tailFin.position.set(0, 0.26, 0.56);
  tailFin.rotation.x = -0.08;
  tailFin.castShadow = true;

  group.add(fuselage, nose, canopy, wing, tailWing, tailFin);
  group.scale.setScalar(0.92);
  return group;
}

function disposeObject3D(object: THREE.Object3D): void {
  const disposedMaterials = new Set<THREE.Material>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (disposedMaterials.has(material)) {
        continue;
      }
      disposedMaterials.add(material);
      material.dispose();
    }
  });
}
