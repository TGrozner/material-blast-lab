import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BUILDING_KIT_PROFILES, type BuildingKitProfile } from "./generated/buildingKit";
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

const FACADE_DEPTH = 0.016;
const TRIM_DEPTH = 0.022;
const GLASS_DEPTH = 0.014;
const DECAL_DEPTH = 0.012;
const FRONT_SKIN_OFFSET = 0.002;
const FRONT_TRIM_OFFSET = 0.018;
const FRONT_GLASS_OFFSET = 0.034;
const FRONT_DECAL_OFFSET = 0.05;
const SIDE_SKIN_OFFSET = 0.002;
const SIDE_TRIM_OFFSET = 0.014;

interface DetailRootUserData {
  unscaledDetailRoot?: THREE.Object3D;
  fragmentVisualParts?: THREE.Mesh[];
}

export function decorateBuildingCell(mesh: THREE.Mesh, options: BuildingCellVisualOptions): void {
  const palette = paletteFor(options.style, options.scoreRole);
  const profile = buildingKitProfile(options.style);
  const detail = facadeDetailFor(options);
  if (options.scoreRole === "neutral") {
    decorateNeutralBuildingCell(mesh, options, palette, profile);
    mergeOpaqueDecorativeChildrenByMaterial(mesh);
    return;
  }
  addFacadeSkin(mesh, options.size, palette.facade, FACADE_DEPTH, profile);
  if (options.floor === 0 || options.floor === options.floors - 1) {
    addCellSlabBands(mesh, options, palette.trim, profile, detail === "full" ? "full" : "lean");
  }
  addKitRelief(mesh, options, profile, palette.trim, detail);
  addWindowRows(mesh, options, profile);
  addVerticalTrim(mesh, options.size, palette.trim, options.column === 0, options.column === options.columns - 1);
  addPremiumFacadeDetails(mesh, options, palette.sign);
  addFacadeWeathering(mesh, options, profile, detail);

  if (options.floor === 0) {
    addStorefront(mesh, options.size, palette.sign, options.style, options.column, palette.trim, profile);
  }
  if (options.floor === options.floors - 1) {
    addRoofDetail(mesh, options, palette.roof, profile);
  }
  mergeOpaqueDecorativeChildrenByMaterial(mesh);
}

function decorateNeutralBuildingCell(
  mesh: THREE.Mesh,
  options: BuildingCellVisualOptions,
  palette: { facade: THREE.Material; trim: THREE.Material; roof: THREE.Material; sign: THREE.Material },
  profile: BuildingKitProfile
): void {
  const isGround = options.floor <= 1;
  const isTop = options.floor >= options.floors - 1;
  const isEdgeColumn = options.column === 0 || options.column === options.columns - 1;
  const isFeatureBand = (options.floor + options.column) % 4 === 0;

  if (isGround || isTop || (isEdgeColumn && isFeatureBand)) {
    addNeutralFacadeSkin(mesh, options.size, palette.facade, profile);
    if (isGround || isTop) {
      addCellSlabBands(mesh, options, palette.trim, profile, "lean");
    }
    if (isGround || isTop) {
      addKitRelief(mesh, options, profile, palette.trim, "lean");
    }
    addNeutralWindowBand(mesh, options, palette.trim, profile);
  }
  if (isGround && (options.column % 2 === 0 || isEdgeColumn)) {
    addNeutralStorefront(mesh, options.size, palette.sign, options.style, profile);
  }
  if (options.brand && (isGround || isTop) && options.column === 0) {
    addFauxBrandSign(mesh, options.size, options.brand, isTop ? "crown" : "storefront");
  }
  if (options.brand && options.column === 0 && isTop) {
    addFacadeDepthBreaks(mesh, options, palette.trim);
  }
  if ((options.brand && (isGround || isTop)) || (isTop && isEdgeColumn)) {
    addFacadeWeathering(mesh, options, profile, options.brand ? "standard" : "lean");
  }
  if (isTop) {
    addNeutralRoofDetail(mesh, options.size, palette.roof, profile);
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
      },
      {
        size: new THREE.Vector3(options.size.x * 0.34, Math.max(0.01, options.size.y * 0.18), options.size.z * 1.04),
        offset: new THREE.Vector3(-options.size.x * 0.22, -options.size.y * 0.12, options.size.z * 0.12),
        rotation: new THREE.Euler(0, 0, -Math.PI * 0.12),
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
      },
      {
        size: new THREE.Vector3(Math.max(0.025, options.size.x * 0.08), options.size.y * 0.78, Math.max(0.025, options.size.z * 0.08)),
        offset: new THREE.Vector3(-options.size.x * 0.32, 0, options.size.z * 0.34),
        rotation: new THREE.Euler(0, 0, -Math.PI * 0.08),
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
      },
      {
        size: new THREE.Vector3(Math.max(0.025, options.size.x * 0.08), Math.max(0.025, options.size.y * 0.08), options.size.z * 1.08),
        offset: new THREE.Vector3(-options.size.x * 0.28, options.size.y * 0.04, options.size.z * 0.06),
        rotation: new THREE.Euler(0, 0, Math.PI * 0.05),
        material: material("scraped_metal")
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
      },
      {
        size: new THREE.Vector3(options.size.x * 0.14, options.size.y * 0.68, options.size.z * 0.22),
        offset: new THREE.Vector3(-options.size.x * 0.32, options.size.y * 0.08, options.size.z * 0.34),
        rotation: new THREE.Euler(0, -Math.PI * 0.12, Math.PI * 0.07),
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
      },
      {
        size: new THREE.Vector3(options.size.x * 0.48, options.size.y * 0.12, options.size.z * 0.42),
        offset: new THREE.Vector3(options.size.x * 0.18, -options.size.y * 0.28, options.size.z * 0.24),
        rotation: new THREE.Euler(0, 0, -Math.PI * 0.06),
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

function frontLayerZ(size: THREE.Vector3, depth: number, offset: number): number {
  return size.z * 0.5 + offset + depth * 0.5;
}

function backLayerZ(size: THREE.Vector3, depth: number, offset: number): number {
  return -size.z * 0.5 - offset - depth * 0.5;
}

function leftLayerX(size: THREE.Vector3, depth: number, offset: number): number {
  return -size.x * 0.5 - offset - depth * 0.5;
}

function rightLayerX(size: THREE.Vector3, depth: number, offset: number): number {
  return size.x * 0.5 + offset + depth * 0.5;
}

function buildingVariant(options: BuildingCellVisualOptions): number {
  let hash = 2166136261;
  hash = Math.imul(hash ^ (options.floor + 1), 16777619);
  hash = Math.imul(hash ^ (options.column + 3), 16777619);
  hash = Math.imul(hash ^ (options.floors + 5), 16777619);
  hash = Math.imul(hash ^ (options.columns + 7), 16777619);
  for (let index = 0; index < options.style.length; index += 1) {
    hash = Math.imul(hash ^ options.style.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

function facadeDetailFor(options: BuildingCellVisualOptions): "full" | "standard" | "lean" {
  if (options.scoreRole === "neutral") {
    return "lean";
  }
  if (options.floor === 0 || options.floor === options.floors - 1 || options.brand) {
    return "full";
  }
  if (options.column === 0 || options.column === options.columns - 1) {
    return options.floor % 2 === 0 ? "full" : "standard";
  }
  return (options.floor + options.column) % 3 === 0 ? "standard" : "lean";
}

function buildingKitProfile(style: BuildingVisualStyle): BuildingKitProfile {
  return BUILDING_KIT_PROFILES[style];
}

function addFacadeSkin(
  mesh: THREE.Mesh,
  size: THREE.Vector3,
  materialRef: THREE.Material,
  depth: number,
  profile: BuildingKitProfile
): void {
  const facade = profile.facade;
  addChildBox(mesh, size.x * facade.frontWidth, size.y * facade.frontHeight, depth, materialRef, {
    z: frontLayerZ(size, depth, FRONT_SKIN_OFFSET)
  });
  addChildBox(mesh, size.x * facade.backWidth, size.y * facade.backHeight, depth, materialRef, {
    z: backLayerZ(size, depth, FRONT_SKIN_OFFSET)
  });
  addChildBox(mesh, depth, size.y * facade.sideHeight, size.z * facade.sideDepth, materialRef, {
    x: leftLayerX(size, depth, SIDE_SKIN_OFFSET)
  });
  addChildBox(mesh, depth, size.y * facade.sideHeight, size.z * facade.sideDepth, materialRef, {
    x: rightLayerX(size, depth, SIDE_SKIN_OFFSET)
  });
}

function addCellSlabBands(
  mesh: THREE.Mesh,
  options: BuildingCellVisualOptions,
  trimMaterial: THREE.Material,
  profile: BuildingKitProfile,
  detail: "full" | "lean" = "full"
): void {
  const size = options.size;
  const z = frontLayerZ(size, TRIM_DEPTH, FRONT_TRIM_OFFSET);
  const massing = profile.massing;
  const bandHeight = Math.max(0.022, size.y * (options.floor === 0 ? massing.baseHeight : massing.crownHeight) * 0.42);
  const width = size.x * (detail === "lean" ? Math.min(0.86, massing.crownWidth) : massing.crownWidth);
  addChildBox(mesh, width, bandHeight, TRIM_DEPTH, trimMaterial, {
    y: -size.y * 0.5 + bandHeight * 0.55,
    z
  });
  addChildBox(mesh, width, bandHeight, TRIM_DEPTH, trimMaterial, {
    y: size.y * 0.5 - bandHeight * 0.55,
    z
  });

  if (options.floor === 0) {
    addFoundationBand(mesh, size, trimMaterial, profile, detail);
  }
}

function addFoundationBand(
  mesh: THREE.Mesh,
  size: THREE.Vector3,
  trimMaterial: THREE.Material,
  profile: BuildingKitProfile,
  detail: "full" | "lean"
): void {
  const massing = profile.massing;
  const height = Math.max(0.055, size.y * (detail === "lean" ? massing.baseHeight * 0.72 : massing.baseHeight));
  addChildBox(mesh, size.x * (detail === "lean" ? Math.min(0.86, massing.baseWidth) : massing.baseWidth), height, TRIM_DEPTH, trimMaterial, {
    y: -size.y * 0.5 + height * 0.5,
    z: frontLayerZ(size, TRIM_DEPTH, FRONT_TRIM_OFFSET + 0.012)
  });
  if (detail === "full") {
    addChildBox(mesh, TRIM_DEPTH, height * 0.86, size.z * massing.sideReturn, trimMaterial, {
      x: leftLayerX(size, TRIM_DEPTH, SIDE_TRIM_OFFSET)
    });
    addChildBox(mesh, TRIM_DEPTH, height * 0.86, size.z * massing.sideReturn, trimMaterial, {
      x: rightLayerX(size, TRIM_DEPTH, SIDE_TRIM_OFFSET)
    });
  }
}

function addKitRelief(
  mesh: THREE.Mesh,
  options: BuildingCellVisualOptions,
  profile: BuildingKitProfile,
  trimMaterial: THREE.Material,
  detail: "full" | "standard" | "lean"
): void {
  if (detail === "lean" && options.scoreRole !== "target") {
    return;
  }
  const size = options.size;
  const ribWidth = detail === "full" ? 0.024 : 0.016;
  const ribHeight = size.y * (detail === "full" ? 0.78 : 0.56);
  const z = frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET - 0.004);
  const ribLimit = detail === "full" ? profile.frontRibs.length : Math.min(2, profile.frontRibs.length);
  for (let index = 0; index < ribLimit; index += 1) {
    const x = profile.frontRibs[index] * size.x;
    addChildBox(mesh, ribWidth, ribHeight, DECAL_DEPTH, trimMaterial, {
      x,
      y: 0,
      z
    });
  }
  if (detail === "full" || options.floor === 0 || options.floor === options.floors - 1) {
    for (const yRatio of profile.horizontalBands) {
      addChildBox(mesh, size.x * 0.82, Math.max(0.012, size.y * 0.026), DECAL_DEPTH, trimMaterial, {
        y: size.y * yRatio,
        z: z + 0.004
      });
    }
  }
  if (detail === "full") {
    for (const zRatio of profile.sideRibs) {
      addChildBox(mesh, DECAL_DEPTH, size.y * 0.52, Math.max(0.018, size.z * 0.024), trimMaterial, {
        x: leftLayerX(size, DECAL_DEPTH, SIDE_TRIM_OFFSET + 0.012),
        z: size.z * zRatio
      });
      addChildBox(mesh, DECAL_DEPTH, size.y * 0.52, Math.max(0.018, size.z * 0.024), trimMaterial, {
        x: rightLayerX(size, DECAL_DEPTH, SIDE_TRIM_OFFSET + 0.012),
        z: size.z * zRatio
      });
    }
  }
}

function addNeutralFacadeSkin(mesh: THREE.Mesh, size: THREE.Vector3, materialRef: THREE.Material, profile: BuildingKitProfile): void {
  addChildBox(mesh, size.x * profile.facade.frontWidth * 0.96, size.y * profile.facade.frontHeight * 0.92, FACADE_DEPTH, materialRef, {
    z: frontLayerZ(size, FACADE_DEPTH, FRONT_SKIN_OFFSET)
  });
}

function addNeutralWindowBand(
  mesh: THREE.Mesh,
  options: BuildingCellVisualOptions,
  mullionMaterial: THREE.Material,
  profile: BuildingKitProfile
): void {
  const variant = buildingVariant(options);
  addFacadeModule(mesh, options, profile, 0, options.size.y * profile.windows.yOffset, options.size.x * 0.56, options.size.y * 0.22, variant, "lean", mullionMaterial);
  if (options.style === "industrial" || options.style === "warehouse" || options.style === "utility") {
    addChildBox(mesh, options.size.x * 0.62, 0.024, TRIM_DEPTH, mullionMaterial, {
      y: -options.size.y * 0.15,
      z: frontLayerZ(options.size, TRIM_DEPTH, FRONT_DECAL_OFFSET)
    });
  }
}

function addNeutralStorefront(
  mesh: THREE.Mesh,
  size: THREE.Vector3,
  signMaterial: THREE.Material,
  style: BuildingVisualStyle,
  profile: BuildingKitProfile
): void {
  const storefront = profile.storefront;
  addChildBox(mesh, size.x * storefront.signWidth * 0.82, 0.075, DECAL_DEPTH, signMaterial, {
    y: size.y * storefront.signY,
    z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET)
  });
  if (style === "market" || style === "apartment") {
    addChildBox(mesh, size.x * storefront.glassWidth * 0.78, Math.max(0.08, size.y * storefront.glassHeight * 0.72), GLASS_DEPTH, material("shop_glass"), {
      y: -size.y * 0.08,
      z: frontLayerZ(size, GLASS_DEPTH, FRONT_GLASS_OFFSET)
    });
  }
}

function addNeutralRoofDetail(mesh: THREE.Mesh, size: THREE.Vector3, roofMaterial: THREE.Material, profile: BuildingKitProfile): void {
  const roof = profile.roof;
  addChildBox(mesh, size.x * roof.capWidth, 0.045, size.z * roof.capDepth, roofMaterial, { y: size.y * 0.5 + 0.034 });
  addChildBox(mesh, size.x * roof.mechanicalWidth * 0.78, 0.05, size.z * roof.mechanicalDepth, material("roof_unit"), {
    x: -size.x * 0.14,
    y: size.y * 0.5 + 0.084,
    z: size.z * 0.08
  });
}

function addWindowRows(mesh: THREE.Mesh, options: BuildingCellVisualOptions, profile: BuildingKitProfile): void {
  const detail = facadeDetailFor(options);
  const windowProfile = profile.windows;
  const rows = windowProfile.rows;
  const columns = windowProfile.columns;
  const mullionMaterial = material(options.scoreRole === "target" ? "hazard_trim" : "dark_trim");
  const usableWidth = options.size.x * windowProfile.usableWidth;
  const usableHeight = options.size.y * windowProfile.usableHeight;
  const width = usableWidth / columns;
  const height = usableHeight / rows;
  const variant = buildingVariant(options);
  const windowMaterial = material(windowGlassMaterial(windowProfile.glass, variant));

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = (column - (columns - 1) * 0.5) * width * windowProfile.xSpread;
      const y = (row - (rows - 1) * 0.5) * height * windowProfile.ySpread + options.size.y * windowProfile.yOffset;
      addChildBox(mesh, width * windowProfile.widthScale, height * windowProfile.heightScale, GLASS_DEPTH, windowMaterial, {
        x,
        y,
        z: frontLayerZ(options.size, GLASS_DEPTH, FRONT_GLASS_OFFSET + 0.004)
      });
      if (detail === "full" && windowProfile.frame !== "lean") {
        addChildBox(mesh, width * 0.82, Math.max(0.012, height * 0.04), DECAL_DEPTH, mullionMaterial, {
          x,
          y: y - height * 0.38,
          z: frontLayerZ(options.size, DECAL_DEPTH, FRONT_DECAL_OFFSET + 0.004)
        });
      }
    }
  }

  if (options.style === "industrial" || options.style === "warehouse") {
    addChildBox(mesh, options.size.x * 0.78, 0.035, TRIM_DEPTH, mullionMaterial, {
      y: -options.size.y * 0.08,
      z: frontLayerZ(options.size, TRIM_DEPTH, FRONT_DECAL_OFFSET)
    });
    if (detail === "full" || options.floor === 0) {
      addWarehouseFacadeMarks(mesh, options, mullionMaterial);
    }
  }
  if (options.style === "apartment" && options.floor % 2 === 0) {
    addApartmentBalcony(mesh, options);
  }
}

function addFacadeModule(
  mesh: THREE.Mesh,
  options: BuildingCellVisualOptions,
  profile: BuildingKitProfile,
  x: number,
  y: number,
  width: number,
  height: number,
  variant: number,
  detail: "full" | "standard" | "lean",
  trimMaterial: THREE.Material
): void {
  const size = options.size;
  const windowProfile = profile.windows;
  const glassMaterial = windowGlassMaterial(windowProfile.glass, variant);
  const frameZ = frontLayerZ(size, TRIM_DEPTH, FRONT_TRIM_OFFSET + 0.006);
  const glassZ = frontLayerZ(size, GLASS_DEPTH, FRONT_GLASS_OFFSET + 0.004);
  const mullionZ = frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET + 0.004);
  const frameWidth = Math.max(0.035, width);
  const frameHeight = Math.max(0.055, height);
  const glassWidthScale = Math.min(0.9, windowProfile.widthScale + 0.04);
  const glassHeightScale = Math.min(0.9, windowProfile.heightScale + 0.06);

  const drawFrame =
    windowProfile.frame === "full" ||
    (windowProfile.frame === "standard" && (options.floor === 0 || options.floor === options.floors - 1 || detail === "full"));
  if (drawFrame) {
    addChildBox(mesh, frameWidth, frameHeight, TRIM_DEPTH, trimMaterial, { x, y, z: frameZ });
  }
  addChildBox(mesh, frameWidth * glassWidthScale, frameHeight * glassHeightScale, GLASS_DEPTH, glassMaterial, { x, y, z: glassZ });

  const mullionWidth = Math.max(0.012, frameWidth * (options.style === "glassTower" ? 0.035 : 0.05));
  const mullionHeight = Math.max(0.012, frameHeight * 0.055);
  if (detail !== "lean" && windowProfile.frame !== "lean") {
    addChildBox(mesh, mullionWidth, frameHeight * 0.72, DECAL_DEPTH, trimMaterial, { x, y, z: mullionZ });
    if (options.style !== "warehouse" && options.style !== "utility") {
      addChildBox(mesh, frameWidth * 0.72, mullionHeight, DECAL_DEPTH, trimMaterial, { x, y, z: mullionZ + 0.003 });
    }
  }

  if (detail === "full" && windowProfile.frame === "full" && options.style !== "glassTower") {
    const sillHeight = Math.max(0.016, frameHeight * 0.09);
    addChildBox(mesh, frameWidth * 1.08, sillHeight, TRIM_DEPTH, trimMaterial, {
      x,
      y: y - frameHeight * 0.5 - sillHeight * 0.62,
      z: frameZ + 0.004
    });
  }

  if (variant % 13 === 0) {
    addChildBox(mesh, frameWidth * 0.62, frameHeight * 0.58, DECAL_DEPTH, "dark_window", {
      x,
      y,
      z: mullionZ + 0.006
    });
  }
}

function windowGlassMaterial(preferred: BuildingKitProfile["windows"]["glass"], variant: number): string {
  if (variant % 13 === 0) {
    return "dark_window";
  }
  return preferred;
}

function addWarehouseFacadeMarks(mesh: THREE.Mesh, options: BuildingCellVisualOptions, trimMaterial: THREE.Material): void {
  const size = options.size;
  const z = frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET + 0.006);
  const railCount = options.style === "warehouse" ? 3 : 2;
  for (let index = 0; index < railCount; index += 1) {
    const y = -size.y * 0.28 + index * size.y * 0.15;
    addChildBox(mesh, size.x * 0.58, 0.012, DECAL_DEPTH, trimMaterial, { y, z });
  }
  if (options.floor === 0 && options.style === "warehouse") {
    addChildBox(mesh, size.x * 0.42, size.y * 0.26, TRIM_DEPTH, trimMaterial, {
      y: -size.y * 0.18,
      z: frontLayerZ(size, TRIM_DEPTH, FRONT_TRIM_OFFSET + 0.012)
    });
  }
}

function addApartmentBalcony(mesh: THREE.Mesh, options: BuildingCellVisualOptions): void {
  const size = options.size;
  const z = frontLayerZ(size, TRIM_DEPTH, FRONT_DECAL_OFFSET + 0.018);
  const y = -size.y * 0.2;
  addChildBox(mesh, size.x * 0.66, 0.024, 0.072, material("balcony_rail"), { y, z });
  for (const x of [-0.28, 0, 0.28]) {
    addChildBox(mesh, 0.014, 0.12, 0.044, material("balcony_rail"), {
      x: size.x * x,
      y: y + 0.05,
      z: z + 0.006
    });
  }
}

function addVerticalTrim(
  mesh: THREE.Mesh,
  size: THREE.Vector3,
  materialRef: THREE.Material,
  leftEdge: boolean,
  rightEdge: boolean
): void {
  addChildBox(mesh, 0.035, size.y * 0.96, TRIM_DEPTH, materialRef, {
    x: -size.x * 0.46,
    z: frontLayerZ(size, TRIM_DEPTH, FRONT_TRIM_OFFSET + 0.006)
  });
  addChildBox(mesh, 0.035, size.y * 0.96, TRIM_DEPTH, materialRef, {
    x: size.x * 0.46,
    z: frontLayerZ(size, TRIM_DEPTH, FRONT_TRIM_OFFSET + 0.006)
  });
  if (leftEdge) {
    addChildBox(mesh, TRIM_DEPTH, size.y * 0.78, size.z * 0.74, materialRef, {
      x: leftLayerX(size, TRIM_DEPTH, SIDE_TRIM_OFFSET)
    });
  }
  if (rightEdge) {
    addChildBox(mesh, TRIM_DEPTH, size.y * 0.78, size.z * 0.74, materialRef, {
      x: rightLayerX(size, TRIM_DEPTH, SIDE_TRIM_OFFSET)
    });
  }
}

function addStorefront(
  mesh: THREE.Mesh,
  size: THREE.Vector3,
  signMaterial: THREE.Material,
  style: BuildingVisualStyle,
  column: number,
  trimMaterial: THREE.Material,
  profile: BuildingKitProfile
): void {
  const storefront = profile.storefront;
  if (style === "industrial" && column % 2 === 0) {
    addChildBox(mesh, size.x * storefront.signWidth, 0.09, DECAL_DEPTH, signMaterial, {
      y: size.y * storefront.signY,
      z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET)
    });
    addChildBox(mesh, size.x * storefront.doorWidth, size.y * storefront.doorHeight, TRIM_DEPTH, trimMaterial, {
      y: -size.y * 0.08,
      z: frontLayerZ(size, TRIM_DEPTH, FRONT_TRIM_OFFSET + 0.012)
    });
    addChildBox(mesh, 0.035, size.y * 0.72, 0.035, material("service_pipe"), {
      x: size.x * storefront.pipeX,
      y: 0,
      z: frontLayerZ(size, 0.035, FRONT_DECAL_OFFSET + 0.012)
    });
  } else if (style === "warehouse") {
    addChildBox(mesh, size.x * storefront.signWidth, 0.07, DECAL_DEPTH, signMaterial, {
      y: size.y * storefront.signY,
      z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET)
    });
    addChildBox(mesh, size.x * storefront.doorWidth, size.y * storefront.doorHeight, TRIM_DEPTH, trimMaterial, {
      y: -size.y * 0.08,
      z: frontLayerZ(size, TRIM_DEPTH, FRONT_TRIM_OFFSET + 0.012)
    });
    for (const y of [-0.17, -0.08, 0.01]) {
      addChildBox(mesh, size.x * 0.5, 0.012, DECAL_DEPTH, trimMaterial, {
        y: size.y * y,
        z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET + 0.008)
      });
    }
  } else if (style === "market" || style === "apartment") {
    addChildBox(mesh, size.x * storefront.signWidth, 0.08, DECAL_DEPTH, signMaterial, {
      y: size.y * storefront.signY,
      z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET)
    });
    addChildBox(mesh, size.x * Math.max(storefront.glassWidth, storefront.doorWidth + 0.2), size.y * Math.max(0.18, storefront.glassHeight), TRIM_DEPTH, trimMaterial, {
      y: -size.y * 0.06,
      z: frontLayerZ(size, TRIM_DEPTH, FRONT_TRIM_OFFSET + 0.014)
    });
    addChildBox(mesh, size.x * storefront.glassWidth * 0.74, size.y * storefront.glassHeight, GLASS_DEPTH, material("shop_glass"), {
      y: -size.y * 0.055,
      z: frontLayerZ(size, GLASS_DEPTH, FRONT_GLASS_OFFSET + 0.006)
    });
    addChildBox(mesh, Math.max(0.05, size.x * storefront.doorWidth * 0.26), size.y * storefront.doorHeight, DECAL_DEPTH, trimMaterial, {
      x: size.x * 0.18,
      y: -size.y * 0.065,
      z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET + 0.006)
    });
    addChildBox(mesh, size.x * storefront.canopyWidth, 0.045, Math.max(0.04, storefront.canopyDepth), material("awning_red"), {
      y: -size.y * 0.17,
      z: frontLayerZ(size, Math.max(0.04, storefront.canopyDepth), FRONT_DECAL_OFFSET + 0.03),
      rotationX: Math.PI * 0.04
    });
  } else if (style === "civic" || style === "utility") {
    addChildBox(mesh, size.x * storefront.signWidth, 0.07, DECAL_DEPTH, signMaterial, {
      y: size.y * storefront.signY,
      z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET)
    });
    addChildBox(mesh, size.x * storefront.doorWidth, size.y * storefront.doorHeight, TRIM_DEPTH, trimMaterial, {
      y: -size.y * 0.08,
      z: frontLayerZ(size, TRIM_DEPTH, FRONT_TRIM_OFFSET + 0.012)
    });
    addChildBox(mesh, 0.035, size.y * 0.82, 0.035, material("service_pipe"), {
      x: size.x * storefront.pipeX,
      y: 0,
      z: frontLayerZ(size, 0.035, FRONT_DECAL_OFFSET + 0.012)
    });
  }
}

function addRoofDetail(
  mesh: THREE.Mesh,
  options: BuildingCellVisualOptions,
  roofMaterial: THREE.Material,
  profile: BuildingKitProfile
): void {
  const size = options.size;
  const roof = profile.roof;
  addChildBox(mesh, size.x * roof.capWidth, 0.045, size.z * roof.capDepth, roofMaterial, { y: size.y * 0.5 + 0.034 });
  addChildBox(mesh, size.x * (roof.capWidth + 0.04), roof.parapetHeight, 0.045, material("parapet_dark"), { y: size.y * 0.5 + 0.096, z: size.z * 0.5 });
  addChildBox(mesh, size.x * (roof.capWidth + 0.04), roof.parapetHeight, 0.045, material("parapet_dark"), { y: size.y * 0.5 + 0.096, z: -size.z * 0.5 });
  addChildBox(mesh, 0.045, roof.parapetHeight, size.z * (roof.capDepth + 0.04), material("parapet_dark"), { x: -size.x * 0.5, y: size.y * 0.5 + 0.096 });
  addChildBox(mesh, 0.045, roof.parapetHeight, size.z * (roof.capDepth + 0.04), material("parapet_dark"), { x: size.x * 0.5, y: size.y * 0.5 + 0.096 });
  addChildBox(mesh, size.x * roof.mechanicalWidth, 0.055, size.z * roof.mechanicalDepth, material("roof_unit"), {
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
    addChildBox(mesh, size.x * roof.screenWidth, 0.12, size.z * roof.screenWidth, material("neon_cyan"), {
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
        addChildBox(mesh, size.x * roof.screenWidth, 0.04, 0.055, material("roof_unit"), {
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
  addRoofSilhouetteAccents(mesh, options, profile);
}

function addPremiumFacadeDetails(
  mesh: THREE.Mesh,
  options: BuildingCellVisualOptions,
  signMaterial: THREE.Material
): void {
  const size = options.size;
  const prominentCell = options.floor === 0 || options.floor === options.floors - 1 || (Boolean(options.brand) && options.column === 0);
  if (options.brand && options.column === 0 && (options.floor === 0 || options.floor === options.floors - 1)) {
    addFauxBrandSign(mesh, size, options.brand, options.floor === options.floors - 1 ? "crown" : "storefront");
  }
  if (options.scoreRole === "target" && prominentCell) {
    addChildBox(mesh, size.x * 0.52, 0.08, DECAL_DEPTH, material("hazard_chevron"), {
      y: size.y * 0.22,
      z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET + 0.008)
    });
  }
  if (options.style === "glassTower" && prominentCell) {
    addChildBox(mesh, 0.028, size.y * 0.74, DECAL_DEPTH, material("neon_cyan"), {
      x: size.x * 0.38,
      y: 0,
      z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET)
    });
    addChildBox(mesh, 0.028, size.y * 0.74, DECAL_DEPTH, material("neon_cyan"), {
      x: -size.x * 0.38,
      y: 0,
      z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET)
    });
  }
  if (options.floor === 0 && options.column % 2 === 0) {
    addChildBox(mesh, size.x * 0.36, 0.045, DECAL_DEPTH, signMaterial, {
      y: -size.y * 0.34,
      z: frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET + 0.012)
    });
  }
  if (options.brand && options.column === 0 && (options.floor === 0 || options.floor === options.floors - 1)) {
    addFacadeDepthBreaks(mesh, options, signMaterial);
  }
}

function addFacadeWeathering(
  mesh: THREE.Mesh,
  options: BuildingCellVisualOptions,
  profile: BuildingKitProfile,
  _detail: "full" | "standard" | "lean"
): void {
  const size = options.size;
  const variant = buildingVariant(options);
  const targetFeatureCell =
    options.scoreRole === "target" &&
    options.column === 0 &&
    (options.floor === 0 || options.floor === options.floors - 1);
  const brandFeatureCell = Boolean(options.brand) && options.column === 0 && (options.floor === 0 || options.floor === options.floors - 1);
  const signatureCell = brandFeatureCell || targetFeatureCell;
  const visibleFeatureCell =
    signatureCell ||
    (_detail === "full" &&
      variant % 9 === 0 &&
      (options.floor === 0 ||
        options.floor === options.floors - 1 ||
        options.column === 0 ||
        options.column === options.columns - 1));
  if (!visibleFeatureCell) {
    return;
  }

  const z = frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET + 0.018);
  const grimeCount = signatureCell ? Math.min(3, profile.weathering.grime.length) : Math.min(2, profile.weathering.grime.length);
  for (let index = 0; index < grimeCount; index += 1) {
    const xRatio = profile.weathering.grime[index];
    const height = size.y * THREE.MathUtils.clamp(0.18 + profile.weathering.soot * 0.16 - index * 0.025, 0.14, 0.32);
    addChildBox(mesh, Math.max(0.018, size.x * 0.026), height, DECAL_DEPTH, "shadow_reveal", {
      x: size.x * xRatio,
      y: size.y * (0.24 - index * 0.12),
      z
    });
  }

  if (options.floor === options.floors - 1 && profile.weathering.soot > 0.42) {
    addChildBox(mesh, size.x * 0.62, Math.max(0.025, size.y * 0.04), DECAL_DEPTH, "shadow_reveal", {
      y: size.y * 0.36,
      z: z + 0.004
    });
  }

  if (_detail !== "lean" && profile.weathering.brokenWindows > 0.12 && variant % 7 < Math.ceil(profile.weathering.brokenWindows * 10)) {
    addChildBox(mesh, size.x * 0.16, size.y * 0.12, DECAL_DEPTH, "dark_window", {
      x: size.x * (((variant >>> 3) % 5) - 2) * 0.12,
      y: size.y * ((((variant >>> 6) % 3) - 1) * 0.18 + profile.windows.yOffset),
      z: z + 0.006
    });
  }

  if (profile.weathering.litWindows > 0.12 && visibleFeatureCell && variant % 11 < Math.ceil(profile.weathering.litWindows * 10)) {
    addChildBox(mesh, size.x * 0.12, size.y * 0.085, DECAL_DEPTH, "warm_window", {
      x: size.x * (((variant >>> 2) % 3) - 1) * 0.18,
      y: size.y * (profile.windows.yOffset + 0.16),
      z: z + 0.008
    });
  }
}

function addRoofSilhouetteAccents(mesh: THREE.Mesh, options: BuildingCellVisualOptions, profile: BuildingKitProfile): void {
  const size = options.size;
  const silhouette = profile.silhouette;
  const edgeColumn = options.column === 0 || options.column === options.columns - 1;
  const prominent = Boolean(options.brand) && edgeColumn;
  if (!prominent) {
    return;
  }

  if (silhouette.crownInset > 0.04) {
    addChildBox(mesh, size.x * Math.max(0.32, 1 - silhouette.crownInset * 2.2), 0.036, size.z * Math.max(0.18, 0.26 + silhouette.setbackDepth), material("mechanical_screen"), {
      y: size.y * 0.5 + 0.168,
      z: -size.z * 0.18
    });
  }
  if (silhouette.sideBladeHeight > 0.32 && edgeColumn) {
    addChildBox(mesh, 0.035, silhouette.sideBladeHeight, 0.065, material("roof_rail"), {
      x: options.column === 0 ? -size.x * 0.43 : size.x * 0.43,
      y: size.y * 0.5 + silhouette.sideBladeHeight * 0.5,
      z: size.z * 0.18
    });
  }
  if (silhouette.antennaHeight > 0.18 && (options.column + options.floors) % 2 === 0) {
    addChildCylinder(mesh, 0.01, 0.016, silhouette.antennaHeight, material("roof_rail"), {
      x: size.x * 0.24,
      y: size.y * 0.5 + 0.18 + silhouette.antennaHeight * 0.5,
      z: -size.z * 0.24
    });
  }
}

function addFacadeDepthBreaks(mesh: THREE.Mesh, options: BuildingCellVisualOptions, trimMaterial: THREE.Material): void {
  const size = options.size;
  const z = frontLayerZ(size, TRIM_DEPTH, FRONT_DECAL_OFFSET + 0.002);
  if (options.floors >= 6 && (options.floor % 2 === 1 || options.floor === options.floors - 1)) {
    addChildBox(mesh, size.x * 0.82, 0.022, TRIM_DEPTH, trimMaterial, {
      y: -size.y * 0.42,
      z
    });
  }
  if (options.columns >= 4 && (options.column === 0 || options.column === options.columns - 1)) {
    addChildBox(mesh, 0.026, size.y * 0.78, DECAL_DEPTH, material("shadow_reveal"), {
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
  const z = frontLayerZ(size, DECAL_DEPTH, FRONT_DECAL_OFFSET + 0.014);
  const y = placement === "crown" ? size.y * 0.28 : -size.y * 0.3;
  const panelWidth = placement === "crown" ? size.x * 0.44 : size.x * 0.5;
  const panelHeight = placement === "crown" ? size.y * 0.16 : size.y * 0.12;
  addChildBox(mesh, panelWidth, Math.max(0.052, panelHeight), DECAL_DEPTH, material(`${brand}_brand_panel`), { y, z });

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
        color: 0x82b8c2,
        transparent: true,
        opacity: 0.62,
        roughness: 0.34,
        metalness: 0.18,
        emissive: 0x0b252e,
        emissiveIntensity: 0.12,
        depthWrite: false
      });
    case "warm_window":
      return new THREE.MeshStandardMaterial({
        color: 0xc9a766,
        transparent: true,
        opacity: 0.56,
        roughness: 0.4,
        metalness: 0.08,
        emissive: 0x2a1903,
        emissiveIntensity: 0.14,
        depthWrite: false
      });
    case "shop_glass":
      return new THREE.MeshPhysicalMaterial({
        color: 0xb5edf0,
        transparent: true,
        opacity: 0.46,
        roughness: 0.12,
        metalness: 0,
        depthWrite: false,
        envMapIntensity: 1.18
      });
    case "hazard_facade":
      return new THREE.MeshStandardMaterial({ color: 0x7a3a2d, roughness: 0.82, metalness: 0.04, map: materialAtlasTile(4) });
    case "hazard_trim":
      return new THREE.MeshStandardMaterial({ color: 0xff7a35, roughness: 0.44, metalness: 0.08, emissive: 0x4a1508, emissiveIntensity: 0.45 });
    case "hazard_sign":
      return new THREE.MeshStandardMaterial({ color: 0xffa23f, roughness: 0.52, metalness: 0.04, map: materialAtlasTile(7) });
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
      return new THREE.MeshStandardMaterial({ color: 0x574b42, roughness: 0.86, metalness: 0.02, map: materialAtlasTile(13) });
    case "market_trim":
      return new THREE.MeshStandardMaterial({ color: 0xf0c16a, roughness: 0.5, metalness: 0.06 });
    case "market_sign":
      return new THREE.MeshStandardMaterial({ color: 0xffe08c, roughness: 0.56, metalness: 0.02, map: materialAtlasTile(7) });
    case "glass_facade":
      return new THREE.MeshPhysicalMaterial({
        color: 0x558b94,
        transparent: true,
        opacity: 0.56,
        roughness: 0.26,
        metalness: 0.02,
        depthWrite: false,
        map: materialAtlasTile(8),
        envMapIntensity: 1.05
      });
    case "industrial_facade":
      return new THREE.MeshStandardMaterial({ color: 0x5b666b, roughness: 0.84, metalness: 0.1, map: materialAtlasTile(12) });
    case "civic_facade":
      return new THREE.MeshStandardMaterial({ color: 0x77756c, roughness: 0.9, metalness: 0.02, map: materialAtlasTile(15) });
    case "utility_facade":
      return new THREE.MeshStandardMaterial({ color: 0x55636b, roughness: 0.82, metalness: 0.18, map: materialAtlasTile(2) });
    case "apartment_facade":
      return new THREE.MeshStandardMaterial({ color: 0x6f5e53, roughness: 0.86, metalness: 0.02, map: materialAtlasTile(13) });
    case "warehouse_facade":
      return new THREE.MeshStandardMaterial({ color: 0x667078, roughness: 0.84, metalness: 0.08, map: materialAtlasTile(3) });
    case "cool_trim":
      return new THREE.MeshStandardMaterial({ color: 0x7ec7d2, roughness: 0.46, metalness: 0.22 });
    case "cool_sign":
      return new THREE.MeshStandardMaterial({ color: 0x74dfff, roughness: 0.46, metalness: 0.18, map: materialAtlasTile(11) });
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
      return new THREE.MeshStandardMaterial({ color: 0x626c70, roughness: 0.88, metalness: 0.02, map: materialAtlasTile(3) });
    case "dark_trim":
      return new THREE.MeshStandardMaterial({ color: 0x313a42, roughness: 0.58, metalness: 0.16, map: materialAtlasTile(1) });
    case "shadow_reveal":
      return new THREE.MeshBasicMaterial({ color: 0x070b0f, transparent: true, opacity: 0.5 });
    case "mechanical_screen":
      return new THREE.MeshStandardMaterial({ color: 0x29323a, roughness: 0.62, metalness: 0.36, map: materialAtlasTile(10) });
    case "dark_roof":
      return new THREE.MeshStandardMaterial({ color: 0x242a2f, roughness: 0.88, metalness: 0.06, map: materialAtlasTile(12) });
    case "warm_roof":
      return new THREE.MeshStandardMaterial({ color: 0x6b4c36, roughness: 0.88, metalness: 0.02, map: materialAtlasTile(13) });
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
