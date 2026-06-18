import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { MaterialDefinition, MaterialId } from "./materialCatalog";
import { perfMonitor } from "./perf";

const MAX_ACTIVE_DEBRIS = 260;
const SETTLED_ACTIVE_DEBRIS_TARGET = 150;
const MAX_FROZEN_RUBBLE = 720;
const RUBBLE_FREEZE_INTERVAL_SECONDS = 0.18;
const SETTLED_RUBBLE_MIN_AGE_MS = 680;
const FORCED_RUBBLE_MIN_AGE_MS = 280;
const MAX_RUBBLE_FREEZE_CENTER_Y = 0.78;
const MAX_PHYSICS_SUBSTEPS_PER_FRAME = 2;
const FROZEN_RUBBLE_BUCKET_CAPACITY = 512;
const STATIC_DETAIL_BUCKET_CAPACITY = 1024;
const STAGED_VISUAL_ACTIVATIONS_PER_FRAME = 32;
const STAGED_VISUAL_ACTIVATION_MAX_MS = 0.7;
const TRAFFIC_AVOIDANCE_PADDING = 0.38;
const TRAFFIC_AVOIDANCE_MIN_DISTANCE = 1.05;

export type PhysicsCategory = "structure" | "projectile" | "debris";
export type ScoreRole = "target" | "neutral";
export type PhysicsBodyType = "dynamic" | "fixed";
export type PhysicsShape = "box" | "sphere";
export type TrafficAxis = "x" | "z";

export interface TrafficWaypoint {
  x: number;
  z: number;
}

export interface TrafficRoute {
  axis: TrafficAxis;
  min: number;
  max: number;
  speed: number;
  direction: -1 | 1;
  laneOffset?: number;
  waypoints?: TrafficWaypoint[];
  segmentIndex?: number;
}

export interface PhysicsCollisionEvent {
  first: PhysicsObject;
  second: PhysicsObject;
  started: boolean;
}

export interface PhysicsSurfaceCollisionEvent {
  object: PhysicsObject;
  surfaceLabel: string;
  started: boolean;
  impactVelocity: THREE.Vector3;
}

export interface FrozenVisualHandle {
  dispose(): void;
}

export interface DynamicVisualProxy {
  setVisible(visible: boolean): void;
  sync(position: THREE.Vector3, rotation: THREE.Quaternion): void;
  freeze(position: THREE.Vector3, rotation: THREE.Quaternion): FrozenVisualHandle | null;
  dispose(): void;
}

export interface PhysicsObject {
  id: number;
  label: string;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Mesh;
  materialId: MaterialId;
  dimensions: THREE.Vector3;
  destructible: boolean;
  canFracture: boolean;
  fractureResistance: number;
  isDebris: boolean;
  createdAt: number;
  category: PhysicsCategory;
  scoreValue: number;
  scoreRole: ScoreRole;
  zoneId?: string;
  supportGroupId?: string;
  supportReleaseRadius?: number;
  supportReleaseHeight?: number;
  supportReleaseFallDirection?: THREE.Vector3;
  supportReleaseImpulseScale?: number;
  supportReleaseTorqueScale?: number;
  supportReleaseMassScale?: number;
  radius: number;
  bodyType: PhysicsBodyType;
  chainSource: boolean;
  shape: PhysicsShape;
  trafficRoute?: TrafficRoute;
  colliderHandles: number[];
  releaseMesh?: MeshReleaseCallback;
  visualProxy?: DynamicVisualProxy;
}

type MeshReleaseCallback = (mesh: THREE.Mesh) => void;

interface MotionSample {
  x: number;
  y: number;
  z: number;
}

interface TrafficAdvancePlan {
  object: PhysicsObject;
  route: TrafficRoute;
  proposedRoute: TrafficRoute;
  current: THREE.Vector3;
  proposed: THREE.Vector3;
  priority: number;
  blocked: boolean;
}

interface FrozenRubblePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  renderOrder: number;
  castShadow: boolean;
  receiveShadow: boolean;
}

interface FrozenRubbleRecord {
  mesh?: THREE.Mesh;
  releaseMesh?: MeshReleaseCallback;
  visual?: FrozenVisualHandle;
  instances: FrozenRubbleInstance[];
}

interface FrozenRubbleInstance {
  bucket: FrozenRubbleBucket;
  index: number;
}

interface FrozenRubbleRef {
  record: FrozenRubbleRecord;
  instanceIndex: number;
}

interface FrozenRubbleBucket {
  key: string;
  mesh: THREE.InstancedMesh;
  capacity: number;
  count: number;
  refs: Array<FrozenRubbleRef | undefined>;
}

interface StaticDetailRecord {
  objectId: number;
  children: THREE.Mesh[];
  instances: StaticDetailInstance[];
}

interface StaticDetailInstance {
  bucket: StaticDetailBucket;
  index: number;
}

interface StaticDetailRef {
  record: StaticDetailRecord;
  instanceIndex: number;
}

interface StaticDetailBucket {
  key: string;
  mesh: THREE.InstancedMesh;
  capacity: number;
  count: number;
  refs: Array<StaticDetailRef | undefined>;
}

interface CompoundBoxColliderOptions {
  size: THREE.Vector3;
  offset: THREE.Vector3;
  rotation?: THREE.Quaternion;
  density?: number;
  friction?: number;
  restitution?: number;
  collisionEvents?: boolean;
}

interface DynamicBoxOptions {
  label?: string;
  material: MaterialDefinition;
  renderMaterial: THREE.Material;
  renderMesh?: THREE.Mesh;
  releaseMesh?: MeshReleaseCallback;
  visualProxy?: DynamicVisualProxy;
  position: THREE.Vector3;
  size: THREE.Vector3;
  rotation?: THREE.Quaternion;
  compoundColliders?: CompoundBoxColliderOptions[];
  destructible?: boolean;
  canFracture?: boolean;
  fractureResistance?: number;
  isDebris?: boolean;
  linearVelocity?: THREE.Vector3;
  angularVelocity?: THREE.Vector3;
  category?: PhysicsCategory;
  scoreValue?: number;
  scoreRole?: ScoreRole;
  zoneId?: string;
  supportGroupId?: string;
  supportReleaseRadius?: number;
  supportReleaseHeight?: number;
  supportReleaseFallDirection?: THREE.Vector3;
  supportReleaseImpulseScale?: number;
  supportReleaseTorqueScale?: number;
  supportReleaseMassScale?: number;
  chainSource?: boolean;
  density?: number;
  friction?: number;
  restitution?: number;
  sleeping?: boolean;
  linearDamping?: number;
  angularDamping?: number;
  additionalMass?: number;
  ccd?: boolean;
  bodyType?: PhysicsBodyType;
  trafficRoute?: TrafficRoute;
  collisionEvents?: boolean;
  stageVisualActivation?: boolean;
}

interface StaticBoxOptions {
  label: string;
  position: THREE.Vector3;
  size: THREE.Vector3;
  material: THREE.Material;
  visible?: boolean;
}

interface DynamicSphereOptions {
  label?: string;
  material: MaterialDefinition;
  renderMaterial: THREE.Material;
  position: THREE.Vector3;
  radius: number;
  destructible?: boolean;
  canFracture?: boolean;
  fractureResistance?: number;
  isDebris?: boolean;
  linearVelocity?: THREE.Vector3;
  angularVelocity?: THREE.Vector3;
  category?: PhysicsCategory;
  scoreValue?: number;
  scoreRole?: ScoreRole;
  zoneId?: string;
  chainSource?: boolean;
  density?: number;
  friction?: number;
  restitution?: number;
  segments?: number;
  sleeping?: boolean;
  linearDamping?: number;
  angularDamping?: number;
  additionalMass?: number;
  ccd?: boolean;
  collisionEvents?: boolean;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly objects = new Map<number, PhysicsObject>();
  readonly staticMeshes: THREE.Mesh[] = [];
  readonly fixedTimestep = 1 / 60;

  private accumulator = 0;
  private nextId = 1;
  private readonly scene: THREE.Scene;
  private readonly debrisQueue: number[] = [];
  private debrisQueueHead = 0;
  private readonly maxDebris = MAX_ACTIVE_DEBRIS;
  private readonly settledDebrisTarget = SETTLED_ACTIVE_DEBRIS_TARGET;
  private readonly maxFrozenDebris = MAX_FROZEN_RUBBLE;
  private readonly frozenDebrisRecords: FrozenRubbleRecord[] = [];
  private readonly frozenRubbleBuckets = new Map<string, FrozenRubbleBucket[]>();
  private readonly frozenRubbleWarmupBuckets = new Set<FrozenRubbleBucket>();
  private readonly frozenRubbleScratchMatrix = new THREE.Matrix4();
  private readonly staticDetailRecords = new Map<number, StaticDetailRecord>();
  private readonly staticDetailBuckets = new Map<string, StaticDetailBucket[]>();
  private readonly staticDetailScratchMatrix = new THREE.Matrix4();
  private readonly stagedVisualActivationQueue: number[] = [];
  private stagedVisualActivationQueueHead = 0;
  private rubbleFreezeElapsed = 0;
  private readonly eventQueue = new RAPIER.EventQueue(true);
  private readonly colliderOwners = new Map<number, number>();
  private readonly trafficObjectIds = new Set<number>();
  private readonly trafficWaitTicks = new Map<number, number>();
  private readonly preStepVelocities = new Map<number, MotionSample>();
  private readonly surfaceColliderLabels = new Map<number, string>();
  private readonly releasedSupportGroups = new Set<string>();
  private readonly pendingCollisionEvents: Array<{ firstId: number; secondId: number; started: boolean }> = [];
  private pendingCollisionEventHead = 0;
  private readonly pendingSurfaceCollisionEvents: Array<{
    objectId: number;
    surfaceLabel: string;
    started: boolean;
    impactVelocity: MotionSample;
  }> = [];
  private pendingSurfaceCollisionEventHead = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.dt = this.fixedTimestep;
  }

  step(deltaSeconds: number): void {
    this.compactPendingEventQueues();
    this.accumulator += Math.min(deltaSeconds, 0.12);
    let substeps = 0;
    while (this.accumulator >= this.fixedTimestep && substeps < MAX_PHYSICS_SUBSTEPS_PER_FRAME) {
      let startedAt = perfMonitor.timeStart();
      this.capturePreStepVelocities();
      perfMonitor.addTiming("physics.capturePreStepVelocities", startedAt);
      startedAt = perfMonitor.timeStart();
      this.world.step(this.eventQueue);
      perfMonitor.addTiming("physics.rapierStep", startedAt);
      startedAt = perfMonitor.timeStart();
      this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        if (!started) {
          return;
        }
        const firstId = this.colliderOwners.get(handle1);
        const secondId = this.colliderOwners.get(handle2);
        if (firstId !== undefined && secondId !== undefined) {
          this.pendingCollisionEvents.push({ firstId, secondId, started });
          return;
        }
        const objectId = firstId ?? secondId;
        const surfaceHandle = firstId === undefined ? handle1 : handle2;
        const surfaceLabel = this.surfaceColliderLabels.get(surfaceHandle);
        if (objectId !== undefined && surfaceLabel) {
          this.pendingSurfaceCollisionEvents.push({
            objectId,
            surfaceLabel,
            started,
            impactVelocity: this.preStepVelocities.get(objectId) ?? {
              x: 0,
              y: 0,
              z: 0
            }
          });
        }
      });
      perfMonitor.addTiming("physics.drainRapierEvents", startedAt);
      this.accumulator -= this.fixedTimestep;
      substeps += 1;
    }
    if (this.accumulator >= this.fixedTimestep) {
      perfMonitor.addCount("physics.substepsDropped", Math.floor(this.accumulator / this.fixedTimestep));
      this.accumulator = Math.min(this.accumulator, this.fixedTimestep);
    }
    perfMonitor.addCount("physics.substeps", substeps);
    perfMonitor.addCount("collision.pendingBacklog", this.pendingCollisionEvents.length - this.pendingCollisionEventHead);
    perfMonitor.addCount("collision.surfacePendingBacklog", this.pendingSurfaceCollisionEvents.length - this.pendingSurfaceCollisionEventHead);
    this.syncMeshes();
    this.rubbleFreezeElapsed += deltaSeconds;
    if (this.rubbleFreezeElapsed >= RUBBLE_FREEZE_INTERVAL_SECONDS) {
      this.rubbleFreezeElapsed = 0;
      this.freezeSettledDebris();
    }
  }

  addStaticBox(options: StaticBoxOptions): THREE.Mesh {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
      options.position.x,
      options.position.y,
      options.position.z
    );
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      options.size.x * 0.5,
      options.size.y * 0.5,
      options.size.z * 0.5
    ).setFriction(0.95);
    const collider = this.world.createCollider(colliderDesc, body);
    this.surfaceColliderLabels.set(collider.handle, options.label);

    const mesh = new THREE.Mesh(sharedBoxGeometry(), options.material);
    mesh.name = options.label;
    mesh.position.copy(options.position);
    mesh.scale.copy(options.size);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.visible = options.visible ?? true;
    this.scene.add(mesh);
    this.staticMeshes.push(mesh);
    return mesh;
  }

  addDynamicBox(options: DynamicBoxOptions): PhysicsObject {
    const startedAt = perfMonitor.timeStart();
    const rotation = options.rotation ?? new THREE.Quaternion();
    const bodyType = options.bodyType ?? "dynamic";
    const bodyDesc = (bodyType === "fixed" ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(options.position.x, options.position.y, options.position.z)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });

    if (bodyType === "dynamic") {
      bodyDesc
        .setCanSleep(true)
        .setSleeping(options.sleeping ?? false)
        .setLinearDamping(options.linearDamping ?? 0)
        .setAngularDamping(options.angularDamping ?? 0)
        .setCcdEnabled(options.ccd ?? false);
    }

    if (bodyType === "dynamic" && options.additionalMass !== undefined) {
      bodyDesc.setAdditionalMass(options.additionalMass);
    }

    if (bodyType === "dynamic" && options.linearVelocity) {
      bodyDesc.setLinvel(options.linearVelocity.x, options.linearVelocity.y, options.linearVelocity.z);
    }
    if (bodyType === "dynamic" && options.angularVelocity) {
      bodyDesc.setAngvel({ x: options.angularVelocity.x, y: options.angularVelocity.y, z: options.angularVelocity.z });
    }

    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(
      options.size.x * 0.5,
      options.size.y * 0.5,
      options.size.z * 0.5
    )
      .setDensity(options.density ?? options.material.density)
      .setFriction(options.friction ?? options.material.friction)
      .setRestitution(options.restitution ?? options.material.restitution);
    const collisionEventsEnabled = shouldEnableBoxCollisionEvents(options, bodyType);
    if (collisionEventsEnabled) {
      colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    }
    const collider = this.world.createCollider(colliderDesc, body);
    const colliderHandles = [collider.handle];

    for (const compound of options.compoundColliders ?? []) {
      const compoundDesc = RAPIER.ColliderDesc.cuboid(
        compound.size.x * 0.5,
        compound.size.y * 0.5,
        compound.size.z * 0.5
      )
        .setTranslation(compound.offset.x, compound.offset.y, compound.offset.z)
        .setDensity(compound.density ?? options.density ?? options.material.density)
        .setFriction(compound.friction ?? options.friction ?? options.material.friction)
        .setRestitution(compound.restitution ?? options.restitution ?? options.material.restitution);
      if (compound.rotation) {
        compoundDesc.setRotation({
          x: compound.rotation.x,
          y: compound.rotation.y,
          z: compound.rotation.z,
          w: compound.rotation.w
        });
      }
      if (compound.collisionEvents ?? collisionEventsEnabled) {
        compoundDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      }
      const compoundCollider = this.world.createCollider(compoundDesc, body);
      colliderHandles.push(compoundCollider.handle);
    }

    const mesh = options.renderMesh ?? new THREE.Mesh(sharedBoxGeometry(), options.renderMaterial);
    mesh.material = options.renderMaterial;
    mesh.name = options.label ?? options.material.name;
    mesh.castShadow = !options.isDebris;
    mesh.receiveShadow = true;
    mesh.position.copy(options.position);
    mesh.quaternion.copy(rotation);
    mesh.scale.copy(options.size);
    mesh.traverse((child) => {
      child.matrixAutoUpdate = true;
    });
    mesh.userData.physicsId = this.nextId;
    delete mesh.userData.frozenDebris;
    if (options.stageVisualActivation) {
      mesh.visible = false;
      options.visualProxy?.setVisible(false);
    } else {
      mesh.visible = true;
      options.visualProxy?.setVisible(true);
    }
    if (!options.visualProxy) {
      this.scene.add(mesh);
    }

    const object: PhysicsObject = {
      id: this.nextId,
      label: mesh.name,
      body,
      collider,
      mesh,
      materialId: options.material.id,
      dimensions: options.size.clone(),
      destructible: options.destructible ?? true,
      canFracture: options.canFracture ?? true,
      fractureResistance: Math.max(0.1, options.fractureResistance ?? 1),
      isDebris: options.isDebris ?? false,
      createdAt: performance.now(),
      category: options.category ?? (options.isDebris ? "debris" : "structure"),
      scoreValue: options.scoreValue ?? scoreValueForSize(options.size),
      scoreRole: options.scoreRole ?? defaultScoreRole(options.category, options.isDebris),
      zoneId: options.zoneId,
      supportGroupId: options.supportGroupId,
      supportReleaseRadius: options.supportReleaseRadius,
      supportReleaseHeight: options.supportReleaseHeight,
      supportReleaseFallDirection: options.supportReleaseFallDirection?.clone(),
      supportReleaseImpulseScale: options.supportReleaseImpulseScale,
      supportReleaseTorqueScale: options.supportReleaseTorqueScale,
      supportReleaseMassScale: options.supportReleaseMassScale,
      radius: options.size.length() * 0.5,
      bodyType,
      chainSource: options.chainSource ?? false,
      shape: "box",
      trafficRoute: options.trafficRoute ? { ...options.trafficRoute } : undefined,
      colliderHandles,
      releaseMesh: options.releaseMesh,
      visualProxy: options.visualProxy
    };

    this.objects.set(object.id, object);
    for (const handle of object.colliderHandles) {
      this.colliderOwners.set(handle, object.id);
    }
    if (object.trafficRoute) {
      this.trafficObjectIds.add(object.id);
    }
    if (object.isDebris) {
      this.debrisQueue.push(object.id);
      this.enforceDebrisCap();
    }
    if (options.stageVisualActivation) {
      this.stagedVisualActivationQueue.push(object.id);
      perfMonitor.addCount("render.stagedVisualActivationsQueued");
    }
    this.nextId += 1;
    perfMonitor.addCount("physics.dynamicBoxesAdded");
    if (object.isDebris) {
      perfMonitor.addCount("physics.debrisAdded");
    }
    perfMonitor.addTiming("physics.addDynamicBox", startedAt);
    return object;
  }

  addDynamicSphere(options: DynamicSphereOptions): PhysicsObject {
    const startedAt = perfMonitor.timeStart();
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(options.position.x, options.position.y, options.position.z)
      .setCanSleep(true)
      .setSleeping(options.sleeping ?? false)
      .setLinearDamping(options.linearDamping ?? 0)
      .setAngularDamping(options.angularDamping ?? 0)
      .setCcdEnabled(options.ccd ?? false);

    if (options.additionalMass !== undefined) {
      bodyDesc.setAdditionalMass(options.additionalMass);
    }

    if (options.linearVelocity) {
      bodyDesc.setLinvel(options.linearVelocity.x, options.linearVelocity.y, options.linearVelocity.z);
    }
    if (options.angularVelocity) {
      bodyDesc.setAngvel({ x: options.angularVelocity.x, y: options.angularVelocity.y, z: options.angularVelocity.z });
    }

    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.ball(options.radius)
      .setDensity(options.density ?? options.material.density)
      .setFriction(options.friction ?? options.material.friction)
      .setRestitution(options.restitution ?? options.material.restitution);
    if (shouldEnableSphereCollisionEvents(options)) {
      colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    }
    const collider = this.world.createCollider(colliderDesc, body);

    const mesh = new THREE.Mesh(
      sharedSphereGeometry(options.segments ?? 24),
      options.renderMaterial
    );
    mesh.name = options.label ?? options.material.name;
    mesh.castShadow = !options.isDebris;
    mesh.receiveShadow = true;
    mesh.position.copy(options.position);
    mesh.scale.setScalar(options.radius);
    mesh.userData.physicsId = this.nextId;
    this.scene.add(mesh);

    const dimensions = new THREE.Vector3(options.radius * 2, options.radius * 2, options.radius * 2);
    const object: PhysicsObject = {
      id: this.nextId,
      label: mesh.name,
      body,
      collider,
      mesh,
      materialId: options.material.id,
      dimensions,
      destructible: options.destructible ?? true,
      canFracture: options.canFracture ?? true,
      fractureResistance: Math.max(0.1, options.fractureResistance ?? 1),
      isDebris: options.isDebris ?? false,
      createdAt: performance.now(),
      category: options.category ?? (options.isDebris ? "debris" : "structure"),
      scoreValue: options.scoreValue ?? scoreValueForSize(dimensions),
      scoreRole: options.scoreRole ?? defaultScoreRole(options.category, options.isDebris),
      zoneId: options.zoneId,
      radius: options.radius,
      bodyType: "dynamic",
      chainSource: options.chainSource ?? false,
      shape: "sphere",
      colliderHandles: [collider.handle]
    };

    this.objects.set(object.id, object);
    this.colliderOwners.set(collider.handle, object.id);
    if (object.isDebris) {
      this.debrisQueue.push(object.id);
      this.enforceDebrisCap();
    }
    this.nextId += 1;
    perfMonitor.addCount("physics.dynamicSpheresAdded");
    if (object.isDebris) {
      perfMonitor.addCount("physics.debrisAdded");
    }
    perfMonitor.addTiming("physics.addDynamicSphere", startedAt);
    return object;
  }

  getDynamicObjects(): PhysicsObject[] {
    return Array.from(this.objects.values());
  }

  getDynamicBodyCount(): number {
    return this.objects.size;
  }

  batchStaticDetails(): void {
    const startedAt = perfMonitor.timeStart();
    let batchedObjects = 0;
    let batchedParts = 0;
    for (const object of this.objects.values()) {
      if (object.bodyType !== "fixed" || object.isDebris || object.category === "projectile" || this.staticDetailRecords.has(object.id)) {
        continue;
      }
      const record = this.createStaticDetailRecord(object);
      if (!record) {
        continue;
      }
      this.staticDetailRecords.set(object.id, record);
      batchedObjects += 1;
      batchedParts += record.instances.length;
    }
    if (batchedObjects > 0) {
      this.finalizeStaticDetailBuckets();
      perfMonitor.addCount("physics.staticDetailBatchedObjects", batchedObjects);
      perfMonitor.addCount("physics.staticDetailBatchedParts", batchedParts);
      perfMonitor.addTiming("physics.batchStaticDetails", startedAt);
    }
  }

  createSphereGeometryWarmupObjects(segments: readonly number[], material: THREE.Material): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const segmentCount of new Set(segments)) {
      const mesh = new THREE.Mesh(sharedSphereGeometry(segmentCount), material);
      mesh.name = `runtime sphere geometry warmup ${segmentCount}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.scale.setScalar(0.16);
      objects.push(mesh);
    }
    return objects;
  }

  createBoxGeometryWarmupObjects(materials: readonly THREE.Material[]): THREE.Mesh[] {
    const objects: THREE.Mesh[] = [];
    const uniqueMaterials = new Set(materials);
    let index = 0;
    for (const material of uniqueMaterials) {
      const mesh = new THREE.Mesh(sharedBoxGeometry(), material);
      mesh.name = `runtime box geometry warmup ${index}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.scale.set(0.42, 0.34, 0.38);
      objects.push(mesh);
      index += 1;
    }
    return objects;
  }

  createStaticDetailWarmupObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const buckets of this.staticDetailBuckets.values()) {
      const bucket = buckets[0];
      if (!bucket) {
        continue;
      }
      const mesh = new THREE.Mesh(bucket.mesh.geometry, bucket.mesh.material);
      mesh.name = `static detail warmup ${bucket.key}`;
      mesh.castShadow = bucket.mesh.castShadow;
      mesh.receiveShadow = bucket.mesh.receiveShadow;
      mesh.renderOrder = bucket.mesh.renderOrder;
      mesh.frustumCulled = false;
      objects.push(mesh);
    }
    return objects;
  }

  createSupportReleaseWarmupObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const object of this.objects.values()) {
      if (!object.supportGroupId) {
        continue;
      }
      const clone = object.mesh.clone(true);
      clone.name = `${object.label} support release warmup`;
      clone.visible = true;
      clone.matrixAutoUpdate = true;
      clone.traverse((child) => {
        child.visible = true;
        child.frustumCulled = false;
        child.matrixAutoUpdate = true;
        delete child.userData.physicsId;
      });
      objects.push(clone);
    }
    return objects;
  }

  createFrozenRubbleWarmupObjects(sources: readonly THREE.Mesh[]): THREE.Object3D[] {
    const objects = new Set<THREE.Object3D>();
    for (const source of sources) {
      source.updateMatrixWorld(true);
      const parts = collectFrozenRubbleParts(source);
      if (!parts) {
        continue;
      }
      for (const part of parts) {
        const bucket = this.getFrozenRubbleBucket(part);
        if (bucket.count > 0) {
          objects.add(bucket.mesh);
          continue;
        }
        const warmupMatrix = part.matrix.clone();
        warmupMatrix.setPosition(0, -10000, 0);
        bucket.mesh.setMatrixAt(0, warmupMatrix);
        bucket.refs[0] = undefined;
        bucket.count = 1;
        bucket.mesh.count = 1;
        bucket.mesh.visible = true;
        bucket.mesh.instanceMatrix.needsUpdate = true;
        this.frozenRubbleWarmupBuckets.add(bucket);
        objects.add(bucket.mesh);
      }
    }
    return [...objects];
  }

  clearFrozenRubbleWarmupObjects(): void {
    for (const bucket of this.frozenRubbleWarmupBuckets) {
      if (bucket.count === 1 && bucket.refs[0] === undefined) {
        bucket.count = 0;
        bucket.mesh.count = 0;
        bucket.mesh.visible = false;
        bucket.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.frozenRubbleWarmupBuckets.clear();
  }

  getBlastCandidates(origin: THREE.Vector3, radius: number): PhysicsObject[] {
    return this.collectObjectsInAabb(origin, radius, (object) => object.category !== "projectile" && object.zoneId !== "surface");
  }

  getSegmentCandidates(previous: THREE.Vector3, current: THREE.Vector3, padding: number): PhysicsObject[] {
    const center = new THREE.Vector3(
      (previous.x + current.x) * 0.5,
      (previous.y + current.y) * 0.5,
      (previous.z + current.z) * 0.5
    );
    const halfExtents = new THREE.Vector3(
      Math.abs(current.x - previous.x) * 0.5 + padding,
      Math.abs(current.y - previous.y) * 0.5 + padding,
      Math.abs(current.z - previous.z) * 0.5 + padding
    );
    return this.collectObjectsInAabb(center, halfExtents, () => true);
  }

  getObject(id: number): PhysicsObject | undefined {
    return this.objects.get(id);
  }

  drainCollisionEvents(maxEvents = Number.POSITIVE_INFINITY): PhysicsCollisionEvent[] {
    const events: PhysicsCollisionEvent[] = [];
    if (maxEvents <= 0) {
      return events;
    }
    while (this.pendingCollisionEventHead < this.pendingCollisionEvents.length && events.length < maxEvents) {
      const event = this.pendingCollisionEvents[this.pendingCollisionEventHead];
      this.pendingCollisionEventHead += 1;
      const first = this.objects.get(event.firstId);
      const second = this.objects.get(event.secondId);
      if (first && second) {
        events.push({ first, second, started: event.started });
      }
    }
    this.compactPendingCollisionEvents();
    return events;
  }

  drainSurfaceCollisionEvents(maxEvents = Number.POSITIVE_INFINITY): PhysicsSurfaceCollisionEvent[] {
    const events: PhysicsSurfaceCollisionEvent[] = [];
    if (maxEvents <= 0) {
      return events;
    }
    while (this.pendingSurfaceCollisionEventHead < this.pendingSurfaceCollisionEvents.length && events.length < maxEvents) {
      const event = this.pendingSurfaceCollisionEvents[this.pendingSurfaceCollisionEventHead];
      this.pendingSurfaceCollisionEventHead += 1;
      const object = this.objects.get(event.objectId);
      if (object) {
        events.push({
          object,
          surfaceLabel: event.surfaceLabel,
          started: event.started,
          impactVelocity: new THREE.Vector3(event.impactVelocity.x, event.impactVelocity.y, event.impactVelocity.z)
        });
      }
    }
    this.compactPendingSurfaceCollisionEvents();
    return events;
  }

  advanceTrafficRoutes(deltaSeconds: number): void {
    if (deltaSeconds <= 0) {
      return;
    }
    const plans: TrafficAdvancePlan[] = [];
    for (const id of this.trafficObjectIds) {
      const object = this.objects.get(id);
      const route = object?.trafficRoute;
      if (!object || !route || object.bodyType !== "dynamic" || object.isDebris || object.category === "projectile") {
        continue;
      }

      const current = vectorFromRapier(object.body.translation());
      const proposed = current.clone();
      const proposedRoute = cloneTrafficRoute(route);
      if (route.waypoints && route.waypoints.length > 1) {
        advanceWaypointTraffic(proposed, proposedRoute, deltaSeconds);
        plans.push(this.createTrafficPlan(object, route, proposedRoute, current, proposed));
        continue;
      }

      const min = Math.min(proposedRoute.min, proposedRoute.max);
      const max = Math.max(proposedRoute.min, proposedRoute.max);
      setTrafficLaneCoordinate(proposed, proposedRoute);
      let next = routeCoordinate(proposed, proposedRoute.axis) + proposedRoute.speed * proposedRoute.direction * deltaSeconds;
      if (next > max) {
        next = max - (next - max);
        proposedRoute.direction = -1;
      } else if (next < min) {
        next = min + (min - next);
        proposedRoute.direction = 1;
      }
      next = THREE.MathUtils.clamp(next, min, max);

      setRouteCoordinate(proposed, proposedRoute.axis, next);
      plans.push(this.createTrafficPlan(object, route, proposedRoute, current, proposed));
    }

    this.resolveTrafficPlans(plans);
    for (const plan of plans) {
      if (plan.blocked) {
        holdTrafficBodyTransform(plan.object);
        this.trafficWaitTicks.set(plan.object.id, (this.trafficWaitTicks.get(plan.object.id) ?? 0) + 1);
      } else {
        copyTrafficRouteState(plan.route, plan.proposedRoute);
        applyTrafficBodyTransform(plan.object, plan.proposed, plan.route);
        this.trafficWaitTicks.delete(plan.object.id);
      }
    }
  }

  private createTrafficPlan(
    object: PhysicsObject,
    route: TrafficRoute,
    proposedRoute: TrafficRoute,
    current: THREE.Vector3,
    proposed: THREE.Vector3
  ): TrafficAdvancePlan {
    const waitTicks = this.trafficWaitTicks.get(object.id) ?? 0;
    return {
      object,
      route,
      proposedRoute,
      current,
      proposed,
      priority: waitTicks * 100 + route.speed * 10 - object.id * 0.001,
      blocked: horizontalDistanceSq(current, proposed) <= 0.0001
    };
  }

  private resolveTrafficPlans(plans: TrafficAdvancePlan[]): void {
    for (let i = 0; i < plans.length; i += 1) {
      const first = plans[i];
      if (first.blocked) {
        continue;
      }
      for (let j = i + 1; j < plans.length; j += 1) {
        const second = plans[j];
        if (second.blocked || !trafficPlansConflict(first, second)) {
          continue;
        }
        const firstYields = isVehicleAheadOnSameLane(first, second);
        const secondYields = isVehicleAheadOnSameLane(second, first);
        if (firstYields && !secondYields) {
          first.blocked = true;
          break;
        }
        if (secondYields && !firstYields) {
          second.blocked = true;
        } else if (first.priority >= second.priority) {
          second.blocked = true;
        } else {
          first.blocked = true;
          break;
        }
      }
    }

    for (const plan of plans) {
      if (plan.blocked) {
        continue;
      }
      for (const other of plans) {
        if (other.object.id === plan.object.id || !other.blocked) {
          continue;
        }
        if (isTrafficObjectOccupyingPath(plan, other.object, other.current)) {
          plan.blocked = true;
          break;
        }
      }
    }
  }

  removeObject(id: number): void {
    const object = this.objects.get(id);
    if (!object) {
      return;
    }
    this.restoreStaticDetailBatch(object);
    this.releaseObjectMesh(object);
    this.detachObjectPhysics(object);
  }

  detachObjectForRenderWarmup(id: number): THREE.Mesh | null {
    const object = this.objects.get(id);
    if (!object) {
      return null;
    }
    this.restoreStaticDetailBatch(object);
    delete object.mesh.userData.physicsId;
    this.detachObjectPhysics(object);
    return object.mesh;
  }

  private detachObjectPhysics(object: PhysicsObject): void {
    for (const handle of object.colliderHandles) {
      this.colliderOwners.delete(handle);
    }
    this.trafficObjectIds.delete(object.id);
    this.trafficWaitTicks.delete(object.id);
    this.preStepVelocities.delete(object.id);
    this.world.removeRigidBody(object.body);
    this.objects.delete(object.id);
  }

  private releaseObjectMesh(object: PhysicsObject): void {
    this.scene.remove(object.mesh);
    delete object.mesh.userData.physicsId;
    if (object.visualProxy) {
      object.visualProxy.dispose();
      disposeMeshTree(object.mesh);
      return;
    }
    if (object.releaseMesh) {
      object.releaseMesh(object.mesh);
      return;
    }
    disposeMeshTree(object.mesh);
  }

  clearDynamic(): void {
    for (const object of this.getDynamicObjects()) {
      this.removeObject(object.id);
    }
    this.debrisQueue.length = 0;
    this.debrisQueueHead = 0;
    this.clearStagedVisualActivationQueue();
    this.releasedSupportGroups.clear();
    this.clearPendingEvents();
    this.clearFrozenDebris();
    this.disposeStaticDetailBuckets();
  }

  clearDebris(): void {
    for (const object of this.getDynamicObjects()) {
      if (object.isDebris) {
        this.removeObject(object.id);
      }
    }
    this.compactDebrisQueue();
    this.clearStagedVisualActivationQueue();
    this.clearFrozenDebris();
  }

  clearStatics(): void {
    for (const mesh of this.staticMeshes) {
      this.scene.remove(mesh);
      if (mesh.geometry.userData.sharedGeometry !== true) {
        mesh.geometry.dispose();
      }
    }
    this.staticMeshes.length = 0;
  }

  syncMeshes(): void {
    for (const object of this.objects.values()) {
      if (object.bodyType === "fixed" || object.body.isSleeping()) {
        continue;
      }
      const translation = object.body.translation();
      const rotation = object.body.rotation();
      if (object.visualProxy) {
        object.visualProxy.sync(
          new THREE.Vector3(translation.x, translation.y, translation.z),
          new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w)
        );
        continue;
      }
      object.mesh.position.set(translation.x, translation.y, translation.z);
      object.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
  }

  flushStagedVisualActivations(
    maxActivations = STAGED_VISUAL_ACTIVATIONS_PER_FRAME,
    maxMilliseconds = STAGED_VISUAL_ACTIVATION_MAX_MS
  ): number {
    const startedAt = perfMonitor.timeStart();
    const deadline = maxMilliseconds > 0 ? performance.now() + maxMilliseconds : Number.POSITIVE_INFINITY;
    let activated = 0;
    while (this.stagedVisualActivationQueueHead < this.stagedVisualActivationQueue.length && activated < maxActivations) {
      if (activated > 0 && performance.now() >= deadline) {
        break;
      }
      const id = this.stagedVisualActivationQueue[this.stagedVisualActivationQueueHead];
      this.stagedVisualActivationQueueHead += 1;
      const object = this.objects.get(id);
      if (!object || object.mesh.visible) {
        continue;
      }
      object.mesh.visible = true;
      object.visualProxy?.setVisible(true);
      activated += 1;
    }
    this.compactStagedVisualActivationQueue();
    const backlog = this.stagedVisualActivationQueue.length - this.stagedVisualActivationQueueHead;
    perfMonitor.addCount("render.stagedVisualActivationsActivated", activated);
    perfMonitor.addCount("render.stagedVisualActivationBacklog", backlog);
    perfMonitor.addTiming("render.stagedVisualActivations", startedAt);
    return activated;
  }

  wakeAll(): void {
    for (const object of this.objects.values()) {
      object.body.wakeUp();
    }
  }

  destabilizeUnsupportedStructures(source: PhysicsObject, origin: THREE.Vector3): number {
    if (source.category !== "structure" || source.isDebris) {
      return 0;
    }

    const supportRelease = supportReleaseConfig(source);
    if (supportRelease && this.releasedSupportGroups.has(supportRelease.groupId)) {
      return 0;
    }
    const horizontalRadius = supportRelease?.radius ?? Math.max(1.05, Math.min(2.35, Math.max(source.dimensions.x, source.dimensions.z) * 2.8));
    const sameStackRadius = supportRelease?.radius ?? horizontalRadius * 1.2;
    const neighborRadius = supportRelease ? 0 : horizontalRadius * 0.72;
    const minY = origin.y + Math.max(0.06, source.dimensions.y * 0.34);
    const maxY = origin.y + (supportRelease?.height ?? Math.max(2.4, source.dimensions.y * 6.4));
    let destabilized = 0;

    const candidates = this.collectObjectsInAabb(
      new THREE.Vector3(origin.x, (minY + maxY) * 0.5, origin.z),
      new THREE.Vector3(sameStackRadius, Math.max(0.1, (maxY - minY) * 0.5), sameStackRadius),
      (object) => canDestabilizeStructure(source, object, supportRelease?.groupId)
    );
    for (const object of candidates) {
      if (!canDestabilizeStructure(source, object, supportRelease?.groupId)) {
        continue;
      }

      const position = object.body.translation();
      if (position.y < minY || position.y > maxY) {
        continue;
      }

      const sameStack = supportRelease
        ? object.supportGroupId === supportRelease.groupId
        : object.label === source.label || (object.zoneId !== undefined && object.zoneId === source.zoneId);
      const radius = sameStack ? sameStackRadius : neighborRadius;
      const dx = position.x - origin.x;
      const dz = position.z - origin.z;
      if (dx * dx + dz * dz > radius * radius) {
        continue;
      }

      if (object.bodyType === "fixed") {
        this.restoreStaticDetailBatch(object);
        object.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        object.bodyType = "dynamic";
        for (const handle of object.colliderHandles) {
          this.world.getCollider(handle).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        }
        object.body.setLinearDamping(supportRelease && sameStack ? 0.16 : 0.68);
        object.body.setAngularDamping(supportRelease && sameStack ? 0.08 : 1.24);
        const massScale = supportRelease && sameStack ? object.supportReleaseMassScale ?? 1.15 : 3.4;
        object.body.setAdditionalMass(object.dimensions.x * object.dimensions.y * object.dimensions.z * massScale, true);
        object.body.enableCcd(true);
      } else {
        object.body.wakeUp();
      }

      if (supportRelease && sameStack) {
        const heightFactor = THREE.MathUtils.clamp((position.y - origin.y) / supportRelease.height, 0.18, 1);
        const fallImpulse = (0.45 + heightFactor * 1.55) * (object.supportReleaseImpulseScale ?? 1);
        const fallX = supportRelease.fallDirection.x;
        const fallZ = supportRelease.fallDirection.z;
        object.body.applyImpulse({ x: fallX * fallImpulse, y: -0.18, z: fallZ * fallImpulse }, true);
        const torqueImpulse = (2.1 + heightFactor * 4.8) * (object.supportReleaseTorqueScale ?? 1);
        object.body.applyTorqueImpulse({ x: fallZ * torqueImpulse, y: 0.02, z: -fallX * torqueImpulse }, true);
      } else {
        const lateralScale = sameStack ? 0.16 : 0.08;
        object.body.applyImpulse({ x: dx * lateralScale, y: -1.15, z: dz * lateralScale }, true);
        object.body.applyTorqueImpulse({ x: dz * 0.035, y: 0, z: -dx * 0.035 }, true);
      }
      destabilized += 1;
    }

    if (supportRelease && destabilized > 0) {
      this.releasedSupportGroups.add(supportRelease.groupId);
    }
    perfMonitor.addCount("physics.supportDestabilized", destabilized);
    return destabilized;
  }

  private enforceDebrisCap(): void {
    const startedAt = perfMonitor.timeStart();
    let frozen = 0;
    let removed = 0;
    while (this.activeDebrisCount() > this.maxDebris) {
      const id = this.debrisQueue[this.debrisQueueHead];
      this.debrisQueueHead += 1;
      if (id !== undefined) {
        const object = this.objects.get(id);
        if (object && this.shouldFreezeDebrisAsRubble(object, true)) {
          this.freezeDebrisObject(object);
          frozen += 1;
        } else if (object) {
          this.removeObject(object.id);
          removed += 1;
        }
      }
    }
    if (this.debrisQueueHead > 96 && this.debrisQueueHead * 2 > this.debrisQueue.length) {
      this.compactDebrisQueue();
    }
    this.trimFrozenDebris();
    perfMonitor.addCount("physics.debrisFrozenForced", frozen);
    perfMonitor.addCount("physics.debrisRemovedByCap", removed);
    perfMonitor.addTiming("physics.enforceDebrisCap", startedAt);
  }

  private compactDebrisQueue(): void {
    let write = 0;
    for (let i = this.debrisQueueHead; i < this.debrisQueue.length; i += 1) {
      const id = this.debrisQueue[i];
      if (this.objects.has(id)) {
        this.debrisQueue[write] = id;
        write += 1;
      }
    }
    this.debrisQueue.length = write;
    this.debrisQueueHead = 0;
  }

  private activeDebrisCount(): number {
    return this.debrisQueue.length - this.debrisQueueHead;
  }

  private freezeSettledDebris(): void {
    if (this.activeDebrisCount() <= this.settledDebrisTarget || this.frozenDebrisRecords.length >= this.maxFrozenDebris) {
      return;
    }

    this.compactDebrisQueue();
    let activeCount = this.activeDebrisCount();
    for (
      let i = this.debrisQueueHead;
      i < this.debrisQueue.length && activeCount > this.settledDebrisTarget && this.frozenDebrisRecords.length < this.maxFrozenDebris;
      i += 1
    ) {
      const id = this.debrisQueue[i];
      const object = id === undefined ? undefined : this.objects.get(id);
      if (object && this.shouldFreezeDebrisAsRubble(object, false)) {
        this.freezeDebrisObject(object);
        activeCount -= 1;
      }
    }
    this.compactDebrisQueue();
    this.trimFrozenDebris();
  }

  private freezeDebrisObject(object: PhysicsObject): void {
    const translation = object.body.translation();
    const rotation = object.body.rotation();
    if (object.visualProxy) {
      const position = new THREE.Vector3(translation.x, translation.y, translation.z);
      const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
      const frozenVisual = object.visualProxy.freeze(position, quaternion);
      delete object.mesh.userData.physicsId;
      disposeMeshTree(object.mesh);
      this.detachObjectPhysics(object);
      if (frozenVisual) {
        this.frozenDebrisRecords.push({ visual: frozenVisual, instances: [] });
      }
      return;
    }
    object.mesh.visible = true;
    object.mesh.position.set(translation.x, translation.y, translation.z);
    object.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    object.mesh.castShadow = false;
    object.mesh.receiveShadow = true;
    object.mesh.userData.frozenDebris = true;
    delete object.mesh.userData.physicsId;
    object.mesh.traverse((child) => {
      child.updateMatrix();
      child.matrixAutoUpdate = false;
    });
    this.detachObjectPhysics(object);
    this.freezeRubbleVisual(object.mesh, object.releaseMesh);
  }

  private compactStagedVisualActivationQueue(): void {
    if (this.stagedVisualActivationQueueHead === 0) {
      return;
    }
    if (this.stagedVisualActivationQueueHead >= this.stagedVisualActivationQueue.length) {
      this.stagedVisualActivationQueue.length = 0;
      this.stagedVisualActivationQueueHead = 0;
      return;
    }
    if (this.stagedVisualActivationQueueHead > 128 && this.stagedVisualActivationQueueHead * 2 > this.stagedVisualActivationQueue.length) {
      this.stagedVisualActivationQueue.splice(0, this.stagedVisualActivationQueueHead);
      this.stagedVisualActivationQueueHead = 0;
    }
  }

  private clearStagedVisualActivationQueue(): void {
    this.stagedVisualActivationQueue.length = 0;
    this.stagedVisualActivationQueueHead = 0;
  }

  private freezeRubbleVisual(mesh: THREE.Mesh, releaseMesh?: MeshReleaseCallback): void {
    const parts = collectFrozenRubbleParts(mesh);
    if (!parts) {
      this.frozenDebrisRecords.push({ mesh, releaseMesh, instances: [] });
      perfMonitor.addCount("physics.frozenRubbleMeshFallback");
      return;
    }

    const record: FrozenRubbleRecord = { instances: [] };
    for (const part of parts) {
      this.addFrozenRubbleInstance(record, part);
    }
    this.scene.remove(mesh);
    if (releaseMesh) {
      releaseMesh(mesh);
    } else {
      disposeMeshTree(mesh);
    }
    this.frozenDebrisRecords.push(record);
    perfMonitor.addCount("physics.frozenRubbleBatched");
    perfMonitor.addCount("physics.frozenRubbleBatchedParts", parts.length);
  }

  private addFrozenRubbleInstance(record: FrozenRubbleRecord, part: FrozenRubblePart): void {
    const bucket = this.getFrozenRubbleBucket(part);
    const index = bucket.count;
    const instanceIndex = record.instances.length;
    bucket.mesh.setMatrixAt(index, part.matrix);
    bucket.refs[index] = { record, instanceIndex };
    bucket.count += 1;
    bucket.mesh.count = bucket.count;
    bucket.mesh.visible = true;
    bucket.mesh.instanceMatrix.needsUpdate = true;
    record.instances.push({ bucket, index });
  }

  private getFrozenRubbleBucket(part: FrozenRubblePart): FrozenRubbleBucket {
    const key = frozenRubbleBucketKey(part);
    let buckets = this.frozenRubbleBuckets.get(key);
    if (!buckets) {
      buckets = [];
      this.frozenRubbleBuckets.set(key, buckets);
    }
    const available = buckets.find((bucket) => bucket.count < bucket.capacity);
    if (available) {
      return available;
    }

    const mesh = new THREE.InstancedMesh(part.geometry, part.material, FROZEN_RUBBLE_BUCKET_CAPACITY);
    mesh.count = 0;
    mesh.castShadow = part.castShadow;
    mesh.receiveShadow = part.receiveShadow;
    mesh.renderOrder = part.renderOrder;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    const bucket: FrozenRubbleBucket = {
      key,
      mesh,
      capacity: FROZEN_RUBBLE_BUCKET_CAPACITY,
      count: 0,
      refs: new Array(FROZEN_RUBBLE_BUCKET_CAPACITY)
    };
    buckets.push(bucket);
    perfMonitor.addCount("physics.frozenRubbleBucketsCreated");
    return bucket;
  }

  private removeFrozenRubbleInstance(instance: FrozenRubbleInstance): void {
    const bucket = instance.bucket;
    const lastIndex = bucket.count - 1;
    if (lastIndex < 0) {
      return;
    }

    if (instance.index !== lastIndex) {
      bucket.mesh.getMatrixAt(lastIndex, this.frozenRubbleScratchMatrix);
      bucket.mesh.setMatrixAt(instance.index, this.frozenRubbleScratchMatrix);
      const movedRef = bucket.refs[lastIndex];
      bucket.refs[instance.index] = movedRef;
      if (movedRef) {
        const movedInstance = movedRef.record.instances[movedRef.instanceIndex];
        if (movedInstance) {
          movedInstance.index = instance.index;
        }
      }
    }

    bucket.refs[lastIndex] = undefined;
    bucket.count -= 1;
    bucket.mesh.count = bucket.count;
    bucket.mesh.visible = bucket.count > 0;
    bucket.mesh.instanceMatrix.needsUpdate = true;
  }

  private disposeFrozenRubbleBuckets(): void {
    this.frozenRubbleWarmupBuckets.clear();
    for (const buckets of this.frozenRubbleBuckets.values()) {
      for (const bucket of buckets) {
        this.scene.remove(bucket.mesh);
        bucket.count = 0;
        bucket.refs.length = 0;
      }
    }
    this.frozenRubbleBuckets.clear();
  }

  private createStaticDetailRecord(object: PhysicsObject): StaticDetailRecord | null {
    object.mesh.updateMatrixWorld(true);
    const record: StaticDetailRecord = { objectId: object.id, children: [], instances: [] };
    const parts: Array<{ child: THREE.Mesh; part: FrozenRubblePart }> = [];
    object.mesh.traverse((child) => {
      if (child === object.mesh || !(child instanceof THREE.Mesh) || !child.visible || child.children.length > 0) {
        return;
      }
      if (!isStaticDetailMeshBatchable(child)) {
        return;
      }
      parts.push({
        child,
        part: {
          geometry: child.geometry,
          material: child.material,
          matrix: child.matrixWorld.clone(),
          renderOrder: child.renderOrder,
          castShadow: child.castShadow,
          receiveShadow: child.receiveShadow
        }
      });
    });
    if (parts.length === 0) {
      return null;
    }

    for (const { child, part } of parts) {
      this.addStaticDetailInstance(record, part);
      child.visible = false;
      record.children.push(child);
    }
    return record;
  }

  private addStaticDetailInstance(record: StaticDetailRecord, part: FrozenRubblePart): void {
    const bucket = this.getStaticDetailBucket(part);
    const index = bucket.count;
    const instanceIndex = record.instances.length;
    bucket.mesh.setMatrixAt(index, part.matrix);
    bucket.refs[index] = { record, instanceIndex };
    bucket.count += 1;
    bucket.mesh.count = bucket.count;
    bucket.mesh.visible = true;
    bucket.mesh.instanceMatrix.needsUpdate = true;
    record.instances.push({ bucket, index });
  }

  private getStaticDetailBucket(part: FrozenRubblePart): StaticDetailBucket {
    const key = frozenRubbleBucketKey(part);
    let buckets = this.staticDetailBuckets.get(key);
    if (!buckets) {
      buckets = [];
      this.staticDetailBuckets.set(key, buckets);
    }
    const available = buckets.find((bucket) => bucket.count < bucket.capacity);
    if (available) {
      return available;
    }

    const mesh = new THREE.InstancedMesh(part.geometry, part.material, STATIC_DETAIL_BUCKET_CAPACITY);
    mesh.count = 0;
    mesh.castShadow = part.castShadow;
    mesh.receiveShadow = part.receiveShadow;
    mesh.renderOrder = part.renderOrder;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    const bucket: StaticDetailBucket = {
      key,
      mesh,
      capacity: STATIC_DETAIL_BUCKET_CAPACITY,
      count: 0,
      refs: new Array(STATIC_DETAIL_BUCKET_CAPACITY)
    };
    buckets.push(bucket);
    perfMonitor.addCount("physics.staticDetailBucketsCreated");
    return bucket;
  }

  private finalizeStaticDetailBuckets(): void {
    for (const buckets of this.staticDetailBuckets.values()) {
      for (const bucket of buckets) {
        if (bucket.count <= 0) {
          continue;
        }
        bucket.mesh.computeBoundingSphere();
        bucket.mesh.frustumCulled = true;
      }
    }
  }

  private restoreStaticDetailBatch(object: PhysicsObject): void {
    const record = this.staticDetailRecords.get(object.id);
    if (!record) {
      return;
    }
    for (const child of record.children) {
      child.visible = true;
    }
    while (record.instances.length > 0) {
      const instance = record.instances.pop();
      if (instance) {
        this.removeStaticDetailInstance(instance);
      }
    }
    this.staticDetailRecords.delete(object.id);
  }

  private removeStaticDetailInstance(instance: StaticDetailInstance): void {
    const bucket = instance.bucket;
    const lastIndex = bucket.count - 1;
    if (lastIndex < 0) {
      return;
    }

    if (instance.index !== lastIndex) {
      bucket.mesh.getMatrixAt(lastIndex, this.staticDetailScratchMatrix);
      bucket.mesh.setMatrixAt(instance.index, this.staticDetailScratchMatrix);
      const movedRef = bucket.refs[lastIndex];
      bucket.refs[instance.index] = movedRef;
      if (movedRef) {
        const movedInstance = movedRef.record.instances[movedRef.instanceIndex];
        if (movedInstance) {
          movedInstance.index = instance.index;
        }
      }
    }

    bucket.refs[lastIndex] = undefined;
    bucket.count -= 1;
    bucket.mesh.count = bucket.count;
    bucket.mesh.visible = bucket.count > 0;
    bucket.mesh.instanceMatrix.needsUpdate = true;
  }

  private disposeStaticDetailBuckets(): void {
    for (const buckets of this.staticDetailBuckets.values()) {
      for (const bucket of buckets) {
        this.scene.remove(bucket.mesh);
        bucket.count = 0;
        bucket.refs.length = 0;
      }
    }
    this.staticDetailBuckets.clear();
  }

  private shouldFreezeDebrisAsRubble(object: PhysicsObject, forced: boolean): boolean {
    if (!object.isDebris || object.category !== "debris") {
      return false;
    }

    const ageMs = performance.now() - object.createdAt;
    if (ageMs < (forced ? FORCED_RUBBLE_MIN_AGE_MS : SETTLED_RUBBLE_MIN_AGE_MS)) {
      return false;
    }

    const longestAxis = Math.max(object.dimensions.x, object.dimensions.y, object.dimensions.z);
    const volume = object.dimensions.x * object.dimensions.y * object.dimensions.z;
    if (longestAxis < 0.16 || volume < 0.0025) {
      return false;
    }

    const position = object.body.translation();
    const maxCenterY = Math.max(MAX_RUBBLE_FREEZE_CENTER_Y, object.dimensions.y * 0.5 + 0.18);
    if (position.y > maxCenterY) {
      return false;
    }

    const speedSq = vectorLengthSq(object.body.linvel());
    if (forced) {
      return speedSq <= 9;
    }

    if (object.body.isSleeping()) {
      return true;
    }
    return speedSq <= 0.36 && vectorLengthSq(object.body.angvel()) <= 2.8;
  }

  private trimFrozenDebris(): void {
    while (this.frozenDebrisRecords.length > this.maxFrozenDebris) {
      const record = this.frozenDebrisRecords.shift();
      if (record) {
        this.removeFrozenDebrisRecord(record);
      }
    }
  }

  private clearFrozenDebris(): void {
    for (const record of this.frozenDebrisRecords) {
      this.removeFrozenDebrisRecord(record);
    }
    this.frozenDebrisRecords.length = 0;
    this.disposeFrozenRubbleBuckets();
  }

  private removeFrozenDebrisRecord(record: FrozenRubbleRecord): void {
    record.visual?.dispose();
    if (record.mesh) {
      this.scene.remove(record.mesh);
      if (record.releaseMesh) {
        record.releaseMesh(record.mesh);
      } else {
        disposeMeshTree(record.mesh);
      }
    }
    while (record.instances.length > 0) {
      const instance = record.instances.pop();
      if (instance) {
        this.removeFrozenRubbleInstance(instance);
      }
    }
  }

  private capturePreStepVelocities(): void {
    this.preStepVelocities.clear();
    for (const [id, object] of this.objects) {
      if (
        object.bodyType === "dynamic" &&
        object.category !== "projectile" &&
        object.destructible &&
        object.canFracture &&
        !object.body.isSleeping()
      ) {
        const velocity = object.body.linvel();
        this.preStepVelocities.set(id, { x: velocity.x, y: velocity.y, z: velocity.z });
      }
    }
  }

  private compactPendingEventQueues(): void {
    this.compactPendingCollisionEvents();
    this.compactPendingSurfaceCollisionEvents();
  }

  private clearPendingEvents(): void {
    this.pendingCollisionEvents.length = 0;
    this.pendingCollisionEventHead = 0;
    this.pendingSurfaceCollisionEvents.length = 0;
    this.pendingSurfaceCollisionEventHead = 0;
  }

  private compactPendingCollisionEvents(): void {
    if (this.pendingCollisionEventHead === 0) {
      return;
    }
    if (this.pendingCollisionEventHead >= this.pendingCollisionEvents.length) {
      this.pendingCollisionEvents.length = 0;
      this.pendingCollisionEventHead = 0;
      return;
    }
    if (this.pendingCollisionEventHead > 256 && this.pendingCollisionEventHead * 2 > this.pendingCollisionEvents.length) {
      this.pendingCollisionEvents.splice(0, this.pendingCollisionEventHead);
      this.pendingCollisionEventHead = 0;
    }
  }

  private compactPendingSurfaceCollisionEvents(): void {
    if (this.pendingSurfaceCollisionEventHead === 0) {
      return;
    }
    if (this.pendingSurfaceCollisionEventHead >= this.pendingSurfaceCollisionEvents.length) {
      this.pendingSurfaceCollisionEvents.length = 0;
      this.pendingSurfaceCollisionEventHead = 0;
      return;
    }
    if (this.pendingSurfaceCollisionEventHead > 256 && this.pendingSurfaceCollisionEventHead * 2 > this.pendingSurfaceCollisionEvents.length) {
      this.pendingSurfaceCollisionEvents.splice(0, this.pendingSurfaceCollisionEventHead);
      this.pendingSurfaceCollisionEventHead = 0;
    }
  }

  private collectObjectsInAabb(
    center: THREE.Vector3,
    halfExtentsOrRadius: THREE.Vector3 | number,
    include: (object: PhysicsObject) => boolean
  ): PhysicsObject[] {
    const results: PhysicsObject[] = [];
    const seen = new Set<number>();
    const halfExtents =
      typeof halfExtentsOrRadius === "number"
        ? { x: halfExtentsOrRadius, y: halfExtentsOrRadius, z: halfExtentsOrRadius }
        : halfExtentsOrRadius;
    this.world.collidersWithAabbIntersectingAabb(center, halfExtents, (collider) => {
      const id = this.colliderOwners.get(collider.handle);
      if (id === undefined || seen.has(id)) {
        return true;
      }
      const object = this.objects.get(id);
      if (object && include(object)) {
        seen.add(id);
        results.push(object);
      }
      return true;
    });
    return results;
  }
}

function collectFrozenRubbleParts(root: THREE.Mesh): FrozenRubblePart[] | null {
  root.updateMatrixWorld(true);
  const parts: FrozenRubblePart[] = [];
  let batchable = true;
  root.traverse((child) => {
    if (!batchable || !(child instanceof THREE.Mesh) || !child.visible) {
      return;
    }
    if (!isFrozenRubbleMeshBatchable(child)) {
      batchable = false;
      return;
    }
    parts.push({
      geometry: child.geometry,
      material: child.material,
      matrix: child.matrixWorld.clone(),
      renderOrder: child.renderOrder,
      castShadow: child.castShadow,
      receiveShadow: child.receiveShadow
    });
  });
  return batchable && parts.length > 0 ? parts : null;
}

function isFrozenRubbleMeshBatchable(mesh: THREE.Mesh): mesh is THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  if (Array.isArray(mesh.material) || mesh.children.some((child) => child instanceof THREE.SkinnedMesh)) {
    return false;
  }
  if (mesh.geometry.userData.sharedGeometry !== true || mesh.userData.disposeMaterial === true) {
    return false;
  }
  if (mesh.material.transparent && mesh.material.depthWrite === false) {
    return false;
  }
  return true;
}

function isStaticDetailMeshBatchable(mesh: THREE.Mesh): mesh is THREE.Mesh<THREE.BufferGeometry, THREE.Material> {
  if (Array.isArray(mesh.material) || mesh.children.length > 0) {
    return false;
  }
  if (mesh.geometry.userData.sharedGeometry !== true || mesh.userData.disposeMaterial === true) {
    return false;
  }
  if (mesh.material.transparent || mesh.material instanceof THREE.MeshBasicMaterial || isEmissiveMaterial(mesh.material)) {
    return false;
  }
  return true;
}

function isEmissiveMaterial(material: THREE.Material): boolean {
  const maybeEmissive = material as THREE.Material & { emissive?: THREE.Color; emissiveIntensity?: number };
  return Boolean(maybeEmissive.emissive && maybeEmissive.emissive.getHex() !== 0 && (maybeEmissive.emissiveIntensity ?? 1) > 0);
}

function frozenRubbleBucketKey(part: FrozenRubblePart): string {
  return `${part.geometry.uuid}:${part.material.uuid}:${part.renderOrder}:${part.castShadow ? 1 : 0}:${part.receiveShadow ? 1 : 0}`;
}

function vectorFromRapier(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function vectorLengthSq(v: { x: number; y: number; z: number }): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

function cloneTrafficRoute(route: TrafficRoute): TrafficRoute {
  return { ...route, waypoints: route.waypoints };
}

function copyTrafficRouteState(target: TrafficRoute, source: TrafficRoute): void {
  target.direction = source.direction;
  target.segmentIndex = source.segmentIndex;
}

function advanceWaypointTraffic(position: THREE.Vector3, route: TrafficRoute, deltaSeconds: number): void {
  const waypoints = route.waypoints;
  if (!waypoints || waypoints.length < 2) {
    return;
  }

  let remaining = route.speed * deltaSeconds;
  let segmentIndex = normalizeSegmentIndex(route.segmentIndex ?? 0, waypoints.length);
  let guard = 0;
  while (remaining > 0 && guard < waypoints.length + 2) {
    const target = waypoints[(segmentIndex + 1) % waypoints.length];
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.001) {
      segmentIndex = (segmentIndex + 1) % waypoints.length;
      route.segmentIndex = segmentIndex;
      guard += 1;
      continue;
    }
    if (remaining >= distance) {
      position.x = target.x;
      position.z = target.z;
      remaining -= distance;
      segmentIndex = (segmentIndex + 1) % waypoints.length;
      route.segmentIndex = segmentIndex;
      guard += 1;
      continue;
    }
    const step = remaining / distance;
    position.x += dx * step;
    position.z += dz * step;
    remaining = 0;
  }
  route.segmentIndex = segmentIndex;
}

function applyTrafficBodyTransform(object: PhysicsObject, position: THREE.Vector3, route: TrafficRoute): void {
  const velocity = trafficVelocity(route);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, trafficYaw(route), 0));
  object.body.wakeUp();
  object.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
  object.body.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, true);
  object.body.setLinvel({ x: velocity.x, y: 0, z: velocity.z }, true);
  object.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  object.mesh.position.copy(position);
  object.mesh.quaternion.copy(rotation);
}

function holdTrafficBodyTransform(object: PhysicsObject): void {
  const translation = object.body.translation();
  const rotation = object.body.rotation();
  object.body.wakeUp();
  object.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  object.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  object.mesh.position.set(translation.x, translation.y, translation.z);
  object.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
}

function routeCoordinate(position: THREE.Vector3, axis: TrafficAxis): number {
  return axis === "x" ? position.x : position.z;
}

function setRouteCoordinate(position: THREE.Vector3, axis: TrafficAxis, value: number): void {
  if (axis === "x") {
    position.x = value;
  } else {
    position.z = value;
  }
}

function setTrafficLaneCoordinate(position: THREE.Vector3, route: TrafficRoute): void {
  const laneOffset = route.laneOffset ?? 0;
  if (route.axis === "x") {
    position.z = laneOffset;
  } else {
    position.x = laneOffset;
  }
}

function trafficVelocity(route: TrafficRoute): THREE.Vector3 {
  const waypointDirection = trafficWaypointDirection(route);
  if (waypointDirection) {
    return new THREE.Vector3(waypointDirection.x * route.speed, 0, waypointDirection.z * route.speed);
  }
  if (route.axis === "x") {
    return new THREE.Vector3(route.speed * route.direction, 0, 0);
  }
  return new THREE.Vector3(0, 0, route.speed * route.direction);
}

function trafficYaw(route: TrafficRoute): number {
  const waypointDirection = trafficWaypointDirection(route);
  if (waypointDirection) {
    return Math.atan2(waypointDirection.x, waypointDirection.z);
  }
  if (route.axis === "x") {
    return route.direction > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
  }
  return route.direction > 0 ? 0 : Math.PI;
}

function trafficWaypointDirection(route: TrafficRoute): { x: number; z: number } | null {
  const waypoints = route.waypoints;
  if (!waypoints || waypoints.length < 2) {
    return null;
  }
  const fromIndex = normalizeSegmentIndex(route.segmentIndex ?? 0, waypoints.length);
  const from = waypoints[fromIndex];
  const to = waypoints[(fromIndex + 1) % waypoints.length];
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length <= 0.001) {
    return null;
  }
  return { x: dx / length, z: dz / length };
}

function normalizeSegmentIndex(index: number, length: number): number {
  return ((Math.trunc(index) % length) + length) % length;
}

function horizontalDistanceSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function trafficPlansConflict(first: TrafficAdvancePlan, second: TrafficAdvancePlan): boolean {
  const clearance = trafficClearance(first.object, second.object);
  const clearanceSq = clearance * clearance;
  return (
    horizontalDistanceSq(first.proposed, second.proposed) < clearanceSq ||
    horizontalSegmentDistanceSq(first.current, first.proposed, second.current, second.proposed) < clearanceSq
  );
}

function trafficClearance(first: PhysicsObject, second: PhysicsObject): number {
  const firstFootprint = Math.max(first.dimensions.x, first.dimensions.z);
  const secondFootprint = Math.max(second.dimensions.x, second.dimensions.z);
  return Math.max(TRAFFIC_AVOIDANCE_MIN_DISTANCE, firstFootprint * 0.56 + secondFootprint * 0.56 + TRAFFIC_AVOIDANCE_PADDING);
}

function trafficOccupiedClearance(first: PhysicsObject, second: PhysicsObject): number {
  const firstFootprint = Math.max(first.dimensions.x, first.dimensions.z);
  const secondFootprint = Math.max(second.dimensions.x, second.dimensions.z);
  return Math.max(0.58, firstFootprint * 0.34 + secondFootprint * 0.34);
}

function isVehicleAheadOnSameLane(plan: TrafficAdvancePlan, other: TrafficAdvancePlan): boolean {
  const direction = horizontalPlanDirection(plan);
  if (!direction) {
    return false;
  }
  const otherDirection = horizontalPlanDirection(other);
  if (!otherDirection || direction.x * otherDirection.x + direction.z * otherDirection.z < 0.62) {
    return false;
  }
  const relative = { x: other.current.x - plan.current.x, z: other.current.z - plan.current.z };
  const aheadDistance = relative.x * direction.x + relative.z * direction.z;
  if (aheadDistance <= 0.05 || aheadDistance > trafficClearance(plan.object, other.object) * 1.45) {
    return false;
  }
  const lateralDistance = Math.abs(cross2d(direction, relative));
  return lateralDistance < Math.max(plan.object.dimensions.x, other.object.dimensions.x, 0.55);
}

function isTrafficObjectOccupyingPath(plan: TrafficAdvancePlan, other: PhysicsObject, otherPosition: { x: number; z: number }): boolean {
  const clearance = trafficOccupiedClearance(plan.object, other);
  const obstruction = horizontalPointSegmentProjection(otherPosition, plan.current, plan.proposed);
  return obstruction.t > 0.08 && obstruction.distanceSq < clearance * clearance;
}

function horizontalPlanDirection(plan: TrafficAdvancePlan): { x: number; z: number } | null {
  const dx = plan.proposed.x - plan.current.x;
  const dz = plan.proposed.z - plan.current.z;
  const length = Math.hypot(dx, dz);
  if (length <= 0.0001) {
    const routeDirection = trafficWaypointDirection(plan.route);
    return routeDirection ? { x: routeDirection.x, z: routeDirection.z } : null;
  }
  return { x: dx / length, z: dz / length };
}

function horizontalPointSegmentDistanceSq(point: { x: number; z: number }, start: { x: number; z: number }, end: { x: number; z: number }): number {
  return horizontalPointSegmentProjection(point, start, end).distanceSq;
}

function horizontalPointSegmentProjection(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number }
): { distanceSq: number; t: number } {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const segmentLengthSq = dx * dx + dz * dz;
  if (segmentLengthSq <= 0.0001) {
    return { distanceSq: horizontalDistanceSq(point, start), t: 0 };
  }
  const t = THREE.MathUtils.clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / segmentLengthSq, 0, 1);
  const closest = { x: start.x + dx * t, z: start.z + dz * t };
  return { distanceSq: horizontalDistanceSq(point, closest), t };
}

function horizontalSegmentDistanceSq(
  firstStart: { x: number; z: number },
  firstEnd: { x: number; z: number },
  secondStart: { x: number; z: number },
  secondEnd: { x: number; z: number }
): number {
  if (horizontalSegmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
    return 0;
  }
  return Math.min(
    horizontalPointSegmentDistanceSq(firstStart, secondStart, secondEnd),
    horizontalPointSegmentDistanceSq(firstEnd, secondStart, secondEnd),
    horizontalPointSegmentDistanceSq(secondStart, firstStart, firstEnd),
    horizontalPointSegmentDistanceSq(secondEnd, firstStart, firstEnd)
  );
}

function horizontalSegmentsIntersect(
  firstStart: { x: number; z: number },
  firstEnd: { x: number; z: number },
  secondStart: { x: number; z: number },
  secondEnd: { x: number; z: number }
): boolean {
  const firstDirection = { x: firstEnd.x - firstStart.x, z: firstEnd.z - firstStart.z };
  const secondDirection = { x: secondEnd.x - secondStart.x, z: secondEnd.z - secondStart.z };
  const denominator = cross2d(firstDirection, secondDirection);
  if (Math.abs(denominator) <= 0.0001) {
    return false;
  }
  const offset = { x: secondStart.x - firstStart.x, z: secondStart.z - firstStart.z };
  const t = cross2d(offset, secondDirection) / denominator;
  const u = cross2d(offset, firstDirection) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function cross2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return a.x * b.z - a.z * b.x;
}

function scoreValueForSize(size: THREE.Vector3): number {
  return Math.round(Math.max(1, size.x * size.y * size.z * 45));
}

function defaultScoreRole(category?: PhysicsCategory, isDebris?: boolean): ScoreRole {
  if (isDebris) {
    return "neutral";
  }
  if (category === "projectile") {
    return "neutral";
  }
  return "target";
}

function shouldEnableBoxCollisionEvents(options: DynamicBoxOptions, bodyType: PhysicsBodyType): boolean {
  if (options.collisionEvents !== undefined) {
    return options.collisionEvents;
  }
  if (options.category === "projectile") {
    return true;
  }
  if (bodyType !== "dynamic") {
    return false;
  }
  return Boolean(options.chainSource || options.isDebris || options.destructible !== false || options.canFracture !== false);
}

function shouldEnableSphereCollisionEvents(options: DynamicSphereOptions): boolean {
  if (options.collisionEvents !== undefined) {
    return options.collisionEvents;
  }
  if (options.category === "projectile") {
    return true;
  }
  return Boolean(options.chainSource || options.isDebris || options.destructible !== false || options.canFracture !== false);
}

function supportReleaseConfig(
  source: PhysicsObject
): { groupId: string; radius: number; height: number; fallDirection: THREE.Vector3 } | null {
  if (
    source.supportGroupId === undefined ||
    source.supportReleaseRadius === undefined ||
    source.supportReleaseHeight === undefined
  ) {
    return null;
  }
  const fallDirection = source.supportReleaseFallDirection?.clone() ?? new THREE.Vector3(1, 0, -0.16);
  fallDirection.y = 0;
  if (fallDirection.lengthSq() < 0.001) {
    fallDirection.set(1, 0, 0);
  }
  fallDirection.normalize();
  return {
    groupId: source.supportGroupId,
    radius: source.supportReleaseRadius,
    height: source.supportReleaseHeight,
    fallDirection
  };
}

function canDestabilizeStructure(source: PhysicsObject, candidate: PhysicsObject, supportGroupId?: string): boolean {
  if (
    candidate.id === source.id ||
    candidate.category !== "structure" ||
    candidate.isDebris ||
    candidate.zoneId === "surface"
  ) {
    return false;
  }
  if (supportGroupId !== undefined && candidate.supportGroupId === supportGroupId) {
    return true;
  }
  if (!candidate.destructible || !candidate.canFracture) {
    return false;
  }
  return true;
}

function disposeMeshTree(root: THREE.Mesh): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    if (child.geometry.userData.sharedGeometry !== true) {
      child.geometry.dispose();
    }
    if (child.userData.disposeMaterial === true) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.dispose();
      }
    }
  });
}

const boxGeometryCache = new Map<string, THREE.BoxGeometry>();
const sphereGeometryCache = new Map<string, THREE.SphereGeometry>();

function sharedBoxGeometry(): THREE.BoxGeometry {
  const key = "unit";
  const existing = boxGeometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.userData.sharedGeometry = true;
  boxGeometryCache.set(key, geometry);
  perfMonitor.addCount("render.boxGeometryCacheMiss");
  return geometry;
}

function sharedSphereGeometry(segments: number): THREE.SphereGeometry {
  const heightSegments = Math.max(12, Math.floor(segments * 0.6));
  const key = `${segments}:${heightSegments}`;
  const existing = sphereGeometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.SphereGeometry(1, segments, heightSegments);
  geometry.userData.sharedGeometry = true;
  sphereGeometryCache.set(key, geometry);
  perfMonitor.addCount("render.sphereGeometryCacheMiss");
  return geometry;
}
