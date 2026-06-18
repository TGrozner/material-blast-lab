import * as THREE from "three";
import { fragmentDecorationParts } from "./cityVisuals";
import { MaterialCatalog, type MaterialDefinition, type MaterialId } from "./materialCatalog";
import { perfMonitor } from "./perf";
import { PhysicsWorld, type DynamicVisualProxy, type FrozenVisualHandle, type PhysicsCategory, type PhysicsObject, type ScoreRole } from "./physics";
import { type RandomSource, randomInt, randomRange, randomUnitVector } from "./random";

const IMMEDIATE_PRIMARY_FRAGMENT_VISUALS = 6;
const IMMEDIATE_DEBRIS_FRAGMENT_VISUALS = 3;
const FRAGMENT_INSTANCE_CAPACITY_PER_MATERIAL = 2048;
const FRAGMENT_POOL_PARK_Y = -10000;
const FRAGMENT_INSTANCE_WARMUP_PREVIEW_COUNT = 192;
const RUNTIME_FRAGMENT_PIPELINE_WARMUP_PER_MATERIAL = 28;

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
  bucketKey: string;
  index: number;
  renderer: FragmentInstanceRenderer;
  visible: boolean;
}

interface FragmentDetailInstance {
  slot: FragmentInstanceSlot;
  localMatrix: THREE.Matrix4;
}

interface FragmentInstanceBucket {
  key: string;
  mesh: THREE.InstancedMesh;
  capacity: number;
  freeSlots: number[];
  occupied: boolean[];
  highWater: number;
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
  private readonly hiddenMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0, FRAGMENT_POOL_PARK_Y, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(0.001, 0.001, 0.001)
  );
  private readonly scratchParentMatrix = new THREE.Matrix4();
  private readonly scratchRigidMatrix = new THREE.Matrix4();
  private readonly scratchWorldMatrix = new THREE.Matrix4();
  private readonly unitScale = new THREE.Vector3(1, 1, 1);
  private readonly warmupQuaternion = new THREE.Quaternion();

  constructor(private readonly materials: MaterialCatalog) {}

  warmupObjects(): THREE.Object3D[] {
    const objects: THREE.Object3D[] = [];
    for (const materialId of this.materials.order) {
      const bucket = this.mainBucketFor(materialId);
      this.parkWarmupSlot(bucket);
      objects.push(bucket.mesh);
      for (const part of fragmentDecorationParts({ materialId, size: fragmentInstanceWarmupSize(materialId) })) {
        const detailBucket = this.detailBucketFor(part.material);
        this.parkWarmupSlot(detailBucket);
        if (!objects.includes(detailBucket.mesh)) {
          objects.push(detailBucket.mesh);
        }
      }
    }
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
        this.writeWarmupSlot(this.mainBucketFor(materialId), instanceIndex, this.scratchParentMatrix);
        this.scratchRigidMatrix.compose(position, this.warmupQuaternion, this.unitScale);
        for (const part of fragmentDecorationParts({ materialId, size })) {
          const localRotation = new THREE.Quaternion().setFromEuler(part.rotation);
          const localMatrix = new THREE.Matrix4().compose(part.offset, localRotation, part.size);
          this.scratchWorldMatrix.multiplyMatrices(this.scratchRigidMatrix, localMatrix);
          this.writeWarmupSlot(this.detailBucketFor(part.material), instanceIndex, this.scratchWorldMatrix);
        }
      }
    });
  }

  parkWarmupPreview(): void {
    for (const bucket of this.buckets.values()) {
      const warmupCount = Math.min(bucket.mesh.count, FRAGMENT_INSTANCE_WARMUP_PREVIEW_COUNT);
      for (let index = 0; index < warmupCount; index += 1) {
        bucket.mesh.setMatrixAt(index, this.hiddenMatrix);
      }
      bucket.mesh.count = Math.max(bucket.highWater, FRAGMENT_INSTANCE_WARMUP_PREVIEW_COUNT);
      bucket.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  acquire(materialId: MaterialId, size: THREE.Vector3): DynamicVisualProxy {
    const mainSlot = this.acquireSlot(this.mainBucketFor(materialId), "render.fragmentInstanceSlotMiss", "render.fragmentInstanceSlotReuse");
    if (!mainSlot) {
      return new NullFragmentVisualProxy();
    }
    const detailInstances: FragmentDetailInstance[] = [];
    for (const part of fragmentDecorationParts({ materialId, size })) {
      const detailSlot = this.acquireSlot(
        this.detailBucketFor(part.material),
        "render.fragmentDetailInstanceSlotMiss",
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
    return new FragmentInstanceVisualProxy(this, mainSlot, size.clone(), detailInstances);
  }

  setVisible(slot: FragmentInstanceSlot, detailInstances: FragmentDetailInstance[], visible: boolean): void {
    if (!slot.renderer.slotIsCurrent(slot)) {
      return;
    }
    slot.visible = visible;
    this.writeSlotMatrix(slot);
    for (const detail of detailInstances) {
      if (!detail.slot.renderer.slotIsCurrent(detail.slot)) {
        continue;
      }
      detail.slot.visible = visible;
      this.writeSlotMatrix(detail.slot);
    }
  }

  sync(
    slot: FragmentInstanceSlot,
    size: THREE.Vector3,
    detailInstances: FragmentDetailInstance[],
    position: THREE.Vector3,
    rotation: THREE.Quaternion
  ): void {
    if (!slot.renderer.slotIsCurrent(slot)) {
      return;
    }
    if (!slot.visible) {
      this.writeSlotMatrix(slot);
      for (const detail of detailInstances) {
        this.writeSlotMatrix(detail.slot);
      }
      return;
    }
    this.scratchParentMatrix.compose(position, rotation, size);
    this.writeMatrix(slot, this.scratchParentMatrix);
    this.scratchRigidMatrix.compose(position, rotation, this.unitScale);
    for (const detail of detailInstances) {
      if (!detail.slot.visible || !detail.slot.renderer.slotIsCurrent(detail.slot)) {
        continue;
      }
      this.scratchWorldMatrix.multiplyMatrices(this.scratchRigidMatrix, detail.localMatrix);
      this.writeMatrix(detail.slot, this.scratchWorldMatrix);
    }
  }

  freeze(
    slot: FragmentInstanceSlot,
    size: THREE.Vector3,
    detailInstances: FragmentDetailInstance[],
    position: THREE.Vector3,
    rotation: THREE.Quaternion
  ): FrozenVisualHandle | null {
    if (!slot.renderer.slotIsCurrent(slot)) {
      return null;
    }
    slot.visible = true;
    for (const detail of detailInstances) {
      detail.slot.visible = true;
    }
    this.sync(slot, size, detailInstances, position, rotation);
    return {
      dispose: () => {
        this.release(slot);
        for (const detail of detailInstances) {
          this.release(detail.slot);
        }
      }
    };
  }

  release(slot: FragmentInstanceSlot): void {
    const bucket = this.bucketFor(slot.bucketKey);
    if (!bucket.occupied[slot.index]) {
      return;
    }
    slot.visible = false;
    bucket.occupied[slot.index] = false;
    bucket.mesh.setMatrixAt(slot.index, this.hiddenMatrix);
    bucket.mesh.instanceMatrix.needsUpdate = true;
    bucket.freeSlots.push(slot.index);
  }

  private slotIsCurrent(slot: FragmentInstanceSlot): boolean {
    const bucket = this.bucketFor(slot.bucketKey);
    return bucket.occupied[slot.index];
  }

  private writeSlotMatrix(slot: FragmentInstanceSlot): void {
    this.writeMatrix(slot, this.hiddenMatrix);
  }

  private writeMatrix(slot: FragmentInstanceSlot, matrix: THREE.Matrix4): void {
    const bucket = this.bucketFor(slot.bucketKey);
    bucket.mesh.setMatrixAt(slot.index, matrix);
    bucket.mesh.instanceMatrix.needsUpdate = true;
  }

  private acquireSlot(bucket: FragmentInstanceBucket, missMetric: string, reuseMetric: string): FragmentInstanceSlot | null {
    const index = bucket.freeSlots.pop();
    if (index === undefined) {
      perfMonitor.addCount(missMetric);
      return null;
    }
    bucket.occupied[index] = true;
    bucket.highWater = Math.max(bucket.highWater, index + 1);
    bucket.mesh.count = Math.max(bucket.mesh.count, bucket.highWater);
    perfMonitor.addCount(reuseMetric);
    return { bucketKey: bucket.key, index, renderer: this, visible: true };
  }

  private mainBucketFor(materialId: MaterialId): FragmentInstanceBucket {
    return this.bucketFor(
      `main:${materialId}`,
      this.materials.getRenderMaterial(materialId),
      `${this.materials.get(materialId).name} instanced fragments`
    );
  }

  private detailBucketFor(material: THREE.Material): FragmentInstanceBucket {
    return this.bucketFor(`detail:${material.uuid}`, material, `${material.name || "fragment detail"} instanced fragment details`);
  }

  private bucketFor(key: string, material?: THREE.Material, name?: string): FragmentInstanceBucket {
    const existing = this.buckets.get(key);
    if (existing) {
      return existing;
    }
    if (!material || !name) {
      throw new Error(`Missing fragment instance bucket metadata for ${key}`);
    }
    const mesh = new THREE.InstancedMesh(FRAGMENT_POOL_BOX_GEOMETRY, material, FRAGMENT_INSTANCE_CAPACITY_PER_MATERIAL);
    mesh.name = name;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 1;
    mesh.setMatrixAt(0, this.hiddenMatrix);
    mesh.instanceMatrix.needsUpdate = true;
    const bucket: FragmentInstanceBucket = {
      key,
      mesh,
      capacity: FRAGMENT_INSTANCE_CAPACITY_PER_MATERIAL,
      freeSlots: Array.from({ length: FRAGMENT_INSTANCE_CAPACITY_PER_MATERIAL }, (_, index) => FRAGMENT_INSTANCE_CAPACITY_PER_MATERIAL - 1 - index),
      occupied: new Array(FRAGMENT_INSTANCE_CAPACITY_PER_MATERIAL).fill(false),
      highWater: 1
    };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private writeWarmupSlot(bucket: FragmentInstanceBucket, index: number, matrix: THREE.Matrix4): void {
    bucket.mesh.count = Math.max(bucket.mesh.count, index + 1);
    bucket.mesh.setMatrixAt(index, matrix);
    bucket.mesh.instanceMatrix.needsUpdate = true;
  }

  private parkWarmupSlot(bucket: FragmentInstanceBucket): void {
    this.writeWarmupSlot(bucket, 0, this.hiddenMatrix);
  }
}

class FragmentInstanceVisualProxy implements DynamicVisualProxy {
  constructor(
    private readonly renderer: FragmentInstanceRenderer,
    private readonly slot: FragmentInstanceSlot,
    private readonly size: THREE.Vector3,
    private readonly detailInstances: FragmentDetailInstance[]
  ) {}

  setVisible(visible: boolean): void {
    this.renderer.setVisible(this.slot, this.detailInstances, visible);
  }

  sync(position: THREE.Vector3, rotation: THREE.Quaternion): void {
    this.renderer.sync(this.slot, this.size, this.detailInstances, position, rotation);
  }

  freeze(position: THREE.Vector3, rotation: THREE.Quaternion): FrozenVisualHandle | null {
    return this.renderer.freeze(this.slot, this.size, this.detailInstances, position, rotation);
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
  private readonly upwardBias = new THREE.Vector3(0, 0.58, 0);
  private readonly fractureJobs: FractureJob[] = [];
  private readonly queuedFractureIds = new Set<number>();
  private readonly fragmentInstances: FragmentInstanceRenderer;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly materials: MaterialCatalog,
    private readonly rng: RandomSource
  ) {
    this.fragmentInstances = new FragmentInstanceRenderer(materials);
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
        const visualProxy = this.fragmentInstances.acquire(materialId, size);
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
          ccd: index % 3 === 0
        });
        object.visualProxy?.sync(position, rotation);
        objectIds.push(object.id);
      }
    }
    return objectIds;
  }

  explode(origin: THREE.Vector3, blastStrength: number, blastRadius: number): ExplosionResult {
    const startedAt = perfMonitor.timeStart();
    const snapshot = this.physics.getBlastCandidates(origin, blastRadius);
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

        const torque = randomUnitVector(this.rng).multiplyScalar(blastStrength * falloff * 0.08 * material.angularResponse * wholeBodyScale);
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
    while (this.fractureJobs.length > 0 && processed < maxFractures) {
      if (processed > 0 && performance.now() >= deadline) {
        break;
      }
      const job = this.fractureJobs.shift();
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
    if (processed > 0 || this.fractureJobs.length > 0) {
      perfMonitor.addCount("destruction.fracturesProcessed", processed);
      perfMonitor.addCount("destruction.fracturesBacklog", this.fractureJobs.length);
      perfMonitor.addTiming("destruction.processQueuedFractures", startedAt);
    }
    return {
      processed,
      remaining: this.fractureJobs.length
    };
  }

  clearQueuedFractures(): void {
    this.fractureJobs.length = 0;
    this.queuedFractureIds.clear();
  }

  getQueuedFractureCount(): number {
    return this.fractureJobs.length;
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
    this.queuedFractureIds.add(object.id);
    this.fractureJobs.push({
      objectId: object.id,
      origin: origin.clone(),
      blastStrength,
      blastRadius,
      energy
    });
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

    for (let planIndex = 0; planIndex < plans.length; planIndex += 1) {
      const plan = plans[planIndex];
      const worldOffset = plan.offset.clone().applyQuaternion(parentRotation);
      const fragmentPosition = parentPosition.clone().add(worldOffset);
      const rotation = parentRotation.clone().multiply(plan.rotation);
      const breakableFragment = !object.isDebris && canFragmentShatterAgain(material.id, plan.size);
      const stageVisualActivation = !immediateVisualPlanIndexes.has(planIndex);
      const visualProxy = this.fragmentInstances.acquire(material.id, plan.size);
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
        chainSource: true,
        category: "debris",
        scoreRole: "neutral",
        zoneId: object.zoneId,
        scoreValue: Math.max(1, Math.round(object.scoreValue / plans.length)),
        linearVelocity: inheritedVelocity.clone().multiplyScalar(0.22),
        angularVelocity: randomUnitVector(this.rng).multiplyScalar(material.angularResponse * 2.35),
        ccd: breakableFragment,
        stageVisualActivation
      });
      fragment.visualProxy?.sync(fragmentPosition, rotation);
      this.kickFragment(fragment, origin, blastStrength, blastRadius);
      limitFragmentMotion(fragment, material.id, object.isDebris);
    }
    perfMonitor.addCount("destruction.fragmentsCreated", plans.length);
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

    const torque = randomUnitVector(this.rng).multiplyScalar(blastStrength * 0.13 * material.angularResponse * smallFragmentBoost);
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
      this.scratchDirection.copy(randomUnitVector(this.rng));
    }
    this.scratchDirection.normalize();
    this.scratchDirection.add(new THREE.Vector3(0, upwardBias, 0));
    this.scratchDirection.add(randomUnitVector(this.rng).multiplyScalar(randomBias));
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

function fragmentVolume(size: THREE.Vector3): number {
  return size.x * size.y * size.z;
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
