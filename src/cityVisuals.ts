import * as THREE from "three";
import type { MaterialId } from "./materialCatalog";
import type { ScoreRole } from "./physics";
import { materialAtlasTile } from "./visualAssets";

export type BuildingVisualStyle = "industrial" | "glassTower" | "civic" | "shelter" | "apartment" | "warehouse" | "market";

interface BuildingCellVisualOptions {
  size: THREE.Vector3;
  materialId: MaterialId;
  scoreRole: ScoreRole;
  style: BuildingVisualStyle;
  floor: number;
  column: number;
  floors: number;
  columns: number;
}

interface FragmentVisualOptions {
  size: THREE.Vector3;
  materialId: MaterialId;
}

interface VehicleVisualOptions {
  size: THREE.Vector3;
  accent: THREE.ColorRepresentation;
}

const sharedMaterials = new Map<string, THREE.Material>();
const childBoxGeometryCache = new Map<string, THREE.BoxGeometry>();
const childCylinderGeometryCache = new Map<string, THREE.CylinderGeometry>();
const childSphereGeometryCache = new Map<string, THREE.SphereGeometry>();

export function decorateBuildingCell(mesh: THREE.Mesh, options: BuildingCellVisualOptions): void {
  const palette = paletteFor(options.style, options.scoreRole);
  if (options.scoreRole === "neutral") {
    if (options.floor === options.floors - 1) {
      addChildBox(mesh, options.size.x * 1.04, 0.04, options.size.z * 1.04, palette.roof, { y: options.size.y * 0.5 + 0.03 });
    }
    return;
  }
  addFacadeSkin(mesh, options.size, palette.facade, 0.016);
  addWindowRows(mesh, options);
  addVerticalTrim(mesh, options.size, palette.trim, options.column === 0, options.column === options.columns - 1);

  if (options.floor === 0) {
    addStorefront(mesh, options.size, palette.sign, options.style, options.column);
  }
  if (options.floor === options.floors - 1) {
    addRoofDetail(mesh, options.size, palette.roof);
  }
}

export function decorateFragment(mesh: THREE.Mesh, options: FragmentVisualOptions): void {
  if (options.materialId === "glass") {
    addChildBox(mesh, options.size.x * 0.88, Math.max(0.012, options.size.y * 0.24), options.size.z * 1.08, "glass_shard", {
      y: options.size.y * 0.18,
      z: options.size.z * 0.08
    });
    return;
  }

  if (options.materialId === "metal") {
    addChildBox(mesh, options.size.x * 0.38, options.size.y * 0.38, options.size.z * 1.22, "scraped_metal", {
      x: options.size.x * 0.12,
      y: options.size.y * 0.08,
      rotationZ: Math.PI * 0.08
    });
    return;
  }

  if (options.materialId === "concrete") {
    addChildBox(mesh, options.size.x * 0.44, options.size.y * 0.18, Math.max(0.05, options.size.z * 0.28), "rubble_dark", {
      x: -options.size.x * 0.12,
      y: options.size.y * 0.28,
      z: options.size.z * 0.46
    });
    addChildBox(mesh, Math.max(0.04, options.size.x * 0.18), options.size.y * 0.34, Math.max(0.04, options.size.z * 0.18), "rubble_light", {
      x: options.size.x * 0.3,
      y: -options.size.y * 0.18,
      z: -options.size.z * 0.38
    });
    return;
  }

  if (options.materialId === "wood") {
    addChildBox(mesh, options.size.x * 0.22, options.size.y * 1.06, options.size.z * 0.92, "wood_end", {
      x: options.size.x * 0.4,
      rotationY: Math.PI * 0.04
    });
    return;
  }

  if (options.materialId === "foam") {
    addChildBox(mesh, options.size.x * 0.7, options.size.y * 0.16, options.size.z * 0.7, "painted_plastic", {
      y: options.size.y * 0.42
    });
  }
}

export function decorateCityVehicle(mesh: THREE.Mesh, options: VehicleVisualOptions): void {
  const glass = material("vehicle_glass");
  const tire = material("tire");
  const accent = colorMaterial(`vehicle_accent_${String(options.accent)}`, options.accent, 0.35, 0.12);

  addChildBox(mesh, options.size.x * 0.56, options.size.y * 0.32, options.size.z * 1.02, glass, {
    y: options.size.y * 0.2,
    z: options.size.z * 0.02
  });
  addChildBox(mesh, options.size.x * 1.04, options.size.y * 0.16, 0.035, accent, {
    y: -options.size.y * 0.12,
    z: options.size.z * 0.53
  });
  addChildBox(mesh, 0.09, 0.18, 0.18, tire, { x: -options.size.x * 0.42, y: -options.size.y * 0.42, z: options.size.z * 0.43 });
  addChildBox(mesh, 0.09, 0.18, 0.18, tire, { x: options.size.x * 0.42, y: -options.size.y * 0.42, z: options.size.z * 0.43 });
  addChildBox(mesh, 0.09, 0.18, 0.18, tire, { x: -options.size.x * 0.42, y: -options.size.y * 0.42, z: -options.size.z * 0.43 });
  addChildBox(mesh, 0.09, 0.18, 0.18, tire, { x: options.size.x * 0.42, y: -options.size.y * 0.42, z: -options.size.z * 0.43 });
}

function addFacadeSkin(mesh: THREE.Mesh, size: THREE.Vector3, materialRef: THREE.Material, depth: number): void {
  addChildBox(mesh, size.x * 0.96, size.y * 0.92, depth, materialRef, { z: size.z * 0.5 + depth * 0.5 });
  addChildBox(mesh, size.x * 0.92, size.y * 0.82, depth, materialRef, { z: -size.z * 0.5 - depth * 0.5 });
}

function addWindowRows(mesh: THREE.Mesh, options: BuildingCellVisualOptions): void {
  const rows = options.style === "warehouse" || options.style === "shelter" ? 1 : 2;
  const columns = options.style === "glassTower" ? 3 : 2;
  const windowMaterial = material(options.style === "glassTower" || options.scoreRole === "protected" ? "cool_window" : "warm_window");
  const mullionMaterial = material(options.scoreRole === "target" ? "hazard_trim" : "dark_trim");
  const width = (options.size.x * 0.64) / columns;
  const height = (options.size.y * 0.5) / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = (column - (columns - 1) * 0.5) * width * 1.18;
      const y = (row - (rows - 1) * 0.5) * height * 1.22 + options.size.y * 0.08;
      addChildBox(mesh, width * 0.72, height * 0.62, 0.018, windowMaterial, { x, y, z: options.size.z * 0.5 + 0.026 });
    }
  }

  if (options.style === "industrial" || options.style === "warehouse") {
    addChildBox(mesh, options.size.x * 0.78, 0.035, 0.022, mullionMaterial, { y: -options.size.y * 0.08, z: options.size.z * 0.5 + 0.034 });
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
  } else if (style === "market" || style === "apartment") {
    addChildBox(mesh, size.x * 0.78, 0.08, 0.035, signMaterial, { y: -size.y * 0.26, z: size.z * 0.5 + 0.046 });
    addChildBox(mesh, size.x * 0.58, 0.17, 0.022, material("shop_glass"), { y: -size.y * 0.06, z: size.z * 0.5 + 0.038 });
  } else if (style === "civic" || style === "shelter") {
    addChildBox(mesh, size.x * 0.64, 0.07, 0.026, signMaterial, { y: -size.y * 0.26, z: size.z * 0.5 + 0.04 });
  }
}

function addRoofDetail(mesh: THREE.Mesh, size: THREE.Vector3, roofMaterial: THREE.Material): void {
  addChildBox(mesh, size.x * 1.08, 0.045, size.z * 1.08, roofMaterial, { y: size.y * 0.5 + 0.034 });
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
  const mesh = new THREE.Mesh(sharedChildBoxGeometry(width, height, depth), typeof materialRef === "string" ? material(materialRef) : materialRef);
  mesh.position.set(transform.x ?? 0, transform.y ?? 0, transform.z ?? 0);
  mesh.rotation.set(transform.rotationX ?? 0, transform.rotationY ?? 0, transform.rotationZ ?? 0);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
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
  const mesh = new THREE.Mesh(
    sharedChildCylinderGeometry(radiusTop, radiusBottom, height),
    typeof materialRef === "string" ? material(materialRef) : materialRef
  );
  mesh.position.set(transform.x ?? 0, transform.y ?? 0, transform.z ?? 0);
  mesh.rotation.set(transform.rotationX ?? 0, transform.rotationY ?? 0, transform.rotationZ ?? 0);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
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
  const mesh = new THREE.Mesh(sharedChildSphereGeometry(radius), typeof materialRef === "string" ? material(materialRef) : materialRef);
  mesh.position.set(transform.x ?? 0, transform.y ?? 0, transform.z ?? 0);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
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
  if (scoreRole === "protected") {
    return {
      facade: material("protected_facade"),
      trim: material("protected_trim"),
      roof: material("clinic_roof"),
      sign: material("protected_sign")
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
      return new THREE.MeshBasicMaterial({ color: 0x93f6ff, transparent: true, opacity: 0.78 });
    case "warm_window":
      return new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.78 });
    case "shop_glass":
      return new THREE.MeshBasicMaterial({ color: 0xc6fcff, transparent: true, opacity: 0.55 });
    case "hazard_facade":
      return new THREE.MeshStandardMaterial({ color: 0x7b3023, roughness: 0.72, metalness: 0.04, map: materialAtlasTile(4) });
    case "hazard_trim":
      return new THREE.MeshStandardMaterial({ color: 0xff7a35, roughness: 0.44, metalness: 0.08, emissive: 0x4a1508, emissiveIntensity: 0.45 });
    case "hazard_sign":
      return new THREE.MeshBasicMaterial({ color: 0xffa23f });
    case "protected_facade":
      return new THREE.MeshStandardMaterial({ color: 0x2d6074, roughness: 0.66, metalness: 0.04, map: materialAtlasTile(5) });
    case "protected_trim":
      return new THREE.MeshStandardMaterial({ color: 0x9ae8ff, roughness: 0.38, metalness: 0.08, emissive: 0x104a5e, emissiveIntensity: 0.4 });
    case "protected_sign":
      return new THREE.MeshBasicMaterial({ color: 0xb8f4ff });
    case "clinic_roof":
      return new THREE.MeshStandardMaterial({ color: 0x36515e, roughness: 0.76, metalness: 0.03, map: materialAtlasTile(12) });
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
        map: materialAtlasTile(8)
      });
    case "cool_trim":
      return new THREE.MeshStandardMaterial({ color: 0x7ec7d2, roughness: 0.46, metalness: 0.22 });
    case "cool_sign":
      return new THREE.MeshBasicMaterial({ color: 0x74dfff });
    case "neutral_facade":
      return new THREE.MeshStandardMaterial({ color: 0x62686d, roughness: 0.82, metalness: 0.02, map: materialAtlasTile(3) });
    case "dark_trim":
      return new THREE.MeshStandardMaterial({ color: 0x262f36, roughness: 0.58, metalness: 0.16, map: materialAtlasTile(1) });
    case "dark_roof":
      return new THREE.MeshStandardMaterial({ color: 0x20272d, roughness: 0.84, metalness: 0.05, map: materialAtlasTile(12) });
    case "warm_roof":
      return new THREE.MeshStandardMaterial({ color: 0x7f5a3e, roughness: 0.8, metalness: 0.02, map: materialAtlasTile(13) });
    case "glass_shard":
      return new THREE.MeshPhysicalMaterial({ color: 0xc7fbff, transparent: true, opacity: 0.58, roughness: 0.12, metalness: 0, depthWrite: false });
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
    case "tire":
      return new THREE.MeshStandardMaterial({ color: 0x161719, roughness: 0.9, metalness: 0, map: materialAtlasTile(6) });
    case "relay_gel_core":
      return new THREE.MeshPhysicalMaterial({ color: 0xd92b72, transparent: true, opacity: 0.58, roughness: 0.28, metalness: 0.02, depthWrite: false });
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
      return new THREE.MeshPhysicalMaterial({ color: 0x8ff7ff, transparent: true, opacity: 0.5, roughness: 0.16, metalness: 0, depthWrite: false });
    case "relay_shock_cap":
      return new THREE.MeshStandardMaterial({ color: 0x33404c, roughness: 0.42, metalness: 0.62, map: materialAtlasTile(0) });
    case "relay_shock_core":
      return new THREE.MeshBasicMaterial({ color: 0xc7fbff, transparent: true, opacity: 0.9 });
    default:
      return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
  }
}

function sharedChildBoxGeometry(width: number, height: number, depth: number): THREE.BoxGeometry {
  const key = `${width.toFixed(3)}:${height.toFixed(3)}:${depth.toFixed(3)}`;
  const existing = childBoxGeometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.userData.sharedGeometry = true;
  childBoxGeometryCache.set(key, geometry);
  return geometry;
}

function sharedChildCylinderGeometry(radiusTop: number, radiusBottom: number, height: number): THREE.CylinderGeometry {
  const key = `${radiusTop.toFixed(3)}:${radiusBottom.toFixed(3)}:${height.toFixed(3)}`;
  const existing = childCylinderGeometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 24);
  geometry.userData.sharedGeometry = true;
  childCylinderGeometryCache.set(key, geometry);
  return geometry;
}

function sharedChildSphereGeometry(radius: number): THREE.SphereGeometry {
  const key = radius.toFixed(3);
  const existing = childSphereGeometryCache.get(key);
  if (existing) {
    return existing;
  }
  const geometry = new THREE.SphereGeometry(radius, 24, 14);
  geometry.userData.sharedGeometry = true;
  childSphereGeometryCache.set(key, geometry);
  return geometry;
}
