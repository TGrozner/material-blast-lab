import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { MaterialId } from "./materialCatalog";
import { perfMonitor } from "./perf";
import type { ScoreRole } from "./physics";
import { decalAtlasTile, materialAtlasTile } from "./visualAssets";

export type BuildingVisualStyle = "industrial" | "glassTower" | "civic" | "utility" | "apartment" | "warehouse" | "market";
export type BuildingBrand = "pear" | "cloudnine" | "hexxon" | "omnitech";

interface BuildingCellVisualOptions {
  size: THREE.Vector3;
  materialId: MaterialId;
  scoreRole: ScoreRole;
  style: BuildingVisualStyle;
  floor: number;
  column: number;
  floors: number;
  columns: number;
  brand?: BuildingBrand;
}

export interface FragmentVisualOptions {
  size: THREE.Vector3;
  materialId: MaterialId;
}

export interface FragmentVisualPart {
  size: THREE.Vector3;
  offset: THREE.Vector3;
  rotation: THREE.Euler;
  material: THREE.Material;
}

interface VehicleVisualOptions {
  size: THREE.Vector3;
  accent: THREE.ColorRepresentation;
  detail?: "full" | "lean";
  kind?: "car" | "van" | "bus" | "tanker" | "taxi" | "flatbed";
}

interface StreetCargoVisualOptions {
  size: THREE.Vector3;
  materialId: MaterialId;
  detail?: "full" | "lean";
}

interface TrafficBarricadeVisualOptions {
  size: THREE.Vector3;
  detail?: "full" | "lean";
}

interface HazardIndicatorOptions {
  size: THREE.Vector3;
  kind: "explosive" | "electric" | "combustible";
}

interface StrategicHazardVisualOptions {
  label: string;
  size: THREE.Vector3;
  kind: HazardIndicatorOptions["kind"];
}

const sharedMaterials = new Map<string, THREE.Material>();
const childBoxGeometryCache = new Map<string, THREE.BoxGeometry>();
const childCylinderGeometryCache = new Map<string, THREE.CylinderGeometry>();
const childSphereGeometryCache = new Map<string, THREE.SphereGeometry>();

interface DetailRootUserData {
  unscaledDetailRoot?: THREE.Object3D;
  fragmentVisualParts?: THREE.Mesh[];
}

export function decorateBuildingCell(mesh: THREE.Mesh, options: BuildingCellVisualOptions): void {
  const palette = paletteFor(options.style, options.scoreRole);
  if (options.scoreRole === "neutral") {
    decorateNeutralBuildingCell(mesh, options, palette);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  addFacadeSkin(mesh, options.size, palette.facade, 0.016);
  addWindowRows(mesh, options);
  addVerticalTrim(mesh, options.size, palette.trim, options.column === 0, options.column === options.columns - 1);
  addPremiumFacadeDetails(mesh, options, palette.sign);

  if (options.floor === 0) {
    addStorefront(mesh, options.size, palette.sign, options.style, options.column);
  }
  if (options.floor === options.floors - 1) {
    addRoofDetail(mesh, options, palette.roof);
  }
  mergeOpaqueDecorativeChildrenByMaterial(mesh);
}

function decorateNeutralBuildingCell(
  mesh: THREE.Mesh,
  options: BuildingCellVisualOptions,
  palette: { facade: THREE.Material; trim: THREE.Material; roof: THREE.Material; sign: THREE.Material }
): void {
  const isGround = options.floor <= 1;
  const isTop = options.floor >= options.floors - 1;
  const isEdgeColumn = options.column === 0 || options.column === options.columns - 1;
  const isFeatureBand = (options.floor + options.column) % 4 === 0;

  if (isGround || isTop || (isEdgeColumn && isFeatureBand)) {
    addNeutralFacadeSkin(mesh, options.size, palette.facade);
    addNeutralWindowBand(mesh, options, palette.trim);
  }
  if (isGround && (options.column % 2 === 0 || isEdgeColumn)) {
    addNeutralStorefront(mesh, options.size, palette.sign, options.style);
  }
  if (options.brand && (isGround || isTop) && options.column === 0) {
    addFauxBrandSign(mesh, options.size, options.brand, isTop ? "crown" : "storefront");
  }
  if (options.brand && options.column === 0 && isTop) {
    addFacadeDepthBreaks(mesh, options, palette.trim);
  }
  if (isTop) {
    addNeutralRoofDetail(mesh, options.size, palette.roof);
  }
}

export function fragmentDecorationParts(options: FragmentVisualOptions): FragmentVisualPart[] {
  if (options.materialId === "glass") {
    return [
      {
        size: new THREE.Vector3(options.size.x * 0.88, Math.max(0.012, options.size.y * 0.24), options.size.z * 1.08),
        offset: new THREE.Vector3(0, options.size.y * 0.18, options.size.z * 0.08),
        rotation: new THREE.Euler(),
        material: material("glass_shard")
      }
    ];
  }

  if (options.materialId === "metal") {
    return [
      {
        size: new THREE.Vector3(options.size.x * 0.38, options.size.y * 0.38, options.size.z * 1.22),
        offset: new THREE.Vector3(options.size.x * 0.12, options.size.y * 0.08, 0),
        rotation: new THREE.Euler(0, 0, Math.PI * 0.08),
        material: material("scraped_metal")
      }
    ];
  }

  if (options.materialId === "concrete") {
    return [
      {
        size: new THREE.Vector3(options.size.x * 0.44, options.size.y * 0.18, Math.max(0.05, options.size.z * 0.28)),
        offset: new THREE.Vector3(-options.size.x * 0.12, options.size.y * 0.28, options.size.z * 0.46),
        rotation: new THREE.Euler(),
        material: material("rubble_dark")
      },
      {
        size: new THREE.Vector3(Math.max(0.04, options.size.x * 0.18), options.size.y * 0.34, Math.max(0.04, options.size.z * 0.18)),
        offset: new THREE.Vector3(options.size.x * 0.3, -options.size.y * 0.18, -options.size.z * 0.38),
        rotation: new THREE.Euler(),
        material: material("rubble_light")
      }
    ];
  }

  if (options.materialId === "wood") {
    return [
      {
        size: new THREE.Vector3(options.size.x * 0.22, options.size.y * 1.06, options.size.z * 0.92),
        offset: new THREE.Vector3(options.size.x * 0.4, 0, 0),
        rotation: new THREE.Euler(0, Math.PI * 0.04, 0),
        material: material("wood_end")
      }
    ];
  }

  if (options.materialId === "foam") {
    return [
      {
        size: new THREE.Vector3(options.size.x * 0.7, options.size.y * 0.16, options.size.z * 0.7),
        offset: new THREE.Vector3(0, options.size.y * 0.42, 0),
        rotation: new THREE.Euler(),
        material: material("painted_plastic")
      }
    ];
  }

  return [];
}

export function decorateFragment(mesh: THREE.Mesh, options: FragmentVisualOptions): void {
  const parts = fragmentDecorationParts(options);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    setFragmentChildBox(mesh, index, part.size.x, part.size.y, part.size.z, part.material, {
      x: part.offset.x,
      y: part.offset.y,
      z: part.offset.z,
      rotationX: part.rotation.x,
      rotationY: part.rotation.y,
      rotationZ: part.rotation.z
    });
  }
  hideUnusedFragmentChildBoxes(mesh, parts.length);
}

export function decorateCityVehicle(mesh: THREE.Mesh, options: VehicleVisualOptions): void {
  const glass = material("vehicle_glass");
  const tire = material("tire");
  const accent = colorMaterial(`vehicle_accent_${String(options.accent)}`, options.accent, 0.35, 0.12);
  const kind = options.kind ?? "car";

  addChildBox(mesh, options.size.x * 0.92, options.size.y * 0.16, options.size.z * 0.72, material("vehicle_lower_shadow"), {
    y: -options.size.y * 0.34
  });
  addChildBox(mesh, options.size.x * 0.64, options.size.y * 0.3, options.size.z * 0.52, glass, {
    y: options.size.y * 0.22,
    z: -options.size.z * 0.02
  });
  addChildBox(mesh, options.size.x * 0.54, 0.028, options.size.z * 0.62, material("vehicle_roof_panel"), {
    y: options.size.y * 0.43,
    z: -options.size.z * 0.03
  });
  addChildBox(mesh, options.size.x * 1.04, options.size.y * 0.16, 0.035, accent, {
    y: -options.size.y * 0.12,
    z: options.size.z * 0.53
  });
  addChildBox(mesh, options.size.x * 1.06, 0.035, options.size.z * 0.08, accent, {
    y: options.size.y * 0.04,
    z: -options.size.z * 0.5
  });
  addVehicleKindDetails(mesh, options.size, kind, accent, glass);
  addChildBox(mesh, 0.024, options.size.y * 0.38, options.size.z * 0.82, material("vehicle_door_cut"), {
    x: -options.size.x * 0.36,
    y: -options.size.y * 0.03
  });
  addChildBox(mesh, 0.024, options.size.y * 0.38, options.size.z * 0.82, material("vehicle_door_cut"), {
    x: options.size.x * 0.36,
    y: -options.size.y * 0.03
  });
  if (options.detail === "lean") {
    addVehicleTires(mesh, options.size, tire);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  addChildBox(mesh, options.size.x * 0.78, 0.035, 0.026, material("vehicle_lightbar"), {
    y: options.size.y * 0.45,
    z: options.size.z * 0.16
  });
  addChildBox(mesh, options.size.x * 0.2, 0.05, 0.026, material("headlight"), {
    x: -options.size.x * 0.28,
    y: -options.size.y * 0.02,
    z: options.size.z * 0.55
  });
  addChildBox(mesh, options.size.x * 0.2, 0.05, 0.026, material("headlight"), {
    x: options.size.x * 0.28,
    y: -options.size.y * 0.02,
    z: options.size.z * 0.55
  });
  addChildBox(mesh, options.size.x * 0.18, 0.04, 0.026, material("taillight"), {
    x: -options.size.x * 0.3,
    y: -options.size.y * 0.02,
    z: -options.size.z * 0.55
  });
  addChildBox(mesh, options.size.x * 0.18, 0.04, 0.026, material("taillight"), {
    x: options.size.x * 0.3,
    y: -options.size.y * 0.02,
    z: -options.size.z * 0.55
  });
  addChildBox(mesh, options.size.x * 0.22, 0.055, 0.026, material("license_plate"), {
    y: -options.size.y * 0.18,
    z: options.size.z * 0.56
  });
  addChildBox(mesh, options.size.x * 0.28, 0.026, 0.028, material("license_plate"), {
    y: -options.size.y * 0.16,
    z: -options.size.z * 0.56
  });
  addChildBox(mesh, 0.022, options.size.y * 0.46, options.size.z * 0.72, material("vehicle_seam"), {
    x: -options.size.x * 0.08,
    y: -options.size.y * 0.02
  });
  addChildBox(mesh, 0.022, options.size.y * 0.46, options.size.z * 0.72, material("vehicle_seam"), {
    x: options.size.x * 0.08,
    y: -options.size.y * 0.02
  });
  if (options.size.x > 0.7) {
    addChildBox(mesh, options.size.x * 0.72, 0.035, 0.04, material("roof_rail"), {
      y: options.size.y * 0.54,
      z: -options.size.z * 0.2
    });
  } else if (options.size.z > 1.05) {
    addChildBox(mesh, options.size.x * 0.78, 0.038, options.size.z * 0.62, material("roof_rail"), {
      y: options.size.y * 0.52
    });
  }
  addVehicleTires(mesh, options.size, tire);
  mergeOpaqueDecorativeChildrenByMaterial(mesh);
}

function addVehicleKindDetails(
  mesh: THREE.Mesh,
  size: THREE.Vector3,
  kind: NonNullable<VehicleVisualOptions["kind"]>,
  accent: THREE.Material,
  glass: THREE.Material
): void {
  if (kind === "taxi") {
    addChildBox(mesh, size.x * 0.38, 0.055, size.z * 0.18, material("taxi_roof_sign"), {
      y: size.y * 0.55,
      z: -size.z * 0.04
    });
    return;
  }
  if (kind === "bus") {
    for (const z of [-0.28, 0, 0.28]) {
      addChildBox(mesh, size.x * 0.82, size.y * 0.18, 0.02, glass, {
        y: size.y * 0.18,
        z: z * size.z
      });
    }
    addChildBox(mesh, size.x * 0.84, 0.05, size.z * 0.84, material("bus_roof_vent"), {
      y: size.y * 0.56
    });
    return;
  }
  if (kind === "tanker") {
    addChildCylinder(mesh, size.x * 0.36, size.x * 0.36, size.z * 0.82, material("tanker_shell"), {
      y: size.y * 0.14,
      rotationX: Math.PI * 0.5
    });
    addChildBox(mesh, size.x * 0.78, 0.04, size.z * 0.82, accent, {
      y: size.y * 0.14
    });
    return;
  }
  if (kind === "flatbed") {
    addChildBox(mesh, size.x * 0.96, 0.055, size.z * 0.74, material("flatbed_deck"), {
      y: size.y * 0.04,
      z: -size.z * 0.08
    });
    addChildBox(mesh, size.x * 0.56, size.y * 0.28, size.z * 0.26, accent, {
      y: size.y * 0.2,
      z: size.z * 0.22
    });
    return;
  }
  if (kind === "van") {
    addChildBox(mesh, size.x * 0.82, size.y * 0.22, size.z * 0.16, glass, {
      y: size.y * 0.16,
      z: -size.z * 0.34
    });
    addChildBox(mesh, size.x * 0.72, 0.035, size.z * 0.86, material("roof_rail"), {
      y: size.y * 0.54
    });
  }
}

export function decorateStreetCargo(mesh: THREE.Mesh, options: StreetCargoVisualOptions): void {
  const strapMaterial = material("cargo_strap");
  const labelMaterial = options.materialId === "glass" ? material("cool_sign") : options.materialId === "wood" ? material("market_sign") : material("hazard_chevron");
  addChildBox(mesh, options.size.x * 1.02, 0.035, options.size.z * 1.02, material("cargo_top_wear"), {
    y: options.size.y * 0.5 + 0.02
  });
  addChildBox(mesh, options.size.x * 1.04, 0.026, 0.035, strapMaterial, {
    y: options.size.y * 0.18,
    z: options.size.z * 0.34
  });
  addChildBox(mesh, 0.035, options.size.y * 0.88, 0.035, strapMaterial, {
    x: -options.size.x * 0.48,
    y: 0.01,
    z: options.size.z * 0.42
  });
  addChildBox(mesh, 0.035, options.size.y * 0.88, 0.035, strapMaterial, {
    x: options.size.x * 0.48,
    y: 0.01,
    z: -options.size.z * 0.42
  });
  addChildBox(mesh, options.size.x * 0.42, options.size.y * 0.24, 0.024, labelMaterial, {
    y: options.size.y * 0.04,
    z: options.size.z * 0.51
  });
  if (options.detail === "lean") {
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  addChildBox(mesh, options.size.x * 1.04, 0.026, 0.035, strapMaterial, {
    y: options.size.y * 0.18,
    z: -options.size.z * 0.34
  });
  if (options.materialId === "metal") {
    addChildBox(mesh, options.size.x * 0.68, 0.03, options.size.z * 1.05, material("scraped_metal"), {
      y: options.size.y * 0.42
    });
  }
  mergeOpaqueDecorativeChildrenByMaterial(mesh);
}

export function decorateTrafficBarricade(mesh: THREE.Mesh, options: TrafficBarricadeVisualOptions): void {
  addChildBox(mesh, options.size.x * 0.86, 0.07, 0.024, material("hazard_chevron"), {
    y: options.size.y * 0.12,
    z: options.size.z * 0.55
  });
  if (options.detail !== "lean") {
    addChildBox(mesh, 0.08, options.size.y * 0.72, options.size.z * 0.34, material("cargo_strap"), {
      x: -options.size.x * 0.38,
      y: -options.size.y * 0.02
    });
    addChildBox(mesh, 0.08, options.size.y * 0.72, options.size.z * 0.34, material("cargo_strap"), {
      x: options.size.x * 0.38,
      y: -options.size.y * 0.02
    });
  }
  addChildBox(mesh, options.size.x * 1.08, 0.045, options.size.z * 0.32, material("rubber_foot"), {
    y: -options.size.y * 0.48
  });
  mergeOpaqueDecorativeChildrenByMaterial(mesh);
}

function addVehicleTires(mesh: THREE.Mesh, size: THREE.Vector3, tire: THREE.Material): void {
  const radius = THREE.MathUtils.clamp(Math.min(size.y * 0.28, size.z * 0.13), 0.075, 0.14);
  const width = Math.max(0.055, size.x * 0.12);
  for (const x of [-size.x * 0.48, size.x * 0.48]) {
    for (const z of [-size.z * 0.42, size.z * 0.42]) {
      addChildCylinder(mesh, radius, radius, width, tire, {
        x,
        y: -size.y * 0.42,
        z,
        rotationZ: Math.PI * 0.5
      });
      addChildCylinder(mesh, radius * 0.42, radius * 0.42, width + 0.006, material("wheel_hub"), {
        x,
        y: -size.y * 0.42,
        z,
        rotationZ: Math.PI * 0.5
      });
    }
  }
}

export function decorateHazardIndicator(mesh: THREE.Mesh, options: HazardIndicatorOptions): void {
  addHazardBadge(mesh, options.size, options.kind, options.size.z * 0.5 + 0.032);
  addChildBox(mesh, options.size.x * 0.88, 0.035, 0.028, material(indicatorBandMaterial(options.kind)), {
    y: Math.min(options.size.y * 0.34, options.size.y * 0.5 - 0.04),
    z: -options.size.z * 0.5 - 0.032
  });
  if (options.kind === "electric") {
    addChildBox(mesh, 0.03, options.size.y * 0.64, 0.03, material("electric_marker"), {
      y: options.size.y * 0.08,
      z: options.size.z * 0.5 + 0.048,
      rotationZ: Math.PI * 0.08
    });
  }
  mergeOpaqueDecorativeChildrenByMaterial(mesh);
}

export function decorateStrategicHazard(mesh: THREE.Mesh, options: StrategicHazardVisualOptions): void {
  const label = options.label.toLowerCase();
  if (label.includes("gas station canopy")) {
    decorateGasCanopy(mesh, options.size);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  if (label.includes("gas line") || label.includes("fuel line") || label.includes("conduit")) {
    decorateGasLineConduit(mesh, options.size);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  if (label.includes("gas pump")) {
    decorateGasPump(mesh, options.size);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  if (label.includes("substation")) {
    decorateElectricSubstation(mesh, options.size, label);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  if (label.includes("propane")) {
    decoratePropaneDepot(mesh, options.size, label);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  if (label.includes("parking silo")) {
    decorateParkingSilo(mesh, options.size, label);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  if (label.includes("nuclear plant") || label.includes("reactor") || label.includes("cooling tower")) {
    decorateNuclearPlant(mesh, options.size, label);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  if (label.includes("core")) {
    decorateEnergyCore(mesh, options.size);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  if (label.includes("capacitor")) {
    decorateCapacitorBank(mesh, options.size);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  if (options.kind === "combustible") {
    addChildBox(mesh, options.size.x * 0.82, 0.04, options.size.z * 0.82, "gas_canopy_red", {
      y: options.size.y * 0.46
    });
  }
  mergeOpaqueDecorativeChildrenByMaterial(mesh);
}

function decorateGasCanopy(mesh: THREE.Mesh, size: THREE.Vector3): void {
  addChildBox(mesh, size.x * 1.06, 0.075, 0.055, "gas_canopy_red", {
    y: size.y * 0.3,
    z: size.z * 0.55
  });
  addChildBox(mesh, size.x * 0.72, 0.052, 0.06, "gas_canopy_white", {
    y: size.y * 0.18,
    z: size.z * 0.56
  });
  addChildBox(mesh, size.x * 0.92, 0.048, 0.052, "gas_canopy_red", {
    y: size.y * 0.31,
    z: -size.z * 0.55
  });
  for (const x of [-0.42, 0.42]) {
    addChildCylinder(mesh, 0.035, 0.04, size.y * 1.75, "service_pipe", {
      x: size.x * x,
      y: -size.y * 0.74,
      z: size.z * 0.32
    });
  }
  for (const z of [-0.22, 0.22]) {
    addChildBox(mesh, size.x * 0.34, 0.022, 0.035, "warm_window", {
      y: -size.y * 0.44,
      z: size.z * z
    });
  }
}

function decorateGasPump(mesh: THREE.Mesh, size: THREE.Vector3): void {
  addChildBox(mesh, size.x * 1.18, 0.052, size.z * 0.9, "gas_canopy_red", {
    y: size.y * 0.43
  });
  addChildBox(mesh, size.x * 0.82, size.y * 0.16, 0.018, "gas_pump_screen", {
    y: size.y * 0.17,
    z: size.z * 0.55
  });
  addChildBox(mesh, size.x * 0.62, size.y * 0.08, 0.02, "gas_canopy_white", {
    y: -size.y * 0.06,
    z: size.z * 0.56
  });
  addChildBox(mesh, 0.018, size.y * 0.54, 0.026, "gas_hose", {
    x: size.x * 0.58,
    y: -size.y * 0.03,
    z: size.z * 0.32
  });
  addChildBox(mesh, 0.05, 0.022, size.z * 0.32, "gas_nozzle", {
    x: size.x * 0.66,
    y: size.y * 0.08,
    z: size.z * 0.4
  });
  addChildBox(mesh, size.x * 1.18, 0.04, size.z * 1.08, "rubber_foot", {
    y: -size.y * 0.48
  });
}

function decorateGasLineConduit(mesh: THREE.Mesh, size: THREE.Vector3): void {
  addChildCylinder(mesh, Math.max(0.045, size.z * 0.24), Math.max(0.045, size.z * 0.24), size.x * 1.08, "gas_canopy_white", {
    y: size.y * 0.08,
    rotationZ: Math.PI * 0.5
  });
  addChildBox(mesh, size.x * 0.92, 0.04, Math.max(0.04, size.z * 0.34), "hazard_red_marker", {
    y: size.y * 0.34
  });
  for (const x of [-0.32, 0.32]) {
    addChildBox(mesh, 0.045, size.y * 0.72, Math.max(0.045, size.z * 0.34), "gas_nozzle", {
      x: size.x * x,
      y: -size.y * 0.06
    });
  }
}

function decorateElectricSubstation(mesh: THREE.Mesh, size: THREE.Vector3, label: string): void {
  addChildBox(mesh, size.x * 1.06, 0.04, size.z * 1.04, "relay_pad_plate", {
    y: -size.y * 0.48
  });
  addChildBox(mesh, size.x * 0.88, 0.035, 0.026, "electric_marker", {
    y: size.y * 0.36,
    z: size.z * 0.56
  });

  if (label.includes("transformer")) {
    for (const x of [-0.22, 0.22]) {
      addChildCylinder(mesh, size.x * 0.13, size.x * 0.13, size.y * 0.72, "capacitor_copper", {
        x: size.x * x,
        y: size.y * 0.02
      });
      addChildBox(mesh, size.x * 0.12, 0.028, size.z * 0.88, "relay_pad_coil", {
        x: size.x * x,
        y: size.y * 0.27
      });
    }
    addChildBox(mesh, size.x * 0.7, 0.035, 0.028, "relay_shock_core", {
      y: -size.y * 0.22,
      z: size.z * 0.58
    });
    return;
  }

  if (label.includes("breaker")) {
    addChildBox(mesh, size.x * 0.62, size.y * 0.78, 0.024, "relay_shock_glass", {
      z: size.z * 0.56
    });
    addChildBox(mesh, 0.028, size.y * 0.86, 0.03, "relay_pad_coil", {
      x: -size.x * 0.26,
      z: size.z * 0.58
    });
    addChildBox(mesh, 0.028, size.y * 0.86, 0.03, "relay_pad_coil", {
      x: size.x * 0.26,
      z: size.z * 0.58
    });
    return;
  }

  addChildBox(mesh, size.x * 0.62, size.y * 0.28, 0.024, "dark_window", {
    y: size.y * 0.08,
    z: size.z * 0.56
  });
  addChildBox(mesh, size.x * 0.72, 0.04, size.z * 0.82, "scraped_metal", {
    y: size.y * 0.48
  });
}

function decoratePropaneDepot(mesh: THREE.Mesh, size: THREE.Vector3, label: string): void {
  if (label.includes("tank")) {
    addChildCylinder(mesh, size.x * 0.34, size.x * 0.34, size.y * 0.9, "gas_canopy_white", {
      y: 0
    });
    addChildBox(mesh, size.x * 0.88, 0.035, size.z * 0.82, "hazard_red_marker", {
      y: size.y * 0.18
    });
    addChildBox(mesh, size.x * 0.92, 0.032, size.z * 0.86, "combustible_marker", {
      y: -size.y * 0.16
    });
    addChildBox(mesh, size.x * 0.5, 0.04, size.z * 0.5, "gas_nozzle", {
      y: size.y * 0.48
    });
    return;
  }

  addChildBox(mesh, size.x * 1.04, 0.035, size.z * 1.02, "relay_pad_plate", {
    y: -size.y * 0.44
  });
  for (const x of [-0.32, 0, 0.32]) {
    addChildCylinder(mesh, size.z * 0.16, size.z * 0.16, size.y * 0.72, "gas_canopy_white", {
      x: size.x * x,
      y: size.y * 0.04
    });
  }
  addChildBox(mesh, size.x * 0.96, 0.035, 0.028, "hazard_red_marker", {
    y: size.y * 0.34,
    z: size.z * 0.56
  });
}

function decorateParkingSilo(mesh: THREE.Mesh, size: THREE.Vector3, label: string): void {
  addChildBox(mesh, size.x * 1.02, 0.04, size.z * 1.04, "scraped_metal", {
    y: size.y * 0.08
  });
  for (const x of [-0.32, 0, 0.32]) {
    addChildBox(mesh, size.x * 0.18, size.y * 0.62, 0.026, "dark_window", {
      x: size.x * x,
      y: -size.y * 0.05,
      z: size.z * 0.54
    });
  }
  addChildBox(mesh, size.x * 0.92, 0.028, 0.024, "hazard_chevron", {
    y: size.y * 0.32,
    z: size.z * 0.56
  });
  if (label.includes("roof")) {
    addChildBox(mesh, size.x * 0.5, 0.028, size.z * 0.62, "parking_stripe", {
      x: -size.x * 0.18,
      y: size.y * 0.16,
      rotationY: Math.PI * 0.08
    });
    addChildBox(mesh, size.x * 0.5, 0.028, size.z * 0.62, "parking_stripe", {
      x: size.x * 0.18,
      y: size.y * 0.16,
      rotationY: Math.PI * 0.08
    });
  }
}

function decorateEnergyCore(mesh: THREE.Mesh, size: THREE.Vector3): void {
  addChildBox(mesh, size.x * 0.62, size.y * 0.76, 0.024, "relay_shock_glass", {
    z: size.z * 0.55
  });
  addChildCylinder(mesh, Math.min(size.x, size.z) * 0.18, Math.min(size.x, size.z) * 0.18, size.y * 0.82, "relay_shock_core", {
    rotationX: Math.PI * 0.5
  });
  addChildBox(mesh, size.x * 0.92, 0.035, 0.03, "electric_marker", {
    y: size.y * 0.34,
    z: size.z * 0.58
  });
  addChildBox(mesh, size.x * 0.74, 0.035, 0.03, "electric_marker", {
    y: -size.y * 0.3,
    z: size.z * 0.58
  });
}

function decorateNuclearPlant(mesh: THREE.Mesh, size: THREE.Vector3, label: string): void {
  if (label.includes("cooling tower")) {
    addChildBox(mesh, size.x * 1.08, 0.045, size.z * 1.08, "nuclear_concrete_rim", {
      y: size.y * 0.46
    });
    addChildBox(mesh, size.x * 0.74, 0.045, size.z * 0.74, "dark_window", {
      y: -size.y * 0.18
    });
    addChildBox(mesh, size.x * 0.76, 0.036, 0.026, "nuclear_warning_green", {
      y: size.y * 0.18,
      z: size.z * 0.54
    });
    return;
  }

  addChildBox(mesh, size.x * 1.05, 0.04, size.z * 1.02, "relay_pad_plate", {
    y: -size.y * 0.46
  });
  addChildBox(mesh, size.x * 0.58, size.y * 0.5, 0.026, "relay_shock_glass", {
    y: size.y * 0.02,
    z: size.z * 0.56
  });
  addChildCylinder(mesh, Math.min(size.x, size.z) * 0.18, Math.min(size.x, size.z) * 0.18, size.y * 0.72, "relay_shock_core", {
    rotationX: Math.PI * 0.5,
    z: size.z * 0.1
  });
  addChildBox(mesh, size.x * 0.82, 0.035, 0.03, "nuclear_warning_green", {
    y: size.y * 0.34,
    z: size.z * 0.58
  });
  addChildBox(mesh, size.x * 0.42, 0.045, 0.028, "hazard_red_marker", {
    y: -size.y * 0.28,
    z: size.z * 0.59
  });
}

function decorateCapacitorBank(mesh: THREE.Mesh, size: THREE.Vector3): void {
  for (const x of [-0.24, 0, 0.24]) {
    addChildCylinder(mesh, size.x * 0.11, size.x * 0.11, size.y * 0.78, "capacitor_copper", {
      x: size.x * x,
      y: size.y * 0.04
    });
  }
  addChildBox(mesh, size.x * 0.92, 0.035, size.z * 0.9, "relay_pad_plate", {
    y: -size.y * 0.42
  });
  addChildBox(mesh, size.x * 0.82, 0.035, 0.026, "electric_marker", {
    y: size.y * 0.34,
    z: size.z * 0.56
  });
}

function addFacadeSkin(mesh: THREE.Mesh, size: THREE.Vector3, materialRef: THREE.Material, depth: number): void {
  addChildBox(mesh, size.x * 0.96, size.y * 0.92, depth, materialRef, { z: size.z * 0.5 + depth * 0.5 });
  addChildBox(mesh, size.x * 0.92, size.y * 0.82, depth, materialRef, { z: -size.z * 0.5 - depth * 0.5 });
  addChildBox(mesh, depth, size.y * 0.76, size.z * 0.82, materialRef, { x: -size.x * 0.5 - depth * 0.5 });
  addChildBox(mesh, depth, size.y * 0.76, size.z * 0.82, materialRef, { x: size.x * 0.5 + depth * 0.5 });
}

function addNeutralFacadeSkin(mesh: THREE.Mesh, size: THREE.Vector3, materialRef: THREE.Material): void {
  addChildBox(mesh, size.x * 0.94, size.y * 0.86, 0.014, materialRef, { z: size.z * 0.5 + 0.02 });
}

function addNeutralWindowBand(
  mesh: THREE.Mesh,
  options: BuildingCellVisualOptions,
  mullionMaterial: THREE.Material
): void {
  const windowMaterial = material(options.style === "glassTower" ? "cool_window" : "warm_window");
  addChildBox(mesh, options.size.x * 0.58, options.size.y * 0.22, 0.018, windowMaterial, {
    y: options.size.y * 0.08,
    z: options.size.z * 0.5 + 0.034
  });
  if (options.style === "industrial" || options.style === "warehouse" || options.style === "utility") {
    addChildBox(mesh, options.size.x * 0.66, 0.026, 0.02, mullionMaterial, {
      y: -options.size.y * 0.15,
      z: options.size.z * 0.5 + 0.038
    });
  }
}

function addNeutralStorefront(mesh: THREE.Mesh, size: THREE.Vector3, signMaterial: THREE.Material, style: BuildingVisualStyle): void {
  addChildBox(mesh, size.x * 0.66, 0.075, 0.028, signMaterial, { y: -size.y * 0.27, z: size.z * 0.5 + 0.044 });
  if (style === "market" || style === "apartment") {
    addChildBox(mesh, size.x * 0.48, 0.11, 0.02, material("shop_glass"), { y: -size.y * 0.08, z: size.z * 0.5 + 0.038 });
  }
}

function addNeutralRoofDetail(mesh: THREE.Mesh, size: THREE.Vector3, roofMaterial: THREE.Material): void {
  addChildBox(mesh, size.x * 1.05, 0.045, size.z * 1.05, roofMaterial, { y: size.y * 0.5 + 0.034 });
  addChildBox(mesh, size.x * 0.36, 0.05, size.z * 0.18, material("roof_unit"), {
    x: -size.x * 0.14,
    y: size.y * 0.5 + 0.084,
    z: size.z * 0.08
  });
}

function addWindowRows(mesh: THREE.Mesh, options: BuildingCellVisualOptions): void {
  const rows = options.style === "warehouse" || options.style === "utility" ? 1 : 2;
  const columns = options.style === "glassTower" ? 3 : 2;
  const windowMaterial = material(options.style === "glassTower" ? "cool_window" : "warm_window");
  const mullionMaterial = material(options.scoreRole === "target" ? "hazard_trim" : "dark_trim");
  const width = (options.size.x * 0.64) / columns;
  const height = (options.size.y * 0.5) / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = (column - (columns - 1) * 0.5) * width * 1.18;
      const y = (row - (rows - 1) * 0.5) * height * 1.22 + options.size.y * 0.08;
      addChildBox(mesh, width * 0.72, height * 0.62, 0.018, windowMaterial, { x, y, z: options.size.z * 0.5 + 0.026 });
      if ((options.floor + options.column + row + column) % 7 === 0) {
        addChildBox(mesh, width * 0.62, height * 0.52, 0.019, material("dark_window"), { x, y, z: options.size.z * 0.5 + 0.028 });
      }
    }
  }

  if (options.style === "industrial" || options.style === "warehouse") {
    addChildBox(mesh, options.size.x * 0.78, 0.035, 0.022, mullionMaterial, { y: -options.size.y * 0.08, z: options.size.z * 0.5 + 0.034 });
  }
  if (options.style === "apartment" && options.floor % 2 === 0) {
    addChildBox(mesh, options.size.x * 0.72, 0.03, 0.055, material("balcony_rail"), { y: -options.size.y * 0.22, z: options.size.z * 0.5 + 0.064 });
  }
}

function addVerticalTrim(
  mesh: THREE.Mesh,
  size: THREE.Vector3,
  materialRef: THREE.Material,
  leftEdge: boolean,
  rightEdge: boolean
): void {
  addChildBox(mesh, 0.035, size.y * 0.96, 0.024, materialRef, { x: -size.x * 0.46, z: size.z * 0.5 + 0.032 });
  addChildBox(mesh, 0.035, size.y * 0.96, 0.024, materialRef, { x: size.x * 0.46, z: size.z * 0.5 + 0.032 });
  if (leftEdge) {
    addChildBox(mesh, 0.018, size.y * 0.78, size.z * 0.74, materialRef, { x: -size.x * 0.5 - 0.014 });
  }
  if (rightEdge) {
    addChildBox(mesh, 0.018, size.y * 0.78, size.z * 0.74, materialRef, { x: size.x * 0.5 + 0.014 });
  }
}

function addStorefront(
  mesh: THREE.Mesh,
  size: THREE.Vector3,
  signMaterial: THREE.Material,
  style: BuildingVisualStyle,
  column: number
): void {
  if (style === "industrial" && column % 2 === 0) {
    addChildBox(mesh, size.x * 0.72, 0.09, 0.03, signMaterial, { y: -size.y * 0.24, z: size.z * 0.5 + 0.045 });
    addChildBox(mesh, 0.035, size.y * 0.72, 0.035, material("service_pipe"), { x: -size.x * 0.38, y: 0, z: size.z * 0.5 + 0.056 });
  } else if (style === "market" || style === "apartment") {
    addChildBox(mesh, size.x * 0.78, 0.08, 0.035, signMaterial, { y: -size.y * 0.26, z: size.z * 0.5 + 0.046 });
    addChildBox(mesh, size.x * 0.58, 0.17, 0.022, material("shop_glass"), { y: -size.y * 0.06, z: size.z * 0.5 + 0.038 });
    addChildBox(mesh, size.x * 0.72, 0.045, 0.1, material("awning_red"), { y: -size.y * 0.17, z: size.z * 0.5 + 0.08, rotationX: Math.PI * 0.04 });
  } else if (style === "civic" || style === "utility") {
    addChildBox(mesh, size.x * 0.64, 0.07, 0.026, signMaterial, { y: -size.y * 0.26, z: size.z * 0.5 + 0.04 });
    addChildBox(mesh, 0.035, size.y * 0.82, 0.035, material("service_pipe"), { x: size.x * 0.38, y: 0, z: size.z * 0.5 + 0.056 });
  }
}

function addRoofDetail(mesh: THREE.Mesh, options: BuildingCellVisualOptions, roofMaterial: THREE.Material): void {
  const size = options.size;
  addChildBox(mesh, size.x * 1.08, 0.045, size.z * 1.08, roofMaterial, { y: size.y * 0.5 + 0.034 });
  addChildBox(mesh, size.x * 1.12, 0.055, 0.045, material("parapet_dark"), { y: size.y * 0.5 + 0.096, z: size.z * 0.5 });
  addChildBox(mesh, size.x * 1.12, 0.055, 0.045, material("parapet_dark"), { y: size.y * 0.5 + 0.096, z: -size.z * 0.5 });
  addChildBox(mesh, 0.045, 0.055, size.z * 1.12, material("parapet_dark"), { x: -size.x * 0.5, y: size.y * 0.5 + 0.096 });
  addChildBox(mesh, 0.045, 0.055, size.z * 1.12, material("parapet_dark"), { x: size.x * 0.5, y: size.y * 0.5 + 0.096 });
  addChildBox(mesh, size.x * 0.42, 0.055, size.z * 0.18, material("roof_unit"), {
    x: -size.x * 0.16,
    y: size.y * 0.5 + 0.088,
    z: size.z * 0.12
  });
  addChildCylinder(mesh, 0.035, 0.042, 0.11, roofMaterial, {
    x: -size.x * 0.24,
    y: size.y * 0.5 + 0.112,
    z: -size.z * 0.18
  });
  addChildSphere(mesh, 0.035, "cool_window", {
    x: size.x * 0.26,
    y: size.y * 0.5 + 0.116,
    z: size.z * 0.2
  });
  if (options.style === "glassTower") {
    addChildBox(mesh, size.x * 0.46, 0.12, size.z * 0.46, material("neon_cyan"), {
      y: size.y * 0.5 + 0.16
    });
    addChildCylinder(mesh, 0.012, 0.018, 0.42, material("roof_rail"), {
      y: size.y * 0.5 + 0.42
    });
  } else if (options.style === "industrial" || options.style === "warehouse") {
    addChildBox(mesh, size.x * 0.18, 0.06, size.z * 0.5, material("scraped_metal"), {
      x: size.x * 0.24,
      y: size.y * 0.5 + 0.12,
      rotationY: Math.PI * 0.06
    });
    if (options.style === "warehouse") {
      for (const z of [-0.22, 0.22]) {
        addChildBox(mesh, size.x * 0.48, 0.04, 0.055, material("roof_unit"), {
          y: size.y * 0.5 + 0.14,
          z: size.z * z
        });
      }
    } else {
      addChildCylinder(mesh, 0.028, 0.034, size.x * 0.54, material("service_pipe"), {
        y: size.y * 0.5 + 0.15,
        z: -size.z * 0.22,
        rotationZ: Math.PI * 0.5
      });
    }
  } else if (options.style === "apartment" || options.style === "market") {
    addChildCylinder(mesh, 0.055, 0.055, 0.18, material("water_tank"), {
      x: size.x * 0.22,
      y: size.y * 0.5 + 0.17,
      z: -size.z * 0.22
    });
    if (options.style === "apartment") {
      addChildBox(mesh, size.x * 0.34, 0.036, size.z * 0.18, material("warm_roof"), {
        x: -size.x * 0.18,
        y: size.y * 0.5 + 0.142,
        z: -size.z * 0.18
      });
    }
  } else if (options.style === "civic") {
    addChildBox(mesh, size.x * 0.32, 0.04, size.z * 0.32, material("market_trim"), {
      y: size.y * 0.5 + 0.14
    });
    addChildCylinder(mesh, 0.012, 0.018, 0.34, material("roof_rail"), {
      y: size.y * 0.5 + 0.32
    });
  } else if (options.style === "utility") {
    addChildBox(mesh, size.x * 0.66, 0.035, 0.045, material("service_pipe"), {
      y: size.y * 0.5 + 0.142,
      z: size.z * 0.24
    });
    addChildBox(mesh, 0.045, 0.035, size.z * 0.58, material("service_pipe"), {
      x: -size.x * 0.26,
      y: size.y * 0.5 + 0.144
    });
  }
}

function addPremiumFacadeDetails(mesh: THREE.Mesh, options: BuildingCellVisualOptions, signMaterial: THREE.Material): void {
  if (options.brand && options.column === 0 && (options.floor === 0 || options.floor === options.floors - 1)) {
    addFauxBrandSign(mesh, options.size, options.brand, options.floor === options.floors - 1 ? "crown" : "storefront");
  }
  if (options.scoreRole === "target") {
    addChildBox(mesh, options.size.x * 0.52, 0.08, 0.022, material("hazard_chevron"), {
      y: options.size.y * 0.22,
      z: options.size.z * 0.5 + 0.046
    });
  }
  if (options.style === "glassTower") {
    addChildBox(mesh, 0.028, options.size.y * 0.74, 0.024, material("neon_cyan"), {
      x: options.size.x * 0.38,
      y: 0,
      z: options.size.z * 0.5 + 0.044
    });
    addChildBox(mesh, 0.028, options.size.y * 0.74, 0.024, material("neon_cyan"), {
      x: -options.size.x * 0.38,
      y: 0,
      z: options.size.z * 0.5 + 0.044
    });
  }
  if (options.floor === 0 && options.column % 2 === 0) {
    addChildBox(mesh, options.size.x * 0.36, 0.045, 0.026, signMaterial, {
      y: -options.size.y * 0.34,
      z: options.size.z * 0.5 + 0.052
    });
  }
  if (options.brand && options.column === 0) {
    addFacadeDepthBreaks(mesh, options, signMaterial);
  }
}

function addFacadeDepthBreaks(mesh: THREE.Mesh, options: BuildingCellVisualOptions, trimMaterial: THREE.Material): void {
  const size = options.size;
  const z = size.z * 0.5 + 0.047;
  if (options.floors >= 6 && (options.floor % 2 === 1 || options.floor === options.floors - 1)) {
    addChildBox(mesh, size.x * 0.82, 0.022, 0.018, trimMaterial, {
      y: -size.y * 0.42,
      z
    });
  }
  if (options.columns >= 4 && (options.column === 0 || options.column === options.columns - 1)) {
    addChildBox(mesh, 0.026, size.y * 0.78, 0.018, material("shadow_reveal"), {
      x: options.column === 0 ? size.x * 0.42 : -size.x * 0.42,
      y: -size.y * 0.02,
      z: z + 0.004
    });
  }
  if (options.floor === options.floors - 1 && options.floors >= 6) {
    addChildBox(mesh, size.x * 0.72, 0.05, size.z * 0.12, material("mechanical_screen"), {
      y: size.y * 0.5 + 0.12,
      z: -size.z * 0.2
    });
  }
}

function addFauxBrandSign(mesh: THREE.Mesh, size: THREE.Vector3, brand: BuildingBrand, placement: "storefront" | "crown"): void {
  const z = size.z * 0.5 + 0.062;
  const y = placement === "crown" ? size.y * 0.28 : -size.y * 0.3;
  const panelWidth = placement === "crown" ? size.x * 0.44 : size.x * 0.5;
  const panelHeight = placement === "crown" ? size.y * 0.16 : size.y * 0.12;
  addChildBox(mesh, panelWidth, Math.max(0.052, panelHeight), 0.026, material(`${brand}_brand_panel`), { y, z });

  if (brand === "pear") {
    addChildSphere(mesh, Math.max(0.035, panelHeight * 0.28), "pear_logo_body", {
      x: -panelWidth * 0.14,
      y: y + panelHeight * 0.04,
      z: z + 0.018
    });
    addChildSphere(mesh, Math.max(0.028, panelHeight * 0.22), "pear_logo_body", {
      x: -panelWidth * 0.14,
      y: y + panelHeight * 0.24,
      z: z + 0.02
    });
    addChildBox(mesh, panelWidth * 0.08, panelHeight * 0.16, 0.018, "pear_logo_leaf", {
      x: -panelWidth * 0.04,
      y: y + panelHeight * 0.43,
      z: z + 0.025,
      rotationZ: -Math.PI * 0.18
    });
    addChildBox(mesh, panelWidth * 0.22, panelHeight * 0.12, 0.018, "pear_logo_text", {
      x: panelWidth * 0.16,
      y: y + panelHeight * 0.02,
      z: z + 0.022
    });
    return;
  }

  if (brand === "cloudnine") {
    for (const [x, scale] of [[-0.15, 0.22], [0, 0.28], [0.17, 0.2]] as const) {
      addChildSphere(mesh, Math.max(0.026, panelHeight * scale), "cloudnine_logo", {
        x: panelWidth * x,
        y: y + panelHeight * 0.04,
        z: z + 0.018
      });
    }
    addChildBox(mesh, panelWidth * 0.18, panelHeight * 0.12, 0.018, "cloudnine_logo", {
      x: panelWidth * 0.24,
      y: y - panelHeight * 0.16,
      z: z + 0.02
    });
    return;
  }

  if (brand === "hexxon") {
    addChildCylinder(mesh, Math.max(0.04, panelHeight * 0.32), Math.max(0.04, panelHeight * 0.32), 0.024, "hexxon_logo", {
      x: -panelWidth * 0.18,
      y,
      z: z + 0.02,
      rotationX: Math.PI * 0.5,
      rotationZ: Math.PI * 0.16
    });
    addChildBox(mesh, panelWidth * 0.25, panelHeight * 0.12, 0.018, "hexxon_logo_text", {
      x: panelWidth * 0.14,
      y,
      z: z + 0.022
    });
    return;
  }

  addChildBox(mesh, panelWidth * 0.12, panelHeight * 0.58, 0.018, "omnitech_logo", {
    x: -panelWidth * 0.18,
    y,
    z: z + 0.02
  });
  addChildBox(mesh, panelWidth * 0.34, panelHeight * 0.1, 0.018, "omnitech_logo_text", {
    x: panelWidth * 0.12,
    y,
    z: z + 0.022
  });
}

function addHazardBadge(mesh: THREE.Mesh, size: THREE.Vector3, kind: HazardIndicatorOptions["kind"], z: number): void {
  const badgeMaterial = material(indicatorBadgeMaterial(kind));
  const markMaterial = material(kind === "electric" ? "electric_marker" : "hazard_red_marker");
  const badgeWidth = Math.max(0.14, size.x * 0.32);
  const badgeHeight = Math.max(0.11, size.y * 0.22);
  addChildBox(mesh, badgeWidth, badgeHeight, 0.025, badgeMaterial, {
    y: Math.min(size.y * 0.22, size.y * 0.5 - badgeHeight * 0.5),
    z
  });
  addChildBox(mesh, badgeWidth * 0.12, badgeHeight * 0.58, 0.029, markMaterial, {
    y: Math.min(size.y * 0.22, size.y * 0.5 - badgeHeight * 0.5) + badgeHeight * 0.08,
    z: z + 0.004
  });
  addChildBox(mesh, badgeWidth * 0.16, badgeHeight * 0.12, 0.029, markMaterial, {
    y: Math.min(size.y * 0.22, size.y * 0.5 - badgeHeight * 0.5) - badgeHeight * 0.28,
    z: z + 0.004
  });
}

function indicatorBadgeMaterial(kind: HazardIndicatorOptions["kind"]): string {
  if (kind === "electric") {
    return "electric_badge";
  }
  if (kind === "combustible") {
    return "combustible_badge";
  }
  return "explosive_badge";
}

function indicatorBandMaterial(kind: HazardIndicatorOptions["kind"]): string {
  if (kind === "electric") {
    return "electric_marker";
  }
  if (kind === "combustible") {
    return "combustible_marker";
  }
  return "hazard_red_marker";
}

function addChildBox(
  parent: THREE.Mesh,
  width: number,
  height: number,
  depth: number,
  materialRef: THREE.Material | string,
  transform: {
    x?: number;
    y?: number;
    z?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
  } = {}
): void {
  if (!hasPositiveDimensions(width, height, depth)) {
    return;
  }
  const mesh = new THREE.Mesh(sharedChildBoxGeometry(), typeof materialRef === "string" ? material(materialRef) : materialRef);
  mesh.position.set(transform.x ?? 0, transform.y ?? 0, transform.z ?? 0);
  mesh.rotation.set(transform.rotationX ?? 0, transform.rotationY ?? 0, transform.rotationZ ?? 0);
  mesh.scale.set(width, height, depth);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  decorativeChildHost(parent, true).add(mesh);
}

function setFragmentChildBox(
  parent: THREE.Mesh,
  index: number,
  width: number,
  height: number,
  depth: number,
  materialRef: THREE.Material | string,
  transform: {
    x?: number;
    y?: number;
    z?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
  } = {}
): void {
  const userData = parent.userData as DetailRootUserData;
  const parts = userData.fragmentVisualParts ?? [];
  userData.fragmentVisualParts = parts;
  const host = decorativeChildHost(parent, true);
  const materialValue = typeof materialRef === "string" ? material(materialRef) : materialRef;
  let mesh = parts[index];
  if (!mesh) {
    mesh = new THREE.Mesh(sharedChildBoxGeometry(), materialValue);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    parts[index] = mesh;
  } else {
    mesh.material = materialValue;
  }
  if (mesh.parent !== host) {
    host.add(mesh);
  }
  mesh.visible = hasPositiveDimensions(width, height, depth);
  mesh.position.set(transform.x ?? 0, transform.y ?? 0, transform.z ?? 0);
  mesh.rotation.set(transform.rotationX ?? 0, transform.rotationY ?? 0, transform.rotationZ ?? 0);
  mesh.scale.set(Math.max(0.0001, width), Math.max(0.0001, height), Math.max(0.0001, depth));
}

function hideUnusedFragmentChildBoxes(parent: THREE.Mesh, usedCount: number): void {
  const parts = (parent.userData as DetailRootUserData).fragmentVisualParts;
  if (!parts) {
    return;
  }
  for (let index = usedCount; index < parts.length; index += 1) {
    parts[index].visible = false;
  }
}

function addChildCylinder(
  parent: THREE.Mesh,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  materialRef: THREE.Material | string,
  transform: {
    x?: number;
    y?: number;
    z?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
  } = {}
): void {
  if (!hasPositiveDimensions(radiusTop, radiusBottom, height)) {
    return;
  }
  const radiusScale = Math.max(radiusTop, radiusBottom);
  const mesh = new THREE.Mesh(
    sharedChildCylinderGeometry(radiusTop / radiusScale, radiusBottom / radiusScale),
    typeof materialRef === "string" ? material(materialRef) : materialRef
  );
  mesh.position.set(transform.x ?? 0, transform.y ?? 0, transform.z ?? 0);
  mesh.rotation.set(transform.rotationX ?? 0, transform.rotationY ?? 0, transform.rotationZ ?? 0);
  mesh.scale.set(radiusScale, height, radiusScale);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  decorativeChildHost(parent, true).add(mesh);
}

function addChildSphere(
  parent: THREE.Mesh,
  radius: number,
  materialRef: THREE.Material | string,
  transform: {
    x?: number;
    y?: number;
    z?: number;
  } = {}
): void {
  if (!Number.isFinite(radius) || radius <= 0) {
    return;
  }
  const mesh = new THREE.Mesh(sharedChildSphereGeometry(), typeof materialRef === "string" ? material(materialRef) : materialRef);
  mesh.position.set(transform.x ?? 0, transform.y ?? 0, transform.z ?? 0);
  mesh.scale.setScalar(radius);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  decorativeChildHost(parent, true).add(mesh);
}

function mergeOpaqueDecorativeChildrenByMaterial(parent: THREE.Mesh): void {
  const target = decorativeChildHost(parent, false);
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of target.children) {
    if (
      !(child instanceof THREE.Mesh) ||
      Array.isArray(child.material) ||
      child.children.length > 0
    ) {
      continue;
    }
    const group = groups.get(child.material);
    if (group) {
      group.push(child);
    } else {
      groups.set(child.material, [child]);
    }
  }

  for (const [materialRef, meshes] of groups) {
    if (meshes.length < 2) {
      continue;
    }
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      return mesh.geometry.clone().applyMatrix4(mesh.matrix);
    });
    const mergedGeometry = mergeGeometries(geometries, false);
    for (const geometry of geometries) {
      geometry.dispose();
    }
    if (!mergedGeometry) {
      continue;
    }

    for (const mesh of meshes) {
      target.remove(mesh);
    }

    const mergedMesh = new THREE.Mesh(mergedGeometry, materialRef);
    mergedMesh.name = `${parent.name} batched detail`;
    mergedMesh.castShadow = false;
    mergedMesh.receiveShadow = false;
    target.add(mergedMesh);
  }
}

function paletteFor(style: BuildingVisualStyle, scoreRole: ScoreRole): { facade: THREE.Material; trim: THREE.Material; roof: THREE.Material; sign: THREE.Material } {
  if (scoreRole === "target") {
    return {
      facade: material("hazard_facade"),
      trim: material("hazard_trim"),
      roof: material("dark_roof"),
      sign: material("hazard_sign")
    };
  }
  if (style === "market") {
    return {
      facade: material("market_facade"),
      trim: material("market_trim"),
      roof: material("warm_roof"),
      sign: material("market_sign")
    };
  }
  if (style === "glassTower") {
    return {
      facade: material("glass_facade"),
      trim: material("cool_trim"),
      roof: material("dark_roof"),
      sign: material("cool_sign")
    };
  }
  if (style === "industrial") {
    return {
      facade: material("industrial_facade"),
      trim: material("scraped_metal"),
      roof: material("dark_roof"),
      sign: material("hazard_sign")
    };
  }
  if (style === "civic") {
    return {
      facade: material("civic_facade"),
      trim: material("market_trim"),
      roof: material("warm_roof"),
      sign: material("cool_sign")
    };
  }
  if (style === "utility") {
    return {
      facade: material("utility_facade"),
      trim: material("service_pipe"),
      roof: material("dark_roof"),
      sign: material("electric_marker")
    };
  }
  if (style === "apartment") {
    return {
      facade: material("apartment_facade"),
      trim: material("balcony_rail"),
      roof: material("warm_roof"),
      sign: material("market_sign")
    };
  }
  if (style === "warehouse") {
    return {
      facade: material("warehouse_facade"),
      trim: material("dark_trim"),
      roof: material("dark_roof"),
      sign: material("cool_sign")
    };
  }
  return {
    facade: material("neutral_facade"),
    trim: material("dark_trim"),
    roof: material("dark_roof"),
    sign: material("cool_sign")
  };
}

function material(key: string): THREE.Material {
  const existing = sharedMaterials.get(key);
  if (existing) {
    return existing;
  }

  const created = createMaterial(key);
  sharedMaterials.set(key, created);
  return created;
}

function colorMaterial(key: string, color: THREE.ColorRepresentation, roughness: number, metalness: number): THREE.Material {
  const existing = sharedMaterials.get(key);
  if (existing) {
    return existing;
  }
  const created = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  sharedMaterials.set(key, created);
  return created;
}

function createMaterial(key: string): THREE.Material {
  switch (key) {
    case "cool_window":
      return new THREE.MeshStandardMaterial({
        color: 0x9fd4db,
        transparent: true,
        opacity: 0.56,
        roughness: 0.24,
        metalness: 0.18,
        emissive: 0x123642,
        emissiveIntensity: 0.08,
        depthWrite: false
      });
    case "warm_window":
      return new THREE.MeshStandardMaterial({
        color: 0xdcc47e,
        transparent: true,
        opacity: 0.5,
        roughness: 0.34,
        metalness: 0.08,
        emissive: 0x3d2705,
        emissiveIntensity: 0.06,
        depthWrite: false
      });
    case "shop_glass":
      return new THREE.MeshPhysicalMaterial({
        color: 0xb5edf0,
        transparent: true,
        opacity: 0.4,
        roughness: 0.12,
        metalness: 0,
        depthWrite: false,
        envMapIntensity: 1.18
      });
    case "hazard_facade":
      return new THREE.MeshStandardMaterial({ color: 0x7b3023, roughness: 0.72, metalness: 0.04, map: materialAtlasTile(4) });
    case "hazard_trim":
      return new THREE.MeshStandardMaterial({ color: 0xff7a35, roughness: 0.44, metalness: 0.08, emissive: 0x4a1508, emissiveIntensity: 0.45 });
    case "hazard_sign":
      return new THREE.MeshBasicMaterial({ color: 0xffa23f });
    case "hazard_chevron":
      return new THREE.MeshBasicMaterial({ color: 0xffd66b, map: decalAtlasTile(3), transparent: true, opacity: 0.88, alphaTest: 0.04 });
    case "explosive_badge":
      return new THREE.MeshBasicMaterial({ color: 0xffb13d, transparent: true, opacity: 0.96 });
    case "electric_badge":
      return new THREE.MeshBasicMaterial({ color: 0x7ee8ff, transparent: true, opacity: 0.94 });
    case "combustible_badge":
      return new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0.9 });
    case "hazard_red_marker":
      return new THREE.MeshBasicMaterial({ color: 0xff2f45, transparent: true, opacity: 0.96 });
    case "electric_marker":
      return new THREE.MeshBasicMaterial({ color: 0x93f6ff, transparent: true, opacity: 0.96 });
    case "combustible_marker":
      return new THREE.MeshBasicMaterial({ color: 0xff7a35, transparent: true, opacity: 0.92 });
    case "gas_canopy_red":
      return new THREE.MeshBasicMaterial({ color: 0xff344f, transparent: true, opacity: 0.96 });
    case "gas_canopy_white":
      return new THREE.MeshBasicMaterial({ color: 0xfff3c1, transparent: true, opacity: 0.94 });
    case "gas_pump_screen":
      return new THREE.MeshBasicMaterial({ color: 0xa7f0ff, transparent: true, opacity: 0.86 });
    case "gas_hose":
      return new THREE.MeshStandardMaterial({ color: 0x080a0c, roughness: 0.82, metalness: 0.08, map: materialAtlasTile(6) });
    case "gas_nozzle":
      return new THREE.MeshStandardMaterial({ color: 0xd5c16a, roughness: 0.38, metalness: 0.62, map: materialAtlasTile(10) });
    case "neon_cyan":
      return new THREE.MeshStandardMaterial({ color: 0x79cbd4, roughness: 0.32, metalness: 0.18, emissive: 0x07323a, emissiveIntensity: 0.08 });
    case "roof_unit":
      return new THREE.MeshStandardMaterial({ color: 0x313a42, roughness: 0.48, metalness: 0.55, map: materialAtlasTile(10) });
    case "market_facade":
      return new THREE.MeshStandardMaterial({ color: 0x635246, roughness: 0.78, metalness: 0.02, map: materialAtlasTile(13) });
    case "market_trim":
      return new THREE.MeshStandardMaterial({ color: 0xf0c16a, roughness: 0.5, metalness: 0.06 });
    case "market_sign":
      return new THREE.MeshBasicMaterial({ color: 0xffe08c });
    case "glass_facade":
      return new THREE.MeshPhysicalMaterial({
        color: 0x4f8792,
        transparent: true,
        opacity: 0.42,
        roughness: 0.18,
        metalness: 0.02,
        depthWrite: false,
        map: materialAtlasTile(8),
        envMapIntensity: 1.22
      });
    case "industrial_facade":
      return new THREE.MeshStandardMaterial({ color: 0x515d63, roughness: 0.76, metalness: 0.08, map: materialAtlasTile(12) });
    case "civic_facade":
      return new THREE.MeshStandardMaterial({ color: 0x77736a, roughness: 0.86, metalness: 0.02, map: materialAtlasTile(15) });
    case "utility_facade":
      return new THREE.MeshStandardMaterial({ color: 0x4a5962, roughness: 0.72, metalness: 0.16, map: materialAtlasTile(2) });
    case "apartment_facade":
      return new THREE.MeshStandardMaterial({ color: 0x6c5e55, roughness: 0.8, metalness: 0.02, map: materialAtlasTile(13) });
    case "warehouse_facade":
      return new THREE.MeshStandardMaterial({ color: 0x596269, roughness: 0.78, metalness: 0.06, map: materialAtlasTile(3) });
    case "cool_trim":
      return new THREE.MeshStandardMaterial({ color: 0x7ec7d2, roughness: 0.46, metalness: 0.22 });
    case "cool_sign":
      return new THREE.MeshBasicMaterial({ color: 0x74dfff });
    case "pear_brand_panel":
      return new THREE.MeshStandardMaterial({ color: 0x11161c, roughness: 0.5, metalness: 0.46, map: materialAtlasTile(10) });
    case "pear_logo_body":
      return new THREE.MeshBasicMaterial({ color: 0xf6f0df, transparent: true, opacity: 0.95 });
    case "pear_logo_leaf":
      return new THREE.MeshBasicMaterial({ color: 0x9be15d, transparent: true, opacity: 0.92 });
    case "pear_logo_text":
      return new THREE.MeshBasicMaterial({ color: 0xd8fbff, transparent: true, opacity: 0.82 });
    case "cloudnine_brand_panel":
      return new THREE.MeshStandardMaterial({ color: 0x14283a, roughness: 0.54, metalness: 0.34, map: materialAtlasTile(8) });
    case "cloudnine_logo":
      return new THREE.MeshBasicMaterial({ color: 0xbff7ff, transparent: true, opacity: 0.9 });
    case "hexxon_brand_panel":
      return new THREE.MeshStandardMaterial({ color: 0x24171a, roughness: 0.62, metalness: 0.28, map: materialAtlasTile(4) });
    case "hexxon_logo":
      return new THREE.MeshBasicMaterial({ color: 0xffd15c, transparent: true, opacity: 0.92 });
    case "hexxon_logo_text":
      return new THREE.MeshBasicMaterial({ color: 0xff6a24, transparent: true, opacity: 0.86 });
    case "omnitech_brand_panel":
      return new THREE.MeshStandardMaterial({ color: 0x161b25, roughness: 0.52, metalness: 0.52, map: materialAtlasTile(1) });
    case "omnitech_logo":
      return new THREE.MeshBasicMaterial({ color: 0xb08aff, transparent: true, opacity: 0.9 });
    case "omnitech_logo_text":
      return new THREE.MeshBasicMaterial({ color: 0xd8c6ff, transparent: true, opacity: 0.84 });
    case "neutral_facade":
      return new THREE.MeshStandardMaterial({ color: 0x62686d, roughness: 0.82, metalness: 0.02, map: materialAtlasTile(3) });
    case "dark_trim":
      return new THREE.MeshStandardMaterial({ color: 0x262f36, roughness: 0.58, metalness: 0.16, map: materialAtlasTile(1) });
    case "shadow_reveal":
      return new THREE.MeshBasicMaterial({ color: 0x070b0f, transparent: true, opacity: 0.5 });
    case "mechanical_screen":
      return new THREE.MeshStandardMaterial({ color: 0x29323a, roughness: 0.62, metalness: 0.36, map: materialAtlasTile(10) });
    case "dark_roof":
      return new THREE.MeshStandardMaterial({ color: 0x20272d, roughness: 0.84, metalness: 0.05, map: materialAtlasTile(12) });
    case "warm_roof":
      return new THREE.MeshStandardMaterial({ color: 0x7f5a3e, roughness: 0.8, metalness: 0.02, map: materialAtlasTile(13) });
    case "glass_shard":
      return new THREE.MeshPhysicalMaterial({ color: 0xc7fbff, transparent: true, opacity: 0.58, roughness: 0.12, metalness: 0, depthWrite: false, envMapIntensity: 1.16 });
    case "scraped_metal":
      return new THREE.MeshStandardMaterial({ color: 0xb8c5ca, roughness: 0.42, metalness: 0.86, map: materialAtlasTile(1) });
    case "rubble_dark":
      return new THREE.MeshStandardMaterial({ color: 0x555553, roughness: 0.96, metalness: 0, map: materialAtlasTile(2) });
    case "rubble_light":
      return new THREE.MeshStandardMaterial({ color: 0xa6a59a, roughness: 0.92, metalness: 0, map: materialAtlasTile(15) });
    case "wood_end":
      return new THREE.MeshStandardMaterial({ color: 0x6e391b, roughness: 0.8, metalness: 0, map: materialAtlasTile(14) });
    case "painted_plastic":
      return new THREE.MeshStandardMaterial({ color: 0xffe05f, roughness: 0.62, metalness: 0.02, map: materialAtlasTile(7) });
    case "vehicle_glass":
      return new THREE.MeshBasicMaterial({ color: 0xa7f0ff, transparent: true, opacity: 0.7 });
    case "vehicle_roof_panel":
      return new THREE.MeshStandardMaterial({ color: 0x1a2228, roughness: 0.48, metalness: 0.28, map: materialAtlasTile(10) });
    case "vehicle_lower_shadow":
      return new THREE.MeshStandardMaterial({ color: 0x101419, roughness: 0.74, metalness: 0.18, map: materialAtlasTile(6) });
    case "vehicle_door_cut":
      return new THREE.MeshBasicMaterial({ color: 0x070a0d, transparent: true, opacity: 0.58 });
    case "taxi_roof_sign":
      return new THREE.MeshBasicMaterial({ color: 0xfff1a6, transparent: true, opacity: 0.95 });
    case "bus_roof_vent":
      return new THREE.MeshStandardMaterial({ color: 0x26323a, roughness: 0.56, metalness: 0.42, map: materialAtlasTile(10) });
    case "tanker_shell":
      return new THREE.MeshStandardMaterial({ color: 0xd7c06f, roughness: 0.38, metalness: 0.54, map: materialAtlasTile(10) });
    case "flatbed_deck":
      return new THREE.MeshStandardMaterial({ color: 0x262016, roughness: 0.74, metalness: 0.16, map: materialAtlasTile(14) });
    case "vehicle_lightbar":
      return new THREE.MeshBasicMaterial({ color: 0xff7898, transparent: true, opacity: 0.46 });
    case "headlight":
      return new THREE.MeshBasicMaterial({ color: 0xfff1c5, transparent: true, opacity: 0.58 });
    case "taillight":
      return new THREE.MeshBasicMaterial({ color: 0xff5267, transparent: true, opacity: 0.54 });
    case "license_plate":
      return new THREE.MeshBasicMaterial({ color: 0xe8edf2, transparent: true, opacity: 0.88 });
    case "parking_stripe":
      return new THREE.MeshBasicMaterial({ color: 0xf5e7a3, transparent: true, opacity: 0.78 });
    case "vehicle_seam":
      return new THREE.MeshBasicMaterial({ color: 0x101419, transparent: true, opacity: 0.66 });
    case "roof_rail":
      return new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.46, metalness: 0.72, map: materialAtlasTile(10) });
    case "tire":
      return new THREE.MeshStandardMaterial({ color: 0x161719, roughness: 0.9, metalness: 0, map: materialAtlasTile(6) });
    case "wheel_hub":
      return new THREE.MeshStandardMaterial({ color: 0xa8b6bd, roughness: 0.34, metalness: 0.72, map: materialAtlasTile(10) });
    case "cargo_strap":
      return new THREE.MeshStandardMaterial({ color: 0x22282e, roughness: 0.76, metalness: 0.18, map: materialAtlasTile(6) });
    case "cargo_top_wear":
      return new THREE.MeshStandardMaterial({ color: 0xd0b76a, roughness: 0.82, metalness: 0.04, map: materialAtlasTile(7) });
    case "rubber_foot":
      return new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.92, metalness: 0, map: materialAtlasTile(6) });
    case "dark_window":
      return new THREE.MeshBasicMaterial({ color: 0x0a1017, transparent: true, opacity: 0.82 });
    case "balcony_rail":
      return new THREE.MeshStandardMaterial({ color: 0x202a31, roughness: 0.56, metalness: 0.46, map: materialAtlasTile(10) });
    case "service_pipe":
      return new THREE.MeshStandardMaterial({ color: 0x37444c, roughness: 0.5, metalness: 0.62, map: materialAtlasTile(0) });
    case "awning_red":
      return new THREE.MeshStandardMaterial({ color: 0xb93431, roughness: 0.66, metalness: 0.02, map: materialAtlasTile(13) });
    case "parapet_dark":
      return new THREE.MeshStandardMaterial({ color: 0x171d22, roughness: 0.86, metalness: 0.08, map: materialAtlasTile(12) });
    case "water_tank":
      return new THREE.MeshStandardMaterial({ color: 0x7d8b93, roughness: 0.58, metalness: 0.42, map: materialAtlasTile(10) });
    case "relay_gel_core":
      return new THREE.MeshPhysicalMaterial({ color: 0xd92b72, transparent: true, opacity: 0.58, roughness: 0.28, metalness: 0.02, depthWrite: false, envMapIntensity: 0.9 });
    case "relay_gel_glow":
      return new THREE.MeshBasicMaterial({ color: 0xff77ad, transparent: true, opacity: 0.78 });
    case "relay_hazard_band":
      return new THREE.MeshBasicMaterial({ color: 0xffd66b });
    case "relay_pad_plate":
      return new THREE.MeshStandardMaterial({ color: 0x20272c, roughness: 0.52, metalness: 0.38, map: materialAtlasTile(10) });
    case "relay_pad_coil":
      return new THREE.MeshStandardMaterial({ color: 0x93f6ff, roughness: 0.3, metalness: 0.7, emissive: 0x0d5e78, emissiveIntensity: 0.5 });
    case "relay_pad_glow":
      return new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0.8 });
    case "relay_shock_glass":
      return new THREE.MeshPhysicalMaterial({ color: 0x8ff7ff, transparent: true, opacity: 0.5, roughness: 0.16, metalness: 0, depthWrite: false, envMapIntensity: 1.12 });
    case "relay_shock_cap":
      return new THREE.MeshStandardMaterial({ color: 0x33404c, roughness: 0.42, metalness: 0.62, map: materialAtlasTile(0) });
    case "relay_shock_core":
      return new THREE.MeshBasicMaterial({ color: 0xc7fbff, transparent: true, opacity: 0.9 });
    case "capacitor_copper":
      return new THREE.MeshStandardMaterial({ color: 0xbd7841, roughness: 0.36, metalness: 0.78, map: materialAtlasTile(10) });
    case "nuclear_concrete_rim":
      return new THREE.MeshStandardMaterial({ color: 0xd0cec2, roughness: 0.9, metalness: 0.02, map: materialAtlasTile(15) });
    case "nuclear_warning_green":
      return new THREE.MeshBasicMaterial({ color: 0xb9ff8a, transparent: true, opacity: 0.94 });
    case "reactor_glass":
      return new THREE.MeshPhysicalMaterial({ color: 0x9effd2, transparent: true, opacity: 0.46, roughness: 0.14, metalness: 0, depthWrite: false, envMapIntensity: 1.08 });
    case "reactor_core":
      return new THREE.MeshBasicMaterial({ color: 0xdfff80, transparent: true, opacity: 0.88 });
    default:
      return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
  }
}

function decorativeChildHost(parent: THREE.Mesh, create: boolean): THREE.Object3D {
  if (isUnitScale(parent.scale)) {
    return parent;
  }
  const userData = parent.userData as DetailRootUserData;
  let root = userData.unscaledDetailRoot;
  if (!root && create) {
    root = new THREE.Object3D();
    root.name = `${parent.name || "mesh"} unscaled details`;
    userData.unscaledDetailRoot = root;
    parent.add(root);
  }
  if (!root) {
    return parent;
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

function sharedChildBoxGeometry(): THREE.BoxGeometry {
  const key = "unit";
  const existing = childBoxGeometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.userData.sharedGeometry = true;
  childBoxGeometryCache.set(key, geometry);
  perfMonitor.addCount("render.childBoxGeometryCacheMiss");
  return geometry;
}

function hasPositiveDimensions(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value) && value > 0);
}

function sharedChildCylinderGeometry(radiusTopRatio: number, radiusBottomRatio: number): THREE.CylinderGeometry {
  const key = `${radiusTopRatio.toFixed(3)}:${radiusBottomRatio.toFixed(3)}`;
  const existing = childCylinderGeometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.CylinderGeometry(radiusTopRatio, radiusBottomRatio, 1, 12);
  geometry.userData.sharedGeometry = true;
  childCylinderGeometryCache.set(key, geometry);
  perfMonitor.addCount("render.childCylinderGeometryCacheMiss");
  return geometry;
}

function sharedChildSphereGeometry(): THREE.SphereGeometry {
  const key = "unit";
  const existing = childSphereGeometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.SphereGeometry(1, 24, 14);
  geometry.userData.sharedGeometry = true;
  childSphereGeometryCache.set(key, geometry);
  perfMonitor.addCount("render.childSphereGeometryCacheMiss");
  return geometry;
}
