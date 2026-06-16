import * as THREE from "three";
import { decorateFragment } from "./cityVisuals";
import { MaterialCatalog, type MaterialDefinition, type MaterialId } from "./materialCatalog";
import { PhysicsWorld, type PhysicsCategory, type PhysicsObject, type ScoreRole } from "./physics";

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
  bioGelSplash: number;
  protectedPenalty: number;
}

interface FragmentPlan {
  size: THREE.Vector3;
  offset: THREE.Vector3;
  rotation: THREE.Quaternion;
  material: MaterialDefinition;
}

interface BlastSample {
  position: THREE.Vector3;
  directionOffset: THREE.Vector3;
  distance: number;
}

export class DestructibleObject {
  constructor(readonly object: PhysicsObject) {}
}

export class DestructionSystem {
  private readonly scratchDirection = new THREE.Vector3();
  private readonly upwardBias = new THREE.Vector3(0, 0.58, 0);

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly materials: MaterialCatalog
  ) {}

  explode(origin: THREE.Vector3, blastStrength: number, blastRadius: number): ExplosionResult {
    const snapshot = this.physics.getDynamicObjects();
    const fractureQueue: Array<{ object: PhysicsObject; energy: number }> = [];
    const dustColors: THREE.Color[] = [];
    const affectedObjects: ExplosionAffectedObject[] = [];
    let affectedBodies = 0;
    let structureDamage = 0;
    let materialChaos = 0;
    let bioGelSplash = 0;
    let protectedPenalty = 0;

    for (const object of snapshot) {
      if (object.category === "projectile") {
        continue;
      }
      const material = this.materials.get(object.materialId);
      const sample = this.sampleObjectForBlast(object, origin);
      if (sample.distance >= blastRadius) {
        continue;
      }

      affectedBodies += 1;
      const falloff = (1 - sample.distance / blastRadius) ** 2;
      const volume = Math.max(0.08, object.dimensions.x * object.dimensions.y * object.dimensions.z);
      const energy = (blastStrength * falloff * 1.7) / Math.max(0.5, material.massFactor) + volume * 0.35;
      const fractured = object.destructible && object.canFracture && energy > material.fractureThreshold;

      const wholeBodyScale = this.wholeBodyImpulseScale(object, fractured);
      const impulseMagnitude = ((blastStrength * falloff) / Math.max(0.5, material.massFactor)) * wholeBodyScale;
      if (impulseMagnitude > 0.01 && object.bodyType === "dynamic") {
        const upward = object.category === "structure" ? 0.16 : 0.42;
        const direction = this.computeBlastDirection(sample.directionOffset, upward, 0.1);
        const impulse = direction.multiplyScalar(impulseMagnitude);
        object.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

        const torque = randomUnitVector().multiplyScalar(blastStrength * falloff * 0.08 * material.angularResponse * wholeBodyScale);
        object.body.applyTorqueImpulse({ x: torque.x, y: torque.y, z: torque.z }, true);
      }

      if (fractured) {
        fractureQueue.push({ object, energy });
        dustColors.push(material.dustColor);
      }
      const weightedDamage = Math.round(object.scoreValue * Math.min(1.8, energy / Math.max(1, material.fractureThreshold)));
      if (object.scoreRole === "protected") {
        protectedPenalty += Math.round(weightedDamage * (fractured ? 1.65 : 0.9));
      } else if (object.category === "bio" || object.materialId === "bioGel") {
        bioGelSplash += Math.round(weightedDamage * (fractured ? 1.25 : 0.55));
      } else if (object.scoreRole === "target") {
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
      this.fracture(fracture.object, origin, blastStrength, blastRadius, fracture.energy);
    }

    return {
      origin: origin.clone(),
      affectedBodies,
      fracturedBodies: fractureQueue.length,
      dustColors,
      affectedObjects,
      structureDamage,
      materialChaos,
      bioGelSplash,
      protectedPenalty
    };
  }

  impact(source: PhysicsObject, target: PhysicsObject, origin: THREE.Vector3, relativeSpeed: number): ExplosionResult {
    const sourceMaterial = this.materials.get(source.materialId);
    const targetMaterial = this.materials.get(target.materialId);
    const sourceVolume = Math.max(0.02, source.dimensions.x * source.dimensions.y * source.dimensions.z);
    const impactMass = Math.max(0.35, sourceVolume * sourceMaterial.density * 7.5);
    const energy = (relativeSpeed * impactMass * Math.max(0.65, sourceMaterial.massFactor)) / Math.max(0.55, targetMaterial.massFactor);
    const fractured = target.destructible && target.canFracture && energy > targetMaterial.fractureThreshold;
    const sourcePosition = vectorFromRapier(source.body.translation());
    const targetPosition = vectorFromRapier(target.body.translation());
    const direction = targetPosition.clone().sub(sourcePosition).normalize();
    const impulseMagnitude = Math.min(34, energy * 0.44);
    if (impulseMagnitude > 0.01 && target.bodyType === "dynamic" && this.physics.getObject(target.id)) {
      target.body.applyImpulse(
        {
          x: direction.x * impulseMagnitude,
          y: Math.max(0.12, direction.y + 0.22) * impulseMagnitude,
          z: direction.z * impulseMagnitude
        },
        true
      );
      target.body.applyTorqueImpulse(
        {
          x: direction.z * impulseMagnitude * 0.18,
          y: impulseMagnitude * 0.08,
          z: -direction.x * impulseMagnitude * 0.18
        },
        true
      );
    }

    const weightedDamage = Math.round(target.scoreValue * Math.min(1.6, energy / Math.max(1, targetMaterial.fractureThreshold)));
    let structureDamage = 0;
    let materialChaos = 0;
    let bioGelSplash = 0;
    let protectedPenalty = 0;
    if (target.scoreRole === "protected") {
      protectedPenalty = Math.round(weightedDamage * (fractured ? 1.65 : 0.9));
    } else if (target.category === "bio" || target.materialId === "bioGel") {
      bioGelSplash = Math.round(weightedDamage * (fractured ? 1.25 : 0.55));
    } else if (target.scoreRole === "target") {
      structureDamage = Math.round(weightedDamage * 1.1);
    } else if (target.category === "structure") {
      materialChaos = Math.round(weightedDamage * 0.45);
    }
    materialChaos += Math.round(energy * 0.65);

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

    if (fractured && this.physics.getObject(target.id)) {
      this.fracture(target, origin, Math.max(8, energy * 0.55), 1.45, energy);
    }

    return {
      origin: origin.clone(),
      affectedBodies: 1,
      fracturedBodies: fractured ? 1 : 0,
      dustColors: fractured ? [targetMaterial.dustColor] : [],
      affectedObjects: [affectedObject],
      structureDamage,
      materialChaos,
      bioGelSplash,
      protectedPenalty
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

  private fracture(
    object: PhysicsObject,
    origin: THREE.Vector3,
    blastStrength: number,
    blastRadius: number,
    energy: number
  ): void {
    const material = this.materials.get(object.materialId);
    const parentPosition = vectorFromRapier(object.body.translation());
    const parentRotation = quaternionFromRapier(object.body.rotation());
    const inheritedVelocity = vectorFromRapier(object.body.linvel());
    const plans = this.createFragmentPlans(object.dimensions, material, energy);

    this.physics.removeObject(object.id);

    for (const plan of plans) {
      const worldOffset = plan.offset.clone().applyQuaternion(parentRotation);
      const rotation = parentRotation.clone().multiply(plan.rotation);
      const fragment = this.physics.addDynamicBox({
        label: `${material.name} debris`,
        material,
        renderMaterial: this.materials.getRenderMaterial(material.id),
        position: parentPosition.clone().add(worldOffset),
        size: plan.size,
        rotation,
        destructible: false,
        canFracture: false,
        isDebris: true,
        chainSource: true,
        category: object.category === "bio" || object.materialId === "bioGel" ? "bio" : "debris",
        scoreRole: object.scoreRole === "protected" ? "protected" : "neutral",
        zoneId: object.zoneId,
        scoreValue: Math.max(1, Math.round(object.scoreValue / plans.length)),
        linearVelocity: inheritedVelocity.clone().multiplyScalar(0.2),
        angularVelocity: randomUnitVector().multiplyScalar(material.angularResponse * 2.5)
      });
      decorateFragment(fragment.mesh, { size: plan.size, materialId: material.id });
      this.kickFragment(fragment, origin, blastStrength, blastRadius);
    }
  }

  private createFragmentPlans(size: THREE.Vector3, material: MaterialDefinition, energy: number): FragmentPlan[] {
    const [minCount, maxCount] = material.fragmentCount;
    const energyBonus = Math.min(8, Math.floor(Math.max(0, energy - material.fractureThreshold) / 8));
    const count = clampInt(randInt(minCount, maxCount) + energyBonus, minCount, maxCount + 8);
    const plans: FragmentPlan[] = [];

    for (let i = 0; i < count; i += 1) {
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * size.x * 0.78,
        (Math.random() - 0.5) * size.y * 0.78,
        (Math.random() - 0.5) * size.z * 0.78
      );
      const fragmentSize = this.fragmentSizeFor(material.id, size, count);
      const rotation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
      );
      plans.push({ size: fragmentSize, offset, rotation, material });
    }

    return plans;
  }

  private fragmentSizeFor(materialId: MaterialId, parentSize: THREE.Vector3, count: number): THREE.Vector3 {
    const base = Math.cbrt((parentSize.x * parentSize.y * parentSize.z) / count);
    if (materialId === "glass") {
      return new THREE.Vector3(
        clamp(base * rand(0.28, 0.74), 0.05, parentSize.x * 0.45),
        clamp(base * rand(0.035, 0.12), 0.025, 0.12),
        clamp(base * rand(0.65, 1.45), 0.1, parentSize.z * 0.7)
      );
    }
    if (materialId === "metal") {
      const longAxis = Math.max(parentSize.x, parentSize.y, parentSize.z) * rand(0.28, 0.52);
      return new THREE.Vector3(clamp(base * 0.42, 0.08, 0.35), clamp(base * 0.45, 0.08, 0.35), clamp(longAxis, 0.28, 1.3));
    }
    if (materialId === "concrete") {
      return new THREE.Vector3(
        clamp(base * rand(0.65, 1.35), 0.12, parentSize.x * 0.55),
        clamp(base * rand(0.55, 1.2), 0.12, parentSize.y * 0.55),
        clamp(base * rand(0.65, 1.35), 0.12, parentSize.z * 0.55)
      );
    }
    if (materialId === "wood") {
      return new THREE.Vector3(
        clamp(base * rand(0.35, 0.85), 0.08, parentSize.x * 0.5),
        clamp(base * rand(0.35, 0.9), 0.08, parentSize.y * 0.5),
        clamp(base * rand(0.75, 1.75), 0.12, parentSize.z * 0.75)
      );
    }
    if (materialId === "foam") {
      return new THREE.Vector3(base * rand(0.5, 1.0), base * rand(0.45, 0.9), base * rand(0.5, 1.0));
    }
    if (materialId === "bioGel") {
      return new THREE.Vector3(base * rand(0.42, 1.1), base * rand(0.35, 0.95), base * rand(0.42, 1.1));
    }
    return new THREE.Vector3(base * rand(0.55, 1.15), base * rand(0.55, 1.15), base * rand(0.55, 1.15));
  }

  private kickFragment(fragment: PhysicsObject, origin: THREE.Vector3, blastStrength: number, blastRadius: number): void {
    const material = this.materials.get(fragment.materialId);
    const position = vectorFromRapier(fragment.body.translation());
    const offset = position.sub(origin);
    const distance = Math.max(offset.length(), 0.001);
    const falloff = distance < blastRadius ? (1 - distance / blastRadius) ** 2 : 0.12;
    const direction = this.computeBlastDirection(offset, 0.68, 0.24);
    const impulseMagnitude = (blastStrength * (falloff + 0.18)) / Math.max(0.42, material.massFactor);
    const impulse = direction.multiplyScalar(impulseMagnitude);
    fragment.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);

    const torque = randomUnitVector().multiplyScalar(blastStrength * 0.16 * material.angularResponse);
    fragment.body.applyTorqueImpulse({ x: torque.x, y: torque.y, z: torque.z }, true);
  }

  private wholeBodyImpulseScale(object: PhysicsObject, fractured: boolean): number {
    if (fractured) {
      return 0;
    }
    if (object.isDebris) {
      return 1;
    }
    if (object.category === "structure") {
      return object.canFracture ? 0.18 : 0.34;
    }
    return 0.72;
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
      this.scratchDirection.copy(randomUnitVector());
    }
    this.scratchDirection.normalize();
    this.scratchDirection.add(new THREE.Vector3(0, upwardBias, 0));
    this.scratchDirection.add(randomUnitVector().multiplyScalar(randomBias));
    return this.scratchDirection.normalize().clone();
  }
}

function vectorFromRapier(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function quaternionFromRapier(q: { x: number; y: number; z: number; w: number }): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}

function randomUnitVector(): THREE.Vector3 {
  return new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize();
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.floor(clamp(value, min, max));
}
