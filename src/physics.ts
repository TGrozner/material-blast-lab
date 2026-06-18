import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { MaterialDefinition, MaterialId } from "./materialCatalog";

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
  isDebris: boolean;
  createdAt: number;
  category: PhysicsCategory;
  scoreValue: number;
  scoreRole: ScoreRole;
  zoneId?: string;
  radius: number;
  bodyType: PhysicsBodyType;
  chainSource: boolean;
  shape: PhysicsShape;
  trafficRoute?: TrafficRoute;
}

interface MotionSample {
  x: number;
  y: number;
  z: number;
}

interface DynamicBoxOptions {
  label?: string;
  material: MaterialDefinition;
  renderMaterial: THREE.Material;
  position: THREE.Vector3;
  size: THREE.Vector3;
  rotation?: THREE.Quaternion;
  destructible?: boolean;
  canFracture?: boolean;
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
  sleeping?: boolean;
  linearDamping?: number;
  angularDamping?: number;
  additionalMass?: number;
  ccd?: boolean;
  bodyType?: PhysicsBodyType;
  trafficRoute?: TrafficRoute;
  collisionEvents?: boolean;
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
  private readonly maxDebris = 500;
  private readonly eventQueue = new RAPIER.EventQueue(true);
  private readonly colliderOwners = new Map<number, number>();
  private readonly trafficObjectIds = new Set<number>();
  private readonly preStepVelocities = new Map<number, MotionSample>();
  private readonly surfaceColliderLabels = new Map<number, string>();
  private readonly pendingCollisionEvents: Array<{ firstId: number; secondId: number; started: boolean }> = [];
  private readonly pendingSurfaceCollisionEvents: Array<{
    objectId: number;
    surfaceLabel: string;
    started: boolean;
    impactVelocity: MotionSample;
  }> = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.dt = this.fixedTimestep;
  }

  step(deltaSeconds: number): void {
    this.pendingCollisionEvents.length = 0;
    this.pendingSurfaceCollisionEvents.length = 0;
    this.accumulator += Math.min(deltaSeconds, 0.12);
    while (this.accumulator >= this.fixedTimestep) {
      this.capturePreStepVelocities();
      this.world.step(this.eventQueue);
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
          const object = this.objects.get(objectId);
          const fallbackVelocity = object ? object.body.linvel() : { x: 0, y: 0, z: 0 };
          this.pendingSurfaceCollisionEvents.push({
            objectId,
            surfaceLabel,
            started,
            impactVelocity: this.preStepVelocities.get(objectId) ?? {
              x: fallbackVelocity.x,
              y: fallbackVelocity.y,
              z: fallbackVelocity.z
            }
          });
        }
      });
      this.accumulator -= this.fixedTimestep;
    }
    this.syncMeshes();
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

    const mesh = new THREE.Mesh(sharedBoxGeometry(options.size), options.material);
    mesh.name = options.label;
    mesh.position.copy(options.position);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.visible = options.visible ?? true;
    this.scene.add(mesh);
    this.staticMeshes.push(mesh);
    return mesh;
  }

  addDynamicBox(options: DynamicBoxOptions): PhysicsObject {
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
    if (shouldEnableBoxCollisionEvents(options, bodyType)) {
      colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    }
    const collider = this.world.createCollider(colliderDesc, body);

    const mesh = new THREE.Mesh(sharedBoxGeometry(options.size), options.renderMaterial);
    mesh.name = options.label ?? options.material.name;
    mesh.castShadow = !options.isDebris;
    mesh.receiveShadow = true;
    mesh.position.copy(options.position);
    mesh.quaternion.copy(rotation);
    mesh.userData.physicsId = this.nextId;
    this.scene.add(mesh);

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
      isDebris: options.isDebris ?? false,
      createdAt: performance.now(),
      category: options.category ?? (options.isDebris ? "debris" : "structure"),
      scoreValue: options.scoreValue ?? scoreValueForSize(options.size),
      scoreRole: options.scoreRole ?? defaultScoreRole(options.category, options.isDebris),
      zoneId: options.zoneId,
      radius: options.size.length() * 0.5,
      bodyType,
      chainSource: options.chainSource ?? false,
      shape: "box",
      trafficRoute: options.trafficRoute ? { ...options.trafficRoute } : undefined
    };

    this.objects.set(object.id, object);
    this.colliderOwners.set(collider.handle, object.id);
    if (object.trafficRoute) {
      this.trafficObjectIds.add(object.id);
    }
    if (object.isDebris) {
      this.debrisQueue.push(object.id);
      this.enforceDebrisCap();
    }
    this.nextId += 1;
    return object;
  }

  addDynamicSphere(options: DynamicSphereOptions): PhysicsObject {
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
      sharedSphereGeometry(options.radius, options.segments ?? 24),
      options.renderMaterial
    );
    mesh.name = options.label ?? options.material.name;
    mesh.castShadow = !options.isDebris;
    mesh.receiveShadow = true;
    mesh.position.copy(options.position);
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
      isDebris: options.isDebris ?? false,
      createdAt: performance.now(),
      category: options.category ?? (options.isDebris ? "debris" : "structure"),
      scoreValue: options.scoreValue ?? scoreValueForSize(dimensions),
      scoreRole: options.scoreRole ?? defaultScoreRole(options.category, options.isDebris),
      zoneId: options.zoneId,
      radius: options.radius,
      bodyType: "dynamic",
      chainSource: options.chainSource ?? false,
      shape: "sphere"
    };

    this.objects.set(object.id, object);
    this.colliderOwners.set(collider.handle, object.id);
    if (object.isDebris) {
      this.debrisQueue.push(object.id);
      this.enforceDebrisCap();
    }
    this.nextId += 1;
    return object;
  }

  getDynamicObjects(): PhysicsObject[] {
    return Array.from(this.objects.values());
  }

  getDynamicBodyCount(): number {
    return this.objects.size;
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

  drainCollisionEvents(): PhysicsCollisionEvent[] {
    const events: PhysicsCollisionEvent[] = [];
    for (const event of this.pendingCollisionEvents) {
      const first = this.objects.get(event.firstId);
      const second = this.objects.get(event.secondId);
      if (first && second) {
        events.push({ first, second, started: event.started });
      }
    }
    this.pendingCollisionEvents.length = 0;
    return events;
  }

  drainSurfaceCollisionEvents(): PhysicsSurfaceCollisionEvent[] {
    const events: PhysicsSurfaceCollisionEvent[] = [];
    for (const event of this.pendingSurfaceCollisionEvents) {
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
    this.pendingSurfaceCollisionEvents.length = 0;
    return events;
  }

  advanceTrafficRoutes(deltaSeconds: number): void {
    if (deltaSeconds <= 0) {
      return;
    }
    for (const id of this.trafficObjectIds) {
      const object = this.objects.get(id);
      const route = object?.trafficRoute;
      if (!object || !route || object.bodyType !== "dynamic" || object.isDebris || object.category === "projectile") {
        continue;
      }

      const current = vectorFromRapier(object.body.translation());
      if (route.waypoints && route.waypoints.length > 1) {
        advanceWaypointTraffic(current, route, deltaSeconds);
        applyTrafficBodyTransform(object, current, route);
        continue;
      }

      const min = Math.min(route.min, route.max);
      const max = Math.max(route.min, route.max);
      setTrafficLaneCoordinate(current, route);
      let next = routeCoordinate(current, route.axis) + route.speed * route.direction * deltaSeconds;
      if (next > max) {
        next = max - (next - max);
        route.direction = -1;
      } else if (next < min) {
        next = min + (min - next);
        route.direction = 1;
      }
      next = THREE.MathUtils.clamp(next, min, max);

      setRouteCoordinate(current, route.axis, next);
      applyTrafficBodyTransform(object, current, route);
    }
  }

  removeObject(id: number): void {
    const object = this.objects.get(id);
    if (!object) {
      return;
    }
    this.scene.remove(object.mesh);
    disposeMeshTree(object.mesh);
    this.colliderOwners.delete(object.collider.handle);
    this.trafficObjectIds.delete(object.id);
    this.preStepVelocities.delete(object.id);
    this.world.removeRigidBody(object.body);
    this.objects.delete(id);
  }

  clearDynamic(): void {
    for (const object of this.getDynamicObjects()) {
      this.removeObject(object.id);
    }
    this.debrisQueue.length = 0;
    this.debrisQueueHead = 0;
  }

  clearDebris(): void {
    for (const object of this.getDynamicObjects()) {
      if (object.isDebris) {
        this.removeObject(object.id);
      }
    }
    this.compactDebrisQueue();
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
      object.mesh.position.set(translation.x, translation.y, translation.z);
      object.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
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

    const horizontalRadius = Math.max(1.05, Math.min(2.35, Math.max(source.dimensions.x, source.dimensions.z) * 2.8));
    const sameStackRadius = horizontalRadius * 1.2;
    const neighborRadius = horizontalRadius * 0.72;
    const minY = origin.y + Math.max(0.06, source.dimensions.y * 0.34);
    const maxY = origin.y + Math.max(2.4, source.dimensions.y * 6.4);
    let destabilized = 0;

    const candidates = this.collectObjectsInAabb(
      new THREE.Vector3(origin.x, (minY + maxY) * 0.5, origin.z),
      new THREE.Vector3(sameStackRadius, Math.max(0.1, (maxY - minY) * 0.5), sameStackRadius),
      (object) => canDestabilizeStructure(source, object)
    );
    for (const object of candidates) {
      if (!canDestabilizeStructure(source, object)) {
        continue;
      }

      const position = object.body.translation();
      if (position.y < minY || position.y > maxY) {
        continue;
      }

      const sameStack = object.label === source.label || (object.zoneId !== undefined && object.zoneId === source.zoneId);
      const radius = sameStack ? sameStackRadius : neighborRadius;
      const dx = position.x - origin.x;
      const dz = position.z - origin.z;
      if (dx * dx + dz * dz > radius * radius) {
        continue;
      }

      if (object.bodyType === "fixed") {
        object.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        object.bodyType = "dynamic";
        object.collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        object.body.setLinearDamping(0.68);
        object.body.setAngularDamping(1.24);
        object.body.setAdditionalMass(object.dimensions.x * object.dimensions.y * object.dimensions.z * 3.4, true);
        object.body.enableCcd(true);
      } else {
        object.body.wakeUp();
      }

      const lateralScale = sameStack ? 0.16 : 0.08;
      object.body.applyImpulse({ x: dx * lateralScale, y: -1.15, z: dz * lateralScale }, true);
      object.body.applyTorqueImpulse({ x: dz * 0.035, y: 0, z: -dx * 0.035 }, true);
      destabilized += 1;
    }

    return destabilized;
  }

  private enforceDebrisCap(): void {
    while (this.debrisQueue.length - this.debrisQueueHead > this.maxDebris) {
      const id = this.debrisQueue[this.debrisQueueHead];
      this.debrisQueueHead += 1;
      if (id !== undefined) {
        this.removeObject(id);
      }
    }
    if (this.debrisQueueHead > 96 && this.debrisQueueHead * 2 > this.debrisQueue.length) {
      this.compactDebrisQueue();
    }
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

function vectorFromRapier(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
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

function canDestabilizeStructure(source: PhysicsObject, candidate: PhysicsObject): boolean {
  if (
    candidate.id === source.id ||
    candidate.category !== "structure" ||
    candidate.isDebris ||
    !candidate.destructible ||
    !candidate.canFracture ||
    candidate.zoneId === "surface"
  ) {
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

function sharedBoxGeometry(size: THREE.Vector3): THREE.BoxGeometry {
  const key = `${size.x.toFixed(3)}:${size.y.toFixed(3)}:${size.z.toFixed(3)}`;
  const existing = boxGeometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  geometry.userData.sharedGeometry = true;
  boxGeometryCache.set(key, geometry);
  return geometry;
}

function sharedSphereGeometry(radius: number, segments: number): THREE.SphereGeometry {
  const heightSegments = Math.max(12, Math.floor(segments * 0.6));
  const key = `${radius.toFixed(3)}:${segments}:${heightSegments}`;
  const existing = sphereGeometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.SphereGeometry(radius, segments, heightSegments);
  geometry.userData.sharedGeometry = true;
  sphereGeometryCache.set(key, geometry);
  return geometry;
}
