import * as THREE from "three";
import { fragmentDecorationParts } from "./cityVisuals";
import { MaterialCatalog, type MaterialDefinition, type MaterialId } from "./materialCatalog";
import { perfMonitor } from "./perf";
import { PhysicsWorld, type DynamicVisualProxy, type FrozenVisualHandle, type PhysicsCategory, type PhysicsObject, type ScoreRole } from "./physics";
import { type RandomSource, randomInt, randomRange, randomUnitVectorInto } from "./random";

const IMMEDIATE_PRIMARY_FRAGMENT_VISUALS = 6;
const IMMEDIATE_DEBRIS_FRAGMENT_VISUALS = 3;
const PRIMARY_PHYSICAL_FRAGMENT_LIMIT = 8;
const SECONDARY_PHYSICAL_FRAGMENT_LIMIT = 3;
const MIN_PHYSICAL_FRAGMENT_VOLUME = 0.012;
const MAX_VISUAL_ONLY_FRAGMENTS = 320;
const VISUAL_FRAGMENT_MIN_LIFE_SECONDS = 2.2;
const VISUAL_FRAGMENT_MAX_LIFE_SECONDS = 4;
const VISUAL_FRAGMENT_SETTLE_MIN_AGE_SECONDS = 0.35;
const VISUAL_FRAGMENT_SETTLE_SPEED_SQ = 0.18;
const VISUAL_FRAGMENT_GRAVITY = 8.4;
const VISUAL_FRAGMENT_LINEAR_DAMPING = 1.05;
const VISUAL_FRAGMENT_ANGULAR_DAMPING = 1.1;
const VISUAL_FRAGMENT_BOUNCE = 0.18;
const FRAGMENT_INSTANCE_BUCKET_CAPACITY = 512;
const FRAGMENT_INSTANCE_SPATIAL_TILE_SIZE = 48;
const FRAGMENT_INSTANCE_MIN_TILE = -3;
const FRAGMENT_INSTANCE_MAX_TILE = 3;
const FRAGMENT_INSTANCE_MIGRATION_HYSTERESIS_TILES = 1;
const FRAGMENT_INSTANCE_BUCKET_CENTER_Y = 7.5;
const FRAGMENT_INSTANCE_BUCKET_HALF_Y = 56;
const FRAGMENT_INSTANCE_BUCKET_BOUND_RADIUS = Math.hypot(
  FRAGMENT_INSTANCE_SPATIAL_TILE_SIZE * (FRAGMENT_INSTANCE_MIGRATION_HYSTERESIS_TILES + 0.5),
  FRAGMENT_INSTANCE_BUCKET_HALF_Y,
  FRAGMENT_INSTANCE_SPATIAL_TILE_SIZE * (FRAGMENT_INSTANCE_MIGRATION_HYSTERESIS_TILES + 0.5)
);
const FRAGMENT_INSTANCE_SPATIAL_WARMUP_TILES = Array.from(
  { length: FRAGMENT_INSTANCE_MAX_TILE - FRAGMENT_INSTANCE_MIN_TILE + 1 },
  (_, index) => FRAGMENT_INSTANCE_MIN_TILE + index
);
const FRAGMENT_INSTANCE_WARMUP_PREVIEW_COUNT = 192;
const RUNTIME_FRAGMENT_PIPELINE_WARMUP_PER_MATERIAL = 28;
const MAX_QUEUED_FRACTURES = 260;
const FRACTURE_QUEUE_COMPACT_HEAD = 64;
const SECONDARY_CHAIN_FRAGMENT_LIMIT = 4;
const SECONDARY_CHAIN_FRAGMENT_MIN_VOLUME = 0.018;
const PRIMARY_CHAIN_EVENT_FRAGMENT_LIMIT = 8;
const SECONDARY_CHAIN_EVENT_FRAGMENT_LIMIT = 2;
const CHAIN_EVENT_FRAGMENT_MIN_VOLUME = 0.012;

const FRAGMENT_POOL_BOX_GEOMETRY = createFragmentPoolBoxGeometry();

export interface ExplosionAffectedObject {
  id: number;
  label: string;
  materialId: MaterialId;
  category: PhysicsCategory;
  scoreRole: ScoreRole;
  zoneId?: string;
  position: THREE.Vector3;
  energy: number;
  weightedDamage: number;
  scoreValue: number;
  fractured: boolean;
}

export interface ExplosionResult {
  origin: THREE.Vector3;
  affectedBodies: number;
  fracturedBodies: number;
  dustColors: THREE.Color[];
  affectedObjects: ExplosionAffectedObject[];
  structureDamage: number;
  materialChaos: number;
}

interface FragmentPlan {
  size: THREE.Vector3;
  offset: THREE.Vector3;
  rotation: THREE.Quaternion;
  material: MaterialDefinition;
}

interface FragmentInstanceSlot {
  groupKey: string;
  bucket: FragmentInstanceBucket;
  index: number;
  ownerId: number;
  renderer: FragmentInstanceRenderer;
  visible: boolean;
}

interface FragmentDetailInstance {
  slot: FragmentInstanceSlot;
  localMatrix: THREE.Matrix4;
}

interface FragmentInstanceAcquireOptions {
  details?: boolean;
}

interface FragmentInstanceBucket {
  key: string;
  groupKey: string;
  mesh: THREE.InstancedMesh;
  capacity: number;
  freeSlots: number[];
  owners: number[];
  highWater: number;
  activeCount: number;
  tileX: number;
  tileZ: number;
  overflowIndex: number;
  keepResident: boolean;
  hiddenMatrix: THREE.Matrix4;
}

interface FragmentInstanceBucketMetadata {
  material: THREE.Material;
  name: string;
}

interface BlastSample {
  position: THREE.Vector3;
  directionOffset: THREE.Vector3;
  distance: number;
}

interface BlastRecord {
  object: PhysicsObject;
  material: MaterialDefinition;
  sample: BlastSample;
  falloff: number;
  energy: number;
}

interface FractureJob {
  objectId: number;
  origin: THREE.Vector3;
  blastStrength: number;
  blastRadius: number;
  energy: number;
}

interface VisualOnlyFragment {
  visualProxy: DynamicVisualProxy;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  halfHeight: number;
  ageSeconds: number;
  lifeSeconds: number;
  moving: boolean;
}

export interface QueuedFractureStats {
  processed: number;
  remaining: number;
}

const MAX_FRACTURES_PER_EXPLOSION = 26;

function fractureThresholdFor(material: MaterialDefinition, object: PhysicsObject, scale = 1): number {
  return material.fractureThreshold * Math.max(0.1, object.fractureResistance ?? 1) * scale;
}

function createFragmentPoolBoxGeometry(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.userData.sharedGeometry = true;
  return geometry;
}

function fragmentInstanceWarmupSize(materialId: MaterialId): THREE.Vector3 {
  switch (materialId) {
    case "glass":
      return new THREE.Vector3(0.42, 0.04, 0.88);
    case "metal":
      return new THREE.Vector3(0.22, 0.24, 1.05);
    case "concrete":
      return new THREE.Vector3(0.62, 0.46, 0.58);
    case "wood":
      return new THREE.Vector3(0.24, 0.7, 0.48);
    case "foam":
      return new THREE.Vector3(0.5, 0.34, 0.46);
    case "rubber":
      return new THREE.Vector3(0.36, 0.32, 0.42);
  }
}

export class DestructibleObject {
  constructor(readonly object: PhysicsObject) {}
}

class FragmentInstanceRenderer {
  private readonly buckets = new Map<string, FragmentInstanceBucket>();
  private readonly bucketFamilies = new Map<string, FragmentInstanceBucket[]>();
  private readonly bucketMetadata = new Map<string, FragmentInstanceBucketMetadata>();
  private readonly dirtyBuckets = new Set<FragmentInstanceBucket>();
  private readonly scratchParentMatrix = new THREE.Matrix4();
  private readonly scratchRigidMatrix = new THREE.Matrix4();
  private readonly scratchWorldMatrix = new THREE.Matrix4();
  private readonly scratchHiddenPosition = new THREE.Vector3();
  private readonly hiddenScale = new THREE.Vector3(0.001, 0.001, 0.001);
  private readonly unitScale = new THREE.Vector3(1, 1, 1);
  private readonly warmupQuaternion = new THREE.Quaternion();
  private nextSlotOwnerId = 1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly materials: MaterialCatalog
  ) {}

  warmupObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const materialId of this.materials.order) {
      const bucket = this.warmupMainBucketFor(materialId);
      this.parkWarmupSlot(bucket);
      objects.push(bucket.mesh);
      for (const part of fragmentDecorationParts({ materialId, size: fragmentInstanceWarmupSize(materialId) })) {
        const detailBucket = this.warmupDetailBucketFor(part.material);
        this.parkWarmupSlot(detailBucket);
        if (!objects.includes(detailBucket.mesh)) {
          objects.push(detailBucket.mesh);
        }
      }
    }
    this.warmupSpatialBuckets(objects);
    this.showWarmupPreview();
    return objects;
  }

  showWarmupPreview(): void {
    this.materials.order.forEach((materialId, materialIndex) => {
      const baseSize = fragmentInstanceWarmupSize(materialId);
      for (let instanceIndex = 0; instanceIndex < FRAGMENT_INSTANCE_WARMUP_PREVIEW_COUNT; instanceIndex += 1) {
        const column = instanceIndex % 16;
        const row = Math.floor(instanceIndex / 16);
        const shapeScale = 0.68 + ((instanceIndex * 17) % 9) * 0.09;
        const size = baseSize.clone().multiplyScalar(shapeScale);
        const position = new THREE.Vector3(
          (materialIndex - (this.materials.order.length - 1) * 0.5) * 0.62 + (column - 7.5) * 0.045,
          0.28 + row * 0.08,
          -0.42 + ((instanceIndex * 5) % 11) * 0.026
        );
        this.warmupQuaternion.setFromEuler(
          new THREE.Euler(
            materialIndex * 0.18 + instanceIndex * 0.031,
            materialIndex * 0.27 + instanceIndex * 0.047,
            materialIndex * 0.11 + instanceIndex * 0.023
          )
        );
        this.scratchParentMatrix.compose(position, this.warmupQuaternion, size);
        this.writeWarmupSlot(this.warmupMainBucketFor(materialId), instanceIndex, this.scratchParentMatrix);
        this.scratchRigidMatrix.compose(position, this.warmupQuaternion, this.unitScale);
        for (const part of fragmentDecorationParts({ materialId, size })) {
          const localRotation = new THREE.Quaternion().setFromEuler(part.rotation);
          const localMatrix = new THREE.Matrix4().compose(part.offset, localRotation, part.size);
          this.scratchWorldMatrix.multiplyMatrices(this.scratchRigidMatrix, localMatrix);
          this.writeWarmupSlot(this.warmupDetailBucketFor(part.material), instanceIndex, this.scratchWorldMatrix);
        }
      }
    });
  }

  parkWarmupPreview(): void {
    for (const bucket of this.buckets.values()) {
      const warmupCount = Math.min(bucket.mesh.count, FRAGMENT_INSTANCE_WARMUP_PREVIEW_COUNT);
      for (let index = 0; index < warmupCount; index += 1) {
        if (bucket.owners[index] === 0) {
          bucket.mesh.setMatrixAt(index, bucket.hiddenMatrix);
        }
      }
      this.shrinkBucketHighWater(bucket);
      this.refreshBucketDrawState(bucket);
      bucket.mesh.instanceMatrix.needsUpdate = true;
      this.markBucketDirty(bucket);
    }
  }

  flushBounds(): void {
    if (this.dirtyBuckets.size === 0) {
      return;
    }
    const startedAt = perfMonitor.timeStart();
    let updated = 0;
    for (const bucket of this.dirtyBuckets) {
      if (bucket.mesh.visible && bucket.mesh.count > 0) {
        bucket.mesh.frustumCulled = true;
        updated += 1;
      } else {
        bucket.mesh.frustumCulled = false;
      }
    }
    this.dirtyBuckets.clear();
    perfMonitor.addCount("render.fragmentInstanceBoundsUpdated", updated);
    perfMonitor.addTiming("render.fragmentInstanceBounds", startedAt);
  }

  acquire(
    materialId: MaterialId,
    size: THREE.Vector3,
    position: THREE.Vector3,
    options: FragmentInstanceAcquireOptions = {}
  ): DynamicVisualProxy {
    const mainSlot = this.acquireSlot(
      this.mainBucketFor(materialId, position, "render.fragmentInstanceSlotMiss"),
      "render.fragmentInstanceSlotReuse"
    );
    if (!mainSlot) {
      return new NullFragmentVisualProxy();
    }
    const detailInstances: FragmentDetailInstance[] = [];
    if (options.details !== false) {
      for (const part of fragmentDecorationParts({ materialId, size })) {
        const detailSlot = this.acquireSlot(
          this.detailBucketFor(part.material, position, "render.fragmentDetailInstanceSlotMiss"),
          "render.fragmentDetailInstanceSlotReuse"
        );
        if (!detailSlot) {
          continue;
        }
        const localRotation = new THREE.Quaternion().setFromEuler(part.rotation);
        detailInstances.push({
          slot: detailSlot,
          localMatrix: new THREE.Matrix4().compose(part.offset, localRotation, part.size)
        });
      }
    }
    return new FragmentInstanceVisualProxy(this, mainSlot, size.clone(), detailInstances);
  }

  setVisible(slot: FragmentInstanceSlot, detailInstances: FragmentDetailInstance[], visible: boolean): FragmentInstanceSlot {
    if (!slot.renderer.slotIsCurrent(slot)) {
      return slot;
    }
    slot.visible = visible;
    if (!visible) {
      this.writeHiddenSlotMatrix(slot);
    }
    for (const detail of detailInstances) {
      if (!detail.slot.renderer.slotIsCurrent(detail.slot)) {
        continue;
      }
      detail.slot.visible = visible;
      if (!visible) {
        this.writeHiddenSlotMatrix(detail.slot);
      }
    }
    return slot;
  }

  sync(
    slot: FragmentInstanceSlot,
    size: THREE.Vector3,
    detailInstances: FragmentDetailInstance[],
    position: THREE.Vector3,
    rotation: THREE.Quaternion
  ): FragmentInstanceSlot {
    if (!slot.renderer.slotIsCurrent(slot)) {
      return slot;
    }
    if (!slot.visible) {
      this.writeHiddenSlotMatrix(slot);
      for (const detail of detailInstances) {
        this.writeHiddenSlotMatrix(detail.slot);
      }
      return slot;
    }
    this.scratchParentMatrix.compose(position, rotation, size);
    const nextSlot = this.writeMatrixInPositionBucket(slot, this.scratchParentMatrix, position, "render.fragmentInstanceSlotMoved");
    this.scratchRigidMatrix.compose(position, rotation, this.unitScale);
    for (const detail of detailInstances) {
      if (!detail.slot.visible || !detail.slot.renderer.slotIsCurrent(detail.slot)) {
        continue;
      }
      this.scratchWorldMatrix.multiplyMatrices(this.scratchRigidMatrix, detail.localMatrix);
      detail.slot = this.writeMatrixInPositionBucket(detail.slot, this.scratchWorldMatrix, position, "render.fragmentDetailInstanceSlotMoved");
    }
    return nextSlot;
  }

  freeze(
    slot: FragmentInstanceSlot,
    size: THREE.Vector3,
    detailInstances: FragmentDetailInstance[],
    position: THREE.Vector3,
    rotation: THREE.Quaternion
  ): { slot: FragmentInstanceSlot; handle: FrozenVisualHandle } | null {
    if (!slot.renderer.slotIsCurrent(slot)) {
      return null;
    }
    slot.visible = true;
    for (const detail of detailInstances) {
      detail.slot.visible = true;
    }
    const frozenSlot = this.sync(slot, size, detailInstances, position, rotation);
    return {
      slot: frozenSlot,
      handle: {
        dispose: () => {
          this.release(frozenSlot);
          for (const detail of detailInstances) {
            this.release(detail.slot);
          }
        }
      }
    };
  }

  release(slot: FragmentInstanceSlot): void {
    const bucket = slot.bucket;
    if (!this.slotIsCurrent(slot)) {
      return;
    }
    slot.visible = false;
    bucket.owners[slot.index] = 0;
    bucket.activeCount = Math.max(0, bucket.activeCount - 1);
    bucket.mesh.setMatrixAt(slot.index, bucket.hiddenMatrix);
    bucket.mesh.instanceMatrix.needsUpdate = true;
    bucket.freeSlots.push(slot.index);
    this.shrinkBucketHighWater(bucket);
    this.refreshBucketDrawState(bucket);
    this.markBucketDirty(bucket);
  }

  private slotIsCurrent(slot: FragmentInstanceSlot): boolean {
    return slot.bucket.owners[slot.index] === slot.ownerId;
  }

  private writeHiddenSlotMatrix(slot: FragmentInstanceSlot): void {
    if (!this.slotIsCurrent(slot)) {
      return;
    }
    this.writeMatrix(slot, slot.bucket.hiddenMatrix);
  }

  private writeMatrixInPositionBucket(
    slot: FragmentInstanceSlot,
    matrix: THREE.Matrix4,
    position: THREE.Vector3,
    moveMetric: string
  ): FragmentInstanceSlot {
    if (!this.slotIsCurrent(slot)) {
      return slot;
    }
    const tileX = fragmentInstanceTileCoordinate(position.x);
    const tileZ = fragmentInstanceTileCoordinate(position.z);
    const bucket = slot.bucket;
    if (
      Math.abs(bucket.tileX - tileX) <= FRAGMENT_INSTANCE_MIGRATION_HYSTERESIS_TILES &&
      Math.abs(bucket.tileZ - tileZ) <= FRAGMENT_INSTANCE_MIGRATION_HYSTERESIS_TILES
    ) {
      this.writeMatrix(slot, matrix);
      return slot;
    }

    const metadata = this.bucketMetadata.get(slot.groupKey);
    if (!metadata) {
      this.writeMatrix(slot, matrix);
      return slot;
    }
    const nextBucket = this.bucketForGroup(slot.groupKey, metadata.material, metadata.name, tileX, tileZ, false, moveMetric);
    const nextSlot = this.acquireSlot(nextBucket, "render.fragmentInstanceMigratedSlotReuse");
    if (!nextSlot) {
      this.writeMatrix(slot, matrix);
      return slot;
    }
    nextSlot.visible = slot.visible;
    this.writeMatrix(nextSlot, matrix);
    this.release(slot);
    perfMonitor.addCount(moveMetric);
    return nextSlot;
  }

  private writeMatrix(slot: FragmentInstanceSlot, matrix: THREE.Matrix4): void {
    if (!this.slotIsCurrent(slot)) {
      return;
    }
    const bucket = slot.bucket;
    bucket.mesh.setMatrixAt(slot.index, matrix);
    bucket.mesh.instanceMatrix.needsUpdate = true;
  }

  private acquireSlot(bucket: FragmentInstanceBucket, reuseMetric: string): FragmentInstanceSlot | null {
    const index = bucket.freeSlots.pop();
    if (index === undefined) {
      return null;
    }
    const ownerId = this.nextSlotOwnerId;
    this.nextSlotOwnerId += 1;
    bucket.owners[index] = ownerId;
    bucket.activeCount += 1;
    bucket.highWater = Math.max(bucket.highWater, index + 1);
    this.refreshBucketDrawState(bucket);
    this.markBucketDirty(bucket);
    perfMonitor.addCount(reuseMetric);
    return { groupKey: bucket.groupKey, bucket, index, ownerId, renderer: this, visible: true };
  }

  private warmupMainBucketFor(materialId: MaterialId): FragmentInstanceBucket {
    const material = this.materials.get(materialId);
    return this.bucketForGroup(
      fragmentMainGroupKey(materialId),
      this.materials.getRenderMaterial(materialId),
      `${material.name} instanced fragments`,
      0,
      0,
      true,
      "render.fragmentInstanceWarmupBucketMiss"
    );
  }

  private warmupDetailBucketFor(material: THREE.Material): FragmentInstanceBucket {
    return this.bucketForGroup(
      fragmentDetailGroupKey(material),
      material,
      `${material.name || "fragment detail"} instanced fragment details`,
      0,
      0,
      true,
      "render.fragmentDetailWarmupBucketMiss"
    );
  }

  private mainBucketFor(materialId: MaterialId, position: THREE.Vector3, missMetric: string): FragmentInstanceBucket {
    const material = this.materials.get(materialId);
    return this.bucketForGroup(
      fragmentMainGroupKey(materialId),
      this.materials.getRenderMaterial(materialId),
      `${material.name} instanced fragments`,
      fragmentInstanceTileCoordinate(position.x),
      fragmentInstanceTileCoordinate(position.z),
      false,
      missMetric
    );
  }

  private detailBucketFor(material: THREE.Material, position: THREE.Vector3, missMetric: string): FragmentInstanceBucket {
    return this.bucketForGroup(
      fragmentDetailGroupKey(material),
      material,
      `${material.name || "fragment detail"} instanced fragment details`,
      fragmentInstanceTileCoordinate(position.x),
      fragmentInstanceTileCoordinate(position.z),
      false,
      missMetric
    );
  }

  private bucketForGroup(
    groupKey: string,
    material: THREE.Material,
    name: string,
    tileX: number,
    tileZ: number,
    keepResident: boolean,
    missMetric: string
  ): FragmentInstanceBucket {
    this.bucketMetadata.set(groupKey, { material, name });
    const familyKey = fragmentBucketFamilyKey(groupKey, tileX, tileZ);
    let family = this.bucketFamilies.get(familyKey);
    if (!family) {
      family = [];
      this.bucketFamilies.set(familyKey, family);
    }
    const available = family.find((bucket) => bucket.freeSlots.length > 0);
    if (available) {
      if (keepResident) {
        available.keepResident = true;
        this.refreshBucketDrawState(available);
      }
      return available;
    }
    perfMonitor.addCount(missMetric);
    const bucket = this.createBucket(groupKey, material, name, tileX, tileZ, family.length, keepResident);
    family.push(bucket);
    return bucket;
  }

  private createBucket(
    groupKey: string,
    material: THREE.Material,
    name: string,
    tileX: number,
    tileZ: number,
    overflowIndex: number,
    keepResident: boolean
  ): FragmentInstanceBucket {
    const key = fragmentBucketKey(groupKey, tileX, tileZ, overflowIndex);
    const mesh = new THREE.InstancedMesh(FRAGMENT_POOL_BOX_GEOMETRY, material, FRAGMENT_INSTANCE_BUCKET_CAPACITY);
    mesh.name = `${name} [${tileX},${tileZ}:${overflowIndex}]`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.boundingSphere = fragmentBucketBoundingSphere(tileX, tileZ);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = keepResident ? 1 : 0;
    mesh.visible = keepResident;
    const hiddenMatrix = fragmentBucketHiddenMatrix(tileX, tileZ, this.scratchHiddenPosition, this.hiddenScale);
    if (keepResident) {
      mesh.setMatrixAt(0, hiddenMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    const bucket: FragmentInstanceBucket = {
      key,
      groupKey,
      mesh,
      capacity: FRAGMENT_INSTANCE_BUCKET_CAPACITY,
      freeSlots: Array.from({ length: FRAGMENT_INSTANCE_BUCKET_CAPACITY }, (_, index) => FRAGMENT_INSTANCE_BUCKET_CAPACITY - 1 - index),
      owners: new Array(FRAGMENT_INSTANCE_BUCKET_CAPACITY).fill(0),
      highWater: keepResident ? 1 : 0,
      activeCount: 0,
      tileX,
      tileZ,
      overflowIndex,
      keepResident,
      hiddenMatrix
    };
    this.buckets.set(key, bucket);
    this.scene.add(mesh);
    this.markBucketDirty(bucket);
    perfMonitor.addCount("render.fragmentInstanceBucketsCreated");
    return bucket;
  }

  private writeWarmupSlot(bucket: FragmentInstanceBucket, index: number, matrix: THREE.Matrix4): void {
    bucket.highWater = Math.max(bucket.highWater, index + 1);
    bucket.mesh.count = Math.max(bucket.mesh.count, index + 1);
    bucket.mesh.visible = true;
    bucket.mesh.setMatrixAt(index, matrix);
    bucket.mesh.instanceMatrix.needsUpdate = true;
    this.markBucketDirty(bucket);
  }

  private warmupSpatialBuckets(objects: THREE.Object3D[]): void {
    for (const tileX of FRAGMENT_INSTANCE_SPATIAL_WARMUP_TILES) {
      for (const tileZ of FRAGMENT_INSTANCE_SPATIAL_WARMUP_TILES) {
        for (const materialId of this.materials.order) {
          const material = this.materials.get(materialId);
          this.warmupSpatialBucket(
            objects,
            fragmentMainGroupKey(materialId),
            this.materials.getRenderMaterial(materialId),
            `${material.name} instanced fragments`,
            tileX,
            tileZ
          );
          for (const part of fragmentDecorationParts({ materialId, size: fragmentInstanceWarmupSize(materialId) })) {
            this.warmupSpatialBucket(
              objects,
              fragmentDetailGroupKey(part.material),
              part.material,
              `${part.material.name || "fragment detail"} instanced fragment details`,
              tileX,
              tileZ
            );
          }
        }
      }
    }
  }

  private warmupSpatialBucket(
    objects: THREE.Object3D[],
    groupKey: string,
    material: THREE.Material,
    name: string,
    tileX: number,
    tileZ: number
  ): void {
    const bucket = this.bucketForGroup(
      groupKey,
      material,
      name,
      tileX,
      tileZ,
      false,
      "render.fragmentInstanceSpatialWarmupBucketMiss"
    );
    this.writeWarmupSlot(bucket, 0, bucket.hiddenMatrix);
    if (!objects.includes(bucket.mesh)) {
      objects.push(bucket.mesh);
    }
  }

  private parkWarmupSlot(bucket: FragmentInstanceBucket): void {
    this.writeWarmupSlot(bucket, 0, bucket.hiddenMatrix);
  }

  private shrinkBucketHighWater(bucket: FragmentInstanceBucket): void {
    const minimumHighWater = bucket.keepResident ? 1 : 0;
    while (bucket.highWater > minimumHighWater && bucket.owners[bucket.highWater - 1] === 0) {
      bucket.highWater -= 1;
    }
  }

  private refreshBucketDrawState(bucket: FragmentInstanceBucket): void {
    const minimumCount = bucket.keepResident ? 1 : 0;
    bucket.mesh.count = Math.max(minimumCount, bucket.highWater);
    bucket.mesh.visible = bucket.keepResident || bucket.activeCount > 0;
  }

  private markBucketDirty(bucket: FragmentInstanceBucket): void {
    this.dirtyBuckets.add(bucket);
  }
}

class FragmentInstanceVisualProxy implements DynamicVisualProxy {
  constructor(
    private readonly renderer: FragmentInstanceRenderer,
    private slot: FragmentInstanceSlot,
    private readonly size: THREE.Vector3,
    private readonly detailInstances: FragmentDetailInstance[]
  ) {}

  setVisible(visible: boolean): void {
    this.slot = this.renderer.setVisible(this.slot, this.detailInstances, visible);
  }

  sync(position: THREE.Vector3, rotation: THREE.Quaternion): void {
    this.slot = this.renderer.sync(this.slot, this.size, this.detailInstances, position, rotation);
  }

  freeze(position: THREE.Vector3, rotation: THREE.Quaternion): FrozenVisualHandle | null {
    const result = this.renderer.freeze(this.slot, this.size, this.detailInstances, position, rotation);
    if (!result) {
      return null;
    }
    this.slot = result.slot;
    return result.handle;
  }

  dispose(): void {
    this.renderer.release(this.slot);
    for (const detail of this.detailInstances) {
      this.renderer.release(detail.slot);
    }
  }
}

class NullFragmentVisualProxy implements DynamicVisualProxy {
  setVisible(): void {}
  sync(): void {}
  freeze(): FrozenVisualHandle | null {
    return null;
  }
  dispose(): void {}
}

export class DestructionSystem {
  private readonly scratchDirection = new THREE.Vector3();
  private readonly scratchRandomDirection = new THREE.Vector3();
  private readonly scratchAngularVelocity = new THREE.Vector3();
  private readonly scratchUpwardBias = new THREE.Vector3();
  private readonly scratchVisualRotationDelta = new THREE.Quaternion();
  private readonly scratchVisualEuler = new THREE.Euler();
  private readonly upwardBias = new THREE.Vector3(0, 0.58, 0);
  private readonly fractureJobs: FractureJob[] = [];
  private fractureJobHead = 0;
  private readonly queuedFractureIds = new Set<number>();
  private readonly blastSnapshot: PhysicsObject[] = [];
  private readonly visualOnlyFragments: VisualOnlyFragment[] = [];
  private readonly fragmentInstances: FragmentInstanceRenderer;

  constructor(
    private readonly physics: PhysicsWorld,
    scene: THREE.Scene,
    private readonly materials: MaterialCatalog,
    private readonly rng: RandomSource
  ) {
    this.fragmentInstances = new FragmentInstanceRenderer(scene, materials);
  }

  createFragmentVisualPoolWarmupObjects(): THREE.Object3D[] {
    return this.fragmentInstances.warmupObjects();
  }

  showFragmentVisualWarmupPreview(): void {
    this.fragmentInstances.showWarmupPreview();
  }

  parkFragmentVisualWarmupPreview(): void {
    this.fragmentInstances.parkWarmupPreview();
  }

  flushFragmentInstanceBounds(): void {
    this.fragmentInstances.flushBounds();
  }

  updateVisualFragments(deltaSeconds: number): void {
    if (this.visualOnlyFragments.length === 0 || deltaSeconds <= 0) {
      return;
    }
    const startedAt = perfMonitor.timeStart();
    const delta = Math.min(deltaSeconds, 0.05);
    let updated = 0;
    let retired = 0;
    for (let index = this.visualOnlyFragments.length - 1; index >= 0; index -= 1) {
      const fragment = this.visualOnlyFragments[index];
      fragment.ageSeconds += delta;
      if (fragment.ageSeconds >= fragment.lifeSeconds) {
        this.retireVisualOnlyFragmentAt(index);
        retired += 1;
        continue;
      }
      if (!fragment.moving) {
        continue;
      }

      fragment.velocity.y -= VISUAL_FRAGMENT_GRAVITY * delta;
      const damping = Math.max(0, 1 - VISUAL_FRAGMENT_LINEAR_DAMPING * delta);
      fragment.velocity.multiplyScalar(damping);
      fragment.position.addScaledVector(fragment.velocity, delta);
      const floorY = fragment.halfHeight;
      if (fragment.position.y < floorY) {
        fragment.position.y = floorY;
        if (fragment.velocity.y < 0) {
          fragment.velocity.y *= -VISUAL_FRAGMENT_BOUNCE;
          fragment.velocity.x *= 0.62;
          fragment.velocity.z *= 0.62;
        }
      }

      fragment.angularVelocity.multiplyScalar(Math.max(0, 1 - VISUAL_FRAGMENT_ANGULAR_DAMPING * delta));
      this.scratchVisualEuler.set(
        fragment.angularVelocity.x * delta,
        fragment.angularVelocity.y * delta,
        fragment.angularVelocity.z * delta
      );
      this.scratchVisualRotationDelta.setFromEuler(this.scratchVisualEuler);
      fragment.rotation.multiply(this.scratchVisualRotationDelta).normalize();
      fragment.visualProxy.sync(fragment.position, fragment.rotation);
      updated += 1;
      if (fragment.ageSeconds > VISUAL_FRAGMENT_SETTLE_MIN_AGE_SECONDS && fragment.velocity.lengthSq() < VISUAL_FRAGMENT_SETTLE_SPEED_SQ) {
        fragment.moving = false;
      }
    }
    perfMonitor.addCount("destruction.visualOnlyFragmentsActive", this.visualOnlyFragments.length);
    perfMonitor.addCount("destruction.visualOnlyFragmentsUpdated", updated);
    perfMonitor.addCount("destruction.visualOnlyFragmentsRetired", retired);
    perfMonitor.addTiming("destruction.visualOnlyFragments", startedAt);
  }

  clearVisualFragments(): void {
    while (this.visualOnlyFragments.length > 0) {
      this.retireVisualOnlyFragmentAt(this.visualOnlyFragments.length - 1);
    }
  }

  private spawnVisualOnlyFragment(
    material: MaterialDefinition,
    plan: FragmentPlan,
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    origin: THREE.Vector3,
    inheritedVelocity: THREE.Vector3,
    blastStrength: number,
    blastRadius: number,
    sourceWasDebris: boolean
  ): void {
    const visualProxy = this.fragmentInstances.acquire(material.id, plan.size, position, { details: false });
    const offset = position.clone().sub(origin);
    const distance = Math.max(offset.length(), 0.001);
    const falloff = distance < blastRadius ? (1 - distance / blastRadius) ** 1.45 : 0.12;
    const direction = this.computeBlastDirection(offset, material.id === "concrete" || material.id === "metal" ? 0.42 : 0.56, 0.28);
    const speed =
      ((blastStrength * (falloff + 0.12)) / Math.max(0.72, material.massFactor)) *
      (sourceWasDebris ? 0.18 : 0.28) *
      smallFragmentFlightBoost(plan.size);
    const velocity = inheritedVelocity.clone().multiplyScalar(0.16).add(direction.multiplyScalar(speed));
    const angularVelocity = randomUnitVectorInto(new THREE.Vector3(), this.rng).multiplyScalar(
      material.angularResponse * (sourceWasDebris ? 1.8 : 2.8)
    );
    visualProxy.sync(position, rotation);
    this.visualOnlyFragments.push({
      visualProxy,
      position: position.clone(),
      rotation: rotation.clone(),
      velocity,
      angularVelocity,
      halfHeight: Math.max(0.025, plan.size.y * 0.5),
      ageSeconds: 0,
      lifeSeconds: randomRange(this.rng, VISUAL_FRAGMENT_MIN_LIFE_SECONDS, VISUAL_FRAGMENT_MAX_LIFE_SECONDS),
      moving: true
    });
    while (this.visualOnlyFragments.length > MAX_VISUAL_ONLY_FRAGMENTS) {
      this.retireVisualOnlyFragmentAt(0);
    }
  }

  private retireVisualOnlyFragmentAt(index: number): void {
    const fragment = this.visualOnlyFragments[index];
    if (!fragment) {
      return;
    }
    fragment.visualProxy.dispose();
    const last = this.visualOnlyFragments.pop();
    if (last && index < this.visualOnlyFragments.length) {
      this.visualOnlyFragments[index] = last;
    }
  }

  createRuntimeFragmentPipelineWarmupObjects(): number[] {
    const objectIds: number[] = [];
    for (let materialIndex = 0; materialIndex < this.materials.order.length; materialIndex += 1) {
      const materialId = this.materials.order[materialIndex];
      const material = this.materials.get(materialId);
      const parentSize = fragmentInstanceWarmupSize(materialId).multiplyScalar(2.8);
      const fragmentCount = Math.max(6, Math.min(maxFragmentsFor(materialId), RUNTIME_FRAGMENT_PIPELINE_WARMUP_PER_MATERIAL));
      for (let index = 0; index < RUNTIME_FRAGMENT_PIPELINE_WARMUP_PER_MATERIAL; index += 1) {
        const size = this.fragmentSizeFor(materialId, parentSize, fragmentCount).multiplyScalar(0.82 + (index % 5) * 0.11);
        const rotation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(index * 0.23, materialIndex * 0.31 + index * 0.07, (index - materialIndex) * 0.19)
        );
        const position = new THREE.Vector3(
          -2.35 + materialIndex * 0.92 + (index % 4) * 0.08,
          0.34 + Math.floor(index / 4) * 0.12,
          -1.15 + (index % 7) * 0.06
        );
        const visualProxy = this.fragmentInstances.acquire(materialId, size, position);
        const object = this.physics.addDynamicBox({
          label: `${material.name} instanced runtime fragment pipeline warmup`,
          material,
          renderMaterial: this.materials.getRenderMaterial(materialId),
          visualProxy,
          position,
          size,
          rotation,
          destructible: index % 3 === 0,
          canFracture: index % 3 === 0,
          isDebris: true,
          chainSource: true,
          category: "debris",
          scoreRole: "neutral",
          zoneId: "render-warmup",
          scoreValue: 0,
          sleeping: true,
          stageVisualActivation: index % 2 === 0,
          ccd: false,
          collisionEvents: false
        });
        object.visualProxy?.sync(position, rotation);
        objectIds.push(object.id);
      }
    }
    return objectIds;
  }

  explode(origin: THREE.Vector3, blastStrength: number, blastRadius: number): ExplosionResult {
    const startedAt = perfMonitor.timeStart();
    const snapshot = this.physics.getBlastCandidatesInto(this.blastSnapshot, origin, blastRadius);
    const records: BlastRecord[] = [];
    const fractureCandidates: Array<{ object: PhysicsObject; energy: number }> = [];
    const dustColors: THREE.Color[] = [];
    const affectedObjects: ExplosionAffectedObject[] = [];
    let affectedBodies = 0;
    let structureDamage = 0;
    let materialChaos = 0;

    for (const object of snapshot) {
      if (object.category === "projectile") {
        continue;
      }
      const material = this.materials.get(object.materialId);
      const sample = this.sampleObjectForBlast(object, origin);
      if (sample.distance >= blastRadius) {
        continue;
      }

      const falloff = (1 - sample.distance / blastRadius) ** 1.55;
      const volume = Math.max(0.08, object.dimensions.x * object.dimensions.y * object.dimensions.z);
      const energy = (blastStrength * falloff * 2.05) / Math.max(0.5, material.massFactor) + volume * 0.45;
      records.push({ object, material, sample, falloff, energy });
      const thresholdScale = object.scoreRole === "target" ? 1.12 : 1.2;
      if (
        object.destructible &&
        object.canFracture &&
        !this.queuedFractureIds.has(object.id) &&
        energy > fractureThresholdFor(material, object, thresholdScale)
      ) {
        fractureCandidates.push({ object, energy });
      }
    }

    const fractureQueue = fractureCandidates
      .sort((a, b) => b.energy - a.energy)
      .slice(0, MAX_FRACTURES_PER_EXPLOSION);
    const fracturedIds = new Set(fractureQueue.map((entry) => entry.object.id));

    for (const record of records) {
      const { object, material, sample, falloff, energy } = record;
      const fractured = fracturedIds.has(object.id);
      affectedBodies += 1;

      const wholeBodyScale = this.wholeBodyImpulseScale(object, fractured);
      const rawImpulseMagnitude = ((blastStrength * falloff) / Math.max(0.5, material.massFactor)) * wholeBodyScale;
      const impulseMagnitude = Math.min(maxWholeBodyImpulse(object), rawImpulseMagnitude);
      if (impulseMagnitude > 0.01 && object.bodyType === "dynamic") {
        const upward = object.category === "structure" ? 0.16 : 0.42;
        const direction = this.computeBlastDirection(sample.directionOffset, upward, 0.1);
        const impulse = direction.multiplyScalar(impulseMagnitude);
        object.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

        const torque = randomUnitVectorInto(this.scratchRandomDirection, this.rng).multiplyScalar(
          blastStrength * falloff * 0.08 * material.angularResponse * wholeBodyScale
        );
        object.body.applyTorqueImpulse({ x: torque.x, y: torque.y, z: torque.z }, true);
      }

      if (fractured) {
        dustColors.push(material.dustColor);
      }
      const weightedDamage = Math.round(object.scoreValue * Math.min(1.8, energy / Math.max(1, fractureThresholdFor(material, object))));
      if (object.scoreRole === "target") {
        structureDamage += Math.round(weightedDamage * 1.1);
      } else if (object.category === "structure") {
        materialChaos += Math.round(weightedDamage * 0.4);
      }
      materialChaos += Math.round((impulseMagnitude + energy) * (object.isDebris ? 0.3 : 1));
      affectedObjects.push({
        id: object.id,
        label: object.label,
        materialId: object.materialId,
        category: object.category,
        scoreRole: object.scoreRole,
        zoneId: object.zoneId,
        position: sample.position.clone(),
        energy,
        weightedDamage,
        scoreValue: object.scoreValue,
        fractured
      });
    }

    for (const fracture of fractureQueue) {
      this.queueFracture(fracture.object, origin, blastStrength, blastRadius, fracture.energy);
    }
    perfMonitor.addCount("destruction.blastCandidates", snapshot.length);
    perfMonitor.addCount("destruction.blastAffected", affectedBodies);
    perfMonitor.addCount("destruction.fracturesQueued", fractureQueue.length);
    perfMonitor.addTiming("destruction.explode", startedAt);

    return {
      origin: origin.clone(),
      affectedBodies,
      fracturedBodies: fractureQueue.length,
      dustColors,
      affectedObjects,
      structureDamage,
      materialChaos
    };
  }

  impact(source: PhysicsObject, target: PhysicsObject, origin: THREE.Vector3, relativeSpeed: number): ExplosionResult {
    const sourceMaterial = this.materials.get(source.materialId);
    const targetMaterial = this.materials.get(target.materialId);
    const sourceVolume = Math.max(0.02, source.dimensions.x * source.dimensions.y * source.dimensions.z);
    const chainBoost = source.chainSource ? (source.isDebris ? 1.32 : 1.08) : 1;
    const impactMass = Math.max(0.35, sourceVolume * sourceMaterial.density * 7.8 * chainBoost);
    const energy = (relativeSpeed * impactMass * Math.max(0.65, sourceMaterial.massFactor)) / Math.max(0.55, targetMaterial.massFactor);
    const thresholdScale = target.scoreRole === "target" ? 1.08 : 1.16;
    const targetAlreadyQueued = this.queuedFractureIds.has(target.id);
    const sourceAlreadyQueued = this.queuedFractureIds.has(source.id);
    const energeticFracture =
      !targetAlreadyQueued && target.destructible && target.canFracture && energy > fractureThresholdFor(targetMaterial, target, thresholdScale);
    const dominoFracture =
      !targetAlreadyQueued && !energeticFracture && this.shouldDominoFracture(source, target, sourceMaterial, targetMaterial, relativeSpeed, energy);
    const fractured = energeticFracture || dominoFracture;
    const sourceShattered = !sourceAlreadyQueued && this.shouldShatterImpactSource(source, sourceMaterial, relativeSpeed, energy);
    const sourcePosition = vectorFromRapier(source.body.translation());
    const targetPosition = vectorFromRapier(target.body.translation());
    const direction = targetPosition.clone().sub(sourcePosition).normalize();
    const impulseMagnitude = Math.min(dominoFracture ? 11 : 18, Math.max(dominoFracture ? 2.8 : 0, energy * 0.24));
    if (impulseMagnitude > 0.01 && target.bodyType === "dynamic" && this.physics.getObject(target.id)) {
      target.body.applyImpulse(
        {
          x: direction.x * impulseMagnitude,
          y: Math.max(0.04, direction.y + 0.06) * impulseMagnitude,
          z: direction.z * impulseMagnitude
        },
        true
      );
      target.body.applyTorqueImpulse(
        {
          x: direction.z * impulseMagnitude * 0.08,
          y: impulseMagnitude * 0.025,
          z: -direction.x * impulseMagnitude * 0.08
        },
        true
      );
    }

    const weightedDamage = Math.round(target.scoreValue * Math.min(1.6, energy / Math.max(1, fractureThresholdFor(targetMaterial, target))));
    let structureDamage = 0;
    let materialChaos = 0;
    if (target.scoreRole === "target") {
      structureDamage = Math.round(weightedDamage * 1.1);
    } else if (target.category === "structure") {
      materialChaos = Math.round(weightedDamage * 0.45);
    }
    materialChaos += Math.round(energy * 0.65);

    const affectedObjects: ExplosionAffectedObject[] = [];
    const affectedObject: ExplosionAffectedObject = {
      id: target.id,
      label: target.label,
      materialId: target.materialId,
      category: target.category,
      scoreRole: target.scoreRole,
      zoneId: target.zoneId,
      position: targetPosition,
      energy,
      weightedDamage,
      scoreValue: target.scoreValue,
      fractured
    };
    affectedObjects.push(affectedObject);

    if (fractured && this.physics.getObject(target.id)) {
      this.queueFracture(target, origin, Math.max(dominoFracture ? 5.5 : 8, energy * (dominoFracture ? 0.34 : 0.52)), 1.35, energy);
    }
    if (sourceShattered && this.physics.getObject(source.id)) {
      const sourceWeightedDamage = Math.round(source.scoreValue * Math.min(1.2, energy / Math.max(1, fractureThresholdFor(sourceMaterial, source, 1.6))));
      affectedObjects.push({
        id: source.id,
        label: source.label,
        materialId: source.materialId,
        category: source.category,
        scoreRole: source.scoreRole,
        zoneId: source.zoneId,
        position: sourcePosition,
        energy: energy * 0.45,
        weightedDamage: sourceWeightedDamage,
        scoreValue: source.scoreValue,
        fractured: true
      });
      this.queueFracture(source, origin, Math.max(7, energy * 0.18), 1.05, energy * 0.48);
    }

    return {
      origin: origin.clone(),
      affectedBodies: sourceShattered ? 2 : 1,
      fracturedBodies: (fractured ? 1 : 0) + (sourceShattered ? 1 : 0),
      dustColors: [fractured ? targetMaterial.dustColor : null, sourceShattered ? sourceMaterial.dustColor : null].filter(
        (color): color is THREE.Color => color !== null
      ),
      affectedObjects,
      structureDamage,
      materialChaos
    };
  }

  groundImpact(source: PhysicsObject, origin: THREE.Vector3, impactSpeed: number): ExplosionResult {
    const material = this.materials.get(source.materialId);
    const sourceVolume = Math.max(0.02, source.dimensions.x * source.dimensions.y * source.dimensions.z);
    const energy = impactSpeed * sourceVolume * material.density * Math.max(0.55, material.massFactor) * (source.isDebris ? 4.8 : 3.9);
    const thresholdScale = source.isDebris ? 1.06 : 1.32;
    const canFracture =
      source.destructible && source.canFracture && source.category !== "projectile" && !this.queuedFractureIds.has(source.id);
    const energyRatio = energy / Math.max(1, fractureThresholdFor(material, source, thresholdScale));
    const breakChance = clamp(
      -0.26 + energyRatio * 0.26 + Math.max(0, impactSpeed - groundFractureMinSpeed(source)) * 0.04 + materialDominoFragility(material.id) * 0.05,
      0,
      source.isDebris ? 0.36 : 0.24
    );
    const fractured = canFracture && impactSpeed >= groundFractureMinSpeed(source) && energyRatio >= 0.95 && this.rng.next() < breakChance;
    const sourcePosition = vectorFromRapier(source.body.translation());
    const weightedDamage = Math.round(source.scoreValue * Math.min(1.35, energyRatio));

    let structureDamage = 0;
    let materialChaos = Math.round(energy * (source.isDebris ? 0.42 : 0.58));
    if (source.scoreRole === "target") {
      structureDamage = Math.round(weightedDamage * (fractured ? 0.82 : 0.34));
    }

    const affectedObject: ExplosionAffectedObject = {
      id: source.id,
      label: source.label,
      materialId: source.materialId,
      category: source.category,
      scoreRole: source.scoreRole,
      zoneId: source.zoneId,
      position: sourcePosition,
      energy,
      weightedDamage,
      scoreValue: source.scoreValue,
      fractured
    };

    if (fractured && this.physics.getObject(source.id)) {
      this.queueFracture(source, origin, Math.max(4.8, energy * 0.18), 0.95, energy * 0.62);
    }

    return {
      origin: origin.clone(),
      affectedBodies: 1,
      fracturedBodies: fractured ? 1 : 0,
      dustColors: fractured ? [material.dustColor] : [],
      affectedObjects: [affectedObject],
      structureDamage,
      materialChaos
    };
  }

  spawnTower(materialId: MaterialId, basePosition: THREE.Vector3): void {
    const material = this.materials.get(materialId);
    const renderMaterial = this.materials.getRenderMaterial(materialId);
    const isBeam = materialId === "metal";
    const size = isBeam ? new THREE.Vector3(0.45, 0.42, 1.2) : new THREE.Vector3(0.75, 0.55, 0.75);
    const columns = 3;
    const levels = 5;

    for (let y = 0; y < levels; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const position = new THREE.Vector3(
          basePosition.x + (x - 1) * (size.x + 0.04),
          basePosition.y + size.y * 0.5 + y * (size.y + 0.035),
          basePosition.z
        );
        const rotation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, isBeam && y % 2 === 0 ? Math.PI * 0.5 : 0, 0)
        );
        this.physics.addDynamicBox({
          label: `${material.name} test block`,
          material,
          renderMaterial,
          position,
          size,
          rotation,
          destructible: true,
          canFracture: true,
          isDebris: false
        });
      }
    }
  }

  processQueuedFractures(maxFractures: number, timeBudgetMs: number): QueuedFractureStats {
    const startedAt = perfMonitor.timeStart();
    const deadline = performance.now() + Math.max(0.2, timeBudgetMs);
    let processed = 0;
    while (this.fractureJobHead < this.fractureJobs.length && processed < maxFractures) {
      if (processed > 0 && performance.now() >= deadline) {
        break;
      }
      const job = this.fractureJobs[this.fractureJobHead];
      this.fractureJobHead += 1;
      if (!job) {
        break;
      }
      this.queuedFractureIds.delete(job.objectId);
      const object = this.physics.getObject(job.objectId);
      if (!object || !object.destructible || !object.canFracture) {
        continue;
      }
      this.fracture(object, job.origin, job.blastStrength, job.blastRadius, job.energy);
      processed += 1;
    }
    this.compactFractureJobs();
    const remaining = this.getQueuedFractureCount();
    if (processed > 0 || remaining > 0) {
      perfMonitor.addCount("destruction.fracturesProcessed", processed);
      perfMonitor.addCount("destruction.fracturesBacklog", remaining);
      perfMonitor.addTiming("destruction.processQueuedFractures", startedAt);
    }
    return {
      processed,
      remaining
    };
  }

  clearQueuedFractures(): void {
    this.fractureJobs.length = 0;
    this.fractureJobHead = 0;
    this.queuedFractureIds.clear();
  }

  getQueuedFractureCount(): number {
    return this.fractureJobs.length - this.fractureJobHead;
  }

  private queueFracture(
    object: PhysicsObject,
    origin: THREE.Vector3,
    blastStrength: number,
    blastRadius: number,
    energy: number
  ): void {
    if (this.queuedFractureIds.has(object.id)) {
      return;
    }
    if (this.getQueuedFractureCount() >= MAX_QUEUED_FRACTURES) {
      this.compactFractureJobs(true);
      if (this.getQueuedFractureCount() >= MAX_QUEUED_FRACTURES) {
        perfMonitor.addCount("destruction.fracturesDroppedByQueueCap");
        return;
      }
    }
    this.queuedFractureIds.add(object.id);
    this.fractureJobs.push({
      objectId: object.id,
      origin: origin.clone(),
      blastStrength,
      blastRadius,
      energy
    });
  }

  private compactFractureJobs(force = false): void {
    if (this.fractureJobHead === 0) {
      return;
    }
    if (this.fractureJobHead >= this.fractureJobs.length) {
      this.fractureJobs.length = 0;
      this.fractureJobHead = 0;
      return;
    }
    if (force || (this.fractureJobHead > FRACTURE_QUEUE_COMPACT_HEAD && this.fractureJobHead * 2 > this.fractureJobs.length)) {
      this.fractureJobs.splice(0, this.fractureJobHead);
      this.fractureJobHead = 0;
    }
  }

  private fracture(
    object: PhysicsObject,
    origin: THREE.Vector3,
    blastStrength: number,
    blastRadius: number,
    energy: number
  ): void {
    const startedAt = perfMonitor.timeStart();
    const material = this.materials.get(object.materialId);
    const parentPosition = vectorFromRapier(object.body.translation());
    const parentRotation = quaternionFromRapier(object.body.rotation());
    const inheritedVelocity = vectorFromRapier(object.body.linvel());
    const plans = this.createFragmentPlans(object.dimensions, material, energy);

    this.physics.removeObject(object.id);
    this.physics.destabilizeUnsupportedStructures(object, parentPosition);

    const immediateVisualPlanIndexes = immediateFragmentVisualPlanIndexes(plans, object.isDebris);
    const collisionEventPlanIndexes = fragmentCollisionEventPlanIndexes(plans, object.isDebris);
    const physicalPlanIndexes = physicalFragmentPlanIndexes(plans, object.isDebris, collisionEventPlanIndexes);
    let collisionEventFragments = 0;
    let visualOnlyFragments = 0;

    for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
      const plan = plans[planIndex];
      const planVolume = fragmentVolume(plan.size);
      const worldOffset = plan.offset.clone().applyQuaternion(parentRotation);
      const fragmentPosition = parentPosition.clone().add(worldOffset);
      const rotation = parentRotation.clone().multiply(plan.rotation);
      const breakableFragment = !object.isDebris && canFragmentShatterAgain(material.id, plan.size);
      const physicalFragment = physicalPlanIndexes.has(planIndex);
      const chainFragment = physicalFragment && shouldFragmentDriveChain(object, planVolume, planIndex, breakableFragment);
      const fragmentCollisionEvents = physicalFragment && chainFragment && collisionEventPlanIndexes.has(planIndex);
      const fragmentCcd = fragmentCollisionEvents && !object.isDebris && (breakableFragment || planIndex < IMMEDIATE_PRIMARY_FRAGMENT_VISUALS);
      const stageVisualActivation = !immediateVisualPlanIndexes.has(planIndex);
      if (!physicalFragment) {
        this.spawnVisualOnlyFragment(
          material,
          plan,
          fragmentPosition,
          rotation,
          origin,
          inheritedVelocity,
          blastStrength,
          blastRadius,
          object.isDebris
        );
        visualOnlyFragments += 1;
        continue;
      }
      const visualProxy = this.fragmentInstances.acquire(material.id, plan.size, fragmentPosition);
      const fragment = this.physics.addDynamicBox({
        label: `${material.name} debris`,
        material,
        renderMaterial: this.materials.getRenderMaterial(material.id),
        visualProxy,
        position: fragmentPosition,
        size: plan.size,
        rotation,
        destructible: breakableFragment,
        canFracture: breakableFragment,
        isDebris: true,
        chainSource: chainFragment,
        category: "debris",
        scoreRole: "neutral",
        zoneId: object.zoneId,
        scoreValue: Math.max(1, Math.round(object.scoreValue / plans.length)),
        linearVelocity: inheritedVelocity.clone().multiplyScalar(0.22),
        angularVelocity: randomUnitVectorInto(this.scratchAngularVelocity, this.rng).multiplyScalar(material.angularResponse * 2.35),
        ccd: fragmentCcd,
        stageVisualActivation,
        collisionEvents: fragmentCollisionEvents,
        collisionLayer: chainFragment ? "chain-debris" : "passive-debris"
      });
      if (fragmentCollisionEvents) {
        collisionEventFragments += 1;
      }
      fragment.visualProxy?.sync(fragmentPosition, rotation);
      this.kickFragment(fragment, origin, blastStrength, blastRadius);
      limitFragmentMotion(fragment, material.id, object.isDebris);
    }
    perfMonitor.addCount("destruction.fragmentsCreated", plans.length);
    perfMonitor.addCount("destruction.visualOnlyFragmentsCreated", visualOnlyFragments);
    perfMonitor.addCount("destruction.physicalFragmentsCreated", plans.length - visualOnlyFragments);
    perfMonitor.addCount("destruction.fragmentCollisionEventSources", collisionEventFragments);
    perfMonitor.addTiming("destruction.fracture", startedAt);
  }

  private createFragmentPlans(size: THREE.Vector3, material: MaterialDefinition, energy: number): FragmentPlan[] {
    const [minCount, maxCount] = material.fragmentCount;
    const fragmentBudget = maxFragmentsFor(material.id);
    const minBudget = Math.min(minCount, fragmentBudget);
    const maxBudget = Math.max(minBudget, Math.min(maxCount + 4, fragmentBudget));
    const energyBonus = Math.min(4, Math.floor(Math.max(0, energy - material.fractureThreshold) / 10));
    const count = clampInt(randomInt(this.rng, minCount, maxCount) + energyBonus, minBudget, maxBudget);
    const plans: FragmentPlan[] = [];

    for (let i = 0; i < count; i += 1) {
      const offset = new THREE.Vector3(
        randomRange(this.rng, -0.5, 0.5) * size.x * 0.78,
        randomRange(this.rng, -0.5, 0.5) * size.y * 0.78,
        randomRange(this.rng, -0.5, 0.5) * size.z * 0.78
      );
      const fragmentSize = this.fragmentSizeFor(material.id, size, count);
      const rotation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(this.rng.next() * Math.PI, this.rng.next() * Math.PI, this.rng.next() * Math.PI)
      );
      plans.push({ size: fragmentSize, offset, rotation, material });
    }

    return plans;
  }

  private fragmentSizeFor(materialId: MaterialId, parentSize: THREE.Vector3, count: number): THREE.Vector3 {
    const base = Math.cbrt((parentSize.x * parentSize.y * parentSize.z) / count);
    if (materialId === "glass") {
      return new THREE.Vector3(
        clamp(base * randomRange(this.rng, 0.28, 0.74), 0.05, parentSize.x * 0.45),
        clamp(base * randomRange(this.rng, 0.035, 0.12), 0.025, 0.12),
        clamp(base * randomRange(this.rng, 0.65, 1.45), 0.1, parentSize.z * 0.7)
      );
    }
    if (materialId === "metal") {
      const longAxis = Math.max(parentSize.x, parentSize.y, parentSize.z) * randomRange(this.rng, 0.28, 0.52);
      return new THREE.Vector3(clamp(base * 0.42, 0.08, 0.35), clamp(base * 0.45, 0.08, 0.35), clamp(longAxis, 0.28, 1.3));
    }
    if (materialId === "concrete") {
      return new THREE.Vector3(
        clamp(base * randomRange(this.rng, 0.65, 1.35), 0.12, parentSize.x * 0.55),
        clamp(base * randomRange(this.rng, 0.55, 1.2), 0.12, parentSize.y * 0.55),
        clamp(base * randomRange(this.rng, 0.65, 1.35), 0.12, parentSize.z * 0.55)
      );
    }
    if (materialId === "wood") {
      return new THREE.Vector3(
        clamp(base * randomRange(this.rng, 0.35, 0.85), 0.08, parentSize.x * 0.5),
        clamp(base * randomRange(this.rng, 0.35, 0.9), 0.08, parentSize.y * 0.5),
        clamp(base * randomRange(this.rng, 0.75, 1.75), 0.12, parentSize.z * 0.75)
      );
    }
    if (materialId === "foam") {
      return new THREE.Vector3(base * randomRange(this.rng, 0.5, 1.0), base * randomRange(this.rng, 0.45, 0.9), base * randomRange(this.rng, 0.5, 1.0));
    }
    return new THREE.Vector3(base * randomRange(this.rng, 0.55, 1.15), base * randomRange(this.rng, 0.55, 1.15), base * randomRange(this.rng, 0.55, 1.15));
  }

  private kickFragment(fragment: PhysicsObject, origin: THREE.Vector3, blastStrength: number, blastRadius: number): void {
    const material = this.materials.get(fragment.materialId);
    const position = vectorFromRapier(fragment.body.translation());
    const offset = position.sub(origin);
    const distance = Math.max(offset.length(), 0.001);
    const falloff = distance < blastRadius ? (1 - distance / blastRadius) ** 1.45 : 0.12;
    const smallFragmentBoost = smallFragmentFlightBoost(fragment.dimensions);
    const lift = material.id === "concrete" || material.id === "metal" ? 0.52 : 0.68;
    const direction = this.computeBlastDirection(offset, lift, 0.24);
    const impulseMagnitude =
      (blastStrength * (falloff + 0.18)) / Math.max(0.48, material.massFactor) * 0.78 * smallFragmentBoost;
    const impulse = direction.multiplyScalar(impulseMagnitude);
    fragment.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

    const torque = randomUnitVectorInto(this.scratchRandomDirection, this.rng).multiplyScalar(
      blastStrength * 0.13 * material.angularResponse * smallFragmentBoost
    );
    fragment.body.applyTorqueImpulse({ x: torque.x, y: torque.y, z: torque.z }, true);
  }

  private wholeBodyImpulseScale(object: PhysicsObject, fractured: boolean): number {
    if (fractured) {
      return 0;
    }
    if (object.isDebris) {
      return 0.62;
    }
    if (object.category === "structure") {
      return object.canFracture ? 0.14 : 0.24;
    }
    return 0.72;
  }

  private shouldShatterImpactSource(
    source: PhysicsObject,
    material: MaterialDefinition,
    relativeSpeed: number,
    impactEnergy: number
  ): boolean {
    if (source.category === "projectile" || !source.destructible || !source.canFracture) {
      return false;
    }
    const volume = source.dimensions.x * source.dimensions.y * source.dimensions.z;
    if (volume < 0.045 || relativeSpeed < 4.2) {
      return false;
    }
    const energyRatio = impactEnergy / Math.max(1, fractureThresholdFor(material, source, source.isDebris ? 1.25 : 1.75));
    const chance = clamp(0.04 + energyRatio * 0.12 + relativeSpeed * 0.005, 0.02, source.isDebris ? 0.3 : 0.2);
    return energyRatio >= 1.15 && this.rng.next() < chance;
  }

  private shouldDominoFracture(
    source: PhysicsObject,
    target: PhysicsObject,
    sourceMaterial: MaterialDefinition,
    targetMaterial: MaterialDefinition,
    relativeSpeed: number,
    impactEnergy: number
  ): boolean {
    if (!source.chainSource || !target.destructible || !target.canFracture) {
      return false;
    }
    if (relativeSpeed < 3) {
      return false;
    }

    const sourceVolume = source.dimensions.x * source.dimensions.y * source.dimensions.z;
    const targetFragility = materialDominoFragility(targetMaterial.id);
    const sourceBite = materialDominoBite(sourceMaterial.id);
    const speedFactor = clamp((relativeSpeed - 2.5) / 5.4, 0, 1);
    const massFactor = clamp(sourceVolume / 0.075, 0.25, 1.35);
    const energyFactor = clamp(impactEnergy / Math.max(1, fractureThresholdFor(targetMaterial, target)), 0, 1);
    const chance = clamp(0.015 + targetFragility * 0.08 + sourceBite * 0.05 + speedFactor * 0.11 + massFactor * 0.04 + energyFactor * 0.08, 0, 0.22);
    return this.rng.next() < chance;
  }

  private sampleObjectForBlast(object: PhysicsObject, origin: THREE.Vector3): BlastSample {
    const center = vectorFromRapier(object.body.translation());
    const centerOffset = center.clone().sub(origin);

    if (object.shape === "sphere") {
      const centerDistance = centerOffset.length();
      const directionOffset = centerDistance > 0.0001 ? centerOffset.clone() : new THREE.Vector3(0, 1, 0);
      const direction = directionOffset.clone().normalize();
      return {
        position: center.clone().sub(direction.multiplyScalar(object.radius)),
        directionOffset,
        distance: Math.max(0.001, centerDistance - object.radius)
      };
    }

    const rotation = quaternionFromRapier(object.body.rotation());
    const inverseRotation = rotation.clone().invert();
    const localOrigin = origin.clone().sub(center).applyQuaternion(inverseRotation);
    const halfSize = object.dimensions.clone().multiplyScalar(0.5);
    const closestLocal = new THREE.Vector3(
      clamp(localOrigin.x, -halfSize.x, halfSize.x),
      clamp(localOrigin.y, -halfSize.y, halfSize.y),
      clamp(localOrigin.z, -halfSize.z, halfSize.z)
    );
    const closestWorld = closestLocal.applyQuaternion(rotation).add(center);
    const surfaceOffset = closestWorld.clone().sub(origin);

    return {
      position: closestWorld,
      directionOffset: centerOffset.lengthSq() > 0.0001 ? centerOffset : surfaceOffset,
      distance: Math.max(surfaceOffset.length(), 0.001)
    };
  }

  private computeBlastDirection(offset: THREE.Vector3, upwardBias = this.upwardBias.y, randomBias = 0.2): THREE.Vector3 {
    this.scratchDirection.copy(offset);
    if (this.scratchDirection.lengthSq() < 0.0001) {
      this.scratchDirection.copy(randomUnitVectorInto(this.scratchRandomDirection, this.rng));
    }
    this.scratchDirection.normalize();
    this.scratchDirection.add(this.scratchUpwardBias.set(0, upwardBias, 0));
    this.scratchDirection.add(randomUnitVectorInto(this.scratchRandomDirection, this.rng).multiplyScalar(randomBias));
    return this.scratchDirection.normalize().clone();
  }
}

function vectorFromRapier(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function quaternionFromRapier(q: { x: number; y: number; z: number; w: number }): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.floor(clamp(value, min, max));
}

function immediateFragmentVisualPlanIndexes(plans: FragmentPlan[], sourceWasDebris: boolean): Set<number> {
  if (plans.length <= IMMEDIATE_PRIMARY_FRAGMENT_VISUALS) {
    return new Set(plans.map((_, index) => index));
  }
  const budget = sourceWasDebris ? IMMEDIATE_DEBRIS_FRAGMENT_VISUALS : IMMEDIATE_PRIMARY_FRAGMENT_VISUALS;
  return new Set(
    plans
      .map((plan, index) => ({ index, volume: fragmentVolume(plan.size) }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, budget)
      .map((entry) => entry.index)
  );
}

function fragmentCollisionEventPlanIndexes(plans: FragmentPlan[], sourceWasDebris: boolean): Set<number> {
  const budget = sourceWasDebris ? SECONDARY_CHAIN_EVENT_FRAGMENT_LIMIT : PRIMARY_CHAIN_EVENT_FRAGMENT_LIMIT;
  if (plans.length <= budget) {
    return new Set(plans.map((_, index) => index));
  }
  return new Set(
    plans
      .map((plan, index) => ({ index, volume: fragmentVolume(plan.size) }))
      .filter((entry) => !sourceWasDebris || entry.volume >= CHAIN_EVENT_FRAGMENT_MIN_VOLUME)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, budget)
      .map((entry) => entry.index)
  );
}

function physicalFragmentPlanIndexes(
  plans: FragmentPlan[],
  sourceWasDebris: boolean,
  collisionEventIndexes: Set<number>
): Set<number> {
  const budget = sourceWasDebris ? SECONDARY_PHYSICAL_FRAGMENT_LIMIT : PRIMARY_PHYSICAL_FRAGMENT_LIMIT;
  const selected = new Set(collisionEventIndexes);
  if (selected.size >= budget) {
    return selected;
  }
  const byVolume = plans
    .map((plan, index) => ({ index, volume: fragmentVolume(plan.size) }))
    .sort((a, b) => b.volume - a.volume);
  for (const entry of byVolume) {
    if (selected.size >= budget) {
      break;
    }
    if (selected.has(entry.index)) {
      continue;
    }
    if (entry.volume < MIN_PHYSICAL_FRAGMENT_VOLUME && selected.size > 0) {
      continue;
    }
    selected.add(entry.index);
  }
  return selected;
}

function fragmentVolume(size: THREE.Vector3): number {
  return size.x * size.y * size.z;
}

function fragmentMainGroupKey(materialId: MaterialId): string {
  return `main:${materialId}`;
}

function fragmentDetailGroupKey(material: THREE.Material): string {
  return `detail:${material.uuid}`;
}

function fragmentInstanceTileCoordinate(value: number): number {
  return Math.max(
    FRAGMENT_INSTANCE_MIN_TILE,
    Math.min(
      FRAGMENT_INSTANCE_MAX_TILE,
      Math.floor((value + FRAGMENT_INSTANCE_SPATIAL_TILE_SIZE * 0.5) / FRAGMENT_INSTANCE_SPATIAL_TILE_SIZE)
    )
  );
}

function fragmentBucketFamilyKey(groupKey: string, tileX: number, tileZ: number): string {
  return `${groupKey}:${tileX}:${tileZ}`;
}

function fragmentBucketKey(groupKey: string, tileX: number, tileZ: number, overflowIndex: number): string {
  return `${fragmentBucketFamilyKey(groupKey, tileX, tileZ)}:${overflowIndex}`;
}

function fragmentBucketHiddenMatrix(
  tileX: number,
  tileZ: number,
  scratchPosition: THREE.Vector3,
  hiddenScale: THREE.Vector3
): THREE.Matrix4 {
  scratchPosition.set(
    tileX * FRAGMENT_INSTANCE_SPATIAL_TILE_SIZE,
    FRAGMENT_INSTANCE_BUCKET_CENTER_Y,
    tileZ * FRAGMENT_INSTANCE_SPATIAL_TILE_SIZE
  );
  return new THREE.Matrix4().compose(scratchPosition, new THREE.Quaternion(), hiddenScale);
}

function fragmentBucketBoundingSphere(tileX: number, tileZ: number): THREE.Sphere {
  return new THREE.Sphere(
    new THREE.Vector3(
      tileX * FRAGMENT_INSTANCE_SPATIAL_TILE_SIZE,
      FRAGMENT_INSTANCE_BUCKET_CENTER_Y,
      tileZ * FRAGMENT_INSTANCE_SPATIAL_TILE_SIZE
    ),
    FRAGMENT_INSTANCE_BUCKET_BOUND_RADIUS
  );
}

function shouldFragmentDriveChain(
  source: PhysicsObject,
  planVolume: number,
  planIndex: number,
  breakableFragment: boolean
): boolean {
  if (breakableFragment) {
    return true;
  }
  if (!source.isDebris) {
    return true;
  }
  return planIndex < SECONDARY_CHAIN_FRAGMENT_LIMIT && planVolume >= SECONDARY_CHAIN_FRAGMENT_MIN_VOLUME;
}

function maxFragmentsFor(materialId: MaterialId): number {
  switch (materialId) {
    case "glass":
      return 22;
    case "foam":
      return 16;
    case "wood":
    case "concrete":
      return 13;
    case "metal":
      return 11;
    default:
      return 10;
  }
}

function maxWholeBodyImpulse(object: PhysicsObject): number {
  if (object.isDebris) {
    return 7.5;
  }
  if (object.category === "structure") {
    return object.canFracture ? 5.8 : 8.5;
  }
  return 9.5;
}

function groundFractureMinSpeed(object: PhysicsObject): number {
  if (object.isDebris) {
    return object.materialId === "glass" || object.materialId === "foam" ? 3.2 : 3.8;
  }
  if (object.materialId === "glass" || object.materialId === "foam") {
    return 4.0;
  }
  if (object.materialId === "wood") {
    return 4.6;
  }
  return 5.1;
}

function limitFragmentMotion(fragment: PhysicsObject, materialId: MaterialId, sourceWasDebris: boolean): void {
  const velocity = vectorFromRapier(fragment.body.linvel());
  const maxSpeed = sourceWasDebris ? 4.2 : maxInitialFragmentSpeed(materialId);
  if (velocity.length() > maxSpeed) {
    velocity.setLength(maxSpeed);
  }
  velocity.y = Math.min(velocity.y, maxSpeed * verticalFragmentSpeedScale(materialId));
  fragment.body.setLinvel({ x: velocity.x, y: velocity.y, z: velocity.z }, true);

  const angularVelocity = vectorFromRapier(fragment.body.angvel());
  const maxAngularSpeed = sourceWasDebris ? 4.8 : 7.2;
  if (angularVelocity.length() > maxAngularSpeed) {
    angularVelocity.setLength(maxAngularSpeed);
    fragment.body.setAngvel({ x: angularVelocity.x, y: angularVelocity.y, z: angularVelocity.z }, true);
  }
}

function maxInitialFragmentSpeed(materialId: MaterialId): number {
  switch (materialId) {
    case "glass":
    case "foam":
      return 8.4;
    case "wood":
      return 7.0;
    case "metal":
    case "concrete":
      return 6.2;
    default:
      return 6.5;
  }
}

function verticalFragmentSpeedScale(materialId: MaterialId): number {
  switch (materialId) {
    case "glass":
    case "foam":
      return 0.72;
    case "wood":
      return 0.64;
    default:
      return 0.58;
  }
}

function smallFragmentFlightBoost(size: THREE.Vector3): number {
  const longestAxis = Math.max(size.x, size.y, size.z);
  return THREE.MathUtils.clamp(0.42 / Math.max(0.12, longestAxis), 1, 1.55);
}

function materialDominoFragility(materialId: MaterialId): number {
  switch (materialId) {
    case "glass":
      return 1.0;
    case "foam":
      return 0.86;
    case "wood":
      return 0.62;
    case "concrete":
      return 0.36;
    case "metal":
    case "rubber":
      return 0.24;
    default:
      return 0.4;
  }
}

function materialDominoBite(materialId: MaterialId): number {
  switch (materialId) {
    case "metal":
    case "concrete":
      return 1.0;
    case "glass":
      return 0.78;
    case "wood":
      return 0.62;
    case "rubber":
    case "foam":
      return 0.42;
    default:
      return 0.5;
  }
}

function canFragmentShatterAgain(materialId: MaterialId, size: THREE.Vector3): boolean {
  const longestAxis = Math.max(size.x, size.y, size.z);
  const volume = size.x * size.y * size.z;
  switch (materialId) {
    case "glass":
      return longestAxis >= 0.34 && volume >= 0.014;
    case "concrete":
      return longestAxis >= 0.42 && volume >= 0.026;
    case "metal":
      return longestAxis >= 0.58 && volume >= 0.018;
    case "wood":
      return longestAxis >= 0.46 && volume >= 0.018;
    case "foam":
      return longestAxis >= 0.5 && volume >= 0.022;
    default:
      return false;
  }
}
