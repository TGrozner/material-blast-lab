import * as THREE from "three";
import type { BioGoreSystem } from "./bioGore";
import { MaterialCatalog, type MaterialId } from "./materialCatalog";
import { PhysicsWorld, type ScoreRole, type TriggerType } from "./physics";

export interface LevelContext {
  physics: PhysicsWorld;
  materials: MaterialCatalog;
  bioGore: BioGoreSystem;
  addDecoration(object: THREE.Object3D): void;
}

export interface TestChamber {
  id: string;
  name: string;
  description: string;
  objective: string;
  protectedBrief: string;
  setup(context: LevelContext): void;
}

export const TEST_CHAMBERS: TestChamber[] = [
  {
    id: "quarantine-junction",
    name: "Quarantine Junction",
    description: "A compact city block: destroy the contaminated core without tearing up the clinic or evac shelter.",
    objective: "Crush the orange hazard district and chain the utility tanks.",
    protectedBrief: "Avoid the blue clinic and evac shelter zones. Protected damage removes points.",
    setup: (context) => {
      addCityGround(context);
      spawnTargetDistrict(context);
      spawnProtectedDistricts(context);
      spawnChainSetpieces(context);
      spawnNeutralCityBlocks(context);
      spawnStreetFurniture(context);
    }
  }
];

interface BuildingSpec {
  label: string;
  materialId: MaterialId;
  position: THREE.Vector3;
  size: THREE.Vector3;
  floors: number;
  columns: number;
  scoreRole: ScoreRole;
  zoneId: string;
  scoreValue: number;
  stagger?: number;
  rotationY?: number;
}

function addCityGround(context: LevelContext): void {
  addPanel(context, "city asphalt", 0, -0.6, 18, 18, 0x1b2226, 1);
  addPanel(context, "north road", 0, -0.6, 3.2, 17.2, 0x303943, 1);
  addPanel(context, "cross road", 0, -1.35, 17.2, 2.6, 0x303943, 1);
  addPanel(context, "south service road", 0, 4.55, 15.4, 1.45, 0x28313a, 1);
  addPanel(context, "water canal", 7.4, -3.6, 1.25, 6.8, 0x17445e, 0.9);

  addPanel(context, "target zone", 0, -2.45, 6.35, 5.35, 0xff6733, 0.34);
  addPanel(context, "clinic protected zone", -5.4, -4.65, 4.25, 3.45, 0x57c7ff, 0.38);
  addPanel(context, "shelter protected zone", 5.15, 2.35, 4.4, 3.45, 0x57c7ff, 0.38);
  addPanel(context, "chain corridor", 2.55, -1.15, 1.9, 5.9, 0xffd66b, 0.26);

  for (const z of [-7.5, -4.55, 1.8, 5.05]) {
    addPanel(context, "road marking", 0, z, 0.12, 0.75, 0xf0c96a, 0.78);
  }
  for (const x of [-6.5, -3.1, 3.1, 6.5]) {
    addPanel(context, "crosswalk stripe", x, -1.35, 0.95, 0.12, 0xd7e2e8, 0.72);
  }
}

function spawnTargetDistrict(context: LevelContext): void {
  spawnBuildingStack(context, {
    label: "Contaminated foundry",
    materialId: "concrete",
    position: new THREE.Vector3(-0.85, 0, -2.9),
    size: new THREE.Vector3(0.72, 0.56, 0.72),
    floors: 4,
    columns: 4,
    scoreRole: "target",
    zoneId: "hazard-core",
    scoreValue: 115,
    stagger: 0.16
  });
  spawnBuildingStack(context, {
    label: "Toxic archive",
    materialId: "glass",
    position: new THREE.Vector3(1.45, 0, -2.25),
    size: new THREE.Vector3(0.5, 0.78, 0.5),
    floors: 3,
    columns: 3,
    scoreRole: "target",
    zoneId: "hazard-core",
    scoreValue: 105,
    rotationY: Math.PI * 0.08
  });

  const metal = context.materials.get("metal");
  for (let i = 0; i < 5; i += 1) {
    context.physics.addDynamicBox({
      label: "Radioactive mast",
      material: metal,
      renderMaterial: context.materials.getRenderMaterial("metal"),
      position: new THREE.Vector3(-2.05 + i * 0.42, 1.15 + i * 0.04, -4.95),
      size: new THREE.Vector3(0.18, 2.3, 0.18),
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.08 + i * 0.04)),
      category: "structure",
      scoreRole: "target",
      zoneId: "hazard-core",
      scoreValue: 135
    });
  }

  context.bioGore.spawnDummy(new THREE.Vector3(-1.7, 0, -1.05), 1.05);
  context.bioGore.spawnDummy(new THREE.Vector3(0.1, 0, -0.65), 1.18);
  context.bioGore.spawnDummy(new THREE.Vector3(1.85, 0, -0.92), 0.98);
}

function spawnProtectedDistricts(context: LevelContext): void {
  spawnBuildingStack(context, {
    label: "Blue clinic",
    materialId: "glass",
    position: new THREE.Vector3(-5.45, 0, -4.62),
    size: new THREE.Vector3(0.54, 0.64, 0.58),
    floors: 3,
    columns: 4,
    scoreRole: "protected",
    zoneId: "clinic",
    scoreValue: 180,
    stagger: 0.08
  });
  spawnBuildingStack(context, {
    label: "Evac shelter",
    materialId: "wood",
    position: new THREE.Vector3(5.18, 0, 2.38),
    size: new THREE.Vector3(0.66, 0.52, 0.7),
    floors: 3,
    columns: 4,
    scoreRole: "protected",
    zoneId: "evac-shelter",
    scoreValue: 165,
    stagger: -0.12
  });
}

function spawnChainSetpieces(context: LevelContext): void {
  spawnTrigger(context, "shockCanister", new THREE.Vector3(2.1, 0.48, -4.15), new THREE.Vector3(0.42, 0.9, 0.42), "grid-relay", 155);
  spawnTrigger(context, "shockCanister", new THREE.Vector3(2.85, 0.48, -2.65), new THREE.Vector3(0.42, 0.9, 0.42), "grid-relay", 155);
  spawnTrigger(context, "gelTank", new THREE.Vector3(3.1, 0.74, -0.75), new THREE.Vector3(0.62, 1.3, 0.62), "gel-main", 175);
  spawnTrigger(context, "gelTank", new THREE.Vector3(2.55, 0.68, 1.0), new THREE.Vector3(0.58, 1.18, 0.58), "gel-main", 155);
  spawnTrigger(context, "springPad", new THREE.Vector3(-0.45, 0.12, 1.8), new THREE.Vector3(1.35, 0.18, 0.78), "launch-pad", 120);
}

function spawnNeutralCityBlocks(context: LevelContext): void {
  spawnBuildingStack(context, {
    label: "Corner apartments",
    materialId: "concrete",
    position: new THREE.Vector3(-5.3, 0, 1.0),
    size: new THREE.Vector3(0.64, 0.54, 0.64),
    floors: 3,
    columns: 3,
    scoreRole: "neutral",
    zoneId: "west-block",
    scoreValue: 42
  });
  spawnBuildingStack(context, {
    label: "Canal warehouse",
    materialId: "metal",
    position: new THREE.Vector3(5.25, 0, -4.8),
    size: new THREE.Vector3(0.7, 0.5, 0.72),
    floors: 2,
    columns: 4,
    scoreRole: "neutral",
    zoneId: "east-canal",
    scoreValue: 44,
    rotationY: Math.PI * 0.5
  });
  spawnBuildingStack(context, {
    label: "Market row",
    materialId: "foam",
    position: new THREE.Vector3(-2.95, 0, 3.2),
    size: new THREE.Vector3(0.58, 0.42, 0.58),
    floors: 2,
    columns: 5,
    scoreRole: "neutral",
    zoneId: "market",
    scoreValue: 34,
    stagger: 0.1
  });
}

function spawnStreetFurniture(context: LevelContext): void {
  const rubber = context.materials.get("rubber");
  const renderMaterial = context.materials.getRenderMaterial("rubber");
  for (const x of [-6.8, -3.6, 3.6, 6.8]) {
    context.physics.addDynamicBox({
      label: "Traffic barricade",
      material: rubber,
      renderMaterial,
      position: new THREE.Vector3(x, 0.22, 4.55),
      size: new THREE.Vector3(0.75, 0.35, 0.18),
      category: "structure",
      scoreRole: "neutral",
      zoneId: "street",
      scoreValue: 12
    });
  }

  for (const [x, z] of [
    [-7.0, -7.1],
    [-7.0, 1.2],
    [6.9, -6.6],
    [6.9, 4.1],
    [-3.3, -6.9],
    [3.2, 4.6]
  ]) {
    addStreetLight(context, x, z);
  }
}

function spawnBuildingStack(context: LevelContext, spec: BuildingSpec): void {
  const material = context.materials.get(spec.materialId);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spec.rotationY ?? 0, 0));
  for (let floor = 0; floor < spec.floors; floor += 1) {
    for (let column = 0; column < spec.columns; column += 1) {
      const offsetX = (column - (spec.columns - 1) * 0.5) * (spec.size.x + 0.035);
      const offsetZ = ((floor % 2) - 0.5) * (spec.size.z + 0.04) + (spec.stagger ?? 0) * floor;
      const local = new THREE.Vector3(offsetX, spec.size.y * 0.5 + floor * (spec.size.y + 0.035), offsetZ);
      local.applyQuaternion(rotation);
      const object = context.physics.addDynamicBox({
        label: spec.label,
        material,
        renderMaterial: roleRenderMaterial(context.materials, spec.materialId, spec.scoreRole),
        position: spec.position.clone().add(local),
        size: spec.size,
        rotation,
        category: "structure",
        scoreRole: spec.scoreRole,
        zoneId: spec.zoneId,
        canFracture: true,
        destructible: true,
        scoreValue: spec.scoreValue
      });
      object.mesh.userData.disposeMaterial = true;
    }
  }
}

function spawnTrigger(
  context: LevelContext,
  triggerType: TriggerType,
  position: THREE.Vector3,
  size: THREE.Vector3,
  zoneId: string,
  scoreValue: number
): void {
  const visualMaterial = triggerMaterial(triggerType);
  const materialId: MaterialId = triggerType === "gelTank" ? "bioGel" : triggerType === "springPad" ? "rubber" : "metal";
  const object = context.physics.addDynamicBox({
    label: triggerLabel(triggerType),
    material: context.materials.get(materialId),
    renderMaterial: visualMaterial,
    position,
    size,
    category: "trigger",
    triggerType,
    scoreRole: "chain",
    zoneId,
    canFracture: true,
    destructible: true,
    scoreValue
  });
  object.mesh.userData.disposeMaterial = true;
}

function roleRenderMaterial(materials: MaterialCatalog, materialId: MaterialId, role: ScoreRole): THREE.Material {
  const material = materials.getRenderMaterial(materialId).clone();
  const tint = role === "target" ? new THREE.Color(0xff7a35) : role === "protected" ? new THREE.Color(0x6fd6ff) : null;
  if (tint && (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial || material instanceof THREE.MeshBasicMaterial)) {
    material.color.lerp(tint, role === "target" ? 0.58 : 0.68);
    if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
      material.emissive = tint.clone().multiplyScalar(role === "target" ? 0.12 : 0.18);
      material.emissiveIntensity = 0.7;
    }
  }
  return material;
}

function addPanel(
  context: LevelContext,
  name: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  color: THREE.ColorRepresentation,
  opacity: number
): void {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  mesh.name = name;
  mesh.rotation.x = -Math.PI * 0.5;
  mesh.position.set(x, 0.018, z);
  mesh.renderOrder = opacity < 1 ? 1 : 0;
  context.addDecoration(mesh);
}

function addStreetLight(context: LevelContext, x: number, z: number): void {
  const group = new THREE.Group();
  group.name = "street light";
  group.position.set(x, 0, z);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.045, 1.45, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a3339, roughness: 0.5, metalness: 0.55 })
  );
  pole.position.y = 0.72;
  const lamp = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.08, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xffdf8f })
  );
  lamp.position.set(0.13, 1.45, 0);
  const glow = new THREE.PointLight(0xffd48a, 0.32, 2.6, 2.2);
  glow.position.set(0.15, 1.36, 0);
  group.add(pole, lamp, glow);
  context.addDecoration(group);
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
    return "Volatile gel tank";
  }
  if (triggerType === "springPad") {
    return "Launch pad";
  }
  return "Grid shock relay";
}
