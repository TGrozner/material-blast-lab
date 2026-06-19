import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  decorateBuildingCell,
  decorateCityVehicle,
  decorateHazardIndicator,
  decorateStrategicHazard,
  decorateStreetCargo,
  decorateTrafficBarricade,
  type BuildingVisualStyle
} from "./cityVisuals";
import { MaterialCatalog, type MaterialId } from "./materialCatalog";
import { PhysicsWorld, type ScoreRole, type TrafficRoute } from "./physics";
import type { ArcadeBonusThreshold } from "./arcade";
import { CITY_GROUND_GEOMETRY_BATCHES, type PrebakedGroundGeometryBatch } from "./generated/cityGroundGeometry";
import { decalAtlasTile, materialAtlasTile } from "./visualAssets";

type TriggerType = "transformer" | "springPad" | "shockCanister";
const panelRenderMaterials = new Map<string, THREE.Material>();
const vehicleRenderMaterials = new Map<string, THREE.Material>();
const sharedLevelMaterials = new Map<string, THREE.Material>();
const sharedLevelBoxGeometries = new Map<string, THREE.BoxGeometry>();
const sharedLevelPlaneGeometries = new Map<string, THREE.PlaneGeometry>();

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
    objective: "Pick a chain starter: energy plant, gas station, substation, propane depot, parking silo, elevated metro, or skyneedle collapse route.",
    chaosBrief: "Recognizable hazard buildings hit harder, but only a few can cascade per wave.",
    cannonPosition: new THREE.Vector3(0, 6.08, 24.55),
    defaultAimPoint: new THREE.Vector3(-1.72, 0.16, -3.35),
    cameraTarget: new THREE.Vector3(0, 0.9, -2.6),
    mission: {
      arc: "object-destruction",
      order: 1,
      targetZone: "hazard-core",
      scoreThresholds: {
        oneStar: 40_000,
        twoStar: 90_000,
        threeStar: 200_000
      },
      targetDamageThreshold: 10_000,
      bonusThreshold: { metric: "chainReactionCount", minimum: 100 },
      bonusObjective: "Sustain 100+ secondary hits from the energy plant, gas line, substation, propane depot, parking silo, metro line, vehicle grid, or skyneedle debris.",
      briefingHint: "Aim choice matters: gas is wide and low, the metro carries moving mass, the skyneedle can shed vertical debris, and the parking silo feeds vehicle chaos."
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
      spawnStrategicHazards(context);
      spawnMayhemSpecialSetpieces(context);
      spawnRadioTower(context);
      spawnStreetSetpieces(context);
    }
  },
  {
    id: "breaker-yard",
    name: "Breaker Yard",
    description: "A full breaker district with a concrete spine, transformer yards, relay towers, and traffic weaving through the blast lanes.",
    objective: "Choose between the breaker spine, substation banks, relay towers, fuel trucks, or street traffic to open the chain.",
    chaosBrief: "This is a real city sector now: power arcs, tower debris, traffic, and dense blocks can all feed the same route.",
    cannonPosition: new THREE.Vector3(-6.45, 6.15, 24.85),
    defaultAimPoint: new THREE.Vector3(-0.65, 0.18, -4.15),
    cameraTarget: new THREE.Vector3(-0.4, 0.95, -2.3),
    mission: {
      arc: "object-destruction",
      order: 2,
      targetZone: "breaker-spine",
      scoreThresholds: {
        oneStar: 55_000,
        twoStar: 120_000,
        threeStar: 260_000
      },
      targetDamageThreshold: 12_000,
      bonusThreshold: { metric: "chainReactionCount", minimum: 120 },
      bonusObjective: "Sustain 120+ secondary hits from breaker towers, substations, tankers, and vehicle debris.",
      briefingHint: "The spine is tough but reliable; the substation yards are wider, flashier starters if you can catch the relay rows."
    },
    setup: (context) => setupBreakerYardCity(context)
  },
  {
    id: "switchback-crush",
    name: "Switchback Crush",
    description: "A full glass-and-foam switchback district where fragile archive towers, soft baffles, and service traffic steer the collapse.",
    objective: "Break the archive spine, then use foam baffles and street traffic to redirect wreckage through both switchback blocks.",
    chaosBrief: "The route is no longer a corridor: it is a brittle city bowl with multiple angles, redirects, and crush paths.",
    cannonPosition: new THREE.Vector3(6.25, 6.08, 24.55),
    defaultAimPoint: new THREE.Vector3(0.85, 0.18, -3.65),
    cameraTarget: new THREE.Vector3(0.55, 0.95, -2.1),
    mission: {
      arc: "object-destruction",
      order: 3,
      targetZone: "glass-depot",
      scoreThresholds: {
        oneStar: 60_000,
        twoStar: 135_000,
        threeStar: 300_000
      },
      targetDamageThreshold: 13_000,
      bonusThreshold: { metric: "collateralChaos", minimum: 28_000 },
      bonusObjective: "Push 28,000+ collateral chaos from archive glass, foam redirects, vehicles, and service crates.",
      briefingHint: "Foam is still the steering wheel, but now the city gives you multiple redirect lines instead of one obvious lane."
    },
    setup: (context) => setupSwitchbackCrushCity(context)
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

interface CityRoadCorridor {
  axis: "x" | "z";
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface CityVehicleOptions {
  zoneId?: string;
  scoreValue?: number;
  hazardKind?: "electric" | "combustible" | "explosive";
}

interface GroundPanelSpec {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  color: THREE.ColorRepresentation;
  opacity: number;
  layer: number;
}

type CityVehicleVisualKind = "car" | "van" | "bus" | "tanker" | "taxi" | "flatbed";

const CITY_ROAD_CLEARANCE = 0.18;
const CITY_GROUND_COLOR = 0x192126;
const CITY_BLOCK_APRON_COLOR = 0x151c22;
const CITY_ROAD_SURFACE_COLOR = 0x43515d;
const CITY_ROAD_EDGE_COLOR = 0x697781;
const CITY_LANE_MARKER_COLOR = 0xffd873;
const CITY_CROSSWALK_COLOR = 0xd7e2e8;
const CITY_GROUND_LAYER_BASE = 0;
const CITY_GROUND_LAYER_APRON = 1;
const CITY_GROUND_LAYER_ROAD = 2;
const CITY_GROUND_LAYER_MARKINGS = 3;
const CITY_GROUND_DECAL_Y = 0.074;
const HAZARD_CITY_BUILDING_HEIGHT_SCALE = 1.61;
const CENTRAL_NORTHBOUND_LANE_X = 0.52;
const CENTRAL_SOUTHBOUND_LANE_X = -0.52;
const EAST_SOUTHBOUND_LANE_X = 9.68;
const WEST_NORTHBOUND_LANE_X = -10.32;
const NORTH_EASTBOUND_LANE_Z = -6.78;
const CROSS_EASTBOUND_LANE_Z = -0.78;
const CROSS_WESTBOUND_LANE_Z = -1.92;
const SERVICE_EASTBOUND_LANE_Z = 5.42;
const SERVICE_WESTBOUND_LANE_Z = 4.62;
const BATTERY_WESTBOUND_LANE_Z = 8.02;
const NORTH_SERVICE_ROAD: CityRoadCorridor = { axis: "z", minX: -11.6, maxX: 10.8, minZ: -7.96, maxZ: -6.54 };
const CENTRAL_AVENUE: CityRoadCorridor = { axis: "x", minX: -1.18, maxX: 1.18, minZ: -11.78, maxZ: 10.58 };
const WEST_SERVICE_ROAD: CityRoadCorridor = { axis: "x", minX: -11.34, maxX: -9.96, minZ: -8.38, maxZ: 8.88 };
const CROSS_BOULEVARD: CityRoadCorridor = { axis: "z", minX: -13.1, maxX: 13.1, minZ: -2.39, maxZ: -0.31 };
const SOUTH_SERVICE_ROAD: CityRoadCorridor = { axis: "z", minX: -11.5, maxX: 11.5, minZ: 4.22, maxZ: 5.78 };
const EAST_SERVICE_ROAD: CityRoadCorridor = { axis: "x", minX: 9.42, maxX: 10.78, minZ: -10.1, maxZ: 8.7 };
const BATTERY_ACCESS_ROAD: CityRoadCorridor = { axis: "z", minX: -11.45, maxX: 11.15, minZ: 7.76, maxZ: 8.94 };
const CITY_VERTICAL_ROADS = [WEST_SERVICE_ROAD, CENTRAL_AVENUE, EAST_SERVICE_ROAD] as const;
const CITY_HORIZONTAL_ROADS = [NORTH_SERVICE_ROAD, CROSS_BOULEVARD, SOUTH_SERVICE_ROAD, BATTERY_ACCESS_ROAD] as const;
const CITY_ROAD_CORRIDORS: CityRoadCorridor[] = [
  NORTH_SERVICE_ROAD,
  CENTRAL_AVENUE,
  WEST_SERVICE_ROAD,
  CROSS_BOULEVARD,
  SOUTH_SERVICE_ROAD,
  EAST_SERVICE_ROAD,
  BATTERY_ACCESS_ROAD
];
const NORTH_TRAFFIC_LOOP: Array<[number, number]> = [
  [CENTRAL_NORTHBOUND_LANE_X, NORTH_EASTBOUND_LANE_Z],
  [EAST_SOUTHBOUND_LANE_X, NORTH_EASTBOUND_LANE_Z],
  [EAST_SOUTHBOUND_LANE_X, CROSS_WESTBOUND_LANE_Z],
  [CENTRAL_NORTHBOUND_LANE_X, CROSS_WESTBOUND_LANE_Z]
];
const CENTRAL_TRAFFIC_LOOP: Array<[number, number]> = [
  [CENTRAL_NORTHBOUND_LANE_X, CROSS_EASTBOUND_LANE_Z],
  [EAST_SOUTHBOUND_LANE_X, CROSS_EASTBOUND_LANE_Z],
  [EAST_SOUTHBOUND_LANE_X, SERVICE_WESTBOUND_LANE_Z],
  [CENTRAL_NORTHBOUND_LANE_X, SERVICE_WESTBOUND_LANE_Z]
];
const CENTRAL_TRAFFIC_LOOP_OPPOSITE: Array<[number, number]> = [
  [WEST_NORTHBOUND_LANE_X, CROSS_EASTBOUND_LANE_Z],
  [CENTRAL_SOUTHBOUND_LANE_X, CROSS_EASTBOUND_LANE_Z],
  [CENTRAL_SOUTHBOUND_LANE_X, SERVICE_WESTBOUND_LANE_Z],
  [WEST_NORTHBOUND_LANE_X, SERVICE_WESTBOUND_LANE_Z]
];
const BATTERY_TRAFFIC_LOOP: Array<[number, number]> = [
  [CENTRAL_NORTHBOUND_LANE_X, SERVICE_EASTBOUND_LANE_Z],
  [EAST_SOUTHBOUND_LANE_X, SERVICE_EASTBOUND_LANE_Z],
  [EAST_SOUTHBOUND_LANE_X, BATTERY_WESTBOUND_LANE_Z],
  [CENTRAL_NORTHBOUND_LANE_X, BATTERY_WESTBOUND_LANE_Z]
];
const BATTERY_TRAFFIC_LOOP_OPPOSITE: Array<[number, number]> = [
  [WEST_NORTHBOUND_LANE_X, SERVICE_EASTBOUND_LANE_Z],
  [CENTRAL_SOUTHBOUND_LANE_X, SERVICE_EASTBOUND_LANE_Z],
  [CENTRAL_SOUTHBOUND_LANE_X, BATTERY_WESTBOUND_LANE_Z],
  [WEST_NORTHBOUND_LANE_X, BATTERY_WESTBOUND_LANE_Z]
];
const roleRenderMaterialCache = new Map<string, THREE.Material>();
const WEST_NORTH_TRAFFIC_LOOP: Array<[number, number]> = [
  [WEST_NORTHBOUND_LANE_X, NORTH_EASTBOUND_LANE_Z],
  [CENTRAL_SOUTHBOUND_LANE_X, NORTH_EASTBOUND_LANE_Z],
  [CENTRAL_SOUTHBOUND_LANE_X, CROSS_WESTBOUND_LANE_Z],
  [WEST_NORTHBOUND_LANE_X, CROSS_WESTBOUND_LANE_Z]
];
const CITY_BELT_TRAFFIC_LOOP: Array<[number, number]> = [
  [WEST_NORTHBOUND_LANE_X, NORTH_EASTBOUND_LANE_Z],
  [EAST_SOUTHBOUND_LANE_X, NORTH_EASTBOUND_LANE_Z],
  [EAST_SOUTHBOUND_LANE_X, BATTERY_WESTBOUND_LANE_Z],
  [WEST_NORTHBOUND_LANE_X, BATTERY_WESTBOUND_LANE_Z]
];
const INNER_BELT_TRAFFIC_LOOP: Array<[number, number]> = [
  [WEST_NORTHBOUND_LANE_X, CROSS_EASTBOUND_LANE_Z],
  [EAST_SOUTHBOUND_LANE_X, CROSS_EASTBOUND_LANE_Z],
  [EAST_SOUTHBOUND_LANE_X, SERVICE_WESTBOUND_LANE_Z],
  [WEST_NORTHBOUND_LANE_X, SERVICE_WESTBOUND_LANE_Z]
];
const ELEVATED_METRO_LOOP: Array<[number, number]> = [
  [-13.78, -8.92],
  [13.78, -8.92],
  [13.78, 9.86],
  [-13.78, 9.86]
];
const ELEVATED_METRO_DECK_Y = 3.08;
const ELEVATED_METRO_TRAIN_Y = 3.58;

function trafficLoop(points: Array<[number, number]>, speed: number, segmentIndex = 0): TrafficRoute {
  const normalizedSegmentIndex = normalizeLoopSegmentIndex(segmentIndex, points.length);
  const from = points[normalizedSegmentIndex];
  const to = points[(normalizedSegmentIndex + 1) % points.length];
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
    segmentIndex: normalizedSegmentIndex
  };
}

function addRoutedCityVehicle(
  context: LevelContext,
  label: string,
  routePoints: Array<[number, number]>,
  speed: number,
  segmentIndex: number,
  segmentProgress: number,
  y: number,
  size: THREE.Vector3,
  accent: THREE.ColorRepresentation,
  options: CityVehicleOptions = {}
): void {
  const pose = trafficLoopPose(routePoints, segmentIndex, segmentProgress, y);
  addCityVehicle(context, label, pose.position, size, accent, pose.rotationY, undefined, trafficLoop(routePoints, speed, segmentIndex), options);
}

function trafficLoopPose(
  points: Array<[number, number]>,
  segmentIndex: number,
  segmentProgress: number,
  y: number
): { position: THREE.Vector3; rotationY: number } {
  const fromIndex = normalizeLoopSegmentIndex(segmentIndex, points.length);
  const from = points[fromIndex];
  const to = points[(fromIndex + 1) % points.length];
  const t = THREE.MathUtils.clamp(segmentProgress, 0.08, 0.92);
  const x = THREE.MathUtils.lerp(from[0], to[0], t);
  const z = THREE.MathUtils.lerp(from[1], to[1], t);
  return {
    position: new THREE.Vector3(x, y, z),
    rotationY: Math.atan2(to[0] - from[0], to[1] - from[1])
  };
}

function normalizeLoopSegmentIndex(index: number, length: number): number {
  return ((Math.trunc(index) % length) + length) % length;
}

function setupBreakerYardCity(context: LevelContext): void {
  addCityGround(context);
  spawnNeutralCityBlocks(context);
  spawnInfillCityBlocks(context);
  spawnVacantLotInfill(context);
  spawnBreakerYardCore(context);
  spawnBreakerYardRelayWeb(context);
  spawnBreakerYardStreetActivity(context);
  spawnPowerGrid(context);
  spawnStreetSetpieces(context);
}

function setupSwitchbackCrushCity(context: LevelContext): void {
  addCityGround(context);
  spawnNeutralCityBlocks(context);
  spawnInfillCityBlocks(context);
  spawnVacantLotInfill(context);
  spawnSwitchbackArchiveCore(context);
  spawnSwitchbackRedirectors(context);
  spawnSwitchbackStreetActivity(context);
  spawnStreetSetpieces(context);
}

function spawnBreakerYardCore(context: LevelContext): void {
  const buildings: BuildingSpec[] = [
    {
      label: "Breaker spine megastructure",
      materialId: "concrete",
      position: new THREE.Vector3(-0.95, 0, -4.35),
      size: new THREE.Vector3(0.68, 0.58, 0.68),
      floors: 6,
      columns: 5,
      scoreRole: "target",
      zoneId: "breaker-spine",
      scoreValue: 115,
      style: "industrial",
      stagger: 0.1
    },
    {
      label: "Breaker control tower",
      materialId: "glass",
      position: new THREE.Vector3(2.75, 0, -4.65),
      size: new THREE.Vector3(0.48, 0.72, 0.48),
      floors: 6,
      columns: 4,
      scoreRole: "target",
      zoneId: "breaker-spine electric-substation",
      scoreValue: 106,
      style: "glassTower",
      stagger: -0.04,
      rotationY: -Math.PI * 0.05
    },
    {
      label: "Transformer hall",
      materialId: "metal",
      position: new THREE.Vector3(-4.75, 0, -2.3),
      size: new THREE.Vector3(0.56, 0.5, 0.68),
      floors: 4,
      columns: 5,
      scoreRole: "target",
      zoneId: "breaker-spine power-grid",
      scoreValue: 98,
      style: "warehouse",
      stagger: 0.08,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Relay booth arcade",
      materialId: "glass",
      position: new THREE.Vector3(4.75, 0, -0.05),
      size: new THREE.Vector3(0.48, 0.58, 0.52),
      floors: 4,
      columns: 5,
      scoreRole: "target",
      zoneId: "relay-booth power-grid",
      scoreValue: 92,
      style: "glassTower",
      stagger: 0.06,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Coolant kiosk block",
      materialId: "wood",
      position: new THREE.Vector3(-5.05, 0, 2.65),
      size: new THREE.Vector3(0.56, 0.5, 0.58),
      floors: 4,
      columns: 4,
      scoreRole: "target",
      zoneId: "coolant-kiosk fuel",
      scoreValue: 86,
      style: "utility",
      stagger: -0.08,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Breaker capacitor market",
      materialId: "foam",
      position: new THREE.Vector3(2.85, 0, 3.05),
      size: new THREE.Vector3(0.52, 0.44, 0.52),
      floors: 3,
      columns: 6,
      scoreRole: "target",
      zoneId: "relay-booth hazard-relay",
      scoreValue: 76,
      style: "market",
      stagger: -0.06
    },
    {
      label: "Breaker yard apartments",
      materialId: "concrete",
      position: new THREE.Vector3(-7.55, 0, -5.45),
      size: new THREE.Vector3(0.52, 0.54, 0.54),
      floors: 5,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "breaker-yard-fill",
      scoreValue: 34,
      style: "apartment",
      stagger: 0.06,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Breaker yard office row",
      materialId: "metal",
      position: new THREE.Vector3(7.45, 0, 1.5),
      size: new THREE.Vector3(0.52, 0.48, 0.58),
      floors: 4,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "breaker-yard-fill",
      scoreValue: 32,
      style: "warehouse",
      stagger: -0.04,
      rotationY: Math.PI * 0.5
    }
  ];

  for (const building of buildings) {
    spawnCityBuildingStack(context, building);
  }
}

function spawnBreakerYardRelayWeb(context: LevelContext): void {
  for (const [type, label, x, z, width, height, depth, rotationY] of [
    ["transformer", "Breaker yard transformer", -2.9, -1.35, 0.56, 0.72, 0.48, Math.PI * 0.08],
    ["transformer", "Breaker yard transformer", 1.9, -2.15, 0.56, 0.72, 0.48, -Math.PI * 0.12],
    ["transformer", "Breaker yard transformer", -4.2, 1.25, 0.56, 0.72, 0.48, Math.PI * 0.5],
    ["shockCanister", "Breaker shock canister", 3.45, 1.15, 0.42, 0.66, 0.42, -Math.PI * 0.5],
    ["shockCanister", "Breaker shock canister", -6.35, -0.15, 0.42, 0.66, 0.42, Math.PI * 0.5],
    ["springPad", "Breaker spring collision pad", -0.55, 1.65, 0.86, 0.22, 0.62, Math.PI * 0.12],
    ["springPad", "Breaker spring collision pad", 4.15, 3.6, 0.86, 0.22, 0.62, -Math.PI * 0.08]
  ] as const) {
    addHazardRelay(context, type, label, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  for (const [label, materialId, x, z, width, height, depth, rotationY] of [
    ["Breaker cable spool", "rubber", -3.6, 3.85, 0.68, 0.44, 0.58, Math.PI * 0.08],
    ["Breaker meter cabinet", "glass", 0.8, 4.15, 0.48, 0.58, 0.48, -Math.PI * 0.12],
    ["Transformer skid", "metal", -6.25, 4.75, 0.78, 0.46, 0.58, Math.PI * 0.5],
    ["Coolant foam pallet", "foam", 5.15, 4.6, 0.76, 0.38, 0.58, -Math.PI * 0.08],
    ["Breaker wood stop", "wood", -0.95, 6.35, 0.82, 0.42, 0.62, Math.PI * 0.5]
  ] as const) {
    addStreetCargo(context, label, materialId, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  addStrategicHazardBox(context, {
    label: "Breaker substation transformer yard",
    materialId: "metal",
    position: new THREE.Vector3(6.55, 0.46, -4.85),
    size: new THREE.Vector3(1.05, 0.92, 0.64),
    zoneId: "breaker-spine electric-substation power-grid",
    scoreValue: 620,
    kind: "electric",
    rotationY: Math.PI * 0.5
  });
  addStrategicHazardBox(context, {
    label: "Breaker substation control house",
    materialId: "metal",
    position: new THREE.Vector3(7.55, 0.36, -4.0),
    size: new THREE.Vector3(1.0, 0.72, 0.82),
    zoneId: "breaker-spine electric-substation power-grid",
    scoreValue: 440,
    kind: "electric",
    rotationY: Math.PI * 0.5
  });
}

function spawnBreakerYardStreetActivity(context: LevelContext): void {
  addRoutedCityVehicle(context, "Breaker fuel tanker", NORTH_TRAFFIC_LOOP, 0.86, 1, 0.28, 0.36, new THREE.Vector3(0.54, 0.44, 1.18), 0xffd66b, {
    zoneId: "breaker-yard fuel gas-line moving-vehicles",
    scoreValue: 300,
    hazardKind: "combustible"
  });
  addRoutedCityVehicle(context, "Breaker maintenance van", CITY_BELT_TRAFFIC_LOOP, 0.92, 0, 0.62, 0.34, new THREE.Vector3(0.56, 0.44, 0.98), 0x9bb2bd, {
    scoreValue: 62
  });
  addRoutedCityVehicle(context, "Breaker courier coupe", CENTRAL_TRAFFIC_LOOP, 1.22, 2, 0.35, 0.28, new THREE.Vector3(0.38, 0.32, 0.72), 0xff8f38, {
    scoreValue: 44
  });
  addRoutedCityVehicle(context, "Breaker shuttle bus", BATTERY_TRAFFIC_LOOP_OPPOSITE, 0.76, 2, 0.5, 0.38, new THREE.Vector3(0.62, 0.5, 1.18), 0x75e6ff, {
    scoreValue: 80
  });
  addBillboard(context, -5.75, -6.15, 0xff8f38);
  addBillboard(context, 6.25, -5.55, 0x93f6ff);
  addBillboard(context, -6.85, 5.9, 0xffd66b);
}

function spawnSwitchbackArchiveCore(context: LevelContext): void {
  const buildings: BuildingSpec[] = [
    {
      label: "Glass depot atrium",
      materialId: "glass",
      position: new THREE.Vector3(1.35, 0, -4.35),
      size: new THREE.Vector3(0.5, 0.76, 0.5),
      floors: 6,
      columns: 5,
      scoreRole: "target",
      zoneId: "glass-depot",
      scoreValue: 112,
      style: "glassTower",
      stagger: 0.05,
      rotationY: Math.PI * 0.04
    },
    {
      label: "Archive switchback tower",
      materialId: "glass",
      position: new THREE.Vector3(5.25, 0, -1.3),
      size: new THREE.Vector3(0.46, 0.72, 0.48),
      floors: 6,
      columns: 4,
      scoreRole: "target",
      zoneId: "glass-archive",
      scoreValue: 108,
      style: "glassTower",
      stagger: -0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Archive switchback tower",
      materialId: "glass",
      position: new THREE.Vector3(-4.85, 0, 1.25),
      size: new THREE.Vector3(0.46, 0.72, 0.48),
      floors: 6,
      columns: 4,
      scoreRole: "target",
      zoneId: "glass-archive",
      scoreValue: 108,
      style: "glassTower",
      stagger: 0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Switchback mixer block",
      materialId: "foam",
      position: new THREE.Vector3(-1.95, 0, -0.35),
      size: new THREE.Vector3(0.56, 0.46, 0.58),
      floors: 4,
      columns: 6,
      scoreRole: "target",
      zoneId: "glass-depot switchback-foam",
      scoreValue: 82,
      style: "market",
      stagger: -0.08
    },
    {
      label: "Service compression wall",
      materialId: "metal",
      position: new THREE.Vector3(4.75, 0, 3.05),
      size: new THREE.Vector3(0.52, 0.48, 0.64),
      floors: 4,
      columns: 5,
      scoreRole: "target",
      zoneId: "glass-depot switchback-service",
      scoreValue: 88,
      style: "warehouse",
      stagger: 0.06,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Archive office fan",
      materialId: "concrete",
      position: new THREE.Vector3(-7.0, 0, -4.85),
      size: new THREE.Vector3(0.52, 0.54, 0.56),
      floors: 5,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "switchback-fill",
      scoreValue: 34,
      style: "apartment",
      stagger: -0.06,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Archive market ledge",
      materialId: "foam",
      position: new THREE.Vector3(7.15, 0, 1.75),
      size: new THREE.Vector3(0.5, 0.4, 0.52),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "switchback-fill",
      scoreValue: 26,
      style: "market",
      stagger: 0.05,
      rotationY: Math.PI * 0.5
    }
  ];

  for (const building of buildings) {
    spawnCityBuildingStack(context, building);
  }
}

function spawnSwitchbackRedirectors(context: LevelContext): void {
  for (const [label, materialId, x, z, width, height, depth, rotationY] of [
    ["Foam redirect wall", "foam", -2.95, 2.95, 1.05, 0.42, 0.58, Math.PI * 0.18],
    ["Foam redirect wall", "foam", 2.55, 1.35, 1.05, 0.42, 0.58, -Math.PI * 0.22],
    ["Archive glass meter crate", "glass", -0.25, -1.7, 0.5, 0.58, 0.5, Math.PI * 0.12],
    ["Archive glass pump crate", "glass", 2.65, -0.15, 0.52, 0.58, 0.5, -Math.PI * 0.12],
    ["Wood service pallet", "wood", -4.55, 4.35, 0.78, 0.42, 0.58, Math.PI * 0.5],
    ["Metal switchback case", "metal", 3.8, 5.15, 0.76, 0.46, 0.52, -Math.PI * 0.5],
    ["Foam corner skid", "foam", 6.2, -3.95, 0.82, 0.38, 0.58, Math.PI * 0.08]
  ] as const) {
    addStreetCargo(context, label, materialId, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  for (const [type, label, x, z, width, height, depth, rotationY] of [
    ["springPad", "Switchback spring collision pad", -1.25, 3.75, 0.9, 0.22, 0.64, Math.PI * 0.18],
    ["springPad", "Switchback spring collision pad", 3.8, -2.45, 0.9, 0.22, 0.64, -Math.PI * 0.1],
    ["shockCanister", "Archive shock canister", -5.75, -0.45, 0.42, 0.64, 0.42, Math.PI * 0.5],
    ["shockCanister", "Archive shock canister", 5.95, 0.6, 0.42, 0.64, 0.42, -Math.PI * 0.5]
  ] as const) {
    addHazardRelay(context, type, label, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }
}

function spawnSwitchbackStreetActivity(context: LevelContext): void {
  addRoutedCityVehicle(context, "Archive service van", CITY_BELT_TRAFFIC_LOOP, 0.86, 0, 0.45, 0.34, new THREE.Vector3(0.56, 0.44, 0.98), 0xff6b93, {
    scoreValue: 62
  });
  addRoutedCityVehicle(context, "Switchback courier pod", CENTRAL_TRAFFIC_LOOP_OPPOSITE, 1.18, 3, 0.3, 0.27, new THREE.Vector3(0.36, 0.31, 0.68), 0x61d8ff, {
    scoreValue: 44
  });
  addRoutedCityVehicle(context, "Archive tanker truck", BATTERY_TRAFFIC_LOOP, 0.78, 1, 0.58, 0.36, new THREE.Vector3(0.54, 0.44, 1.18), 0xffd66b, {
    zoneId: "archive-service fuel moving-vehicles",
    scoreValue: 260,
    hazardKind: "combustible"
  });
  addRoutedCityVehicle(context, "Switchback bus", INNER_BELT_TRAFFIC_LOOP, 0.76, 2, 0.42, 0.38, new THREE.Vector3(0.62, 0.5, 1.18), 0x75e6ff, {
    scoreValue: 78
  });
  addBillboard(context, -4.65, -6.25, 0xff6b93);
  addBillboard(context, 5.6, -5.85, 0x7ee8ff);
  addBillboard(context, 6.9, 4.65, 0xffd66b);
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
    floors: 4,
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
    floors: 4,
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
    floors: 4,
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
    floors: 4,
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
    floors: 4,
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
      floors: 6,
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
      floors: 6,
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
      floors: 6,
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
      floors: 6,
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
      floors: 6,
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
      floors: 6,
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
      floors: 5,
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
      floors: 6,
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
      floors: 6,
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
      floors: 6,
      columns: 6,
      scoreRole: "neutral",
      zoneId: "southwest-condos",
      scoreValue: 34,
      style: "apartment",
      stagger: -0.06
    },
    {
      label: "Northwest corner towers",
      materialId: "concrete",
      position: new THREE.Vector3(-12.25, 0, -10.05),
      size: new THREE.Vector3(0.52, 0.56, 0.56),
      floors: 6,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "northwest-corner",
      scoreValue: 34,
      style: "apartment",
      stagger: 0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Northeast rim offices",
      materialId: "glass",
      position: new THREE.Vector3(13.75, 0, -10.3),
      size: new THREE.Vector3(0.46, 0.66, 0.48),
      floors: 6,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "northeast-rim",
      scoreValue: 36,
      style: "glassTower",
      stagger: -0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "West lower terrace",
      materialId: "metal",
      position: new THREE.Vector3(-14.0, 0, 10.9),
      size: new THREE.Vector3(0.52, 0.48, 0.58),
      floors: 6,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "west-lower-terrace",
      scoreValue: 32,
      style: "warehouse",
      stagger: 0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "East lower terrace",
      materialId: "concrete",
      position: new THREE.Vector3(15.15, 0, 12.1),
      size: new THREE.Vector3(0.52, 0.56, 0.56),
      floors: 6,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "east-lower-terrace",
      scoreValue: 34,
      style: "apartment",
      stagger: -0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Northwest broadcast slab",
      materialId: "metal",
      position: new THREE.Vector3(-15.7, 0, -14.2),
      size: new THREE.Vector3(0.48, 0.62, 0.52),
      floors: 7,
      columns: 3,
      scoreRole: "neutral",
      zoneId: "northwest-broadcast",
      scoreValue: 36,
      style: "warehouse",
      stagger: 0.03,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Northeast hotel stack",
      materialId: "glass",
      position: new THREE.Vector3(15.95, 0, -14.0),
      size: new THREE.Vector3(0.44, 0.72, 0.46),
      floors: 7,
      columns: 3,
      scoreRole: "neutral",
      zoneId: "northeast-hotel",
      scoreValue: 38,
      style: "glassTower",
      stagger: -0.03,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Southwest civic stack",
      materialId: "concrete",
      position: new THREE.Vector3(-16.0, 0, 14.95),
      size: new THREE.Vector3(0.54, 0.58, 0.58),
      floors: 7,
      columns: 3,
      scoreRole: "neutral",
      zoneId: "southwest-civic",
      scoreValue: 36,
      style: "apartment",
      stagger: -0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Southeast data stack",
      materialId: "wood",
      position: new THREE.Vector3(16.3, 0, 16.35),
      size: new THREE.Vector3(0.5, 0.56, 0.54),
      floors: 7,
      columns: 3,
      scoreRole: "neutral",
      zoneId: "southeast-data",
      scoreValue: 34,
      style: "utility",
      stagger: 0.04,
      rotationY: Math.PI * 0.5
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

function spawnStrategicHazards(context: LevelContext): void {
  addStrategicHazardBox(context, {
    label: "Energy plant core",
    materialId: "glass",
    position: new THREE.Vector3(-1.72, 0.48, -3.35),
    size: new THREE.Vector3(0.86, 0.96, 0.72),
    zoneId: "energy-plant",
    scoreValue: 520,
    kind: "electric"
  });
  addStrategicHazardBox(context, {
    label: "Energy plant capacitor bank",
    materialId: "metal",
    position: new THREE.Vector3(-2.72, 0.34, -3.95),
    size: new THREE.Vector3(0.78, 0.68, 0.52),
    zoneId: "energy-plant",
    scoreValue: 380,
    kind: "electric",
    rotationY: Math.PI * 0.08
  });
  addStrategicHazardBox(context, {
    label: "Gas station canopy",
    materialId: "foam",
    position: new THREE.Vector3(6.15, 0.28, 3.75),
    size: new THREE.Vector3(1.65, 0.56, 0.9),
    zoneId: "gas-station fuel-line",
    scoreValue: 420,
    kind: "combustible",
    rotationY: -Math.PI * 0.04
  });
  for (const x of [5.55, 6.15, 6.75]) {
    addStrategicHazardBox(context, {
      label: "Gas pump",
      materialId: "rubber",
      position: new THREE.Vector3(x, 0.32, 3.2),
      size: new THREE.Vector3(0.22, 0.64, 0.26),
      zoneId: "gas-station fuel-pump",
      scoreValue: 160,
      kind: "combustible"
    });
  }
}

function spawnMayhemSpecialSetpieces(context: LevelContext): void {
  spawnElectricSubstation(context);
  spawnPropaneDepot(context);
  spawnParkingSilo(context);
  spawnElevatedMetro(context);
  spawnCentralSkyneedle(context);
}

function spawnElectricSubstation(context: LevelContext): void {
  addStrategicHazardBox(context, {
    label: "Electric substation control house",
    materialId: "metal",
    position: new THREE.Vector3(-8.15, 0.34, -5.12),
    size: new THREE.Vector3(1.12, 0.68, 0.82),
    zoneId: "electric-substation power-grid",
    scoreValue: 420,
    kind: "electric",
    rotationY: Math.PI * 0.5
  });
  addStrategicHazardBox(context, {
    label: "Electric substation transformer yard",
    materialId: "metal",
    position: new THREE.Vector3(-6.95, 0.43, -5.24),
    size: new THREE.Vector3(0.9, 0.86, 0.58),
    zoneId: "electric-substation power-grid",
    scoreValue: 560,
    kind: "electric",
    rotationY: Math.PI * 0.5
  });
  for (const [x, z, rotationY] of [
    [-7.5, -4.42, Math.PI * 0.08],
    [-6.55, -4.45, -Math.PI * 0.08],
    [-7.08, -5.98, Math.PI * 0.5]
  ] as const) {
    addStrategicHazardBox(context, {
      label: "Electric substation breaker rack",
      materialId: "glass",
      position: new THREE.Vector3(x, 0.39, z),
      size: new THREE.Vector3(0.36, 0.78, 0.34),
      zoneId: "electric-substation power-grid",
      scoreValue: 210,
      kind: "electric",
      rotationY
    });
  }
}

function spawnPropaneDepot(context: LevelContext): void {
  addStrategicHazardBox(context, {
    label: "Propane depot safety rack",
    materialId: "metal",
    position: new THREE.Vector3(-7.55, 0.23, 8.92),
    size: new THREE.Vector3(1.36, 0.46, 0.66),
    zoneId: "propane-depot fuel gas-line",
    scoreValue: 360,
    kind: "explosive",
    rotationY: Math.PI * 0.5
  });
  for (const [x, z, rotationY] of [
    [-8.05, 8.46, 0],
    [-7.58, 8.46, 0],
    [-7.12, 8.46, 0],
    [-8.03, 9.38, Math.PI * 0.06],
    [-7.55, 9.42, -Math.PI * 0.04],
    [-7.08, 9.38, Math.PI * 0.05]
  ] as const) {
    addStrategicHazardBox(context, {
      label: "Propane tank",
      materialId: "rubber",
      position: new THREE.Vector3(x, 0.35, z),
      size: new THREE.Vector3(0.3, 0.7, 0.3),
      zoneId: "propane-depot fuel gas-line",
      scoreValue: 190,
      kind: "explosive",
      rotationY
    });
  }
}

function spawnParkingSilo(context: LevelContext): void {
  const material = context.materials.get("concrete");
  const renderMaterial = roleRenderMaterial(context.materials, "concrete", "target");
  const rotationY = -Math.PI * 0.04;
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
  const base = alignCityObjectToRoadEdges(new THREE.Vector3(12.78, 0, 0.85), new THREE.Vector3(2.35, 2.05, 1.72), rotationY);
  for (const [offsetX, offsetZ] of [
    [-0.98, -0.68],
    [0.98, -0.68],
    [-0.98, 0.68],
    [0.98, 0.68]
  ] as const) {
    const local = new THREE.Vector3(offsetX, 0, offsetZ).applyQuaternion(rotation);
    const size = new THREE.Vector3(0.16, 1.88, 0.16);
    const object = context.physics.addDynamicBox({
      label: "Parking silo support column",
      material,
      renderMaterial,
      position: new THREE.Vector3(base.x + local.x, 1.02, base.z + local.z),
      size,
      rotation,
      category: "structure",
      scoreRole: "target",
      zoneId: "parking-silo parking-garage moving-vehicles",
      canFracture: true,
      destructible: true,
      bodyType: "fixed",
      chainSource: true,
      scoreValue: 140
    });
    decorateHazardIndicator(object.mesh, { size, kind: "combustible" });
    object.mesh.userData.disposeMaterial = shouldDisposeRenderMaterial(object.mesh.material);
  }

  for (let deck = 0; deck < 4; deck += 1) {
    const size = new THREE.Vector3(2.28, 0.16, 1.68);
    const object = context.physics.addDynamicBox({
      label: deck === 3 ? "Parking silo roof deck" : "Parking silo collapse deck",
      material,
      renderMaterial,
      position: new THREE.Vector3(base.x, 0.62 + deck * 0.42, base.z),
      size,
      rotation,
      category: "structure",
      scoreRole: "target",
      zoneId: "parking-silo parking-garage moving-vehicles",
      canFracture: true,
      destructible: true,
      bodyType: "fixed",
      chainSource: true,
      scoreValue: deck === 3 ? 340 : 260
    });
    decorateHazardIndicator(object.mesh, { size, kind: "combustible" });
    decorateStrategicHazard(object.mesh, { label: object.label, size, kind: "combustible" });
    object.mesh.userData.disposeMaterial = shouldDisposeRenderMaterial(object.mesh.material);
  }

  for (const [x, z, accent, label] of [
    [12.2, 0.14, 0xffc241, "Parking silo taxi"],
    [12.82, 0.12, 0xff6b93, "Parking silo hatchback"],
    [13.42, 0.2, 0x61d8ff, "Parking silo coupe"],
    [12.48, 1.55, 0xff7048, "Parking silo service car"],
    [13.18, 1.54, 0x8fe6a9, "Parking silo compact"]
  ] as const) {
    addCityVehicle(context, label, new THREE.Vector3(x, 0.28, z), new THREE.Vector3(0.36, 0.31, 0.68), accent, rotationY, undefined, undefined, {
      zoneId: "parking-silo parking-garage moving-vehicles",
      scoreValue: 72,
      hazardKind: "combustible"
    });
  }
}

function spawnElevatedMetro(context: LevelContext): void {
  const deckMaterial = context.materials.get("concrete");
  const pierMaterial = context.materials.get("concrete");
  const deckRenderMaterial = sharedLevelMaterial(
    "elevated-metro-deck",
    () => new THREE.MeshStandardMaterial({ color: 0x687781, roughness: 0.78, metalness: 0.08, map: materialAtlasTile(2) })
  );
  const pierRenderMaterial = sharedLevelMaterial(
    "elevated-metro-pier",
    () => new THREE.MeshStandardMaterial({ color: 0x4c5962, roughness: 0.82, metalness: 0.06, map: materialAtlasTile(3) })
  );
  const supportGroupId = "elevated-metro-support";
  const zoneId = "elevated-metro transit-spine moving-vehicles";
  const y = ELEVATED_METRO_DECK_Y;
  const routeMinX = ELEVATED_METRO_LOOP[0][0];
  const routeMaxX = ELEVATED_METRO_LOOP[1][0];
  const routeNorthZ = ELEVATED_METRO_LOOP[0][1];
  const routeSouthZ = ELEVATED_METRO_LOOP[2][1];
  const centerZ = (routeNorthZ + routeSouthZ) * 0.5;
  const horizontalLength = routeMaxX - routeMinX + 0.84;
  const verticalLength = routeSouthZ - routeNorthZ + 0.84;

  for (const spec of [
    { position: new THREE.Vector3(0, y, routeNorthZ), size: new THREE.Vector3(horizontalLength, 0.26, 0.78), rotationY: 0 },
    { position: new THREE.Vector3(0, y, routeSouthZ), size: new THREE.Vector3(horizontalLength, 0.26, 0.78), rotationY: 0 },
    { position: new THREE.Vector3(routeMinX, y, centerZ), size: new THREE.Vector3(0.78, 0.26, verticalLength), rotationY: 0 },
    { position: new THREE.Vector3(routeMaxX, y, centerZ), size: new THREE.Vector3(0.78, 0.26, verticalLength), rotationY: 0 }
  ] as const) {
    const deck = context.physics.addDynamicBox({
      label: "Elevated metro guideway",
      material: deckMaterial,
      renderMaterial: deckRenderMaterial,
      position: spec.position,
      size: spec.size,
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spec.rotationY, 0)),
      category: "structure",
      scoreRole: "target",
      zoneId,
      canFracture: true,
      destructible: true,
      bodyType: "fixed",
      chainSource: true,
      supportGroupId,
      supportReleaseMassScale: 1.45,
      supportReleaseImpulseScale: 0.72,
      supportReleaseTorqueScale: 0.7,
      scoreValue: 410
    });
    deck.mesh.userData.disposeMaterial = false;
    addMetroRailDecoration(context, spec.position, spec.size, spec.rotationY);
  }

  for (const z of [routeNorthZ, routeSouthZ]) {
    for (const x of [-12.45, -4.15, 4.15, 12.45]) {
      addMetroSupportPier(context, new THREE.Vector3(x, 1.54, z), pierMaterial, pierRenderMaterial, zoneId, supportGroupId);
    }
  }
  for (const x of [routeMinX, routeMaxX]) {
    for (const z of [-5.1, 1.7, 8.45]) {
      addMetroSupportPier(context, new THREE.Vector3(x, 1.54, z), pierMaterial, pierRenderMaterial, zoneId, supportGroupId);
    }
  }

  for (const [label, segmentProgress, accent, scoreValue] of [
    ["Elevated metro bus lead car", 0.22, 0x8eeaff, 180],
    ["Elevated metro bus middle car", 0.305, 0xf2f7ff, 160],
    ["Elevated metro bus tail car", 0.39, 0x7bdcff, 170]
  ] as const) {
    addRoutedCityVehicle(
      context,
      label,
      ELEVATED_METRO_LOOP,
      0.82,
      0,
      segmentProgress,
      ELEVATED_METRO_TRAIN_Y,
      new THREE.Vector3(0.7, 0.56, 2.38),
      accent,
      {
        zoneId,
        scoreValue,
        hazardKind: "electric"
      }
    );
  }
}

function addMetroSupportPier(
  context: LevelContext,
  position: THREE.Vector3,
  material: ReturnType<MaterialCatalog["get"]>,
  renderMaterial: THREE.Material,
  zoneId: string,
  supportGroupId: string
): void {
  const size = new THREE.Vector3(0.32, 2.98, 0.32);
  const pier = context.physics.addDynamicBox({
    label: "Elevated metro support pier",
    material,
    renderMaterial,
    position,
    size,
    category: "structure",
    scoreRole: "target",
    zoneId,
    canFracture: true,
    destructible: true,
    bodyType: "fixed",
    chainSource: true,
    supportGroupId,
    supportReleaseRadius: 7.2,
    supportReleaseHeight: 4.5,
    supportReleaseFallDirection: new THREE.Vector3(position.x >= 0 ? 0.45 : -0.45, 0, 1),
    supportReleaseImpulseScale: 0.66,
    supportReleaseTorqueScale: 0.58,
    supportReleaseMassScale: 1.2,
    scoreValue: 115
  });
  pier.mesh.userData.disposeMaterial = false;
  decorateHazardIndicator(pier.mesh, { size, kind: "electric" });
}

function addMetroRailDecoration(context: LevelContext, position: THREE.Vector3, deckSize: THREE.Vector3, rotationY: number): void {
  const railMaterial = sharedLevelMaterial(
    "elevated-metro-rail",
    () => new THREE.MeshStandardMaterial({ color: 0xa8c8cf, roughness: 0.38, metalness: 0.72, map: materialAtlasTile(10) })
  );
  const sleeperMaterial = sharedLevelMaterial(
    "elevated-metro-sleepers",
    () => new THREE.MeshStandardMaterial({ color: 0x242b31, roughness: 0.64, metalness: 0.26, map: materialAtlasTile(1) })
  );
  const group = new THREE.Group();
  group.name = "elevated metro rail detail";
  group.position.copy(position);
  group.rotation.y = rotationY;

  const isEastWest = deckSize.x >= deckSize.z;
  const railLength = isEastWest ? deckSize.x * 0.96 : deckSize.z * 0.96;
  const railThickness = 0.055;
  const railGauge = 0.28;
  for (const offset of [-railGauge, railGauge]) {
    const rail = new THREE.Mesh(
      isEastWest
        ? sharedLevelBoxGeometry(railLength, railThickness, railThickness)
        : sharedLevelBoxGeometry(railThickness, railThickness, railLength),
      railMaterial
    );
    rail.name = "elevated metro rail";
    rail.position.set(isEastWest ? 0 : offset, deckSize.y * 0.74, isEastWest ? offset : 0);
    rail.castShadow = true;
    rail.receiveShadow = false;
    rail.userData.disposeMaterial = false;
    group.add(rail);
  }

  const sleeperCount = Math.min(14, Math.max(6, Math.floor(railLength / 2.1)));
  for (let index = 0; index < sleeperCount; index += 1) {
    const t = sleeperCount === 1 ? 0.5 : index / (sleeperCount - 1);
    const along = THREE.MathUtils.lerp(-railLength * 0.44, railLength * 0.44, t);
    const sleeper = new THREE.Mesh(
      isEastWest ? sharedLevelBoxGeometry(0.09, 0.045, 0.68) : sharedLevelBoxGeometry(0.68, 0.045, 0.09),
      sleeperMaterial
    );
    sleeper.name = "elevated metro sleeper";
    sleeper.position.set(isEastWest ? along : 0, deckSize.y * 0.68, isEastWest ? 0 : along);
    sleeper.userData.disposeMaterial = false;
    group.add(sleeper);
  }

  context.addDecoration(group);
}

function spawnCentralSkyneedle(context: LevelContext): void {
  const supportGroupId = "central-skyneedle-collapse";
  const zoneId = "central-skyneedle hazard-core tower-collapse";
  const base = new THREE.Vector3(5.82, 0, -4.18);
  const rotationY = -Math.PI * 0.055;
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
  const fallDirection = new THREE.Vector3(-0.58, 0, 0.82);
  const metalMaterial = context.materials.get("metal");
  const glassMaterial = context.materials.get("glass");
  const concreteMaterial = context.materials.get("concrete");
  const towerGlassRenderMaterial = sharedLevelMaterial(
    "central-skyneedle-glass",
    () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x8ed8e8,
        transparent: true,
        opacity: 0.54,
        roughness: 0.16,
        metalness: 0.08,
        depthWrite: false,
        emissive: 0x123948,
        emissiveIntensity: 0.2,
        map: materialAtlasTile(8)
      })
  );
  const towerMetalRenderMaterial = sharedLevelMaterial(
    "central-skyneedle-metal",
    () => new THREE.MeshStandardMaterial({ color: 0x90a7ad, roughness: 0.38, metalness: 0.58, map: materialAtlasTile(10) })
  );
  const podium = context.physics.addDynamicBox({
    label: "Central skyneedle podium",
    material: concreteMaterial,
    renderMaterial: roleRenderMaterial(context.materials, "concrete", "target"),
    position: new THREE.Vector3(base.x, 0.36, base.z),
    size: new THREE.Vector3(2.08, 0.72, 1.78),
    rotation,
    category: "structure",
    scoreRole: "target",
    zoneId,
    canFracture: true,
    destructible: true,
    bodyType: "fixed",
    chainSource: true,
    supportGroupId,
    supportReleaseRadius: 4.2,
    supportReleaseHeight: 13.8,
    supportReleaseFallDirection: fallDirection,
    supportReleaseImpulseScale: 1.05,
    supportReleaseTorqueScale: 1.08,
    supportReleaseMassScale: 1.35,
    scoreValue: 760
  });
  decorateHazardIndicator(podium.mesh, { size: podium.dimensions, kind: "explosive" });
  podium.mesh.userData.disposeMaterial = shouldDisposeRenderMaterial(podium.mesh.material);

  for (const [offsetX, offsetZ, sizeX, sizeZ, localRotationY] of [
    [-0.7, 0.1, 0.72, 1.42, 0],
    [0.58, -0.38, 0.62, 1.08, Math.PI * 0.5],
    [0.28, 0.6, 0.58, 1.02, Math.PI * 0.5]
  ] as const) {
    const local = new THREE.Vector3(offsetX, 0, offsetZ).applyQuaternion(rotation);
    const buttressRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY + localRotationY, 0));
    const size = new THREE.Vector3(sizeX, 2.35, sizeZ);
    const buttress = context.physics.addDynamicBox({
      label: "Central skyneedle buttress",
      material: concreteMaterial,
      renderMaterial: roleRenderMaterial(context.materials, "concrete", "target"),
      position: new THREE.Vector3(base.x + local.x, 1.54, base.z + local.z),
      size,
      rotation: buttressRotation,
      category: "structure",
      scoreRole: "target",
      zoneId,
      canFracture: false,
      destructible: true,
      bodyType: "dynamic",
      chainSource: true,
      supportGroupId,
      supportReleaseRadius: 4.2,
      supportReleaseHeight: 13.8,
      supportReleaseFallDirection: fallDirection,
      supportReleaseImpulseScale: 0.95,
      supportReleaseTorqueScale: 0.98,
      supportReleaseMassScale: 1.25,
      sleeping: true,
      linearDamping: 0.74,
      angularDamping: 1.16,
      additionalMass: size.x * size.y * size.z * 6.5,
      scoreValue: 520
    });
    decorateBuildingCell(buttress.mesh, {
      size,
      materialId: "concrete",
      scoreRole: "target",
      style: "civic",
      floor: 1,
      column: 0,
      floors: 3,
      columns: 1
    });
    buttress.mesh.userData.disposeMaterial = shouldDisposeRenderMaterial(buttress.mesh.material);
  }

  let yBase = 2.84;
  for (const [index, height, width, depth, material, renderMaterial, materialId] of [
    [0, 1.62, 1.36, 1.22, metalMaterial, towerMetalRenderMaterial, "metal"],
    [1, 1.78, 1.16, 1.04, glassMaterial, towerGlassRenderMaterial, "glass"],
    [2, 1.58, 0.98, 0.86, metalMaterial, towerMetalRenderMaterial, "metal"],
    [3, 1.42, 0.78, 0.68, glassMaterial, towerGlassRenderMaterial, "glass"],
    [4, 1.2, 0.56, 0.5, metalMaterial, towerMetalRenderMaterial, "metal"]
  ] as const) {
    const size = new THREE.Vector3(width, height, depth);
    const section = context.physics.addDynamicBox({
      label: index === 4 ? "Central skyneedle crown tier" : "Central skyneedle taper tier",
      material,
      renderMaterial,
      position: new THREE.Vector3(base.x, yBase + height * 0.5, base.z),
      size,
      rotation,
      category: "structure",
      scoreRole: "target",
      zoneId,
      canFracture: false,
      destructible: true,
      bodyType: "dynamic",
      chainSource: true,
      supportGroupId,
      supportReleaseMassScale: 1.2,
      supportReleaseImpulseScale: 1 + index * 0.08,
      supportReleaseTorqueScale: 0.9 + index * 0.08,
      sleeping: true,
      linearDamping: 0.68,
      angularDamping: 1.08,
      additionalMass: size.x * size.y * size.z * (materialId === "glass" ? 5.8 : 6.8),
      scoreValue: index === 4 ? 420 : 360
    });
    decorateBuildingCell(section.mesh, {
      size,
      materialId: materialId as MaterialId,
      scoreRole: "target",
      style: "glassTower",
      floor: index,
      column: 0,
      floors: 5,
      columns: 1
    });
    section.mesh.userData.disposeMaterial = false;
    yBase += height;
  }

  const spireSize = new THREE.Vector3(0.18, 2.45, 0.18);
  const spire = context.physics.addDynamicBox({
    label: "Central skyneedle spire",
    material: metalMaterial,
    renderMaterial: towerMetalRenderMaterial,
    position: new THREE.Vector3(base.x, yBase + spireSize.y * 0.5, base.z),
    size: spireSize,
    rotation,
    category: "structure",
    scoreRole: "target",
    zoneId,
    canFracture: false,
    destructible: true,
    bodyType: "dynamic",
    chainSource: true,
    supportGroupId,
    supportReleaseMassScale: 0.82,
    supportReleaseImpulseScale: 1.28,
    supportReleaseTorqueScale: 1.24,
    sleeping: true,
    linearDamping: 0.56,
    angularDamping: 0.92,
    additionalMass: 0.8,
    scoreValue: 260
  });
  spire.mesh.userData.disposeMaterial = false;
  decorateSkyneedleBeacon(spire.mesh, spireSize);
}

function decorateSkyneedleBeacon(mesh: THREE.Mesh, size: THREE.Vector3): void {
  const beaconMaterial = sharedLevelMaterial("central-skyneedle-beacon", () => new THREE.MeshBasicMaterial({ color: 0x9bf7ff }));
  const beacon = new THREE.Mesh(sharedLevelBoxGeometry(0.26, 0.1, 0.26), beaconMaterial);
  beacon.name = "central skyneedle beacon";
  beacon.position.set(0, size.y * 0.48, 0);
  beacon.userData.disposeMaterial = false;
  mesh.add(beacon);
}

function addStrategicHazardBox(
  context: LevelContext,
  options: {
    label: string;
    materialId: MaterialId;
    position: THREE.Vector3;
    size: THREE.Vector3;
    zoneId: string;
    scoreValue: number;
    kind: "electric" | "combustible" | "explosive";
    rotationY?: number;
  }
): void {
  const material = context.materials.get(options.materialId);
  const position = alignCityObjectToRoadEdges(options.position, options.size, options.rotationY ?? 0);
  const object = context.physics.addDynamicBox({
    label: options.label,
    material,
    renderMaterial: roleRenderMaterial(context.materials, options.materialId, "target"),
    position,
    size: options.size,
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, options.rotationY ?? 0, 0)),
    category: "structure",
    scoreRole: "target",
    zoneId: options.zoneId,
    canFracture: true,
    destructible: true,
    scoreValue: options.scoreValue,
    chainSource: true,
    restitution: options.kind === "combustible" ? 0.18 : 0.1,
    linearDamping: 0.1,
    angularDamping: 0.22,
    ccd: false
  });
  decorateHazardIndicator(object.mesh, { size: options.size, kind: options.kind });
  decorateStrategicHazard(object.mesh, { label: options.label, size: options.size, kind: options.kind });
  object.mesh.userData.disposeMaterial = shouldDisposeRenderMaterial(object.mesh.material);
}

function spawnRadioTower(context: LevelContext): void {
  const anchor = alignCityObjectToRoadEdges(new THREE.Vector3(-15.4, 0, -16.2), new THREE.Vector3(1.25, 4.65, 1.25));
  const mastMaterial = context.materials.get("metal");
  const baseMaterial = context.materials.get("concrete");
  const mastRenderMaterial = new THREE.MeshStandardMaterial({
    color: 0x85949b,
    roughness: 0.42,
    metalness: 0.72,
    emissive: 0x10242c,
    emissiveIntensity: 0.18,
    map: materialAtlasTile(10)
  });
  const base = context.physics.addDynamicBox({
    label: "Northwest radio tower base",
    material: baseMaterial,
    renderMaterial: roleRenderMaterial(context.materials, "concrete", "target"),
    position: new THREE.Vector3(anchor.x, 0.28, anchor.z),
    size: new THREE.Vector3(1.08, 0.56, 1.08),
    category: "structure",
    scoreRole: "target",
    zoneId: "radio-tower power-grid",
    canFracture: true,
    destructible: true,
    bodyType: "fixed",
    chainSource: true,
    scoreValue: 620
  });
  base.mesh.userData.disposeMaterial = shouldDisposeRenderMaterial(base.mesh.material);
  decorateHazardIndicator(base.mesh, { size: base.dimensions, kind: "electric" });

  for (let level = 0; level < 5; level += 1) {
    const height = level === 4 ? 0.88 : 0.72;
    const y = 0.58 + level * 0.72 + height * 0.5;
    const segment = context.physics.addDynamicBox({
      label: "Northwest radio tower mast",
      material: mastMaterial,
      renderMaterial: mastRenderMaterial.clone(),
      position: new THREE.Vector3(anchor.x, y, anchor.z),
      size: new THREE.Vector3(0.28, height, 0.28),
      category: "structure",
      scoreRole: "target",
      zoneId: "radio-tower power-grid",
      canFracture: true,
      destructible: true,
      bodyType: "fixed",
      chainSource: true,
      scoreValue: level === 4 ? 260 : 210
    });
    segment.mesh.userData.disposeMaterial = true;
    decorateRadioTowerSegment(segment.mesh, level, height);
  }
}

function decorateRadioTowerSegment(mesh: THREE.Mesh, level: number, height: number): void {
  const diagonalMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8f6ff,
    roughness: 0.38,
    metalness: 0.68,
    emissive: 0x0b3a4a,
    emissiveIntensity: 0.18,
    map: materialAtlasTile(10)
  });
  for (const rotationZ of [Math.PI * 0.25, -Math.PI * 0.25]) {
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.055, height * 1.18, 0.055), diagonalMaterial.clone());
    brace.name = "radio tower diagonal brace";
    brace.rotation.z = rotationZ;
    brace.position.y = 0;
    brace.userData.disposeMaterial = true;
    mesh.add(brace);
  }

  const dishMaterial = new THREE.MeshStandardMaterial({
    color: 0xcad5d8,
    roughness: 0.48,
    metalness: 0.42,
    map: materialAtlasTile(6)
  });
  const dish = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.32), dishMaterial);
  dish.name = "radio tower receiver dish";
  dish.position.set(level % 2 === 0 ? 0.42 : -0.42, height * 0.18, 0);
  dish.rotation.z = level % 2 === 0 ? -0.22 : 0.22;
  dish.userData.disposeMaterial = true;
  mesh.add(dish);

  if (level === 4) {
    const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xff405f });
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), beaconMaterial);
    beacon.name = "radio tower red beacon";
    beacon.position.set(0, height * 0.62, 0);
    beacon.userData.disposeMaterial = true;
    mesh.add(beacon);

    const antennaMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f7ff, roughness: 0.4, metalness: 0.72, map: materialAtlasTile(10) });
    const antenna = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.1, 0.055), antennaMaterial);
    antenna.name = "radio tower antenna";
    antenna.position.set(0, height * 0.95, 0);
    antenna.userData.disposeMaterial = true;
    mesh.add(antenna);
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
      ccd: false
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
    ccd: false
  });
  decorateHazardIndicator(object.mesh, { size, kind: type === "springPad" ? "combustible" : type === "transformer" ? "electric" : "explosive" });
  object.mesh.userData.disposeMaterial = true;
}

function spawnCityBuildingStack(context: LevelContext, spec: BuildingSpec): void {
  const scaledSpec = scaleCityBuildingHeight(spec);
  spawnBuildingStack(context, {
    ...scaledSpec,
    position: alignBuildingToCityRoadEdges(scaledSpec)
  });
}

function scaleCityBuildingHeight(spec: BuildingSpec): BuildingSpec {
  return {
    ...spec,
    size: new THREE.Vector3(spec.size.x, spec.size.y * HAZARD_CITY_BUILDING_HEIGHT_SCALE, spec.size.z)
  };
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
      object.mesh.userData.disposeMaterial = shouldDisposeRenderMaterial(object.mesh.material);
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
  const cacheKey = `${materialId}:${role}`;
  const existing = roleRenderMaterialCache.get(cacheKey);
  if (existing) {
    return existing;
  }
  const material = materials.getRenderMaterial(materialId).clone();
  const tint = role === "target" ? new THREE.Color(0xff7a35) : null;
  if (tint && (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial || material instanceof THREE.MeshBasicMaterial)) {
    material.color.lerp(tint, 0.58);
    if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
      material.emissive = tint.clone().multiplyScalar(0.12);
      material.emissiveIntensity = 0.7;
    }
  }
  material.userData.sharedRoleRenderMaterial = true;
  roleRenderMaterialCache.set(cacheKey, material);
  return material;
}

function shouldDisposeRenderMaterial(material: THREE.Material | THREE.Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((entry) => entry.userData.sharedRoleRenderMaterial !== true);
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
  if (CITY_GROUND_GEOMETRY_BATCHES.length > 0) {
    addPrebakedGroundPanels(context, CITY_GROUND_GEOMETRY_BATCHES);
    addRoadDecals(context);
    return;
  }

  const panels: GroundPanelSpec[] = [];
  const addGroundPanel = (
    name: string,
    x: number,
    z: number,
    width: number,
    depth: number,
    color: THREE.ColorRepresentation,
    opacity: number,
    layer = CITY_GROUND_LAYER_BASE
  ): void => {
    panels.push({ name, x, z, width, depth, color, opacity, layer });
  };
  const addLaneMarker = (name: string, x: number, z: number, width: number, depth: number, opacity = 0.64): void => {
    addGroundPanel(name, x, z, width, depth, CITY_LANE_MARKER_COLOR, opacity, CITY_GROUND_LAYER_MARKINGS);
  };
  const addRoadEdge = (name: string, x: number, z: number, width: number, depth: number): void => {
    addGroundPanel(name, x, z, width, depth, CITY_ROAD_EDGE_COLOR, 0.62, CITY_GROUND_LAYER_MARKINGS);
  };

  addGroundPanel("city foundation slab", 0, 0.75, 35.8, 35.8, CITY_GROUND_COLOR, 1, CITY_GROUND_LAYER_BASE);
  addGroundPanel("north district apron", 0.1, -13.55, 34.4, 5.9, CITY_BLOCK_APRON_COLOR, 1, CITY_GROUND_LAYER_APRON);
  addGroundPanel("west district apron", -14.3, 1.9, 5.4, 27.1, CITY_BLOCK_APRON_COLOR, 1, CITY_GROUND_LAYER_APRON);
  addGroundPanel("east district apron", 14.4, 1.8, 5.5, 27.2, CITY_BLOCK_APRON_COLOR, 1, CITY_GROUND_LAYER_APRON);
  addGroundPanel("south district apron", 0, 15.25, 34.6, 6.7, CITY_BLOCK_APRON_COLOR, 1, CITY_GROUND_LAYER_APRON);
  addGroundPanel("central industrial apron", 0, 0.85, 18.6, 15.4, 0x171f25, 1, CITY_GROUND_LAYER_APRON);

  addHorizontalRoadPanels(addGroundPanel);
  addVerticalRoadPanels(addGroundPanel);
  addHorizontalRoadCurbs(addRoadEdge);
  addVerticalRoadCurbs(addRoadEdge);

  for (const z of [-9.5, -7.1, -4.55, -1.35, 1.8, 5.05, 8.05]) {
    addRoadLaneMarker(CENTRAL_AVENUE, addLaneMarker, "central avenue dash", 0, z, 0.11, 0.76, 0.82);
  }
  for (const z of [-6.9, -3.9, -0.8, 2.2, 5.25, 7.8]) {
    addRoadLaneMarker(EAST_SERVICE_ROAD, addLaneMarker, "east road dash", 10.1, z, 0.1, 0.66, 0.74);
  }
  for (const z of [-6.2, -3.1, 0.2, 3.4, 6.4]) {
    addRoadLaneMarker(WEST_SERVICE_ROAD, addLaneMarker, "west road dash", -10.65, z, 0.1, 0.66, 0.72);
  }
  for (const x of [-8.6, -5.2, -1.8, 1.8, 5.2, 8.6]) {
    addRoadLaneMarker(NORTH_SERVICE_ROAD, addLaneMarker, "north road dash", x, -7.25, 0.78, 0.1, 0.74);
    addRoadLaneMarker(CROSS_BOULEVARD, addLaneMarker, "cross boulevard dash", x, -1.35, 0.8, 0.1, 0.8);
    addRoadLaneMarker(SOUTH_SERVICE_ROAD, addLaneMarker, "south service dash", x, 5.0, 0.74, 0.09, 0.68);
    addRoadLaneMarker(BATTERY_ACCESS_ROAD, addLaneMarker, "battery access dash", x, 8.35, 0.72, 0.09, 0.62);
  }
  for (const x of [-6.5, -3.1, 3.1, 6.5]) {
    addGroundPanel("crosswalk stripe", x, -1.35, 0.95, 0.12, CITY_CROSSWALK_COLOR, 0.72, CITY_GROUND_LAYER_MARKINGS);
  }
  for (const z of [-7.25, -1.35, 5.0, 8.35]) {
    addGroundPanel("west intersection stripe", -10.65, z, 0.88, 0.1, CITY_CROSSWALK_COLOR, 0.52, CITY_GROUND_LAYER_MARKINGS);
    addGroundPanel("central intersection stripe", 0, z, 0.92, 0.1, CITY_CROSSWALK_COLOR, 0.54, CITY_GROUND_LAYER_MARKINGS);
    addGroundPanel("east intersection stripe", 10.1, z, 0.88, 0.1, CITY_CROSSWALK_COLOR, 0.52, CITY_GROUND_LAYER_MARKINGS);
  }
  for (const x of [-11.8, -8.8, 8.8, 12.2]) {
    addGroundPanel("dense block alley stripe", x, 4.2, 0.08, 8.6, 0x41505b, 0.52, CITY_GROUND_LAYER_MARKINGS);
  }
  flushGroundPanels(context, panels);
  addRoadDecals(context);
}

function addPrebakedGroundPanels(context: LevelContext, batches: readonly PrebakedGroundGeometryBatch[]): void {
  for (const batch of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(batch.uvs, 2));
    geometry.setIndex(Array.from(batch.indices));
    geometry.computeBoundingSphere();

    const mesh = new THREE.Mesh(geometry, panelRenderMaterial(batch.color, batch.opacity, batch.layer));
    mesh.name = batch.name;
    mesh.castShadow = false;
    mesh.receiveShadow = batch.opacity >= 1;
    mesh.renderOrder = groundPanelRenderOrder(batch.layer);
    mesh.userData.disposeMaterial = false;
    context.addDecoration(mesh);
  }
}

function addHorizontalRoadPanels(
  addGroundPanel: (name: string, x: number, z: number, width: number, depth: number, color: THREE.ColorRepresentation, opacity: number, layer?: number) => void
): void {
  for (const road of CITY_HORIZONTAL_ROADS) {
    addGroundPanel(
      `${roadName(road)} surface`,
      centerOf(road.minX, road.maxX),
      centerOf(road.minZ, road.maxZ),
      road.maxX - road.minX,
      road.maxZ - road.minZ,
      CITY_ROAD_SURFACE_COLOR,
      1,
      CITY_GROUND_LAYER_ROAD
    );
  }
}

function addVerticalRoadPanels(
  addGroundPanel: (name: string, x: number, z: number, width: number, depth: number, color: THREE.ColorRepresentation, opacity: number, layer?: number) => void
): void {
  for (const road of CITY_VERTICAL_ROADS) {
    for (const segment of splitRangeByRoads(road.minZ, road.maxZ, CITY_HORIZONTAL_ROADS, "z", road)) {
      addGroundPanel(
        `${roadName(road)} surface`,
        centerOf(road.minX, road.maxX),
        centerOf(segment.min, segment.max),
        road.maxX - road.minX,
        segment.max - segment.min,
        CITY_ROAD_SURFACE_COLOR,
        1,
        CITY_GROUND_LAYER_ROAD
      );
    }
  }
}

function addHorizontalRoadCurbs(addRoadEdge: (name: string, x: number, z: number, width: number, depth: number) => void): void {
  for (const road of CITY_HORIZONTAL_ROADS) {
    for (const segment of splitRangeByRoads(road.minX, road.maxX, CITY_VERTICAL_ROADS, "x", road)) {
      const x = centerOf(segment.min, segment.max);
      const width = segment.max - segment.min;
      addRoadEdge(`${roadName(road)} upper curb`, x, road.minZ, width, 0.08);
      addRoadEdge(`${roadName(road)} lower curb`, x, road.maxZ, width, 0.08);
    }
  }
}

function addVerticalRoadCurbs(addRoadEdge: (name: string, x: number, z: number, width: number, depth: number) => void): void {
  for (const road of CITY_VERTICAL_ROADS) {
    for (const segment of splitRangeByRoads(road.minZ, road.maxZ, CITY_HORIZONTAL_ROADS, "z", road)) {
      const z = centerOf(segment.min, segment.max);
      const depth = segment.max - segment.min;
      addRoadEdge(`${roadName(road)} west curb`, road.minX, z, 0.08, depth);
      addRoadEdge(`${roadName(road)} east curb`, road.maxX, z, 0.08, depth);
    }
  }
}

function addRoadLaneMarker(
  road: CityRoadCorridor,
  addLaneMarker: (name: string, x: number, z: number, width: number, depth: number, opacity?: number) => void,
  name: string,
  x: number,
  z: number,
  width: number,
  depth: number,
  opacity: number
): void {
  if (roadMarkerOverlapsCrossRoad(road, x, z, width, depth)) {
    return;
  }
  addLaneMarker(name, x, z, width, depth, opacity);
}

function roadMarkerOverlapsCrossRoad(ownRoad: CityRoadCorridor, x: number, z: number, width: number, depth: number): boolean {
  const minX = x - width * 0.5;
  const maxX = x + width * 0.5;
  const minZ = z - depth * 0.5;
  const maxZ = z + depth * 0.5;
  return CITY_ROAD_CORRIDORS.some((road) => road !== ownRoad && boundsOverlap(minX, maxX, road.minX, road.maxX) && boundsOverlap(minZ, maxZ, road.minZ, road.maxZ));
}

function splitRangeByRoads(
  min: number,
  max: number,
  blockers: readonly CityRoadCorridor[],
  axis: "x" | "z",
  subject: CityRoadCorridor
): Array<{ min: number; max: number }> {
  const cuts = blockers
    .filter((blocker) => roadsOverlapOnCrossAxis(subject, blocker, axis))
    .map((blocker) => ({
      min: axis === "x" ? blocker.minX : blocker.minZ,
      max: axis === "x" ? blocker.maxX : blocker.maxZ
    }))
    .sort((a, b) => a.min - b.min);
  const segments: Array<{ min: number; max: number }> = [];
  let cursor = min;
  for (const cut of cuts) {
    const cutMin = Math.max(min, cut.min);
    const cutMax = Math.min(max, cut.max);
    if (cutMin - cursor > 0.02) {
      segments.push({ min: cursor, max: cutMin });
    }
    cursor = Math.max(cursor, cutMax);
  }
  if (max - cursor > 0.02) {
    segments.push({ min: cursor, max });
  }
  return segments;
}

function roadsOverlapOnCrossAxis(subject: CityRoadCorridor, blocker: CityRoadCorridor, splitAxis: "x" | "z"): boolean {
  return splitAxis === "x"
    ? boundsOverlap(subject.minZ, subject.maxZ, blocker.minZ, blocker.maxZ)
    : boundsOverlap(subject.minX, subject.maxX, blocker.minX, blocker.maxX);
}

function centerOf(min: number, max: number): number {
  return (min + max) * 0.5;
}

function roadName(road: CityRoadCorridor): string {
  if (road === NORTH_SERVICE_ROAD) {
    return "north service road";
  }
  if (road === CENTRAL_AVENUE) {
    return "central avenue";
  }
  if (road === WEST_SERVICE_ROAD) {
    return "west service road";
  }
  if (road === CROSS_BOULEVARD) {
    return "cross boulevard";
  }
  if (road === SOUTH_SERVICE_ROAD) {
    return "south service road";
  }
  if (road === EAST_SERVICE_ROAD) {
    return "east service road";
  }
  return "battery access road";
}

function flushGroundPanels(context: LevelContext, panels: GroundPanelSpec[]): void {
  const groups = new Map<string, GroundPanelSpec[]>();
  for (const panel of panels) {
    const key = `${String(panel.color)}:${panel.opacity}:${panel.layer}`;
    const group = groups.get(key);
    if (group) {
      group.push(panel);
    } else {
      groups.set(key, [panel]);
    }
  }

  for (const group of groups.values()) {
    if (group.length === 1) {
      const panel = group[0];
      addPanel(context, panel.name, panel.x, panel.z, panel.width, panel.depth, panel.color, panel.opacity, panel.layer);
    } else {
      addMergedGroundPanel(context, group);
    }
  }
}

function addMergedGroundPanel(context: LevelContext, panels: GroundPanelSpec[]): void {
  const first = panels[0];
  const layer = Math.max(0, first.layer);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI * 0.5, 0, 0));
  const geometries = panels.map((panel) => {
    const geometry = new THREE.PlaneGeometry(panel.width, panel.depth);
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(panel.x, groundPanelY(layer), panel.z), rotation, new THREE.Vector3(1, 1, 1)));
    return geometry;
  });
  const mergedGeometry = mergeGeometries(geometries, false);
  for (const geometry of geometries) {
    geometry.dispose();
  }
  if (!mergedGeometry) {
    for (const panel of panels) {
      addPanel(context, panel.name, panel.x, panel.z, panel.width, panel.depth, panel.color, panel.opacity, panel.layer);
    }
    return;
  }

  const mesh = new THREE.Mesh(mergedGeometry, panelRenderMaterial(first.color, first.opacity, layer));
  mesh.name = `${first.name} batch`;
  mesh.castShadow = false;
  mesh.receiveShadow = first.opacity >= 1;
  mesh.renderOrder = groundPanelRenderOrder(layer);
  mesh.userData.disposeMaterial = false;
  context.addDecoration(mesh);
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
    mesh.position.set(decal.x, CITY_GROUND_DECAL_Y, decal.z);
    mesh.rotation.set(-Math.PI * 0.5, 0, decal.rotation);
    mesh.renderOrder = CITY_GROUND_LAYER_MARKINGS + 1;
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
      ccd: false
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

  addRoutedCityVehicle(context, "Delivery microbus", CENTRAL_TRAFFIC_LOOP, 1.12, 0, 0.14, 0.32, new THREE.Vector3(0.52, 0.42, 0.92), 0xf3b33c);
  addRoutedCityVehicle(context, "Service van", CENTRAL_TRAFFIC_LOOP_OPPOSITE, 1.0, 2, 0.38, 0.34, new THREE.Vector3(0.56, 0.46, 1.0), 0xff5f8f);
  addRoutedCityVehicle(context, "Market scooter pod", CENTRAL_TRAFFIC_LOOP, 1.12, 2, 0.34, 0.26, new THREE.Vector3(0.34, 0.32, 0.64), 0xff6b93);
  addRoutedCityVehicle(context, "Grid shuttle", NORTH_TRAFFIC_LOOP, 0.95, 0, 0.52, 0.28, new THREE.Vector3(0.4, 0.34, 0.74), 0xff6b93);
  addRoutedCityVehicle(context, "Canal maintenance truck", INNER_BELT_TRAFFIC_LOOP, 0.82, 1, 0.42, 0.34, new THREE.Vector3(0.54, 0.44, 0.92), 0x9bb2bd);
  addRoutedCityVehicle(context, "Battery service cart", BATTERY_TRAFFIC_LOOP, 0.92, 2, 0.3, 0.27, new THREE.Vector3(0.34, 0.3, 0.62), 0xffd66b);
  addRoutedCityVehicle(context, "East tram pod", CENTRAL_TRAFFIC_LOOP, 1.12, 1, 0.25, 0.3, new THREE.Vector3(0.48, 0.36, 0.94), 0x74dfff);
  addRoutedCityVehicle(context, "Depot hauler", BATTERY_TRAFFIC_LOOP_OPPOSITE, 0.92, 0, 0.35, 0.31, new THREE.Vector3(0.52, 0.4, 0.9), 0xf0c16a);
  addRoutedCityVehicle(context, "West grid loader", CENTRAL_TRAFFIC_LOOP_OPPOSITE, 0.86, 3, 0.42, 0.31, new THREE.Vector3(0.48, 0.38, 0.78), 0xff9d4d);
  addRoutedCityVehicle(context, "East courier pod", BATTERY_TRAFFIC_LOOP, 1.08, 1, 0.48, 0.28, new THREE.Vector3(0.36, 0.32, 0.64), 0x87f0ff);
  addRoutedCityVehicle(context, "Battery tram husk", BATTERY_TRAFFIC_LOOP, 0.82, 2, 0.76, 0.34, new THREE.Vector3(0.58, 0.45, 1.08), 0xffd66b);
  addRoutedCityVehicle(context, "South depot van", BATTERY_TRAFFIC_LOOP_OPPOSITE, 0.88, 1, 0.62, 0.33, new THREE.Vector3(0.54, 0.43, 0.96), 0xb2c0c8);
  addRoutedCityVehicle(context, "Fuel tanker truck", NORTH_TRAFFIC_LOOP, 0.82, 1, 0.28, 0.36, new THREE.Vector3(0.54, 0.44, 1.18), 0xffd66b, {
    zoneId: "moving-fuel-tanker gas-line",
    scoreValue: 280,
    hazardKind: "combustible"
  });
  addRoutedCityVehicle(context, "Fuel tanker truck", BATTERY_TRAFFIC_LOOP_OPPOSITE, 0.78, 2, 0.44, 0.36, new THREE.Vector3(0.54, 0.44, 1.18), 0xffd66b, {
    zoneId: "moving-fuel-tanker gas-line",
    scoreValue: 280,
    hazardKind: "combustible"
  });
  addRoutedCityVehicle(context, "West taxi", CENTRAL_TRAFFIC_LOOP_OPPOSITE, 1.28, 0, 0.36, 0.28, new THREE.Vector3(0.38, 0.34, 0.72), 0xffcc4f, {
    scoreValue: 42
  });
  addRoutedCityVehicle(context, "North courier coupe", WEST_NORTH_TRAFFIC_LOOP, 1.34, 0, 0.32, 0.26, new THREE.Vector3(0.36, 0.3, 0.68), 0x61d8ff, {
    scoreValue: 40
  });
  addRoutedCityVehicle(context, "North box van", CITY_BELT_TRAFFIC_LOOP, 0.94, 0, 0.56, 0.34, new THREE.Vector3(0.56, 0.46, 0.98), 0xbac4ca, {
    scoreValue: 58
  });
  addRoutedCityVehicle(context, "East fastback", CITY_BELT_TRAFFIC_LOOP, 1.38, 1, 0.5, 0.27, new THREE.Vector3(0.36, 0.31, 0.72), 0xff7048, {
    scoreValue: 44
  });
  addRoutedCityVehicle(context, "South hatchback", BATTERY_TRAFFIC_LOOP_OPPOSITE, 1.18, 2, 0.78, 0.27, new THREE.Vector3(0.36, 0.31, 0.68), 0x8fe6a9, {
    scoreValue: 40
  });
  addRoutedCityVehicle(context, "Downtown taxi", INNER_BELT_TRAFFIC_LOOP, 1.24, 0, 0.22, 0.28, new THREE.Vector3(0.38, 0.34, 0.72), 0xffc241, {
    scoreValue: 42
  });
  addRoutedCityVehicle(context, "Market bus", INNER_BELT_TRAFFIC_LOOP, 0.78, 2, 0.32, 0.38, new THREE.Vector3(0.62, 0.5, 1.18), 0x75e6ff, {
    scoreValue: 76
  });
  addRoutedCityVehicle(context, "West commuter pod", WEST_NORTH_TRAFFIC_LOOP, 1.16, 3, 0.48, 0.27, new THREE.Vector3(0.36, 0.31, 0.66), 0xff8dd6, {
    scoreValue: 40
  });
  addRoutedCityVehicle(context, "Arcade delivery van", CITY_BELT_TRAFFIC_LOOP, 0.9, 2, 0.42, 0.34, new THREE.Vector3(0.54, 0.44, 0.96), 0xff9d4d, {
    scoreValue: 58
  });
  addRoutedCityVehicle(context, "Radio news van", NORTH_TRAFFIC_LOOP, 0.98, 2, 0.45, 0.33, new THREE.Vector3(0.52, 0.42, 0.92), 0xf4f7ff, {
    scoreValue: 56
  });
  addRoutedCityVehicle(context, "Service flatbed", CENTRAL_TRAFFIC_LOOP_OPPOSITE, 0.86, 1, 0.55, 0.31, new THREE.Vector3(0.5, 0.38, 0.92), 0xa8b4bd, {
    scoreValue: 54
  });
  addRoutedCityVehicle(context, "Crash coupe", CENTRAL_TRAFFIC_LOOP, 1.36, 0, 0.72, 0.27, new THREE.Vector3(0.36, 0.31, 0.72), 0xff5a6a, {
    scoreValue: 44
  });

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
  route?: TrafficRoute,
  options: CityVehicleOptions = {}
): void {
  const material = context.materials.get("metal");
  const renderMaterial = cityVehicleRenderMaterial(context, accent);
  const object = context.physics.addDynamicBox({
    label,
    material,
    renderMaterial,
    position,
    size,
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0)),
    category: "structure",
    scoreRole: "target",
    zoneId: options.zoneId ?? "moving-vehicles",
    canFracture: true,
    destructible: true,
    scoreValue: options.scoreValue ?? 46,
    chainSource: true,
    linearVelocity: linearVelocity ?? (route ? trafficInitialVelocity(route) : undefined),
    density: 1.35,
    restitution: 0.18,
    linearDamping: route ? 0.22 : 0.08,
    angularDamping: 0.2,
    trafficRoute: route,
    ccd: true
  });
  object.mesh.userData.disposeMaterial = false;
  decorateCityVehicle(object.mesh, { size, accent, kind: cityVehicleVisualKind(label) });
  if (options.hazardKind) {
    decorateHazardIndicator(object.mesh, { size, kind: options.hazardKind });
  }
}

function cityVehicleVisualKind(label: string): CityVehicleVisualKind {
  const normalized = label.toLowerCase();
  if (normalized.includes("tanker")) {
    return "tanker";
  }
  if (normalized.includes("bus")) {
    return "bus";
  }
  if (normalized.includes("taxi")) {
    return "taxi";
  }
  if (normalized.includes("flatbed")) {
    return "flatbed";
  }
  if (normalized.includes("van") || normalized.includes("microbus") || normalized.includes("hauler") || normalized.includes("truck")) {
    return "van";
  }
  return "car";
}

function cityVehicleRenderMaterial(context: LevelContext, accent: THREE.ColorRepresentation): THREE.Material {
  const cacheKey = `vehicle:${String(accent)}`;
  const existing = vehicleRenderMaterials.get(cacheKey);
  if (existing) {
    return existing;
  }
  const material = context.materials.getRenderMaterial("metal").clone();
  if (material instanceof THREE.MeshStandardMaterial) {
    material.color.lerp(new THREE.Color(accent), 0.24);
    material.roughness = 0.46;
  }
  vehicleRenderMaterials.set(cacheKey, material);
  return material;
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
    ccd: false
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
  const renderMaterial = panelRenderMaterial(color, opacity, panelDepthOffset);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), renderMaterial);
  mesh.name = name;
  mesh.position.set(x, groundPanelY(panelDepthOffset), z);
  mesh.rotation.set(-Math.PI * 0.5, 0, 0);
  mesh.castShadow = false;
  mesh.receiveShadow = opacity >= 1;
  mesh.renderOrder = groundPanelRenderOrder(panelDepthOffset);
  mesh.userData.disposeMaterial = false;
  context.addDecoration(mesh);
}

function groundPanelY(layer: number): number {
  return 0.055 + Math.max(0, layer) * 0.004;
}

function groundPanelRenderOrder(layer: number): number {
  return Math.max(0, layer) * 0.1;
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

function sharedLevelMaterial(key: string, create: () => THREE.Material): THREE.Material {
  const existing = sharedLevelMaterials.get(key);
  if (existing) {
    return existing;
  }
  const material = create();
  sharedLevelMaterials.set(key, material);
  return material;
}

function sharedLevelBoxGeometry(width: number, height: number, depth: number): THREE.BoxGeometry {
  const key = `${width.toFixed(3)}:${height.toFixed(3)}:${depth.toFixed(3)}`;
  const existing = sharedLevelBoxGeometries.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.userData.sharedGeometry = true;
  sharedLevelBoxGeometries.set(key, geometry);
  return geometry;
}

function sharedLevelPlaneGeometry(width: number, height: number): THREE.PlaneGeometry {
  const key = `${width.toFixed(3)}:${height.toFixed(3)}`;
  const existing = sharedLevelPlaneGeometries.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.PlaneGeometry(width, height);
  geometry.userData.sharedGeometry = true;
  sharedLevelPlaneGeometries.set(key, geometry);
  return geometry;
}

function addStreetLight(context: LevelContext, x: number, z: number): void {
  const basePosition = alignCityObjectToRoadEdges(new THREE.Vector3(x, 0, z), new THREE.Vector3(0.48, 1.45, 0.42));
  const pole = context.physics.addDynamicBox({
    label: "street light pole",
    material: context.materials.get("metal"),
    renderMaterial: sharedLevelMaterial(
      "street-light-pole",
      () => new THREE.MeshStandardMaterial({ color: 0x2a3339, roughness: 0.5, metalness: 0.55, map: materialAtlasTile(0) })
    ),
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
  pole.mesh.userData.disposeMaterial = false;

  const armMaterial = sharedLevelMaterial(
    "street-light-arm",
    () => new THREE.MeshStandardMaterial({ color: 0x3b464d, roughness: 0.48, metalness: 0.62, map: materialAtlasTile(10) })
  );
  const lampMaterial = sharedLevelMaterial(
    "street-light-lamp",
    () => new THREE.MeshStandardMaterial({ color: 0x182026, roughness: 0.38, metalness: 0.58, map: materialAtlasTile(10) })
  );
  const lensMaterial = sharedLevelMaterial("street-light-lens", () => new THREE.MeshBasicMaterial({ color: 0xffe29b, transparent: true, opacity: 0.95 }));
  const arm = new THREE.Mesh(sharedLevelBoxGeometry(0.34, 0.045, 0.045), armMaterial);
  arm.name = "street light bracket";
  arm.position.set(0.17, 0.68, 0);
  arm.userData.disposeMaterial = false;
  pole.mesh.add(arm);

  const lamp = new THREE.Mesh(sharedLevelBoxGeometry(0.28, 0.09, 0.18), lampMaterial);
  lamp.name = "street light housing";
  lamp.position.set(0.38, 0.66, 0);
  lamp.userData.disposeMaterial = false;
  pole.mesh.add(lamp);

  const lens = new THREE.Mesh(sharedLevelBoxGeometry(0.2, 0.026, 0.13), lensMaterial);
  lens.name = "street light lens";
  lens.position.set(0.38, 0.61, 0);
  lens.userData.disposeMaterial = false;
  pole.mesh.add(lens);

  const glowMaterial = sharedLevelMaterial(
    "street-light-glow",
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffc86b,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      })
  );
  const glowPlane = new THREE.Mesh(sharedLevelPlaneGeometry(0.58, 0.32), glowMaterial);
  glowPlane.name = "street light fake glow";
  glowPlane.position.set(0.38, 0.58, 0);
  glowPlane.rotation.x = -Math.PI * 0.5;
  glowPlane.renderOrder = 3;
  glowPlane.userData.disposeMaterial = false;
  pole.mesh.add(glowPlane);

  if (Math.abs(x) < 8 && z > -7 && z < 7) {
    const glow = new THREE.PointLight(0xffc86b, 0.32, 3.2, 2);
    glow.position.set(0.38, 0.58, 0);
    pole.mesh.add(glow);
  }
}

function addBillboard(context: LevelContext, x: number, z: number, color: THREE.ColorRepresentation): void {
  const basePosition = alignCityObjectToRoadEdges(new THREE.Vector3(x, 0, z), new THREE.Vector3(1.38, 1.45, 0.18));
  for (const px of [-0.45, 0.45]) {
    const post = context.physics.addDynamicBox({
      label: "city billboard post",
      material: context.materials.get("metal"),
      renderMaterial: sharedLevelMaterial(
        "billboard-post",
        () => new THREE.MeshStandardMaterial({ color: 0x3d484f, roughness: 0.46, metalness: 0.62, map: materialAtlasTile(10) })
      ),
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
    post.mesh.userData.disposeMaterial = false;
  }
  const face = context.physics.addDynamicBox({
    label: "city billboard face",
    material: context.materials.get("foam"),
    renderMaterial: sharedLevelMaterial(
      `billboard-face:${String(color)}`,
      () => new THREE.MeshBasicMaterial({ color, map: decalAtlasTile(5), transparent: true, opacity: 0.92, alphaTest: 0.03 })
    ),
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
  face.mesh.userData.disposeMaterial = false;
  addBillboardFaceDetails(face.mesh, color);
}

function addBillboardFaceDetails(face: THREE.Mesh, color: THREE.ColorRepresentation): void {
  const frameMaterial = sharedLevelMaterial(
    "billboard-frame",
    () => new THREE.MeshStandardMaterial({ color: 0x111820, roughness: 0.62, metalness: 0.42, map: materialAtlasTile(10) })
  );
  const stripeMaterial = sharedLevelMaterial(`billboard-stripe:${String(color)}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }));
  const glowMaterial = sharedLevelMaterial("billboard-glow", () => new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.74 }));
  const details: Array<[THREE.Mesh, string]> = [
    [new THREE.Mesh(sharedLevelBoxGeometry(1.38, 0.045, 0.03), frameMaterial), "billboard top rail"],
    [new THREE.Mesh(sharedLevelBoxGeometry(1.38, 0.045, 0.03), frameMaterial), "billboard bottom rail"],
    [new THREE.Mesh(sharedLevelBoxGeometry(0.05, 0.52, 0.03), frameMaterial), "billboard left rail"],
    [new THREE.Mesh(sharedLevelBoxGeometry(0.05, 0.52, 0.03), frameMaterial), "billboard right rail"],
    [new THREE.Mesh(sharedLevelBoxGeometry(0.94, 0.035, 0.028), stripeMaterial), "billboard color stripe"],
    [new THREE.Mesh(sharedLevelBoxGeometry(0.46, 0.026, 0.03), glowMaterial), "billboard light strip"]
  ];
  details[0][0].position.set(0, 0.245, 0.045);
  details[1][0].position.set(0, -0.245, 0.045);
  details[2][0].position.set(-0.665, 0, 0.045);
  details[3][0].position.set(0.665, 0, 0.045);
  details[4][0].position.set(0, 0.06, 0.052);
  details[5][0].position.set(0.14, -0.1, 0.054);

  for (const [detail, name] of details) {
    detail.name = name;
    detail.castShadow = false;
    detail.receiveShadow = false;
    detail.userData.disposeMaterial = false;
    face.add(detail);
  }
}
