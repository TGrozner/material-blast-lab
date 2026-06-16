import * as THREE from "three";
import type { BioGoreSystem } from "./bioGore";
import { MaterialCatalog, type MaterialId } from "./materialCatalog";
import { PhysicsWorld, type TriggerType } from "./physics";

export interface LevelContext {
  physics: PhysicsWorld;
  materials: MaterialCatalog;
  bioGore: BioGoreSystem;
}

export interface TestChamber {
  id: string;
  name: string;
  description: string;
  setup(context: LevelContext): void;
}

export const TEST_CHAMBERS: TestChamber[] = [
  {
    id: "crate-spine",
    name: "Crate Spine",
    description: "Wood ribs, glass shields, and synthetic gel specimens.",
    setup: ({ physics, materials, bioGore }) => {
      stackWall(physics, materials, "wood", new THREE.Vector3(-2.4, 0, 0.4), 4, 4, new THREE.Vector3(0.68, 0.62, 0.68));
      stackWall(physics, materials, "wood", new THREE.Vector3(2.2, 0, -0.15), 3, 4, new THREE.Vector3(0.72, 0.64, 0.72));
      glassFence(physics, materials, new THREE.Vector3(0, 0, -1.35), 6);

      bioGore.spawnDummy(new THREE.Vector3(-1.45, 0, -3.05), 1);
      bioGore.spawnDummy(new THREE.Vector3(0.15, 0, -3.35), 1.08);
      bioGore.spawnDummy(new THREE.Vector3(1.75, 0, -3.05), 0.96);

      spawnTrigger(physics, materials, "shockCanister", new THREE.Vector3(-3.4, 0.46, -1.25), new THREE.Vector3(0.42, 0.82, 0.42));
      spawnTrigger(physics, materials, "gelTank", new THREE.Vector3(3.3, 0.7, -2.55), new THREE.Vector3(0.62, 1.25, 0.62));
      spawnTrigger(physics, materials, "springPad", new THREE.Vector3(0, 0.12, 1.75), new THREE.Vector3(1.35, 0.18, 0.8));
    }
  },
  {
    id: "beam-orchard",
    name: "Beam Orchard",
    description: "Metal rows, heavy concrete, spring pads, and gel tanks.",
    setup: ({ physics, materials, bioGore }) => {
      const metal = materials.get("metal");
      for (let i = 0; i < 7; i += 1) {
        const x = -3.0 + i;
        physics.addDynamicBox({
          label: "Metal orchard beam",
          material: metal,
          renderMaterial: materials.getRenderMaterial("metal"),
          position: new THREE.Vector3(x, 1.02, -0.6 - (i % 2) * 0.7),
          size: new THREE.Vector3(0.24, 2.05, 0.24),
          rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (i % 2 === 0 ? 0.06 : -0.06))),
          category: "structure",
          scoreValue: 95
        });
      }

      stackWall(physics, materials, "concrete", new THREE.Vector3(-2.5, 0, -3.25), 4, 2, new THREE.Vector3(0.78, 0.54, 0.62));
      stackWall(physics, materials, "foam", new THREE.Vector3(2.2, 0, -3.05), 4, 3, new THREE.Vector3(0.55, 0.46, 0.55));
      stackWall(physics, materials, "rubber", new THREE.Vector3(0.3, 0, 1.35), 5, 2, new THREE.Vector3(0.52, 0.48, 0.52));

      bioGore.spawnDummy(new THREE.Vector3(-0.9, 0, -4.75), 1.1);
      bioGore.spawnDummy(new THREE.Vector3(1.1, 0, -4.6), 0.92);

      spawnTrigger(physics, materials, "shockCanister", new THREE.Vector3(0, 0.46, -2.25), new THREE.Vector3(0.46, 0.88, 0.46));
      spawnTrigger(physics, materials, "gelTank", new THREE.Vector3(-3.8, 0.72, -4.2), new THREE.Vector3(0.64, 1.28, 0.64));
      spawnTrigger(physics, materials, "gelTank", new THREE.Vector3(3.8, 0.72, -4.0), new THREE.Vector3(0.64, 1.28, 0.64));
      spawnTrigger(physics, materials, "springPad", new THREE.Vector3(-1.9, 0.12, 0.7), new THREE.Vector3(1.2, 0.18, 0.72));
      spawnTrigger(physics, materials, "springPad", new THREE.Vector3(2.4, 0.12, -1.1), new THREE.Vector3(1.2, 0.18, 0.72));
    }
  }
];

function stackWall(
  physics: PhysicsWorld,
  materials: MaterialCatalog,
  materialId: MaterialId,
  origin: THREE.Vector3,
  columns: number,
  rows: number,
  size: THREE.Vector3
): void {
  const material = materials.get(materialId);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      physics.addDynamicBox({
        label: `${material.name} block`,
        material,
        renderMaterial: materials.getRenderMaterial(materialId),
        position: new THREE.Vector3(
          origin.x + (x - (columns - 1) * 0.5) * (size.x + 0.045),
          size.y * 0.5 + y * (size.y + 0.035),
          origin.z
        ),
        size,
        category: "structure",
        scoreValue: Math.round(size.x * size.y * size.z * 110)
      });
    }
  }
}

function glassFence(physics: PhysicsWorld, materials: MaterialCatalog, origin: THREE.Vector3, count: number): void {
  const material = materials.get("glass");
  for (let i = 0; i < count; i += 1) {
    physics.addDynamicBox({
      label: "Glass shield",
      material,
      renderMaterial: materials.getRenderMaterial("glass"),
      position: new THREE.Vector3(origin.x + (i - (count - 1) * 0.5) * 0.72, 1.05, origin.z),
      size: new THREE.Vector3(0.08, 2.1, 0.52),
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI * 0.5, 0)),
      category: "structure",
      scoreValue: 70
    });
  }
}

function spawnTrigger(
  physics: PhysicsWorld,
  materials: MaterialCatalog,
  triggerType: TriggerType,
  position: THREE.Vector3,
  size: THREE.Vector3
): void {
  const visualMaterial = triggerMaterial(triggerType);
  const materialId: MaterialId = triggerType === "gelTank" ? "bioGel" : triggerType === "springPad" ? "rubber" : "metal";
  physics.addDynamicBox({
    label: triggerLabel(triggerType),
    material: materials.get(materialId),
    renderMaterial: visualMaterial,
    position,
    size,
    category: "trigger",
    triggerType,
    canFracture: true,
    destructible: true,
    scoreValue: triggerType === "springPad" ? 85 : 120
  });
}

function triggerMaterial(triggerType: TriggerType): THREE.Material {
  if (triggerType === "gelTank") {
    return new THREE.MeshPhysicalMaterial({
      color: 0xf04f8d,
      emissive: 0x4b0420,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.72,
      roughness: 0.28,
      metalness: 0.02,
      depthWrite: false
    });
  }
  if (triggerType === "springPad") {
    return new THREE.MeshStandardMaterial({
      color: 0x5be05f,
      emissive: 0x0f5a18,
      emissiveIntensity: 0.35,
      roughness: 0.68,
      metalness: 0.04
    });
  }
  return new THREE.MeshStandardMaterial({
    color: 0x50d7ff,
    emissive: 0x1184ad,
    emissiveIntensity: 0.65,
    roughness: 0.34,
    metalness: 0.45
  });
}

function triggerLabel(triggerType: TriggerType): string {
  if (triggerType === "gelTank") {
    return "Gel tank";
  }
  if (triggerType === "springPad") {
    return "Spring pad";
  }
  return "Shock canister";
}
