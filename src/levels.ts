import * as THREE from "three";
import {
  decorateBuildingCell,
  decorateCityVehicle,
  decorateHazardIndicator,
  decorateStreetCargo,
  decorateTrafficBarricade,
  type BuildingVisualStyle
} from "./cityVisuals";
import { MaterialCatalog, type MaterialId } from "./materialCatalog";
import { PhysicsWorld, type ScoreRole, type TrafficRoute } from "./physics";
import type { ArcadeBonusThreshold } from "./arcade";
import { decalAtlasTile, materialAtlasTile } from "./visualAssets";

type TriggerType = "transformer" | "springPad" | "shockCanister";
const panelRenderMaterials = new Map<string, THREE.Material>();

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
  chaosBrief: string;
  cannonPosition: THREE.Vector3;
  defaultAimPoint: THREE.Vector3;
  cameraTarget: THREE.Vector3;
  mission: ArcadeMissionFields;
  setup(context: LevelContext): void;
}

export interface ArcadeMissionFields {
  arc: "object-destruction";
  order: number;
  targetZone: string;
  scoreThresholds: {
    oneStar: number;
    twoStar: number;
    threeStar: number;
  };
  targetDamageThreshold: number;
  bonusThreshold: ArcadeBonusThreshold;
  bonusObjective: string;
  briefingHint: string;
}

export const TEST_CHAMBERS: TestChamber[] = [
  {
    id: "hazard-junction",
    name: "Hazard Junction",
    description: "A dense hazard city packed below the high siege battery.",
    objective: "Build a maximum Mayhem Score across the orange hazard core, transformer relays, vehicles, cargo, and power lines.",
    chaosBrief: "Everything is a target. Every break, bounce, relay detonation, and moving wreck adds to the route.",
    cannonPosition: new THREE.Vector3(0, 6.08, 24.55),
    defaultAimPoint: new THREE.Vector3(0, 0.16, -3.4),
    cameraTarget: new THREE.Vector3(0, 0.9, -2.6),
    mission: {
      arc: "object-destruction",
      order: 1,
      targetZone: "hazard-core",
      scoreThresholds: {
        oneStar: 2_200_000,
        twoStar: 3_000_000,
        threeStar: 3_900_000
      },
      targetDamageThreshold: 10_000,
      bonusThreshold: { metric: "chainReactionCount", minimum: 2 },
      bonusObjective: "Start at least two secondary hits through the foundry, transformer relays, cargo, or street grid.",
      briefingHint: "The densest score is no longer a clean route: break the core, kick vehicles into relays, and let power-grid debris travel."
    },
    setup: (context) => {
      addCityGround(context);
      spawnTargetDistrict(context);
      spawnSecondaryHazardDistricts(context);
      spawnNeutralCityBlocks(context);
      spawnInfillCityBlocks(context);
      spawnDenseUrbanGrid(context);
      spawnCascadeHighRiseCorridors(context);
      spawnVacantLotInfill(context);
      spawnHazardRelays(context);
      spawnPowerGrid(context);
      spawnStreetSetpieces(context);
    }
  },
  {
    id: "breaker-yard",
    name: "Breaker Yard",
    description: "A short material yard packed with fragile relays.",
    objective: "Punch through the breaker spine and turn every booth, kiosk, and skid into extra wreckage.",
    chaosBrief: "Relay booths are now hazards, not things to spare. Use them to multiply the blast.",
    cannonPosition: new THREE.Vector3(-5.2, 5.92, 15.3),
    defaultAimPoint: new THREE.Vector3(0.1, 0.16, -2.7),
    cameraTarget: new THREE.Vector3(-0.8, 0.75, -1.5),
    mission: {
      arc: "object-destruction",
      order: 2,
      targetZone: "breaker-spine",
      scoreThresholds: {
        oneStar: 900_000,
        twoStar: 1_250_000,
        threeStar: 1_650_000
      },
      targetDamageThreshold: 6_500,
      bonusThreshold: { metric: "collateralChaos", minimum: 3_800 },
      bonusObjective: "Rack up 3,800+ collateral chaos from relay booths, cargo, and vehicle debris.",
      briefingHint: "A straight hit starts Object Damage; angled debris through the relays is where Collateral Chaos climbs."
    },
    setup: (context) => setupCompactChamber(context, BREAKER_YARD_CHAMBER)
  },
  {
    id: "switchback-crush",
    name: "Switchback Crush",
    description: "A compact lane where soft cargo can turn one hit into a dense object chain.",
    objective: "Break the glass depot, archive pods, foam skids, service crates, and switchback relays in one messy route.",
    chaosBrief: "Every archive, bumper, and service crate is fair game. Flood the lane with debris and chain reactions.",
    cannonPosition: new THREE.Vector3(5.55, 5.95, 14.8),
    defaultAimPoint: new THREE.Vector3(0.4, 0.16, -1.8),
    cameraTarget: new THREE.Vector3(0.7, 0.85, -1.15),
    mission: {
      arc: "object-destruction",
      order: 3,
      targetZone: "glass-depot",
      scoreThresholds: {
        oneStar: 1_050_000,
        twoStar: 1_500_000,
        threeStar: 2_050_000
      },
      targetDamageThreshold: 7_200,
      bonusThreshold: { metric: "collateralChaos", minimum: 5_200 },
      bonusObjective: "Push 5,200+ collateral chaos from crates, archive glass, and relay chains before scoring settles.",
      briefingHint: "Foam is the steering wheel; archive glass and service crates are the multiplier."
    },
    setup: (context) => setupCompactChamber(context, SWITCHBACK_CRUSH_CHAMBER)
  },
  {
    id: "crosswind-depot",
    name: "Crosswind Depot",
    description: "A crosswind depot route with volatile side pods flanking the lane.",
    objective: "Rip the depot pair apart, then drive debris through both side pods and the windbreak.",
    chaosBrief: "There is no restraint drill anymore. Broad splash is a valid route if it keeps the chain alive.",
    cannonPosition: new THREE.Vector3(-4.3, 5.95, 14.4),
    defaultAimPoint: new THREE.Vector3(0.3, 0.16, -1.9),
    cameraTarget: new THREE.Vector3(0.2, 0.85, -0.8),
    mission: {
      arc: "object-destruction",
      order: 4,
      targetZone: "depot-pair",
      scoreThresholds: {
        oneStar: 1_150_000,
        twoStar: 1_650_000,
        threeStar: 2_250_000
      },
      targetDamageThreshold: 7_800,
      bonusThreshold: { metric: "maxChainCombo", minimum: 3 },
      bonusObjective: "Reach a x3 chain combo through depot, side pods, and market windbreak.",
      briefingHint: "Aim for one core and let the crosswind lane throw wreckage into everything around it."
    },
    setup: (context) => setupCompactChamber(context, CROSSWIND_DEPOT_CHAMBER)
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

interface CompactPanelSpec {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  color: THREE.ColorRepresentation;
  opacity: number;
}

interface CompactCargoSpec {
  label: string;
  materialId: MaterialId;
  position: THREE.Vector3;
  size: THREE.Vector3;
  rotationY: number;
}

interface CompactVehicleSpec {
  label: string;
  position: THREE.Vector3;
  size: THREE.Vector3;
  accent: THREE.ColorRepresentation;
  rotationY?: number;
  linearVelocity?: THREE.Vector3;
  trafficRoute?: TrafficRoute;
}

interface CompactChamberSpec {
  panels: CompactPanelSpec[];
  stacks: BuildingSpec[];
  cargo: CompactCargoSpec[];
  vehicles: CompactVehicleSpec[];
  lights: Array<[number, number]>;
  billboards: Array<[number, number, THREE.ColorRepresentation]>;
}

interface CityRoadCorridor {
  axis: "x" | "z";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const CITY_ROAD_CLEARANCE = 0.18;
const CITY_ROAD_CORRIDORS: CityRoadCorridor[] = [
  { axis: "x", minX: -1.08, maxX: 1.08, minZ: -11.7, maxZ: 10.5 },
  { axis: "z", minX: -12.9, maxX: 12.9, minZ: -2.28, maxZ: -0.42 },
  { axis: "z", minX: -11.4, maxX: 11.4, minZ: 4.48, maxZ: 5.53 },
  { axis: "x", minX: 9.66, maxX: 10.54, minZ: -10, maxZ: 8.6 },
  { axis: "z", minX: -2.7, maxX: 11.1, minZ: 7.92, maxZ: 8.78 }
];
const NORTH_TRAFFIC_LOOP: Array<[number, number]> = [
  [0.42, -7.4],
  [10.34, -7.4],
  [10.34, -1.62],
  [0.42, -1.62]
];
const CENTRAL_TRAFFIC_LOOP: Array<[number, number]> = [
  [0.42, -1.62],
  [10.34, -1.62],
  [10.34, 4.78],
  [0.42, 4.78]
];
const CENTRAL_TRAFFIC_LOOP_OPPOSITE: Array<[number, number]> = [
  [-0.42, -0.96],
  [-0.42, 5.22],
  [9.86, 5.22],
  [9.86, -0.96]
];
const BATTERY_TRAFFIC_LOOP: Array<[number, number]> = [
  [0.42, 4.78],
  [10.34, 4.78],
  [10.34, 8.12],
  [0.42, 8.12]
];
const BATTERY_TRAFFIC_LOOP_OPPOSITE: Array<[number, number]> = [
  [-0.42, 8.58],
  [-0.42, 5.22],
  [9.86, 5.22],
  [9.86, 8.58]
];

const BREAKER_YARD_CHAMBER: CompactChamberSpec = {
  panels: [
    { name: "breaker yard floor", x: 0, z: -1.1, width: 12.6, depth: 10.2, color: 0x1d252b, opacity: 1 },
    { name: "breaker target zone", x: 0, z: -3.15, width: 4.8, depth: 2.8, color: 0xff7138, opacity: 0.35 },
    { name: "relay hazard zone", x: -4.3, z: -0.5, width: 2.4, depth: 2.7, color: 0xff8f38, opacity: 0.3 },
    { name: "coolant hazard zone", x: 4.2, z: 1.25, width: 2.5, depth: 2.3, color: 0xff8f38, opacity: 0.3 },
    { name: "breaker lane marking", x: 0, z: 2.35, width: 7.8, depth: 0.16, color: 0xf3c96d, opacity: 0.72 }
  ],
  stacks: [
    compactStack("Breaker spine", "concrete", 0, -3.15, 0.58, 0.54, 0.62, 3, 4, "target", "breaker-spine", 78, "industrial"),
    compactStack("Relay booth", "glass", -4.35, -0.5, 0.54, 0.58, 0.58, 2, 2, "target", "relay-booth", 150, "civic"),
    compactStack("Coolant kiosk", "wood", 4.2, 1.25, 0.6, 0.5, 0.62, 2, 2, "target", "coolant-kiosk", 135, "warehouse"),
    compactStack("Scrap buffer", "metal", -2.15, 0.95, 0.56, 0.42, 0.56, 2, 3, "neutral", "scrap-buffer", 30, "warehouse", Math.PI * 0.08),
    compactStack("Foam absorber row", "foam", 2.2, -0.2, 0.5, 0.36, 0.52, 2, 4, "neutral", "absorber-row", 22, "market", -Math.PI * 0.08)
  ],
  cargo: [
    compactCargo("Metal brake drum", "metal", -1.6, 0.31, 1.1, 0.62, 0.48, 0.52, Math.PI * 0.12),
    compactCargo("Foam safety crate", "foam", 1.65, 0.28, 0.8, 0.58, 0.38, 0.52, -Math.PI * 0.14),
    compactCargo("Wood pallet stop", "wood", -0.45, 0.35, 1.75, 0.72, 0.42, 0.56, Math.PI * 0.5),
    compactCargo("Glass meter case", "glass", 3.05, 0.3, -2.15, 0.48, 0.58, 0.48, -Math.PI * 0.08)
  ],
  vehicles: [
    {
      label: "Breaker yard tug",
      position: new THREE.Vector3(-3.05, 0.31, 2.25),
      size: new THREE.Vector3(0.46, 0.38, 0.82),
      accent: 0xffb14f,
      rotationY: Math.PI * 0.5,
      trafficRoute: trafficRoute("x", -4.2, 3.8, 0.8, 1)
    }
  ],
  lights: [
    [-5.3, -4.8],
    [5.25, -4.8],
    [-5.25, 3.25],
    [5.25, 3.25]
  ],
  billboards: [[0, -5.55, 0xff8f38]]
};

const SWITCHBACK_CRUSH_CHAMBER: CompactChamberSpec = {
  panels: [
    { name: "switchback crush floor", x: 0.2, z: -0.55, width: 13.6, depth: 10.8, color: 0x1a2229, opacity: 1 },
    { name: "glass depot target zone", x: 1.85, z: -3.25, width: 4.4, depth: 2.6, color: 0xff7138, opacity: 0.34 },
    { name: "switchback target zone", x: -2.2, z: 0.8, width: 3.3, depth: 2.5, color: 0xff7138, opacity: 0.28 },
    { name: "archive hazard zone", x: 4.75, z: 1.55, width: 2.6, depth: 2.8, color: 0xff8f38, opacity: 0.3 },
    { name: "switchback road marking", x: -0.3, z: 2.95, width: 8.8, depth: 0.14, color: 0xf3c96d, opacity: 0.68 },
    { name: "debris runoff channel", x: -5.1, z: -2.9, width: 0.9, depth: 4.6, color: 0x303943, opacity: 0.85 }
  ],
  stacks: [
    compactStack("Glass depot column", "glass", 1.85, -3.2, 0.5, 0.72, 0.5, 3, 3, "target", "glass-depot", 88, "glassTower", Math.PI * 0.06),
    compactStack("Switchback mixer", "foam", -2.25, 0.75, 0.56, 0.42, 0.58, 2, 4, "target", "glass-depot", 62, "market", -Math.PI * 0.08),
    compactStack("Glass archive", "glass", 4.75, 1.55, 0.52, 0.6, 0.54, 3, 2, "target", "glass-archive", 160, "glassTower"),
    compactStack("Canal screens", "metal", -5.0, -0.25, 0.44, 0.42, 0.64, 2, 4, "neutral", "canal-screens", 26, "warehouse", Math.PI * 0.5),
    compactStack("Soft baffle row", "foam", -0.1, 2.85, 0.48, 0.34, 0.5, 2, 5, "neutral", "soft-baffle", 20, "market")
  ],
  cargo: [
    compactCargo("Archive pump crate", "glass", 0.35, 0.28, -1.4, 0.46, 0.56, 0.46, Math.PI * 0.12),
    compactCargo("Foam redirect skid", "foam", -1.15, 0.26, -0.75, 0.78, 0.36, 0.52, -Math.PI * 0.22),
    compactCargo("Wood service pallet", "wood", 2.85, 0.31, -0.75, 0.7, 0.42, 0.56, Math.PI * 0.18),
    compactCargo("Metal pump case", "metal", -3.55, 0.3, 2.15, 0.72, 0.44, 0.48, Math.PI * 0.5),
    compactCargo("Foam corner skid", "foam", 1.15, 0.25, 2.65, 0.72, 0.34, 0.5, Math.PI * 0.04)
  ],
  vehicles: [
    {
      label: "Switchback yard scooter",
      position: new THREE.Vector3(-4.25, 0.27, 1.65),
      size: new THREE.Vector3(0.34, 0.32, 0.62),
      accent: 0xff70b0,
      rotationY: Math.PI * 0.5,
      trafficRoute: trafficRoute("x", -4.8, 0.8, 1, 1)
    }
  ],
  lights: [
    [-5.75, -4.8],
    [5.85, -4.8],
    [-5.75, 4.05],
    [5.85, 4.05]
  ],
  billboards: [[-3.15, -4.75, 0xff6b93]]
};

const CROSSWIND_DEPOT_CHAMBER: CompactChamberSpec = {
  panels: [
    { name: "crosswind depot floor", x: 0, z: -0.35, width: 14.2, depth: 11.2, color: 0x1b2329, opacity: 1 },
    { name: "depot target zone west", x: -2.25, z: -2.45, width: 3.2, depth: 2.8, color: 0xff7138, opacity: 0.34 },
    { name: "depot target zone east", x: 2.45, z: -2.45, width: 3.2, depth: 2.8, color: 0xff7138, opacity: 0.34 },
    { name: "west pod hazard zone", x: -4.75, z: 1.35, width: 2.8, depth: 2.9, color: 0xff4f66, opacity: 0.34 },
    { name: "east pod hazard zone", x: 4.85, z: 1.55, width: 2.8, depth: 2.6, color: 0xff8f38, opacity: 0.3 },
    { name: "depot crosswalk stripe", x: 0, z: 1.6, width: 8.5, depth: 0.16, color: 0xd7e2e8, opacity: 0.74 },
    { name: "depot lane marking", x: 0, z: -4.35, width: 9.3, depth: 0.14, color: 0xf3c96d, opacity: 0.68 }
  ],
  stacks: [
    compactStack("West depot core", "concrete", -2.25, -2.45, 0.58, 0.52, 0.58, 3, 3, "target", "depot-pair", 82, "industrial", Math.PI * 0.04),
    compactStack("East depot core", "metal", 2.45, -2.45, 0.52, 0.46, 0.64, 3, 3, "target", "depot-pair", 80, "warehouse", -Math.PI * 0.04),
    compactStack("West glass pod", "glass", -4.75, 1.35, 0.52, 0.62, 0.54, 3, 2, "target", "west-crosswind", 170, "glassTower"),
    compactStack("East wood pod", "wood", 4.85, 1.55, 0.58, 0.5, 0.62, 2, 3, "target", "east-crosswind", 150, "warehouse"),
    compactStack("Market windbreak", "foam", 0, 3.25, 0.5, 0.36, 0.5, 2, 5, "neutral", "market-windbreak", 22, "market"),
    compactStack("North service rail", "metal", 0.1, -5.15, 0.5, 0.38, 0.52, 2, 5, "neutral", "service-rail", 24, "warehouse")
  ],
  cargo: [
    compactCargo("Depot hinge crate", "metal", -0.2, 0.3, -1.25, 0.72, 0.44, 0.5, Math.PI * 0.5),
    compactCargo("Foam west bumper", "foam", -3.15, 0.24, 0.05, 0.8, 0.34, 0.48, -Math.PI * 0.08),
    compactCargo("Wood east bumper", "wood", 3.3, 0.29, 0.1, 0.74, 0.4, 0.5, Math.PI * 0.08),
    compactCargo("Glass meter cart", "glass", 0.85, 0.29, 2.15, 0.48, 0.56, 0.48, Math.PI * 0.18)
  ],
  vehicles: [
    {
      label: "Depot supply van",
      position: new THREE.Vector3(-0.65, 0.32, 3.75),
      size: new THREE.Vector3(0.54, 0.42, 0.92),
      accent: 0xff5f8f,
      rotationY: Math.PI * 0.5,
      trafficRoute: trafficRoute("x", -2.5, 2.2, 0.85, 1)
    },
    {
      label: "Depot service cart",
      position: new THREE.Vector3(5.75, 0.28, -3.95),
      size: new THREE.Vector3(0.36, 0.32, 0.62),
      accent: 0xffb55f,
      trafficRoute: trafficRoute("z", -5.1, -1.8, 0.85, 1)
    }
  ],
  lights: [
    [-6.25, -5.0],
    [6.25, -5.0],
    [-6.25, 4.35],
    [6.25, 4.35]
  ],
  billboards: [[-1.95, -5.25, 0x7ee8ff]]
};

function compactStack(
  label: string,
  materialId: MaterialId,
  x: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  floors: number,
  columns: number,
  scoreRole: ScoreRole,
  zoneId: string,
  scoreValue: number,
  style: BuildingVisualStyle,
  rotationY = 0,
  stagger = 0
): BuildingSpec {
  return {
    label,
    materialId,
    position: new THREE.Vector3(x, 0, z),
    size: new THREE.Vector3(width, height, depth),
    floors,
    columns,
    scoreRole,
    zoneId,
    scoreValue,
    style,
    rotationY,
    stagger
  };
}

function compactCargo(
  label: string,
  materialId: MaterialId,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  rotationY: number
): CompactCargoSpec {
  return {
    label,
    materialId,
    position: new THREE.Vector3(x, y, z),
    size: new THREE.Vector3(width, height, depth),
    rotationY
  };
}

function trafficRoute(
  axis: TrafficRoute["axis"],
  min: number,
  max: number,
  speed: number,
  direction: TrafficRoute["direction"],
  laneOffset?: number
): TrafficRoute {
  return { axis, min, max, speed, direction, laneOffset };
}

function trafficLoop(points: Array<[number, number]>, speed: number, segmentIndex = 0): TrafficRoute {
  const from = points[segmentIndex % points.length];
  const to = points[(segmentIndex + 1) % points.length];
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const axis: TrafficRoute["axis"] = Math.abs(dx) >= Math.abs(dz) ? "x" : "z";
  const direction: TrafficRoute["direction"] = (axis === "x" ? dx : dz) >= 0 ? 1 : -1;
  return {
    axis,
    min: Math.min(axis === "x" ? from[0] : from[1], axis === "x" ? to[0] : to[1]),
    max: Math.max(axis === "x" ? from[0] : from[1], axis === "x" ? to[0] : to[1]),
    speed,
    direction,
    waypoints: points.map(([x, z]) => ({ x, z })),
    segmentIndex
  };
}

function setupCompactChamber(context: LevelContext, spec: CompactChamberSpec): void {
  spec.panels.forEach((panel, layer) => {
    addPanel(context, panel.name, panel.x, panel.z, panel.width, panel.depth, panel.color, panel.opacity, layer);
  });

  for (const stack of spec.stacks) {
    spawnBuildingStack(context, stack);
  }
  for (const cargo of spec.cargo) {
    addStreetCargo(context, cargo.label, cargo.materialId, cargo.position, cargo.size, cargo.rotationY);
  }
  for (const vehicle of spec.vehicles) {
    addCityVehicle(
      context,
      vehicle.label,
      vehicle.position,
      vehicle.size,
      vehicle.accent,
      vehicle.rotationY,
      vehicle.linearVelocity,
      vehicle.trafficRoute
    );
  }
  for (const [x, z] of spec.lights) {
    addStreetLight(context, x, z);
  }
  for (const [x, z, color] of spec.billboards) {
    addBillboard(context, x, z, color);
  }
}

function spawnTargetDistrict(context: LevelContext): void {
  spawnCityBuildingStack(context, {
    label: "Contaminated foundry",
    materialId: "concrete",
    position: new THREE.Vector3(-2.75, 0, -2.9),
    size: new THREE.Vector3(0.72, 0.56, 0.72),
    floors: 4,
    columns: 4,
    scoreRole: "target",
    zoneId: "hazard-core",
    scoreValue: 115,
    style: "industrial",
    stagger: 0.16
  });
  spawnCityBuildingStack(context, {
    label: "Toxic archive",
    materialId: "glass",
    position: new THREE.Vector3(2.15, 0, -2.95),
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

function spawnSecondaryHazardDistricts(context: LevelContext): void {
  spawnCityBuildingStack(context, {
    label: "Relay glass depot",
    materialId: "glass",
    position: new THREE.Vector3(-5.45, 0, -4.62),
    size: new THREE.Vector3(0.54, 0.64, 0.58),
    floors: 3,
    columns: 4,
    scoreRole: "target",
    zoneId: "hazard-relay",
    scoreValue: 86,
    style: "glassTower",
    stagger: 0.08
  });
  spawnCityBuildingStack(context, {
    label: "Foam fuel depot",
    materialId: "foam",
    position: new THREE.Vector3(5.18, 0, 2.38),
    size: new THREE.Vector3(0.66, 0.52, 0.7),
    floors: 3,
    columns: 4,
    scoreRole: "target",
    zoneId: "hazard-relay",
    scoreValue: 78,
    style: "market",
    stagger: -0.12
  });
}

function spawnNeutralCityBlocks(context: LevelContext): void {
  spawnCityBuildingStack(context, {
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
  spawnCityBuildingStack(context, {
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
  spawnCityBuildingStack(context, {
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
  spawnCityBuildingStack(context, {
    label: "North utility slabs",
    materialId: "metal",
    position: new THREE.Vector3(-2.8, 0, -8.65),
    size: new THREE.Vector3(0.58, 0.42, 0.58),
    floors: 2,
    columns: 5,
    scoreRole: "neutral",
    zoneId: "north-utilities",
    scoreValue: 30,
    style: "warehouse",
    stagger: 0.04
  });
  spawnCityBuildingStack(context, {
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
  spawnCityBuildingStack(context, {
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
  spawnCityBuildingStack(context, {
    label: "West service flats",
    materialId: "wood",
    position: new THREE.Vector3(-7.35, 0, 2.25),
    size: new THREE.Vector3(0.54, 0.46, 0.58),
    floors: 3,
    columns: 2,
    scoreRole: "neutral",
    zoneId: "west-service",
    scoreValue: 30,
    style: "utility",
    stagger: 0.08,
    rotationY: Math.PI * 0.5
  });
  spawnCityBuildingStack(context, {
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
  spawnCityBuildingStack(context, {
    label: "Market annex",
    materialId: "foam",
    position: new THREE.Vector3(-2.6, 0, 6.55),
    size: new THREE.Vector3(0.5, 0.38, 0.5),
    floors: 2,
    columns: 5,
    scoreRole: "neutral",
    zoneId: "market-annex",
    scoreValue: 24,
    style: "market",
    stagger: -0.06
  });
  spawnCityBuildingStack(context, {
    label: "Canal office sliver",
    materialId: "glass",
    position: new THREE.Vector3(8.05, 0, 0.2),
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
  spawnCityBuildingStack(context, {
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
  spawnCityBuildingStack(context, {
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
  spawnCityBuildingStack(context, {
    label: "Battery approach offices",
    materialId: "glass",
    position: new THREE.Vector3(10.97, 0, 6.65),
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
  spawnCityBuildingStack(context, {
    label: "South depot row",
    materialId: "metal",
    position: new THREE.Vector3(-3.05, 0, 9.3),
    size: new THREE.Vector3(0.56, 0.42, 0.56),
    floors: 2,
    columns: 6,
    scoreRole: "neutral",
    zoneId: "south-depot",
    scoreValue: 28,
    style: "warehouse",
    stagger: -0.03
  });
  spawnCityBuildingStack(context, {
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
      position: new THREE.Vector3(-2.35, 0, 0.05),
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
      position: new THREE.Vector3(-11.85, 0, 1.35),
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
      position: new THREE.Vector3(-11.9, 0, 4.45),
      size: new THREE.Vector3(0.5, 0.46, 0.54),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "west-battery",
      scoreValue: 30,
      style: "utility",
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
    spawnCityBuildingStack(context, block);
  }
}

function spawnCascadeHighRiseCorridors(context: LevelContext): void {
  const highRiseBlocks: BuildingSpec[] = [
    {
      label: "Hazard high-rise spine",
      materialId: "concrete",
      position: new THREE.Vector3(-2.4, 0, -4.85),
      size: new THREE.Vector3(0.54, 0.58, 0.58),
      floors: 7,
      columns: 4,
      scoreRole: "target",
      zoneId: "hazard-core",
      scoreValue: 92,
      style: "industrial",
      stagger: 0.06
    },
    {
      label: "Orange reactor offices",
      materialId: "glass",
      position: new THREE.Vector3(2.2, 0, 0.2),
      size: new THREE.Vector3(0.45, 0.72, 0.46),
      floors: 6,
      columns: 4,
      scoreRole: "target",
      zoneId: "hazard-core",
      scoreValue: 86,
      style: "glassTower",
      stagger: -0.04,
      rotationY: -Math.PI * 0.06
    },
    {
      label: "Cascade flats west",
      materialId: "concrete",
      position: new THREE.Vector3(-5.0, 0, 0.15),
      size: new THREE.Vector3(0.52, 0.56, 0.54),
      floors: 6,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "cascade-west",
      scoreValue: 38,
      style: "apartment",
      stagger: 0.08,
      rotationY: Math.PI * 0.04
    },
    {
      label: "Cascade flats east",
      materialId: "concrete",
      position: new THREE.Vector3(4.65, 0, 0.95),
      size: new THREE.Vector3(0.52, 0.56, 0.54),
      floors: 6,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "cascade-east",
      scoreValue: 38,
      style: "apartment",
      stagger: -0.08,
      rotationY: -Math.PI * 0.04
    },
    {
      label: "Midtown glass needles",
      materialId: "glass",
      position: new THREE.Vector3(-2.4, 0, 2.25),
      size: new THREE.Vector3(0.42, 0.74, 0.42),
      floors: 6,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "midtown-needles",
      scoreValue: 36,
      style: "glassTower",
      stagger: 0.04
    },
    {
      label: "Battery canyon towers",
      materialId: "metal",
      position: new THREE.Vector3(2.65, 0, 6.05),
      size: new THREE.Vector3(0.5, 0.52, 0.56),
      floors: 5,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "battery-canyon",
      scoreValue: 34,
      style: "warehouse",
      stagger: -0.05
    },
    {
      label: "West impact tenements",
      materialId: "wood",
      position: new THREE.Vector3(-7.8, 0, -3.85),
      size: new THREE.Vector3(0.52, 0.52, 0.56),
      floors: 5,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "west-impact",
      scoreValue: 32,
      style: "utility",
      stagger: 0.07,
      rotationY: Math.PI * 0.5
    },
    {
      label: "East impact tenements",
      materialId: "glass",
      position: new THREE.Vector3(8.25, 0, 2.55),
      size: new THREE.Vector3(0.44, 0.68, 0.46),
      floors: 6,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "east-impact",
      scoreValue: 36,
      style: "glassTower",
      stagger: -0.04,
      rotationY: Math.PI * 0.5
    }
  ];

  for (const block of highRiseBlocks) {
    spawnCityBuildingStack(context, block);
  }
}

function spawnVacantLotInfill(context: LevelContext): void {
  const infillBlocks: BuildingSpec[] = [
    {
      label: "North blindside towers",
      materialId: "glass",
      position: new THREE.Vector3(2.7, 0, -10.45),
      size: new THREE.Vector3(0.44, 0.68, 0.46),
      floors: 5,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "north-blindside",
      scoreValue: 35,
      style: "glassTower",
      stagger: 0.04
    },
    {
      label: "Northwest slab blocks",
      materialId: "concrete",
      position: new THREE.Vector3(-6.9, 0, -10.65),
      size: new THREE.Vector3(0.52, 0.54, 0.56),
      floors: 5,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "northwest-slabs",
      scoreValue: 34,
      style: "apartment",
      stagger: -0.06
    },
    {
      label: "Northeast service towers",
      materialId: "metal",
      position: new THREE.Vector3(7.9, 0, -10.25),
      size: new THREE.Vector3(0.5, 0.5, 0.58),
      floors: 4,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "northeast-service",
      scoreValue: 32,
      style: "warehouse",
      stagger: 0.05
    },
    {
      label: "West dead-zone apartments",
      materialId: "concrete",
      position: new THREE.Vector3(-14.15, 0, -2.45),
      size: new THREE.Vector3(0.52, 0.54, 0.56),
      floors: 5,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "west-dead-zone",
      scoreValue: 34,
      style: "apartment",
      stagger: 0.06,
      rotationY: Math.PI * 0.5
    },
    {
      label: "West empty-lot markets",
      materialId: "foam",
      position: new THREE.Vector3(-14.05, 0, 5.7),
      size: new THREE.Vector3(0.48, 0.42, 0.5),
      floors: 4,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "west-empty-lot",
      scoreValue: 25,
      style: "market",
      stagger: -0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "East dead-zone offices",
      materialId: "glass",
      position: new THREE.Vector3(16.15, 0, -0.25),
      size: new THREE.Vector3(0.44, 0.66, 0.46),
      floors: 5,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "east-dead-zone",
      scoreValue: 35,
      style: "glassTower",
      stagger: 0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Southeast impact condos",
      materialId: "wood",
      position: new THREE.Vector3(11.1, 0, 17.2),
      size: new THREE.Vector3(0.52, 0.5, 0.56),
      floors: 5,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "southeast-condos",
      scoreValue: 31,
      style: "utility",
      stagger: 0.06
    },
    {
      label: "Southwest impact condos",
      materialId: "concrete",
      position: new THREE.Vector3(-10.35, 0, 17.0),
      size: new THREE.Vector3(0.52, 0.54, 0.56),
      floors: 5,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "southwest-condos",
      scoreValue: 34,
      style: "apartment",
      stagger: -0.06
    }
  ];

  for (const block of infillBlocks) {
    spawnCityBuildingStack(context, block);
  }
}

function spawnHazardRelays(context: LevelContext): void {
  const relays: Array<[TriggerType, string, number, number, number, number, number, number]> = [
    ["transformer", "Power transformer", -3.25, -1.45, 0.5, 0.62, 0.46, Math.PI * 0.08],
    ["transformer", "Power transformer", 2.9, -3.75, 0.5, 0.62, 0.46, -Math.PI * 0.12],
    ["shockCanister", "Shock canister", -6.65, -0.25, 0.42, 0.58, 0.42, Math.PI * 0.5],
    ["shockCanister", "Shock canister", 6.25, 1.1, 0.42, 0.58, 0.42, -Math.PI * 0.5],
    ["springPad", "Spring collision pad", -1.35, 1.65, 0.78, 0.2, 0.58, Math.PI * 0.18],
    ["springPad", "Spring collision pad", 3.85, 3.4, 0.78, 0.2, 0.58, -Math.PI * 0.08]
  ];

  for (const [type, label, x, z, width, height, depth, rotationY] of relays) {
    addHazardRelay(context, type, label, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }
}

function spawnPowerGrid(context: LevelContext): void {
  const poleMaterial = context.materials.get("metal");
  const poleRenderMaterial = context.materials.getRenderMaterial("metal");
  for (const [x, z] of [
    [-4.8, -6.4],
    [-2.0, -6.2],
    [1.2, -5.85],
    [4.4, -5.6],
    [-5.8, 2.2],
    [-2.7, 2.55],
    [0.6, 2.85],
    [3.8, 3.15]
  ]) {
    const size = new THREE.Vector3(0.16, 1.16, 0.16);
    const position = alignCityObjectToRoadEdges(new THREE.Vector3(x, 0.58, z), size);
    const object = context.physics.addDynamicBox({
      label: "Power-grid mast",
      material: poleMaterial,
      renderMaterial: poleRenderMaterial,
      position,
      size,
      category: "structure",
      scoreRole: "target",
      zoneId: "power-grid",
      canFracture: true,
      destructible: true,
      scoreValue: 34,
      chainSource: true,
      restitution: 0.12,
      linearDamping: 0.12,
      angularDamping: 0.24,
      ccd: true
    });
    decorateHazardIndicator(object.mesh, { size, kind: "electric" });
    object.mesh.userData.disposeMaterial = false;
  }

  const cableRuns = [
    [-3.4, 0.5, -6.3, 2.95, 0.08, 0.08, Math.PI * 0.5],
    [2.75, 0.5, -5.75, 3.25, 0.08, 0.08, Math.PI * 0.5],
    [-4.25, 0.5, 2.35, 3.3, 0.08, 0.08, Math.PI * 0.5],
    [2.2, 0.5, 3.0, 3.25, 0.08, 0.08, Math.PI * 0.5]
  ] as const;
  for (const [x, y, z, width, height, depth, rotationY] of cableRuns) {
    addStreetCargo(context, "Loose power cable", "rubber", new THREE.Vector3(x, y, z), new THREE.Vector3(width, height, depth), rotationY);
  }
}

function addHazardRelay(
  context: LevelContext,
  type: TriggerType,
  label: string,
  position: THREE.Vector3,
  size: THREE.Vector3,
  rotationY: number
): void {
  const materialId = relayMaterialId(type);
  const material = context.materials.get(materialId);
  const safePosition = alignCityObjectToRoadEdges(position, size, rotationY);
  const object = context.physics.addDynamicBox({
    label,
    material,
    renderMaterial: relayRenderMaterial(type),
    position: safePosition,
    size,
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    category: "structure",
    scoreRole: "target",
    zoneId: "hazard-relay",
    canFracture: true,
    destructible: true,
    scoreValue: type === "shockCanister" ? 72 : type === "transformer" ? 68 : 54,
    chainSource: true,
    restitution: type === "springPad" ? 0.74 : 0.22,
    linearDamping: 0.08,
    angularDamping: 0.18,
    ccd: true
  });
  decorateHazardIndicator(object.mesh, { size, kind: type === "springPad" ? "combustible" : type === "transformer" ? "electric" : "explosive" });
  object.mesh.userData.disposeMaterial = true;
}

function spawnCityBuildingStack(context: LevelContext, spec: BuildingSpec): void {
  spawnBuildingStack(context, {
    ...spec,
    position: alignBuildingToCityRoadEdges(spec)
  });
}

function alignBuildingToCityRoadEdges(spec: BuildingSpec): THREE.Vector3 {
  const position = spec.position.clone();
  const footprint = cityBuildingFootprint(spec);
  return alignFootprintToCityRoadEdges(position, footprint, CITY_ROAD_CLEARANCE);
}

function alignCityObjectToRoadEdges(
  position: THREE.Vector3,
  size: THREE.Vector3,
  rotationY = 0,
  clearance = CITY_ROAD_CLEARANCE
): THREE.Vector3 {
  return alignFootprintToCityRoadEdges(position, cityObjectFootprint(size, rotationY), clearance);
}

function alignFootprintToCityRoadEdges(position: THREE.Vector3, footprint: { x: number; z: number }, clearance: number): THREE.Vector3 {
  const aligned = position.clone();
  for (let pass = 0; pass < 2; pass += 1) {
    for (const road of CITY_ROAD_CORRIDORS) {
      const bounds = {
        minX: aligned.x - footprint.x * 0.5,
        maxX: aligned.x + footprint.x * 0.5,
        minZ: aligned.z - footprint.z * 0.5,
        maxZ: aligned.z + footprint.z * 0.5
      };
      if (!boundsOverlap(bounds.minX, bounds.maxX, road.minX, road.maxX) || !boundsOverlap(bounds.minZ, bounds.maxZ, road.minZ, road.maxZ)) {
        continue;
      }

      if (road.axis === "x") {
        const roadCenter = (road.minX + road.maxX) * 0.5;
        const side = aligned.x <= roadCenter ? -1 : 1;
        aligned.x = side < 0 ? road.minX - footprint.x * 0.5 - clearance : road.maxX + footprint.x * 0.5 + clearance;
      } else {
        const roadCenter = (road.minZ + road.maxZ) * 0.5;
        const side = aligned.z <= roadCenter ? -1 : 1;
        aligned.z = side < 0 ? road.minZ - footprint.z * 0.5 - clearance : road.maxZ + footprint.z * 0.5 + clearance;
      }
    }
  }
  return aligned;
}

function cityBuildingFootprint(spec: BuildingSpec): { x: number; z: number } {
  const localWidth = spec.size.x * spec.columns + 0.035 * Math.max(0, spec.columns - 1);
  const staggerDepth = Math.abs(spec.stagger ?? 0) * Math.max(0, spec.columns - 1) * 0.28;
  return cityObjectFootprint(new THREE.Vector3(localWidth, spec.size.y, spec.size.z + staggerDepth), spec.rotationY ?? 0);
}

function cityObjectFootprint(size: THREE.Vector3, rotationY: number): { x: number; z: number } {
  const localWidth = size.x;
  const localDepth = size.z;
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  return {
    x: localWidth * cos + localDepth * sin,
    z: localWidth * sin + localDepth * cos
  };
}

function boundsOverlap(minA: number, maxA: number, minB: number, maxB: number): boolean {
  return minA < maxB && maxA > minB;
}

function spawnBuildingStack(context: LevelContext, spec: BuildingSpec): void {
  const material = context.materials.get(spec.materialId);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spec.rotationY ?? 0, 0));
  const floorStep = spec.size.y - 0.012;
  const columnCenter = (spec.columns - 1) * 0.5;
  const neutralLod = spec.scoreRole === "neutral";
  const floorGroupSize = neutralLod ? 2 : 1;
  const columnGroupSize = neutralLod ? 2 : 1;
  for (let floor = 0; floor < spec.floors; floor += floorGroupSize) {
    for (let column = 0; column < spec.columns; column += columnGroupSize) {
      const groupFloors = Math.min(floorGroupSize, spec.floors - floor);
      const groupColumns = Math.min(columnGroupSize, spec.columns - column);
      const groupColumnCenter = column + (groupColumns - 1) * 0.5;
      const groupHeight = spec.size.y * groupFloors - 0.012 * Math.max(0, groupFloors - 1);
      const groupSize = new THREE.Vector3(
        spec.size.x * groupColumns + 0.035 * Math.max(0, groupColumns - 1),
        groupHeight,
        spec.size.z
      );
      const offsetX = (groupColumnCenter - columnCenter) * (spec.size.x + 0.035);
      const offsetZ = (spec.stagger ?? 0) * (groupColumnCenter - columnCenter) * 0.28;
      const local = new THREE.Vector3(offsetX, groupHeight * 0.5 + floor * floorStep, offsetZ);
      local.applyQuaternion(rotation);
      const isRagdollStructure = shouldRagdollBuildingStack(spec);
      const object = context.physics.addDynamicBox({
        label: spec.label,
        material,
        renderMaterial: roleRenderMaterial(context.materials, spec.materialId, spec.scoreRole),
        position: spec.position.clone().add(local),
        size: groupSize,
        rotation,
        category: "structure",
        scoreRole: spec.scoreRole,
        zoneId: spec.zoneId,
        canFracture: true,
        destructible: true,
        bodyType: isRagdollStructure ? "dynamic" : "fixed",
        chainSource: true,
        scoreValue: spec.scoreValue * groupColumns * groupFloors,
        sleeping: true,
        friction: Math.max(0.86, material.friction),
        restitution: Math.min(0.08, material.restitution),
        linearDamping: isRagdollStructure ? 0.58 : 0.72,
        angularDamping: isRagdollStructure ? 1.05 : 1.35,
        additionalMass: groupSize.x * groupSize.y * groupSize.z * (isRagdollStructure ? 3.3 : 3.8),
        ccd: isRagdollStructure
      });
      decorateBuildingCell(object.mesh, {
        size: groupSize,
        materialId: spec.materialId,
        scoreRole: spec.scoreRole,
        style: spec.style,
        floor: floor + groupFloors - 1,
        column,
        floors: spec.floors,
        columns: spec.columns
      });
      if (shouldShowBuildingHazardIndicator(spec, floor, column)) {
        decorateHazardIndicator(object.mesh, {
          size: groupSize,
          kind: spec.zoneId.includes("power-grid") ? "electric" : spec.materialId === "wood" || spec.materialId === "foam" ? "combustible" : "explosive"
        });
      }
      object.mesh.userData.disposeMaterial = true;
      object.mesh.castShadow = spec.scoreRole !== "neutral";
    }
  }
}

function shouldShowBuildingHazardIndicator(spec: BuildingSpec, floor: number, column: number): boolean {
  const zone = spec.zoneId;
  const hazardousZone = zone.includes("hazard") || zone.includes("relay") || zone.includes("power-grid");
  const combustible = spec.materialId === "wood" || spec.materialId === "foam" || spec.materialId === "rubber";
  if (!hazardousZone && !combustible) {
    return false;
  }
  return floor === 0 && (column === 0 || column === spec.columns - 1 || spec.scoreRole === "target");
}

function shouldRagdollBuildingStack(spec: BuildingSpec): boolean {
  if (spec.scoreRole === "target") {
    return spec.materialId === "glass" || spec.materialId === "foam";
  }
  return (
    spec.zoneId.includes("cascade") ||
    spec.zoneId.includes("impact") ||
    spec.zoneId.includes("dead-zone") ||
    spec.zoneId.includes("empty-lot")
  );
}

function roleRenderMaterial(materials: MaterialCatalog, materialId: MaterialId, role: ScoreRole): THREE.Material {
  const material = materials.getRenderMaterial(materialId).clone();
  const tint = role === "target" ? new THREE.Color(0xff7a35) : null;
  if (tint && (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial || material instanceof THREE.MeshBasicMaterial)) {
    material.color.lerp(tint, 0.58);
    if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
      material.emissive = tint.clone().multiplyScalar(0.12);
      material.emissiveIntensity = 0.7;
    }
  }
  return material;
}

export function relayMaterialId(type: TriggerType): MaterialId {
  if (type === "transformer") {
    return "metal";
  }
  if (type === "springPad") {
    return "rubber";
  }
  return "glass";
}

export function relayRenderMaterial(type: TriggerType): THREE.Material {
  const color = type === "transformer" ? 0xffb23f : type === "springPad" ? 0x252a30 : 0x6fefff;
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
  addGroundPanel("west relay hazard zone", -5.4, -4.65, 4.25, 3.45, 0xff8f38, 0.28);
  addGroundPanel("east relay hazard zone", 5.15, 2.35, 4.4, 3.45, 0xff8f38, 0.28);

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
  addRoadDecals(context);
}

function addRoadDecals(context: LevelContext): void {
  const decals = [
    { name: "center oil smear", x: -0.65, z: -3.3, width: 1.25, depth: 0.42, tile: 9, color: 0x0d1114, opacity: 0.44, rotation: 0.18 },
    { name: "junction pothole", x: 1.25, z: -0.9, width: 0.68, depth: 0.5, tile: 12, color: 0x0b0e10, opacity: 0.5, rotation: -0.28 },
    { name: "north crosswalk wear", x: -2.95, z: -1.3, width: 1.15, depth: 0.3, tile: 7, color: 0xb9c7cf, opacity: 0.34, rotation: 0 },
    { name: "east service tire marks", x: 10.1, z: 1.65, width: 0.38, depth: 2.4, tile: 9, color: 0x10161b, opacity: 0.42, rotation: 0 },
    { name: "battery lane arrow", x: 4.45, z: 8.35, width: 1.1, depth: 0.42, tile: 5, color: 0xf0c96a, opacity: 0.58, rotation: Math.PI * 0.5 },
    { name: "south depot drain", x: -2.8, z: 11.35, width: 0.55, depth: 0.55, tile: 10, color: 0x6f7c83, opacity: 0.52, rotation: Math.PI * 0.25 },
    { name: "west alley grime", x: -10.8, z: 3.35, width: 0.48, depth: 2.1, tile: 12, color: 0x111719, opacity: 0.38, rotation: 0.05 },
    { name: "east curb scuff", x: 13.25, z: -4.65, width: 0.5, depth: 1.55, tile: 7, color: 0x8c969b, opacity: 0.3, rotation: -0.08 }
  ] as const;

  for (const decal of decals) {
    const material = new THREE.MeshBasicMaterial({
      color: decal.color,
      map: decalAtlasTile(decal.tile),
      transparent: true,
      opacity: decal.opacity,
      depthWrite: false,
      alphaTest: 0.03,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(decal.width, decal.depth), material);
    mesh.name = decal.name;
    mesh.position.set(decal.x, 0.056, decal.z);
    mesh.rotation.set(-Math.PI * 0.5, 0, decal.rotation);
    mesh.renderOrder = 2;
    mesh.userData.disposeMaterial = true;
    context.addDecoration(mesh);
  }
}

function spawnStreetSetpieces(context: LevelContext): void {
  for (const x of [-8.9, -6.8, -4.8, -3.6, -1.2, 1.25, 3.6, 5.4, 6.8, 8.65]) {
    const material = context.materials.get("rubber");
    const size = new THREE.Vector3(0.75, 0.35, 0.18);
    const position = alignCityObjectToRoadEdges(new THREE.Vector3(x, 0.22, 4.55), size);
    const object = context.physics.addDynamicBox({
      label: "Traffic barricade",
      material,
      renderMaterial: context.materials.getRenderMaterial("rubber"),
      position,
      size,
      category: "structure",
      scoreRole: "neutral",
      zoneId: "street",
      scoreValue: 12,
      restitution: 0.45,
      chainSource: true,
      ccd: true
    });
    decorateTrafficBarricade(object.mesh, { size, detail: "lean" });
    decorateHazardIndicator(object.mesh, { size, kind: "combustible" });
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

  addCityVehicle(context, "Delivery microbus", new THREE.Vector3(1.2, 0.32, -1.62), new THREE.Vector3(0.52, 0.42, 0.92), 0xf3b33c, Math.PI * 0.5, undefined, trafficLoop(CENTRAL_TRAFFIC_LOOP, 1.12, 0));
  addCityVehicle(context, "Service van", new THREE.Vector3(9.86, 0.34, 2.0), new THREE.Vector3(0.56, 0.46, 1.0), 0xff5f8f, Math.PI, undefined, trafficLoop(CENTRAL_TRAFFIC_LOOP_OPPOSITE, 1.0, 2));
  addCityVehicle(context, "Market scooter pod", new THREE.Vector3(6.8, 0.26, 4.78), new THREE.Vector3(0.34, 0.32, 0.64), 0xff6b93, -Math.PI * 0.5, undefined, trafficLoop(CENTRAL_TRAFFIC_LOOP, 1.12, 2));
  addCityVehicle(context, "Grid shuttle", new THREE.Vector3(5.2, 0.28, -7.4), new THREE.Vector3(0.4, 0.34, 0.74), 0xff6b93, Math.PI * 0.5, undefined, trafficLoop(NORTH_TRAFFIC_LOOP, 0.95, 0));
  addCityVehicle(context, "Canal maintenance truck", new THREE.Vector3(7.45, 0.34, -3.35), new THREE.Vector3(0.54, 0.44, 0.92), 0x9bb2bd);
  addCityVehicle(context, "Battery service cart", new THREE.Vector3(2.85, 0.27, 8.12), new THREE.Vector3(0.34, 0.3, 0.62), 0xffd66b, -Math.PI * 0.5, undefined, trafficLoop(BATTERY_TRAFFIC_LOOP, 0.92, 2));
  addCityVehicle(context, "East tram pod", new THREE.Vector3(10.34, 0.3, -0.2), new THREE.Vector3(0.48, 0.36, 0.94), 0x74dfff, 0, undefined, trafficLoop(CENTRAL_TRAFFIC_LOOP, 1.12, 1));
  addCityVehicle(context, "Depot hauler", new THREE.Vector3(6.0, 0.31, 5.22), new THREE.Vector3(0.52, 0.4, 0.9), 0xf0c16a, Math.PI * 0.5, undefined, trafficLoop(BATTERY_TRAFFIC_LOOP_OPPOSITE, 0.92, 1));
  addCityVehicle(context, "West grid loader", new THREE.Vector3(-9.7, 0.31, 1.65), new THREE.Vector3(0.48, 0.38, 0.78), 0xff9d4d, Math.PI * 0.5);
  addCityVehicle(context, "East courier pod", new THREE.Vector3(9.86, 0.28, 6.8), new THREE.Vector3(0.36, 0.32, 0.64), 0x87f0ff, 0, undefined, trafficLoop(BATTERY_TRAFFIC_LOOP_OPPOSITE, 0.92, 2));
  addCityVehicle(context, "Battery tram husk", new THREE.Vector3(6.6, 0.34, 8.12), new THREE.Vector3(0.58, 0.45, 1.08), 0xffd66b, -Math.PI * 0.5, undefined, trafficLoop(BATTERY_TRAFFIC_LOOP, 0.92, 2));
  addCityVehicle(context, "South depot van", new THREE.Vector3(-0.42, 0.33, 7.2), new THREE.Vector3(0.54, 0.43, 0.96), 0xb2c0c8, Math.PI, undefined, trafficLoop(BATTERY_TRAFFIC_LOOP_OPPOSITE, 0.92, 0));

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
  rotationY = 0,
  linearVelocity?: THREE.Vector3,
  route?: TrafficRoute
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
    scoreRole: "target",
    zoneId: "moving-vehicles",
    canFracture: true,
    destructible: true,
    scoreValue: 46,
    chainSource: true,
    linearVelocity: linearVelocity ?? (route ? trafficInitialVelocity(route) : undefined),
    density: 1.35,
    restitution: 0.18,
    linearDamping: route ? 0.22 : 0.08,
    angularDamping: 0.2,
    trafficRoute: route,
    ccd: true
  });
  object.mesh.userData.disposeMaterial = true;
  decorateCityVehicle(object.mesh, { size, accent });
}

function trafficInitialVelocity(route: TrafficRoute): THREE.Vector3 {
  const waypointDirection = trafficWaypointDirection(route);
  if (waypointDirection) {
    return new THREE.Vector3(waypointDirection.x * route.speed, 0, waypointDirection.z * route.speed);
  }
  if (route.axis === "x") {
    return new THREE.Vector3(route.speed * route.direction, 0, 0);
  }
  return new THREE.Vector3(0, 0, route.speed * route.direction);
}

function trafficWaypointDirection(route: TrafficRoute): { x: number; z: number } | null {
  if (!route.waypoints || route.waypoints.length < 2) {
    return null;
  }
  const segmentIndex = route.segmentIndex ?? 0;
  const from = route.waypoints[segmentIndex % route.waypoints.length];
  const to = route.waypoints[(segmentIndex + 1) % route.waypoints.length];
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length <= 0.001) {
    return null;
  }
  return { x: dx / length, z: dz / length };
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
  const safePosition = alignCityObjectToRoadEdges(position, size, rotationY);
  const object = context.physics.addDynamicBox({
    label,
    material,
    renderMaterial: context.materials.getRenderMaterial(materialId),
    position: safePosition,
    size,
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    category: "structure",
    scoreRole: "neutral",
    zoneId: "street-cargo",
    canFracture: true,
    destructible: true,
    scoreValue: 24,
    chainSource: true,
    restitution: materialId === "foam" ? 0.36 : 0.18,
    linearDamping: 0.08,
    angularDamping: 0.18,
    ccd: true
  });
  decorateStreetCargo(object.mesh, { size, materialId, detail: "lean" });
  if (label.toLowerCase().includes("power cable")) {
    decorateHazardIndicator(object.mesh, { size, kind: "electric" });
  } else if (materialId === "wood" || materialId === "foam" || materialId === "rubber") {
    decorateHazardIndicator(object.mesh, { size, kind: "combustible" });
  }
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
  const renderMaterial = panelRenderMaterial(color, opacity, panelDepthOffset).clone();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), renderMaterial);
  mesh.name = name;
  mesh.position.set(x, 0.055 + panelDepthOffset * 0.004, z);
  mesh.rotation.set(-Math.PI * 0.5, 0, 0);
  mesh.castShadow = false;
  mesh.receiveShadow = opacity >= 1;
  mesh.renderOrder = panelDepthOffset * 0.1;
  mesh.userData.disposeMaterial = true;
  context.addDecoration(mesh);
}

function panelRenderMaterial(color: THREE.ColorRepresentation, opacity: number, panelDepthOffset: number): THREE.Material {
  const key = `${color}:${opacity}:${panelDepthOffset}`;
  const existing = panelRenderMaterials.get(key);
  if (existing) {
    return existing;
  }
  const material =
    opacity < 1
      ? new THREE.MeshBasicMaterial({
          color,
          map: decalAtlasTile(panelDepthOffset % 2 === 0 ? 3 : 7),
          transparent: true,
          opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: panelDepthOffset > 0,
          polygonOffsetFactor: -panelDepthOffset,
          polygonOffsetUnits: -panelDepthOffset,
          alphaTest: 0.02
        })
      : new THREE.MeshStandardMaterial({
          color,
          map: materialAtlasTile(12),
          roughness: 0.86,
          metalness: 0.08,
          depthWrite: true,
          side: THREE.DoubleSide,
          polygonOffset: panelDepthOffset > 0,
          polygonOffsetFactor: -panelDepthOffset,
          polygonOffsetUnits: -panelDepthOffset
        });
  panelRenderMaterials.set(key, material);
  return material;
}

function addStreetLight(context: LevelContext, x: number, z: number): void {
  const basePosition = alignCityObjectToRoadEdges(new THREE.Vector3(x, 0, z), new THREE.Vector3(0.48, 1.45, 0.42));
  const pole = context.physics.addDynamicBox({
    label: "street light pole",
    material: context.materials.get("metal"),
    renderMaterial: new THREE.MeshStandardMaterial({ color: 0x2a3339, roughness: 0.5, metalness: 0.55, map: materialAtlasTile(0) }),
    position: new THREE.Vector3(basePosition.x, 0.72, basePosition.z),
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
    renderMaterial: new THREE.MeshBasicMaterial({ color: 0xffdf8f, transparent: true, opacity: 0.92 }),
    position: new THREE.Vector3(basePosition.x + 0.13, 1.45, basePosition.z),
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

  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffc86b,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
  const glowPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.32), glowMaterial);
  glowPlane.name = "street light fake glow";
  glowPlane.position.set(basePosition.x + 0.13, 1.45, basePosition.z);
  glowPlane.renderOrder = 3;
  glowPlane.userData.disposeMaterial = true;
  context.addDecoration(glowPlane);

  if (Math.abs(x) < 8 && z > -7 && z < 7) {
    const glow = new THREE.PointLight(0xffc86b, 0.32, 3.2, 2);
    glow.position.set(basePosition.x + 0.13, 1.45, basePosition.z);
    context.addDecoration(glow);
  }
}

function addBillboard(context: LevelContext, x: number, z: number, color: THREE.ColorRepresentation): void {
  const basePosition = alignCityObjectToRoadEdges(new THREE.Vector3(x, 0, z), new THREE.Vector3(1.38, 1.45, 0.18));
  for (const px of [-0.45, 0.45]) {
    const post = context.physics.addDynamicBox({
      label: "city billboard post",
      material: context.materials.get("metal"),
      renderMaterial: new THREE.MeshStandardMaterial({ color: 0x3d484f, roughness: 0.46, metalness: 0.62, map: materialAtlasTile(10) }),
      position: new THREE.Vector3(basePosition.x + px, 0.57, basePosition.z),
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
    renderMaterial: new THREE.MeshBasicMaterial({ color, map: decalAtlasTile(5), transparent: true, opacity: 0.92, alphaTest: 0.03 }),
    position: new THREE.Vector3(basePosition.x, 1.22, basePosition.z),
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
