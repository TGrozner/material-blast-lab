import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import type { MaterialDefinition, MaterialId } from "./materialCatalog";

export type PhysicsCategory = "structure" | "bio" | "projectile" | "debris";
export type ScoreRole = "target" | "protected" | "neutral";
export type PhysicsBodyType = "dynamic" | "fixed";
export type PhysicsShape = "box" | "sphere";

export interface PhysicsCollisionEvent {
  first: PhysicsObject;
  second: PhysicsObject;
  started: boolean;
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
  private readonly maxDebris = 500;
  private readonly eventQueue = new RAPIER.EventQueue(true);
  private readonly colliderOwners = new Map<number, number>();
  private readonly pendingCollisionEvents: Array<{ firstId: number; secondId: number; started: boolean }> = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.dt = this.fixedTimestep;
  }

  step(deltaSeconds: number): void {
    this.pendingCollisionEvents.length = 0;
    this.accumulator += Math.min(deltaSeconds, 0.12);
    while (this.accumulator >= this.fixedTimestep) {
      this.world.step(this.eventQueue);
      this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        const firstId = this.colliderOwners.get(handle1);
        const secondId = this.colliderOwners.get(handle2);
        if (firstId !== undefined && secondId !== undefined) {
          this.pendingCollisionEvents.push({ firstId, secondId, started });
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
    this.world.createCollider(colliderDesc, body);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(options.size.x, options.size.y, options.size.z), options.material);
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
      .setRestitution(options.restitution ?? options.material.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(colliderDesc, body);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(options.size.x, options.size.y, options.size.z), options.renderMaterial);
    mesh.name = options.label ?? options.material.name;
    mesh.castShadow = true;
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
      shape: "box"
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
      .setRestitution(options.restitution ?? options.material.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(colliderDesc, body);

    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(options.radius, options.segments ?? 24, Math.max(12, Math.floor((options.segments ?? 24) * 0.6))),
      options.renderMaterial
    );
    mesh.name = options.label ?? options.material.name;
    mesh.castShadow = true;
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

  removeObject(id: number): void {
    const object = this.objects.get(id);
    if (!object) {
      return;
    }
    this.scene.remove(object.mesh);
    disposeMeshTree(object.mesh);
    this.colliderOwners.delete(object.collider.handle);
    this.world.removeRigidBody(object.body);
    this.objects.delete(id);
  }

  clearDynamic(): void {
    for (const object of this.getDynamicObjects()) {
      this.removeObject(object.id);
    }
    this.debrisQueue.length = 0;
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
      mesh.geometry.dispose();
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

  private enforceDebrisCap(): void {
    this.compactDebrisQueue();
    while (this.debrisQueue.length > this.maxDebris) {
      const id = this.debrisQueue.shift();
      if (id !== undefined) {
        this.removeObject(id);
      }
    }
  }

  private compactDebrisQueue(): void {
    for (let i = this.debrisQueue.length - 1; i >= 0; i -= 1) {
      if (!this.objects.has(this.debrisQueue[i])) {
        this.debrisQueue.splice(i, 1);
      }
    }
  }
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

function disposeMeshTree(root: THREE.Mesh): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    child.geometry.dispose();
    if (child.userData.disposeMaterial === true) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        material.dispose();
      }
    }
  });
}
