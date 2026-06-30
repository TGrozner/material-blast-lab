import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  decorateBuildingCell,
  decorateCityVehicle,
  decorateHazardIndicator,
  decorateStrategicHazard,
  decorateStreetCargo,
  decorateTrafficBarricade,
  type BuildingBrand,
  type BuildingVisualStyle
} from "./cityVisuals";
import { MaterialCatalog, type MaterialId } from "./materialCatalog";
import { PhysicsWorld, type ScoreRole, type TrafficRoute } from "./physics";
import type { ArcadeBonusThreshold } from "./arcade";
import { CITY_GROUND_GEOMETRY_BATCHES, type PrebakedGroundGeometryBatch } from "./generated/cityGroundGeometry";
import { decalAtlasTile, graphicTexture, materialAtlasTile } from "./visualAssets";

type TriggerType = "transformer" | "springPad" | "shockCanister";
const panelRenderMaterials = new Map<string, THREE.Material>();
const vehicleRenderMaterials = new Map<string, THREE.Material>();
const sharedLevelMaterials = new Map<string, THREE.Material>();
const sharedLevelBoxGeometries = new Map<string, THREE.BoxGeometry>();
const sharedLevelRingGeometries = new Map<string, THREE.RingGeometry>();

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
    objective: "Pick one big target: gas station, power grid, parking silo, elevated metro, or skyneedle.",
    chaosBrief: "Recognizable hazard buildings hit harder, but only a few can cascade per wave.",
    cannonPosition: new THREE.Vector3(0, 6.08, 24.55),
    defaultAimPoint: new THREE.Vector3(-1.72, 0.16, -3.35),
    cameraTarget: new THREE.Vector3(0, 0.9, -2.6),
    mission: {
      arc: "object-destruction",
      order: 1,
      targetZone: "hazard-core",
      scoreThresholds: {
        oneStar: 75_000,
        twoStar: 145_000,
        threeStar: 220_000
      },
      targetDamageThreshold: 30_000,
      bonusThreshold: { metric: "chainReactionCount", minimum: 180 },
      bonusObjective: "Sustain 180+ secondary hits from the energy plant, gas line, substation, propane depot, parking silo, metro line, vehicle grid, or skyneedle debris.",
      briefingHint: "Aim choice matters: gas is wide and low, the metro carries moving mass, the skyneedle sheds vertical debris, and the parking silo feeds vehicle chaos."
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
      spawnCentralConstructionCrane(context);
      spawnConstructionScaffolding(context);
      spawnStreetSetpieces(context);
    }
  },
  {
    id: "breaker-yard",
    name: "Breaker Yard",
    description: "A full breaker district with a concrete spine, transformer yards, relay towers, and traffic weaving through the blast lanes.",
    objective: "Start at the breaker spine, substation banks, relay towers, tankers, or traffic lanes, then keep secondary hits moving.",
    chaosBrief: "This is a real city sector now: power arcs, tower debris, traffic, and dense blocks can all feed the same chain.",
    cannonPosition: new THREE.Vector3(-6.45, 6.15, 24.85),
    defaultAimPoint: new THREE.Vector3(-0.65, 0.18, -4.15),
    cameraTarget: new THREE.Vector3(-0.4, 0.95, -2.3),
    mission: {
      arc: "object-destruction",
      order: 2,
      targetZone: "breaker-spine",
      scoreThresholds: {
        oneStar: 115_000,
        twoStar: 230_000,
        threeStar: 390_000
      },
      targetDamageThreshold: 42_000,
      bonusThreshold: { metric: "chainReactionCount", minimum: 210 },
      bonusObjective: "Sustain 210+ secondary hits from breaker towers, substations, tankers, and vehicle debris.",
      briefingHint: "The spine is tough but reliable; the substation yards are wider, flashier starters if you can catch the relay rows."
    },
    setup: (context) => setupBreakerYardCity(context)
  },
  {
    id: "switchback-crush",
    name: "Switchback Crush",
    description: "A full glass-and-foam switchback district where fragile archive towers, soft baffles, and service traffic steer the collapse.",
    objective: "Break the archive spine, then steer debris through foam baffles, traffic, and both switchback blocks.",
    chaosBrief: "This is a brittle city bowl with multiple angles, redirects, and crush paths.",
    cannonPosition: new THREE.Vector3(6.25, 6.08, 24.55),
    defaultAimPoint: new THREE.Vector3(0.85, 0.18, -3.65),
    cameraTarget: new THREE.Vector3(0.55, 0.95, -2.1),
    mission: {
      arc: "object-destruction",
      order: 3,
      targetZone: "glass-depot",
      scoreThresholds: {
        oneStar: 125_000,
        twoStar: 260_000,
        threeStar: 440_000
      },
      targetDamageThreshold: 48_000,
      bonusThreshold: { metric: "collateralChaos", minimum: 95_000 },
      bonusObjective: "Push 95,000+ collateral chaos from archive glass, foam redirects, vehicles, and service crates.",
      briefingHint: "Foam is still the steering wheel, but now the city gives you multiple redirect lines instead of one obvious lane."
    },
    setup: (context) => setupSwitchbackCrushCity(context)
  },
  {
    id: "relay-gauntlet",
    name: "Relay Gauntlet",
    description: "A late breaker corridor with marked relay gates, traffic bait, and a boss capacitor staged as the final cash-out.",
    objective: "Thread the relay lane, flip traffic into the transformer gates, then crack the boss capacitor weak points.",
    chaosBrief: "This is a route level now: pads open the lane, transformers keep it alive, and the capacitor crown is the readable finish.",
    cannonPosition: new THREE.Vector3(-8.25, 6.2, 25.1),
    defaultAimPoint: new THREE.Vector3(4.9, 0.2, -5.2),
    cameraTarget: new THREE.Vector3(1.1, 1.0, -2.9),
    mission: {
      arc: "object-destruction",
      order: 4,
      targetZone: "breaker-boss",
      scoreThresholds: {
        oneStar: 155_000,
        twoStar: 315_000,
        threeStar: 520_000
      },
      targetDamageThreshold: 58_000,
      bonusThreshold: { metric: "maxChainCombo", minimum: 28 },
      bonusObjective: "Build a x28+ max chain through breaker relays, capacitor weak points, moving traffic, and utility cargo.",
      briefingHint: "The blue route paint points from the relay gates to the capacitor crown; use traffic and spring pads to bridge the gaps."
    },
    setup: (context) => setupRelayGauntletCity(context)
  },
  {
    id: "overdrive-core",
    name: "Overdrive Core",
    description: "A final overdrive bowl with prism route paint, pressure bulbs, mirrored redirect pads, and a fortified archive boss.",
    objective: "Open the prism boss, rebound debris through both redirect arms, then harvest the pressure bulbs and archive traffic.",
    chaosBrief: "This is a readable final exam: the boss lens starts the crash, pads reverse it, and bulbs/traffic keep the cascade alive.",
    cannonPosition: new THREE.Vector3(8.35, 6.15, 25.0),
    defaultAimPoint: new THREE.Vector3(7.35, 0.2, -4.55),
    cameraTarget: new THREE.Vector3(1.35, 1.05, -2.6),
    mission: {
      arc: "object-destruction",
      order: 5,
      targetZone: "archive-boss",
      scoreThresholds: {
        oneStar: 180_000,
        twoStar: 360_000,
        threeStar: 610_000
      },
      targetDamageThreshold: 66_000,
      bonusThreshold: { metric: "collateralChaos", minimum: 140_000 },
      bonusObjective: "Push 140,000+ collateral chaos from archive glass, redirect pads, pressure bulbs, traffic, and service crates.",
      briefingHint: "Follow the magenta switchback paint: boss lens, right redirect, center rebound, left archive crush, pressure bulbs."
    },
    setup: (context) => setupOverdriveCoreCity(context)
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
  brand?: BuildingBrand;
}

type DenseDistrictBuildingRow = readonly [
  label: string,
  materialId: MaterialId,
  x: number,
  z: number,
  width: number,
  height: number,
  depth: number,
  floors: number,
  columns: number,
  style: BuildingVisualStyle,
  zoneId: string,
  scoreValue: number,
  rotationY: number,
  stagger: number
];

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
  detail?: "full" | "lean";
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
const ELEVATED_METRO_PLACEMENT_HALF_WIDTH = 0.74;
const ELEVATED_METRO_PLACEMENT_BLOCKERS: CityRoadCorridor[] = [
  {
    axis: "z",
    minX: ELEVATED_METRO_LOOP[0][0] - ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    maxX: ELEVATED_METRO_LOOP[1][0] + ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    minZ: ELEVATED_METRO_LOOP[0][1] - ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    maxZ: ELEVATED_METRO_LOOP[0][1] + ELEVATED_METRO_PLACEMENT_HALF_WIDTH
  },
  {
    axis: "z",
    minX: ELEVATED_METRO_LOOP[3][0] - ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    maxX: ELEVATED_METRO_LOOP[2][0] + ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    minZ: ELEVATED_METRO_LOOP[2][1] - ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    maxZ: ELEVATED_METRO_LOOP[2][1] + ELEVATED_METRO_PLACEMENT_HALF_WIDTH
  },
  {
    axis: "x",
    minX: ELEVATED_METRO_LOOP[0][0] - ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    maxX: ELEVATED_METRO_LOOP[0][0] + ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    minZ: ELEVATED_METRO_LOOP[0][1] - ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    maxZ: ELEVATED_METRO_LOOP[3][1] + ELEVATED_METRO_PLACEMENT_HALF_WIDTH
  },
  {
    axis: "x",
    minX: ELEVATED_METRO_LOOP[1][0] - ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    maxX: ELEVATED_METRO_LOOP[1][0] + ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    minZ: ELEVATED_METRO_LOOP[1][1] - ELEVATED_METRO_PLACEMENT_HALF_WIDTH,
    maxZ: ELEVATED_METRO_LOOP[2][1] + ELEVATED_METRO_PLACEMENT_HALF_WIDTH
  }
];
const CITY_PLACEMENT_BLOCKERS: CityRoadCorridor[] = [...CITY_ROAD_CORRIDORS, ...ELEVATED_METRO_PLACEMENT_BLOCKERS];

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
  spawnBreakerBossCapacitor(context, { phaseReadout: true });
  spawnBreakerYardDensityInfill(context);
  spawnBreakerYardUrbanGrid(context);
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
  spawnArchiveBossLens(context, { phaseReadout: true });
  spawnSwitchbackArchiveDensityInfill(context);
  spawnSwitchbackGlassCanyon(context);
  spawnSwitchbackStreetActivity(context);
  spawnStreetSetpieces(context);
}

function setupRelayGauntletCity(context: LevelContext): void {
  addCityGround(context);
  spawnNeutralCityBlocks(context);
  spawnInfillCityBlocks(context);
  spawnVacantLotInfill(context);
  spawnBreakerYardCore(context);
  spawnBreakerYardRelayWeb(context);
  spawnBreakerBossCapacitor(context, { phaseReadout: true });
  spawnRelayGauntletRoutePaint(context);
  spawnRelayGauntletCapacitorRoute(context);
  spawnRelayGauntletDensityInfill(context);
  spawnRelayRouteCanyon(context);
  spawnRelayGauntletTraffic(context);
  spawnPowerGrid(context);
  spawnStreetSetpieces(context);
}

function setupOverdriveCoreCity(context: LevelContext): void {
  addCityGround(context);
  spawnNeutralCityBlocks(context);
  spawnInfillCityBlocks(context);
  spawnVacantLotInfill(context);
  spawnSwitchbackArchiveCore(context);
  spawnSwitchbackRedirectors(context);
  spawnArchiveBossLens(context, { phaseReadout: true });
  spawnOverdriveCoreRoutePaint(context);
  spawnOverdriveCoreSetpieces(context);
  spawnOverdriveCoreDensityInfill(context);
  spawnOverdriveFinalBowlDensity(context);
  spawnOverdriveCoreTraffic(context);
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

function spawnBreakerBossCapacitor(context: LevelContext, options: BossPhaseReadoutOptions = {}): void {
  const rotationY = Math.PI * 0.06;
  const base = alignCityObjectToRoadEdges(
    new THREE.Vector3(4.92, 0, -5.24),
    new THREE.Vector3(1.52, 2.9, 1.18),
    rotationY,
    0.32
  );
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
  const support: BossSupportOptions = {
    supportGroupId: "breaker-boss-capacitor-collapse",
    supportReleaseRadius: 4.25,
    supportReleaseHeight: 3.9,
    supportReleaseLowerHeight: 0.9,
    supportReleaseFallDirection: new THREE.Vector3(-0.62, 0, 0.38)
  };
  const coreSize = new THREE.Vector3(1.16, 2.64, 0.88);
  const core = addBossCoreBox(context, {
    label: "Breaker boss capacitor stack",
    materialId: "metal",
    renderMaterial: bossCoreMaterial("breaker-capacitor", 0x415461, 0x33d6ff),
    position: bossWorldPosition(base, rotationY, new THREE.Vector3(0, coreSize.y * 0.5, 0)),
    size: coreSize,
    rotation,
    zoneId: "breaker-boss capacitor-bank hazard-relay explosive power-grid",
    scoreValue: 980,
    kind: "electric",
    support,
    fractureResistance: 0.42
  });
  decorateBossCore(core, coreSize, "breaker");
  addBossArenaMarkers(context, base, rotationY, "breaker");

  const weakPoints: BossWeakPointSpec[] = options.phaseReadout
    ? [
        {
          label: "Breaker boss phase 1 shield clamp",
          local: new THREE.Vector3(-0.68, 0.72, 0.5),
          size: new THREE.Vector3(0.32, 0.24, 0.26),
          scoreValue: 260,
          zoneTags: "boss-phase phase-1 shield",
          phaseIndex: 1
        },
        {
          label: "Breaker boss phase 2 latch coupler",
          local: new THREE.Vector3(0.66, 1.52, 0.5),
          size: new THREE.Vector3(0.34, 0.22, 0.28),
          scoreValue: 280,
          zoneTags: "boss-phase phase-2 latch",
          phaseIndex: 2
        },
        {
          label: "Breaker boss phase 3 capacitor core",
          local: new THREE.Vector3(0.02, 2.46, -0.5),
          size: new THREE.Vector3(0.38, 0.22, 0.24),
          scoreValue: 320,
          zoneTags: "boss-phase phase-3 core cashout",
          phaseIndex: 3
        }
      ]
    : [
        {
          label: "Breaker boss shear pin",
          local: new THREE.Vector3(-0.68, 0.72, 0.5),
          size: new THREE.Vector3(0.32, 0.24, 0.26),
          scoreValue: 260,
          zoneTags: ""
        },
        {
          label: "Breaker boss support coupler",
          local: new THREE.Vector3(0.66, 1.52, 0.5),
          size: new THREE.Vector3(0.34, 0.22, 0.28),
          scoreValue: 280,
          zoneTags: ""
        },
        {
          label: "Breaker boss release latch",
          local: new THREE.Vector3(0.02, 2.46, -0.5),
          size: new THREE.Vector3(0.38, 0.22, 0.24),
          scoreValue: 320,
          zoneTags: ""
        }
      ];

  for (const weakPoint of weakPoints) {
    addReadableWeakPoint(context, {
      label: weakPoint.label,
      position: bossWorldPosition(base, rotationY, weakPoint.local),
      size: weakPoint.size,
      rotation,
      zoneId: `breaker-boss weak-point capacitor-bank hazard-core${weakPoint.zoneTags ? ` ${weakPoint.zoneTags}` : ""}`,
      scoreValue: weakPoint.scoreValue,
      kind: "electric",
      support,
      phaseIndex: weakPoint.phaseIndex,
      phaseTheme: "breaker"
    });
  }

  addBossRelayCanister(context, {
    label: "Breaker boss overcharge canister",
    position: bossWorldPosition(base, rotationY, new THREE.Vector3(0.86, 0.46, -0.18)),
    size: new THREE.Vector3(0.38, 0.72, 0.38),
    rotation,
    zoneId: "breaker-boss hazard-relay explosive power-grid",
    scoreValue: 230,
    kind: "explosive",
    phaseTheme: "breaker",
    support
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

function spawnBreakerYardDensityInfill(context: LevelContext): void {
  const buildings: BuildingSpec[] = [
    {
      label: "Switchyard control annex",
      materialId: "metal",
      position: new THREE.Vector3(-8.95, 0, -1.7),
      size: new THREE.Vector3(0.5, 0.46, 0.52),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "breaker-yard-fill switchyard",
      scoreValue: 32,
      style: "warehouse",
      stagger: 0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Breaker cable warehouse",
      materialId: "concrete",
      position: new THREE.Vector3(8.75, 0, -1.95),
      size: new THREE.Vector3(0.54, 0.5, 0.58),
      floors: 5,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "breaker-yard-fill switchyard",
      scoreValue: 34,
      style: "industrial",
      stagger: -0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Coolant shed stack",
      materialId: "wood",
      position: new THREE.Vector3(-7.35, 0, 4.05),
      size: new THREE.Vector3(0.5, 0.42, 0.5),
      floors: 3,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "breaker-yard-fill coolant-kiosk",
      scoreValue: 28,
      style: "utility",
      stagger: -0.06,
      rotationY: -Math.PI * 0.06
    },
    {
      label: "Meter shop row",
      materialId: "glass",
      position: new THREE.Vector3(6.85, 0, 5.15),
      size: new THREE.Vector3(0.46, 0.5, 0.48),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "breaker-yard-fill relay-booth",
      scoreValue: 30,
      style: "utility",
      stagger: 0.06,
      rotationY: Math.PI * 0.5
    },
    {
      label: "South battery shopfront",
      materialId: "concrete",
      position: new THREE.Vector3(-2.75, 0, 7.2),
      size: new THREE.Vector3(0.5, 0.46, 0.5),
      floors: 4,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "breaker-yard-fill battery-road",
      scoreValue: 30,
      style: "market",
      stagger: 0.04
    }
  ];

  for (const building of buildings) {
    spawnCityBuildingStack(context, building);
  }

  for (const [label, materialId, x, z, width, height, depth, rotationY] of [
    ["Switchyard cable tray", "rubber", -8.1, 0.65, 1.6, 0.1, 0.12, Math.PI * 0.5],
    ["Switchyard cable tray", "rubber", 8.05, -0.45, 1.75, 0.1, 0.12, Math.PI * 0.5],
    ["Meter cabinet row", "glass", -6.85, 1.6, 0.48, 0.62, 0.46, Math.PI * 0.5],
    ["Transformer pallet cluster", "metal", 6.35, 1.75, 0.84, 0.48, 0.58, -Math.PI * 0.08],
    ["Coolant barrel stack", "foam", -6.2, 5.35, 0.82, 0.4, 0.58, Math.PI * 0.18],
    ["Breaker timber stop", "wood", 4.45, 6.45, 0.86, 0.42, 0.6, -Math.PI * 0.18],
    ["Rubber conductor bundle", "rubber", 1.15, 6.95, 1.55, 0.12, 0.14, Math.PI * 0.5],
    ["Metal relay crate", "metal", -4.8, -6.55, 0.74, 0.48, 0.5, Math.PI * 0.12]
  ] as const) {
    addStreetCargo(context, label, materialId, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  for (const [type, label, x, z, width, height, depth, rotationY] of [
    ["transformer", "Switchyard spare transformer", -8.2, -4.25, 0.54, 0.74, 0.46, Math.PI * 0.08],
    ["shockCanister", "Coolant arc canister", -7.55, 2.7, 0.4, 0.64, 0.4, Math.PI * 0.5],
    ["springPad", "Breaker lane rebound pad", 7.55, 3.15, 0.82, 0.2, 0.6, -Math.PI * 0.12]
  ] as const) {
    addHazardRelay(context, type, label, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  addRoutedCityVehicle(context, "Breaker cable flatbed", BATTERY_TRAFFIC_LOOP, 0.82, 0, 0.74, 0.32, new THREE.Vector3(0.52, 0.38, 1.0), 0x5de7ff, {
    zoneId: "breaker-yard switchyard moving-vehicles",
    scoreValue: 92,
    hazardKind: "electric",
    detail: "full"
  });
  addRoutedCityVehicle(context, "Breaker yard taxi", INNER_BELT_TRAFFIC_LOOP, 1.18, 3, 0.58, 0.28, new THREE.Vector3(0.38, 0.32, 0.72), 0xffc241, {
    scoreValue: 42
  });
  addBillboard(context, 8.55, 5.55, 0x5de7ff);
  addStreetLight(context, -8.35, 2.0);
  addStreetLight(context, 8.2, 2.45);
  addStreetLight(context, -3.15, 7.35);
}

function spawnBreakerYardUrbanGrid(context: LevelContext): void {
  spawnDenseDistrictBuildingRows(context, [
    ["North switch flats", "concrete", -6.85, -9.85, 0.52, 0.52, 0.52, 6, 5, "apartment", "breaker-yard-grid north-switch", 34, Math.PI * 0.04, 0.05],
    ["North cable tenement", "metal", -3.45, -9.75, 0.5, 0.5, 0.58, 5, 5, "industrial", "breaker-yard-grid north-switch", 34, -Math.PI * 0.04, -0.04],
    ["North meter offices", "glass", 3.55, -9.65, 0.44, 0.58, 0.46, 5, 4, "glassTower", "breaker-yard-grid meter-office", 34, Math.PI * 0.05, 0.04],
    ["North substation dorms", "concrete", 6.85, -9.55, 0.52, 0.5, 0.52, 5, 5, "apartment", "breaker-yard-grid substation", 34, -Math.PI * 0.05, -0.05],
    ["West breaker housing A", "concrete", -13.25, -5.25, 0.52, 0.5, 0.54, 5, 4, "apartment", "breaker-yard-grid west-service", 32, Math.PI * 0.5, 0.04],
    ["West breaker housing B", "wood", -13.4, -3.15, 0.5, 0.44, 0.52, 4, 6, "utility", "breaker-yard-grid west-service", 28, Math.PI * 0.5, -0.05],
    ["West transformer stores", "metal", -13.45, 0.95, 0.52, 0.46, 0.58, 4, 5, "warehouse", "breaker-yard-grid transformer-alley", 32, Math.PI * 0.5, 0.05],
    ["West coolant row", "foam", -13.25, 3.15, 0.48, 0.38, 0.48, 4, 6, "market", "breaker-yard-grid coolant-alley", 26, Math.PI * 0.5, -0.04],
    ["West battery apartments", "concrete", -13.25, 10.75, 0.5, 0.5, 0.52, 6, 5, "apartment", "breaker-yard-grid battery-road", 34, Math.PI * 0.5, 0.05],
    ["West relay depot wall", "metal", -8.15, 10.95, 0.52, 0.44, 0.58, 4, 6, "warehouse", "breaker-yard-grid relay-depot", 30, Math.PI * 0.5, 0.04],
    ["South battery storefront A", "foam", -5.2, 11.35, 0.48, 0.38, 0.48, 3, 6, "market", "breaker-yard-grid battery-road", 26, 0, 0.05],
    ["South battery storefront B", "wood", -1.85, 11.55, 0.5, 0.42, 0.52, 4, 5, "utility", "breaker-yard-grid battery-road", 28, 0, -0.05],
    ["South meter shop row", "glass", 2.1, 11.45, 0.44, 0.56, 0.46, 4, 5, "glassTower", "breaker-yard-grid meter-office", 32, 0, 0.05],
    ["South cable warehouse", "metal", 5.35, 11.25, 0.52, 0.46, 0.58, 5, 6, "warehouse", "breaker-yard-grid cable-warehouse", 32, 0, -0.04],
    ["East breaker housing A", "concrete", 13.2, -5.1, 0.52, 0.5, 0.54, 5, 5, "apartment", "breaker-yard-grid east-service", 34, Math.PI * 0.5, -0.05],
    ["East switch shop row", "wood", 13.25, -3.05, 0.5, 0.42, 0.52, 4, 6, "utility", "breaker-yard-grid east-service", 28, Math.PI * 0.5, 0.05],
    ["East meter lofts", "glass", 13.45, 0.92, 0.44, 0.58, 0.46, 5, 4, "glassTower", "breaker-yard-grid meter-office", 34, Math.PI * 0.5, -0.04],
    ["East cable warehouse", "metal", 13.35, 3.08, 0.52, 0.46, 0.58, 4, 6, "warehouse", "breaker-yard-grid cable-warehouse", 30, Math.PI * 0.5, 0.04],
    ["East battery flats", "concrete", 13.25, 10.55, 0.5, 0.5, 0.52, 5, 5, "apartment", "breaker-yard-grid battery-road", 34, Math.PI * 0.5, -0.05],
    ["Battery road relay block", "metal", 8.2, 10.95, 0.52, 0.46, 0.58, 5, 4, "industrial", "breaker-yard-grid relay-depot", 32, Math.PI * 0.5, 0.04],
    ["Inner switchyard offices", "concrete", -5.95, -4.05, 0.5, 0.5, 0.54, 5, 4, "apartment", "breaker-yard-grid switchyard-canyon", 32, Math.PI * 0.08, 0.04],
    ["Inner cable warehouse west", "metal", -6.15, -0.35, 0.52, 0.46, 0.58, 4, 5, "warehouse", "breaker-yard-grid switchyard-canyon", 30, -Math.PI * 0.08, -0.04],
    ["Inner coolant service stack", "foam", -4.85, 6.7, 0.48, 0.38, 0.48, 4, 6, "market", "breaker-yard-grid coolant-alley", 26, Math.PI * 0.1, 0.05],
    ["Inner relay office east", "glass", 6.05, -4.05, 0.44, 0.58, 0.46, 5, 5, "glassTower", "breaker-yard-grid relay-booth", 34, -Math.PI * 0.08, -0.04],
    ["Inner transformer stores east", "metal", 6.15, -0.1, 0.52, 0.46, 0.58, 4, 5, "warehouse", "breaker-yard-grid transformer-alley", 30, Math.PI * 0.08, 0.04],
    ["Inner battery trade school", "concrete", 5.85, 6.8, 0.5, 0.5, 0.54, 5, 5, "apartment", "breaker-yard-grid battery-road", 34, -Math.PI * 0.08, -0.05],
    ["Outer switchyard stores", "rubber", -9.2, 7.0, 0.5, 0.38, 0.5, 4, 6, "utility", "breaker-yard-grid rubber-conductor", 26, Math.PI * 0.5, 0.05]
  ]);
}

function spawnRelayGauntletRoutePaint(context: LevelContext): void {
  for (const [label, x, z, width, depth, color, opacity] of [
    ["Relay gauntlet north entry stripe", -4.65, -6.28, 5.8, 0.34, 0x5de7ff, 0.34],
    ["Relay gauntlet capacitor arrow stripe", 2.6, -6.18, 4.2, 0.42, 0x5de7ff, 0.38],
    ["Relay gauntlet transformer gate stripe", 7.45, -3.2, 0.42, 4.6, 0xffb23f, 0.32],
    ["Relay gauntlet traffic loop stripe", 6.2, -0.8, 3.65, 0.34, 0xffd66b, 0.3],
    ["Relay gauntlet pad return stripe", 3.55, 3.72, 4.25, 0.34, 0x75e6ff, 0.32],
    ["Relay gauntlet south cashout stripe", 5.0, 5.95, 3.6, 0.3, 0xff8f38, 0.3]
  ] as const) {
    addPanel(context, label, x, z, width, depth, color, opacity, CITY_GROUND_LAYER_MARKINGS + 1);
  }
}

function spawnRelayGauntletCapacitorRoute(context: LevelContext): void {
  for (const [type, label, x, z, width, height, depth, rotationY] of [
    ["transformer", "Relay gauntlet opener transformer", -5.65, -4.92, 0.58, 0.78, 0.48, Math.PI * 0.08],
    ["shockCanister", "Relay gauntlet split shock canister", -2.2, -5.18, 0.42, 0.72, 0.42, -Math.PI * 0.08],
    ["springPad", "Relay gauntlet launch pad", 1.45, -5.56, 0.95, 0.22, 0.66, Math.PI * 0.08],
    ["transformer", "Relay gauntlet boss gate transformer", 6.65, -3.75, 0.58, 0.82, 0.5, -Math.PI * 0.5],
    ["shockCanister", "Relay gauntlet traffic shock canister", 7.25, 0.5, 0.42, 0.72, 0.42, Math.PI * 0.5],
    ["springPad", "Relay gauntlet traffic rebound pad", 5.7, 3.42, 0.94, 0.22, 0.66, -Math.PI * 0.16]
  ] as const) {
    addHazardRelay(context, type, label, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  for (const [label, materialId, x, z, width, height, depth, rotationY] of [
    ["Relay gauntlet power cable spine", "rubber", -3.82, -4.48, 2.5, 0.08, 0.08, Math.PI * 0.5],
    ["Relay gauntlet power cable spine", "rubber", 0.24, -4.74, 2.7, 0.08, 0.08, Math.PI * 0.5],
    ["Relay gauntlet capacitor cable bridge", "rubber", 3.64, -4.86, 2.05, 0.08, 0.08, Math.PI * 0.5],
    ["Relay gauntlet utility cargo gate", "metal", 4.04, -3.02, 0.84, 0.52, 0.46, -Math.PI * 0.12],
    ["Relay gauntlet coolant bounce pallet", "foam", 6.1, 2.42, 0.86, 0.38, 0.58, Math.PI * 0.16],
    ["Relay gauntlet breaker stop block", "wood", 2.18, 3.52, 0.86, 0.42, 0.58, -Math.PI * 0.12]
  ] as const) {
    addStreetCargo(context, label, materialId, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  addStrategicHazardBox(context, {
    label: "Relay gauntlet capacitor crown",
    materialId: "metal",
    position: new THREE.Vector3(5.72, 0.96, -4.02),
    size: new THREE.Vector3(0.52, 1.92, 0.42),
    zoneId: "breaker-boss capacitor-bank weak-point power-grid",
    scoreValue: 430,
    kind: "electric",
    rotationY: -Math.PI * 0.04,
    fractureResistance: 0.2,
    showReadableMarker: true
  });
  addStrategicHazardBox(context, {
    label: "Relay gauntlet discharge manifold",
    materialId: "glass",
    position: new THREE.Vector3(4.02, 0.42, -3.82),
    size: new THREE.Vector3(0.78, 0.84, 0.36),
    zoneId: "breaker-boss hazard-relay explosive power-grid",
    scoreValue: 310,
    kind: "electric",
    rotationY: Math.PI * 0.5,
    fractureResistance: 0.16,
    showReadableMarker: true
  });
  addStrategicHazardBox(context, {
    label: "Relay gauntlet overload fuse",
    materialId: "glass",
    position: new THREE.Vector3(6.9, 0.36, -5.64),
    size: new THREE.Vector3(0.36, 0.72, 0.36),
    zoneId: "breaker-boss hazard-relay explosive power-grid",
    scoreValue: 260,
    kind: "explosive",
    fractureResistance: 0.12,
    showReadableMarker: true
  });

  addBillboard(context, 2.35, -5.9, 0x5de7ff);
  addBillboard(context, 7.9, -3.2, 0xffb23f);
  addBillboard(context, 4.6, 3.86, 0x75e6ff);
}

function spawnRelayGauntletTraffic(context: LevelContext): void {
  addRoutedCityVehicle(context, "Relay gauntlet fuel tanker", NORTH_TRAFFIC_LOOP, 0.9, 0, 0.58, 0.36, new THREE.Vector3(0.54, 0.44, 1.18), 0xffd66b, {
    zoneId: "relay-gauntlet fuel traffic-bait moving-vehicles",
    scoreValue: 320,
    hazardKind: "combustible",
    detail: "full"
  });
  addRoutedCityVehicle(context, "Relay gauntlet capacitor flatbed", CENTRAL_TRAFFIC_LOOP, 0.84, 1, 0.35, 0.32, new THREE.Vector3(0.52, 0.38, 0.98), 0x5de7ff, {
    zoneId: "relay-gauntlet capacitor-bank moving-vehicles",
    scoreValue: 94,
    detail: "full"
  });
  addRoutedCityVehicle(context, "Relay gauntlet shuttle blocker", CITY_BELT_TRAFFIC_LOOP, 0.72, 2, 0.66, 0.38, new THREE.Vector3(0.64, 0.5, 1.2), 0x75e6ff, {
    zoneId: "relay-gauntlet traffic-loop moving-vehicles",
    scoreValue: 92,
    detail: "full"
  });
  addRoutedCityVehicle(context, "Relay gauntlet courier spark", BATTERY_TRAFFIC_LOOP_OPPOSITE, 1.24, 1, 0.28, 0.27, new THREE.Vector3(0.36, 0.31, 0.68), 0xff8f38, {
    zoneId: "relay-gauntlet traffic-loop moving-vehicles",
    scoreValue: 48
  });
}

function spawnRelayGauntletDensityInfill(context: LevelContext): void {
  const buildings: BuildingSpec[] = [
    {
      label: "Relay lane operator stack",
      materialId: "metal",
      position: new THREE.Vector3(-8.55, 0, -3.95),
      size: new THREE.Vector3(0.5, 0.5, 0.5),
      floors: 5,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "relay-gauntlet-fill route-operator",
      scoreValue: 34,
      style: "industrial",
      stagger: 0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Capacitor service row",
      materialId: "concrete",
      position: new THREE.Vector3(8.8, 0, -1.75),
      size: new THREE.Vector3(0.5, 0.46, 0.54),
      floors: 4,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "relay-gauntlet-fill capacitor-bank",
      scoreValue: 32,
      style: "warehouse",
      stagger: -0.04,
      rotationY: Math.PI * 0.5
    },
    {
      label: "South relay depot",
      materialId: "wood",
      position: new THREE.Vector3(7.05, 0, 5.65),
      size: new THREE.Vector3(0.52, 0.42, 0.5),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "relay-gauntlet-fill south-cashout",
      scoreValue: 28,
      style: "utility",
      stagger: 0.06,
      rotationY: -Math.PI * 0.06
    },
    {
      label: "Traffic bait kiosk",
      materialId: "glass",
      position: new THREE.Vector3(-6.85, 0, 4.05),
      size: new THREE.Vector3(0.44, 0.5, 0.46),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "relay-gauntlet-fill traffic-bait",
      scoreValue: 30,
      style: "glassTower",
      stagger: -0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Route marshal block",
      materialId: "foam",
      position: new THREE.Vector3(1.1, 0, 7.35),
      size: new THREE.Vector3(0.5, 0.4, 0.5),
      floors: 3,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "relay-gauntlet-fill route-bumper",
      scoreValue: 26,
      style: "market",
      stagger: 0.04
    }
  ];

  for (const building of buildings) {
    spawnCityBuildingStack(context, building);
  }

  for (const [type, label, x, z, width, height, depth, rotationY] of [
    ["transformer", "Relay north gate pylon", -6.95, -5.75, 0.44, 0.82, 0.38, Math.PI * 0.08],
    ["transformer", "Relay capacitor side pylon", 8.05, -3.35, 0.44, 0.82, 0.38, -Math.PI * 0.5],
    ["shockCanister", "Relay phase marker canister", 7.45, 2.2, 0.4, 0.66, 0.4, Math.PI * 0.5],
    ["springPad", "Relay south timing pad", 3.95, 5.35, 0.86, 0.2, 0.6, -Math.PI * 0.14]
  ] as const) {
    addHazardRelay(context, type, label, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  for (const [label, materialId, x, z, width, height, depth, rotationY] of [
    ["Relay overhead cable tray", "rubber", -6.15, -4.02, 1.65, 0.1, 0.12, Math.PI * 0.5],
    ["Relay phase cable tray", "rubber", 6.62, -1.75, 1.75, 0.1, 0.12, Math.PI * 0.5],
    ["Relay traffic barrier crate", "wood", 5.85, 0.88, 0.84, 0.42, 0.58, Math.PI * 0.12],
    ["Relay capacitor meter cart", "glass", 7.05, -4.95, 0.52, 0.58, 0.48, -Math.PI * 0.08],
    ["Relay route bumper pair", "foam", 2.7, 5.05, 0.94, 0.36, 0.56, Math.PI * 0.18],
    ["Relay service pallet", "metal", -2.85, 5.85, 0.78, 0.46, 0.52, -Math.PI * 0.12],
    ["Relay cable ballast", "rubber", -7.7, 0.82, 1.35, 0.12, 0.14, Math.PI * 0.5],
    ["Relay fuse crate", "glass", 0.85, -6.35, 0.5, 0.58, 0.48, Math.PI * 0.08]
  ] as const) {
    addStreetCargo(context, label, materialId, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  addRoutedCityVehicle(context, "Relay gauntlet hazard coupe", INNER_BELT_TRAFFIC_LOOP, 1.16, 1, 0.52, 0.28, new THREE.Vector3(0.38, 0.32, 0.72), 0xffc241, {
    zoneId: "relay-gauntlet traffic-bait moving-vehicles",
    scoreValue: 52,
    hazardKind: "combustible"
  });
  addRoutedCityVehicle(context, "Relay utility loader", CITY_BELT_TRAFFIC_LOOP, 0.82, 3, 0.42, 0.32, new THREE.Vector3(0.48, 0.38, 0.78), 0x93f1ff, {
    zoneId: "relay-gauntlet utility-cargo moving-vehicles",
    scoreValue: 64
  });
  addBillboard(context, -7.95, -4.9, 0x5de7ff);
  addBillboard(context, 7.8, 5.35, 0xffb23f);
  addStreetLight(context, -6.5, -5.85);
  addStreetLight(context, 6.45, 0.85);
}

function spawnRelayRouteCanyon(context: LevelContext): void {
  spawnDenseDistrictBuildingRows(context, [
    ["Relay north pylon flats", "concrete", -6.9, -9.9, 0.52, 0.52, 0.54, 6, 5, "apartment", "relay-gauntlet-grid north-pylon", 34, Math.PI * 0.04, 0.05],
    ["Relay north operator wall", "metal", -3.55, -9.75, 0.52, 0.48, 0.58, 5, 5, "industrial", "relay-gauntlet-grid route-operator", 32, -Math.PI * 0.05, -0.04],
    ["Relay north timing tower", "glass", 3.45, -9.72, 0.44, 0.58, 0.46, 5, 4, "glassTower", "relay-gauntlet-grid timing", 34, Math.PI * 0.06, 0.04],
    ["Relay north capacitor lofts", "concrete", 6.85, -9.58, 0.52, 0.52, 0.54, 5, 5, "apartment", "relay-gauntlet-grid capacitor-bank", 34, -Math.PI * 0.05, -0.05],
    ["West route marshal flats", "concrete", -13.35, -5.25, 0.52, 0.5, 0.54, 5, 5, "apartment", "relay-gauntlet-grid route-marshal", 34, Math.PI * 0.5, 0.05],
    ["West phase service row", "metal", -13.45, -3.05, 0.52, 0.46, 0.58, 4, 6, "warehouse", "relay-gauntlet-grid route-operator", 30, Math.PI * 0.5, -0.04],
    ["West traffic bait shops", "foam", -13.3, 0.95, 0.48, 0.38, 0.48, 4, 6, "market", "relay-gauntlet-grid traffic-bait", 26, Math.PI * 0.5, 0.05],
    ["West relay dorms", "wood", -13.15, 3.1, 0.5, 0.42, 0.52, 4, 5, "utility", "relay-gauntlet-grid route-bumper", 28, Math.PI * 0.5, -0.04],
    ["West cashout apartments", "concrete", -13.2, 10.65, 0.5, 0.5, 0.52, 5, 5, "apartment", "relay-gauntlet-grid south-cashout", 34, Math.PI * 0.5, 0.05],
    ["South route marshal block", "foam", -6.15, 11.25, 0.48, 0.38, 0.48, 3, 6, "market", "relay-gauntlet-grid route-bumper", 26, 0, 0.05],
    ["South timing depot", "metal", -2.75, 11.45, 0.52, 0.46, 0.58, 5, 5, "warehouse", "relay-gauntlet-grid timing", 32, 0, -0.04],
    ["South capacitor flats", "concrete", 1.95, 11.55, 0.5, 0.5, 0.52, 5, 4, "apartment", "relay-gauntlet-grid capacitor-bank", 32, 0, 0.05],
    ["South traffic bait kiosk row", "glass", 5.35, 11.3, 0.44, 0.58, 0.46, 4, 6, "glassTower", "relay-gauntlet-grid traffic-bait", 32, 0, -0.04],
    ["South cashout warehouse", "metal", 8.35, 11.0, 0.52, 0.46, 0.58, 4, 6, "warehouse", "relay-gauntlet-grid south-cashout", 30, Math.PI * 0.5, 0.04],
    ["East capacitor offices", "concrete", 13.25, -5.1, 0.52, 0.5, 0.54, 6, 5, "apartment", "relay-gauntlet-grid capacitor-bank", 34, Math.PI * 0.5, -0.05],
    ["East relay glass watch", "glass", 13.45, -2.95, 0.44, 0.58, 0.46, 5, 5, "glassTower", "relay-gauntlet-grid timing", 34, Math.PI * 0.5, 0.04],
    ["East service gantry wall", "metal", 13.35, 1.0, 0.52, 0.46, 0.58, 4, 6, "warehouse", "relay-gauntlet-grid route-operator", 30, Math.PI * 0.5, -0.04],
    ["East traffic bait markets", "foam", 13.2, 3.15, 0.48, 0.38, 0.48, 4, 6, "market", "relay-gauntlet-grid traffic-bait", 26, Math.PI * 0.5, 0.05],
    ["East south relay flats", "concrete", 13.25, 10.55, 0.5, 0.5, 0.52, 5, 5, "apartment", "relay-gauntlet-grid south-cashout", 34, Math.PI * 0.5, -0.05],
    ["Inner route pylon row west", "metal", -6.05, -4.15, 0.5, 0.5, 0.58, 5, 4, "industrial", "relay-gauntlet-grid route-operator", 32, Math.PI * 0.08, 0.04],
    ["Inner timing offices west", "glass", -6.05, -0.25, 0.44, 0.58, 0.46, 4, 5, "glassTower", "relay-gauntlet-grid timing", 32, -Math.PI * 0.08, -0.04],
    ["Inner bumper workshops west", "wood", -5.0, 6.65, 0.5, 0.42, 0.52, 4, 6, "utility", "relay-gauntlet-grid route-bumper", 28, Math.PI * 0.1, 0.05],
    ["Inner capacitor row east", "concrete", 6.05, -4.05, 0.52, 0.52, 0.54, 5, 5, "apartment", "relay-gauntlet-grid capacitor-bank", 34, -Math.PI * 0.08, -0.05],
    ["Inner route service east", "metal", 6.15, -0.1, 0.52, 0.46, 0.58, 4, 5, "warehouse", "relay-gauntlet-grid route-operator", 30, Math.PI * 0.08, 0.04],
    ["Inner south cashout shops", "foam", 5.85, 6.75, 0.48, 0.38, 0.48, 4, 6, "market", "relay-gauntlet-grid south-cashout", 26, -Math.PI * 0.08, -0.04]
  ]);
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

function spawnArchiveBossLens(context: LevelContext, options: BossPhaseReadoutOptions = {}): void {
  const rotationY = -Math.PI * 0.12;
  const base = alignCityObjectToRoadEdges(
    new THREE.Vector3(7.38, 0, -4.52),
    new THREE.Vector3(1.56, 2.62, 1.22),
    rotationY,
    0.32
  );
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
  const support: BossSupportOptions = {
    supportGroupId: "archive-boss-lens-collapse",
    supportReleaseRadius: 4.05,
    supportReleaseHeight: 3.55,
    supportReleaseLowerHeight: 0.82,
    supportReleaseFallDirection: new THREE.Vector3(-0.48, 0, 0.58)
  };
  const coreSize = new THREE.Vector3(1.1, 2.36, 0.78);
  const core = addBossCoreBox(context, {
    label: "Archive boss prism lens",
    materialId: "glass",
    renderMaterial: bossGlassMaterial("archive-prism", 0x93f1ff, 0xff6b93),
    position: bossWorldPosition(base, rotationY, new THREE.Vector3(0, coreSize.y * 0.5, 0)),
    size: coreSize,
    rotation,
    zoneId: "archive-boss glass-depot hazard-relay explosive",
    scoreValue: 1_020,
    kind: "explosive",
    support,
    fractureResistance: 0.3
  });
  decorateBossCore(core, coreSize, "archive");
  addBossArenaMarkers(context, base, rotationY, "archive");

  const weakPoints: BossWeakPointSpec[] = options.phaseReadout
    ? [
        {
          label: "Archive boss phase 1 order seal",
          local: new THREE.Vector3(-0.62, 0.66, 0.46),
          size: new THREE.Vector3(0.3, 0.22, 0.24),
          scoreValue: 280,
          zoneTags: "boss-phase phase-1 order",
          phaseIndex: 1
        },
        {
          label: "Archive boss phase 2 prism latch",
          local: new THREE.Vector3(0.62, 1.34, 0.44),
          size: new THREE.Vector3(0.32, 0.2, 0.24),
          scoreValue: 300,
          zoneTags: "boss-phase phase-2 latch",
          phaseIndex: 2
        },
        {
          label: "Archive boss phase 3 cashout core",
          local: new THREE.Vector3(0, 2.18, -0.45),
          size: new THREE.Vector3(0.36, 0.22, 0.24),
          scoreValue: 320,
          zoneTags: "boss-phase phase-3 core cashout",
          phaseIndex: 3
        }
      ]
    : [
        {
          label: "Archive boss shear pin",
          local: new THREE.Vector3(-0.62, 0.66, 0.46),
          size: new THREE.Vector3(0.3, 0.22, 0.24),
          scoreValue: 280,
          zoneTags: ""
        },
        {
          label: "Archive boss lens latch",
          local: new THREE.Vector3(0.62, 1.34, 0.44),
          size: new THREE.Vector3(0.32, 0.2, 0.24),
          scoreValue: 300,
          zoneTags: ""
        },
        {
          label: "Archive boss support column",
          local: new THREE.Vector3(0, 2.18, -0.45),
          size: new THREE.Vector3(0.36, 0.22, 0.24),
          scoreValue: 320,
          zoneTags: ""
        }
      ];

  for (const weakPoint of weakPoints) {
    addReadableWeakPoint(context, {
      label: weakPoint.label,
      position: bossWorldPosition(base, rotationY, weakPoint.local),
      size: weakPoint.size,
      rotation,
      zoneId: `archive-boss weak-point glass-depot hazard-core${weakPoint.zoneTags ? ` ${weakPoint.zoneTags}` : ""}`,
      scoreValue: weakPoint.scoreValue,
      kind: "explosive",
      support,
      phaseIndex: weakPoint.phaseIndex,
      phaseTheme: "archive"
    });
  }

  addBossRelayCanister(context, {
    label: "Archive boss pressure bulb",
    position: bossWorldPosition(base, rotationY, new THREE.Vector3(0.82, 0.44, -0.14)),
    size: new THREE.Vector3(0.36, 0.68, 0.36),
    rotation,
    zoneId: "archive-boss hazard-relay explosive glass-depot",
    scoreValue: 240,
    kind: "explosive",
    phaseTheme: "archive",
    support
  });
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

function spawnSwitchbackArchiveDensityInfill(context: LevelContext): void {
  const buildings: BuildingSpec[] = [
    {
      label: "Archive side-stack library",
      materialId: "concrete",
      position: new THREE.Vector3(-8.6, 0, -2.45),
      size: new THREE.Vector3(0.5, 0.5, 0.52),
      floors: 5,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "switchback-fill archive-wing",
      scoreValue: 34,
      style: "apartment",
      stagger: -0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Mirror records annex",
      materialId: "glass",
      position: new THREE.Vector3(8.45, 0, -2.75),
      size: new THREE.Vector3(0.44, 0.56, 0.46),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "switchback-fill glass-archive",
      scoreValue: 32,
      style: "glassTower",
      stagger: 0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Foam baffle workshop",
      materialId: "foam",
      position: new THREE.Vector3(-6.9, 0, 5.2),
      size: new THREE.Vector3(0.52, 0.4, 0.54),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "switchback-fill switchback-foam",
      scoreValue: 28,
      style: "market",
      stagger: 0.06,
      rotationY: -Math.PI * 0.08
    },
    {
      label: "Archive service dock",
      materialId: "metal",
      position: new THREE.Vector3(7.75, 0, 4.35),
      size: new THREE.Vector3(0.52, 0.46, 0.58),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "switchback-fill switchback-service",
      scoreValue: 30,
      style: "warehouse",
      stagger: -0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "South archive kiosk row",
      materialId: "wood",
      position: new THREE.Vector3(0.35, 0, 7.35),
      size: new THREE.Vector3(0.5, 0.42, 0.5),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "switchback-fill archive-service",
      scoreValue: 26,
      style: "utility",
      stagger: 0.04
    }
  ];

  for (const building of buildings) {
    spawnCityBuildingStack(context, building);
  }

  for (const [label, materialId, x, z, width, height, depth, rotationY] of [
    ["Archive shelf rack", "wood", -7.25, -0.75, 0.82, 0.5, 0.46, Math.PI * 0.5],
    ["Glass file cabinet", "glass", 7.15, -1.05, 0.48, 0.6, 0.46, -Math.PI * 0.08],
    ["Foam baffle pair", "foam", -4.95, 2.35, 1.02, 0.36, 0.58, Math.PI * 0.24],
    ["Foam baffle pair", "foam", 4.85, 2.05, 1.02, 0.36, 0.58, -Math.PI * 0.2],
    ["Archive service cart", "metal", -1.15, 5.62, 0.74, 0.46, 0.52, Math.PI * 0.12],
    ["Glass return crate", "glass", 2.15, 5.85, 0.52, 0.58, 0.48, -Math.PI * 0.12],
    ["Wood archive pallet", "wood", -6.05, -5.8, 0.78, 0.44, 0.56, Math.PI * 0.16],
    ["Foam corner wedge", "foam", 6.65, 5.75, 0.86, 0.36, 0.56, -Math.PI * 0.18]
  ] as const) {
    addStreetCargo(context, label, materialId, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  for (const [type, label, x, z, width, height, depth, rotationY] of [
    ["shockCanister", "Archive pressure canister", -7.85, 1.65, 0.4, 0.64, 0.4, Math.PI * 0.5],
    ["shockCanister", "Archive lens canister", 7.65, 1.25, 0.4, 0.64, 0.4, -Math.PI * 0.5],
    ["springPad", "Archive service rebound pad", -3.55, 5.35, 0.86, 0.2, 0.6, Math.PI * 0.2]
  ] as const) {
    addHazardRelay(context, type, label, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  addRoutedCityVehicle(context, "Archive records truck", CITY_BELT_TRAFFIC_LOOP, 0.84, 2, 0.52, 0.34, new THREE.Vector3(0.56, 0.44, 0.98), 0xf4f7ff, {
    zoneId: "switchback-crush archive-service moving-vehicles",
    scoreValue: 68,
    detail: "full"
  });
  addRoutedCityVehicle(context, "Switchback foam cart", INNER_BELT_TRAFFIC_LOOP, 0.94, 0, 0.68, 0.28, new THREE.Vector3(0.38, 0.32, 0.72), 0xff6b93, {
    zoneId: "switchback-crush switchback-foam moving-vehicles",
    scoreValue: 46
  });
  addBillboard(context, -7.75, 4.95, 0xff6b93);
  addStreetLight(context, -7.55, -1.15);
  addStreetLight(context, 7.55, -1.35);
  addStreetLight(context, 0.2, 7.45);
}

function spawnSwitchbackGlassCanyon(context: LevelContext): void {
  spawnDenseDistrictBuildingRows(context, [
    ["North archive terrace west", "concrete", -7.05, -9.9, 0.52, 0.52, 0.54, 6, 5, "apartment", "switchback-grid archive-terrace", 34, Math.PI * 0.04, 0.05],
    ["North mirror records tower", "glass", -3.55, -9.72, 0.44, 0.6, 0.46, 6, 5, "glassTower", "switchback-grid glass-canyon", 34, -Math.PI * 0.05, -0.04],
    ["North shelf warehouse", "wood", 3.45, -9.75, 0.5, 0.42, 0.52, 4, 6, "utility", "switchback-grid shelf-row", 28, Math.PI * 0.05, 0.04],
    ["North archive terrace east", "concrete", 6.9, -9.58, 0.52, 0.52, 0.54, 5, 5, "apartment", "switchback-grid archive-terrace", 34, -Math.PI * 0.05, -0.05],
    ["West glass canyon A", "glass", -13.35, -5.15, 0.44, 0.6, 0.46, 6, 5, "glassTower", "switchback-grid glass-canyon", 34, Math.PI * 0.5, 0.05],
    ["West glass canyon B", "glass", -13.45, -3.0, 0.44, 0.58, 0.46, 5, 5, "glassTower", "switchback-grid glass-canyon", 34, Math.PI * 0.5, -0.04],
    ["West archive stacks", "concrete", -13.3, 0.98, 0.52, 0.52, 0.54, 5, 5, "apartment", "switchback-grid archive-wing", 34, Math.PI * 0.5, 0.05],
    ["West foam baffle shops", "foam", -13.15, 3.12, 0.48, 0.38, 0.48, 4, 6, "market", "switchback-grid switchback-foam", 26, Math.PI * 0.5, -0.04],
    ["West south archive flats", "concrete", -13.2, 10.65, 0.5, 0.5, 0.52, 5, 5, "apartment", "switchback-grid archive-service", 34, Math.PI * 0.5, 0.05],
    ["South shelf row A", "wood", -6.25, 11.25, 0.5, 0.42, 0.52, 4, 6, "utility", "switchback-grid shelf-row", 28, 0, 0.05],
    ["South archive terrace", "concrete", -2.8, 11.48, 0.52, 0.52, 0.54, 6, 5, "apartment", "switchback-grid archive-terrace", 34, 0, -0.04],
    ["South mirror office", "glass", 1.95, 11.52, 0.44, 0.58, 0.46, 5, 5, "glassTower", "switchback-grid glass-canyon", 34, 0, 0.05],
    ["South baffle workshops", "foam", 5.35, 11.28, 0.48, 0.38, 0.48, 4, 6, "market", "switchback-grid switchback-foam", 26, 0, -0.04],
    ["South service dock wall", "metal", 8.3, 11.0, 0.52, 0.46, 0.58, 4, 6, "warehouse", "switchback-grid switchback-service", 30, Math.PI * 0.5, 0.04],
    ["East mirror canyon A", "glass", 13.3, -5.08, 0.44, 0.6, 0.46, 6, 5, "glassTower", "switchback-grid glass-canyon", 34, Math.PI * 0.5, -0.05],
    ["East records lofts", "concrete", 13.2, -2.95, 0.52, 0.52, 0.54, 5, 5, "apartment", "switchback-grid archive-wing", 34, Math.PI * 0.5, 0.04],
    ["East service dock row", "metal", 13.35, 0.98, 0.52, 0.46, 0.58, 4, 6, "warehouse", "switchback-grid switchback-service", 30, Math.PI * 0.5, -0.04],
    ["East foam baffle court", "foam", 13.15, 3.12, 0.48, 0.38, 0.48, 4, 6, "market", "switchback-grid switchback-foam", 26, Math.PI * 0.5, 0.05],
    ["East south archive flats", "concrete", 13.25, 10.55, 0.5, 0.5, 0.52, 5, 5, "apartment", "switchback-grid archive-service", 34, Math.PI * 0.5, -0.05],
    ["Inner west library tower", "concrete", -6.1, -4.05, 0.52, 0.52, 0.54, 6, 5, "apartment", "switchback-grid archive-wing", 34, Math.PI * 0.08, 0.05],
    ["Inner west mirror office", "glass", -6.05, -0.25, 0.44, 0.58, 0.46, 5, 5, "glassTower", "switchback-grid glass-canyon", 34, -Math.PI * 0.08, -0.04],
    ["Inner west foam workshop", "foam", -5.0, 6.65, 0.48, 0.38, 0.48, 4, 6, "market", "switchback-grid switchback-foam", 26, Math.PI * 0.1, 0.05],
    ["Inner east mirror tower", "glass", 6.05, -4.05, 0.44, 0.6, 0.46, 6, 5, "glassTower", "switchback-grid glass-canyon", 34, -Math.PI * 0.08, -0.05],
    ["Inner east records depot", "wood", 6.1, -0.1, 0.5, 0.42, 0.52, 4, 6, "utility", "switchback-grid shelf-row", 28, Math.PI * 0.08, 0.04],
    ["Inner service archive flats", "concrete", 5.85, 6.75, 0.52, 0.5, 0.54, 5, 5, "apartment", "switchback-grid archive-service", 34, -Math.PI * 0.08, -0.04],
    ["Mirror return dock", "metal", 9.05, 6.9, 0.52, 0.46, 0.58, 4, 5, "warehouse", "switchback-grid switchback-service", 30, Math.PI * 0.5, 0.04],
    ["Archive file annex", "wood", -9.0, 6.95, 0.5, 0.42, 0.52, 4, 5, "utility", "switchback-grid shelf-row", 28, Math.PI * 0.5, -0.04]
  ]);
}

function spawnOverdriveCoreRoutePaint(context: LevelContext): void {
  for (const [label, x, z, width, depth, color, opacity] of [
    ["Overdrive boss lens entry stripe", 5.4, -6.05, 4.4, 0.38, 0xff6b93, 0.34],
    ["Overdrive right redirect stripe", 7.65, -2.88, 0.42, 4.95, 0xff6b93, 0.32],
    ["Overdrive center rebound stripe", 3.1, -1.18, 5.6, 0.34, 0x93f1ff, 0.3],
    ["Overdrive switchback spine stripe", -0.42, 1.84, 0.42, 4.5, 0x93f1ff, 0.32],
    ["Overdrive left archive crush stripe", -4.6, 3.48, 5.2, 0.34, 0xffd66b, 0.3],
    ["Overdrive pressure bulb cashout stripe", 3.8, 4.82, 4.6, 0.32, 0xff6b93, 0.28]
  ] as const) {
    addPanel(context, label, x, z, width, depth, color, opacity, CITY_GROUND_LAYER_MARKINGS + 1);
  }
}

function spawnOverdriveCoreSetpieces(context: LevelContext): void {
  for (const [type, label, x, z, width, height, depth, rotationY] of [
    ["springPad", "Overdrive prism redirect pad", 6.15, -3.12, 0.98, 0.22, 0.66, -Math.PI * 0.18],
    ["springPad", "Overdrive center rebound pad", 0.82, 1.85, 0.98, 0.22, 0.66, Math.PI * 0.16],
    ["springPad", "Overdrive archive crush pad", -4.25, 3.36, 0.98, 0.22, 0.66, Math.PI * 0.24],
    ["shockCanister", "Overdrive right pressure bulb", 6.95, -0.02, 0.42, 0.72, 0.42, -Math.PI * 0.5],
    ["shockCanister", "Overdrive left pressure bulb", -5.75, 1.78, 0.42, 0.72, 0.42, Math.PI * 0.5],
    ["transformer", "Overdrive breaker relay coupler", 2.38, 3.26, 0.58, 0.78, 0.48, -Math.PI * 0.1]
  ] as const) {
    addHazardRelay(context, type, label, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  for (const [label, materialId, x, z, width, height, depth, rotationY] of [
    ["Overdrive glass prism shard rack", "glass", 5.35, -3.84, 0.74, 0.58, 0.44, -Math.PI * 0.16],
    ["Overdrive foam redirect bumper", "foam", 3.35, -0.12, 1.12, 0.36, 0.58, Math.PI * 0.08],
    ["Overdrive archive data pallet", "metal", -1.92, 2.96, 0.86, 0.5, 0.48, -Math.PI * 0.12],
    ["Overdrive glass cascade crate", "glass", -6.42, 3.1, 0.58, 0.58, 0.5, Math.PI * 0.18],
    ["Overdrive foam dead-stop bumper", "foam", 4.95, 3.7, 0.94, 0.36, 0.58, -Math.PI * 0.18],
    ["Overdrive pressure cable", "rubber", 2.9, 4.0, 2.8, 0.08, 0.08, Math.PI * 0.5]
  ] as const) {
    addStreetCargo(context, label, materialId, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  addStrategicHazardBox(context, {
    label: "Overdrive archive prism crown",
    materialId: "glass",
    position: new THREE.Vector3(6.48, 0.82, -4.04),
    size: new THREE.Vector3(0.48, 1.64, 0.38),
    zoneId: "archive-boss weak-point glass-depot explosive",
    scoreValue: 420,
    kind: "explosive",
    rotationY: -Math.PI * 0.12,
    fractureResistance: 0.12,
    showReadableMarker: true
  });
  addStrategicHazardBox(context, {
    label: "Overdrive pressure bulb cluster",
    materialId: "glass",
    position: new THREE.Vector3(7.08, 0.4, -3.38),
    size: new THREE.Vector3(0.58, 0.8, 0.42),
    zoneId: "archive-boss pressure-bulb hazard-relay explosive",
    scoreValue: 330,
    kind: "explosive",
    rotationY: Math.PI * 0.08,
    fractureResistance: 0.1,
    showReadableMarker: true
  });
  addStrategicHazardBox(context, {
    label: "Overdrive archive ballast fuse",
    materialId: "metal",
    position: new THREE.Vector3(4.12, 0.34, -4.1),
    size: new THREE.Vector3(0.42, 0.68, 0.36),
    zoneId: "archive-boss pressure-bulb power-grid",
    scoreValue: 240,
    kind: "electric",
    fractureResistance: 0.16,
    showReadableMarker: true
  });

  addBillboard(context, 5.0, -5.92, 0xff6b93);
  addBillboard(context, -4.7, 3.92, 0x93f1ff);
  addBillboard(context, 2.4, 4.22, 0xffd66b);
}

function spawnOverdriveCoreTraffic(context: LevelContext): void {
  addRoutedCityVehicle(context, "Overdrive archive tanker", BATTERY_TRAFFIC_LOOP, 0.78, 0, 0.62, 0.36, new THREE.Vector3(0.54, 0.44, 1.18), 0xffd66b, {
    zoneId: "overdrive-core fuel pressure-bulb moving-vehicles",
    scoreValue: 300,
    hazardKind: "combustible",
    detail: "full"
  });
  addRoutedCityVehicle(context, "Overdrive prism bus", CENTRAL_TRAFFIC_LOOP, 0.72, 2, 0.48, 0.38, new THREE.Vector3(0.62, 0.5, 1.18), 0xff6b93, {
    zoneId: "overdrive-core glass-depot moving-vehicles",
    scoreValue: 88,
    detail: "full"
  });
  addRoutedCityVehicle(context, "Overdrive archive van", CITY_BELT_TRAFFIC_LOOP, 0.88, 1, 0.42, 0.34, new THREE.Vector3(0.56, 0.44, 0.98), 0x93f1ff, {
    zoneId: "overdrive-core switchback-service moving-vehicles",
    scoreValue: 64,
    detail: "full"
  });
  addRoutedCityVehicle(context, "Overdrive courier shard", CENTRAL_TRAFFIC_LOOP_OPPOSITE, 1.26, 3, 0.28, 0.27, new THREE.Vector3(0.36, 0.31, 0.68), 0xff8f38, {
    zoneId: "overdrive-core switchback-service moving-vehicles",
    scoreValue: 46
  });
}

function spawnOverdriveCoreDensityInfill(context: LevelContext): void {
  const buildings: BuildingSpec[] = [
    {
      label: "Prism service tower",
      materialId: "glass",
      position: new THREE.Vector3(8.95, 0, -1.45),
      size: new THREE.Vector3(0.46, 0.58, 0.48),
      floors: 5,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "overdrive-core-fill prism-service",
      scoreValue: 34,
      style: "glassTower",
      stagger: 0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Left archive ballast wing",
      materialId: "concrete",
      position: new THREE.Vector3(-8.75, 0, 1.15),
      size: new THREE.Vector3(0.52, 0.52, 0.54),
      floors: 5,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "overdrive-core-fill archive-boss",
      scoreValue: 34,
      style: "apartment",
      stagger: -0.05,
      rotationY: Math.PI * 0.5
    },
    {
      label: "Pressure bulb pump house",
      materialId: "metal",
      position: new THREE.Vector3(6.85, 0, 6.05),
      size: new THREE.Vector3(0.52, 0.46, 0.58),
      floors: 4,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "overdrive-core-fill pressure-bulb",
      scoreValue: 32,
      style: "warehouse",
      stagger: 0.04,
      rotationY: -Math.PI * 0.08
    },
    {
      label: "Mirror baffle station",
      materialId: "foam",
      position: new THREE.Vector3(-5.95, 0, 5.6),
      size: new THREE.Vector3(0.52, 0.4, 0.52),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "overdrive-core-fill mirror-baffle",
      scoreValue: 28,
      style: "market",
      stagger: -0.04,
      rotationY: Math.PI * 0.12
    },
    {
      label: "Center rebound kiosk",
      materialId: "wood",
      position: new THREE.Vector3(-0.75, 0, 6.85),
      size: new THREE.Vector3(0.5, 0.42, 0.5),
      floors: 3,
      columns: 5,
      scoreRole: "neutral",
      zoneId: "overdrive-core-fill center-rebound",
      scoreValue: 26,
      style: "utility",
      stagger: 0.04
    }
  ];

  for (const building of buildings) {
    spawnCityBuildingStack(context, building);
  }

  for (const [label, materialId, x, z, width, height, depth, rotationY] of [
    ["Overdrive prism service rack", "glass", 7.72, -1.25, 0.58, 0.64, 0.46, -Math.PI * 0.1],
    ["Overdrive mirror bumper", "foam", 6.55, 1.75, 1.02, 0.36, 0.58, -Math.PI * 0.2],
    ["Overdrive mirror bumper", "foam", -5.85, 2.95, 1.02, 0.36, 0.58, Math.PI * 0.22],
    ["Pressure bulb service cart", "metal", 5.55, 5.58, 0.78, 0.48, 0.52, Math.PI * 0.14],
    ["Archive prism crate", "glass", -6.95, 4.65, 0.54, 0.6, 0.5, -Math.PI * 0.16],
    ["Center rebound cable coil", "rubber", 0.58, 5.55, 1.35, 0.12, 0.14, Math.PI * 0.5],
    ["Archive ballast pallet", "wood", -7.85, -1.25, 0.82, 0.44, 0.56, Math.PI * 0.5],
    ["Prism shard crate", "glass", 3.25, -5.92, 0.52, 0.58, 0.48, Math.PI * 0.08]
  ] as const) {
    addStreetCargo(context, label, materialId, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  for (const [type, label, x, z, width, height, depth, rotationY] of [
    ["shockCanister", "Overdrive pressure reserve bulb", 8.05, 2.78, 0.4, 0.68, 0.4, -Math.PI * 0.5],
    ["shockCanister", "Overdrive mirror reserve bulb", -7.25, 2.48, 0.4, 0.68, 0.4, Math.PI * 0.5],
    ["transformer", "Overdrive route stabilizer", 1.25, 4.6, 0.54, 0.76, 0.46, -Math.PI * 0.08]
  ] as const) {
    addHazardRelay(context, type, label, new THREE.Vector3(x, height * 0.5, z), new THREE.Vector3(width, height, depth), rotationY);
  }

  addRoutedCityVehicle(context, "Overdrive pressure flatbed", BATTERY_TRAFFIC_LOOP_OPPOSITE, 0.82, 3, 0.58, 0.32, new THREE.Vector3(0.52, 0.38, 0.98), 0xffd66b, {
    zoneId: "overdrive-core pressure-bulb moving-vehicles",
    scoreValue: 82,
    hazardKind: "combustible",
    detail: "full"
  });
  addRoutedCityVehicle(context, "Overdrive mirror taxi", INNER_BELT_TRAFFIC_LOOP, 1.14, 1, 0.36, 0.28, new THREE.Vector3(0.38, 0.32, 0.72), 0xffc241, {
    zoneId: "overdrive-core mirror-baffle moving-vehicles",
    scoreValue: 46
  });
  addBillboard(context, 8.45, 1.8, 0xff6b93);
  addBillboard(context, -7.95, 4.05, 0x93f1ff);
  addStreetLight(context, 6.5, 5.75);
  addStreetLight(context, -6.45, 5.05);
  addStreetLight(context, 0.95, 5.65);
}

function spawnOverdriveFinalBowlDensity(context: LevelContext): void {
  spawnDenseDistrictBuildingRows(context, [
    ["North prism ballast flats", "concrete", -7.05, -9.9, 0.52, 0.52, 0.54, 6, 5, "apartment", "overdrive-grid prism-ballast", 34, Math.PI * 0.04, 0.05],
    ["North prism shard tower", "glass", -3.55, -9.72, 0.44, 0.6, 0.46, 6, 5, "glassTower", "overdrive-grid prism-shard", 34, -Math.PI * 0.05, -0.04],
    ["North pressure service wall", "metal", 3.45, -9.75, 0.52, 0.46, 0.58, 5, 5, "industrial", "overdrive-grid pressure-service", 32, Math.PI * 0.05, 0.04],
    ["North archive ballast east", "concrete", 6.9, -9.58, 0.52, 0.52, 0.54, 5, 5, "apartment", "overdrive-grid archive-ballast", 34, -Math.PI * 0.05, -0.05],
    ["West mirror housing A", "concrete", -13.35, -5.15, 0.52, 0.5, 0.54, 5, 5, "apartment", "overdrive-grid mirror-neighborhood", 34, Math.PI * 0.5, 0.05],
    ["West mirror baffle tower", "foam", -13.45, -3.0, 0.48, 0.38, 0.48, 5, 6, "market", "overdrive-grid mirror-baffle", 26, Math.PI * 0.5, -0.04],
    ["West archive ballast", "concrete", -13.3, 0.98, 0.52, 0.52, 0.54, 6, 5, "apartment", "overdrive-grid archive-ballast", 34, Math.PI * 0.5, 0.05],
    ["West pressure workshop", "metal", -13.15, 3.12, 0.52, 0.46, 0.58, 4, 6, "warehouse", "overdrive-grid pressure-service", 30, Math.PI * 0.5, -0.04],
    ["West final bowl flats", "concrete", -13.2, 10.65, 0.5, 0.5, 0.52, 5, 5, "apartment", "overdrive-grid final-bowl", 34, Math.PI * 0.5, 0.05],
    ["South mirror baffle shops", "foam", -6.25, 11.25, 0.48, 0.38, 0.48, 4, 6, "market", "overdrive-grid mirror-baffle", 26, 0, 0.05],
    ["South archive ballast flats", "concrete", -2.8, 11.48, 0.52, 0.52, 0.54, 6, 5, "apartment", "overdrive-grid archive-ballast", 34, 0, -0.04],
    ["South prism service glass", "glass", 1.95, 11.52, 0.44, 0.58, 0.46, 5, 5, "glassTower", "overdrive-grid prism-shard", 34, 0, 0.05],
    ["South pressure pump row", "metal", 5.35, 11.28, 0.52, 0.46, 0.58, 4, 6, "warehouse", "overdrive-grid pressure-service", 30, 0, -0.04],
    ["South final bowl depots", "wood", 8.3, 11.0, 0.5, 0.42, 0.52, 4, 6, "utility", "overdrive-grid final-bowl", 28, Math.PI * 0.5, 0.04],
    ["East prism shard tower", "glass", 13.3, -5.08, 0.44, 0.6, 0.46, 6, 5, "glassTower", "overdrive-grid prism-shard", 34, Math.PI * 0.5, -0.05],
    ["East archive ballast flats", "concrete", 13.2, -2.95, 0.52, 0.52, 0.54, 5, 5, "apartment", "overdrive-grid archive-ballast", 34, Math.PI * 0.5, 0.04],
    ["East pressure pump house", "metal", 13.35, 0.98, 0.52, 0.46, 0.58, 4, 6, "warehouse", "overdrive-grid pressure-service", 30, Math.PI * 0.5, -0.04],
    ["East mirror bumper shops", "foam", 13.15, 3.12, 0.48, 0.38, 0.48, 4, 6, "market", "overdrive-grid mirror-baffle", 26, Math.PI * 0.5, 0.05],
    ["East final bowl flats", "concrete", 13.25, 10.55, 0.5, 0.5, 0.52, 5, 5, "apartment", "overdrive-grid final-bowl", 34, Math.PI * 0.5, -0.05],
    ["Inner prism service tower", "glass", -6.1, -4.05, 0.44, 0.6, 0.46, 6, 5, "glassTower", "overdrive-grid prism-shard", 34, Math.PI * 0.08, 0.05],
    ["Inner mirror ballast west", "concrete", -6.05, -0.25, 0.52, 0.52, 0.54, 5, 5, "apartment", "overdrive-grid mirror-neighborhood", 34, -Math.PI * 0.08, -0.04],
    ["Inner mirror baffle west", "foam", -5.0, 6.65, 0.48, 0.38, 0.48, 4, 6, "market", "overdrive-grid mirror-baffle", 26, Math.PI * 0.1, 0.05],
    ["Inner prism service east", "glass", 6.05, -4.05, 0.44, 0.6, 0.46, 6, 5, "glassTower", "overdrive-grid prism-shard", 34, -Math.PI * 0.08, -0.05],
    ["Inner pressure workshop east", "metal", 6.1, -0.1, 0.52, 0.46, 0.58, 4, 6, "warehouse", "overdrive-grid pressure-service", 30, Math.PI * 0.08, 0.04],
    ["Inner archive final flats", "concrete", 5.85, 6.75, 0.52, 0.5, 0.54, 5, 5, "apartment", "overdrive-grid final-bowl", 34, -Math.PI * 0.08, -0.04],
    ["Outer pressure bulb offices", "glass", 9.0, 6.9, 0.44, 0.58, 0.46, 4, 5, "glassTower", "overdrive-grid pressure-service", 32, Math.PI * 0.5, 0.04],
    ["Outer archive ballast stores", "wood", -9.0, 6.95, 0.5, 0.42, 0.52, 4, 5, "utility", "overdrive-grid archive-ballast", 28, Math.PI * 0.5, -0.04]
  ]);
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
      size: new THREE.Vector3(0.54, 0.64, 0.58),
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
      size: new THREE.Vector3(0.45, 0.78, 0.46),
      floors: 6,
      columns: 4,
      scoreRole: "target",
      zoneId: "hazard-core",
      scoreValue: 86,
      style: "glassTower",
      brand: "hexxon",
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
      size: new THREE.Vector3(0.42, 0.8, 0.42),
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
    },
    {
      label: "Pear Systems tower",
      materialId: "glass",
      position: new THREE.Vector3(8.9, 0, -6.25),
      size: new THREE.Vector3(0.5, 0.84, 0.5),
      floors: 10,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "brand-district tech-row",
      scoreValue: 44,
      style: "glassTower",
      brand: "pear",
      stagger: 0.03,
      rotationY: -Math.PI * 0.035
    },
    {
      label: "Omnitech headquarters",
      materialId: "concrete",
      position: new THREE.Vector3(-8.95, 0, -6.65),
      size: new THREE.Vector3(0.62, 0.74, 0.6),
      floors: 10,
      columns: 4,
      scoreRole: "neutral",
      zoneId: "brand-district civic-row",
      scoreValue: 43,
      style: "civic",
      brand: "omnitech",
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
      size: new THREE.Vector3(0.48, 0.72, 0.52),
      floors: 8,
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
      size: new THREE.Vector3(0.44, 0.82, 0.46),
      floors: 8,
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
      size: new THREE.Vector3(0.54, 0.68, 0.58),
      floors: 8,
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
      size: new THREE.Vector3(0.5, 0.66, 0.54),
      floors: 8,
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
    zoneId: "gas-station canopy",
    scoreValue: 420,
    kind: "combustible",
    rotationY: -Math.PI * 0.04
  });
  for (const [x, z, rotationY] of [
    [5.78, 2.74, -Math.PI * 0.02],
    [6.58, 2.78, Math.PI * 0.03]
  ] as const) {
    addStrategicHazardBox(context, {
      label: "Gas line conduit",
      materialId: "metal",
      position: new THREE.Vector3(x, 0.18, z),
      size: new THREE.Vector3(0.72, 0.24, 0.18),
      zoneId: "gas-station gas-line",
      scoreValue: 145,
      kind: "explosive",
      rotationY
    });
  }
  for (const [x, showReadableMarker] of [
    [5.55, false],
    [6.15, true],
    [6.75, false]
  ] as const) {
    addStrategicHazardBox(context, {
      label: "Gas pump release valve weak point",
      materialId: "rubber",
      position: new THREE.Vector3(x, 0.32, 3.2),
      size: new THREE.Vector3(0.22, 0.64, 0.26),
      zoneId: "gas-station fuel-pump gas-line weak-point release",
      scoreValue: 190,
      kind: "combustible",
      fractureResistance: 0.2,
      showReadableMarker
    });
  }
}

function spawnMayhemSpecialSetpieces(context: LevelContext): void {
  spawnNuclearPlant(context);
  spawnElectricSubstation(context);
  spawnPropaneDepot(context);
  spawnParkingSilo(context);
  spawnElevatedMetro(context);
  spawnCentralSkyneedle(context);
}

function spawnNuclearPlant(context: LevelContext): void {
  const base = alignCityObjectToRoadEdges(new THREE.Vector3(-4.92, 0, -7.95), new THREE.Vector3(2.45, 2.25, 1.85), -Math.PI * 0.04);
  addStrategicHazardBox(context, {
    label: "Nuclear plant reactor core",
    materialId: "metal",
    position: new THREE.Vector3(base.x, 0.78, base.z),
    size: new THREE.Vector3(1.25, 1.56, 1.02),
    zoneId: "nuclear-plant energy-plant reactor volatile",
    scoreValue: 980,
    kind: "explosive",
    rotationY: -Math.PI * 0.04
  });
  addStrategicHazardBox(context, {
    label: "Nuclear plant turbine hall",
    materialId: "concrete",
    position: new THREE.Vector3(base.x - 1.0, 0.54, base.z + 0.64),
    size: new THREE.Vector3(1.26, 1.08, 0.78),
    zoneId: "nuclear-plant turbine-hall power-grid",
    scoreValue: 520,
    kind: "electric",
    rotationY: -Math.PI * 0.04
  });
  for (const [offsetX, offsetZ, scale] of [
    [0.95, -0.58, 1],
    [1.56, 0.52, 0.82]
  ] as const) {
    const tower = context.physics.addDynamicBox({
      label: "Nuclear plant cooling tower",
      material: context.materials.get("concrete"),
      renderMaterial: sharedLevelMaterial(
        "nuclear-plant-cooling-tower",
        () => new THREE.MeshStandardMaterial({ color: 0xa8a69b, roughness: 0.92, metalness: 0.02, map: materialAtlasTile(15) })
      ),
      position: new THREE.Vector3(base.x + offsetX, 0.58 * scale, base.z + offsetZ),
      size: new THREE.Vector3(0.58 * scale, 1.16 * scale, 0.58 * scale),
      category: "structure",
      scoreRole: "target",
      zoneId: "nuclear-plant cooling-tower",
      canFracture: true,
      destructible: true,
      bodyType: "fixed",
      chainSource: true,
      fractureResistance: 0.92,
      scoreValue: Math.round(340 * scale)
    });
    tower.mesh.userData.disposeMaterial = false;
    decorateHazardIndicator(tower.mesh, { size: tower.dimensions, kind: "explosive" });
    decorateStrategicHazard(tower.mesh, { label: tower.label, size: tower.dimensions, kind: "explosive" });
  }
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
  for (const [x, z, rotationY, showReadableMarker] of [
    [-7.5, -4.42, Math.PI * 0.08, false],
    [-6.55, -4.45, -Math.PI * 0.08, true],
    [-7.08, -5.98, Math.PI * 0.5, false]
  ] as const) {
    addStrategicHazardBox(context, {
      label: "Electric substation breaker rack latch weak point",
      materialId: "glass",
      position: new THREE.Vector3(x, 0.39, z),
      size: new THREE.Vector3(0.36, 0.78, 0.34),
      zoneId: "electric-substation power-grid weak-point release",
      scoreValue: 245,
      kind: "electric",
      rotationY,
      fractureResistance: 0.18,
      showReadableMarker
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
  const supportGroupId = "parking-silo-pancake-collapse";
  const supportReleaseFallDirection = new THREE.Vector3(-0.36, 0, 0.72);
  for (const [offsetX, offsetZ] of [
    [-0.98, -0.68],
    [0.98, -0.68],
    [-0.98, 0.68],
    [0.98, 0.68]
  ] as const) {
    const local = new THREE.Vector3(offsetX, 0, offsetZ).applyQuaternion(rotation);
    const size = new THREE.Vector3(0.16, 1.88, 0.16);
    const object = context.physics.addDynamicBox({
      label: "Parking silo support column weak point",
      material,
      renderMaterial,
      position: new THREE.Vector3(base.x + local.x, 1.02, base.z + local.z),
      size,
      rotation,
      category: "structure",
      scoreRole: "target",
      zoneId: "parking-silo parking-garage moving-vehicles weak-point support-column",
      supportGroupId,
      supportReleaseRadius: 3.25,
      supportReleaseHeight: 3.1,
      supportReleaseLowerHeight: 0.72,
      supportReleaseFallDirection,
      supportReleaseImpulseScale: 1.12,
      supportReleaseTorqueScale: 1.24,
      supportReleaseMassScale: 0.72,
      canFracture: true,
      destructible: true,
      bodyType: "fixed",
      chainSource: true,
      fractureResistance: 0.2,
      scoreValue: 240
    });
    decorateHazardIndicator(object.mesh, { size, kind: "combustible" });
    if (offsetX < 0 && offsetZ > 0) {
      decorateReadableWeakPointMarker(object.mesh, size, "parking");
    }
    object.mesh.userData.disposeMaterial = shouldDisposeRenderMaterial(object.mesh.material);
  }

  for (let deck = 0; deck < 4; deck += 1) {
    const size = new THREE.Vector3(2.28, 0.16, 1.68);
    const object = context.physics.addDynamicBox({
      label: deck === 3 ? "Parking silo roof deck signature slab" : "Parking silo pancake collapse deck",
      material,
      renderMaterial,
      position: new THREE.Vector3(base.x, 0.62 + deck * 0.42, base.z),
      size,
      rotation,
      category: "structure",
      scoreRole: "target",
      zoneId: deck === 3 ? "parking-silo parking-garage moving-vehicles signature-debris" : "parking-silo parking-garage moving-vehicles collapse-deck",
      supportGroupId,
      supportReleaseRadius: 3.45,
      supportReleaseHeight: 3.1,
      supportReleaseLowerHeight: 0.72,
      supportReleaseFallDirection,
      supportReleaseImpulseScale: 0.92,
      supportReleaseTorqueScale: 1.04,
      supportReleaseMassScale: deck === 3 ? 2.2 : 1.65,
      canFracture: true,
      destructible: true,
      bodyType: "fixed",
      chainSource: true,
      fractureResistance: deck === 3 ? 0.34 : 0.48,
      scoreValue: deck === 3 ? 340 : 260
    });
    decorateHazardIndicator(object.mesh, { size, kind: "combustible" });
    decorateStrategicHazard(object.mesh, { label: object.label, size, kind: "combustible" });
    if (deck === 3) {
      decorateSignatureDebrisMarker(object.mesh, size, "parking");
    }
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
  addMetroInstancedBoxes(
    group,
    "elevated metro rail batch",
    isEastWest
      ? sharedLevelBoxGeometry(railLength, railThickness, railThickness)
      : sharedLevelBoxGeometry(railThickness, railThickness, railLength),
    railMaterial,
    [
      new THREE.Vector3(isEastWest ? 0 : -railGauge, deckSize.y * 0.74, isEastWest ? -railGauge : 0),
      new THREE.Vector3(isEastWest ? 0 : railGauge, deckSize.y * 0.74, isEastWest ? railGauge : 0)
    ],
    true
  );

  const sleeperCount = Math.min(14, Math.max(6, Math.floor(railLength / 2.1)));
  const sleeperPositions: THREE.Vector3[] = [];
  for (let index = 0; index < sleeperCount; index += 1) {
    const t = sleeperCount === 1 ? 0.5 : index / (sleeperCount - 1);
    const along = THREE.MathUtils.lerp(-railLength * 0.44, railLength * 0.44, t);
    sleeperPositions.push(new THREE.Vector3(isEastWest ? along : 0, deckSize.y * 0.68, isEastWest ? 0 : along));
  }
  addMetroInstancedBoxes(
    group,
    "elevated metro sleeper batch",
    isEastWest ? sharedLevelBoxGeometry(0.09, 0.045, 0.68) : sharedLevelBoxGeometry(0.68, 0.045, 0.09),
    sleeperMaterial,
    sleeperPositions
  );

  context.addDecoration(group);
}

function addMetroInstancedBoxes(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BoxGeometry,
  material: THREE.Material,
  positions: readonly THREE.Vector3[],
  castShadow = false
): void {
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = false;
  mesh.userData.disposeMaterial = false;
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < positions.length; index += 1) {
    matrix.makeTranslation(positions[index].x, positions[index].y, positions[index].z);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
}

function spawnCentralSkyneedle(context: LevelContext): void {
  const supportGroupId = "central-skyneedle-collapse";
  const zoneId = "central-skyneedle hazard-core tower-collapse";
  const base = new THREE.Vector3(5.82, 0, -4.18);
  const rotationY = -Math.PI * 0.055;
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
  const fallDirection = new THREE.Vector3(-0.58, 0, 0.82);
  const skyneedleSupportRelease = {
    supportGroupId,
    supportReleaseRadius: 4.45,
    supportReleaseHeight: 14.2,
    supportReleaseLowerHeight: 13.8,
    supportReleaseFallDirection: fallDirection
  };
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
        map: materialAtlasTile(8),
        envMapIntensity: 1.25
      })
  );
  const towerMetalRenderMaterial = sharedLevelMaterial(
    "central-skyneedle-metal",
    () => new THREE.MeshStandardMaterial({ color: 0x90a7ad, roughness: 0.34, metalness: 0.64, map: materialAtlasTile(10), envMapIntensity: 1.08 })
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
    ...skyneedleSupportRelease,
    supportReleaseImpulseScale: 1.05,
    supportReleaseTorqueScale: 1.08,
    supportReleaseMassScale: 1.35,
    fractureResistance: 0.82,
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
      canFracture: true,
      destructible: true,
      bodyType: "dynamic",
      chainSource: true,
      ...skyneedleSupportRelease,
      supportReleaseImpulseScale: 0.95,
      supportReleaseTorqueScale: 0.98,
      supportReleaseMassScale: 1.25,
      fractureResistance: 0.92,
      sleeping: true,
      linearDamping: 0.74,
      angularDamping: 1.16,
      additionalMass: size.x * size.y * size.z * 4.6,
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
  const towerTiers = [
    { height: 1.18, width: 1.42, depth: 1.26, material: metalMaterial, renderMaterial: towerMetalRenderMaterial, materialId: "metal" as const },
    { height: 1.16, width: 1.26, depth: 1.12, material: glassMaterial, renderMaterial: towerGlassRenderMaterial, materialId: "glass" as const },
    { height: 1.12, width: 1.08, depth: 0.96, material: glassMaterial, renderMaterial: towerGlassRenderMaterial, materialId: "glass" as const },
    { height: 1.04, width: 0.92, depth: 0.8, material: metalMaterial, renderMaterial: towerMetalRenderMaterial, materialId: "metal" as const },
    { height: 0.98, width: 0.76, depth: 0.66, material: glassMaterial, renderMaterial: towerGlassRenderMaterial, materialId: "glass" as const },
    { height: 0.9, width: 0.6, depth: 0.52, material: glassMaterial, renderMaterial: towerGlassRenderMaterial, materialId: "glass" as const },
    { height: 0.78, width: 0.46, depth: 0.4, material: metalMaterial, renderMaterial: towerMetalRenderMaterial, materialId: "metal" as const }
  ];
  for (const [index, tier] of towerTiers.entries()) {
    const { height, width, depth, material, renderMaterial, materialId } = tier;
    const size = new THREE.Vector3(width, height, depth);
    const isCrownTier = index === towerTiers.length - 1;
    const isSignatureTier = index >= towerTiers.length - 3;
    const section = context.physics.addDynamicBox({
      label: isCrownTier
        ? "Central skyneedle crown release weak point"
        : isSignatureTier
          ? "Central skyneedle signature glass shard"
          : "Central skyneedle taper tier",
      material,
      renderMaterial,
      position: new THREE.Vector3(base.x, yBase + height * 0.5, base.z),
      size,
      rotation,
      category: "structure",
      scoreRole: "target",
      zoneId: isCrownTier ? `${zoneId} weak-point release signature-debris` : isSignatureTier ? `${zoneId} signature-debris` : zoneId,
      canFracture: true,
      destructible: true,
      bodyType: "dynamic",
      chainSource: true,
      ...skyneedleSupportRelease,
      supportReleaseMassScale: 1.2,
      supportReleaseImpulseScale: 1 + index * 0.08,
      supportReleaseTorqueScale: 0.9 + index * 0.08,
      fractureResistance: isCrownTier ? 0.2 : materialId === "glass" ? 0.26 : 0.58,
      sleeping: true,
      linearDamping: 0.52,
      angularDamping: 0.78,
      additionalMass: size.x * size.y * size.z * (materialId === "glass" ? 1.05 : 4.1),
      ccd: materialId !== "glass",
      scoreValue: isCrownTier ? 520 : isSignatureTier ? 360 : 320
    });
    decorateBuildingCell(section.mesh, {
      size,
      materialId,
      scoreRole: "target",
      style: "glassTower",
      floor: index,
      column: 0,
      floors: towerTiers.length,
      columns: 1
    });
    if (isCrownTier) {
      decorateReadableWeakPointMarker(section.mesh, size, "skyneedle");
    }
    section.mesh.userData.disposeMaterial = false;
    yBase += height;
  }

  const spireSize = new THREE.Vector3(0.18, 2.45, 0.18);
  const spire = context.physics.addDynamicBox({
    label: "Central skyneedle antenna spear signature debris",
    material: metalMaterial,
    renderMaterial: towerMetalRenderMaterial,
    position: new THREE.Vector3(base.x, yBase + spireSize.y * 0.5, base.z),
    size: spireSize,
    rotation,
    category: "structure",
    scoreRole: "target",
    zoneId: `${zoneId} signature-debris`,
    canFracture: true,
    destructible: true,
    bodyType: "dynamic",
    chainSource: true,
    ...skyneedleSupportRelease,
    supportReleaseMassScale: 0.82,
    supportReleaseImpulseScale: 1.28,
    supportReleaseTorqueScale: 1.24,
    fractureResistance: 0.52,
    sleeping: true,
    linearDamping: 0.56,
    angularDamping: 0.92,
    additionalMass: 0.55,
    ccd: true,
    scoreValue: 320
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
    fractureResistance?: number;
    showReadableMarker?: boolean;
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
    fractureResistance: options.fractureResistance,
    scoreValue: options.scoreValue,
    chainSource: true,
    restitution: options.kind === "combustible" ? 0.18 : 0.1,
    linearDamping: 0.1,
    angularDamping: 0.22,
    ccd: false
  });
  decorateHazardIndicator(object.mesh, { size: options.size, kind: options.kind });
  decorateStrategicHazard(object.mesh, { label: options.label, size: options.size, kind: options.kind });
  if (options.showReadableMarker ?? isReadableWeakPoint(options.label, options.zoneId)) {
    decorateReadableWeakPointMarker(object.mesh, options.size, options.kind === "electric" ? "electric" : "hazard");
  }
  object.mesh.userData.disposeMaterial = shouldDisposeRenderMaterial(object.mesh.material);
}

type ReadableWeakPointTheme = "electric" | "hazard" | "parking" | "skyneedle";
type SignatureDebrisTheme = "parking" | "skyneedle";

function isReadableWeakPoint(label: string, zoneId: string): boolean {
  const text = `${label} ${zoneId}`.toLowerCase();
  return (
    text.includes("weak-point") ||
    text.includes("weak point") ||
    text.includes("release") ||
    text.includes("latch") ||
    text.includes("shear pin") ||
    text.includes("support-column") ||
    text.includes("support column")
  );
}

function decorateReadableWeakPointMarker(mesh: THREE.Mesh, size: THREE.Vector3, theme: ReadableWeakPointTheme): void {
  const accent = readableWeakPointAccent(theme);
  const marker = setpieceAccentMaterial(`weak-point:${theme}`, accent);
  const frontZ = size.z * 0.5 + 0.026;
  const width = THREE.MathUtils.clamp(size.x * 0.62, 0.12, 0.64);
  const bandHeight = THREE.MathUtils.clamp(size.y * 0.07, 0.035, 0.09);

  const band = new THREE.Mesh(sharedLevelBoxGeometry(width, bandHeight, 0.032), marker);
  band.name = `${mesh.name || "setpiece"} readable weak point band`;
  band.position.set(0, size.y * 0.1, frontZ);
  band.userData.disposeMaterial = false;
  mesh.add(band);
}

function decorateSignatureDebrisMarker(mesh: THREE.Mesh, size: THREE.Vector3, theme: SignatureDebrisTheme): void {
  const accent = theme === "skyneedle" ? 0x9bf7ff : 0xffc241;
  const stripeMaterial = setpieceGlowMaterial(`signature-debris:${theme}`, accent, theme === "skyneedle" ? 0.54 : 0.46);
  const frontZ = size.z * 0.5 + 0.024;
  const stripeWidth = THREE.MathUtils.clamp(size.x * 0.72, 0.12, 0.92);
  const stripe = new THREE.Mesh(sharedLevelBoxGeometry(stripeWidth, 0.034, 0.028), stripeMaterial);
  stripe.name = `${mesh.name || "setpiece"} signature debris stripe`;
  stripe.position.set(0, size.y * 0.23, frontZ);
  stripe.userData.disposeMaterial = false;
  mesh.add(stripe);
}

function readableWeakPointAccent(theme: ReadableWeakPointTheme): THREE.ColorRepresentation {
  switch (theme) {
    case "electric":
      return 0x5de7ff;
    case "parking":
      return 0xffc241;
    case "skyneedle":
      return 0x9bf7ff;
    case "hazard":
      return 0xff7048;
  }
}

function setpieceAccentMaterial(key: string, color: THREE.ColorRepresentation): THREE.Material {
  return sharedLevelMaterial(
    `setpiece-accent:${key}`,
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.24, metalness: 0.48, emissive: color, emissiveIntensity: 0.3, map: materialAtlasTile(10) })
  );
}

function setpieceGlowMaterial(key: string, color: THREE.ColorRepresentation, opacity: number): THREE.Material {
  return sharedLevelMaterial(
    `setpiece-glow:${key}`,
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
}

type BossPhaseIndex = 1 | 2 | 3;
type BossPhaseTheme = "breaker" | "archive";

interface BossPhaseReadoutOptions {
  phaseReadout?: boolean;
}

interface BossWeakPointSpec {
  label: string;
  local: THREE.Vector3;
  size: THREE.Vector3;
  scoreValue: number;
  zoneTags: string;
  phaseIndex?: BossPhaseIndex;
}

interface BossSupportOptions {
  supportGroupId: string;
  supportReleaseRadius: number;
  supportReleaseHeight: number;
  supportReleaseLowerHeight?: number;
  supportReleaseFallDirection: THREE.Vector3;
}

interface BossCoreOptions {
  label: string;
  materialId: MaterialId;
  renderMaterial: THREE.Material;
  position: THREE.Vector3;
  size: THREE.Vector3;
  rotation: THREE.Quaternion;
  zoneId: string;
  scoreValue: number;
  kind: "electric" | "explosive";
  support: BossSupportOptions;
  fractureResistance: number;
}

function addBossCoreBox(context: LevelContext, options: BossCoreOptions): THREE.Mesh {
  const object = context.physics.addDynamicBox({
    label: options.label,
    material: context.materials.get(options.materialId),
    renderMaterial: options.renderMaterial,
    position: options.position,
    size: options.size,
    rotation: options.rotation,
    category: "structure",
    scoreRole: "target",
    zoneId: options.zoneId,
    supportGroupId: options.support.supportGroupId,
    supportReleaseRadius: options.support.supportReleaseRadius,
    supportReleaseHeight: options.support.supportReleaseHeight,
    supportReleaseLowerHeight: options.support.supportReleaseLowerHeight,
    supportReleaseFallDirection: options.support.supportReleaseFallDirection,
    supportReleaseImpulseScale: 1.04,
    supportReleaseTorqueScale: 1.18,
    supportReleaseMassScale: 1.1,
    canFracture: true,
    destructible: true,
    fractureResistance: options.fractureResistance,
    bodyType: "fixed",
    chainSource: true,
    scoreValue: options.scoreValue,
    restitution: options.materialId === "glass" ? 0.18 : 0.1
  });
  decorateHazardIndicator(object.mesh, { size: options.size, kind: options.kind });
  decorateStrategicHazard(object.mesh, { label: options.label, size: options.size, kind: options.kind });
  object.mesh.userData.disposeMaterial = false;
  disableSetpieceShadows(object.mesh);
  return object.mesh;
}

function addReadableWeakPoint(
  context: LevelContext,
  options: {
    label: string;
    position: THREE.Vector3;
    size: THREE.Vector3;
    rotation: THREE.Quaternion;
    zoneId: string;
    scoreValue: number;
    kind: "electric" | "explosive";
    support: BossSupportOptions;
    phaseIndex?: BossPhaseIndex;
    phaseTheme: BossPhaseTheme;
  }
): void {
  const object = context.physics.addDynamicBox({
    label: options.label,
    material: context.materials.get("metal"),
    renderMaterial: scaffoldWeakPointMaterial(),
    position: options.position,
    size: options.size,
    rotation: options.rotation,
    category: "structure",
    scoreRole: "target",
    zoneId: options.zoneId,
    supportGroupId: options.support.supportGroupId,
    supportReleaseRadius: options.support.supportReleaseRadius,
    supportReleaseHeight: options.support.supportReleaseHeight,
    supportReleaseLowerHeight: options.support.supportReleaseLowerHeight,
    supportReleaseFallDirection: options.support.supportReleaseFallDirection,
    supportReleaseImpulseScale: 1.18,
    supportReleaseTorqueScale: 1.36,
    supportReleaseMassScale: 0.48,
    canFracture: true,
    destructible: true,
    fractureResistance: 0.14,
    bodyType: "fixed",
    chainSource: true,
    scoreValue: options.scoreValue,
    restitution: 0.08
  });
  object.mesh.userData.disposeMaterial = false;
  disableSetpieceShadows(object.mesh);
  decorateHazardIndicator(object.mesh, { size: options.size, kind: options.kind });
  decorateReadableWeakPointMarker(object.mesh, options.size, options.kind === "electric" ? "electric" : "hazard");
  decorateBossWeakPointCallout(object.mesh, options.size, options.phaseTheme);
  if (options.phaseIndex !== undefined) {
    decorateBossPhaseMarker(object.mesh, options.size, options.phaseIndex, options.phaseTheme);
  }
}

function addBossRelayCanister(
  context: LevelContext,
  options: {
    label: string;
    position: THREE.Vector3;
    size: THREE.Vector3;
    rotation: THREE.Quaternion;
    zoneId: string;
    scoreValue: number;
    kind: "electric" | "explosive";
    phaseTheme: BossPhaseTheme;
    support: BossSupportOptions;
  }
): void {
  const object = context.physics.addDynamicBox({
    label: options.label,
    material: context.materials.get("glass"),
    renderMaterial: scaffoldCanisterMaterial(),
    position: options.position,
    size: options.size,
    rotation: options.rotation,
    category: "structure",
    scoreRole: "target",
    zoneId: options.zoneId,
    supportGroupId: options.support.supportGroupId,
    supportReleaseRadius: options.support.supportReleaseRadius,
    supportReleaseHeight: options.support.supportReleaseHeight,
    supportReleaseLowerHeight: options.support.supportReleaseLowerHeight,
    supportReleaseFallDirection: options.support.supportReleaseFallDirection,
    supportReleaseImpulseScale: 0.86,
    supportReleaseTorqueScale: 1.04,
    supportReleaseMassScale: 0.42,
    canFracture: true,
    destructible: true,
    fractureResistance: 0.18,
    bodyType: "fixed",
    chainSource: true,
    scoreValue: options.scoreValue,
    restitution: 0.18
  });
  object.mesh.userData.disposeMaterial = false;
  disableSetpieceShadows(object.mesh);
  decorateHazardIndicator(object.mesh, { size: options.size, kind: options.kind });
  decorateReadableWeakPointMarker(object.mesh, options.size, options.kind === "electric" ? "electric" : "hazard");
  decorateBossWeakPointCallout(object.mesh, options.size, options.phaseTheme);
}

function bossWorldPosition(base: THREE.Vector3, rotationY: number, local: THREE.Vector3): THREE.Vector3 {
  return base.clone().add(local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY));
}

function addBossArenaMarkers(context: LevelContext, base: THREE.Vector3, rotationY: number, theme: BossPhaseTheme): void {
  const accent = bossAccentColor(theme);
  const secondary = theme === "breaker" ? 0xffd66b : 0x93f1ff;
  const ringMaterial = setpieceGlowMaterial(`boss-floor-ring:${theme}`, accent, 0.54);
  const outerRing = new THREE.Mesh(sharedLevelRingGeometry(1.95, 2.22), ringMaterial);
  outerRing.name = `${theme} boss floor target ring`;
  outerRing.position.copy(bossWorldPosition(base, rotationY, new THREE.Vector3(0, groundPanelY(7), 0)));
  outerRing.rotation.set(-Math.PI * 0.5, 0, rotationY);
  outerRing.renderOrder = groundPanelRenderOrder(7);
  outerRing.userData.disposeMaterial = false;
  context.addDecoration(outerRing);

  const innerRing = new THREE.Mesh(sharedLevelRingGeometry(0.92, 1.04), setpieceGlowMaterial(`boss-inner-ring:${theme}`, secondary, 0.44));
  innerRing.name = `${theme} boss inner cashout ring`;
  innerRing.position.copy(bossWorldPosition(base, rotationY, new THREE.Vector3(0, groundPanelY(8), 0)));
  innerRing.rotation.set(-Math.PI * 0.5, 0, rotationY);
  innerRing.renderOrder = groundPanelRenderOrder(8);
  innerRing.userData.disposeMaterial = false;
  context.addDecoration(innerRing);

  const skyMaterial = setpieceGlowMaterial(`boss-sky-marker-strong:${theme}`, accent, 0.9);
  const skyCore = new THREE.Group();
  skyCore.name = `${theme} boss overhead target marker`;
  skyCore.position.copy(bossWorldPosition(base, rotationY, new THREE.Vector3(0, 0, 0)));
  skyCore.rotation.y = rotationY;
  const skyBeam = new THREE.Mesh(sharedLevelBoxGeometry(0.38, 7.4, 0.38), skyMaterial);
  skyBeam.name = `${theme} boss vertical target beam`;
  skyBeam.position.y = 5.2;
  skyBeam.userData.disposeMaterial = false;
  skyCore.add(skyBeam);
  for (const [name, size, y] of [
    ["wide crown", new THREE.Vector3(3.3, 0.16, 0.16), 8.95],
    ["deep crown", new THREE.Vector3(0.16, 0.16, 3.3), 8.95],
    ["mid wide crown", new THREE.Vector3(2.25, 0.12, 0.12), 7.65],
    ["mid deep crown", new THREE.Vector3(0.12, 0.12, 2.25), 7.65]
  ] as const) {
    const crown = new THREE.Mesh(sharedLevelBoxGeometry(size.x, size.y, size.z), skyMaterial);
    crown.name = `${theme} boss ${name}`;
    crown.position.y = y;
    crown.userData.disposeMaterial = false;
    skyCore.add(crown);
  }
  context.addDecoration(skyCore);

  const crossMaterial = setpieceGlowMaterial(`boss-crosshair:${theme}`, accent, 0.5);
  for (const [name, local, size] of [
    ["north-south", new THREE.Vector3(0, groundPanelY(9), 0), new THREE.Vector3(0.18, 0.02, 4.25)],
    ["east-west", new THREE.Vector3(0, groundPanelY(9), 0), new THREE.Vector3(4.25, 0.02, 0.18)]
  ] as const) {
    const bar = new THREE.Mesh(sharedLevelBoxGeometry(size.x, size.y, size.z), crossMaterial);
    bar.name = `${theme} boss ${name} crosshair`;
    bar.position.copy(bossWorldPosition(base, rotationY, local));
    bar.rotation.y = rotationY;
    bar.renderOrder = groundPanelRenderOrder(9);
    bar.userData.disposeMaterial = false;
    context.addDecoration(bar);
  }

  const arrowMaterial = setpieceGlowMaterial(`boss-chevron:${theme}`, secondary, 0.68);
  for (const [index, local, angle] of [
    [1, new THREE.Vector3(0, groundPanelY(10), 2.95), 0],
    [2, new THREE.Vector3(-2.45, groundPanelY(10), 0), Math.PI * 0.5],
    [3, new THREE.Vector3(2.45, groundPanelY(10), 0), -Math.PI * 0.5]
  ] as const) {
    const chevron = new THREE.Group();
    chevron.name = `${theme} boss approach chevron ${index}`;
    chevron.position.copy(bossWorldPosition(base, rotationY, local));
    chevron.rotation.y = rotationY + angle;
    for (const side of [-1, 1] as const) {
      const blade = new THREE.Mesh(sharedLevelBoxGeometry(0.72, 0.025, 0.12), arrowMaterial);
      blade.name = `${theme} boss chevron blade`;
      blade.position.set(side * 0.22, 0, 0);
      blade.rotation.y = side * Math.PI * 0.22;
      blade.userData.disposeMaterial = false;
      chevron.add(blade);
    }
    context.addDecoration(chevron);
  }

  const beaconMaterial = setpieceGlowMaterial(`boss-beacon:${theme}`, accent, 0.78);
  const mastMaterial = bossTrimMaterial(theme, accent);
  for (const [index, local] of [
    [1, new THREE.Vector3(-1.72, 0, -1.38)],
    [2, new THREE.Vector3(1.72, 0, -1.38)],
    [3, new THREE.Vector3(-1.72, 0, 1.38)],
    [4, new THREE.Vector3(1.72, 0, 1.38)]
  ] as const) {
    const root = new THREE.Group();
    root.name = `${theme} boss beacon ${index}`;
    root.position.copy(bossWorldPosition(base, rotationY, local));
    root.rotation.y = rotationY;
    const mast = new THREE.Mesh(sharedLevelBoxGeometry(0.08, 1.2, 0.08), mastMaterial);
    mast.name = `${theme} boss beacon mast`;
    mast.position.y = 0.6;
    mast.userData.disposeMaterial = false;
    root.add(mast);
    const lamp = new THREE.Mesh(sharedLevelBoxGeometry(0.34, 0.34, 0.34), beaconMaterial);
    lamp.name = `${theme} boss beacon lamp`;
    lamp.position.y = 1.28;
    lamp.userData.disposeMaterial = false;
    root.add(lamp);
    context.addDecoration(root);
  }
}

function decorateBossPhaseMarker(mesh: THREE.Mesh, size: THREE.Vector3, phaseIndex: BossPhaseIndex, theme: BossPhaseTheme): void {
  const accent = bossAccentColor(theme);
  const marker = setpieceGlowMaterial(`boss-phase:${theme}:${phaseIndex}`, accent, 0.82);
  const pipWidth = THREE.MathUtils.clamp(size.x * 0.14, 0.035, 0.07);
  const pipHeight = THREE.MathUtils.clamp(size.y * 0.16, 0.035, 0.065);
  const gap = pipWidth * 0.45;
  const totalWidth = phaseIndex * pipWidth + (phaseIndex - 1) * gap;
  const y = THREE.MathUtils.clamp(size.y * 0.32, 0.055, size.y * 0.42);
  const z = size.z * 0.5 + 0.044;

  for (let index = 0; index < phaseIndex; index += 1) {
    const pip = new THREE.Mesh(sharedLevelBoxGeometry(pipWidth, pipHeight, 0.038), marker);
    pip.name = `${mesh.name || "boss weak point"} phase ${phaseIndex} pip ${index + 1}`;
    pip.position.set(-totalWidth * 0.5 + pipWidth * 0.5 + index * (pipWidth + gap), y, z);
    pip.userData.disposeMaterial = false;
    mesh.add(pip);
  }
}

function decorateBossWeakPointCallout(mesh: THREE.Mesh, size: THREE.Vector3, theme: BossPhaseTheme): void {
  const accent = bossAccentColor(theme);
  const glow = setpieceGlowMaterial(`boss-weakpoint-callout:${theme}`, accent, 0.78);
  const frontZ = size.z * 0.5 + 0.048;
  const bracketWidth = THREE.MathUtils.clamp(size.x * 0.46, 0.16, 0.26);
  const bracketHeight = THREE.MathUtils.clamp(size.y * 0.12, 0.05, 0.08);
  for (const [x, y, rotationZ] of [
    [-size.x * 0.38, size.y * 0.34, Math.PI * 0.22],
    [size.x * 0.38, size.y * 0.34, -Math.PI * 0.22],
    [-size.x * 0.38, -size.y * 0.22, -Math.PI * 0.22],
    [size.x * 0.38, -size.y * 0.22, Math.PI * 0.22]
  ] as const) {
    const bracket = new THREE.Mesh(sharedLevelBoxGeometry(bracketWidth, bracketHeight, 0.034), glow);
    bracket.name = `${theme} boss weak point corner bracket`;
    bracket.position.set(x, y, frontZ);
    bracket.rotation.z = rotationZ;
    bracket.userData.disposeMaterial = false;
    mesh.add(bracket);
  }
  const dot = new THREE.Mesh(sharedLevelBoxGeometry(size.x * 0.24, size.y * 0.18, 0.04), glow);
  dot.name = `${theme} boss weak point center glow`;
  dot.position.set(0, size.y * 0.05, frontZ + 0.006);
  dot.userData.disposeMaterial = false;
  mesh.add(dot);
}

function decorateBossCore(mesh: THREE.Mesh, size: THREE.Vector3, theme: "breaker" | "archive"): void {
  const accent = bossAccentColor(theme);
  const trim = bossTrimMaterial(theme, accent);
  const glow = bossGlowMaterial(theme, accent);
  const frontZ = size.z * 0.5 + 0.018;
  const backplate = new THREE.Mesh(sharedLevelBoxGeometry(size.x * 1.16, size.y * 0.24, 0.06), setpieceGlowMaterial(`boss-core-backplate:${theme}`, accent, 0.34));
  backplate.name = `${theme} boss target backplate`;
  backplate.position.set(0, size.y * 0.08, frontZ + 0.002);
  backplate.userData.disposeMaterial = false;
  mesh.add(backplate);

  for (const [x, y, height] of [
    [-size.x * 0.32, size.y * 0.12, size.y * 0.68],
    [size.x * 0.32, size.y * 0.16, size.y * 0.56]
  ] as const) {
    const fin = new THREE.Mesh(sharedLevelBoxGeometry(0.055, height, 0.055), trim);
    fin.name = `${theme} boss vertical bus bar`;
    fin.position.set(x, y, frontZ);
    fin.userData.disposeMaterial = false;
    mesh.add(fin);
  }
  for (const y of [-size.y * 0.26, size.y * 0.28]) {
    const band = new THREE.Mesh(sharedLevelBoxGeometry(size.x * 0.86, 0.055, 0.065), trim);
    band.name = `${theme} boss pressure band`;
    band.position.set(0, y, frontZ + 0.01);
    band.userData.disposeMaterial = false;
    mesh.add(band);
  }
  const eye = new THREE.Mesh(sharedLevelBoxGeometry(size.x * 0.48, 0.2, 0.07), glow);
  eye.name = `${theme} boss weakpoint glow strip`;
  eye.position.set(0, size.y * 0.42, frontZ + 0.02);
  eye.userData.disposeMaterial = false;
  mesh.add(eye);

  for (const [x, y, rotationZ] of [
    [-size.x * 0.48, size.y * 0.42, Math.PI * 0.18],
    [size.x * 0.48, size.y * 0.42, -Math.PI * 0.18],
    [-size.x * 0.48, -size.y * 0.14, -Math.PI * 0.18],
    [size.x * 0.48, -size.y * 0.14, Math.PI * 0.18]
  ] as const) {
    const bracket = new THREE.Mesh(sharedLevelBoxGeometry(size.x * 0.28, 0.065, 0.075), glow);
    bracket.name = `${theme} boss target bracket`;
    bracket.position.set(x, y, frontZ + 0.034);
    bracket.rotation.z = rotationZ;
    bracket.userData.disposeMaterial = false;
    mesh.add(bracket);
  }
}

function bossAccentColor(theme: BossPhaseTheme): THREE.ColorRepresentation {
  return theme === "breaker" ? 0x61e9ff : 0xff6b93;
}

function bossCoreMaterial(key: string, color: THREE.ColorRepresentation, emissive: THREE.ColorRepresentation): THREE.Material {
  return sharedLevelMaterial(
    `boss-core:${key}`,
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.76, emissive, emissiveIntensity: 0.16, map: materialAtlasTile(10) })
  );
}

function bossGlassMaterial(key: string, color: THREE.ColorRepresentation, emissive: THREE.ColorRepresentation): THREE.Material {
  return sharedLevelMaterial(
    `boss-glass:${key}`,
    () =>
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.12,
        metalness: 0.05,
        transparent: true,
        opacity: 0.72,
        emissive,
        emissiveIntensity: 0.22,
        map: materialAtlasTile(8),
        envMapIntensity: 1.2
      })
  );
}

function bossTrimMaterial(theme: "breaker" | "archive", color: THREE.ColorRepresentation): THREE.Material {
  return sharedLevelMaterial(
    `boss-trim:${theme}`,
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.26, metalness: 0.82, emissive: color, emissiveIntensity: 0.18, map: materialAtlasTile(10) })
  );
}

function bossGlowMaterial(theme: "breaker" | "archive", color: THREE.ColorRepresentation): THREE.Material {
  return sharedLevelMaterial(
    `boss-glow:${theme}`,
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.86, depthWrite: false })
  );
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

function spawnCentralConstructionCrane(context: LevelContext): void {
  const anchor = new THREE.Vector3(-3.25, 0, 0.85);
  const supportGroupId = "central-construction-crane";
  const fallDirection = new THREE.Vector3(1, 0, -0.16);
  const craneReleaseRadius = 16.4;
  const craneReleaseHeight = 15.8;
  const craneUpperReleaseHeight = 4.8;
  const craneUpperReleaseLowerHeight = 13.2;
  const mastHeight = 1.08;
  const mastLevels = 11;
  const mastBottomY = 0.5;
  const topY = mastBottomY + mastLevels * mastHeight;
  const assemblyHeight = topY - mastBottomY + 0.18;
  const assemblyCenterY = mastBottomY + assemblyHeight * 0.5;
  const boomLength = 14.4;
  const boomCenterX = 6.15;
  const counterJibLength = 3.3;
  const counterJibCenterX = -1.95;
  const counterweightX = -3.62;
  const hookX = 10.1;
  const hookCenterY = topY - 2.25;
  const hookSize = new THREE.Vector3(0.42, 0.22, 0.18);
  const payloadSize = new THREE.Vector3(1.86, 1.08, 1.36);
  const payloadLiftGap = 0.74;
  const payloadCenterY = hookCenterY - hookSize.y * 0.5 - payloadLiftGap - payloadSize.y * 0.5;

  addCranePart(
    context,
    "Central construction crane base",
    "concrete",
    new THREE.MeshStandardMaterial({ color: 0x3a4247, roughness: 0.74, metalness: 0.08, map: materialAtlasTile(12) }),
    new THREE.Vector3(anchor.x, 0.24, anchor.z),
    new THREE.Vector3(1.58, 0.48, 1.58),
    190,
    {
      supportGroupId,
      supportReleaseRadius: craneReleaseRadius,
      supportReleaseHeight: craneReleaseHeight,
      supportReleaseFallDirection: fallDirection,
      fractureResistance: 4.5
    }
  );

  const mastAssembly = addCranePart(
    context,
    "Central construction crane mast assembly",
    "metal",
    craneYellowMaterial(),
    new THREE.Vector3(anchor.x, assemblyCenterY, anchor.z),
    new THREE.Vector3(0.46, assemblyHeight, 0.46),
    420,
    {
      supportGroupId,
      destructible: false,
      canFracture: false,
      supportReleaseImpulseScale: 1.18,
      supportReleaseTorqueScale: 14.25,
      supportReleaseMassScale: 3.05,
      impactVolumeScale: 3.1
    }
  );
  hideCranePhysicsCore(mastAssembly);
  decorateCraneMastAssembly(mastAssembly, { mastBottomY, mastHeight, mastLevels, assemblyCenterY });

  const boomCenterY = topY + 0.35;
  const boomAssembly = addCranePart(
    context,
    "Central construction crane boom assembly",
    "metal",
    craneYellowMaterial(),
    new THREE.Vector3(anchor.x, boomCenterY, anchor.z),
    new THREE.Vector3(0.9, 0.46, 0.9),
    620,
    {
      supportGroupId,
      destructible: false,
      canFracture: false,
      supportReleaseImpulseScale: 1.52,
      supportReleaseTorqueScale: 15.75,
      supportReleaseMassScale: 4.25,
      impactVolumeScale: 13.5,
      compoundColliders: [
        {
          size: new THREE.Vector3(0.9, 0.4, 0.9),
          offset: new THREE.Vector3(0, topY + 0.2 - boomCenterY, 0)
        },
        {
          size: new THREE.Vector3(boomLength, 0.3, 0.38),
          offset: new THREE.Vector3(boomCenterX, 0, 0)
        },
        {
          size: new THREE.Vector3(counterJibLength, 0.32, 0.46),
          offset: new THREE.Vector3(counterJibCenterX, 0, 0)
        },
        {
          size: new THREE.Vector3(0.9, 0.9, 0.78),
          offset: new THREE.Vector3(counterweightX, topY + 0.04 - boomCenterY, 0)
        },
        {
          size: new THREE.Vector3(0.88, 0.58, 0.58),
          offset: new THREE.Vector3(0.68, topY - 0.08 - boomCenterY, -0.48)
        },
        {
          size: hookSize,
          offset: new THREE.Vector3(hookX, hookCenterY - boomCenterY, 0)
        }
      ]
    }
  );
  hideCranePhysicsCore(boomAssembly);
  decorateCraneBoomAssembly(boomAssembly, {
    topY,
    boomCenterY,
    boomLength,
    boomCenterX,
    counterJibLength,
    counterJibCenterX,
    counterweightX,
    hookX,
    hookCenterY,
    hookSize
  });

  addCraneWeakPoint(
    context,
    "Central construction crane base shear pins",
    new THREE.Vector3(anchor.x, mastBottomY + 0.28, anchor.z),
    new THREE.Vector3(0.74, 0.28, 0.74),
    {
      supportGroupId,
      supportReleaseRadius: craneReleaseRadius,
      supportReleaseHeight: craneReleaseHeight,
      supportReleaseFallDirection: fallDirection,
      scoreValue: 240
    }
  );
  addCraneWeakPoint(
    context,
    "Central construction crane slewing ring weak point",
    new THREE.Vector3(anchor.x, topY + 0.18, anchor.z),
    new THREE.Vector3(0.88, 0.24, 0.88),
    {
      supportGroupId,
      supportReleaseRadius: craneReleaseRadius,
      supportReleaseHeight: craneUpperReleaseHeight,
      supportReleaseLowerHeight: craneUpperReleaseLowerHeight,
      supportReleaseFallDirection: fallDirection,
      scoreValue: 340
    }
  );
  addCraneWeakPoint(
    context,
    "Central construction crane boom heel weak point",
    new THREE.Vector3(anchor.x + 1.12, topY + 0.36, anchor.z),
    new THREE.Vector3(0.58, 0.26, 0.62),
    {
      supportGroupId,
      supportReleaseRadius: craneReleaseRadius,
      supportReleaseHeight: craneUpperReleaseHeight,
      supportReleaseLowerHeight: craneUpperReleaseLowerHeight,
      supportReleaseFallDirection: fallDirection,
      scoreValue: 320
    }
  );
  addCraneWeakPoint(
    context,
    "Central construction crane hoist trolley weak point",
    new THREE.Vector3(anchor.x + hookX, topY + 0.18, anchor.z),
    new THREE.Vector3(0.56, 0.24, 0.46),
    {
      supportGroupId,
      supportReleaseRadius: craneReleaseRadius,
      supportReleaseHeight: craneUpperReleaseHeight,
      supportReleaseLowerHeight: craneUpperReleaseLowerHeight,
      supportReleaseFallDirection: fallDirection,
      scoreValue: 360
    }
  );

  const payload = addCranePart(
    context,
    "Central construction crane heavy payload",
    "metal",
    new THREE.MeshStandardMaterial({
      color: 0x2d3235,
      roughness: 0.5,
      metalness: 0.72,
      emissive: 0x1a0900,
      emissiveIntensity: 0.1,
      map: materialAtlasTile(10)
    }),
    new THREE.Vector3(anchor.x + hookX, payloadCenterY, anchor.z),
    payloadSize,
    260,
    {
      supportGroupId,
      scoreRole: "target",
      zoneId: "central-construction-crane hazard-core",
      destructible: true,
      canFracture: true,
      fractureResistance: 0.38,
      supportReleaseRadius: craneReleaseRadius,
      supportReleaseHeight: 7.4,
      supportReleaseLowerHeight: 9.2,
      supportReleaseFallDirection: fallDirection,
      supportReleaseImpulseScale: 0.42,
      supportReleaseTorqueScale: 0.22,
      supportReleaseMassScale: 6.6,
      impactVolumeScale: 3.2
    }
  );
  decorateCranePayload(payload, { size: payloadSize, liftGap: payloadLiftGap });
}

interface ScaffoldTowerSpec {
  labelPrefix: string;
  anchor: THREE.Vector3;
  rotationY: number;
  width: number;
  depth: number;
  levels: number;
  bayHeight: number;
  fallDirection: THREE.Vector3;
  accent: THREE.ColorRepresentation;
}

interface ScaffoldSupportOptions {
  supportGroupId: string;
  supportReleaseRadius: number;
  supportReleaseHeight: number;
  supportReleaseLowerHeight: number;
  supportReleaseFallDirection: THREE.Vector3;
}

interface ScaffoldVisualPart {
  size: THREE.Vector3;
  position: THREE.Vector3;
  rotation?: THREE.Euler;
}

interface ScaffoldLocalBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface ScaffoldPlacementFootprint {
  center: THREE.Vector3;
  footprint: { x: number; z: number };
}

const SCAFFOLD_PLACEMENT_CLEARANCE = 0.28;
const SCAFFOLD_PLACEMENT_BLOCKERS: CityRoadCorridor[] = [
  cityFootprintBlocker("x", new THREE.Vector3(-5.3, 0, 1), new THREE.Vector3(2.0, 1, 0.64), 0, 0.24),
  cityFootprintBlocker("x", new THREE.Vector3(-2.95, 0, 3.2), new THREE.Vector3(3.04, 1, 0.7), 0, 0.26),
  cityFootprintBlocker("x", new THREE.Vector3(5.18, 0, 2.38), new THREE.Vector3(2.74, 1, 0.72), 0, 0.24),
  cityFootprintBlocker("x", new THREE.Vector3(-1.35, 0, 1.65), new THREE.Vector3(0.78, 1, 0.58), Math.PI * 0.18, 0.24),
  cityFootprintBlocker("x", new THREE.Vector3(3.85, 0, 3.4), new THREE.Vector3(0.78, 1, 0.58), -Math.PI * 0.08, 0.24),
  cityFootprintBlocker("x", new THREE.Vector3(5.82, 0, -4.18), new THREE.Vector3(2.8, 1, 2.5), -Math.PI * 0.055, 0.36),
  cityFootprintBlocker("z", new THREE.Vector3(8.9, 0, -6.25), new THREE.Vector3(2.16, 1, 0.82), -Math.PI * 0.035, 0.28),
  cityFootprintBlocker("z", new THREE.Vector3(-8.95, 0, -6.65), new THREE.Vector3(0.82, 1, 2.66), Math.PI * 0.5, 0.28),
  cityFootprintBlocker("x", new THREE.Vector3(15.95, 0, -14), new THREE.Vector3(0.58, 1, 1.54), Math.PI * 0.5, 0.26)
];
const SCAFFOLD_ALL_PLACEMENT_BLOCKERS: CityRoadCorridor[] = [...CITY_PLACEMENT_BLOCKERS, ...SCAFFOLD_PLACEMENT_BLOCKERS];

function spawnConstructionScaffolding(context: LevelContext): void {
  const westScaffold: ScaffoldTowerSpec = {
    labelPrefix: "West construction scaffold",
    anchor: new THREE.Vector3(-7.78, 0, 2.88),
    rotationY: Math.PI * 0.045,
    width: 2.95,
    depth: 0.7,
    levels: 4,
    bayHeight: 0.82,
    fallDirection: new THREE.Vector3(0.64, 0, -0.28),
    accent: 0xffc241
  };
  const eastScaffold: ScaffoldTowerSpec = {
    labelPrefix: "East construction scaffold",
    anchor: new THREE.Vector3(3.45, 0, 0.74),
    rotationY: -Math.PI * 0.035,
    width: 2.9,
    depth: 0.68,
    levels: 4,
    bayHeight: 0.8,
    fallDirection: new THREE.Vector3(-0.55, 0, -0.34),
    accent: 0x68e8ff
  };
  const pearTowerScaffold: ScaffoldTowerSpec = {
    labelPrefix: "Pear tower scaffold",
    anchor: new THREE.Vector3(8.9, 0, -4.0),
    rotationY: -Math.PI * 0.5,
    width: 2.15,
    depth: 0.6,
    levels: 5,
    bayHeight: 0.82,
    fallDirection: new THREE.Vector3(-0.42, 0, 0.58),
    accent: 0x8ff7ff
  };
  const northeastHotelScaffold: ScaffoldTowerSpec = {
    labelPrefix: "Northeast hotel facade scaffold",
    anchor: new THREE.Vector3(16.7, 0, -14.0),
    rotationY: Math.PI * 0.5,
    width: 2.15,
    depth: 0.6,
    levels: 5,
    bayHeight: 0.82,
    fallDirection: new THREE.Vector3(0.62, 0, 0.18),
    accent: 0xffc241
  };

  const placedWestScaffold = placedScaffoldSpec(westScaffold);
  const placedEastScaffold = placedScaffoldSpec(eastScaffold);

  addScaffoldTower(context, placedWestScaffold);
  addScaffoldTower(context, placedEastScaffold);
  addScaffoldTower(context, placedScaffoldSpec(pearTowerScaffold));
  addScaffoldTower(context, placedScaffoldSpec(northeastHotelScaffold));
  addScaffoldSkybridge(context, placedWestScaffold, placedEastScaffold);
  addScaffoldSupplyPile(context, placedWestScaffold, -0.2);
  addScaffoldSupplyPile(context, placedEastScaffold, 0.22);
}

function placedScaffoldSpec(spec: ScaffoldTowerSpec): ScaffoldTowerSpec {
  let placed = { ...spec, anchor: spec.anchor.clone() };
  for (let pass = 0; pass < 4; pass += 1) {
    const { center, footprint } = scaffoldPlacementFootprint(placed);
    const alignedCenter = alignFootprintToScaffoldBlockers(center, footprint, SCAFFOLD_PLACEMENT_CLEARANCE);
    const delta = alignedCenter.sub(center);
    if (delta.lengthSq() < 0.0001) {
      break;
    }
    placed = { ...placed, anchor: placed.anchor.clone().add(delta) };
  }
  return placed;
}

function scaffoldPlacementFootprint(spec: ScaffoldTowerSpec): ScaffoldPlacementFootprint {
  const localBounds = scaffoldLocalPlacementBounds(spec);
  const corners = [
    new THREE.Vector3(localBounds.minX, 0, localBounds.minZ),
    new THREE.Vector3(localBounds.minX, 0, localBounds.maxZ),
    new THREE.Vector3(localBounds.maxX, 0, localBounds.minZ),
    new THREE.Vector3(localBounds.maxX, 0, localBounds.maxZ)
  ].map((corner) => scaffoldWorldPosition(spec, corner));
  const minX = Math.min(...corners.map((corner) => corner.x));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const minZ = Math.min(...corners.map((corner) => corner.z));
  const maxZ = Math.max(...corners.map((corner) => corner.z));
  return {
    center: new THREE.Vector3((minX + maxX) * 0.5, 0, (minZ + maxZ) * 0.5),
    footprint: { x: maxX - minX, z: maxZ - minZ }
  };
}

function scaffoldLocalPlacementBounds(spec: ScaffoldTowerSpec): ScaffoldLocalBounds {
  const totalHeight = spec.levels * spec.bayHeight + 0.42;
  const bounds: ScaffoldLocalBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  includeScaffoldLocalBox(bounds, new THREE.Vector3(0, 0, 0), new THREE.Vector3(spec.width, 1, spec.depth));
  includeScaffoldLocalBox(bounds, new THREE.Vector3(0, 0, 0), new THREE.Vector3(spec.width * 0.88, 1, spec.depth * 1.24));
  includeScaffoldLocalBox(bounds, new THREE.Vector3(0, 0, spec.depth * 0.5 + 0.08), new THREE.Vector3(spec.width * 0.82, 1, 0.055));
  includeScaffoldLocalBox(bounds, new THREE.Vector3(-spec.width * 0.44, 0, spec.depth * 0.52), new THREE.Vector3(0.34, 1, 0.28));
  includeScaffoldLocalBox(bounds, new THREE.Vector3(spec.width * 0.42, 0, spec.depth * 0.55), new THREE.Vector3(0.34, 1, 0.28));
  includeScaffoldLocalBox(bounds, new THREE.Vector3(0.1, 0, -spec.depth * 0.55), new THREE.Vector3(0.34, 1, 0.28));
  includeScaffoldLocalBox(bounds, new THREE.Vector3(spec.width * 0.58, 0, -spec.depth * 0.08), new THREE.Vector3(0.46, 1, 0.46));
  includeScaffoldLocalBox(bounds, new THREE.Vector3(-spec.width * 0.46, 0, spec.depth * 0.66), new THREE.Vector3(0.48, 1, 0.42));
  if (totalHeight > 4) {
    includeScaffoldLocalBox(bounds, new THREE.Vector3(0, 0, 0), new THREE.Vector3(spec.width * 0.92, 1, spec.depth * 1.12));
  }
  return bounds;
}

function includeScaffoldLocalBox(bounds: ScaffoldLocalBounds, center: THREE.Vector3, size: THREE.Vector3, rotationY = 0): void {
  const halfX = size.x * 0.5;
  const halfZ = size.z * 0.5;
  for (const x of [-halfX, halfX]) {
    for (const z of [-halfZ, halfZ]) {
      const point = new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY).add(center);
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minZ = Math.min(bounds.minZ, point.z);
      bounds.maxZ = Math.max(bounds.maxZ, point.z);
    }
  }
}

function alignScaffoldObjectToPlacementBlockers(position: THREE.Vector3, size: THREE.Vector3, rotationY: number): THREE.Vector3 {
  const footprint = cityObjectFootprint(size, rotationY);
  return alignFootprintToScaffoldBlockers(position, footprint, SCAFFOLD_PLACEMENT_CLEARANCE);
}

function alignFootprintToScaffoldBlockers(position: THREE.Vector3, footprint: { x: number; z: number }, clearance: number): THREE.Vector3 {
  return alignFootprintToBlockers(position, footprint, SCAFFOLD_ALL_PLACEMENT_BLOCKERS, clearance);
}

function cityFootprintBlocker(
  axis: CityRoadCorridor["axis"],
  position: THREE.Vector3,
  size: THREE.Vector3,
  rotationY: number,
  padding: number
): CityRoadCorridor {
  const footprint = cityObjectFootprint(size, rotationY);
  return {
    axis,
    minX: position.x - footprint.x * 0.5 - padding,
    maxX: position.x + footprint.x * 0.5 + padding,
    minZ: position.z - footprint.z * 0.5 - padding,
    maxZ: position.z + footprint.z * 0.5 + padding
  };
}

function addScaffoldTower(context: LevelContext, spec: ScaffoldTowerSpec): void {
  const supportGroupId = `${spec.labelPrefix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-collapse`;
  const totalHeight = spec.levels * spec.bayHeight + 0.42;
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spec.rotationY, 0));
  const supportOptions: ScaffoldSupportOptions = {
    supportGroupId,
    supportReleaseRadius: Math.max(4.2, spec.width * 1.55),
    supportReleaseHeight: totalHeight + 1.55,
    supportReleaseLowerHeight: totalHeight + 0.8,
    supportReleaseFallDirection: spec.fallDirection
  };

  const frameSize = new THREE.Vector3(spec.width, totalHeight, spec.depth);
  const frame = addScaffoldPhysicsBox(context, {
    label: `${spec.labelPrefix} tube frame`,
    materialId: "metal",
    renderMaterial: scaffoldShadowMaterial(),
    position: scaffoldWorldPosition(spec, new THREE.Vector3(0, totalHeight * 0.5, 0)),
    size: frameSize,
    rotation,
    scoreRole: "target",
    scoreValue: 620,
    fractureResistance: 1.15,
    support: supportOptions,
    supportReleaseMassScale: 0.9,
    supportReleaseImpulseScale: 1.15,
    supportReleaseTorqueScale: 1.28,
    hideCore: true
  });
  decorateScaffoldFrame(frame, {
    width: spec.width,
    depth: spec.depth,
    totalHeight,
    levels: spec.levels,
    bayHeight: spec.bayHeight,
    accent: spec.accent
  });

  for (let level = 1; level <= spec.levels; level += 1) {
    const deckY = 0.24 + level * spec.bayHeight;
    addScaffoldPhysicsBox(context, {
      label: level === spec.levels ? `${spec.labelPrefix} top work deck` : `${spec.labelPrefix} timber work deck`,
      materialId: "wood",
      renderMaterial: scaffoldPlankMaterial(),
      position: scaffoldWorldPosition(spec, new THREE.Vector3(0, deckY, 0)),
      size: new THREE.Vector3(spec.width * 0.88, 0.09, spec.depth * 1.24),
      rotation,
      scoreRole: level >= spec.levels - 1 ? "target" : "neutral",
      scoreValue: level === spec.levels ? 210 : 130,
      fractureResistance: 0.62,
      support: supportOptions,
      supportReleaseMassScale: 0.62,
      supportReleaseImpulseScale: 0.9,
      supportReleaseTorqueScale: 0.72
    });
  }

  addScaffoldNetPanel(context, spec, supportOptions, rotation, "front", totalHeight);
  addScaffoldWeakPoints(context, spec, supportOptions, rotation, totalHeight);
  addScaffoldHoist(context, spec, supportOptions, rotation, totalHeight);
  addScaffoldCanisterRack(context, spec, supportOptions, rotation);
}

function addScaffoldPhysicsBox(
  context: LevelContext,
  options: {
    label: string;
    materialId: MaterialId;
    renderMaterial: THREE.Material;
    position: THREE.Vector3;
    size: THREE.Vector3;
    rotation: THREE.Quaternion;
    scoreRole: ScoreRole;
    scoreValue: number;
    fractureResistance: number;
    support?: ScaffoldSupportOptions;
    supportReleaseMassScale?: number;
    supportReleaseImpulseScale?: number;
    supportReleaseTorqueScale?: number;
    hideCore?: boolean;
  }
): THREE.Mesh {
  const object = context.physics.addDynamicBox({
    label: options.label,
    material: context.materials.get(options.materialId),
    renderMaterial: options.renderMaterial,
    position: options.position,
    size: options.size,
    rotation: options.rotation,
    category: "structure",
    scoreRole: options.scoreRole,
    zoneId: "construction-scaffold hazard-core",
    canFracture: true,
    destructible: true,
    bodyType: "fixed",
    chainSource: true,
    supportGroupId: options.support?.supportGroupId,
    supportReleaseRadius: options.support?.supportReleaseRadius,
    supportReleaseHeight: options.support?.supportReleaseHeight,
    supportReleaseLowerHeight: options.support?.supportReleaseLowerHeight,
    supportReleaseFallDirection: options.support?.supportReleaseFallDirection,
    supportReleaseMassScale: options.supportReleaseMassScale,
    supportReleaseImpulseScale: options.supportReleaseImpulseScale,
    supportReleaseTorqueScale: options.supportReleaseTorqueScale,
    fractureResistance: options.fractureResistance,
    scoreValue: options.scoreValue,
    restitution: options.materialId === "wood" ? 0.22 : 0.12,
    linearDamping: 0.18,
    angularDamping: 0.32
  });
  object.mesh.userData.disposeMaterial = false;
  disableSetpieceShadows(object.mesh);
  if (options.hideCore) {
    hideSetpiecePhysicsCore(object.mesh);
  }
  return object.mesh;
}

function addScaffoldNetPanel(
  context: LevelContext,
  spec: ScaffoldTowerSpec,
  support: ScaffoldSupportOptions,
  rotation: THREE.Quaternion,
  side: "front" | "back",
  totalHeight: number
): void {
  const localZ = (side === "front" ? 1 : -1) * (spec.depth * 0.5 + 0.08);
  const y = totalHeight * 0.56;
  const height = totalHeight * 0.54;
  addScaffoldPhysicsBox(context, {
    label: `${spec.labelPrefix} torn safety net`,
    materialId: "foam",
    renderMaterial: scaffoldNetMaterial(spec.accent),
    position: scaffoldWorldPosition(spec, new THREE.Vector3(0, y, localZ)),
    size: new THREE.Vector3(spec.width * 0.82, height, 0.055),
    rotation,
    scoreRole: "neutral",
    scoreValue: 92,
    fractureResistance: 0.34,
    support,
    supportReleaseMassScale: 0.34,
    supportReleaseImpulseScale: 0.8,
    supportReleaseTorqueScale: 0.62
  });
}

function addScaffoldWeakPoints(
  context: LevelContext,
  spec: ScaffoldTowerSpec,
  support: ScaffoldSupportOptions,
  rotation: THREE.Quaternion,
  totalHeight: number
): void {
  const weakPoints = [
    { label: "base coupler", local: new THREE.Vector3(-spec.width * 0.44, 0.56, spec.depth * 0.52), scoreValue: 180 },
    { label: "cross brace latch", local: new THREE.Vector3(spec.width * 0.42, totalHeight * 0.48, spec.depth * 0.55), scoreValue: 230 },
    { label: "top hoist pin", local: new THREE.Vector3(0.1, totalHeight - 0.32, -spec.depth * 0.55), scoreValue: 260 }
  ] as const;

  for (const weakPoint of weakPoints) {
    const object = context.physics.addDynamicBox({
      label: `${spec.labelPrefix} ${weakPoint.label}`,
      material: context.materials.get("metal"),
      renderMaterial: scaffoldWeakPointMaterial(),
      position: scaffoldWorldPosition(spec, weakPoint.local),
      size: new THREE.Vector3(0.34, 0.22, 0.28),
      rotation,
      category: "structure",
      scoreRole: "target",
      zoneId: "construction-scaffold hazard-core",
      supportGroupId: support.supportGroupId,
      supportReleaseRadius: support.supportReleaseRadius,
      supportReleaseHeight: support.supportReleaseHeight,
      supportReleaseLowerHeight: support.supportReleaseLowerHeight,
      supportReleaseFallDirection: support.supportReleaseFallDirection,
      supportReleaseImpulseScale: 1.18,
      supportReleaseTorqueScale: 1.42,
      supportReleaseMassScale: 0.52,
      canFracture: true,
      destructible: true,
      fractureResistance: 0.16,
      bodyType: "fixed",
      chainSource: true,
      scoreValue: weakPoint.scoreValue,
      restitution: 0.08
    });
    object.mesh.userData.disposeMaterial = false;
    disableSetpieceShadows(object.mesh);
    decorateHazardIndicator(object.mesh, { size: object.dimensions, kind: "explosive" });
  }
}

function addScaffoldHoist(
  context: LevelContext,
  spec: ScaffoldTowerSpec,
  support: ScaffoldSupportOptions,
  rotation: THREE.Quaternion,
  totalHeight: number
): void {
  const hoistSize = new THREE.Vector3(0.46, 0.58, 0.46);
  const localPosition = new THREE.Vector3(spec.width * 0.58, totalHeight - 0.72, -spec.depth * 0.08);
  addScaffoldPhysicsBox(context, {
    label: `${spec.labelPrefix} swinging material hoist`,
    materialId: "metal",
    renderMaterial: scaffoldHoistMaterial(),
    position: scaffoldWorldPosition(spec, localPosition),
    size: hoistSize,
    rotation,
    scoreRole: "target",
    scoreValue: 240,
    fractureResistance: 0.44,
    support,
    supportReleaseMassScale: 2.35,
    supportReleaseImpulseScale: 0.72,
    supportReleaseTorqueScale: 0.78
  });
}

function addScaffoldCanisterRack(
  context: LevelContext,
  spec: ScaffoldTowerSpec,
  support: ScaffoldSupportOptions,
  rotation: THREE.Quaternion
): void {
  const size = new THREE.Vector3(0.48, 0.74, 0.42);
  const object = context.physics.addDynamicBox({
    label: `${spec.labelPrefix} shock canister rack`,
    material: context.materials.get("glass"),
    renderMaterial: scaffoldCanisterMaterial(),
    position: scaffoldWorldPosition(spec, new THREE.Vector3(-spec.width * 0.46, size.y * 0.5, spec.depth * 0.66)),
    size,
    rotation,
    category: "structure",
    scoreRole: "target",
    zoneId: "construction-scaffold hazard-relay explosive",
    supportGroupId: support.supportGroupId,
    supportReleaseRadius: support.supportReleaseRadius,
    supportReleaseHeight: support.supportReleaseHeight,
    supportReleaseLowerHeight: support.supportReleaseLowerHeight,
    supportReleaseFallDirection: support.supportReleaseFallDirection,
    supportReleaseMassScale: 0.76,
    supportReleaseImpulseScale: 0.9,
    supportReleaseTorqueScale: 0.84,
    canFracture: true,
    destructible: true,
    fractureResistance: 0.22,
    bodyType: "fixed",
    chainSource: true,
    scoreValue: 190,
    restitution: 0.18
  });
  object.mesh.userData.disposeMaterial = false;
  disableSetpieceShadows(object.mesh);
  decorateHazardIndicator(object.mesh, { size, kind: "explosive" });
}

function addScaffoldSkybridge(context: LevelContext, west: ScaffoldTowerSpec, east: ScaffoldTowerSpec): void {
  const start = scaffoldWorldPosition(west, new THREE.Vector3(west.width * 0.42, west.bayHeight * 3.25, 0));
  const end = scaffoldWorldPosition(east, new THREE.Vector3(-east.width * 0.42, east.bayHeight * 3.25, 0));
  const center = start.clone().lerp(end, 0.5);
  const delta = end.clone().sub(start);
  const length = Math.max(1, Math.hypot(delta.x, delta.z));
  const rotationY = Math.atan2(delta.x, delta.z) - Math.PI * 0.5;
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotationY, 0));
  const support: ScaffoldSupportOptions = {
    supportGroupId: "central-scaffold-skybridge-collapse",
    supportReleaseRadius: length * 0.72,
    supportReleaseHeight: 2.2,
    supportReleaseLowerHeight: 1.4,
    supportReleaseFallDirection: new THREE.Vector3(0, 0, -1)
  };
  const deckSize = new THREE.Vector3(length, 0.12, 0.58);
  addScaffoldPhysicsBox(context, {
    label: "Construction scaffold overhead plank bridge",
    materialId: "wood",
    renderMaterial: scaffoldPlankMaterial(),
    position: center,
    size: deckSize,
    rotation,
    scoreRole: "target",
    scoreValue: 280,
    fractureResistance: 0.46,
    support,
    supportReleaseMassScale: 0.72,
    supportReleaseImpulseScale: 0.78,
    supportReleaseTorqueScale: 0.92
  });

  for (const x of [0]) {
    const latch = context.physics.addDynamicBox({
      label: "Construction scaffold bridge release latch",
      material: context.materials.get("metal"),
      renderMaterial: scaffoldWeakPointMaterial(),
      position: center.clone().add(new THREE.Vector3(Math.cos(rotationY) * x, 0.11, -Math.sin(rotationY) * x)),
      size: new THREE.Vector3(0.3, 0.18, 0.34),
      rotation,
      category: "structure",
      scoreRole: "target",
      zoneId: "construction-scaffold hazard-core",
      supportGroupId: support.supportGroupId,
      supportReleaseRadius: support.supportReleaseRadius,
      supportReleaseHeight: support.supportReleaseHeight,
      supportReleaseLowerHeight: support.supportReleaseLowerHeight,
      supportReleaseFallDirection: support.supportReleaseFallDirection,
      canFracture: true,
      destructible: true,
      fractureResistance: 0.14,
      bodyType: "fixed",
      chainSource: true,
      scoreValue: 150
    });
    latch.mesh.userData.disposeMaterial = false;
    disableSetpieceShadows(latch.mesh);
  }
}

function addScaffoldSupplyPile(context: LevelContext, spec: ScaffoldTowerSpec, sideOffset: number): void {
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spec.rotationY + Math.PI * 0.5, 0));
  const local = new THREE.Vector3(sideOffset * spec.width, 0.18, spec.depth * 1.35);
  const size = new THREE.Vector3(1.1, 0.36, 0.58);
  const pile = context.physics.addDynamicBox({
    label: `${spec.labelPrefix} loose plank bundle`,
    material: context.materials.get("wood"),
    renderMaterial: scaffoldPlankMaterial(),
    position: alignScaffoldObjectToPlacementBlockers(scaffoldWorldPosition(spec, local), size, spec.rotationY + Math.PI * 0.5),
    size,
    rotation,
    category: "structure",
    scoreRole: "neutral",
    zoneId: "construction-scaffold",
    canFracture: true,
    destructible: true,
    bodyType: "fixed",
    chainSource: true,
    fractureResistance: 0.52,
    scoreValue: 82,
    restitution: 0.24
  });
  pile.mesh.userData.disposeMaterial = false;
  disableSetpieceShadows(pile.mesh);
}

function scaffoldWorldPosition(spec: ScaffoldTowerSpec, local: THREE.Vector3): THREE.Vector3 {
  const offset = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spec.rotationY);
  return spec.anchor.clone().add(offset);
}

function decorateScaffoldFrame(
  mesh: THREE.Mesh,
  config: {
    width: number;
    depth: number;
    totalHeight: number;
    levels: number;
    bayHeight: number;
    accent: THREE.ColorRepresentation;
  }
): void {
  const root = setpieceVisualRoot(mesh, "scaffold");
  const frameParts: ScaffoldVisualPart[] = [];
  appendScaffoldFrameParts(frameParts, config);
  const frameVisual = addSetpieceMergedVisualBoxes(root, "construction scaffold galvanized tube cage", frameParts, scaffoldTubeMaterial(), false);
  if (frameVisual) {
    disableSetpieceShadows(frameVisual);
  }
}

function appendScaffoldFrameParts(
  parts: ScaffoldVisualPart[],
  config: {
    width: number;
    depth: number;
    totalHeight: number;
    levels: number;
    bayHeight: number;
  }
): void {
  const tube = 0.055;
  const halfWidth = config.width * 0.5;
  const halfDepth = config.depth * 0.5;
  const verticalCenterY = 0;
  for (const x of [-halfWidth, halfWidth]) {
    for (const z of [-halfDepth, halfDepth]) {
      parts.push({
        size: new THREE.Vector3(tube, config.totalHeight, tube),
        position: new THREE.Vector3(x, verticalCenterY, z)
      });
    }
  }

  for (let level = 0; level <= config.levels; level += 1) {
    const y = -config.totalHeight * 0.5 + 0.24 + level * config.bayHeight;
    for (const z of [-halfDepth, halfDepth]) {
      parts.push({ size: new THREE.Vector3(config.width + tube, tube, tube), position: new THREE.Vector3(0, y, z) });
    }
    for (const x of [-halfWidth, halfWidth]) {
      parts.push({ size: new THREE.Vector3(tube, tube, config.depth + tube), position: new THREE.Vector3(x, y, 0) });
    }
  }

  const faceBraceLength = Math.hypot(config.width, config.bayHeight);
  const faceBraceAngle = Math.atan2(config.width, config.bayHeight);
  const sideBraceLength = Math.hypot(config.depth, config.bayHeight);
  const sideBraceAngle = Math.atan2(config.depth, config.bayHeight);
  for (let bay = 0; bay < config.levels; bay += 1) {
    const y = -config.totalHeight * 0.5 + 0.24 + bay * config.bayHeight + config.bayHeight * 0.5;
    const alternating = bay % 2 === 0 ? 1 : -1;
    for (const z of [-halfDepth, halfDepth]) {
      parts.push({
        size: new THREE.Vector3(tube, faceBraceLength, tube),
        position: new THREE.Vector3(0, y, z),
        rotation: new THREE.Euler(0, 0, faceBraceAngle * alternating)
      });
    }
    for (const x of [-halfWidth, halfWidth]) {
      parts.push({
        size: new THREE.Vector3(tube, sideBraceLength, tube),
        position: new THREE.Vector3(x, y, 0),
        rotation: new THREE.Euler(sideBraceAngle * alternating, 0, 0)
      });
    }
  }
}

function scaffoldShadowMaterial(): THREE.Material {
  return sharedLevelMaterial(
    "construction-scaffold-shadow-core",
    () => new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.02, depthWrite: false })
  );
}

function scaffoldTubeMaterial(): THREE.Material {
  return sharedLevelMaterial(
    "construction-scaffold-galvanized-tube",
    () => new THREE.MeshStandardMaterial({ color: 0xb2bec4, roughness: 0.34, metalness: 0.72, map: materialAtlasTile(10), envMapIntensity: 1.05 })
  );
}

function scaffoldPlankMaterial(): THREE.Material {
  return sharedLevelMaterial(
    "construction-scaffold-plank",
    () => new THREE.MeshStandardMaterial({ color: 0xc08a4a, roughness: 0.68, metalness: 0.04, map: materialAtlasTile(4) })
  );
}

function scaffoldNetMaterial(accent: THREE.ColorRepresentation): THREE.Material {
  return sharedLevelMaterial(
    `construction-scaffold-net:${String(accent)}`,
    () => new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.36, depthWrite: false, side: THREE.DoubleSide, alphaTest: 0.03 })
  );
}

function scaffoldWeakPointMaterial(): THREE.Material {
  return sharedLevelMaterial(
    "construction-scaffold-weak-point",
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xff5a38,
        roughness: 0.28,
        metalness: 0.52,
        emissive: 0xff2a12,
        emissiveIntensity: 0.56,
        map: materialAtlasTile(10)
      })
  );
}

function scaffoldHoistMaterial(): THREE.Material {
  return sharedLevelMaterial(
    "construction-scaffold-hoist",
    () => new THREE.MeshStandardMaterial({ color: 0x30383c, roughness: 0.42, metalness: 0.76, emissive: 0x2a1304, emissiveIntensity: 0.1, map: materialAtlasTile(10) })
  );
}

function scaffoldCanisterMaterial(): THREE.Material {
  return sharedLevelMaterial(
    "construction-scaffold-canister",
    () =>
      new THREE.MeshPhysicalMaterial({
        color: 0x9bf8ff,
        roughness: 0.18,
        metalness: 0.12,
        transparent: true,
        opacity: 0.82,
        emissive: 0x0d5b66,
        emissiveIntensity: 0.32,
        map: materialAtlasTile(8)
      })
  );
}

interface CranePartOptions {
  destructible?: boolean;
  canFracture?: boolean;
  fractureResistance?: number;
  supportGroupId?: string;
  supportReleaseRadius?: number;
  supportReleaseHeight?: number;
  supportReleaseLowerHeight?: number;
  supportReleaseFallDirection?: THREE.Vector3;
  supportReleaseImpulseScale?: number;
  supportReleaseTorqueScale?: number;
  supportReleaseMassScale?: number;
  impactVolumeScale?: number;
  scoreRole?: ScoreRole;
  zoneId?: string;
  compoundColliders?: Array<{
    size: THREE.Vector3;
    offset: THREE.Vector3;
    rotation?: THREE.Quaternion;
    density?: number;
    friction?: number;
    restitution?: number;
    collisionEvents?: boolean;
  }>;
}

function addCranePart(
  context: LevelContext,
  label: string,
  materialId: MaterialId,
  renderMaterial: THREE.Material,
  position: THREE.Vector3,
  size: THREE.Vector3,
  scoreValue: number,
  options: CranePartOptions = {}
): THREE.Mesh {
  const object = context.physics.addDynamicBox({
    label,
    material: context.materials.get(materialId),
    renderMaterial,
    position,
    size,
    compoundColliders: options.compoundColliders,
    category: "structure",
    scoreRole: options.scoreRole ?? "neutral",
    zoneId: options.zoneId ?? "central-construction-crane",
    supportGroupId: options.supportGroupId,
    supportReleaseRadius: options.supportReleaseRadius,
    supportReleaseHeight: options.supportReleaseHeight,
    supportReleaseLowerHeight: options.supportReleaseLowerHeight,
    supportReleaseFallDirection: options.supportReleaseFallDirection,
    supportReleaseImpulseScale: options.supportReleaseImpulseScale,
    supportReleaseTorqueScale: options.supportReleaseTorqueScale,
    supportReleaseMassScale: options.supportReleaseMassScale,
    impactVolumeScale: options.impactVolumeScale,
    canFracture: options.canFracture ?? true,
    fractureResistance: options.fractureResistance,
    destructible: options.destructible ?? true,
    bodyType: "fixed",
    scoreValue,
    chainSource: true,
    restitution: 0.12
  });
  object.mesh.userData.disposeMaterial = true;
  return object.mesh;
}

interface CraneWeakPointOptions {
  supportGroupId: string;
  supportReleaseRadius: number;
  supportReleaseHeight: number;
  supportReleaseLowerHeight?: number;
  supportReleaseFallDirection: THREE.Vector3;
  scoreValue: number;
}

function addCraneWeakPoint(
  context: LevelContext,
  label: string,
  position: THREE.Vector3,
  size: THREE.Vector3,
  options: CraneWeakPointOptions
): THREE.Mesh {
  const object = context.physics.addDynamicBox({
    label,
    material: context.materials.get("metal"),
    renderMaterial: craneWeakPointMaterial(),
    position,
    size,
    category: "structure",
    scoreRole: "target",
    zoneId: "central-construction-crane hazard-core",
    supportGroupId: options.supportGroupId,
    supportReleaseRadius: options.supportReleaseRadius,
    supportReleaseHeight: options.supportReleaseHeight,
    supportReleaseLowerHeight: options.supportReleaseLowerHeight,
    supportReleaseFallDirection: options.supportReleaseFallDirection,
    supportReleaseImpulseScale: 1.05,
    supportReleaseTorqueScale: 1.16,
    supportReleaseMassScale: 0.7,
    canFracture: true,
    destructible: true,
    fractureResistance: 0.18,
    bodyType: "fixed",
    scoreValue: options.scoreValue,
    chainSource: true,
    restitution: 0.08
  });
  object.mesh.userData.disposeMaterial = false;
  return object.mesh;
}

function craneWeakPointMaterial(): THREE.Material {
  return sharedLevelMaterial(
    "central-crane-weak-point",
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xff6b2e,
        roughness: 0.36,
        metalness: 0.46,
        emissive: 0xff2a12,
        emissiveIntensity: 0.48,
        map: materialAtlasTile(10)
      })
  );
}

function craneYellowMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({
    color: 0xffc64a,
    roughness: 0.38,
    metalness: 0.36,
    emissive: 0x6a3b00,
    emissiveIntensity: 0.2,
    map: materialAtlasTile(10)
  });
}

function hideCranePhysicsCore(mesh: THREE.Mesh): void {
  hideSetpiecePhysicsCore(mesh);
}

function hideSetpiecePhysicsCore(mesh: THREE.Mesh): void {
  if (!Array.isArray(mesh.material)) {
    mesh.material.dispose();
  }
  const hiddenMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  hiddenMaterial.visible = false;
  mesh.material = hiddenMaterial;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.disposeMaterial = true;
}

function disableSetpieceShadows(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = false;
    }
  });
}

function decorateCraneMastAssembly(
  mesh: THREE.Mesh,
  config: {
    mastBottomY: number;
    mastHeight: number;
    mastLevels: number;
    assemblyCenterY: number;
  }
): void {
  const root = craneVisualRoot(mesh);
  const localY = (worldY: number) => worldY - config.assemblyCenterY;
  const mastVisualHeight = config.mastLevels * config.mastHeight;
  const mastVisualCenterY = localY(config.mastBottomY + mastVisualHeight * 0.5);
  addCraneMergedVisualBoxes(
    root,
    "construction crane mast corner posts",
    [
      { size: new THREE.Vector3(0.055, mastVisualHeight, 0.055), position: new THREE.Vector3(-0.28, mastVisualCenterY, -0.28) },
      { size: new THREE.Vector3(0.055, mastVisualHeight, 0.055), position: new THREE.Vector3(-0.28, mastVisualCenterY, 0.28) },
      { size: new THREE.Vector3(0.055, mastVisualHeight, 0.055), position: new THREE.Vector3(0.28, mastVisualCenterY, -0.28) },
      { size: new THREE.Vector3(0.055, mastVisualHeight, 0.055), position: new THREE.Vector3(0.28, mastVisualCenterY, 0.28) }
    ],
    craneYellowMaterial()
  );
  const braceParts: Array<{ size: THREE.Vector3; position: THREE.Vector3; rotation?: THREE.Euler }> = [];
  for (let level = 0; level < config.mastLevels; level += 1) {
    const y = localY(config.mastBottomY + level * config.mastHeight + config.mastHeight * 0.5);
    appendCraneMastBraceParts(braceParts, y, config.mastHeight);
  }
  addCraneMergedVisualBoxes(
    root,
    "construction crane mast braces",
    braceParts,
    new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.54, metalness: 0.58, map: materialAtlasTile(10) })
  );
}

function appendCraneMastBraceParts(
  parts: Array<{ size: THREE.Vector3; position: THREE.Vector3; rotation?: THREE.Euler }>,
  localY: number,
  height: number
): void {
  for (const rotationZ of [Math.PI * 0.22, -Math.PI * 0.22]) {
    parts.push({
      size: new THREE.Vector3(0.055, height * 1.04, 0.055),
      position: new THREE.Vector3(0, localY, 0),
      rotation: new THREE.Euler(0, 0, rotationZ)
    });
  }
  for (const y of [localY - height * 0.48, localY + height * 0.48]) {
    parts.push({
      size: new THREE.Vector3(0.58, 0.05, 0.05),
      position: new THREE.Vector3(0, y, 0)
    });
    parts.push({
      size: new THREE.Vector3(0.05, 0.05, 0.58),
      position: new THREE.Vector3(0, y, 0)
    });
  }
}

function decorateCraneBoomAssembly(
  mesh: THREE.Mesh,
  config: {
    topY: number;
    boomCenterY: number;
    boomLength: number;
    boomCenterX: number;
    counterJibLength: number;
    counterJibCenterX: number;
    counterweightX: number;
    hookX: number;
    hookCenterY: number;
    hookSize: THREE.Vector3;
  }
): void {
  const root = craneVisualRoot(mesh);
  const localY = (worldY: number) => worldY - config.boomCenterY;
  const cableTopY = config.topY + 0.28;
  const cableBottomY = config.hookCenterY + config.hookSize.y * 0.5 - 0.03;
  const cableHeight = cableTopY - cableBottomY;
  addCraneVisualBox(
    root,
    "construction crane slewing deck",
    new THREE.Vector3(0.9, 0.4, 0.9),
    craneYellowMaterial(),
    new THREE.Vector3(0, localY(config.topY + 0.2), 0)
  );
  const jib = addCraneVisualBox(
    root,
    "construction crane jib",
    new THREE.Vector3(config.boomLength, 0.07, 0.1),
    craneYellowMaterial(),
    new THREE.Vector3(config.boomCenterX, localY(config.topY + 0.35), 0)
  );
  decorateCraneBoom(jib, config.boomLength);

  const counterJib = addCraneVisualBox(
    root,
    "construction crane counter-jib",
    new THREE.Vector3(config.counterJibLength, 0.07, 0.12),
    craneYellowMaterial(),
    new THREE.Vector3(config.counterJibCenterX, localY(config.topY + 0.35), 0)
  );
  decorateCraneBoom(counterJib, config.counterJibLength);

  addCraneVisualBox(
    root,
    "construction crane counterweight",
    new THREE.Vector3(0.9, 0.9, 0.78),
    new THREE.MeshStandardMaterial({ color: 0x2f3539, roughness: 0.8, metalness: 0.08, map: materialAtlasTile(6) }),
    new THREE.Vector3(config.counterweightX, localY(config.topY + 0.04), 0)
  );
  addCraneVisualBox(
    root,
    "construction crane cab",
    new THREE.Vector3(0.88, 0.58, 0.58),
    new THREE.MeshStandardMaterial({
      color: 0x84dff2,
      roughness: 0.26,
      metalness: 0.18,
      transparent: true,
      opacity: 0.78,
      emissive: 0x08323a,
      emissiveIntensity: 0.22
    }),
    new THREE.Vector3(0.68, localY(config.topY - 0.08), -0.48)
  );
  addCraneVisualBox(
    root,
    "construction crane hoist trolley",
    new THREE.Vector3(0.58, 0.2, 0.52),
    new THREE.MeshStandardMaterial({ color: 0x20282d, roughness: 0.52, metalness: 0.68, map: materialAtlasTile(10) }),
    new THREE.Vector3(config.hookX, localY(config.topY + 0.18), 0)
  );
  addCraneVisualBox(
    root,
    "construction crane hoist cable",
    new THREE.Vector3(0.045, cableHeight, 0.045),
    new THREE.MeshStandardMaterial({ color: 0x11171b, roughness: 0.62, metalness: 0.64, map: materialAtlasTile(6) }),
    new THREE.Vector3(config.hookX, localY((cableTopY + cableBottomY) * 0.5), 0)
  );
  decorateCraneHook(root, {
    hookX: config.hookX,
    hookCenterY: config.hookCenterY,
    hookSize: config.hookSize,
    localY
  });
}

function addCraneVisualBox(
  parent: THREE.Object3D,
  name: string,
  size: THREE.Vector3,
  material: THREE.Material,
  position: THREE.Vector3
): THREE.Mesh {
  return addSetpieceVisualBox(parent, name, size, material, position, true);
}

function addSetpieceVisualBox(
  parent: THREE.Object3D,
  name: string,
  size: THREE.Vector3,
  material: THREE.Material,
  position: THREE.Vector3,
  disposeMaterial: boolean
): THREE.Mesh {
  const mesh = new THREE.Mesh(sharedLevelBoxGeometry(size.x, size.y, size.z), material);
  mesh.name = name;
  mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.disposeMaterial = disposeMaterial;
  parent.add(mesh);
  return mesh;
}

function addCraneMergedVisualBoxes(
  parent: THREE.Object3D,
  name: string,
  parts: Array<{ size: THREE.Vector3; position: THREE.Vector3; rotation?: THREE.Euler }>,
  material: THREE.Material
): THREE.Mesh | null {
  return addSetpieceMergedVisualBoxes(parent, name, parts, material, true);
}

function addSetpieceMergedVisualBoxes(
  parent: THREE.Object3D,
  name: string,
  parts: Array<{ size: THREE.Vector3; position: THREE.Vector3; rotation?: THREE.Euler }>,
  material: THREE.Material,
  disposeMaterial: boolean
): THREE.Mesh | null {
  const geometries = parts.map((part) => {
    const geometry = new THREE.BoxGeometry(part.size.x, part.size.y, part.size.z);
    const rotation = part.rotation ? new THREE.Quaternion().setFromEuler(part.rotation) : new THREE.Quaternion();
    geometry.applyMatrix4(new THREE.Matrix4().compose(part.position, rotation, new THREE.Vector3(1, 1, 1)));
    return geometry;
  });
  const geometry = mergeGeometries(geometries, false);
  for (const partGeometry of geometries) {
    partGeometry.dispose();
  }
  if (!geometry) {
    if (disposeMaterial) {
      material.dispose();
    }
    return null;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.disposeMaterial = disposeMaterial;
  parent.add(mesh);
  return mesh;
}

function decorateCraneBoom(mesh: THREE.Mesh, length: number): void {
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.54, metalness: 0.58, map: materialAtlasTile(10) });
  const yellowRailMaterial = craneYellowMaterial();
  for (const y of [-0.17, 0.17]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(length * 0.96, 0.055, 0.055), yellowRailMaterial.clone());
    rail.name = "construction crane boom rail";
    rail.position.y = y;
    rail.userData.disposeMaterial = true;
    mesh.add(rail);
  }
  const braceCount = Math.max(2, Math.floor(length / 1.1));
  for (let index = 0; index < braceCount; index += 1) {
    const x = THREE.MathUtils.lerp(-length * 0.42, length * 0.42, braceCount === 1 ? 0.5 : index / (braceCount - 1));
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 0.05), railMaterial.clone());
    brace.name = "construction crane boom brace";
    brace.position.x = x;
    brace.rotation.z = index % 2 === 0 ? Math.PI * 0.18 : -Math.PI * 0.18;
    brace.userData.disposeMaterial = true;
    mesh.add(brace);
  }
}

function decorateCraneHook(
  parent: THREE.Object3D,
  config: {
    hookX: number;
    hookCenterY: number;
    hookSize: THREE.Vector3;
    localY(worldY: number): number;
  }
): void {
  const material = new THREE.MeshStandardMaterial({ color: 0x20282d, roughness: 0.48, metalness: 0.7, map: materialAtlasTile(10) });
  addCraneMergedVisualBoxes(
    parent,
    "construction crane hook assembly",
    [
      {
        size: new THREE.Vector3(config.hookSize.x * 1.08, config.hookSize.y * 0.78, config.hookSize.z * 1.55),
        position: new THREE.Vector3(config.hookX, config.localY(config.hookCenterY + 0.06), 0)
      },
      { size: new THREE.Vector3(0.08, 0.34, 0.08), position: new THREE.Vector3(config.hookX, config.localY(config.hookCenterY - 0.14), 0) },
      { size: new THREE.Vector3(0.3, 0.08, 0.08), position: new THREE.Vector3(config.hookX + 0.11, config.localY(config.hookCenterY - 0.32), 0) },
      { size: new THREE.Vector3(0.08, 0.18, 0.08), position: new THREE.Vector3(config.hookX + 0.25, config.localY(config.hookCenterY - 0.24), 0) }
    ],
    material
  );
}

function decorateCranePayload(mesh: THREE.Mesh, config: { size: THREE.Vector3; liftGap: number }): void {
  const root = craneVisualRoot(mesh);
  const hazardMaterial = new THREE.MeshBasicMaterial({ color: 0xffb22e, transparent: true, opacity: 0.96 });
  const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xff4f38, transparent: true, opacity: 0.82 });
  const riggingMaterial = new THREE.MeshStandardMaterial({ color: 0x10161a, roughness: 0.54, metalness: 0.72, map: materialAtlasTile(6) });
  const liftBarMaterial = craneYellowMaterial();
  const payloadTopY = config.size.y * 0.5;
  const liftRingY = payloadTopY + config.liftGap;
  const spreaderY = payloadTopY + 0.14;
  const slingX = config.size.x * 0.34;
  const slingZ = config.size.z * 0.34;

  addCraneVisualBox(
    root,
    "crane payload spreader beam",
    new THREE.Vector3(config.size.x * 0.92, 0.08, 0.12),
    liftBarMaterial,
    new THREE.Vector3(0, spreaderY, 0)
  );

  for (const [x, z] of [
    [-slingX, -slingZ],
    [-slingX, slingZ],
    [slingX, -slingZ],
    [slingX, slingZ]
  ] as const) {
    addCraneRiggingCable(
      root,
      "crane payload suspension sling",
      new THREE.Vector3(x, spreaderY, z),
      new THREE.Vector3(0, liftRingY, 0),
      0.045,
      riggingMaterial.clone()
    );
  }

  addCraneRiggingCable(
    root,
    "crane payload hook pendant",
    new THREE.Vector3(0, spreaderY + 0.02, 0),
    new THREE.Vector3(0, liftRingY + 0.16, 0),
    0.06,
    riggingMaterial.clone()
  );

  for (const z of [-0.56, 0.56]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.08, 0.035), hazardMaterial.clone());
    stripe.name = "crane payload hazard stripe";
    stripe.position.set(0, 0.12, z);
    stripe.userData.disposeMaterial = true;
    root.add(stripe);
  }
  for (const x of [-0.42, 0, 0.42]) {
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 1.16), glowMaterial.clone());
    latch.name = "crane payload armed latch";
    latch.position.set(x, 0.47, 0);
    latch.userData.disposeMaterial = true;
    root.add(latch);
  }
}

function addCraneRiggingCable(
  parent: THREE.Object3D,
  name: string,
  from: THREE.Vector3,
  to: THREE.Vector3,
  thickness: number,
  material: THREE.Material
): void {
  const delta = new THREE.Vector3().subVectors(to, from);
  const length = delta.length();
  if (length <= 0) {
    material.dispose();
    return;
  }

  const cable = new THREE.Mesh(new THREE.BoxGeometry(thickness, length, thickness), material);
  cable.name = name;
  cable.position.copy(from).addScaledVector(delta, 0.5);
  cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  cable.castShadow = true;
  cable.receiveShadow = true;
  cable.userData.disposeMaterial = true;
  parent.add(cable);
}

function craneVisualRoot(parent: THREE.Mesh): THREE.Object3D {
  return setpieceVisualRoot(parent, "crane");
}

function setpieceVisualRoot(parent: THREE.Mesh, detailName: string): THREE.Object3D {
  if (isUnitScale(parent.scale)) {
    return parent;
  }
  const userData = parent.userData as { setpieceVisualRoot?: THREE.Object3D };
  let root = userData.setpieceVisualRoot;
  if (!root) {
    root = new THREE.Object3D();
    root.name = `${parent.name || "setpiece part"} unscaled ${detailName} details`;
    userData.setpieceVisualRoot = root;
    parent.add(root);
  }
  root.scale.set(safeInverseScale(parent.scale.x), safeInverseScale(parent.scale.y), safeInverseScale(parent.scale.z));
  return root;
}

function isUnitScale(scale: THREE.Vector3): boolean {
  return Math.abs(scale.x - 1) < 0.000001 && Math.abs(scale.y - 1) < 0.000001 && Math.abs(scale.z - 1) < 0.000001;
}

function safeInverseScale(value: number): number {
  return Math.abs(value) > 0.000001 ? 1 / value : 1;
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

function spawnDenseDistrictBuildingRows(context: LevelContext, rows: readonly DenseDistrictBuildingRow[]): void {
  for (const [label, materialId, x, z, width, height, depth, floors, columns, style, zoneId, scoreValue, rotationY, stagger] of rows) {
    spawnCityBuildingStack(context, {
      label,
      materialId,
      position: new THREE.Vector3(x, 0, z),
      size: new THREE.Vector3(width, height, depth),
      floors,
      columns,
      scoreRole: "neutral",
      zoneId,
      scoreValue,
      style,
      rotationY,
      stagger
    });
  }
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
  return alignFootprintToCityPlacementBlockers(position, footprint, CITY_ROAD_CLEARANCE);
}

function alignCityObjectToRoadEdges(
  position: THREE.Vector3,
  size: THREE.Vector3,
  rotationY = 0,
  clearance = CITY_ROAD_CLEARANCE
): THREE.Vector3 {
  return alignFootprintToCityPlacementBlockers(position, cityObjectFootprint(size, rotationY), clearance);
}

function alignFootprintToCityPlacementBlockers(position: THREE.Vector3, footprint: { x: number; z: number }, clearance: number): THREE.Vector3 {
  return alignFootprintToBlockers(position, footprint, CITY_PLACEMENT_BLOCKERS, clearance);
}

function alignFootprintToBlockers(
  position: THREE.Vector3,
  footprint: { x: number; z: number },
  blockers: readonly CityRoadCorridor[],
  clearance: number
): THREE.Vector3 {
  const aligned = position.clone();
  for (let pass = 0; pass < 6; pass += 1) {
    let moved = false;
    for (const blocker of blockers) {
      const bounds = footprintBounds(aligned, footprint);
      if (
        !boundsOverlap(bounds.minX, bounds.maxX, blocker.minX, blocker.maxX) ||
        !boundsOverlap(bounds.minZ, bounds.maxZ, blocker.minZ, blocker.maxZ)
      ) {
        continue;
      }

      const before = aligned.clone();
      const after = aligned.clone();
      if (blocker.axis === "x") {
        before.x = blocker.minX - footprint.x * 0.5 - clearance;
        after.x = blocker.maxX + footprint.x * 0.5 + clearance;
      } else {
        before.z = blocker.minZ - footprint.z * 0.5 - clearance;
        after.z = blocker.maxZ + footprint.z * 0.5 + clearance;
      }
      aligned.copy(
        alignmentCandidateScore(aligned, before, footprint, blockers) <= alignmentCandidateScore(aligned, after, footprint, blockers)
          ? before
          : after
      );
      moved = true;
    }
    if (!moved) {
      break;
    }
  }
  return aligned;
}

function footprintBounds(position: THREE.Vector3, footprint: { x: number; z: number }): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: position.x - footprint.x * 0.5,
    maxX: position.x + footprint.x * 0.5,
    minZ: position.z - footprint.z * 0.5,
    maxZ: position.z + footprint.z * 0.5
  };
}

function alignmentCandidateScore(
  current: THREE.Vector3,
  candidate: THREE.Vector3,
  footprint: { x: number; z: number },
  blockers: readonly CityRoadCorridor[]
): number {
  const bounds = footprintBounds(candidate, footprint);
  let overlapPenalty = 0;
  for (const blocker of blockers) {
    if (boundsOverlap(bounds.minX, bounds.maxX, blocker.minX, blocker.maxX) && boundsOverlap(bounds.minZ, bounds.maxZ, blocker.minZ, blocker.maxZ)) {
      overlapPenalty += 1;
    }
  }
  return current.distanceToSquared(candidate) + overlapPenalty * 10_000;
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
      const brittleGlassTower = spec.materialId === "glass" && spec.style === "glassTower";
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
        fractureResistance: brittleGlassTower ? 0.46 : 1,
        friction: brittleGlassTower ? 0.28 : Math.max(0.86, material.friction),
        restitution: brittleGlassTower ? 0.32 : Math.min(0.08, material.restitution),
        linearDamping: brittleGlassTower ? 0.34 : isRagdollStructure ? 0.58 : 0.72,
        angularDamping: brittleGlassTower ? 0.58 : isRagdollStructure ? 1.05 : 1.35,
        additionalMass: groupSize.x * groupSize.y * groupSize.z * (brittleGlassTower ? 1.05 : isRagdollStructure ? 3.3 : 3.8),
        ccd: isRagdollStructure && !brittleGlassTower
      });
      decorateBuildingCell(object.mesh, {
        size: groupSize,
        materialId: spec.materialId,
        scoreRole: spec.scoreRole,
        style: spec.style,
        brand: spec.brand,
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
  const tint = role === "target" ? targetTintForMaterial(materialId) : null;
  if (tint && (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial || material instanceof THREE.MeshBasicMaterial)) {
    material.color.lerp(tint, 0.34);
    if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
      material.emissive = tint.clone().multiplyScalar(0.08);
      material.emissiveIntensity = 0.22;
    }
  }
  material.userData.sharedRoleRenderMaterial = true;
  roleRenderMaterialCache.set(cacheKey, material);
  return material;
}

function targetTintForMaterial(materialId: MaterialId): THREE.Color {
  switch (materialId) {
    case "glass":
      return new THREE.Color(0xffa15d);
    case "metal":
      return new THREE.Color(0xffb65d);
    case "concrete":
      return new THREE.Color(0xd88951);
    case "wood":
      return new THREE.Color(0xff9b4f);
    case "foam":
      return new THREE.Color(0xffcf72);
    case "rubber":
      return new THREE.Color(0xff6a7d);
  }
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
    { name: "east curb scuff", x: 13.25, z: -4.65, width: 0.5, depth: 1.55, tile: 7, color: 0x8c969b, opacity: 0.3, rotation: -0.08 },
    { name: "north tanker tire sweep", x: -5.4, z: -7.24, width: 2.8, depth: 0.34, tile: 9, color: 0x0c1114, opacity: 0.36, rotation: -0.08 },
    { name: "east service tire sweep", x: 10.16, z: -5.2, width: 0.34, depth: 2.7, tile: 9, color: 0x0c1114, opacity: 0.36, rotation: 0.04 },
    { name: "central avenue bus brake left", x: -0.34, z: -5.85, width: 0.3, depth: 2.55, tile: 9, color: 0x0c1114, opacity: 0.36, rotation: 0.02 },
    { name: "central avenue bus brake right", x: 0.28, z: -5.78, width: 0.3, depth: 2.48, tile: 9, color: 0x0c1114, opacity: 0.36, rotation: 0.03 },
    { name: "cross boulevard turn skid", x: -4.2, z: -1.55, width: 2.6, depth: 0.3, tile: 9, color: 0x0c1114, opacity: 0.36, rotation: -0.08 },
    { name: "south service delivery skid", x: 3.45, z: 5.05, width: 2.15, depth: 0.28, tile: 9, color: 0x0c1114, opacity: 0.36, rotation: 0.04 },
    { name: "west road asphalt patch", x: -10.68, z: -1.05, width: 0.72, depth: 1.22, tile: 12, color: 0x182128, opacity: 0.45, rotation: -0.12 },
    { name: "central avenue asphalt patch", x: 0.12, z: 2.85, width: 0.86, depth: 1.45, tile: 12, color: 0x182128, opacity: 0.42, rotation: 0.08 },
    { name: "north service asphalt scar", x: 6.4, z: -7.22, width: 1.5, depth: 0.5, tile: 12, color: 0x182128, opacity: 0.42, rotation: 0.04 },
    { name: "east service patched stop", x: 10.08, z: 4.4, width: 0.62, depth: 1.35, tile: 12, color: 0x182128, opacity: 0.42, rotation: -0.02 },
    { name: "south service repair seam", x: 7.1, z: 5.04, width: 2.25, depth: 0.18, tile: 7, color: 0x98a7ad, opacity: 0.24, rotation: 0.02 },
    { name: "battery deck grime fan", x: 0.55, z: 16.85, width: 4.2, depth: 1.6, tile: 9, color: 0x0d1114, opacity: 0.28, rotation: -0.05 },
    { name: "gas station hazard paint", x: -6.8, z: -3.85, width: 1.75, depth: 0.44, tile: 3, color: 0xffc75c, opacity: 0.36, rotation: -0.18 },
    { name: "power-grid service paint", x: 6.95, z: -2.95, width: 1.35, depth: 0.42, tile: 3, color: 0x8feeff, opacity: 0.28, rotation: 0.24 },
    { name: "parking silo entry arrow", x: -13.6, z: 0.3, width: 1.45, depth: 0.46, tile: 5, color: 0xffd873, opacity: 0.42, rotation: -Math.PI * 0.5 },
    { name: "metro underpass dust", x: 0.8, z: -6.25, width: 6.6, depth: 0.55, tile: 12, color: 0x111719, opacity: 0.26, rotation: 0 },
    { name: "south apron cargo stain", x: -5.6, z: 11.85, width: 1.55, depth: 0.62, tile: 9, color: 0x10161b, opacity: 0.32, rotation: 0.22 },
    { name: "east depot drain", x: 12.15, z: 7.15, width: 0.5, depth: 0.5, tile: 10, color: 0x7b8990, opacity: 0.42, rotation: -Math.PI * 0.18 },
    { name: "west curb repair marker", x: -13.2, z: 6.75, width: 0.48, depth: 1.8, tile: 7, color: 0x8c969b, opacity: 0.26, rotation: 0.08 },
    { name: "north curb repair marker", x: 4.8, z: -8.56, width: 1.65, depth: 0.42, tile: 7, color: 0x8c969b, opacity: 0.26, rotation: -0.02 },
    { name: "east curb loading scuff", x: 13.2, z: 1.35, width: 0.42, depth: 1.65, tile: 7, color: 0x8c969b, opacity: 0.26, rotation: 0.04 },
    { name: "central crosswalk soot", x: 2.7, z: -1.28, width: 1.1, depth: 0.24, tile: 9, color: 0x0d1114, opacity: 0.24, rotation: 0 },
    { name: "battery access road arrow", x: -6.25, z: 8.35, width: 1.05, depth: 0.4, tile: 5, color: 0xffd873, opacity: 0.36, rotation: Math.PI * 0.5 },
    { name: "cross boulevard loading stencil", x: -3.6, z: -1.05, width: 1.55, depth: 0.76, tile: 15, color: 0xd8e2e5, opacity: 0.34, rotation: 0 },
    { name: "east depot loading stencil", x: 11.95, z: 4.25, width: 0.72, depth: 1.55, tile: 15, color: 0xd8e2e5, opacity: 0.3, rotation: Math.PI * 0.5 },
    { name: "central bus stop ghost paint", x: -0.9, z: -5.75, width: 1.5, depth: 0.48, tile: 15, color: 0xf0c96a, opacity: 0.28, rotation: 0 },
    { name: "underpass broken glass", x: 3.85, z: -6.05, width: 1.12, depth: 0.58, tile: 8, color: 0xaeefff, opacity: 0.24, rotation: -0.24 },
    { name: "south apron scorch bloom", x: 4.9, z: 10.85, width: 1.34, depth: 0.9, tile: 4, color: 0x0a0d0f, opacity: 0.28, rotation: 0.12 }
  ] as const;
  const decalBatches = new Map<string, { color: THREE.ColorRepresentation; opacity: number; geometries: THREE.BufferGeometry[] }>();
  const atlasTexture = graphicTexture("decalAtlas", {
    wrap: THREE.ClampToEdgeWrapping,
    colorSpace: THREE.SRGBColorSpace,
    anisotropy: 4
  });

  for (const decal of decals) {
    const opacity = decalOpacityBand(decal.opacity);
    const batchKey = `${decal.tile}:${opacity}:${decal.color}`;
    const batch = decalBatches.get(batchKey);
    const geometry = new THREE.PlaneGeometry(decal.width, decal.depth);
    setDecalAtlasGeometryUvs(geometry, decal.tile);
    geometry.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(decal.x, CITY_GROUND_DECAL_Y, decal.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI * 0.5, 0, decal.rotation)),
        new THREE.Vector3(1, 1, 1)
      )
    );
    if (batch) {
      batch.geometries.push(geometry);
    } else {
      decalBatches.set(batchKey, { color: decal.color, opacity, geometries: [geometry] });
    }
  }

  for (const { color, opacity, geometries } of decalBatches.values()) {
    const mergedGeometry = mergeGeometries(geometries, false);
    for (const geometry of geometries) {
      geometry.dispose();
    }
    if (!mergedGeometry) {
      continue;
    }
    const material = new THREE.MeshBasicMaterial({
      color,
      map: atlasTexture,
      transparent: true,
      opacity,
      depthWrite: false,
      alphaTest: 0.03,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(mergedGeometry, material);
    mesh.name = `road decal batch ${Math.round(opacity * 100)}`;
    mesh.renderOrder = CITY_GROUND_LAYER_MARKINGS + 1;
    mesh.userData.disposeMaterial = true;
    context.addDecoration(mesh);
  }
}

function decalOpacityBand(opacity: number): number {
  return THREE.MathUtils.clamp(Math.round(opacity * 10) / 10, 0.2, 0.6);
}

function setDecalAtlasGeometryUvs(geometry: THREE.PlaneGeometry, tileIndex: number): void {
  const columns = 4;
  const rows = 4;
  const tileX = tileIndex % columns;
  const tileY = Math.floor(tileIndex / columns);
  const minU = tileX / columns;
  const maxU = (tileX + 1) / columns;
  const minV = 1 - (tileY + 1) / rows;
  const maxV = 1 - tileY / rows;
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([minU, maxV, maxU, maxV, minU, minV, maxU, minV], 2));
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

  const streetDressing = [
    ["Sidewalk transformer cabinet", "metal", -8.85, -1.05, 0.42, 0.72, 0.34, Math.PI * 0.5],
    ["Bus shelter panel", "glass", 6.55, -0.1, 0.74, 0.5, 0.18, Math.PI * 0.5]
  ] as const;

  for (const [label, materialId, x, z, width, height, depth, rotationY] of streetDressing) {
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
  object.mesh.castShadow = false;
  decorateCityVehicle(object.mesh, {
    size,
    accent,
    kind: cityVehicleVisualKind(label),
    detail: options.detail ?? (options.hazardKind ? "full" : "lean")
  });
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
  const groundMap = groundPanelMaterialMap(color, opacity);
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
          map: groundMap,
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

function groundPanelMaterialMap(color: THREE.ColorRepresentation, opacity: number): THREE.Texture | undefined {
  if (opacity < 1 || typeof color !== "number") {
    return undefined;
  }
  if (color === CITY_ROAD_SURFACE_COLOR) {
    return materialAtlasTile(6);
  }
  if (color === CITY_GROUND_COLOR || color === CITY_BLOCK_APRON_COLOR || color === 0x171f25) {
    return materialAtlasTile(12);
  }
  return undefined;
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

function sharedLevelRingGeometry(innerRadius: number, outerRadius: number, thetaSegments = 80): THREE.RingGeometry {
  const key = `${innerRadius.toFixed(3)}:${outerRadius.toFixed(3)}:${thetaSegments}`;
  const existing = sharedLevelRingGeometries.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, thetaSegments);
  geometry.userData.sharedGeometry = true;
  sharedLevelRingGeometries.set(key, geometry);
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

  const headMaterial = sharedLevelMaterial(
    "street-light-head",
    () => new THREE.MeshStandardMaterial({ color: 0x2f3a40, roughness: 0.44, metalness: 0.58, emissive: 0x2c1903, emissiveIntensity: 0.025, map: materialAtlasTile(10) })
  );
  const head = new THREE.Mesh(sharedLevelBoxGeometry(0.48, 0.1, 0.18), headMaterial);
  head.name = "street light bracketed head";
  head.position.set(0.3, 0.66, 0);
  head.userData.disposeMaterial = false;
  pole.mesh.add(head);

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
  const glowMaterial = sharedLevelMaterial("billboard-glow", () => new THREE.MeshBasicMaterial({ color: 0xffd891, transparent: true, opacity: 0.24 }));
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
