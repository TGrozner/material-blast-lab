import * as THREE from "three";
import { decorateBuildingCell, decorateCityVehicle, type BuildingVisualStyle } from "./cityVisuals";
import { MaterialCatalog, type MaterialId } from "./materialCatalog";
import { PhysicsWorld, type ScoreRole } from "./physics";

type TriggerType = "gelTank" | "springPad" | "shockCanister";

export interface LevelContext {
  physics: PhysicsWorld;
  materials: MaterialCatalog;
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
    description: "A dense evacuated city packed below the high siege battery.",
    objective: "Crush the orange hazard core and let real debris collisions cascade through the packed blocks.",
    protectedBrief: "Avoid the blue clinic and evac shelter zones. Clean Blast needs 2200+ score, 900+ target damage, and protected damage under 120.",
    setup: (context) => {
      addCityGround(context);
      spawnTargetDistrict(context);
      spawnProtectedDistricts(context);
      spawnNeutralCityBlocks(context);
      spawnInfillCityBlocks(context);
      spawnDenseUrbanGrid(context);
      spawnStreetSetpieces(context);
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
  style: BuildingVisualStyle;
  stagger?: number;
  rotationY?: number;
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
    style: "industrial",
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
    style: "glassTower",
    rotationY: Math.PI * 0.08
  });
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
    style: "civic",
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
    style: "shelter",
    stagger: -0.12
  });
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
    scoreValue: 42,
    style: "apartment"
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
    style: "warehouse",
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
    style: "market",
    stagger: 0.1
  });
}

function spawnInfillCityBlocks(context: LevelContext): void {
  spawnBuildingStack(context, {
    label: "North utility slabs",
    materialId: "metal",
    position: new THREE.Vector3(-1.6, 0, -8.65),
    size: new THREE.Vector3(0.58, 0.42, 0.58),
    floors: 2,
    columns: 5,
    scoreRole: "neutral",
    zoneId: "north-utilities",
    scoreValue: 30,
    style: "warehouse",
    stagger: 0.04
  });
  spawnBuildingStack(context, {
    label: "North row apartments",
    materialId: "concrete",
    position: new THREE.Vector3(-7.12, 0, -7.35),
    size: new THREE.Vector3(0.48, 0.48, 0.52),
    floors: 3,
    columns: 3,
    scoreRole: "neutral",
    zoneId: "north-row",
    scoreValue: 28,
    style: "apartment",
    stagger: -0.1,
    rotationY: Math.PI * 0.02
  });
  spawnBuildingStack(context, {
    label: "Transit offices",
    materialId: "glass",
    position: new THREE.Vector3(3.55, 0, -7.25),
    size: new THREE.Vector3(0.46, 0.64, 0.48),
    floors: 3,
    columns: 4,
    scoreRole: "neutral",
    zoneId: "transit-row",
    scoreValue: 36,
    style: "glassTower",
    stagger: 0.05,
    rotationY: -Math.PI * 0.04
  });
  spawnBuildingStack(context, {
    label: "West service flats",
    materialId: "wood",
    position: new THREE.Vector3(-7.35, 0, 2.25),
    size: new THREE.Vector3(0.54, 0.46, 0.58),
    floors: 3,
    columns: 2,
    scoreRole: "neutral",
    zoneId: "west-service",
    scoreValue: 30,
    style: "shelter",
    stagger: 0.08,
    rotationY: Math.PI * 0.5
  });
  spawnBuildingStack(context, {
    label: "South apartment ribbon",
    materialId: "concrete",
    position: new THREE.Vector3(-5.85, 0, 6.7),
    size: new THREE.Vector3(0.54, 0.5, 0.56),
    floors: 3,
    columns: 4,
    scoreRole: "neutral",
    zoneId: "south-ribbon",
    scoreValue: 32,
    style: "apartment",
    stagger: 0.06
  });
  spawnBuildingStack(context, {
    label: "Market annex",
    materialId: "foam",
    position: new THREE.Vector3(0.95, 0, 6.55),
    size: new THREE.Vector3(0.5, 0.38, 0.5),
    floors: 2,
    columns: 5,
    scoreRole: "neutral",
    zoneId: "market-annex",
    scoreValue: 24,
    style: "market",
    stagger: -0.06
  });
  spawnBuildingStack(context, {
    label: "Canal office sliver",
    materialId: "glass",
    position: new THREE.Vector3(8.05, 0, -0.45),
    size: new THREE.Vector3(0.42, 0.58, 0.46),
    floors: 4,
    columns: 2,
    scoreRole: "neutral",
    zoneId: "canal-offices",
    scoreValue: 34,
    style: "glassTower",
    stagger: 0.04,
    rotationY: Math.PI * 0.5
  });
  spawnBuildingStack(context, {
    label: "East perimeter apartments",
    materialId: "concrete",
    position: new THREE.Vector3(11.35, 0, -5.55),
    size: new THREE.Vector3(0.54, 0.5, 0.54),
    floors: 3,
    columns: 4,
    scoreRole: "neutral",
    zoneId: "east-perimeter",
    scoreValue: 32,
    style: "apartment",
    stagger: -0.08,
    rotationY: Math.PI * 0.5
  });
  spawnBuildingStack(context, {
    label: "East shop row",
    materialId: "foam",
    position: new THREE.Vector3(11.15, 0, 1.15),
    size: new THREE.Vector3(0.5, 0.38, 0.5),
    floors: 2,
    columns: 5,
    scoreRole: "neutral",
    zoneId: "east-shops",
    scoreValue: 24,
    style: "market",
    stagger: 0.05,
    rotationY: Math.PI * 0.5
  });
  spawnBuildingStack(context, {
    label: "Battery approach offices",
    materialId: "glass",
    position: new THREE.Vector3(10.65, 0, 6.65),
    size: new THREE.Vector3(0.48, 0.6, 0.48),
    floors: 3,
    columns: 3,
    scoreRole: "neutral",
    zoneId: "battery-offices",
    scoreValue: 34,
    style: "glassTower",
    stagger: 0.04,
    rotationY: Math.PI * 0.5
  });
  spawnBuildingStack(context, {
    label: "South depot row",
    materialId: "metal",
    position: new THREE.Vector3(-1.35, 0, 8.65),
    size: new THREE.Vector3(0.56, 0.42, 0.56),
    floors: 2,
    columns: 6,
    scoreRole: "neutral",
    zoneId: "south-depot",
    scoreValue: 28,
    style: "warehouse",
    stagger: -0.03
  });
  spawnBuildingStack(context, {
    label: "Battery foot shops",
    materialId: "foam",
    position: new THREE.Vector3(5.85, 0, 6.65),
    size: new THREE.Vector3(0.5, 0.4, 0.5),
    floors: 2,
    columns: 4,
    scoreRole: "neutral",
    zoneId: "battery-shops",
    scoreValue: 26,
    style: "market",
    stagger: 0.08
  });
}

function spawnDenseUrbanGrid(context: LevelContext): void {
  const denseBlocks: BuildingSpec[] = [
    {
      label: "Inner foundry annex",
      materialId: "concrete",
      position: new THREE.Vector3(-2.95, 0, -5.85),
      size: new THREE.Vector3(0.54, 0.5, 0.56),
      floors: 3,
      columns: 4,
      scoreRole: "target",
      zoneId: "hazard-core",
      scoreValue: 82,
      style: "industrial",
      stagger: -0.08
    },
    {
      label: "Hazard service wall",
      materialId: "metal",
      position: new THREE.Vector3(3.35, 0, -4.35),
      size: new THREE.Vector3(0.46, 0.44, 0.74),
      floors: 2,
      columns: 6,
      scoreRole: "target",
      zoneId: "hazard-core",
      scoreValue: 74,
      style: "warehouse",
      stagger: 0.05
    },
    {
      label: "Central pressure housing",
      materialId: "glass",
      position: new THREE.Vector3(-2.35, 0, -0.25),
      size: new THREE.Vector3(0.46, 0.6, 0.46),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "central-pressure",
      scoreValue: 36,
      style: "glassTower",
      stagger: 0.05
    },
    {
      label: "West ridge apartments",
      materialId: "concrete",
      position: new THREE.Vector3(-11.65, 0, -6.1),
      size: new THREE.Vector3(0.5, 0.48, 0.52),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "west-ridge",
      scoreValue: 32,
      style: "apartment",
      stagger: -0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "West grid shops",
      materialId: "foam",
      position: new THREE.Vector3(-11.85, 0, -1.1),
      size: new THREE.Vector3(0.48, 0.38, 0.48),
      floors: 2,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "west-grid",
      scoreValue: 24,
      style: "market",
      stagger: 0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "West battery flats",
      materialId: "wood",
      position: new THREE.Vector3(-11.65, 0, 4.45),
      size: new THREE.Vector3(0.5, 0.46, 0.54),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "west-battery",
      scoreValue: 30,
      style: "shelter",
      stagger: 0.07,
      rotationY: Math.PI * 0.5
    },
    {
      label: "West south towers",
      materialId: "glass",
      position: new THREE.Vector3(-10.15, 0, 10.85),
      size: new THREE.Vector3(0.46, 0.62, 0.46),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "west-south",
      scoreValue: 36,
      style: "glassTower",
      stagger: -0.05
    },
    {
      label: "East quay towers",
      materialId: "concrete",
      position: new THREE.Vector3(14.25, 0, -7.05),
      size: new THREE.Vector3(0.52, 0.5, 0.52),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "east-quay",
      scoreValue: 34,
      style: "apartment",
      stagger: 0.06,
      rotationY: Math.PI * 0.5
    },
    {
      label: "East transit stack",
      materialId: "glass",
      position: new THREE.Vector3(14.25, 0, -2.2),
      size: new THREE.Vector3(0.44, 0.58, 0.46),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "east-transit",
      scoreValue: 34,
      style: "glassTower",
      stagger: -0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "East battery housing",
      materialId: "concrete",
      position: new THREE.Vector3(14.1, 0, 3.45),
      size: new THREE.Vector3(0.5, 0.48, 0.5),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "east-battery",
      scoreValue: 32,
      style: "apartment",
      stagger: 0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "East south markets",
      materialId: "foam",
      position: new THREE.Vector3(13.35, 0, 9.55),
      size: new THREE.Vector3(0.48, 0.38, 0.48),
      floors: 2,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "east-south",
      scoreValue: 24,
      style: "market",
      stagger: 0.05
    },
    {
      label: "Battery approach canyon west",
      materialId: "concrete",
      position: new THREE.Vector3(-3.1, 0, 12.15),
      size: new THREE.Vector3(0.5, 0.48, 0.52),
      floors: 4,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "battery-canyon",
      scoreValue: 32,
      style: "apartment",
      stagger: -0.05
    },
    {
      label: "Battery approach canyon east",
      materialId: "glass",
      position: new THREE.Vector3(3.45, 0, 11.85),
      size: new THREE.Vector3(0.46, 0.6, 0.46),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "battery-canyon",
      scoreValue: 34,
      style: "glassTower",
      stagger: 0.04
    },
    {
      label: "South depot dense wall",
      materialId: "metal",
      position: new THREE.Vector3(-7.95, 0, 13.35),
      size: new THREE.Vector3(0.52, 0.42, 0.56),
      floors: 2,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "south-depot",
      scoreValue: 28,
      style: "warehouse",
      stagger: 0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "South market wall",
      materialId: "foam",
      position: new THREE.Vector3(7.75, 0, 13.2),
      size: new THREE.Vector3(0.48, 0.38, 0.48),
      floors: 2,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "south-market",
      scoreValue: 24,
      style: "market",
      stagger: -0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Battery forecourt tenements",
      materialId: "concrete",
      position: new THREE.Vector3(-0.35, 0, 15.45),
      size: new THREE.Vector3(0.5, 0.48, 0.52),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "forecourt",
      scoreValue: 32,
      style: "apartment",
      stagger: 0.05
    },
    {
      label: "Battery ballast shops",
      materialId: "foam",
      position: new THREE.Vector3(-5.95, 0, 15.1),
      size: new THREE.Vector3(0.48, 0.38, 0.48),
      floors: 2,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "forecourt",
      scoreValue: 24,
      style: "market",
      stagger: -0.05
    },
    {
      label: "Service terminal east",
      materialId: "glass",
      position: new THREE.Vector3(6.25, 0, 15.0),
      size: new THREE.Vector3(0.46, 0.58, 0.46),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "forecourt",
      scoreValue: 34,
      style: "glassTower",
      stagger: 0.04
    },
    {
      label: "Outer depot gantry",
      materialId: "metal",
      position: new THREE.Vector3(12.35, 0, 14.45),
      size: new THREE.Vector3(0.52, 0.42, 0.56),
      floors: 2,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "forecourt",
      scoreValue: 28,
      style: "warehouse",
      stagger: 0.04,
      rotationY: Math.PI * 0.5
    }
  ];

  for (const block of denseBlocks) {
    spawnBuildingStack(context, block);
  }
}

function spawnBuildingStack(context: LevelContext, spec: BuildingSpec): void {
  const material = context.materials.get(spec.materialId);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spec.rotationY ?? 0, 0));
  const floorStep = spec.size.y - 0.012;
  const columnCenter = (spec.columns - 1) * 0.5;
  for (let floor = 0; floor < spec.floors; floor += 1) {
    for (let column = 0; column < spec.columns; column += 1) {
      const offsetX = (column - columnCenter) * (spec.size.x + 0.035);
      const offsetZ = (spec.stagger ?? 0) * (column - columnCenter) * 0.28;
      const local = new THREE.Vector3(offsetX, spec.size.y * 0.5 + floor * floorStep, offsetZ);
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
        bodyType: "fixed",
        scoreValue: spec.scoreValue,
        sleeping: true,
        friction: Math.max(0.86, material.friction),
        restitution: Math.min(0.08, material.restitution),
        linearDamping: 0.72,
        angularDamping: 1.35,
        additionalMass: spec.size.x * spec.size.y * spec.size.z * 3.5
      });
      decorateBuildingCell(object.mesh, {
        size: spec.size,
        materialId: spec.materialId,
        scoreRole: spec.scoreRole,
        style: spec.style,
        floor,
        column,
        floors: spec.floors,
        columns: spec.columns
      });
      object.mesh.userData.disposeMaterial = true;
    }
  }
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

export function relayMaterialId(type: TriggerType): MaterialId {
  if (type === "gelTank") {
    return "bioGel";
  }
  if (type === "springPad") {
    return "rubber";
  }
  return "glass";
}

export function relayRenderMaterial(type: TriggerType): THREE.Material {
  const color = type === "gelTank" ? 0xd92b72 : type === "springPad" ? 0x252a30 : 0x6fefff;
  const material = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: type === "springPad" ? 0.32 : 0.18,
    roughness: type === "springPad" ? 0.62 : 0.3,
    metalness: type === "springPad" ? 0.28 : 0.08,
    depthWrite: false,
    emissive: new THREE.Color(color).multiplyScalar(type === "springPad" ? 0.12 : 0.28),
    emissiveIntensity: type === "springPad" ? 0.42 : 0.85
  });
  return material;
}

function addCityGround(context: LevelContext): void {
  let groundPanelLayer = 0;
  const addGroundPanel = (
    name: string,
    x: number,
    z: number,
    width: number,
    depth: number,
    color: THREE.ColorRepresentation,
    opacity: number
  ): void => {
    addPanel(context, name, x, z, width, depth, color, opacity, groundPanelLayer);
    groundPanelLayer += 1;
  };

  addGroundPanel("city asphalt", 0, -0.6, 30.5, 27.8, 0x1b2226, 1);
  addGroundPanel("west urban mat", -11.45, 1.7, 7.8, 23.8, 0x171f25, 1);
  addGroundPanel("east urban mat", 12.1, -0.1, 9.2, 23.5, 0x171f25, 1);
  addGroundPanel("south urban mat", 0, 12.35, 29.2, 7.5, 0x171f25, 1);
  addGroundPanel("north urban mat", 0.4, -9.25, 29.2, 2.9, 0x171f25, 1);
  addGroundPanel("north road", 0, -0.6, 2.15, 22.2, 0x303943, 1);
  addGroundPanel("cross road", 0, -1.35, 25.8, 1.85, 0x303943, 1);
  addGroundPanel("south service road", 0, 5.0, 22.8, 1.05, 0x28313a, 1);
  addGroundPanel("east service road", 10.1, -0.7, 0.88, 18.6, 0x28313a, 1);
  addGroundPanel("battery access road", 4.2, 8.35, 13.8, 0.86, 0x28313a, 1);
  addGroundPanel("water canal", 7.4, -3.6, 1.25, 6.8, 0x17445e, 0.9);

  addGroundPanel("target zone", 0, -2.45, 6.35, 5.35, 0xff6733, 0.34);
  addGroundPanel("clinic protected zone", -5.4, -4.65, 4.25, 3.45, 0x57c7ff, 0.38);
  addGroundPanel("shelter protected zone", 5.15, 2.35, 4.4, 3.45, 0x57c7ff, 0.38);
  addSkylineBackdrop(context);

  for (const z of [-7.5, -4.55, 1.8, 5.05]) {
    addGroundPanel("road marking", 0, z, 0.12, 0.75, 0xf0c96a, 0.78);
  }
  for (const z of [-6.9, -3.9, -0.8, 2.2, 5.25]) {
    addGroundPanel("east road marking", 10.1, z, 0.09, 0.64, 0xf0c96a, 0.62);
  }
  for (const x of [-6.5, -3.1, 3.1, 6.5]) {
    addGroundPanel("crosswalk stripe", x, -1.35, 0.95, 0.12, 0xd7e2e8, 0.72);
  }
  for (const x of [-11.8, -8.8, 8.8, 12.2]) {
    addGroundPanel("dense block alley stripe", x, 4.2, 0.08, 8.6, 0x41505b, 0.52);
  }
}

function spawnStreetSetpieces(context: LevelContext): void {
  for (const x of [-8.9, -6.8, -4.8, -3.6, -1.2, 1.25, 3.6, 5.4, 6.8, 8.65]) {
    const material = context.materials.get("rubber");
    const object = context.physics.addDynamicBox({
      label: "Traffic barricade",
      material,
      renderMaterial: context.materials.getRenderMaterial("rubber"),
      position: new THREE.Vector3(x, 0.22, 4.55),
      size: new THREE.Vector3(0.75, 0.35, 0.18),
      category: "structure",
      scoreRole: "neutral",
      zoneId: "street",
      scoreValue: 12,
      restitution: 0.45
    });
    object.mesh.userData.disposeMaterial = false;
  }

  const streetCargo = [
    ["Foam cargo skid", "foam", -0.95, 5.55, 0.7, 0.38, 0.55, Math.PI * 0.06],
    ["Wood cargo skid", "wood", 0.85, 5.65, 0.72, 0.42, 0.58, -Math.PI * 0.08],
    ["Glass cargo crate", "glass", 2.2, 6.85, 0.5, 0.54, 0.5, Math.PI * 0.12],
    ["Foam cargo skid", "foam", -2.35, 6.95, 0.72, 0.38, 0.56, -Math.PI * 0.18],
    ["Metal pallet rack", "metal", 4.15, 7.35, 0.76, 0.5, 0.42, Math.PI * 0.5],
    ["Wood pallet stack", "wood", -4.25, 7.85, 0.78, 0.48, 0.5, Math.PI * 0.44],
    ["Foam cargo skid", "foam", 7.25, 8.45, 0.7, 0.38, 0.55, -Math.PI * 0.08],
    ["Glass cargo crate", "glass", -0.2, 9.85, 0.52, 0.54, 0.52, Math.PI * 0.16],
    ["Wood cargo skid", "wood", 2.2, 10.35, 0.72, 0.42, 0.58, Math.PI * 0.5],
    ["Foam cargo skid", "foam", -3.55, 10.1, 0.7, 0.38, 0.55, Math.PI * 0.24],
    ["Metal pallet rack", "metal", 5.55, 10.2, 0.76, 0.5, 0.42, -Math.PI * 0.42],
    ["Wood pallet stack", "wood", -8.65, 4.55, 0.78, 0.48, 0.5, Math.PI * 0.5],
    ["Glass cargo crate", "glass", 11.35, 5.75, 0.52, 0.54, 0.52, -Math.PI * 0.12]
  ] as const;

  for (const [label, materialId, x, z, width, height, depth, rotationY] of streetCargo) {
    addStreetCargo(context, label, materialId, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  addCityVehicle(context, "Delivery microbus", new THREE.Vector3(-3.75, 0.32, -1.35), new THREE.Vector3(0.82, 0.42, 0.52), 0xf3b33c, Math.PI * 0.5);
  addCityVehicle(context, "Evac service van", new THREE.Vector3(4.75, 0.34, -1.25), new THREE.Vector3(0.92, 0.46, 0.58), 0x6bd8ff, Math.PI * 0.5);
  addCityVehicle(context, "Market scooter pod", new THREE.Vector3(-1.55, 0.26, 4.55), new THREE.Vector3(0.56, 0.32, 0.42), 0xff6b93, Math.PI * 0.5);
  addCityVehicle(context, "Clinic shuttle", new THREE.Vector3(-6.45, 0.28, -1.35), new THREE.Vector3(0.62, 0.34, 0.46), 0xb8f4ff, Math.PI * 0.5);
  addCityVehicle(context, "Canal maintenance truck", new THREE.Vector3(7.45, 0.34, -3.35), new THREE.Vector3(0.86, 0.44, 0.54), 0x9bb2bd);
  addCityVehicle(context, "Battery service cart", new THREE.Vector3(2.85, 0.27, 4.55), new THREE.Vector3(0.58, 0.3, 0.42), 0xffd66b, Math.PI * 0.5);
  addCityVehicle(context, "East tram pod", new THREE.Vector3(10.1, 0.3, -0.95), new THREE.Vector3(0.54, 0.36, 0.86), 0x74dfff);
  addCityVehicle(context, "Depot hauler", new THREE.Vector3(-4.65, 0.31, 8.0), new THREE.Vector3(0.82, 0.4, 0.5), 0xf0c16a, Math.PI * 0.5);
  addCityVehicle(context, "West grid loader", new THREE.Vector3(-9.7, 0.31, 1.65), new THREE.Vector3(0.74, 0.38, 0.5), 0xff9d4d, Math.PI * 0.5);
  addCityVehicle(context, "East courier pod", new THREE.Vector3(12.35, 0.28, 4.85), new THREE.Vector3(0.58, 0.32, 0.44), 0x87f0ff);
  addCityVehicle(context, "Battery tram husk", new THREE.Vector3(0.15, 0.34, 8.35), new THREE.Vector3(1.0, 0.45, 0.56), 0xffd66b, Math.PI * 0.5);
  addCityVehicle(context, "South depot van", new THREE.Vector3(-2.6, 0.33, 12.1), new THREE.Vector3(0.88, 0.43, 0.54), 0xb2c0c8, Math.PI * 0.5);

  for (const [x, z] of [
    [-7.0, -7.1],
    [-3.65, -7.25],
    [0.0, -7.35],
    [3.85, -7.25],
    [-7.0, 1.2],
    [6.9, -6.6],
    [7.05, -2.25],
    [6.9, 4.1],
    [-3.3, -6.9],
    [-6.8, 6.2],
    [3.2, 4.6],
    [6.85, 6.2],
    [10.1, -7.3],
    [10.1, -3.8],
    [10.1, 0.2],
    [10.1, 3.75],
    [10.1, 7.2],
    [-1.5, 8.35],
    [5.3, 8.15],
    [-11.1, -8.1],
    [-11.2, -3.4],
    [-11.0, 2.2],
    [-10.4, 8.8],
    [13.7, -8.0],
    [13.9, -3.3],
    [13.8, 2.8],
    [13.0, 8.9],
    [-5.1, 12.1],
    [0.6, 12.2],
    [6.2, 12.1]
  ]) {
    addStreetLight(context, x, z);
  }

  addBillboard(context, -4.35, -6.25, 0xff8f38);
  addBillboard(context, 4.1, 4.15, 0x7ee8ff);
  addBillboard(context, -7.2, 5.75, 0xffd66b);
  addBillboard(context, 7.25, -5.85, 0x93f6ff);
  addBillboard(context, -12.7, 9.6, 0xff8f38);
  addBillboard(context, 12.65, 9.15, 0x7ee8ff);
}

function addCityVehicle(
  context: LevelContext,
  label: string,
  position: THREE.Vector3,
  size: THREE.Vector3,
  accent: THREE.ColorRepresentation,
  rotationY = 0
): void {
  const material = context.materials.get("metal");
  const renderMaterial = context.materials.getRenderMaterial("metal").clone();
  if (renderMaterial instanceof THREE.MeshStandardMaterial) {
    renderMaterial.color.lerp(new THREE.Color(accent), 0.24);
    renderMaterial.roughness = 0.46;
  }
  const object = context.physics.addDynamicBox({
    label,
    material,
    renderMaterial,
    position,
    size,
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    category: "structure",
    scoreRole: "neutral",
    zoneId: "street",
    canFracture: true,
    destructible: true,
    scoreValue: 46,
    density: 1.35,
    restitution: 0.18,
    linearDamping: 0.08,
    angularDamping: 0.2
  });
  object.mesh.userData.disposeMaterial = true;
  decorateCityVehicle(object.mesh, { size, accent });
}

function addStreetCargo(
  context: LevelContext,
  label: string,
  materialId: MaterialId,
  position: THREE.Vector3,
  size: THREE.Vector3,
  rotationY: number
): void {
  const material = context.materials.get(materialId);
  const object = context.physics.addDynamicBox({
    label,
    material,
    renderMaterial: context.materials.getRenderMaterial(materialId),
    position,
    size,
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    category: "structure",
    scoreRole: "neutral",
    zoneId: "street-cargo",
    canFracture: true,
    destructible: true,
    scoreValue: 24,
    restitution: materialId === "foam" ? 0.36 : 0.18,
    linearDamping: 0.08,
    angularDamping: 0.18
  });
  object.mesh.userData.disposeMaterial = false;
}

function addPanel(
  context: LevelContext,
  name: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  color: THREE.ColorRepresentation,
  opacity: number,
  layer = 0
): void {
  const panelDepthOffset = Math.max(0, layer);
  const tileSize = 2.15;
  const columns = Math.max(1, Math.ceil(width / tileSize));
  const rows = Math.max(1, Math.ceil(depth / tileSize));
  const tileWidth = width / columns;
  const tileDepth = depth / rows;
  const physicsMaterial = context.materials.get(panelMaterialId(name));

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const renderMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
        side: THREE.DoubleSide,
        polygonOffset: panelDepthOffset > 0,
        polygonOffsetFactor: -panelDepthOffset,
        polygonOffsetUnits: -panelDepthOffset
      });
      const object = context.physics.addDynamicBox({
        label: name,
        material: physicsMaterial,
        renderMaterial,
        position: new THREE.Vector3(
          x - width * 0.5 + tileWidth * (column + 0.5),
          0.018 + panelDepthOffset * 0.004,
          z - depth * 0.5 + tileDepth * (row + 0.5)
        ),
        size: new THREE.Vector3(tileWidth, 0.032, tileDepth),
        category: "structure",
        scoreRole: "neutral",
        zoneId: "surface",
        canFracture: true,
        destructible: true,
        bodyType: "fixed",
        scoreValue: Math.max(1, Math.round(tileWidth * tileDepth * 0.35)),
        friction: 0.96,
        restitution: 0.04
      });
      object.mesh.castShadow = false;
      object.mesh.receiveShadow = true;
      object.mesh.renderOrder = panelDepthOffset * 0.1;
      object.mesh.userData.disposeMaterial = true;
    }
  }
}

function panelMaterialId(name: string): MaterialId {
  if (name.includes("water")) {
    return "glass";
  }
  if (name.includes("marking") || name.includes("stripe") || name.includes("zone")) {
    return "foam";
  }
  return "concrete";
}

function addSkylineBackdrop(context: LevelContext): void {
  for (let i = 0; i < 15; i += 1) {
    const width = 0.55 + (i % 4) * 0.22;
    const height = 1.4 + ((i * 7) % 5) * 0.42;
    const object = context.physics.addDynamicBox({
      label: "distant city backdrop",
      material: context.materials.get("concrete"),
      renderMaterial: new THREE.MeshStandardMaterial({ color: 0x151b22, roughness: 0.88, metalness: 0.02 }),
      position: new THREE.Vector3(-7.4 + i * 1.05, height * 0.5 - 0.02, -9.35 - (i % 3) * 0.16),
      size: new THREE.Vector3(width, height, 0.18),
      category: "structure",
      scoreRole: "neutral",
      zoneId: "skyline",
      canFracture: true,
      destructible: true,
      bodyType: "fixed",
      scoreValue: 18,
      friction: 0.92,
      restitution: 0.06
    });
    object.mesh.userData.disposeMaterial = true;
    if (i % 2 === 0) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(width * 0.58, 0.04, 0.022),
        new THREE.MeshBasicMaterial({ color: 0x36546b, transparent: true, opacity: 0.72 })
      );
      strip.position.set(0, height * 0.08 + 0.02, 0.1);
      strip.userData.disposeMaterial = true;
      object.mesh.add(strip);
    }
  }
}

function addStreetLight(context: LevelContext, x: number, z: number): void {
  const pole = context.physics.addDynamicBox({
    label: "street light pole",
    material: context.materials.get("metal"),
    renderMaterial: new THREE.MeshStandardMaterial({ color: 0x2a3339, roughness: 0.5, metalness: 0.55 }),
    position: new THREE.Vector3(x, 0.72, z),
    size: new THREE.Vector3(0.08, 1.45, 0.08),
    category: "structure",
    scoreRole: "neutral",
    zoneId: "street",
    canFracture: true,
    destructible: true,
    bodyType: "fixed",
    scoreValue: 8
  });
  pole.mesh.userData.disposeMaterial = true;

  const lamp = context.physics.addDynamicBox({
    label: "street light lamp",
    material: context.materials.get("glass"),
    renderMaterial: new THREE.MeshBasicMaterial({ color: 0xffdf8f }),
    position: new THREE.Vector3(x + 0.13, 1.45, z),
    size: new THREE.Vector3(0.32, 0.08, 0.18),
    category: "structure",
    scoreRole: "neutral",
    zoneId: "street",
    canFracture: true,
    destructible: true,
    bodyType: "fixed",
    scoreValue: 6
  });
  lamp.mesh.userData.disposeMaterial = true;
  const glow = new THREE.PointLight(0xffd48a, 0.32, 2.6, 2.2);
  glow.position.set(0.02, -0.09, 0);
  lamp.mesh.add(glow);
}

function addBillboard(context: LevelContext, x: number, z: number, color: THREE.ColorRepresentation): void {
  for (const px of [-0.45, 0.45]) {
    const post = context.physics.addDynamicBox({
      label: "city billboard post",
      material: context.materials.get("metal"),
      renderMaterial: new THREE.MeshStandardMaterial({ color: 0x3d484f, roughness: 0.46, metalness: 0.62 }),
      position: new THREE.Vector3(x + px, 0.57, z),
      size: new THREE.Vector3(0.055, 1.15, 0.055),
      category: "structure",
      scoreRole: "neutral",
      zoneId: "street",
      canFracture: true,
      destructible: true,
      bodyType: "fixed",
      scoreValue: 7
    });
    post.mesh.userData.disposeMaterial = true;
  }
  const face = context.physics.addDynamicBox({
    label: "city billboard face",
    material: context.materials.get("foam"),
    renderMaterial: new THREE.MeshBasicMaterial({ color }),
    position: new THREE.Vector3(x, 1.22, z),
    size: new THREE.Vector3(1.28, 0.45, 0.055),
    category: "structure",
    scoreRole: "neutral",
    zoneId: "street",
    canFracture: true,
    destructible: true,
    bodyType: "fixed",
    scoreValue: 12
  });
  face.mesh.userData.disposeMaterial = true;
}
