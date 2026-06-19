import * as THREE from "three";
import type WebGPURenderer from "three/src/renderers/webgpu/WebGPURenderer.js";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  loadArcadeProgress,
  recordArcadeRun,
  saveArcadeProgress,
  type ArcadeLevelDefinition,
  type ArcadeResult
} from "./arcade";
import { DestructionAudio } from "./audio";
import { CameraRig } from "./cameraRig";
import { Cannon } from "./cannon";
import { decorateFragment } from "./cityVisuals";
import { DestructionSystem, type ExplosionAffectedObject, type ExplosionResult } from "./destruction";
import { InputController } from "./input";
import { TEST_CHAMBERS, type TestChamber } from "./levels";
import { MaterialCatalog, type MaterialId } from "./materialCatalog";
import { perfMonitor, type PerfFrameSnapshot, type PerfReport } from "./perf";
import { PhysicsWorld, type PhysicsObject } from "./physics";
import { PROJECTILES, ProjectileSystem, type ActiveProjectile, type ProjectileId } from "./projectile";
import { SeededRandom, createRunSeed, randomRange } from "./random";
import { ShotRunState } from "./runState";
import { ScorePopupLayer } from "./scorePopups";
import { ShotScoreTracker, type ScoreBreakdown, type ScoreEvent } from "./scoring";
import {
  DEFAULT_GAME_SETTINGS,
  effectiveGraphicsPixelRatio,
  GRAPHICS_QUALITY_LABELS,
  RENDERER_BACKEND_LABELS,
  type GameSettings,
  type GraphicsQuality,
  type RendererBackendPreference,
  graphicsPixelRatioCap,
  loadGameSettings,
  saveGameSettings,
  sanitizeGameSettings
} from "./settings";
import { ExplosionSystem, ParticleSystem } from "./vfx";
import { GameUI } from "./ui";
import { graphicTexture } from "./visualAssets";

const DEFAULT_AIM_POINT = new THREE.Vector3(0, 0.16, -3.4);
const CHAIN_DEBRIS_MIN_SPEED = 1.85;
const CHAIN_IMPACT_COOLDOWN_MS = 220;
const CHAIN_IMPACT_MAX_PER_FRAME = 14;
const CHAIN_IMPACT_VFX_MAX_PER_FRAME = 4;
const CHAIN_COLLISION_DRAIN_MAX_PER_FRAME = 192;
const MAX_FRAME_DELTA_SECONDS = 0.05;
const MAX_SIMULATION_DELTA_SECONDS = 1 / 30;
const SURFACE_IMPACT_MAX_PER_FRAME = 6;
const SURFACE_IMPACT_VFX_MAX_PER_FRAME = 2;
const SURFACE_COLLISION_MAX_PER_FRAME = 160;
const FRACTURE_PROCESS_MAX_PER_FRAME = 1;
const FRACTURE_PROCESS_TIME_BUDGET_MS = 2;
const CHAIN_IMPACT_SWEEP_MS = 160;
const SCORE_SETTLED_SPEED = 1.55;
const AIM_FALLBACK_SURFACE_Y = 0.055;
const AIM_MARKER_SURFACE_OFFSET = 0.095;
const FIRE_MIN_DELAY_MS = 760;
const FIRE_MAX_DELAY_MS = 1850;
const MAX_BURNING_HAZARDS = 18;
const HAZARD_EXPLOSIONS_MAX_PER_FRAME = 1;
const SCATTER_PHYSICAL_SHARD_COUNT = 6;
const VOLATILE_TRIGGER_LIMIT_BY_DEPTH = [3, 1, 0] as const;
const CAMERA_FOCUS_MIN_SCORE = 155;
const CAMERA_FOCUS_LOCK_MS = 1100;
const CAMERA_FOCUS_DECAY_MS = 3400;
const HEAVY_PROJECTILE_CAMERA_RELEASE_SPEED = 11.5;
const HEAVY_PROJECTILE_CAMERA_RELEASE_AGE = 3.2;
const CANNON_DECK_OFFSETS = [
  new THREE.Vector3(0, -3.23, 1.9),
  new THREE.Vector3(-3.3, -0.22, 1.9),
  new THREE.Vector3(3.3, -0.22, 1.9)
];
const MAX_PROJECTILE_PENETRATIONS: Record<ProjectileId, number> = {
  slug: 0,
  scatter: 0,
  pulse: 0,
  gravity: 8,
  ignite: 1
};
const IMPACT_BOUNDS = {
  minX: -18.8,
  maxX: 18.8,
  minZ: -21.8,
  maxZ: 35.8
};
const AIM_SURFACE_NORMAL = new THREE.Vector3(0, 1, 0);
const RENDER_WARMUP_FRAGMENT_MATERIALS: readonly MaterialId[] = ["glass", "concrete", "metal", "rubber", "foam", "wood"];
const RENDER_WARMUP_RUNTIME_FRAGMENT_BATCHES = 8;
const RENDER_WARMUP_BRUTAL_PASSES = 4;
const RENDER_WARMUP_FRAMES_PER_BRUTAL_PASS = 10;
const RENDER_WARMUP_DELTA_SECONDS = 1 / 30;
const RENDER_WARMUP_MIN_FRAMES = 64;
const RENDER_WARMUP_STABLE_FRAMES = 24;
const RENDER_WARMUP_MAX_FRAMES = 180;
const RENDER_WARMUP_SYNTHETIC_OBJECTS_PER_MATERIAL = 8;
const RENDER_WARMUP_SYNTHETIC_DESTRUCTION_PASSES = 3;
const RENDER_WARMUP_POST_CLEANUP_EFFECT_PASSES = 2;
const RENDER_WARMUP_POST_CLEANUP_EFFECT_FRAMES = 8;
const RENDER_WARMUP_POST_CLEANUP_STABLE_FRAMES = 72;
const RENDER_WARMUP_POST_CLEANUP_MAX_FRAMES = 260;
const RESET_WARMUP_BRUTAL_PASSES = 2;
const RESET_WARMUP_FRAMES_PER_BRUTAL_PASS = 5;
const RESET_WARMUP_SYNTHETIC_DESTRUCTION_PASSES = 2;
const RESET_WARMUP_SYNTHETIC_DESTRUCTION_FRAMES = 5;
const RESET_WARMUP_FRACTURE_PROCESS_MAX_PER_FRAME = 16;
const RESET_WARMUP_FRACTURE_PROCESS_TIME_BUDGET_MS = 4;
const RESET_WARMUP_POST_CLEANUP_EFFECT_PASSES = 1;
const RESET_WARMUP_POST_CLEANUP_EFFECT_FRAMES = 5;
const RESET_WARMUP_SETTLE_FRAMES = 24;
const SMOKE_RESET_WARMUP_SETTLE_FRAMES = 4;
const RENDER_WARMUP_SYNTHETIC_ORIGIN = new THREE.Vector3(72, 1.2, 72);
const RENDER_WARMUP_SYNTHETIC_DESTRUCTION_ZONE = "render-warmup-destruction";
const AIM_TRAFFIC_STEP_SECONDS = 1 / 24;
const AIM_TRAFFIC_MAX_ACCUMULATED_SECONDS = 0.12;
const NIGHT_SKY_RADIUS = 118;
const MOON_DIRECTION = new THREE.Vector3(-0.2, 0.24, -0.95).normalize();
const ARCADE_LEVELS = TEST_CHAMBERS.map(chamberToArcadeLevel);

interface BurningHazard {
  id: number;
  label: string;
  origin: THREE.Vector3;
  explodeAt: number;
  nextFxAt: number;
  strength: number;
  radius: number;
  materialId: PhysicsObject["materialId"];
}

interface VolatileHazardProfile {
  strength: number;
  radius: number;
  projectileId: ProjectileId;
  color: THREE.ColorRepresentation;
  powerScale: number;
  sizeScale: number;
}

interface DowntownMayhemRenderStats {
  frame: number;
  levelName: string;
  rendererPreference: RendererBackendPreference;
  rendererBackend: "webgpu" | "webgl2" | "webgl";
  bodyCount: number;
  dynamicBodyCount: number;
  awakeBodyCount: number;
  debrisBodyCount: number;
  awakeDebrisBodyCount: number;
  fixedStructureCount: number;
  activeDebrisCount: number;
  frozenDebrisCount: number;
  pendingSupportReleaseCount: number;
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
  programs: number;
  visibleMeshes: number;
  visibleMaterials: number;
  visiblePooledVfxObjects: number;
  fragmentInstanceBuckets: number;
  fragmentInstanceVisibleBuckets: number;
  fragmentInstanceWarmupBuckets: number;
  fragmentInstanceOverflowBuckets: number;
}

interface DowntownMayhemDebugApi {
  getRenderStats(): DowntownMayhemRenderStats;
  getPerfReport(): PerfReport;
  getRenderWarmupState(): RenderWarmupState;
  setPerfEnabled(enabled: boolean): void;
  clearPerfReport(): void;
  flushPerfLog(reason?: string): void;
  freezeForCapture(): DowntownMayhemRenderStats;
  resume(): void;
}

interface RenderWarmupState {
  phase: "idle" | "warming" | "ready" | "failed";
  token: number;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  programs: number;
  geometries: number;
  frames: number;
  bodyCountAfterCleanup?: number;
  error?: string;
}

interface SyntheticDestructionWarmupOptions {
  passes?: number;
  framesPerPass?: number;
  fractureProcessMaxPerFrame?: number;
  fractureProcessTimeBudgetMs?: number;
  statusPrefix?: string;
}

interface DowntownMayhemRendererBundle {
  renderer: DowntownMayhemRenderer;
  preference: RendererBackendPreference;
  backend: "webgpu" | "webgl2" | "webgl";
}

type DowntownMayhemRenderer = THREE.WebGLRenderer | WebGPURenderer;

interface DowntownMayhemRendererBackend {
  isWebGPUBackend?: boolean;
  isWebGLBackend?: boolean;
}

interface DowntownMayhemGpuNavigator {
  gpu?: {
    requestAdapter(options?: { powerPreference?: "low-power" | "high-performance" }): Promise<unknown>;
  };
}

declare global {
  interface Window {
    __DOWNTOWN_MAYHEM_DEBUG__?: DowntownMayhemDebugApi;
  }
}

async function createDowntownMayhemRenderer(settings: GameSettings): Promise<DowntownMayhemRendererBundle> {
  if (settings.rendererBackend !== "webgl" && (await canAttemptWebGpu())) {
    try {
      const { WebGPURenderer: WebGpuRenderer } = await import("three/webgpu");
      const renderer = new WebGpuRenderer({
        alpha: false,
        antialias: settings.antialias,
        powerPreference: "high-performance"
      });
      configureDowntownMayhemRenderer(renderer, settings);
      await renderer.init();
      return {
        renderer,
        preference: settings.rendererBackend,
        backend: activeWebGpuRendererBackend(renderer)
      };
    } catch (error) {
      console.warn("Downtown Mayhem: WebGPU renderer failed, falling back to WebGL.", error);
    }
  }

  const renderer = new THREE.WebGLRenderer({
    alpha: false,
    antialias: settings.antialias,
    powerPreference: "high-performance"
  });
  configureDowntownMayhemRenderer(renderer, settings);
  return {
    renderer,
    preference: settings.rendererBackend,
    backend: activeWebGlRendererBackend(renderer)
  };
}

async function canAttemptWebGpu(): Promise<boolean> {
  if (typeof navigator === "undefined") {
    return false;
  }
  const gpu = (navigator as Navigator & DowntownMayhemGpuNavigator).gpu;
  if (!gpu) {
    return false;
  }
  try {
    return Boolean(await gpu.requestAdapter({ powerPreference: "high-performance" }));
  } catch {
    return false;
  }
}

function configureDowntownMayhemRenderer(renderer: DowntownMayhemRenderer, settings: GameSettings): void {
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  setOptionalShadowMapFlag(renderer, "autoUpdate", false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(effectiveGraphicsPixelRatio(graphicsPixelRatioCap(settings.graphicsQuality)));
}

function activeWebGpuRendererBackend(renderer: WebGPURenderer): "webgpu" | "webgl2" {
  const backend = renderer.backend as DowntownMayhemRendererBackend;
  return backend.isWebGPUBackend ? "webgpu" : "webgl2";
}

function activeWebGlRendererBackend(renderer: THREE.WebGLRenderer): "webgl2" | "webgl" {
  return renderer.capabilities.isWebGL2 ? "webgl2" : "webgl";
}

function rendererDrawCalls(renderer: DowntownMayhemRenderer): number {
  const renderInfo = renderer.info.render as typeof renderer.info.render & { calls?: number; drawCalls?: number };
  return renderInfo.drawCalls ?? renderInfo.calls ?? 0;
}

function rendererProgramCount(renderer: DowntownMayhemRenderer): number {
  const memoryInfo = renderer.info.memory as typeof renderer.info.memory & { programs?: number };
  const rendererInfo = renderer.info as typeof renderer.info & { programs?: unknown[] };
  return memoryInfo.programs ?? rendererInfo.programs?.length ?? 0;
}

function setOptionalShadowMapFlag(renderer: DowntownMayhemRenderer, key: "autoUpdate" | "needsUpdate", value: boolean): void {
  (renderer.shadowMap as typeof renderer.shadowMap & Partial<Record<typeof key, boolean>>)[key] = value;
}

function createInitialRenderWarmupState(): RenderWarmupState {
  return {
    phase: "idle",
    token: 0,
    startedAt: 0,
    finishedAt: null,
    durationMs: null,
    programs: 0,
    geometries: 0,
    frames: 0
  };
}

function isSmokeWarmupMode(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").has("smoke");
  } catch {
    return false;
  }
}

function renderWarmupFragmentSize(materialId: MaterialId): THREE.Vector3 {
  switch (materialId) {
    case "glass":
      return new THREE.Vector3(0.42, 0.04, 0.88);
    case "metal":
      return new THREE.Vector3(0.22, 0.24, 1.05);
    case "concrete":
      return new THREE.Vector3(0.62, 0.46, 0.58);
    case "wood":
      return new THREE.Vector3(0.24, 0.7, 0.48);
    case "foam":
      return new THREE.Vector3(0.5, 0.34, 0.46);
    case "rubber":
      return new THREE.Vector3(0.36, 0.32, 0.42);
  }
}

function renderWarmupRuntimeFragmentSize(materialId: MaterialId, batch: number): THREE.Vector3 {
  const size = renderWarmupFragmentSize(materialId);
  const scaleSets = [
    new THREE.Vector3(1, 1, 1),
    new THREE.Vector3(1.55, 0.75, 1.2),
    new THREE.Vector3(0.72, 1.35, 0.85),
    new THREE.Vector3(1.2, 0.58, 1.65)
  ] as const;
  const scale = scaleSets[batch % scaleSets.length];
  return size.multiply(scale);
}

function disableFrustumCulling(root: THREE.Object3D): void {
  root.traverse((object) => {
    const maybeRenderable = object as THREE.Object3D & { frustumCulled?: boolean };
    maybeRenderable.frustumCulled = false;
  });
}

function disableSceneFrustumCullingForWarmup(root: THREE.Object3D): () => void {
  const states: Array<{ object: THREE.Object3D & { frustumCulled: boolean }; frustumCulled: boolean }> = [];
  root.traverse((object) => {
    const maybeRenderable = object as THREE.Object3D & { frustumCulled?: boolean };
    if (maybeRenderable.frustumCulled === undefined) {
      return;
    }
    states.push({
      object: maybeRenderable as THREE.Object3D & { frustumCulled: boolean },
      frustumCulled: maybeRenderable.frustumCulled
    });
    maybeRenderable.frustumCulled = false;
  });
  return () => {
    for (const state of states) {
      state.object.frustumCulled = state.frustumCulled;
    }
  };
}

function addInstancedWarmupVariants(group: THREE.Group, root: THREE.Object3D, label: string): void {
  const meshes: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh || Array.isArray(object.material)) {
      return;
    }
    meshes.push(object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>);
  });
  for (const mesh of meshes) {
    const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, 1);
    instanced.name = `${label} instanced warmup`;
    instanced.frustumCulled = false;
    instanced.renderOrder = mesh.renderOrder;
    instanced.castShadow = mesh.castShadow;
    instanced.receiveShadow = mesh.receiveShadow;
    instanced.setMatrixAt(0, mesh.matrixWorld);
    instanced.instanceMatrix.needsUpdate = true;
    group.add(instanced);
  }
}

function renderWarmupYield(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function createRenderWarmupCameras(sourceCamera: THREE.PerspectiveCamera): THREE.PerspectiveCamera[] {
  const cameras: THREE.PerspectiveCamera[] = [sourceCamera];
  const addCamera = (position: THREE.Vector3, target: THREE.Vector3, fov = 58): void => {
    const camera = new THREE.PerspectiveCamera(fov, sourceCamera.aspect, 0.05, 120);
    camera.position.copy(position);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    cameras.push(camera);
  };
  addCamera(new THREE.Vector3(0, 1.7, 7), new THREE.Vector3(0, 0.15, 0), 55);
  addCamera(new THREE.Vector3(-8.8, 9.4, 13.2), new THREE.Vector3(1.4, 6.4, 0.85), 68);
  addCamera(new THREE.Vector3(8.6, 13.2, 10.4), new THREE.Vector3(3.2, 9.9, 0.85), 62);
  return cameras;
}

function createNightSkyDome(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Moonlit night sky";

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(NIGHT_SKY_RADIUS, 32, 16),
    new THREE.MeshBasicMaterial({
      map: createNightSkyTexture(),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    })
  );
  sky.name = "Deep blue night sky gradient";
  sky.renderOrder = -100;
  group.add(sky);

  const stars = createStarField();
  group.add(stars);

  const moonPosition = MOON_DIRECTION.clone().multiplyScalar(NIGHT_SKY_RADIUS * 0.72);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createMoonHaloTexture(),
      color: 0x9fc8ff,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  halo.name = "Cold moon halo";
  halo.position.copy(moonPosition);
  halo.scale.set(24, 24, 1);
  halo.renderOrder = -40;
  group.add(halo);

  const moon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: createMoonTexture(),
      color: 0xe9f5ff,
      transparent: true,
      opacity: 0.98,
      depthWrite: false
    })
  );
  moon.name = "Textured moon";
  moon.position.copy(moonPosition.clone().multiplyScalar(0.995));
  moon.scale.set(7.2, 7.2, 1);
  moon.renderOrder = -35;
  group.add(moon);

  return group;
}

function createNightSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create night sky texture context");
  }

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#02040d");
  gradient.addColorStop(0.4, "#050d20");
  gradient.addColorStop(0.76, "#09172a");
  gradient.addColorStop(1, "#0d2030");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const cityGlow = context.createRadialGradient(canvas.width * 0.55, canvas.height * 1.08, 24, canvas.width * 0.55, canvas.height * 1.08, canvas.width * 0.58);
  cityGlow.addColorStop(0, "rgba(88, 144, 190, 0.18)");
  cityGlow.addColorStop(0.45, "rgba(30, 66, 108, 0.12)");
  cityGlow.addColorStop(1, "rgba(3, 8, 18, 0)");
  context.fillStyle = cityGlow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createMoonTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create moon texture context");
  }

  const body = context.createRadialGradient(100, 78, 18, 128, 128, 108);
  body.addColorStop(0, "rgba(255, 255, 255, 1)");
  body.addColorStop(0.52, "rgba(220, 236, 245, 0.98)");
  body.addColorStop(0.86, "rgba(147, 177, 197, 0.92)");
  body.addColorStop(1, "rgba(70, 92, 116, 0)");
  context.fillStyle = body;
  context.beginPath();
  context.arc(128, 128, 106, 0, Math.PI * 2);
  context.fill();

  const craters = [
    [86, 112, 13, 0.14],
    [142, 82, 10, 0.11],
    [162, 148, 18, 0.12],
    [110, 166, 9, 0.1],
    [183, 106, 7, 0.12],
    [122, 123, 6, 0.09]
  ] as const;
  for (const [x, y, radius, opacity] of craters) {
    const crater = context.createRadialGradient(x - radius * 0.28, y - radius * 0.35, radius * 0.18, x, y, radius);
    crater.addColorStop(0, `rgba(255, 255, 255, ${opacity * 0.65})`);
    crater.addColorStop(0.58, `rgba(70, 88, 108, ${opacity})`);
    crater.addColorStop(1, "rgba(20, 30, 44, 0)");
    context.fillStyle = crater;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createMoonHaloTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create moon halo texture context");
  }
  const glow = context.createRadialGradient(128, 128, 4, 128, 128, 126);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.72)");
  glow.addColorStop(0.18, "rgba(164, 212, 255, 0.34)");
  glow.addColorStop(0.54, "rgba(80, 136, 220, 0.12)");
  glow.addColorStop(1, "rgba(4, 10, 24, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createStarField(): THREE.Points {
  const count = 96;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < count; index += 1) {
    const u = ((index * 37) % count) / count;
    const v = ((index * 97) % count) / count;
    const theta = u * Math.PI * 2;
    const y = 0.16 + v * 0.72;
    const radius = Math.sqrt(Math.max(0, 1 - y * y)) * NIGHT_SKY_RADIUS * 0.86;
    positions[index * 3] = Math.cos(theta) * radius;
    positions[index * 3 + 1] = y * NIGHT_SKY_RADIUS * 0.86;
    positions[index * 3 + 2] = Math.sin(theta) * radius;
    color.setHSL(0.57 + ((index % 9) - 4) * 0.004, 0.38, 0.72 + (index % 5) * 0.035);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.16,
    vertexColors: true,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
    fog: false
  });
  const stars = new THREE.Points(geometry, material);
  stars.name = "Sparse cold stars";
  stars.frustumCulled = false;
  stars.renderOrder = -70;
  return stars;
}

type AppShellScreen = "menu" | "settings" | "loading";

interface AppShellCallbacks {
  startLevel(levelIndex: number): void;
}

class AppShell {
  private readonly root: HTMLDivElement;
  private readonly levelRail: HTMLDivElement;
  private readonly statusValue: HTMLDivElement;
  private readonly loadingTitle: HTMLElement;
  private readonly loadingStatus: HTMLElement;
  private readonly settingsSummaryValue: HTMLElement;
  private readonly antialiasInput: HTMLInputElement;
  private readonly masterVolumeInput: HTMLInputElement;
  private readonly masterVolumeValue: HTMLElement;
  private readonly cameraShakeInput: HTMLInputElement;
  private readonly cameraShakeValue: HTMLElement;
  private readonly motionEffectsInput: HTMLInputElement;
  private readonly showFpsInput: HTMLInputElement;
  private readonly qualityButtons = new Map<GraphicsQuality, HTMLButtonElement>();
  private readonly rendererBackendButtons = new Map<RendererBackendPreference, HTMLButtonElement>();

  private screen: AppShellScreen = "menu";
  private busy = false;
  private settings = loadGameSettings();
  private progress = loadArcadeProgress(ARCADE_LEVELS);
  private renderedLevelKey = "";
  private renderedSettingsKey = "";

  constructor(private readonly callbacks: AppShellCallbacks) {
    installAppShellStyles();
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) {
      throw new Error("Missing #app");
    }

    this.root = document.createElement("div");
    this.root.className = "app-shell";
    this.root.dataset.screen = this.screen;
    this.root.innerHTML = `
      <section class="app-shell__menu" aria-label="Downtown Mayhem main menu">
        <header class="app-shell__topbar">
          <div class="app-shell__brand">
            <span class="app-shell__brand-mark">DM</span>
            <div>
              <strong>Downtown Mayhem</strong>
              <span>Destructible city arcade</span>
            </div>
          </div>
          <button type="button" data-action="settings">Settings</button>
        </header>

        <main class="app-shell__content">
          <section class="app-shell__intro">
            <span>OBJECT DESTRUCTION RANGE</span>
            <h1>Downtown Mayhem</h1>
            <p>Choose a district, wait through the renderer warmup, then fire the cannon with the frame spikes already paid for.</p>
            <div class="app-shell__status" data-role="shell-status"></div>
          </section>
          <section class="app-shell__levels" data-role="shell-levels" aria-label="Districts"></section>
        </main>
      </section>

      <section class="app-shell__settings" aria-label="Settings">
        <div class="app-shell__settings-panel">
          <div class="app-shell__settings-head">
            <button type="button" data-action="menu">Back</button>
            <button type="button" data-action="settings-defaults">Defaults</button>
          </div>
          <span>RANGE SETTINGS</span>
          <h2>Feel And Performance</h2>
          <em data-role="shell-settings-summary"></em>

          <div class="app-shell__setting-row app-shell__setting-row--stacked">
            <span>Graphics</span>
            <div class="app-shell__segmented" role="group" aria-label="Graphics quality">
              <button type="button" data-quality="performance">Performance</button>
              <button type="button" data-quality="balanced">Balanced</button>
              <button type="button" data-quality="cinematic">Cinematic</button>
            </div>
          </div>

          <div class="app-shell__setting-row app-shell__setting-row--stacked">
            <span>Renderer</span>
            <div class="app-shell__segmented" role="group" aria-label="Renderer backend">
              <button type="button" data-renderer-backend="auto">Auto</button>
              <button type="button" data-renderer-backend="webgpu">WebGPU</button>
              <button type="button" data-renderer-backend="webgl">WebGL</button>
            </div>
          </div>

          <label class="app-shell__setting-row app-shell__setting-row--toggle">
            <span>Anti-aliasing</span>
            <input type="checkbox" data-setting="antialias" />
          </label>

          <label class="app-shell__setting-row">
            <span>Master volume</span>
            <input type="range" data-setting="master-volume" min="0" max="100" step="1" />
            <strong data-role="shell-master-volume"></strong>
          </label>

          <label class="app-shell__setting-row">
            <span>Camera shake</span>
            <input type="range" data-setting="camera-shake" min="0" max="100" step="1" />
            <strong data-role="shell-camera-shake"></strong>
          </label>

          <label class="app-shell__setting-row app-shell__setting-row--toggle">
            <span>Flash + slow-mo</span>
            <input type="checkbox" data-setting="motion-effects" />
          </label>

          <label class="app-shell__setting-row app-shell__setting-row--toggle">
            <span>FPS counter</span>
            <input type="checkbox" data-setting="show-fps" />
          </label>
        </div>
      </section>

      <section class="app-shell__loading" aria-live="polite" aria-busy="true">
        <div class="app-shell__loading-panel">
          <span>LOADING DISTRICT</span>
          <strong data-role="shell-loading-title"></strong>
          <em data-role="shell-loading-status"></em>
          <div class="app-shell__loading-bar" aria-hidden="true"><span></span></div>
        </div>
      </section>
    `;
    app.appendChild(this.root);

    this.levelRail = this.requireElement("[data-role='shell-levels']");
    this.statusValue = this.requireElement("[data-role='shell-status']");
    this.loadingTitle = this.requireElement("[data-role='shell-loading-title']");
    this.loadingStatus = this.requireElement("[data-role='shell-loading-status']");
    this.settingsSummaryValue = this.requireElement("[data-role='shell-settings-summary']");
    this.antialiasInput = this.requireElement("[data-setting='antialias']");
    this.masterVolumeInput = this.requireElement("[data-setting='master-volume']");
    this.masterVolumeValue = this.requireElement("[data-role='shell-master-volume']");
    this.cameraShakeInput = this.requireElement("[data-setting='camera-shake']");
    this.cameraShakeValue = this.requireElement("[data-role='shell-camera-shake']");
    this.motionEffectsInput = this.requireElement("[data-setting='motion-effects']");
    this.showFpsInput = this.requireElement("[data-setting='show-fps']");

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-quality]")) {
      const quality = button.dataset.quality;
      if (quality === "performance" || quality === "balanced" || quality === "cinematic") {
        this.qualityButtons.set(quality, button);
      }
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-renderer-backend]")) {
      const rendererBackend = button.dataset.rendererBackend;
      if (rendererBackend === "auto" || rendererBackend === "webgpu" || rendererBackend === "webgl") {
        this.rendererBackendButtons.set(rendererBackend, button);
      }
    }

    this.root.addEventListener("click", this.handleClick);
    this.root.addEventListener("input", this.handleInput);
    this.root.addEventListener("change", this.handleInput);
    this.render();
  }

  showMenu(message = ""): void {
    this.busy = false;
    this.screen = "menu";
    this.root.hidden = false;
    this.settings = loadGameSettings();
    this.progress = loadArcadeProgress(ARCADE_LEVELS);
    setText(this.statusValue, message);
    this.render();
  }

  showLoading(levelName: string, status: string): void {
    this.busy = true;
    this.screen = "loading";
    this.root.hidden = false;
    this.root.dataset.screen = this.screen;
    setText(this.loadingTitle, levelName);
    setText(this.loadingStatus, status);
  }

  updateLoadingStatus(status: string): void {
    if (this.screen === "loading") {
      setText(this.loadingStatus, status);
    }
  }

  hide(): void {
    this.root.hidden = true;
  }

  dispose(): void {
    this.root.removeEventListener("click", this.handleClick);
    this.root.removeEventListener("input", this.handleInput);
    this.root.removeEventListener("change", this.handleInput);
    this.root.remove();
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button") : null;
    if (!target || !this.root.contains(target)) {
      return;
    }

    const action = target.dataset.action;
    if (this.busy && action !== undefined) {
      return;
    }
    if (action === "start-arcade") {
      const levelIndex = Number(target.dataset.levelIndex ?? 0);
      if (Number.isFinite(levelIndex)) {
        this.callbacks.startLevel(levelIndex);
      }
      return;
    }
    if (action === "settings") {
      this.screen = "settings";
      this.render();
      return;
    }
    if (action === "menu") {
      this.showMenu();
      return;
    }
    if (action === "settings-defaults") {
      this.updateSettings({ ...DEFAULT_GAME_SETTINGS });
      return;
    }

    const quality = target.dataset.quality;
    if (quality === "performance" || quality === "balanced" || quality === "cinematic") {
      this.updateSettings({ graphicsQuality: quality });
      return;
    }
    const rendererBackend = target.dataset.rendererBackend;
    if (rendererBackend === "auto" || rendererBackend === "webgpu" || rendererBackend === "webgl") {
      this.updateSettings({ rendererBackend });
    }
  };

  private readonly handleInput = (event: Event): void => {
    if (!(event.target instanceof HTMLInputElement) || this.busy) {
      return;
    }
    const setting = event.target.dataset.setting;
    if (setting === "antialias") {
      this.updateSettings({ antialias: event.target.checked });
      return;
    }
    if (setting === "master-volume") {
      this.updateSettings({ masterVolume: Number(event.target.value) / 100 });
      return;
    }
    if (setting === "camera-shake") {
      this.updateSettings({ cameraShake: Number(event.target.value) / 100 });
      return;
    }
    if (setting === "motion-effects") {
      this.updateSettings({ motionEffects: event.target.checked });
      return;
    }
    if (setting === "show-fps") {
      this.updateSettings({ showFps: event.target.checked });
    }
  };

  private updateSettings(patch: Partial<GameSettings>): void {
    this.settings = sanitizeGameSettings({ ...this.settings, ...patch });
    saveGameSettings(this.settings);
    this.renderedSettingsKey = "";
    this.render();
  }

  private render(): void {
    this.root.dataset.screen = this.screen;
    this.renderLevels();
    this.renderSettings();
  }

  private renderLevels(): void {
    const key = [
      this.progress.highestUnlockedLevel,
      this.progress.totalStars,
      ...TEST_CHAMBERS.flatMap((level, index) => {
        const progress = this.progress.levels[level.id];
        return [index, level.name, level.objective, progress?.stars ?? 0, progress?.bestScore ?? 0, progress?.attempts ?? 0];
      })
    ].join("|");
    if (this.renderedLevelKey === key) {
      return;
    }
    this.renderedLevelKey = key;
    this.levelRail.innerHTML = TEST_CHAMBERS.map((level, index) => {
      const progress = this.progress.levels[level.id];
      const locked = index > this.progress.highestUnlockedLevel;
      const stars = progress?.stars ?? 0;
      const bestScore = progress?.bestScore ?? 0;
      const progressText = locked ? "LOCKED" : `${stars}/3 stars`;
      return `
        <button type="button" class="app-shell__level-card${locked ? " is-locked" : ""}" data-action="start-arcade" data-level-index="${index}" ${locked ? "disabled" : ""}>
          <span>${String(index + 1).padStart(2, "0")} / ${progressText}</span>
          <strong>${escapeShellHtml(level.name)}</strong>
          <em>${escapeShellHtml(level.objective)}</em>
          <small>${locked ? "Earn 2 stars on the previous district" : `Best ${formatShellScore(bestScore)}`}</small>
        </button>
      `;
    }).join("");
  }

  private renderSettings(): void {
    const key = settingsRenderKey(this.settings);
    if (this.renderedSettingsKey === key) {
      return;
    }
    this.renderedSettingsKey = key;
    setText(this.settingsSummaryValue, settingsStatus(this.settings));
    for (const [quality, button] of this.qualityButtons) {
      const active = quality === this.settings.graphicsQuality;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const [rendererBackend, button] of this.rendererBackendButtons) {
      const active = rendererBackend === this.settings.rendererBackend;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }

    this.antialiasInput.checked = this.settings.antialias;
    const volume = Math.round(this.settings.masterVolume * 100);
    const shake = Math.round(this.settings.cameraShake * 100);
    setInputValue(this.masterVolumeInput, String(volume));
    setText(this.masterVolumeValue, `${volume}%`);
    setInputValue(this.cameraShakeInput, String(shake));
    setText(this.cameraShakeValue, `${shake}%`);
    this.motionEffectsInput.checked = this.settings.motionEffects;
    this.showFpsInput.checked = this.settings.showFps;
  }

  private requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Missing app shell element ${selector}`);
    }
    return element;
  }
}

function setInputValue(input: HTMLInputElement, value: string): void {
  if (input.value !== value) {
    input.value = value;
  }
}

function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function settingsRenderKey(settings: GameSettings): string {
  return [
    settings.graphicsQuality,
    settings.rendererBackend,
    Number(settings.antialias),
    settings.masterVolume.toFixed(3),
    settings.cameraShake.toFixed(3),
    Number(settings.motionEffects),
    Number(settings.showFps)
  ].join("|");
}

function formatShellScore(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function escapeShellHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

let appShellStylesInstalled = false;

function installAppShellStyles(): void {
  if (appShellStylesInstalled) {
    return;
  }
  appShellStylesInstalled = true;
  const style = document.createElement("style");
  style.textContent = `
    :root {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #f4f8fb;
      background: #07090d;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body,
    #app {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      -webkit-user-select: none;
      user-select: none;
    }

    input,
    textarea,
    [contenteditable="true"] {
      -webkit-user-select: text;
      user-select: text;
    }

    button {
      font: inherit;
      -webkit-user-select: none;
      user-select: none;
    }

    .app-shell {
      position: fixed;
      inset: 0;
      z-index: 30;
      color: #f4f8fb;
      background:
        linear-gradient(115deg, rgba(7, 9, 13, 0.98), rgba(10, 16, 20, 0.94) 54%, rgba(19, 17, 15, 0.98)),
        #07090d;
      overflow: auto;
    }

    .app-shell[hidden] {
      display: none !important;
    }

    .app-shell__menu,
    .app-shell__settings,
    .app-shell__loading {
      min-height: 100%;
    }

    .app-shell[data-screen="settings"] .app-shell__menu,
    .app-shell[data-screen="loading"] .app-shell__menu,
    .app-shell[data-screen="menu"] .app-shell__settings,
    .app-shell[data-screen="loading"] .app-shell__settings,
    .app-shell[data-screen="menu"] .app-shell__loading,
    .app-shell[data-screen="settings"] .app-shell__loading {
      display: none;
    }

    .app-shell__topbar {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 72px;
      padding: max(16px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) 14px max(18px, env(safe-area-inset-left));
      border-bottom: 1px solid rgba(184, 234, 255, 0.12);
      background: rgba(6, 9, 12, 0.84);
      backdrop-filter: blur(14px);
    }

    .app-shell__brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .app-shell__brand-mark {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 38px;
      height: 38px;
      border: 1px solid rgba(255, 205, 100, 0.42);
      border-radius: 7px;
      color: #ffd36d;
      background: rgba(255, 166, 41, 0.13);
      font-size: 12px;
      font-weight: 900;
    }

    .app-shell__brand strong,
    .app-shell__intro h1,
    .app-shell__settings-panel h2 {
      display: block;
      margin: 0;
      font-weight: 900;
      line-height: 1;
    }

    .app-shell__brand strong {
      font-size: 16px;
    }

    .app-shell__brand span,
    .app-shell__intro > span,
    .app-shell__level-card span,
    .app-shell__level-card small,
    .app-shell__settings-panel > span,
    .app-shell__settings-panel em,
    .app-shell__setting-row span,
    .app-shell__loading-panel span,
    .app-shell__loading-panel em {
      color: #9db6c4;
      font-size: 12px;
      line-height: 1.25;
    }

    .app-shell__topbar button,
    .app-shell__settings-head button,
    .app-shell__segmented button,
    .app-shell__level-card {
      min-height: 40px;
      border: 1px solid rgba(185, 245, 255, 0.2);
      border-radius: 7px;
      color: #f8fdff;
      background: rgba(255, 255, 255, 0.08);
      font-weight: 900;
      cursor: pointer;
    }

    .app-shell__topbar button,
    .app-shell__settings-head button {
      padding: 0 14px;
    }

    .app-shell__content {
      display: grid;
      grid-template-columns: minmax(260px, 0.84fr) minmax(360px, 1.16fr);
      gap: 22px;
      width: min(1180px, calc(100% - 36px));
      margin: 0 auto;
      padding: 34px 0 42px;
    }

    .app-shell__intro {
      display: grid;
      align-content: start;
      gap: 16px;
      min-width: 0;
      padding-top: 28px;
    }

    .app-shell__intro h1 {
      font-size: 48px;
      color: #ffffff;
    }

    .app-shell__intro p {
      max-width: 520px;
      margin: 0;
      color: #c3d5df;
      font-size: 16px;
      line-height: 1.48;
    }

    .app-shell__status {
      min-height: 20px;
      color: #ffd36d;
      font-size: 13px;
      font-weight: 800;
    }

    .app-shell__levels {
      display: grid;
      gap: 10px;
      min-width: 0;
    }

    .app-shell__level-card {
      display: grid;
      gap: 8px;
      width: 100%;
      min-height: 146px;
      padding: 16px;
      text-align: left;
      background: rgba(11, 17, 23, 0.82);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }

    .app-shell__level-card:hover:not(:disabled),
    .app-shell__level-card:focus-visible {
      border-color: rgba(121, 240, 255, 0.78);
      background: rgba(19, 30, 36, 0.94);
      outline: none;
    }

    .app-shell__level-card:disabled {
      cursor: not-allowed;
      opacity: 0.52;
    }

    .app-shell__level-card strong {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #ffffff;
      font-size: 22px;
      line-height: 1.05;
    }

    .app-shell__level-card em {
      color: #c3d5df;
      font-size: 13px;
      font-style: normal;
      line-height: 1.35;
    }

    .app-shell__level-card small {
      color: #8ddfff;
      font-weight: 800;
    }

    .app-shell__settings {
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .app-shell__settings-panel {
      display: grid;
      gap: 14px;
      width: min(620px, 100%);
      padding: 18px;
      border: 1px solid rgba(183, 232, 255, 0.18);
      border-radius: 8px;
      background: rgba(7, 11, 17, 0.9);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
    }

    .app-shell__settings-panel h2 {
      color: #ffffff;
      font-size: 30px;
    }

    .app-shell__settings-panel em {
      font-style: normal;
      color: #8ddfff;
    }

    .app-shell__settings-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
    }

    .app-shell__setting-row {
      display: grid;
      grid-template-columns: minmax(130px, 0.8fr) minmax(160px, 1fr) 56px;
      align-items: center;
      gap: 10px;
      min-width: 0;
      padding: 10px;
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.045);
    }

    .app-shell__setting-row--stacked {
      grid-template-columns: 1fr;
    }

    .app-shell__setting-row--toggle {
      grid-template-columns: 1fr auto;
    }

    .app-shell__setting-row strong {
      color: #ffffff;
      font-size: 13px;
      text-align: right;
    }

    .app-shell__setting-row input[type="range"] {
      width: 100%;
      min-width: 0;
      accent-color: #79f0ff;
    }

    .app-shell__setting-row input[type="checkbox"] {
      width: 24px;
      height: 24px;
      accent-color: #79f0ff;
    }

    .app-shell__segmented {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }

    .app-shell__segmented button {
      min-width: 0;
      padding: 0 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #bdf8ff;
      background: rgba(157, 248, 255, 0.07);
    }

    .app-shell__segmented button.is-active {
      color: #061015;
      background: #79f0ff;
      border-color: #bdf8ff;
    }

    .app-shell__loading {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: rgba(5, 8, 12, 0.94);
    }

    .app-shell__loading-panel {
      display: grid;
      gap: 14px;
      width: min(520px, 100%);
      padding: 18px;
      border: 1px solid rgba(183, 232, 255, 0.2);
      border-radius: 8px;
      background: rgba(7, 11, 17, 0.96);
      box-shadow: 0 18px 54px rgba(0, 0, 0, 0.52);
    }

    .app-shell__loading-panel strong {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #ffffff;
      font-size: 28px;
      line-height: 1.08;
    }

    .app-shell__loading-panel em {
      min-height: 18px;
      font-style: normal;
      color: #8ddfff;
    }

    .app-shell__loading-bar {
      position: relative;
      height: 6px;
      overflow: hidden;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.1);
    }

    .app-shell__loading-bar span {
      position: absolute;
      inset: 0 auto 0 0;
      width: 42%;
      border-radius: inherit;
      background: #79f0ff;
      animation: app-shell-loading 1050ms ease-in-out infinite alternate;
    }

    @keyframes app-shell-loading {
      from {
        transform: translateX(0);
      }
      to {
        transform: translateX(138%);
      }
    }

    @media (max-width: 760px) {
      .app-shell__topbar {
        min-height: 64px;
        padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 12px max(12px, env(safe-area-inset-left));
      }

      .app-shell__brand span:not(.app-shell__brand-mark) {
        display: none;
      }

      .app-shell__content {
        grid-template-columns: 1fr;
        width: min(100% - 24px, 560px);
        padding: 18px 0 30px;
      }

      .app-shell__intro {
        gap: 10px;
        padding-top: 0;
      }

      .app-shell__intro h1 {
        font-size: 34px;
      }

      .app-shell__intro p {
        font-size: 14px;
      }

      .app-shell__level-card {
        min-height: 124px;
        padding: 13px;
      }

      .app-shell__level-card strong {
        font-size: 19px;
      }

      .app-shell__settings {
        padding: 12px;
      }

      .app-shell__settings-panel {
        padding: 14px;
      }

      .app-shell__settings-panel h2 {
        font-size: 24px;
      }

      .app-shell__setting-row {
        grid-template-columns: 1fr;
      }

      .app-shell__setting-row--toggle {
        grid-template-columns: 1fr auto;
      }
    }
  `;
  document.head.appendChild(style);
}

interface GameOptions {
  initialLevelIndex?: number;
  onMainMenu?: () => void;
  showLoading?: (levelName: string, status: string) => void;
  updateLoadingStatus?: (status: string) => void;
  hideLoading?: () => void;
}

const PERF_DISK_LOG_ENDPOINT = "/__downtown-mayhem/perf-log";
const PERF_DISK_LOG_INTERVAL_MS = 900;

interface PerfFrameSummary {
  frame: number;
  totalMs: number;
  deltaMs: number;
  bodyCount: number;
  dynamicBodyCount: number;
  awakeBodyCount: number;
  debrisBodyCount: number;
  awakeDebrisBodyCount: number;
  activeDebrisCount: number;
  frozenDebrisCount: number;
  pendingSupportReleaseCount: number;
  accountedMs: number;
  unattributedMs: number;
  renderMs: number;
  physicsStepMs: number;
  rapierMs: number;
  impactsMs: number;
  fractureMs: number;
  queuedFractureMs: number;
  addBoxMs: number;
  vfxExplodeMs: number;
  fragments: number;
  dynamicBoxes: number;
  particles: number;
  visualOnlyFragments: number;
  physicalFragments: number;
  boxCacheMiss: number;
  childBoxCacheMiss: number;
  frozenRubbleBuckets: number;
  stagedActivated: number;
  droppedSubsteps: number;
}

interface PerfDiskLogSummary {
  frameCount: number;
  slowFrameCount: number;
  slowRatioPercent: number;
  shotFrameCount: number;
  maxFrame: PerfFrameSummary | null;
  shotMax: {
    totalMs: number;
    renderMs: number;
    physicsStepMs: number;
    rapierMs: number;
    fractureMs: number;
    queuedFractureMs: number;
    addBoxMs: number;
    particlesInFrame: number;
    visualOnlyFragmentsInFrame: number;
    physicalFragmentsInFrame: number;
    fragmentsInFrame: number;
    boxCacheMissesInFrame: number;
    childBoxCacheMissesInFrame: number;
    droppedSubstepsInFrame: number;
  };
  shotTotals: {
    fragments: number;
    dynamicBoxes: number;
    particles: number;
    visualOnlyFragments: number;
    physicalFragments: number;
    boxCacheMisses: number;
    childBoxCacheMisses: number;
    frozenRubbleBuckets: number;
    stagedActivated: number;
    droppedSubsteps: number;
  };
  topShotSlowFrames: PerfFrameSummary[];
  topAllSlowFrames: PerfFrameSummary[];
}

class PerfDiskLogger {
  private readonly sessionId = createPerfDiskSessionId();
  private readonly includeFullReport = shouldIncludeFullPerfDiskReport();
  private readonly handlePageHide = () => this.flush("pagehide");
  private intervalId: number | null = null;
  private sequence = 0;
  private inFlight = false;
  private queuedReason: string | null = null;

  constructor(private readonly game: Game) {}

  start(): void {
    this.flush("session-start");
    this.intervalId = window.setInterval(() => this.flush("interval"), PERF_DISK_LOG_INTERVAL_MS);
    window.addEventListener("pagehide", this.handlePageHide);
  }

  dispose(reason = "dispose"): void {
    if (this.intervalId !== null) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
    }
    window.removeEventListener("pagehide", this.handlePageHide);
    this.flush(reason);
  }

  flush(reason = "manual"): void {
    if (this.inFlight) {
      this.queuedReason = reason;
      return;
    }
    const payload = this.createPayload(reason);
    const body = JSON.stringify(payload);
    this.inFlight = true;
    void fetch(PERF_DISK_LOG_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    })
      .catch((error: unknown) => {
        console.warn("Downtown Mayhem: perf disk log write failed.", error);
      })
      .finally(() => {
        this.inFlight = false;
        const queuedReason = this.queuedReason;
        this.queuedReason = null;
        if (queuedReason) {
          this.flush(queuedReason);
        }
      });
  }

  private createPayload(reason: string) {
    const report = perfMonitor.report();
    const payload: {
      sessionId: string;
      sequence: number;
      reason: string;
      createdAt: string;
      pageTimeMs: number;
      href: string;
      stats: DowntownMayhemRenderStats;
      warmup: RenderWarmupState;
      summary: PerfDiskLogSummary;
      report?: PerfReport;
    } = {
      sessionId: this.sessionId,
      sequence: this.sequence++,
      reason,
      createdAt: new Date().toISOString(),
      pageTimeMs: Math.round(performance.now() * 10) / 10,
      href: location.href,
      stats: this.game.getPerfLogRenderStats(this.shouldCaptureFullStats(reason)),
      warmup: this.game.getRenderWarmupState(),
      summary: summarizePerfReport(report)
    };
    if (this.includeFullReport || reason === "manual") {
      payload.report = report;
    }
    return payload;
  }

  private shouldCaptureFullStats(reason: string): boolean {
    return this.includeFullReport || reason === "manual" || reason === "score-finalized";
  }
}

function summarizePerfReport(report: PerfReport): PerfDiskLogSummary {
  const frames = report.recentSlowFrames;
  const shotFrames = frames.filter(isShotPerfFrame);
  return {
    frameCount: report.frameCount,
    slowFrameCount: report.slowFrameCount,
    slowRatioPercent: Math.round((report.slowFrameCount / Math.max(1, report.frameCount)) * 1000) / 10,
    shotFrameCount: shotFrames.length,
    maxFrame: report.maxFrame ? summarizePerfFrame(report.maxFrame) : null,
    shotMax: {
      totalMs: maxPerfValue(shotFrames, (frame) => frame.totalMs),
      renderMs: maxPerfValue(shotFrames, (frame) => frame.timings["renderer.render"]),
      physicsStepMs: maxPerfValue(shotFrames, (frame) => frame.timings["physics.step"]),
      rapierMs: maxPerfValue(shotFrames, (frame) => frame.timings["physics.rapierStep"]),
      fractureMs: maxPerfValue(shotFrames, (frame) => frame.timings["destruction.fracture"]),
      queuedFractureMs: maxPerfValue(shotFrames, (frame) => frame.timings["destruction.processQueuedFractures"]),
      addBoxMs: maxPerfValue(shotFrames, (frame) => frame.timings["physics.addDynamicBox"]),
      particlesInFrame: maxPerfValue(shotFrames, (frame) => frame.counters["vfx.particlesSpawned"]),
      visualOnlyFragmentsInFrame: maxPerfValue(shotFrames, (frame) => frame.counters["destruction.visualOnlyFragmentsCreated"]),
      physicalFragmentsInFrame: maxPerfValue(shotFrames, (frame) => frame.counters["destruction.physicalFragmentsCreated"]),
      fragmentsInFrame: maxPerfValue(shotFrames, (frame) => frame.counters["destruction.fragmentsCreated"]),
      boxCacheMissesInFrame: maxPerfValue(shotFrames, (frame) => frame.counters["render.boxGeometryCacheMiss"]),
      childBoxCacheMissesInFrame: maxPerfValue(shotFrames, (frame) => frame.counters["render.childBoxGeometryCacheMiss"]),
      droppedSubstepsInFrame: maxPerfValue(shotFrames, (frame) => frame.counters["physics.substepsDropped"])
    },
    shotTotals: {
      fragments: sumPerfValue(shotFrames, (frame) => frame.counters["destruction.fragmentsCreated"]),
      dynamicBoxes: sumPerfValue(shotFrames, (frame) => frame.counters["physics.dynamicBoxesAdded"]),
      particles: sumPerfValue(shotFrames, (frame) => frame.counters["vfx.particlesSpawned"]),
      visualOnlyFragments: sumPerfValue(shotFrames, (frame) => frame.counters["destruction.visualOnlyFragmentsCreated"]),
      physicalFragments: sumPerfValue(shotFrames, (frame) => frame.counters["destruction.physicalFragmentsCreated"]),
      boxCacheMisses: sumPerfValue(shotFrames, (frame) => frame.counters["render.boxGeometryCacheMiss"]),
      childBoxCacheMisses: sumPerfValue(shotFrames, (frame) => frame.counters["render.childBoxGeometryCacheMiss"]),
      frozenRubbleBuckets: sumPerfValue(shotFrames, (frame) => frame.counters["physics.frozenRubbleBucketsCreated"]),
      stagedActivated: sumPerfValue(shotFrames, (frame) => frame.counters["render.stagedVisualActivationsActivated"]),
      droppedSubsteps: sumPerfValue(shotFrames, (frame) => frame.counters["physics.substepsDropped"])
    },
    topShotSlowFrames: topPerfFrames(shotFrames),
    topAllSlowFrames: topPerfFrames(frames)
  };
}

function summarizePerfFrame(frame: PerfFrameSnapshot): PerfFrameSummary {
  return {
    frame: frame.frame,
    totalMs: frame.totalMs,
    deltaMs: frame.deltaMs,
    bodyCount: frame.bodyCount,
    dynamicBodyCount: frame.dynamicBodyCount,
    awakeBodyCount: frame.awakeBodyCount,
    debrisBodyCount: frame.debrisBodyCount,
    awakeDebrisBodyCount: frame.awakeDebrisBodyCount,
    activeDebrisCount: frame.activeDebrisCount,
    frozenDebrisCount: frame.frozenDebrisCount,
    pendingSupportReleaseCount: frame.pendingSupportReleaseCount,
    accountedMs: frame.accountedMs,
    unattributedMs: frame.unattributedMs,
    renderMs: frame.timings["renderer.render"] ?? 0,
    physicsStepMs: frame.timings["physics.step"] ?? 0,
    rapierMs: frame.timings["physics.rapierStep"] ?? 0,
    impactsMs: frame.timings["game.processDebrisImpacts"] ?? 0,
    fractureMs: frame.timings["destruction.fracture"] ?? 0,
    queuedFractureMs: frame.timings["destruction.processQueuedFractures"] ?? 0,
    addBoxMs: frame.timings["physics.addDynamicBox"] ?? 0,
    vfxExplodeMs: frame.timings["vfx.explode"] ?? 0,
    fragments: frame.counters["destruction.fragmentsCreated"] ?? 0,
    dynamicBoxes: frame.counters["physics.dynamicBoxesAdded"] ?? 0,
    particles: frame.counters["vfx.particlesSpawned"] ?? 0,
    visualOnlyFragments: frame.counters["destruction.visualOnlyFragmentsCreated"] ?? 0,
    physicalFragments: frame.counters["destruction.physicalFragmentsCreated"] ?? 0,
    boxCacheMiss: frame.counters["render.boxGeometryCacheMiss"] ?? 0,
    childBoxCacheMiss: frame.counters["render.childBoxGeometryCacheMiss"] ?? 0,
    frozenRubbleBuckets: frame.counters["physics.frozenRubbleBucketsCreated"] ?? 0,
    stagedActivated: frame.counters["render.stagedVisualActivationsActivated"] ?? 0,
    droppedSubsteps: frame.counters["physics.substepsDropped"] ?? 0
  };
}

function isShotPerfFrame(frame: PerfFrameSnapshot): boolean {
  return Boolean(
    frame.timings["physics.step"] ||
      frame.timings["game.projectiles"] ||
      frame.timings["destruction.explode"] ||
      frame.counters["collision.chainDrained"] ||
      frame.counters["collision.surfaceDrained"] ||
      frame.counters["destruction.fragmentsCreated"] ||
      frame.counters["physics.dynamicBoxesAdded"] ||
      frame.counters["destruction.fracturesQueued"]
  );
}

function topPerfFrames(frames: PerfFrameSnapshot[]): PerfFrameSummary[] {
  return frames
    .slice()
    .sort((a, b) => b.totalMs - a.totalMs)
    .slice(0, 10)
    .map(summarizePerfFrame);
}

function maxPerfValue(frames: PerfFrameSnapshot[], readValue: (frame: PerfFrameSnapshot) => number | undefined): number {
  return Math.max(0, ...frames.map((frame) => readValue(frame) ?? 0));
}

function sumPerfValue(frames: PerfFrameSnapshot[], readValue: (frame: PerfFrameSnapshot) => number | undefined): number {
  return Math.round(frames.reduce((total, frame) => total + (readValue(frame) ?? 0), 0) * 10) / 10;
}

function createPerfDiskSessionId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return random.replaceAll(/[^a-zA-Z0-9._-]/g, "-");
}

function shouldEnablePerfDiskLogging(): boolean {
  return import.meta.env.DEV && perfMonitor.isEnabled();
}

function shouldIncludeFullPerfDiskReport(): boolean {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").has("perfFull");
  } catch {
    return false;
  }
}

class Game {
  private readonly renderer: DowntownMayhemRenderer;
  private readonly rendererPreference: RendererBackendPreference;
  private readonly rendererBackend: "webgpu" | "webgl2" | "webgl";
  private readonly scene = new THREE.Scene();
  private readonly materials = new MaterialCatalog();
  private readonly rng: SeededRandom;
  private readonly physics: PhysicsWorld;
  private readonly destruction: DestructionSystem;
  private readonly audio = new DestructionAudio();
  private readonly particles: ParticleSystem;
  private readonly explosion: ExplosionSystem;
  private readonly cameraRig: CameraRig;
  private readonly cannon: Cannon;
  private readonly projectiles: ProjectileSystem;
  private readonly scoreTracker = new ShotScoreTracker();
  private readonly runState = new ShotRunState();
  private readonly scorePopups: ScorePopupLayer;
  private readonly ui: GameUI;
  private readonly input: InputController;
  private readonly timer = new THREE.Timer();
  private readonly aimRaycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly aimPoint = DEFAULT_AIM_POINT.clone();
  private readonly aimMarkerPoint = DEFAULT_AIM_POINT.clone();
  private readonly aimSurfaceNormal = AIM_SURFACE_NORMAL.clone();
  private readonly aimSurfaceTargets: THREE.Object3D[] = [];
  private readonly aimVisibleSurfaceTargets: THREE.Object3D[] = [];
  private readonly aimSurfaceHits: THREE.Intersection<THREE.Object3D>[] = [];
  private readonly projectileSegmentCandidates: PhysicsObject[] = [];
  private readonly projectileCurrentPosition = new THREE.Vector3();
  private readonly projectilePreviousPosition = new THREE.Vector3();
  private readonly chainSourcePosition = new THREE.Vector3();
  private readonly chainTargetPosition = new THREE.Vector3();
  private readonly chainTowardTarget = new THREE.Vector3();
  private readonly chainImpactOrigin = new THREE.Vector3();
  private readonly chainRelativeVelocity = new THREE.Vector3();
  private readonly chainImpactLever = new THREE.Vector3();
  private readonly surfaceObjectPosition = new THREE.Vector3();
  private readonly surfaceImpactOrigin = new THREE.Vector3();
  private readonly aimMarkerMaterial = new THREE.MeshBasicMaterial({
    color: 0x8ff7ff,
    transparent: true,
    opacity: 0.84,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });
  private readonly aimMarker = createAimMarker(this.aimMarkerMaterial);
  private readonly arenaObjects: THREE.Object3D[] = [];
  private readonly cannonBatteryObjects: THREE.Object3D[] = [];
  private readonly levelDecorations: THREE.Object3D[] = [];
  private renderWarmupGroup: THREE.Group | null = null;
  private readonly renderWarmupPersistentObjects: THREE.Object3D[] = [];
  private readonly warmedLevelIds = new Set<string>();
  private readonly handleResize = () => this.resize();
  private readonly handleBeforeUnload = () => this.input.dispose();
  private readonly chainImpactCooldowns = new Map<string, number>();
  private readonly surfaceImpactCooldowns = new Map<number, number>();
  private readonly processedSurfaceImpactObjectIds = new Set<number>();
  private readonly triggeredHazards = new Set<number>();
  private readonly burningHazards = new Map<number, BurningHazard>();

  private settings: GameSettings;
  private selectedProjectile: ProjectileId = "slug";
  private powerScale = 1;
  private sizeScale = 1;
  private levelIndex = 0;
  private arcadeProgress = loadArcadeProgress(ARCADE_LEVELS);
  private arcadeResult: ArcadeResult | null = null;
  private runSeed = createRunSeed();
  private status = "Aim the siege cannon from the high battery.";
  private slowMotionTimer = 0;
  private hitStopTimer = 0;
  private fpsSampleElapsed = 0;
  private fpsSampleFrames = 0;
  private displayedFps = 0;
  private aimTrafficAccumulator = 0;
  private nextChainCooldownSweep = 0;
  private spectacleFocusScore = 0;
  private spectacleFocusUpdatedAt = 0;
  private readonly projectileSpectacleFocus = new THREE.Vector3();
  private hasProjectileSpectacleFocus = false;
  private disposed = false;
  private frozenForCapture = false;
  private levelReloadInProgress = false;
  private aimSurfaceTargetsDirty = true;
  private readonly perfDiskLogger: PerfDiskLogger | null = shouldEnablePerfDiskLogging() ? new PerfDiskLogger(this) : null;
  private renderWarmupToken = 0;
  private renderWarmupPromise: Promise<void> | null = null;
  private renderWarmupState: RenderWarmupState = createInitialRenderWarmupState();
  private renderStatsFrame = 0;
  private lastRenderStats: DowntownMayhemRenderStats = {
    frame: 0,
    levelName: "",
    rendererPreference: "auto",
    rendererBackend: "webgl2",
    bodyCount: 0,
    dynamicBodyCount: 0,
    awakeBodyCount: 0,
    debrisBodyCount: 0,
    awakeDebrisBodyCount: 0,
    fixedStructureCount: 0,
    activeDebrisCount: 0,
    frozenDebrisCount: 0,
    pendingSupportReleaseCount: 0,
    drawCalls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    visibleMeshes: 0,
    visibleMaterials: 0,
    visiblePooledVfxObjects: 0,
    fragmentInstanceBuckets: 0,
    fragmentInstanceVisibleBuckets: 0,
    fragmentInstanceWarmupBuckets: 0,
    fragmentInstanceOverflowBuckets: 0
  };

  constructor(settings: GameSettings, rendererBundle: DowntownMayhemRendererBundle, private readonly options: GameOptions = {}) {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) {
      throw new Error("Missing #app");
    }

    this.settings = settings;
    this.renderer = rendererBundle.renderer;
    this.rendererPreference = rendererBundle.preference;
    this.rendererBackend = rendererBundle.backend;
    this.renderer.domElement.dataset.rendererPreference = this.rendererPreference;
    this.renderer.domElement.dataset.rendererBackend = this.rendererBackend;
    app.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x050811);
    this.scene.fog = new THREE.Fog(0x07111c, 34, 92);
    this.timer.connect(document);

    this.rng = new SeededRandom(this.runSeed);
    this.cameraRig = new CameraRig(this.renderer);
    this.physics = new PhysicsWorld(this.scene);
    this.destruction = new DestructionSystem(this.physics, this.scene, this.materials, this.rng);
    this.particles = new ParticleSystem(this.scene);
    this.explosion = new ExplosionSystem(this.particles);
    this.projectiles = new ProjectileSystem(this.physics, this.materials, this.rng);
    this.cannon = new Cannon(this.scene);
    this.scene.add(this.aimMarker);
    this.scorePopups = new ScorePopupLayer();

    this.ui = new GameUI({
      fire: () => this.fire(),
      reset: () => this.reset(),
      clearDebris: () => this.clearDebris(),
      finishRun: () => this.finishRun(),
      openMainMenu: () => this.openMainMenu(),
      selectProjectile: (id) => this.selectProjectile(id),
      selectLevel: (index) => this.selectLevel(index),
      nextLevel: () => this.nextLevel(),
      updateSettings: (patch) => this.updateSettings(patch),
      resetSettings: () => this.resetSettings()
    });

    this.input = new InputController(this.renderer.domElement, {
      aim: (pointer) => this.aim(pointer),
      fire: () => this.fire(),
      reset: () => this.reset(),
      clearDebris: () => this.clearDebris(),
      finishRun: () => this.finishRun(),
      selectProjectile: (id) => this.selectProjectile(id),
      nextLevel: () => this.nextLevel()
    });

    this.scene.add(createNightSkyDome());
    this.configureLights();
    this.applySettings();
    this.buildArena();
    this.levelIndex = clampInitialLevelIndex(options.initialLevelIndex, this.arcadeProgress.highestUnlockedLevel);
    this.loadLevel();
    this.audio.preload();
    this.resize();
    this.scheduleRenderWarmup();
    this.perfDiskLogger?.start();
    window.addEventListener("resize", this.handleResize);
    window.visualViewport?.addEventListener("resize", this.handleResize);
    window.addEventListener("beforeunload", this.handleBeforeUnload);
  }

  start(): void {
    this.frozenForCapture = false;
    void this.renderer.setAnimationLoop(() => this.update());
  }

  getRenderStats(): DowntownMayhemRenderStats {
    return this.captureRenderStats();
  }

  getPerfLogRenderStats(captureFullStats: boolean): DowntownMayhemRenderStats {
    return captureFullStats ? this.captureRenderStats() : this.captureFastRenderStats();
  }

  getRenderWarmupState(): RenderWarmupState {
    return { ...this.renderWarmupState };
  }

  flushPerfLog(reason?: string): void {
    this.perfDiskLogger?.flush(reason ?? "manual");
  }

  showPlayScreen(): void {
    this.ui.showPlayScreen();
  }

  freezeForCapture(): DowntownMayhemRenderStats {
    this.frozenForCapture = true;
    void this.renderer.setAnimationLoop(null);
    this.renderer.render(this.scene, this.cameraRig.camera);
    return this.captureRenderStats();
  }

  resume(): void {
    if (this.disposed || !this.frozenForCapture) {
      return;
    }
    this.start();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    void this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.handleResize);
    window.visualViewport?.removeEventListener("resize", this.handleResize);
    window.removeEventListener("beforeunload", this.handleBeforeUnload);
    this.perfDiskLogger?.dispose("game-dispose");
    if (window.__DOWNTOWN_MAYHEM_DEBUG__?.getRenderStats().frame === this.lastRenderStats.frame) {
      delete window.__DOWNTOWN_MAYHEM_DEBUG__;
    }
    this.input.dispose();
    this.scorePopups.dispose();
    this.particles.dispose();
    this.destruction.clearVisualFragments();
    this.projectiles.clearActive();
    this.physics.clearDynamic();
    this.physics.clearStatics();
    this.clearLevelDecorations();
    this.disposeRenderWarmupGroup();
    const disposedObjects = new Set<THREE.Object3D>();
    const disposedMaterials = new Set<THREE.Material>();
    for (const object of this.arenaObjects) {
      if (disposedObjects.has(object)) {
        continue;
      }
      disposedObjects.add(object);
      this.scene.remove(object);
      disposeObject(object, disposedMaterials);
    }
    this.arenaObjects.length = 0;
    for (const object of this.cannonBatteryObjects) {
      if (disposedObjects.has(object)) {
        continue;
      }
      disposedObjects.add(object);
      this.scene.remove(object);
      disposeObject(object, disposedMaterials);
    }
    this.cannonBatteryObjects.length = 0;
    this.ui.dispose();
    this.physics.world.free();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private update(): void {
    this.timer.update();
    const frameDelta = this.timer.getDelta();
    const delta = Math.min(frameDelta, MAX_FRAME_DELTA_SECONDS);
    const simulationDelta = Math.min(frameDelta, MAX_SIMULATION_DELTA_SECONDS);
    if (perfMonitor.isEnabled()) {
      perfMonitor.beginFrame(frameDelta * 1000, this.physics.getRuntimeStats());
    }
    try {
      this.updateFps(frameDelta);
      this.physics.flushStagedVisualActivations();
      const motionEffectsActive = this.settings.motionEffects;
      const hitStopped = motionEffectsActive && this.hitStopTimer > 0;
      const slowMotionActive = motionEffectsActive && this.slowMotionTimer > 0;
      const timeScale = hitStopped ? 0 : slowMotionActive ? 0.32 : 1;
      const visualScale = hitStopped ? 0 : slowMotionActive ? 0.55 : 1;
      if (this.hitStopTimer > 0) {
        this.hitStopTimer = Math.max(0, this.hitStopTimer - delta);
      }
      if (this.slowMotionTimer > 0) {
        this.slowMotionTimer = Math.max(0, this.slowMotionTimer - delta);
      }

      let startedAt = perfMonitor.timeStart();
      this.cannon.update(delta, PROJECTILES[this.selectedProjectile], this.powerScale, this.sizeScale);
      perfMonitor.addTiming("game.cannon", startedAt);

      if (this.runState.phase === "aim") {
        startedAt = perfMonitor.timeStart();
        this.aimTrafficAccumulator += delta;
        if (this.aimTrafficAccumulator >= AIM_TRAFFIC_STEP_SECONDS) {
          const trafficDelta = Math.min(this.aimTrafficAccumulator, AIM_TRAFFIC_MAX_ACCUMULATED_SECONDS);
          this.aimTrafficAccumulator = 0;
          this.physics.advanceTrafficRoutes(trafficDelta);
        }
        perfMonitor.addTiming("physics.traffic", startedAt);
      }
      if (this.runState.phase !== "aim") {
        this.aimTrafficAccumulator = 0;
        startedAt = perfMonitor.timeStart();
        this.physics.step(simulationDelta * timeScale);
        perfMonitor.addTiming("physics.step", startedAt);
        startedAt = perfMonitor.timeStart();
        this.projectiles.update(simulationDelta * timeScale);
        perfMonitor.addTiming("game.projectiles", startedAt);
      }
      startedAt = perfMonitor.timeStart();
      const chainEvents = this.processDebrisImpacts();
      perfMonitor.addTiming("game.processDebrisImpacts", startedAt);
      if (chainEvents.length > 0) {
        this.scorePopups.push(chainEvents);
      }
      startedAt = perfMonitor.timeStart();
      const fireEvents = this.updateBurningHazards();
      perfMonitor.addTiming("game.updateBurningHazards", startedAt);
      if (fireEvents.length > 0) {
        this.scorePopups.push(fireEvents);
      }
      startedAt = perfMonitor.timeStart();
      this.updatePhase();
      perfMonitor.addTiming("game.updatePhase", startedAt);
      startedAt = perfMonitor.timeStart();
      this.destruction.processQueuedFractures(FRACTURE_PROCESS_MAX_PER_FRAME, FRACTURE_PROCESS_TIME_BUDGET_MS);
      this.physics.flushPendingSupportReleases();
      this.destruction.updateVisualFragments(delta * visualScale);
      this.physics.flushStagedVisualActivations(8, 0.25);
      this.destruction.flushFragmentInstanceBounds();
      this.physics.flushInstancedRenderBounds();
      perfMonitor.addTiming("game.flushWork", startedAt);

      startedAt = perfMonitor.timeStart();
      this.particles.update(delta * visualScale);
      perfMonitor.addTiming("vfx.update", startedAt);
      startedAt = perfMonitor.timeStart();
      this.cameraRig.update(delta * visualScale);
      this.updateAimMarker();
      this.scorePopups.update(delta * visualScale, this.cameraRig.camera);
      perfMonitor.addTiming("game.visualUpdate", startedAt);
      startedAt = perfMonitor.timeStart();
      this.updateHud();
      perfMonitor.addTiming("game.ui", startedAt);
      startedAt = perfMonitor.timeStart();
      const programsBeforeRender = rendererProgramCount(this.renderer);
      this.renderer.render(this.scene, this.cameraRig.camera);
      const programDelta = rendererProgramCount(this.renderer) - programsBeforeRender;
      if (programDelta > 0 && this.renderWarmupState.phase === "ready") {
        this.recordPostWarmupProgramCreation(programDelta);
      }
      perfMonitor.addTiming("renderer.render", startedAt);
    } finally {
      perfMonitor.endFrame();
    }
  }

  private recordPostWarmupProgramCreation(programDelta: number): void {
    if (!perfMonitor.isEnabled()) {
      return;
    }
    perfMonitor.addCount("renderer.programsCreatedAfterWarmup", programDelta);
    perfMonitor.addCount("renderer.postWarmupProgramFrameDrawCalls", rendererDrawCalls(this.renderer));
    perfMonitor.addCount("renderer.postWarmupProgramFrameTriangles", this.renderer.info.render.triangles);
    perfMonitor.addCount("renderer.postWarmupProgramFramePrograms", rendererProgramCount(this.renderer));
    const physicsStats = this.physics.getRuntimeStats();
    perfMonitor.addCount("renderer.postWarmupProgramFrameDynamicBodies", physicsStats.dynamicBodyCount);
    perfMonitor.addCount("renderer.postWarmupProgramFrameAwakeBodies", physicsStats.awakeBodyCount);
    perfMonitor.addCount("renderer.postWarmupProgramFrameActiveDebris", physicsStats.activeDebrisCount);
    perfMonitor.addCount("renderer.postWarmupProgramFramePendingSupport", physicsStats.pendingSupportReleaseCount);
  }

  private updateHud(): void {
    const level = this.currentLevel();
    this.ui.update({
      projectileId: this.selectedProjectile,
      projectile: PROJECTILES[this.selectedProjectile],
      shotAvailable: this.runState.shotAvailable,
      canFinishRun: this.runState.phase === "spectacle" && !this.runState.score,
      bodyCount: this.physics.getDynamicBodyCount(),
      levelName: level.name,
      levelDescription: level.description,
      objective: level.objective,
      chaosBrief: level.chaosBrief,
      mission: level.mission,
      levelIndex: this.levelIndex,
      levelCount: TEST_CHAMBERS.length,
      levels: this.levelOptions(),
      levelProgress: this.currentLevelProgress(),
      totalStars: this.arcadeProgress.totalStars,
      arcadeResult: this.arcadeResult,
      settings: this.settings,
      status: this.status,
      fps: this.displayedFps,
      score: this.runState.score
    });
  }

  private captureRenderStats(): DowntownMayhemRenderStats {
    const visibleMaterials = new Set<THREE.Material>();
    let visibleMeshes = 0;
    const physicsStats = this.physics.getRuntimeStats();
    const fragmentStats = this.destruction.getFragmentInstanceStats();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) {
        return;
      }
      visibleMeshes += 1;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        visibleMaterials.add(material);
      }
    });
    this.lastRenderStats = {
      frame: this.renderStatsFrame,
      levelName: this.currentLevel().name,
      rendererPreference: this.rendererPreference,
      rendererBackend: this.rendererBackend,
      bodyCount: physicsStats.bodyCount,
      dynamicBodyCount: physicsStats.dynamicBodyCount,
      awakeBodyCount: physicsStats.awakeBodyCount,
      debrisBodyCount: physicsStats.debrisBodyCount,
      awakeDebrisBodyCount: physicsStats.awakeDebrisBodyCount,
      fixedStructureCount: physicsStats.fixedStructureCount,
      activeDebrisCount: physicsStats.activeDebrisCount,
      frozenDebrisCount: physicsStats.frozenDebrisCount,
      pendingSupportReleaseCount: physicsStats.pendingSupportReleaseCount,
      drawCalls: rendererDrawCalls(this.renderer),
      triangles: this.renderer.info.render.triangles,
      lines: this.renderer.info.render.lines,
      points: this.renderer.info.render.points,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: rendererProgramCount(this.renderer),
      visibleMeshes,
      visibleMaterials: visibleMaterials.size,
      visiblePooledVfxObjects: this.particles.getVisiblePooledEffectCount(),
      fragmentInstanceBuckets: fragmentStats.buckets,
      fragmentInstanceVisibleBuckets: fragmentStats.visibleBuckets,
      fragmentInstanceWarmupBuckets: fragmentStats.warmupBuckets,
      fragmentInstanceOverflowBuckets: fragmentStats.overflowBuckets
    };
    this.renderStatsFrame += 1;
    return { ...this.lastRenderStats };
  }

  private captureFastRenderStats(): DowntownMayhemRenderStats {
    const physicsStats = this.physics.getRuntimeStats();
    const fragmentStats = this.destruction.getFragmentInstanceStats();
    this.lastRenderStats = {
      ...this.lastRenderStats,
      frame: this.renderStatsFrame,
      levelName: this.currentLevel().name,
      rendererPreference: this.rendererPreference,
      rendererBackend: this.rendererBackend,
      bodyCount: physicsStats.bodyCount,
      dynamicBodyCount: physicsStats.dynamicBodyCount,
      awakeBodyCount: physicsStats.awakeBodyCount,
      debrisBodyCount: physicsStats.debrisBodyCount,
      awakeDebrisBodyCount: physicsStats.awakeDebrisBodyCount,
      fixedStructureCount: physicsStats.fixedStructureCount,
      activeDebrisCount: physicsStats.activeDebrisCount,
      frozenDebrisCount: physicsStats.frozenDebrisCount,
      pendingSupportReleaseCount: physicsStats.pendingSupportReleaseCount,
      drawCalls: rendererDrawCalls(this.renderer),
      triangles: this.renderer.info.render.triangles,
      lines: this.renderer.info.render.lines,
      points: this.renderer.info.render.points,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: rendererProgramCount(this.renderer),
      visiblePooledVfxObjects: this.particles.getVisiblePooledEffectCount(),
      fragmentInstanceBuckets: fragmentStats.buckets,
      fragmentInstanceVisibleBuckets: fragmentStats.visibleBuckets,
      fragmentInstanceWarmupBuckets: fragmentStats.warmupBuckets,
      fragmentInstanceOverflowBuckets: fragmentStats.overflowBuckets
    };
    this.renderStatsFrame += 1;
    return { ...this.lastRenderStats };
  }

  private updateFps(delta: number): void {
    this.fpsSampleElapsed += delta;
    this.fpsSampleFrames += 1;
    if (this.fpsSampleElapsed >= 0.35) {
      this.displayedFps = Math.round(this.fpsSampleFrames / this.fpsSampleElapsed);
      this.fpsSampleElapsed = 0;
      this.fpsSampleFrames = 0;
    }
  }

  private updatePhase(): void {
    const active = this.projectiles.getActive();
    if (this.runState.phase === "aim") {
      this.cannon.setTrajectoryVisible(true);
      this.cameraRig.setCityAimView(this.cannon.getCameraAnchor(), this.currentLevel().cameraTarget);
      return;
    }

    this.cannon.setTrajectoryVisible(false);
    if (this.runState.phase === "flight" && active) {
      const position = vectorFromRapier(active.object.body.translation());
      const velocity = vectorFromRapier(active.object.body.linvel());
      if (this.shouldReleaseProjectileCamera(active, position, velocity)) {
        this.releaseProjectileCameraToSpectacle(position);
        return;
      }
      this.cameraRig.followProjectile(position, velocity);
      const impact = this.detectImpact(active);
      if (impact || active.age > 7.5) {
        this.handleImpact(impact?.point ?? position, active, impact?.object ?? null);
      }
      return;
    }

    const scoreRevealDecision = this.runState.evaluateScoreReveal(performance.now(), this.isSceneSettled());
    if (scoreRevealDecision === "waiting") {
      this.status = "Scoring active chain reactions...";
      return;
    }
    if (scoreRevealDecision === "ready") {
      this.finalizeScore();
    }
  }

  private configureLights(): void {
    const ambient = new THREE.HemisphereLight(0x9fc8ff, 0x151b24, 0.58);
    this.scene.add(ambient);

    const moonKey = new THREE.DirectionalLight(0xc7e2ff, 1.55);
    moonKey.position.copy(MOON_DIRECTION.clone().multiplyScalar(18));
    moonKey.castShadow = false;
    moonKey.shadow.mapSize.set(1024, 1024);
    moonKey.shadow.camera.near = 1;
    moonKey.shadow.camera.far = 70;
    moonKey.shadow.camera.left = -24;
    moonKey.shadow.camera.right = 24;
    moonKey.shadow.camera.top = 24;
    moonKey.shadow.camera.bottom = -24;
    this.scene.add(moonKey);

    const rim = new THREE.DirectionalLight(0x6da8ff, 0.22);
    rim.position.set(-7, 5, -8);
    this.scene.add(rim);
  }

  private buildArena(): void {
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x15191d,
      roughness: 0.82,
      metalness: 0.08,
      map: graphicTexture("arenaFloor", { repeat: [7, 11], anisotropy: 8 })
    });
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e2730,
      roughness: 0.72,
      metalness: 0.05,
      map: graphicTexture("arenaWall", { repeat: [5, 1], anisotropy: 8 })
    });
    const cannonDeckMaterial = new THREE.MeshStandardMaterial({
      color: 0x27313a,
      roughness: 0.76,
      metalness: 0.08,
      map: graphicTexture("cannonDeck", { repeat: [2.2, 1.6], anisotropy: 8 })
    });

    const floor = this.physics.addStaticBox({
      label: "Siege range floor",
      position: new THREE.Vector3(0, -0.1, 7),
      size: new THREE.Vector3(38, 0.2, 58),
      material: floorMaterial
    });
    this.arenaObjects.push(floor);

    const wallSpecs = [
      { position: new THREE.Vector3(0, 0.55, -22), size: new THREE.Vector3(38, 1.1, 0.35) },
      { position: new THREE.Vector3(0, 0.55, 36), size: new THREE.Vector3(38, 1.1, 0.35) },
      { position: new THREE.Vector3(-19, 0.55, 7), size: new THREE.Vector3(0.35, 1.1, 58) },
      { position: new THREE.Vector3(19, 0.55, 7), size: new THREE.Vector3(0.35, 1.1, 58) }
    ];
    for (const spec of wallSpecs) {
      const wall = this.physics.addStaticBox({ label: "Arena wall", material: wallMaterial, ...spec });
      wall.castShadow = true;
      this.arenaObjects.push(wall);
    }

    const cannonDeck = this.addArenaVisualBox(
      "High siege battery",
      new THREE.Vector3(0, 2.85, 26.45),
      new THREE.Vector3(6.4, 5.7, 4.8),
      cannonDeckMaterial
    );
    cannonDeck.castShadow = true;
    this.arenaObjects.push(cannonDeck);
    this.cannonBatteryObjects.push(cannonDeck);

    for (const x of [-3.3, 3.3]) {
      const curb = this.addArenaVisualBox(
        "Cannon deck curb",
        new THREE.Vector3(x, 5.86, 26.45),
        new THREE.Vector3(0.22, 0.32, 4.7),
        cannonDeckMaterial
      );
      curb.castShadow = true;
      this.arenaObjects.push(curb);
      this.cannonBatteryObjects.push(curb);
    }

  }

  private positionCannonBattery(cannonPosition: THREE.Vector3): void {
    this.cannonBatteryObjects.forEach((object, index) => {
      const offset = CANNON_DECK_OFFSETS[index] ?? CANNON_DECK_OFFSETS[0];
      object.position.copy(cannonPosition).add(offset);
    });
  }

  private addArenaVisualBox(
    label: string,
    position: THREE.Vector3,
    size: THREE.Vector3,
    material: THREE.Material
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.name = label;
    mesh.position.copy(position);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.scene.add(mesh);
    return mesh;
  }

  private loadLevel(): void {
    this.physics.clearDynamic();
    this.clearLevelDecorations();
    this.invalidateAimSurfaceTargets();
    this.projectiles.clearActive();
    this.destruction.clearQueuedFractures();
    this.destruction.clearVisualFragments();
    this.destruction.pruneFragmentInstanceBuckets();
    this.chainImpactCooldowns.clear();
    this.surfaceImpactCooldowns.clear();
    this.triggeredHazards.clear();
    this.burningHazards.clear();
    this.nextChainCooldownSweep = 0;
    this.spectacleFocusScore = 0;
    this.spectacleFocusUpdatedAt = 0;
    this.clearProjectileSpectacleFocus();
    this.runState.resetAim();
    this.arcadeResult = null;
    this.runSeed = createRunSeed();
    this.rng.reset(this.runSeed);
    if (import.meta.env.DEV) {
      console.debug(`[Downtown Mayhem] run seed ${this.runSeed}`);
    }
    this.scorePopups.clear();
    this.slowMotionTimer = 0;
    this.hitStopTimer = 0;
    this.aimTrafficAccumulator = 0;
    this.cameraRig.resetTransientMotion();
    const level = this.currentLevel();
    this.cannon.setBasePosition(level.cannonPosition);
    this.positionCannonBattery(level.cannonPosition);
    this.aimPoint.copy(level.defaultAimPoint ?? DEFAULT_AIM_POINT);
    this.aimMarkerPoint.set(this.aimPoint.x, AIM_FALLBACK_SURFACE_Y, this.aimPoint.z);
    this.aimSurfaceNormal.copy(AIM_SURFACE_NORMAL);
    level.setup({
      physics: this.physics,
      materials: this.materials,
      addDecoration: (object) => this.addDecoration(object)
    });
    this.physics.batchStaticDetails();
    this.invalidateAimSurfaceTargets();
    setOptionalShadowMapFlag(this.renderer, "needsUpdate", true);
    this.status = `${level.name}: ${level.objective}`;
    this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
  }

  waitForRenderWarmup(): Promise<void> {
    return this.renderWarmupPromise ?? Promise.resolve();
  }

  private scheduleRenderWarmup(): void {
    const token = this.renderWarmupToken + 1;
    this.renderWarmupToken = token;
    this.disposeRenderWarmupGroup();
    this.renderWarmupPersistentObjects.length = 0;
    const group = this.createRenderWarmupGroup();
    this.renderWarmupGroup = group;
    this.renderWarmupState = {
      phase: "warming",
      token,
      startedAt: performance.now(),
      finishedAt: null,
      durationMs: null,
      programs: rendererProgramCount(this.renderer),
      geometries: this.renderer.info.memory.geometries,
      frames: 0
    };
    this.status = "Preparing renderer pipelines before impact.";
    this.renderWarmupPromise = isSmokeWarmupMode() ? this.runSmokeRenderWarmup(token, group) : this.runRenderWarmup(token, group);
  }

  private async runSmokeRenderWarmup(token: number, group: THREE.Group): Promise<void> {
    this.scene.add(group);
    const restoreFrustumCulling = disableSceneFrustumCullingForWarmup(this.scene);
    try {
      this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
      await this.renderer.compileAsync(this.scene, this.cameraRig.camera);
      await renderWarmupYield();
      this.renderer.render(this.scene, this.cameraRig.camera);
      if (this.disposed || token !== this.renderWarmupToken) {
        return;
      }
      const finishedAt = performance.now();
      this.renderWarmupState = {
        ...this.renderWarmupState,
        phase: "ready",
        finishedAt,
        durationMs: finishedAt - this.renderWarmupState.startedAt,
        programs: rendererProgramCount(this.renderer),
        geometries: this.renderer.info.memory.geometries,
        frames: 1,
        bodyCountAfterCleanup: this.physics.getDynamicBodyCount()
      };
      this.markCurrentLevelWarmupReady();
      if (this.runState.phase === "aim" && this.runState.shotAvailable) {
        const level = this.currentLevel();
        this.status = `${level.name}: ${level.objective}`;
      }
    } catch (error) {
      if (this.disposed || token !== this.renderWarmupToken) {
        return;
      }
      const finishedAt = performance.now();
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Downtown Mayhem: smoke render warmup failed.", error);
      this.renderWarmupState = {
        ...this.renderWarmupState,
        phase: "failed",
        finishedAt,
        durationMs: finishedAt - this.renderWarmupState.startedAt,
        programs: rendererProgramCount(this.renderer),
        geometries: this.renderer.info.memory.geometries,
        frames: this.renderWarmupState.frames,
        bodyCountAfterCleanup: this.physics.getDynamicBodyCount(),
        error: message
      };
      this.status = "Renderer warmup failed; impact may stutter.";
    } finally {
      this.destruction.parkFragmentVisualWarmupPreview();
      this.physics.clearFrozenRubbleWarmupObjects();
      this.particles.clearTransientEffects();
      this.particles.hidePooledEffects();
      this.disposeRenderWarmupGroup();
      restoreFrustumCulling();
    }
  }

  private async runRenderWarmup(token: number, group: THREE.Group): Promise<void> {
    this.scene.add(group);
    const restoreFrustumCulling = disableSceneFrustumCullingForWarmup(this.scene);
    const warmupCameras = createRenderWarmupCameras(this.cameraRig.camera);
    const runtimeWarmupObjectIds = this.createRuntimeFragmentWarmupObjects();
    const runtimeFragmentPipelineWarmupObjectIds = this.destruction.createRuntimeFragmentPipelineWarmupObjects();
    const cleanupTransientWarmup = (
      preserveFrozenRubbleWarmup = false,
      preserveParticlePools = false,
      preserveRenderWarmupGroup = false
    ): void => {
      this.destruction.parkFragmentVisualWarmupPreview();
      this.clearRuntimeWarmupObjects(runtimeFragmentPipelineWarmupObjectIds);
      this.clearRuntimeWarmupObjects(runtimeWarmupObjectIds);
      if (!preserveFrozenRubbleWarmup) {
        this.physics.clearFrozenRubbleWarmupObjects();
      }
      this.particles.clearTransientEffects();
      if (preserveRenderWarmupGroup) {
        group.position.set(0, -10000, 0);
        group.visible = false;
        group.updateMatrixWorld(true);
      } else {
        this.scene.remove(group);
      }
      if (preserveParticlePools) {
        this.particles.keepPoolPipelinesResident();
      }
    };
    try {
      this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
      this.destruction.showFragmentVisualWarmupPreview();
      this.playRenderWarmupEffects(0);
      for (const camera of warmupCameras) {
        await this.renderer.compileAsync(this.scene, camera);
      }
      let frames = 0;
      let stableFrames = 0;
      let lastProgramCount = rendererProgramCount(this.renderer);
      const updateWarmupState = (): void => {
        this.renderWarmupState = {
          ...this.renderWarmupState,
          programs: rendererProgramCount(this.renderer),
          geometries: this.renderer.info.memory.geometries,
          frames
        };
      };
      const renderWarmupFrame = async (): Promise<boolean> => {
        this.particles.update(RENDER_WARMUP_DELTA_SECONDS);
        for (const camera of warmupCameras) {
          await renderWarmupYield();
          this.renderer.render(this.scene, camera);
          if (this.disposed || token !== this.renderWarmupToken) {
            cleanupTransientWarmup();
            return false;
          }
        }
        frames += 1;
        updateWarmupState();
        return true;
      };
      for (let pass = 0; pass < RENDER_WARMUP_BRUTAL_PASSES; pass += 1) {
        this.status = `Preparing renderer pipelines before impact (${pass + 1}/${RENDER_WARMUP_BRUTAL_PASSES}).`;
        this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
        this.destruction.showFragmentVisualWarmupPreview();
        this.playRenderWarmupEffects(pass);
        for (let frame = 0; frame < RENDER_WARMUP_FRAMES_PER_BRUTAL_PASS; frame += 1) {
          if (!(await renderWarmupFrame())) {
            return;
          }
        }
        lastProgramCount = rendererProgramCount(this.renderer);
        stableFrames = 0;
      }
      if (!(await this.runSyntheticDestructionWarmup(token, renderWarmupFrame))) {
        return;
      }
      while (
        frames < RENDER_WARMUP_MAX_FRAMES &&
        (frames < RENDER_WARMUP_MIN_FRAMES || stableFrames < RENDER_WARMUP_STABLE_FRAMES)
      ) {
        if (!(await renderWarmupFrame())) {
          return;
        }
        const programs = rendererProgramCount(this.renderer);
        if (programs === lastProgramCount) {
          stableFrames += 1;
        } else {
          lastProgramCount = programs;
          stableFrames = 0;
        }
      }
      cleanupTransientWarmup(false, true, false);
      restoreFrustumCulling();
      this.status = "Preparing renderer pipelines before impact (runtime cascade pools).";
      for (let pass = 0; pass < RENDER_WARMUP_POST_CLEANUP_EFFECT_PASSES; pass += 1) {
        this.destruction.showFragmentVisualWarmupPreview();
        this.playRenderWarmupEffects(RENDER_WARMUP_BRUTAL_PASSES + pass);
        for (let frame = 0; frame < RENDER_WARMUP_POST_CLEANUP_EFFECT_FRAMES; frame += 1) {
          if (!(await renderWarmupFrame())) {
            return;
          }
        }
        this.destruction.parkFragmentVisualWarmupPreview();
        this.particles.clearTransientEffects();
        this.particles.keepPoolPipelinesResident();
        this.destruction.flushFragmentInstanceBounds();
        this.physics.flushInstancedRenderBounds();
        for (const camera of warmupCameras) {
          await this.renderer.compileAsync(this.scene, camera);
        }
      }
      this.status = "Preparing renderer pipelines before impact (settling runtime scene).";
      lastProgramCount = rendererProgramCount(this.renderer);
      stableFrames = 0;
      let postCleanupFrames = 0;
      while (
        postCleanupFrames < RENDER_WARMUP_POST_CLEANUP_MAX_FRAMES &&
        stableFrames < RENDER_WARMUP_POST_CLEANUP_STABLE_FRAMES
      ) {
        if (!(await renderWarmupFrame())) {
          return;
        }
        postCleanupFrames += 1;
        const programs = rendererProgramCount(this.renderer);
        if (programs === lastProgramCount) {
          stableFrames += 1;
        } else {
          lastProgramCount = programs;
          stableFrames = 0;
        }
      }
      this.destruction.parkFragmentVisualWarmupPreview();
      this.particles.clearTransientEffects();
      this.particles.hidePooledEffects();
      this.destruction.flushFragmentInstanceBounds();
      this.physics.flushInstancedRenderBounds();
      const finishedAt = performance.now();
      this.renderWarmupState = {
        ...this.renderWarmupState,
        phase: "ready",
        finishedAt,
        durationMs: finishedAt - this.renderWarmupState.startedAt,
        programs: rendererProgramCount(this.renderer),
        geometries: this.renderer.info.memory.geometries,
        frames,
        bodyCountAfterCleanup: this.physics.getDynamicBodyCount()
      };
      this.markCurrentLevelWarmupReady();
      if (this.runState.phase === "aim" && this.runState.shotAvailable) {
        const level = this.currentLevel();
        this.status = `${level.name}: ${level.objective}`;
      }
    } catch (error) {
      if (this.disposed || token !== this.renderWarmupToken) {
        cleanupTransientWarmup();
        return;
      }
      cleanupTransientWarmup();
      const finishedAt = performance.now();
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Downtown Mayhem: render warmup failed.", error);
      this.renderWarmupState = {
        ...this.renderWarmupState,
        phase: "failed",
        finishedAt,
        durationMs: finishedAt - this.renderWarmupState.startedAt,
        programs: rendererProgramCount(this.renderer),
        geometries: this.renderer.info.memory.geometries,
        frames: this.renderWarmupState.frames,
        bodyCountAfterCleanup: this.physics.getDynamicBodyCount(),
        error: message
      };
      this.status = "Renderer warmup failed; impact may stutter.";
    } finally {
      this.particles.hidePooledEffects();
      restoreFrustumCulling();
    }
  }

  private async warmResetRuntimePipelines(): Promise<void> {
    const token = this.renderWarmupToken + 1;
    this.renderWarmupToken = token;
    this.disposeRenderWarmupGroup();
    this.renderWarmupPersistentObjects.length = 0;
    const smokeMode = isSmokeWarmupMode();
    const brutalPasses = smokeMode ? 1 : RESET_WARMUP_BRUTAL_PASSES;
    const framesPerBrutalPass = smokeMode ? 2 : RESET_WARMUP_FRAMES_PER_BRUTAL_PASS;
    const syntheticPasses = smokeMode ? 1 : RESET_WARMUP_SYNTHETIC_DESTRUCTION_PASSES;
    const syntheticFrames = smokeMode ? 2 : RESET_WARMUP_SYNTHETIC_DESTRUCTION_FRAMES;
    const postCleanupEffectPasses = smokeMode ? 1 : RESET_WARMUP_POST_CLEANUP_EFFECT_PASSES;
    const postCleanupEffectFrames = smokeMode ? 2 : RESET_WARMUP_POST_CLEANUP_EFFECT_FRAMES;
    const settleFrames = smokeMode ? SMOKE_RESET_WARMUP_SETTLE_FRAMES : RESET_WARMUP_SETTLE_FRAMES;
    let group: THREE.Group | null = null;
    let warmupCameras: THREE.PerspectiveCamera[] = [];
    let restoreFrustumCulling: (() => void) | null = null;
    let frames = 0;
    let renderWarmupGroupDisposed = false;
    const startedAt = performance.now();
    const runtimeWarmupObjectIds: number[] = [];
    const runtimeFragmentPipelineWarmupObjectIds: number[] = [];
    const updateWarmupState = (): void => {
      this.renderWarmupState = {
        ...this.renderWarmupState,
        programs: rendererProgramCount(this.renderer),
        geometries: this.renderer.info.memory.geometries,
        frames,
        bodyCountAfterCleanup: this.physics.getDynamicBodyCount()
      };
    };
    const disposeWarmupGroup = (): void => {
      if (renderWarmupGroupDisposed) {
        return;
      }
      this.disposeRenderWarmupGroup();
      renderWarmupGroupDisposed = true;
    };
    const restoreWarmupFrustumCulling = (): void => {
      if (!restoreFrustumCulling) {
        return;
      }
      restoreFrustumCulling();
      restoreFrustumCulling = null;
    };
    const cleanupTransientWarmup = (preserveParticlePools = false): void => {
      this.destruction.parkFragmentVisualWarmupPreview();
      this.clearRuntimeWarmupObjects(runtimeFragmentPipelineWarmupObjectIds);
      this.clearRuntimeWarmupObjects(runtimeWarmupObjectIds);
      this.physics.clearFrozenRubbleWarmupObjects();
      this.particles.clearTransientEffects();
      if (preserveParticlePools) {
        this.particles.keepPoolPipelinesResident();
      }
      this.destruction.flushFragmentInstanceBounds();
      this.physics.flushInstancedRenderBounds();
      disposeWarmupGroup();
    };
    const renderWarmupFrame = async (): Promise<boolean> => {
      this.particles.update(RENDER_WARMUP_DELTA_SECONDS);
      this.destruction.updateVisualFragments(RENDER_WARMUP_DELTA_SECONDS);
      for (const camera of warmupCameras) {
        await renderWarmupYield();
        this.renderer.render(this.scene, camera);
        if (this.disposed || token !== this.renderWarmupToken) {
          cleanupTransientWarmup();
          return false;
        }
      }
      frames += 1;
      updateWarmupState();
      return true;
    };
    this.renderWarmupState = {
      phase: "warming",
      token,
      startedAt,
      finishedAt: null,
      durationMs: null,
      programs: rendererProgramCount(this.renderer),
      geometries: this.renderer.info.memory.geometries,
      frames: 0
    };
    this.status = "Preparing reset renderer pipelines.";
    this.options.updateLoadingStatus?.("Cleaning reset effects");
    try {
      group = this.createRenderWarmupGroup();
      this.renderWarmupGroup = group;
      warmupCameras = createRenderWarmupCameras(this.cameraRig.camera);
      runtimeWarmupObjectIds.push(...this.createRuntimeFragmentWarmupObjects());
      runtimeFragmentPipelineWarmupObjectIds.push(...this.destruction.createRuntimeFragmentPipelineWarmupObjects());
      restoreFrustumCulling = disableSceneFrustumCullingForWarmup(this.scene);
      this.particles.clearTransientEffects();
      this.destruction.clearQueuedFractures();
      this.destruction.clearVisualFragments();
      this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
      this.destruction.parkFragmentVisualWarmupPreview();
      this.particles.keepPoolPipelinesResident();
      this.destruction.flushFragmentInstanceBounds();
      this.physics.flushInstancedRenderBounds();

      this.scene.add(group);
      this.options.updateLoadingStatus?.("Preparing reset renderer pipelines");
      this.destruction.showFragmentVisualWarmupPreview();
      this.playRenderWarmupEffects(0);
      for (const camera of warmupCameras) {
        await this.renderer.compileAsync(this.scene, camera);
      }
      for (let pass = 0; pass < brutalPasses; pass += 1) {
        this.status = `Preparing reset renderer pipelines (${pass + 1}/${brutalPasses}).`;
        this.options.updateLoadingStatus?.(`Preparing reset renderer pipelines ${pass + 1}/${brutalPasses}`);
        this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
        this.destruction.showFragmentVisualWarmupPreview();
        this.playRenderWarmupEffects(pass);
        for (let frame = 0; frame < framesPerBrutalPass; frame += 1) {
          if (!(await renderWarmupFrame())) {
            return;
          }
        }
      }
      this.options.updateLoadingStatus?.("Rehearsing reset destruction");
      if (
        !(await this.runSyntheticDestructionWarmup(token, renderWarmupFrame, {
          passes: syntheticPasses,
          framesPerPass: syntheticFrames,
          fractureProcessMaxPerFrame: RESET_WARMUP_FRACTURE_PROCESS_MAX_PER_FRAME,
          fractureProcessTimeBudgetMs: RESET_WARMUP_FRACTURE_PROCESS_TIME_BUDGET_MS,
          statusPrefix: "Preparing reset renderer pipelines"
        }))
      ) {
        return;
      }

      cleanupTransientWarmup(true);
      restoreWarmupFrustumCulling();
      this.options.updateLoadingStatus?.("Settling reset renderer");
      for (let pass = 0; pass < postCleanupEffectPasses; pass += 1) {
        this.destruction.showFragmentVisualWarmupPreview();
        this.playRenderWarmupEffects(brutalPasses + pass);
        for (let frame = 0; frame < postCleanupEffectFrames; frame += 1) {
          if (!(await renderWarmupFrame())) {
            return;
          }
        }
        this.destruction.parkFragmentVisualWarmupPreview();
        this.particles.clearTransientEffects();
        this.particles.keepPoolPipelinesResident();
        this.destruction.flushFragmentInstanceBounds();
        this.physics.flushInstancedRenderBounds();
        for (const camera of warmupCameras) {
          await this.renderer.compileAsync(this.scene, camera);
        }
      }
      this.destruction.parkFragmentVisualWarmupPreview();
      this.particles.clearTransientEffects();
      this.particles.keepPoolPipelinesResident();
      this.destruction.flushFragmentInstanceBounds();
      this.physics.flushInstancedRenderBounds();
      for (let frame = 0; frame < settleFrames; frame += 1) {
        if (!(await renderWarmupFrame())) {
          return;
        }
      }
      this.destruction.parkFragmentVisualWarmupPreview();
      this.particles.clearTransientEffects();
      this.particles.hidePooledEffects();
      this.destruction.flushFragmentInstanceBounds();
      this.physics.flushInstancedRenderBounds();
      const finishedAt = performance.now();
      this.renderWarmupState = {
        ...this.renderWarmupState,
        phase: "ready",
        finishedAt,
        durationMs: finishedAt - startedAt,
        programs: rendererProgramCount(this.renderer),
        geometries: this.renderer.info.memory.geometries,
        frames,
        bodyCountAfterCleanup: this.physics.getDynamicBodyCount()
      };
      this.markCurrentLevelWarmupReady();
      if (this.runState.phase === "aim" && this.runState.shotAvailable) {
        const level = this.currentLevel();
        this.status = `${level.name}: ${level.objective}`;
      }
    } catch (error) {
      if (this.disposed || token !== this.renderWarmupToken) {
        cleanupTransientWarmup();
        return;
      }
      const finishedAt = performance.now();
      const message = error instanceof Error ? error.message : String(error);
      console.warn("Downtown Mayhem: reset render warmup failed.", error);
      this.renderWarmupState = {
        ...this.renderWarmupState,
        phase: "failed",
        finishedAt,
        durationMs: finishedAt - startedAt,
        programs: rendererProgramCount(this.renderer),
        geometries: this.renderer.info.memory.geometries,
        frames,
        bodyCountAfterCleanup: this.physics.getDynamicBodyCount(),
        error: message
      };
      this.status = "Reset renderer warmup failed; next impact may stutter.";
    } finally {
      cleanupTransientWarmup(true);
      this.particles.hidePooledEffects();
      restoreWarmupFrustumCulling();
    }
  }

  private createRenderWarmupGroup(): THREE.Group {
    const group = new THREE.Group();
    group.name = "Render pipeline warmup";
    group.frustumCulled = false;
    const fragmentMeshes: THREE.Mesh[] = [];
    const fragmentMaterials = RENDER_WARMUP_FRAGMENT_MATERIALS.map((materialId) => this.materials.getRenderMaterial(materialId));
    const runtimeFragmentMeshes = this.physics.createBoxGeometryWarmupObjects(fragmentMaterials);
    for (let index = 0; index < RENDER_WARMUP_FRAGMENT_MATERIALS.length; index += 1) {
      const materialId = RENDER_WARMUP_FRAGMENT_MATERIALS[index];
      const size = renderWarmupFragmentSize(materialId);
      const mesh = runtimeFragmentMeshes[index];
      mesh.name = `${materialId} fragment warmup`;
      mesh.position.set(index * 0.28, 0, 0);
      mesh.scale.copy(size);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      decorateFragment(mesh, { size, materialId });
      disableFrustumCulling(mesh);
      group.add(mesh);
      addInstancedWarmupVariants(group, mesh, `${materialId} fragment`);
      fragmentMeshes.push(mesh);
    }
    this.physics.createFrozenRubbleWarmupObjects(fragmentMeshes);

    for (const object of this.destruction.createFragmentVisualPoolWarmupObjects()) {
      this.scene.add(object);
    }

    for (const projectileId of Object.keys(PROJECTILES) as ProjectileId[]) {
      for (const object of this.physics.createSphereGeometryWarmupObjects([10, 16, 24, 28], this.projectiles.getRenderMaterial(projectileId))) {
        disableFrustumCulling(object);
        this.addPersistentRenderWarmupObject(group, object);
      }
    }
    for (const object of this.physics.createStaticDetailWarmupObjects()) {
      disableFrustumCulling(object);
      this.addPersistentRenderWarmupObject(group, object);
    }
    for (const object of this.physics.createSupportReleaseWarmupObjects()) {
      disableFrustumCulling(object);
      this.addPersistentRenderWarmupObject(group, object);
    }
    for (const object of this.projectiles.createWarmupObjects()) {
      disableFrustumCulling(object);
      group.add(object);
    }
    for (const object of this.particles.createWarmupObjects()) {
      disableFrustumCulling(object);
      group.add(object);
    }
    return group;
  }

  private addPersistentRenderWarmupObject(group: THREE.Group, object: THREE.Object3D): void {
    group.add(object);
    this.renderWarmupPersistentObjects.push(object);
  }

  private createRuntimeFragmentWarmupObjects(): number[] {
    const objectIds: number[] = [];
    const columns = RENDER_WARMUP_FRAGMENT_MATERIALS.length;
    for (let materialIndex = 0; materialIndex < columns; materialIndex += 1) {
      const materialId = RENDER_WARMUP_FRAGMENT_MATERIALS[materialIndex];
      const material = this.materials.get(materialId);
      for (let batch = 0; batch < RENDER_WARMUP_RUNTIME_FRAGMENT_BATCHES; batch += 1) {
        const size = renderWarmupRuntimeFragmentSize(materialId, batch);
        const rotation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(batch * 0.27, materialIndex * 0.18, (batch - materialIndex) * 0.14)
        );
        const object = this.physics.addDynamicBox({
          label: `${material.name} runtime fragment warmup`,
          material,
          renderMaterial: this.materials.getRenderMaterial(materialId),
          position: new THREE.Vector3(-2.2 + materialIndex * 0.82, 0.35 + batch * 0.22, -0.45 + batch * 0.18),
          size,
          rotation,
          destructible: batch % 3 === 0,
          canFracture: batch % 3 === 0,
          isDebris: batch % 2 === 0,
          chainSource: batch % 2 === 0,
          category: batch % 2 === 0 ? "debris" : "structure",
          scoreRole: batch % 4 === 0 ? "target" : "neutral",
          zoneId: "render-warmup-synthetic",
          scoreValue: 0,
          sleeping: true,
          stageVisualActivation: true,
          ccd: false,
          collisionEvents: false
        });
        object.mesh.castShadow = false;
        object.mesh.receiveShadow = true;
        decorateFragment(object.mesh, { size, materialId });
        disableFrustumCulling(object.mesh);
        objectIds.push(object.id);
      }
    }
    return objectIds;
  }

  private clearRuntimeWarmupObjects(objectIds: number[]): void {
    while (objectIds.length > 0) {
      const objectId = objectIds.pop();
      if (objectId !== undefined) {
        this.physics.removeObject(objectId);
      }
    }
  }

  private async runSyntheticDestructionWarmup(
    token: number,
    renderWarmupFrame: () => Promise<boolean>,
    options: SyntheticDestructionWarmupOptions = {}
  ): Promise<boolean> {
    const passes = options.passes ?? RENDER_WARMUP_SYNTHETIC_DESTRUCTION_PASSES;
    const framesPerPass = options.framesPerPass ?? RENDER_WARMUP_FRAMES_PER_BRUTAL_PASS;
    const fractureProcessMaxPerFrame = options.fractureProcessMaxPerFrame ?? 24;
    const fractureProcessTimeBudgetMs = options.fractureProcessTimeBudgetMs ?? 8;
    const statusPrefix = options.statusPrefix ?? "Preparing renderer pipelines before impact";
    const objectIds = this.createSyntheticDestructionWarmupObjects();
    try {
      for (let pass = 0; pass < passes; pass += 1) {
        this.status = `${statusPrefix} (destruction ${pass + 1}/${passes}).`;
        const origin = RENDER_WARMUP_SYNTHETIC_ORIGIN.clone().add(new THREE.Vector3(pass * 1.35, pass * 0.16, -pass * 0.95));
        const projectileId = (Object.keys(PROJECTILES) as ProjectileId[])[pass % Object.keys(PROJECTILES).length];
        const hitMaterialId = RENDER_WARMUP_FRAGMENT_MATERIALS[pass % RENDER_WARMUP_FRAGMENT_MATERIALS.length];
        const result = this.destruction.explode(origin, 58 + pass * 9, 8.8 + pass * 0.85);
        this.explosion.play(origin, 8.6 + pass * 0.9, result.dustColors, {
          projectileId,
          result,
          powerScale: 2.35,
          sizeScale: 1.85,
          hitMaterialId,
          impactDirection: new THREE.Vector3(0.4 + pass * 0.12, 0.22, -1).normalize(),
          role: pass === 0 ? "primary" : "secondary"
        });
        this.particles.cityDebrisSpray(origin.clone().add(new THREE.Vector3(0.25, 0.08, 0)), result.dustColors, 2.6);
        this.particles.fireBurst(origin.clone().add(new THREE.Vector3(0.55, 0.1, -0.35)), 2.05);
        this.particles.spark(origin.clone().add(new THREE.Vector3(-0.45, 0.12, 0.18)), 0xffd25c, 2.4);
        for (let frame = 0; frame < framesPerPass; frame += 1) {
          this.destruction.processQueuedFractures(fractureProcessMaxPerFrame, fractureProcessTimeBudgetMs);
          this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
          if (!(await renderWarmupFrame())) {
            return false;
          }
          if (this.disposed || token !== this.renderWarmupToken) {
            return false;
          }
        }
      }
      while (this.destruction.getQueuedFractureCount() > 0) {
        this.destruction.processQueuedFractures(fractureProcessMaxPerFrame, fractureProcessTimeBudgetMs);
        this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
        if (!(await renderWarmupFrame())) {
          return false;
        }
        if (this.disposed || token !== this.renderWarmupToken) {
          return false;
        }
      }
      this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
      return true;
    } finally {
      this.clearRuntimeWarmupObjects(objectIds);
      this.clearSyntheticDestructionWarmupObjects();
    }
  }

  private createSyntheticDestructionWarmupObjects(): number[] {
    const objectIds: number[] = [];
    for (let materialIndex = 0; materialIndex < RENDER_WARMUP_FRAGMENT_MATERIALS.length; materialIndex += 1) {
      const materialId = RENDER_WARMUP_FRAGMENT_MATERIALS[materialIndex];
      const material = this.materials.get(materialId);
      const renderMaterial = this.materials.getRenderMaterial(materialId);
      for (let index = 0; index < RENDER_WARMUP_SYNTHETIC_OBJECTS_PER_MATERIAL; index += 1) {
        const size = renderWarmupRuntimeFragmentSize(materialId, index).multiplyScalar(1.65 + (index % 3) * 0.34);
        const position = RENDER_WARMUP_SYNTHETIC_ORIGIN.clone().add(
          new THREE.Vector3(
            (materialIndex - 2.5) * 1.05 + (index % 2) * 0.28,
            0.18 + Math.floor(index / 2) * 0.58,
            (index - (RENDER_WARMUP_SYNTHETIC_OBJECTS_PER_MATERIAL - 1) * 0.5) * 0.48
          )
        );
        const rotation = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(index * 0.22, materialIndex * 0.33 + index * 0.08, (index - materialIndex) * 0.17)
        );
        const object = this.physics.addDynamicBox({
          label: `${material.name} synthetic destruction warmup`,
          material,
          renderMaterial,
          position,
          size,
          rotation,
          destructible: true,
          canFracture: true,
          isDebris: false,
          chainSource: true,
          category: "structure",
          scoreRole: index % 3 === 0 ? "target" : "neutral",
          zoneId: RENDER_WARMUP_SYNTHETIC_DESTRUCTION_ZONE,
          scoreValue: 0,
          bodyType: "fixed"
        });
        decorateFragment(object.mesh, { size, materialId });
        disableFrustumCulling(object.mesh);
        objectIds.push(object.id);
      }
    }
    return objectIds;
  }

  private clearSyntheticDestructionWarmupObjects(): void {
    const warmupObjectIds = Array.from(this.physics.objects.values())
      .filter((object) => object.zoneId === RENDER_WARMUP_SYNTHETIC_DESTRUCTION_ZONE)
      .map((object) => object.id);
    for (const objectId of warmupObjectIds) {
      this.physics.removeObject(objectId);
    }
    this.destruction.clearQueuedFractures();
    this.destruction.clearVisualFragments();
    this.physics.clearFrozenRubbleWarmupObjects();
  }

  private playRenderWarmupEffects(pass = 0): void {
    const dustColors = [new THREE.Color(0xa49f94), new THREE.Color(0xd8fbff), new THREE.Color(0xffb36a)];
    const direction = new THREE.Vector3(0.2 + pass * 0.05, 0.18, -1).normalize();
    const materialIds: readonly MaterialId[] = ["glass", "metal", "concrete", "wood", "foam", "rubber"];
    const projectileIds = Object.keys(PROJECTILES) as ProjectileId[];

    this.particles.warmupAllRuntimeFxProfiles(pass);

    for (let index = 0; index < projectileIds.length; index += 1) {
      const projectileId = projectileIds[index];
      const origin = new THREE.Vector3((index - 2) * 0.55, 0.12, 0);
      this.particles.explode(origin, PROJECTILES[projectileId].blastRadius, dustColors, {
        projectileId,
        hitMaterialId: materialIds[index % materialIds.length],
        impactDirection: direction,
        powerScale: 1.8,
        sizeScale: 1.35,
        role: "primary"
      });
    }

    for (let index = 0; index < materialIds.length; index += 1) {
      const materialId = materialIds[index];
      const origin = new THREE.Vector3((index - 2.5) * 0.42, 0.32, -0.55);
      this.particles.explode(origin, 3.2, dustColors, {
        hitMaterialId: materialId,
        impactDirection: direction,
        powerScale: 1.35,
        sizeScale: 1.1,
        role: "secondary"
      });
    }

    this.particles.muzzleFlash(new THREE.Vector3(0, 0.22, 0.55), PROJECTILES.slug.color);
    this.particles.cityDebrisSpray(new THREE.Vector3(-0.8, 0.1, -0.35), dustColors, 2.2);
    this.particles.fireBurst(new THREE.Vector3(0.65, 0.1, -0.25), 1.8);
    this.particles.fireLick(new THREE.Vector3(1.0, 0.1, -0.25), 1.2);
    this.particles.armingPulse(new THREE.Vector3(-1.0, 0.1, -0.25), 1.2, 0xff9a42);
    this.particles.spark(new THREE.Vector3(0.1, 0.1, -0.75), 0xffd25c, 2.1);
  }

  private disposeRenderWarmupGroup(): void {
    const group = this.renderWarmupGroup;
    if (!group) {
      return;
    }
    group.parent?.remove(group);
    this.disposeRenderWarmupOwnedResources(group);
    this.renderWarmupGroup = null;
    this.renderWarmupPersistentObjects.length = 0;
  }

  private disposeRenderWarmupOwnedResources(root: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root.traverse((object) => {
      const renderable = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      if (renderable.geometry?.userData.renderWarmupOwned === true) {
        geometries.add(renderable.geometry);
      }
      if (renderable.material) {
        const objectMaterials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        for (const material of objectMaterials) {
          if (material.userData.renderWarmupOwned === true) {
            materials.add(material);
          }
        }
      }
    });
    for (const geometry of geometries) {
      geometry.dispose();
    }
    for (const material of materials) {
      material.dispose();
    }
    root.clear();
  }

  private aim(pointer: THREE.Vector2): void {
    if (this.ui.isGameplayBlocked() || this.levelReloadInProgress) {
      return;
    }
    if (this.runState.phase === "aim") {
      this.aimRaycaster.setFromCamera(pointer, this.cameraRig.camera);
      if (this.pickAimSurface()) {
        this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
      } else if (this.aimRaycaster.ray.intersectPlane(this.groundPlane, this.aimPoint)) {
        this.aimPoint.y = 0.16;
        this.aimMarkerPoint.set(this.aimPoint.x, AIM_FALLBACK_SURFACE_Y, this.aimPoint.z);
        this.aimSurfaceNormal.copy(AIM_SURFACE_NORMAL);
        this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
      } else {
        this.aimSurfaceNormal.copy(AIM_SURFACE_NORMAL);
        this.cannon.aim(pointer);
      }
    }
  }

  private pickAimSurface(): boolean {
    this.refreshAimSurfaceTargets();
    this.aimVisibleSurfaceTargets.length = 0;
    for (const target of this.aimSurfaceTargets) {
      if (target.visible) {
        this.aimVisibleSurfaceTargets.push(target);
      }
    }
    if (this.aimVisibleSurfaceTargets.length === 0) {
      return false;
    }

    this.aimSurfaceHits.length = 0;
    this.aimRaycaster.intersectObjects(this.aimVisibleSurfaceTargets, false, this.aimSurfaceHits);
    const hit = this.aimSurfaceHits[0];
    if (!hit) {
      return false;
    }

    this.aimPoint.copy(hit.point);
    this.aimMarkerPoint.copy(hit.point);
    if (hit.face) {
      this.aimSurfaceNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
      if (this.aimSurfaceNormal.dot(this.aimRaycaster.ray.direction) > 0) {
        this.aimSurfaceNormal.negate();
      }
    } else {
      this.aimSurfaceNormal.copy(AIM_SURFACE_NORMAL);
    }
    return true;
  }

  private refreshAimSurfaceTargets(): void {
    if (!this.aimSurfaceTargetsDirty) {
      return;
    }
    this.aimSurfaceTargets.length = 0;
    for (const object of this.physics.objects.values()) {
      if (object.category === "projectile" || object.isDebris || object.zoneId === "surface") {
        continue;
      }
      this.aimSurfaceTargets.push(object.mesh);
    }
    for (const mesh of this.physics.staticMeshes) {
      this.aimSurfaceTargets.push(mesh);
    }
    this.aimSurfaceTargetsDirty = false;
  }

  private invalidateAimSurfaceTargets(): void {
    this.aimSurfaceTargetsDirty = true;
    this.aimSurfaceTargets.length = 0;
    this.aimVisibleSurfaceTargets.length = 0;
    this.aimSurfaceHits.length = 0;
  }

  private fire(): void {
    if (this.ui.isGameplayBlocked() || this.levelReloadInProgress) {
      return;
    }
    if (this.renderWarmupState.phase === "warming") {
      this.status = "Renderer preparing impact shaders. Fire is armed in a moment.";
      this.audio.playUiReject();
      return;
    }
    if (!this.runState.shotAvailable || this.runState.phase !== "aim") {
      return;
    }
    if (perfMonitor.isEnabled()) {
      perfMonitor.clear();
      this.perfDiskLogger?.flush("shot-start");
    }
    const projectile = PROJECTILES[this.selectedProjectile];
    const muzzle = this.cannon.getMuzzlePosition();
    const direction = this.cannon.getDirection();
    const launchPosition = this.cannon.getLaunchPosition(projectile.baseRadius * this.sizeScale);
    this.clearProjectileSpectacleFocus();
    this.projectiles.launch(this.selectedProjectile, launchPosition, direction, this.sizeScale, this.powerScale);
    this.scoreTracker.beginShot(projectile);
    this.cannon.fireKick(this.powerScale, this.sizeScale);
    this.audio.playCannonFire(projectile.id, this.powerScale, this.sizeScale);
    this.particles.muzzleFlash(muzzle, projectile.color);
    this.cameraRig.shake(projectile.id === "gravity" ? 0.36 : 0.24, 0.48);
    this.runState.beginFlight();
    this.status = `${projectile.name} fired from the high battery.`;
  }

  private openMainMenu(): void {
    if (this.options.onMainMenu) {
      this.options.onMainMenu();
      return;
    }
    this.ui.showHomeScreen();
  }

  private finishRun(): void {
    if (this.ui.isGameplayBlocked() || this.runState.phase !== "spectacle" || this.runState.score) {
      return;
    }
    this.finalizeScore("Score locked manually.");
  }

  private finalizeScore(statusPrefix = ""): void {
    if (this.runState.phase !== "spectacle" || this.runState.score) {
      return;
    }
    const score = this.scoreTracker.finalize(this.physics);
    this.runState.markScored(score);
    const recorded = recordArcadeRun(this.arcadeProgress, ARCADE_LEVELS, this.currentLevel().id, score);
    this.arcadeProgress = recorded.progress;
    this.arcadeResult = recorded.result;
    saveArcadeProgress(this.arcadeProgress);
    this.audio.playScoreCeremony(score.totalScore, recorded.result.stars, recorded.result.completed);
    this.status = `${statusPrefix}${statusPrefix ? " " : ""}${scoreStatus(score, recorded.result)}`;
    this.perfDiskLogger?.flush("score-finalized");
  }

  private detectImpact(active: ActiveProjectile): { point: THREE.Vector3; object: PhysicsObject | null } | null {
    const translation = active.object.body.translation();
    const current = this.projectileCurrentPosition.set(translation.x, translation.y, translation.z);
    const previous = this.projectilePreviousPosition.copy(active.previousPosition);

    if (
      current.y < 0.18 ||
      current.x < IMPACT_BOUNDS.minX ||
      current.x > IMPACT_BOUNDS.maxX ||
      current.z < IMPACT_BOUNDS.minZ ||
      current.z > IMPACT_BOUNDS.maxZ
    ) {
      active.previousPosition.copy(current);
      return { point: current.clone(), object: null };
    }

    let best: { point: THREE.Vector3; object: PhysicsObject; distance: number } | null = null;
    for (const object of this.physics.getSegmentCandidatesInto(this.projectileSegmentCandidates, previous, current, active.radius + 0.28)) {
      if (
        object.id === active.object.id ||
        active.piercedObjectIds.has(object.id) ||
        object.category === "projectile" ||
        object.isDebris ||
        object.zoneId === "surface"
      ) {
        continue;
      }
      const candidate = projectileImpactCandidate(active, object, previous, current);
      if (candidate && (!best || candidate.distance < best.distance)) {
        best = candidate;
      }
    }

    active.previousPosition.copy(current);
    return best ? { point: best.point, object: best.object } : null;
  }

  private handleImpact(point: THREE.Vector3, active: ActiveProjectile, hitObject: PhysicsObject | null): void {
    const projectile = active.definition;
    const direction = active.object.body.linvel();
    const directionVector = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    if (hitObject && this.shouldProjectilePenetrate(active, hitObject)) {
      this.handleProjectilePenetration(point, active, hitObject, directionVector);
      return;
    }

    if (hitObject && !hitObject.canFracture) {
      const directImpulse = directionVector
        .clone()
        .multiplyScalar(projectile.impulse * active.powerScale * 0.22 / Math.max(0.8, this.materials.get(hitObject.materialId).massFactor));
      hitObject.body.applyImpulse({ x: directImpulse.x, y: directImpulse.y, z: directImpulse.z }, true);
      hitObject.body.applyTorqueImpulse({ x: directImpulse.z * 0.06, y: directImpulse.x * 0.06, z: directImpulse.y * 0.06 }, true);
    }

    const directResult =
      hitObject && hitObject.destructible
        ? this.destruction.impact(active.object, hitObject, point, speedOf(active.object) * directImpactScale(projectile.id))
        : null;
    this.projectiles.removeActive();
    if (projectile.id === "gravity") {
      const scoreEvents = directResult ? this.applyExplosionResult(directResult, 0, 0) : [];
      if (scoreEvents.length > 0) {
        this.scorePopups.push(scoreEvents);
      }
      if (directResult) {
        this.markProjectileSpectacleFocus(point, directResult);
        this.focusSpectacleOn(point, directResult, 120, true);
        if (directResult.dustColors.length > 0) {
          this.particles.cityDebrisSpray(point, directResult.dustColors, 0.8 + directResult.fracturedBodies * 0.08);
        }
      } else {
        this.focusProjectileSpectacle(point);
      }
      this.particles.spark(point, projectile.color, 1.35 * active.sizeScale * active.powerScale);
      this.audio.playGravityCrush(point, active.sizeScale * active.powerScale);
      this.cameraRig.shake(0.58, 0.72);
      this.hitStopTimer = this.settings.motionEffects ? 0.075 : 0;
      this.slowMotionTimer = this.settings.motionEffects ? 0.42 : 0;
      this.runState.beginSpectacle(performance.now());
      this.status = directResult
        ? `${projectile.name} impact: ${directResult.fracturedBodies} direct fractures, no blast.`
        : `${projectile.name} spent its velocity without detonating.`;
      return;
    }

    const strength = projectile.impulse * active.powerScale * projectile.fractureBoost * residualBlastScale(projectile.id);
    const radius = projectile.blastRadius * active.sizeScale * residualBlastRadiusScale(projectile.id);
    const visualRadius = projectile.blastRadius * active.sizeScale * impactVisualRadiusScale(projectile.id);
    const result = this.destruction.explode(point, strength, radius);
    this.audio.playProjectileImpact({
      point,
      projectileId: projectile.id,
      result,
      powerScale: active.powerScale,
      sizeScale: active.sizeScale,
      hitMaterialId: hitObject?.materialId
    });
    this.focusSpectacleOn(point, result, 160, true);
    const scoreEvents = [
      ...(directResult ? this.applyExplosionResult(directResult, 0, projectile.id === "ignite" ? 1 : 0) : []),
      ...this.applyExplosionResult(result, 0, projectile.id === "ignite" ? 1.35 : projectile.id === "pulse" ? 0.35 : 0),
      ...this.playProjectileSpecial(projectile.id, point, directionVector, active)
    ];
    this.scorePopups.push(scoreEvents);

    this.explosion.play(point, visualRadius, result.dustColors, {
      projectileId: projectile.id,
      result,
      powerScale: active.powerScale,
      sizeScale: active.sizeScale,
      hitMaterialId: hitObject?.materialId,
      impactDirection: directionVector,
      role: "primary"
    });
    this.particles.cityDebrisSpray(point, result.dustColors, 1 + result.fracturedBodies * 0.085);
    this.cameraRig.shake(0.52, 0.92);
    this.hitStopTimer = this.settings.motionEffects ? 0.065 : 0;
    this.slowMotionTimer = this.settings.motionEffects ? 0.58 : 0;
    this.runState.beginSpectacle(performance.now());
    this.status = `${projectile.name} impact: ${(directResult?.fracturedBodies ?? 0) + result.fracturedBodies} fractures, ${result.affectedBodies} objects hit.`;
  }

  private focusSpectacleOn(point: THREE.Vector3, result: ExplosionResult, bonus = 0, force = false): void {
    const now = performance.now();
    const focusScore = explosionFocusScore(result) + bonus;
    const focusAge = now - this.spectacleFocusUpdatedAt;
    const decayedScore = this.spectacleFocusScore * Math.exp(-Math.max(0, focusAge) / CAMERA_FOCUS_DECAY_MS);
    if (!force && focusScore < CAMERA_FOCUS_MIN_SCORE) {
      this.spectacleFocusScore = decayedScore;
      return;
    }

    const isMajorUpgrade = focusScore >= decayedScore * 1.45 + 140;
    const isSettledUpgrade = focusAge >= CAMERA_FOCUS_LOCK_MS && focusScore >= decayedScore * 0.92 + 50;
    const canRetarget = force || isMajorUpgrade || isSettledUpgrade;
    if (!canRetarget) {
      this.spectacleFocusScore = decayedScore;
      return;
    }

    const focus = point.clone();
    focus.y = Math.max(0.8, Math.min(3.6, focus.y + result.fracturedBodies * 0.025));
    this.spectacleFocusScore = focusScore;
    this.spectacleFocusUpdatedAt = now;
    this.cameraRig.spectacle(focus);
  }

  private markProjectileSpectacleFocus(point: THREE.Vector3, result: ExplosionResult): void {
    this.projectileSpectacleFocus.copy(point);
    this.projectileSpectacleFocus.y = Math.max(0.8, Math.min(3.6, point.y + result.fracturedBodies * 0.025));
    this.hasProjectileSpectacleFocus = true;
  }

  private clearProjectileSpectacleFocus(): void {
    this.hasProjectileSpectacleFocus = false;
    this.projectileSpectacleFocus.set(0, 0, 0);
  }

  private focusProjectileSpectacle(fallback: THREE.Vector3): void {
    const focus = this.hasProjectileSpectacleFocus ? this.projectileSpectacleFocus.clone() : fallback.clone();
    focus.y = THREE.MathUtils.clamp(focus.y + 0.28, 0.9, 3.6);
    this.cameraRig.spectacle(focus);
  }

  private shouldReleaseProjectileCamera(active: ActiveProjectile, position: THREE.Vector3, velocity: THREE.Vector3): boolean {
    if (active.definition.id !== "gravity" || active.piercedObjectIds.size === 0) {
      return false;
    }
    const releaseSpeed = HEAVY_PROJECTILE_CAMERA_RELEASE_SPEED * Math.max(0.85, active.powerScale);
    if (velocity.lengthSq() <= releaseSpeed * releaseSpeed) {
      return true;
    }
    const rollingHeight = Math.max(0.68, active.radius * 1.9);
    if (position.y <= rollingHeight && active.age >= 1.25) {
      return true;
    }
    return active.age >= HEAVY_PROJECTILE_CAMERA_RELEASE_AGE;
  }

  private shouldReleaseHeavyProjectileAfterPenetration(active: ActiveProjectile, retainedSpeed: number): boolean {
    if (active.definition.id !== "gravity") {
      return false;
    }
    const releaseSpeed = HEAVY_PROJECTILE_CAMERA_RELEASE_SPEED * Math.max(0.85, active.powerScale);
    if (active.piercedObjectIds.size >= 2 && retainedSpeed <= releaseSpeed) {
      return true;
    }
    if (active.piercedObjectIds.size >= 4) {
      return true;
    }
    return active.age >= HEAVY_PROJECTILE_CAMERA_RELEASE_AGE && retainedSpeed <= releaseSpeed * 1.45;
  }

  private releaseProjectileCameraToSpectacle(fallback: THREE.Vector3): void {
    this.focusProjectileSpectacle(fallback);
    this.projectiles.releaseActive();
    this.runState.beginSpectacle(performance.now());
    this.status = `${PROJECTILES.gravity.name} spent its momentum; watching the damage unfold.`;
  }

  private shouldProjectilePenetrate(active: ActiveProjectile, hitObject: PhysicsObject): boolean {
    if (!hitObject.destructible || !hitObject.canFracture) {
      return false;
    }
    if (active.piercedObjectIds.size >= MAX_PROJECTILE_PENETRATIONS[active.definition.id]) {
      return false;
    }
    if (active.definition.id !== "gravity") {
      return false;
    }
    return hitObject.materialId !== "rubber" || Math.max(hitObject.dimensions.x, hitObject.dimensions.z) <= 1.2;
  }

  private handleProjectilePenetration(
    point: THREE.Vector3,
    active: ActiveProjectile,
    hitObject: PhysicsObject,
    direction: THREE.Vector3
  ): void {
    active.piercedObjectIds.add(hitObject.id);
    const speed = speedOf(active.object);
    const impactSpeed = speed * penetrationImpactScale(active.definition.id, hitObject);
    const result = this.destruction.impact(active.object, hitObject, point, impactSpeed);
    if (active.definition.id === "gravity" && result.fracturedBodies > 0) {
      this.markProjectileSpectacleFocus(point, result);
    }
    const scoreEvents = this.applyExplosionResult(result, 0, active.definition.id === "ignite" ? 0.9 : 0);
    if (scoreEvents.length > 0) {
      this.scorePopups.push(scoreEvents);
    }

    if (result.dustColors.length > 0) {
      this.particles.cityDebrisSpray(point, result.dustColors, 0.42 + result.fracturedBodies * 0.08);
    }
    this.particles.spark(point, hitObject.materialId === "glass" ? 0xb6fbff : active.definition.color, 0.55);
    this.audio.playChainImpact({
      point,
      result,
      relativeSpeed: impactSpeed,
      materialId: hitObject.materialId
    });

    const retainedSpeed = speed * penetrationRetainedSpeed(active.definition.id, hitObject);
    const nextPosition = point.clone().add(direction.clone().multiplyScalar(active.radius + 0.34));
    const nextVelocity = direction.clone().multiplyScalar(retainedSpeed);
    active.object.body.setTranslation({ x: nextPosition.x, y: nextPosition.y, z: nextPosition.z }, true);
    active.object.body.setLinvel({ x: nextVelocity.x, y: nextVelocity.y, z: nextVelocity.z }, true);
    active.previousPosition.copy(nextPosition);
    this.cameraRig.shake(active.definition.id === "gravity" ? 0.18 : 0.1, 0.22);
    if (result.fracturedBodies > 0 && this.shouldReleaseHeavyProjectileAfterPenetration(active, retainedSpeed)) {
      this.focusSpectacleOn(point, result, 130, true);
      this.projectiles.releaseActive();
      this.runState.beginSpectacle(performance.now());
      this.status = `${active.definition.name} punched through; watching the collapse.`;
      return;
    }
    this.status =
      hitObject.materialId === "glass"
        ? `${active.definition.name} shattered glass and kept going.`
        : `${active.definition.name} pierced ${hitObject.materialId}; continuing through the block.`;
  }

  private playProjectileSpecial(
    projectileId: ProjectileId,
    point: THREE.Vector3,
    direction: THREE.Vector3,
    active: ActiveProjectile
  ): ScoreEvent[] {
    if (projectileId === "scatter") {
      this.spawnScatterFragments(point, direction, active.sizeScale);
      this.audio.playScatterBurst(point, active.sizeScale * active.powerScale);
      return this.spawnScatterClusterBlasts(point, direction, active);
    }
    if (projectileId === "ignite") {
      const ignition = this.destruction.explode(point.clone().add(new THREE.Vector3(0, 0.12, 0)), 18 * active.powerScale, 2.35 * active.sizeScale);
      this.particles.fireBurst(point, 1.35 * active.sizeScale * active.powerScale);
      this.audio.playProjectileImpact({
        point,
        projectileId,
        result: ignition,
        powerScale: active.powerScale,
        sizeScale: active.sizeScale,
        hitMaterialId: "rubber"
      });
      return this.applyExplosionResult(ignition, 0, 1.2);
    }
    return [];
  }

  private applyExplosionResult(result: ExplosionResult, cascadeDepth = 0, igniteBias = 0): ScoreEvent[] {
    const events = this.scoreTracker.addExplosion(result);
    this.queueIgnitions(result, igniteBias, cascadeDepth);
    if (cascadeDepth < 2) {
      events.push(...this.triggerVolatileHazards(result, cascadeDepth));
    }
    return events;
  }

  private triggerVolatileHazards(result: ExplosionResult, cascadeDepth: number): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    const triggerLimit = VOLATILE_TRIGGER_LIMIT_BY_DEPTH[cascadeDepth] ?? 0;
    if (triggerLimit <= 0) {
      return events;
    }

    const candidates = result.affectedObjects
      .filter((object) => object.fractured && !this.triggeredHazards.has(object.id) && isVolatileHazard(object))
      .sort(sortVolatileHazards)
      .slice(0, triggerLimit);

    for (const object of candidates) {
      this.triggeredHazards.add(object.id);
      const origin = object.position.clone().add(new THREE.Vector3(0, 0.22, 0));
      const profile = volatileHazardProfile(object);
      const secondary = this.destruction.explode(origin, profile.strength, profile.radius);
      this.focusSpectacleOn(origin, secondary, hazardCameraFocusBonus(object));
      this.explosion.play(origin, profile.radius * 1.35, secondary.dustColors, {
        projectileId: profile.projectileId,
        result: secondary,
        powerScale: profile.powerScale,
        sizeScale: profile.sizeScale,
        densityScale: 0.66,
        hitMaterialId: object.materialId,
        role: "secondary"
      });
      this.particles.spark(origin, profile.color, profile.projectileId === "ignite" ? 2.1 : 1.7);
      if (secondary.dustColors.length > 0) {
        this.particles.cityDebrisSpray(origin, secondary.dustColors, 0.3 + secondary.fracturedBodies * 0.045);
      }
      this.audio.playProjectileImpact({
        point: origin,
        projectileId: profile.projectileId,
        result: secondary,
        powerScale: profile.powerScale,
        sizeScale: profile.sizeScale,
        hitMaterialId: object.materialId
      });
      events.push(...this.scoreTracker.addChainReaction(Math.max(70, Math.round(secondary.materialChaos * 0.35)), origin, hazardExplosionLabel(object)));
      events.push(...this.applyExplosionResult(secondary, cascadeDepth + 1));
    }
    return events;
  }

  private queueIgnitions(result: ExplosionResult, igniteBias: number, cascadeDepth: number): void {
    if (igniteBias <= 0 && cascadeDepth > 0) {
      return;
    }
    const now = performance.now();
    for (const object of result.affectedObjects) {
      if (this.burningHazards.size >= MAX_BURNING_HAZARDS) {
        return;
      }
      if (this.burningHazards.has(object.id) || !canIgniteObject(object)) {
        continue;
      }
      if (object.fractured) {
        continue;
      }
      const sourceObject = this.physics.getObject(object.id);
      if (!sourceObject) {
        continue;
      }
      const energyRatio = object.energy / Math.max(1, object.scoreValue * 0.42);
      const ignitionChance = THREE.MathUtils.clamp(igniteBias * 0.58 + energyRatio * 0.08, 0, 0.92);
      if (igniteBias < 0.2) {
        continue;
      }
      if (igniteBias < 0.95 && Math.random() > ignitionChance) {
        continue;
      }
      const delay = THREE.MathUtils.lerp(FIRE_MAX_DELAY_MS, FIRE_MIN_DELAY_MS, THREE.MathUtils.clamp(igniteBias + energyRatio * 0.18, 0, 1));
      const radius = object.zoneId?.includes("power-grid") ? 2.15 : object.materialId === "foam" ? 2.65 : 2.35;
      const strength = object.materialId === "wood" || object.materialId === "foam" ? 18 : 14;
      const origin = ignitionOriginForObject(sourceObject);
      this.burningHazards.set(object.id, {
        id: object.id,
        label: ignitionExplosionLabel(object),
        origin,
        explodeAt: now + delay + Math.random() * 320,
        nextFxAt: now,
        strength,
        radius,
        materialId: object.materialId
      });
      this.particles.fireBurst(origin, 0.72 + igniteBias * 0.45);
    }
  }

  private updateBurningHazards(): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    if (this.burningHazards.size === 0 || this.runState.phase === "aim" || this.runState.score) {
      return events;
    }
    const now = performance.now();
    let detonationsThisFrame = 0;
    for (const hazard of this.burningHazards.values()) {
      const sourceObject = this.physics.getObject(hazard.id);
      if (!sourceObject) {
        this.burningHazards.delete(hazard.id);
        continue;
      }
      hazard.origin.copy(ignitionOriginForObject(sourceObject));
      const remainingMs = hazard.explodeAt - now;
      if (now >= hazard.nextFxAt) {
        this.particles.fireLick(hazard.origin, 0.62);
        if (remainingMs < 820) {
          this.particles.armingPulse(hazard.origin, 1 - Math.max(0, remainingMs) / 820, ignitionWarningColor(hazard));
        }
        hazard.nextFxAt = now + (remainingMs < 820 ? 110 : 180);
      }
      if (now < hazard.explodeAt) {
        continue;
      }
      if (detonationsThisFrame >= HAZARD_EXPLOSIONS_MAX_PER_FRAME) {
        perfMonitor.addCount("hazard.explosionBacklog");
        continue;
      }
      detonationsThisFrame += 1;
      this.burningHazards.delete(hazard.id);
      const result = this.destruction.explode(hazard.origin, hazard.strength, hazard.radius);
      this.focusSpectacleOn(hazard.origin, result, 145);
      this.explosion.play(hazard.origin, hazard.radius * 1.24, result.dustColors, {
        projectileId: "ignite",
        result,
        powerScale: 0.76,
        sizeScale: 0.82,
        densityScale: 0.62,
        hitMaterialId: hazard.materialId,
        role: "ignition"
      });
      this.particles.fireBurst(hazard.origin, 1.25);
      this.audio.playProjectileImpact({
        point: hazard.origin,
        projectileId: "ignite",
        result,
        powerScale: 0.76,
        sizeScale: 0.82,
        hitMaterialId: hazard.materialId
      });
      events.push(...this.scoreTracker.addChainReaction(Math.max(58, Math.round((result.materialChaos + result.structureDamage) * 0.28)), hazard.origin, hazard.label));
      events.push(...this.applyExplosionResult(result, 1, 0.18));
    }
    return events;
  }

  private processDebrisImpacts(): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    if (this.runState.phase === "aim" || this.runState.score) {
      this.physics.drainCollisionEventsInto(() => undefined);
      this.physics.drainSurfaceCollisionEventsInto(() => undefined);
      return events;
    }
    const activeProjectile = this.runState.phase === "flight" ? this.projectiles.getActive() : null;

    const now = performance.now();
    if (now >= this.nextChainCooldownSweep) {
      for (const [key, expiresAt] of this.chainImpactCooldowns) {
        if (expiresAt <= now) {
          this.chainImpactCooldowns.delete(key);
        }
      }
      this.nextChainCooldownSweep = now + CHAIN_IMPACT_SWEEP_MS;
    }

    let impactsThisFrame = 0;
    let impactVfxThisFrame = 0;
    let projectileImpactHandled = false;
    const chainCollisionsDrained = this.physics.drainCollisionEventsInto((collision) => {
      if (projectileImpactHandled || impactsThisFrame >= CHAIN_IMPACT_MAX_PER_FRAME) {
        return;
      }
      if (!collision.started) {
        return;
      }
      if (activeProjectile) {
        const projectileTarget = projectileCollisionTarget(activeProjectile, collision);
        if (projectileTarget) {
          const current = setVectorFromRapier(this.projectileCurrentPosition, activeProjectile.object.body.translation());
          const previous = this.projectilePreviousPosition.copy(activeProjectile.previousPosition);
          const candidate = projectileImpactCandidate(activeProjectile, projectileTarget, previous, current);
          this.handleImpact(candidate?.point ?? closestPointOnObject(projectileTarget, current), activeProjectile, projectileTarget);
          projectileImpactHandled = true;
          return;
        }
      }
      const pair = chainCollisionPair(collision.first, collision.second);
      if (!pair) {
        return;
      }
      const { source, target } = pair;
      if (!this.physics.getObject(source.id) || !this.physics.getObject(target.id)) {
        return;
      }
      const sourcePosition = setVectorFromRapier(this.chainSourcePosition, source.body.translation());
      const targetPosition = setVectorFromRapier(this.chainTargetPosition, target.body.translation());
      const relativeVelocity = impactVelocityAtTargetInto(
        this.chainRelativeVelocity,
        this.chainImpactLever,
        source,
        target,
        sourcePosition,
        targetPosition
      );
      const relativeSpeedSq = velocityLengthSq(relativeVelocity);
      if (relativeSpeedSq < CHAIN_DEBRIS_MIN_SPEED * CHAIN_DEBRIS_MIN_SPEED) {
        return;
      }
      const towardTarget = this.chainTowardTarget.copy(targetPosition).sub(sourcePosition);
      if (
        towardTarget.lengthSq() > 0.0001 &&
        relativeVelocity.x * towardTarget.x + relativeVelocity.y * towardTarget.y + relativeVelocity.z * towardTarget.z <= 0
      ) {
        return;
      }

      const pairKey = `${source.id}:${target.id}`;
      if ((this.chainImpactCooldowns.get(pairKey) ?? 0) > now) {
        return;
      }
      this.chainImpactCooldowns.set(pairKey, now + CHAIN_IMPACT_COOLDOWN_MS);

      const origin = this.chainImpactOrigin.copy(sourcePosition).lerp(targetPosition, 0.5);
      const relativeSpeed = Math.sqrt(relativeSpeedSq);
      const result = this.destruction.impact(source, target, origin, relativeSpeed);
      const damaged = result.affectedObjects[0];
      if (!damaged?.fractured) {
        return;
      }

      this.audio.playChainImpact({
        point: origin,
        result,
        relativeSpeed,
        materialId: damaged.materialId
      });
      events.push(...this.applyExplosionResult(result));
      const points = Math.max(45, Math.round(damaged.weightedDamage * 0.85 + relativeSpeed * 8));
      events.push(...this.scoreTracker.addChainReaction(points, damaged.position, chainImpactLabel(damaged)));
      if (impactVfxThisFrame < CHAIN_IMPACT_VFX_MAX_PER_FRAME) {
        this.particles.spark(origin, 0xffd25c, Math.min(1.4, 0.55 + relativeSpeed * 0.045));
        if (result.dustColors.length > 0) {
          this.particles.cityDebrisSpray(origin, result.dustColors, 0.35 + result.fracturedBodies * 0.04);
        }
        impactVfxThisFrame += 1;
      } else {
        perfMonitor.addCount("vfx.chainImpactSuppressed");
      }
      impactsThisFrame += 1;
    }, CHAIN_COLLISION_DRAIN_MAX_PER_FRAME);
    perfMonitor.addCount("collision.chainDrained", chainCollisionsDrained);
    if (projectileImpactHandled) {
      return events;
    }
    events.push(...this.processSurfaceImpacts(now));
    return events;
  }

  private processSurfaceImpacts(now: number): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    const processedObjectIds = this.processedSurfaceImpactObjectIds;
    processedObjectIds.clear();
    let surfaceCollisionsChecked = 0;
    let impactsThisFrame = 0;
    let impactVfxThisFrame = 0;
    const surfaceImpactsDrained = this.physics.drainSurfaceCollisionEventsInto((surfaceImpact) => {
      if (surfaceCollisionsChecked >= SURFACE_COLLISION_MAX_PER_FRAME || impactsThisFrame >= SURFACE_IMPACT_MAX_PER_FRAME) {
        return;
      }
      surfaceCollisionsChecked += 1;
      if (!surfaceImpact.started || !isGroundSurface(surfaceImpact.surfaceLabel)) {
        return;
      }
      const object = this.physics.getObject(surfaceImpact.object.id);
      if (!object || processedObjectIds.has(object.id)) {
        return;
      }
      processedObjectIds.add(object.id);
      if (!object.destructible || !object.canFracture || object.bodyType !== "dynamic" || object.category === "projectile") {
        return;
      }
      if ((this.surfaceImpactCooldowns.get(object.id) ?? 0) > now) {
        return;
      }

      const downwardSpeed = Math.max(0, -surfaceImpact.impactVelocity.y);
      const impactSpeed = downwardSpeed + horizontalSpeed(surfaceImpact.impactVelocity) * 0.22;
      if (!canGroundImpactBreak(object, impactSpeed)) {
        return;
      }

      this.surfaceImpactCooldowns.set(object.id, now + 520);
      const objectPosition = setVectorFromRapier(this.surfaceObjectPosition, object.body.translation());
      const origin = this.surfaceImpactOrigin.set(objectPosition.x, objectPosition.y - object.dimensions.y * 0.5, objectPosition.z);
      const result = this.destruction.groundImpact(object, origin, impactSpeed);
      const damaged = result.affectedObjects[0];
      if (!damaged?.fractured) {
        return;
      }

      this.audio.playChainImpact({
        point: origin,
        result,
        relativeSpeed: impactSpeed,
        materialId: damaged.materialId
      });
      events.push(...this.applyExplosionResult(result));
      const points = Math.max(22, Math.round(damaged.weightedDamage * 0.45 + impactSpeed * 6));
      events.push(...this.scoreTracker.addChainReaction(points, damaged.position, groundImpactLabel(damaged)));
      if (impactVfxThisFrame < SURFACE_IMPACT_VFX_MAX_PER_FRAME && result.dustColors.length > 0) {
        this.particles.cityDebrisSpray(origin, result.dustColors, 0.22 + result.fracturedBodies * 0.045);
        impactVfxThisFrame += 1;
      } else if (result.dustColors.length > 0) {
        perfMonitor.addCount("vfx.surfaceImpactSuppressed");
      }
      impactsThisFrame += 1;
    }, SURFACE_COLLISION_MAX_PER_FRAME);
    perfMonitor.addCount("collision.surfaceDrained", surfaceImpactsDrained);
    return events;
  }

  private isSceneSettled(): boolean {
    if (this.destruction.getQueuedFractureCount() > 0) {
      return false;
    }
    if (this.burningHazards.size > 0) {
      return false;
    }
    for (const object of this.physics.objects.values()) {
      if (object.category === "projectile" || object.bodyType === "fixed" || object.body.isSleeping()) {
        continue;
      }
      if (speedOf(object) >= SCORE_SETTLED_SPEED) {
        return false;
      }
    }
    return true;
  }

  private spawnScatterFragments(origin: THREE.Vector3, direction: THREE.Vector3, sizeScale: number): void {
    const material = this.materials.get("metal");
    const renderMaterial = this.materials.getRenderMaterial("metal");
    for (let i = 0; i < SCATTER_PHYSICAL_SHARD_COUNT; i += 1) {
      const scatterDirection = direction
        .clone()
        .add(new THREE.Vector3(randomRange(this.rng, -0.4, 0.4), randomRange(this.rng, 0, 0.55), randomRange(this.rng, -0.4, 0.4)))
        .normalize();
      this.physics.addDynamicSphere({
        label: "Scatter shard",
        material,
        renderMaterial,
        position: origin.clone().add(scatterDirection.clone().multiplyScalar(0.22)),
        radius: 0.07 * sizeScale,
        linearVelocity: scatterDirection.multiplyScalar(randomRange(this.rng, 13, 24)),
        angularVelocity: new THREE.Vector3(randomRange(this.rng, 0, 7), randomRange(this.rng, 0, 7), randomRange(this.rng, 0, 7)),
        category: "debris",
        isDebris: true,
        chainSource: true,
        destructible: false,
        canFracture: false,
        collisionEvents: false,
        density: 1.2,
        scoreValue: 4,
        segments: 10
      });
    }
    this.particles.spark(origin, 0xffc961, 1.5);
  }

  private spawnScatterClusterBlasts(origin: THREE.Vector3, direction: THREE.Vector3, active: ActiveProjectile): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    const forward = direction.clone().normalize();
    const side = new THREE.Vector3(-forward.z, 0, forward.x);
    if (side.lengthSq() < 0.0001) {
      side.set(1, 0, 0);
    }
    side.normalize();
    const clusterCount = 4;
    for (let i = 0; i < clusterCount; i += 1) {
      const lateral = (i - (clusterCount - 1) * 0.5) * 0.74 * active.sizeScale;
      const depth = randomRange(this.rng, 0.35, 1.42) * active.sizeScale;
      const lift = randomRange(this.rng, 0.02, 0.18);
      const clusterOrigin = origin
        .clone()
        .add(forward.clone().multiplyScalar(depth))
        .add(side.clone().multiplyScalar(lateral))
        .add(new THREE.Vector3(0, lift, 0));
      const cluster = this.destruction.explode(clusterOrigin, 7.4 * active.powerScale, 1.22 * active.sizeScale);
      this.explosion.play(clusterOrigin, 1.55 * active.sizeScale, cluster.dustColors, {
        projectileId: "scatter",
        result: cluster,
        powerScale: 0.58 * active.powerScale,
        sizeScale: 0.52 * active.sizeScale,
        densityScale: 0.68,
        hitMaterialId: "foam",
        impactDirection: forward,
        role: "secondary"
      });
      if (cluster.dustColors.length > 0) {
        this.particles.cityDebrisSpray(clusterOrigin, cluster.dustColors, 0.18 + cluster.fracturedBodies * 0.025);
      }
      events.push(...this.applyExplosionResult(cluster, 1, 0));
    }
    return events;
  }

  private async reset(): Promise<void> {
    if (this.ui.isGameplayBlocked() || this.levelReloadInProgress) {
      return;
    }
    await this.reloadLevelWithLoading("Resetting district", { reuseWarmup: true });
  }

  private async nextLevel(): Promise<void> {
    if (this.ui.isGameplayBlocked() || this.levelReloadInProgress) {
      return;
    }
    const unlockedCount = Math.max(1, Math.min(TEST_CHAMBERS.length, this.arcadeProgress.highestUnlockedLevel + 1));
    this.levelIndex = (this.levelIndex + 1) % unlockedCount;
    await this.reloadLevelWithLoading("Loading next district");
  }

  private selectLevel(index: number): boolean {
    if (!Number.isFinite(index) || this.levelReloadInProgress) {
      return false;
    }
    const levelIndex = THREE.MathUtils.clamp(Math.trunc(index), 0, TEST_CHAMBERS.length - 1);
    if (levelIndex > this.arcadeProgress.highestUnlockedLevel) {
      return false;
    }
    this.levelIndex = levelIndex;
    void this.reloadLevelWithLoading("Loading district");
    return true;
  }

  private async reloadLevelWithLoading(status: string, options: { reuseWarmup?: boolean } = {}): Promise<void> {
    this.levelReloadInProgress = true;
    void this.renderer.setAnimationLoop(null);
    const level = this.currentLevel();
    const reuseWarmup = options.reuseWarmup === true && this.canReuseCurrentLevelWarmup();
    this.perfDiskLogger?.flush("level-reload-start");
    this.options.showLoading?.(level.name, status);
    try {
      this.loadLevel();
      this.ui.hideScorePanel();
      if (reuseWarmup) {
        this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
        this.status = `${level.name}: ${level.objective}`;
        this.options.updateLoadingStatus?.("Preparing reset renderer pipelines");
        await this.warmResetRuntimePipelines();
      } else {
        this.scheduleRenderWarmup();
        this.options.updateLoadingStatus?.("Warming renderer pipelines");
        await this.waitForRenderWarmup();
      }
      this.ui.showPlayScreen();
      this.updateHud();
      this.options.updateLoadingStatus?.("Ready");
      perfMonitor.clear();
      this.perfDiskLogger?.flush("level-reload-ready");
    } finally {
      this.levelReloadInProgress = false;
      if (!this.disposed) {
        this.options.hideLoading?.();
        this.start();
      }
    }
  }

  private markCurrentLevelWarmupReady(): void {
    this.warmedLevelIds.add(this.currentLevel().id);
  }

  private canReuseCurrentLevelWarmup(): boolean {
    return this.renderWarmupState.phase === "ready" && this.warmedLevelIds.has(this.currentLevel().id);
  }

  private clearDebris(): void {
    if (this.ui.isGameplayBlocked() || this.levelReloadInProgress) {
      return;
    }
    this.physics.clearDebris();
    this.audio.playUiTick();
    this.status = "Loose debris cleared. The trial state is unchanged.";
  }

  private selectProjectile(id: ProjectileId): void {
    if (this.ui.isGameplayBlocked() || this.levelReloadInProgress) {
      return;
    }
    if (!this.runState.shotAvailable || this.runState.phase !== "aim") {
      this.status = "Reset before changing projectile.";
      this.audio.playUiReject();
      return;
    }
    this.selectedProjectile = id;
    this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
    this.audio.playLoadoutPreview(id, this.powerScale, this.sizeScale);
    this.status = `${PROJECTILES[id].name}: ${PROJECTILES[id].description}`;
  }

  private updateSettings(patch: Partial<GameSettings>): void {
    const previousRendererBackend = this.settings.rendererBackend;
    this.settings = sanitizeGameSettings({ ...this.settings, ...patch });
    this.applySettings();
    saveGameSettings(this.settings);
    this.status =
      previousRendererBackend !== this.settings.rendererBackend
        ? `Renderer saved: ${this.settings.rendererBackend}. Reload to apply; active backend is ${this.rendererBackend}.`
        : `Settings saved: ${settingsStatus(this.settings)}.`;
  }

  private resetSettings(): void {
    this.settings = { ...DEFAULT_GAME_SETTINGS };
    this.applySettings();
    saveGameSettings(this.settings);
    this.status = `Settings restored: ${settingsStatus(this.settings)}.`;
  }

  private applySettings(): void {
    const pixelRatioCap = graphicsPixelRatioCap(this.settings.graphicsQuality);
    this.cameraRig.setPixelRatioCap(pixelRatioCap);
    this.cameraRig.setShakeScale(this.settings.cameraShake);
    this.audio.setMasterVolume(this.settings.masterVolume);
    this.particles.setFlashScale(this.settings.motionEffects ? 1 : 0);
    this.particles.setQuality(this.settings.graphicsQuality);
    this.renderer.shadowMap.enabled = this.settings.graphicsQuality === "cinematic";
    setOptionalShadowMapFlag(this.renderer, "needsUpdate", true);
    this.resize();
  }

  private currentLevel() {
    return TEST_CHAMBERS[this.levelIndex];
  }

  private currentLevelProgress() {
    return this.arcadeProgress.levels[this.currentLevel().id];
  }

  private levelOptions() {
    return TEST_CHAMBERS.map((level, index) => ({
      index,
      name: level.name,
      description: level.description,
      objective: level.objective,
      progress: this.arcadeProgress.levels[level.id],
      locked: index > this.arcadeProgress.highestUnlockedLevel
    }));
  }

  private resize(): void {
    const viewport = window.visualViewport;
    this.cameraRig.resize(Math.round(viewport?.width ?? window.innerWidth), Math.round(viewport?.height ?? window.innerHeight));
  }

  private updateAimMarker(): void {
    this.aimMarker.visible = this.runState.phase === "aim";
    this.aimMarker.position.copy(this.aimMarkerPoint).addScaledVector(this.aimSurfaceNormal, AIM_MARKER_SURFACE_OFFSET);
    this.aimMarker.quaternion.setFromUnitVectors(AIM_SURFACE_NORMAL, this.aimSurfaceNormal);
    this.aimMarkerMaterial.color.copy(PROJECTILES[this.selectedProjectile].color);
  }

  private addDecoration(object: THREE.Object3D): void {
    this.scene.add(object);
    this.levelDecorations.push(object);
  }

  private clearLevelDecorations(): void {
    for (const object of this.levelDecorations) {
      this.scene.remove(object);
      disposeObject(object);
    }
    this.levelDecorations.length = 0;
  }
}

function createAimMarker(material: THREE.MeshBasicMaterial): THREE.Group {
  const group = new THREE.Group();
  group.name = "aim impact reticle";
  group.renderOrder = 100;

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.38, 42), material);
  ring.rotation.x = -Math.PI * 0.5;
  ring.renderOrder = 100;

  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 18), material);
  dot.rotation.x = -Math.PI * 0.5;
  dot.renderOrder = 100;

  const horizontalTickGeometry = new THREE.PlaneGeometry(0.17, 0.036);
  const verticalTickGeometry = new THREE.PlaneGeometry(0.036, 0.17);
  const ticks = [
    { geometry: horizontalTickGeometry, position: new THREE.Vector3(-0.5, 0, 0) },
    { geometry: horizontalTickGeometry.clone(), position: new THREE.Vector3(0.5, 0, 0) },
    { geometry: verticalTickGeometry, position: new THREE.Vector3(0, 0, -0.5) },
    { geometry: verticalTickGeometry.clone(), position: new THREE.Vector3(0, 0, 0.5) }
  ];
  const tickMeshes = ticks.map(({ geometry, position }) => {
    const tick = new THREE.Mesh(geometry, material);
    tick.position.copy(position);
    tick.rotation.x = -Math.PI * 0.5;
    tick.renderOrder = 100;
    return tick;
  });

  group.add(ring, dot, ...tickMeshes);
  return group;
}

let activeGame: Game | null = null;
let activeShell: AppShell | null = null;
let rapierReady: Promise<unknown> | null = null;
let startToken = 0;

async function boot(): Promise<void> {
  activeShell?.dispose();
  const shell = new AppShell({
    startLevel: (levelIndex) => {
      void startLevelFromShell(shell, levelIndex);
    }
  });
  activeShell = shell;
  shell.showMenu();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      startToken += 1;
      activeGame?.dispose();
      activeGame = null;
      activeShell?.dispose();
      activeShell = null;
      delete window.__DOWNTOWN_MAYHEM_DEBUG__;
    });
  }
}

async function startLevelFromShell(shell: AppShell, requestedLevelIndex: number): Promise<void> {
  const progress = loadArcadeProgress(ARCADE_LEVELS);
  const levelIndex = clampInitialLevelIndex(requestedLevelIndex, progress.highestUnlockedLevel);
  const level = TEST_CHAMBERS[levelIndex];
  const token = startToken + 1;
  startToken = token;
  activeGame?.dispose();
  activeGame = null;
  delete window.__DOWNTOWN_MAYHEM_DEBUG__;
  shell.showLoading(level.name, "Initializing physics engine");

  try {
    await ensureRapierReady();
    if (!isActiveStart(shell, token)) {
      return;
    }
    shell.updateLoadingStatus("Creating GPU renderer");
    const settings = loadGameSettings();
    const rendererBundle = await createDowntownMayhemRenderer(settings);
    if (!isActiveStart(shell, token)) {
      rendererBundle.renderer.dispose();
      return;
    }

    shell.updateLoadingStatus("Building destructible district");
    const game = new Game(settings, rendererBundle, {
      initialLevelIndex: levelIndex,
      onMainMenu: () => returnToMainMenu(shell),
      showLoading: (levelName, status) => shell.showLoading(levelName, status),
      updateLoadingStatus: (status) => shell.updateLoadingStatus(status),
      hideLoading: () => shell.hide()
    });
    activeGame = game;
    installDebugApi(game);
    shell.updateLoadingStatus("Warming renderer pipelines");
    await game.waitForRenderWarmup();
    if (!isActiveStart(shell, token) || activeGame !== game) {
      game.dispose();
      return;
    }
    game.showPlayScreen();
    shell.hide();
    game.start();
  } catch (error) {
    console.error(error);
    if (isActiveStart(shell, token)) {
      activeGame?.dispose();
      activeGame = null;
      delete window.__DOWNTOWN_MAYHEM_DEBUG__;
      const message = error instanceof Error ? error.message : String(error);
      shell.showMenu(`Could not start level: ${message}`);
    }
  }
}

function ensureRapierReady(): Promise<unknown> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

function isActiveStart(shell: AppShell, token: number): boolean {
  return activeShell === shell && startToken === token;
}

function returnToMainMenu(shell: AppShell): void {
  startToken += 1;
  const game = activeGame;
  activeGame = null;
  game?.dispose();
  delete window.__DOWNTOWN_MAYHEM_DEBUG__;
  shell.showMenu();
}

function installDebugApi(game: Game): void {
  window.__DOWNTOWN_MAYHEM_DEBUG__ = {
    getRenderStats: () => game.getRenderStats(),
    getPerfReport: () => perfMonitor.report(),
    getRenderWarmupState: () => game.getRenderWarmupState(),
    setPerfEnabled: (enabled) => perfMonitor.setEnabled(enabled),
    clearPerfReport: () => perfMonitor.clear(),
    flushPerfLog: (reason) => game.flushPerfLog(reason),
    freezeForCapture: () => game.freezeForCapture(),
    resume: () => game.resume()
  };
}

function clampInitialLevelIndex(index: number | undefined, highestUnlockedLevel: number): number {
  const requested = typeof index === "number" && Number.isFinite(index) ? Math.trunc(index) : 0;
  const maxUnlockedLevel = Math.max(0, Math.min(TEST_CHAMBERS.length - 1, highestUnlockedLevel));
  return THREE.MathUtils.clamp(requested, 0, maxUnlockedLevel);
}

function vectorFromRapier(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function setVectorFromRapier(target: THREE.Vector3, v: { x: number; y: number; z: number }): THREE.Vector3 {
  return target.set(v.x, v.y, v.z);
}

function ignitionOriginForObject(object: PhysicsObject): THREE.Vector3 {
  const origin = vectorFromRapier(object.body.translation());
  origin.y += THREE.MathUtils.clamp(object.dimensions.y * 0.42, 0.26, 0.72);
  return origin;
}

function explosionFocusScore(result: ExplosionResult): number {
  const scoreMass = Math.min(190, (result.materialChaos + result.structureDamage) * 0.04);
  return result.fracturedBodies * 38 + result.affectedBodies * 6 + scoreMass;
}

function hazardCameraFocusBonus(object: ExplosionAffectedObject): number {
  const label = object.label.toLowerCase();
  const zone = object.zoneId ?? "";
  if (isPropaneDepotHazard(label, zone)) {
    return 185;
  }
  if (isGasHazard(label, zone)) {
    return 190;
  }
  if (isEnergyPlantHazard(label, zone)) {
    return 170;
  }
  if (isElectricSubstationHazard(label, zone)) {
    return 155;
  }
  if (isParkingSiloHazard(label, zone)) {
    return 145;
  }
  if (zone.includes("power-grid") || label.includes("transformer") || label.includes("power-grid")) {
    return 135;
  }
  if (zone.includes("hazard-relay") || label.includes("shock canister") || label.includes("canister")) {
    return 115;
  }
  if (zone.includes("moving-vehicles")) {
    return 100;
  }
  return 70;
}

function quaternionFromRapier(q: { x: number; y: number; z: number; w: number }): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}

function speedOf(object: PhysicsObject): number {
  return Math.sqrt(velocityLengthSq(object.body.linvel()));
}

function velocityLengthSq(velocity: { x: number; y: number; z: number }): number {
  return velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z;
}

function impactVelocityAtTargetInto(
  out: THREE.Vector3,
  lever: THREE.Vector3,
  source: PhysicsObject,
  target: PhysicsObject,
  sourcePosition: THREE.Vector3,
  targetPosition: THREE.Vector3
): THREE.Vector3 {
  const sourceVelocity = source.body.linvel();
  const targetVelocity = target.body.linvel();
  lever.copy(targetPosition).sub(sourcePosition);
  const maxLever = Math.max(
    0.35,
    source.radius * 2.2,
    Math.max(source.dimensions.x, source.dimensions.y, source.dimensions.z) * 0.85
  );
  if (lever.lengthSq() > maxLever * maxLever) {
    lever.setLength(maxLever);
  }
  const angularVelocity = source.body.angvel();
  const tangentialX = angularVelocity.y * lever.z - angularVelocity.z * lever.y;
  const tangentialY = angularVelocity.z * lever.x - angularVelocity.x * lever.z;
  const tangentialZ = angularVelocity.x * lever.y - angularVelocity.y * lever.x;
  return out.set(
    sourceVelocity.x + tangentialX - targetVelocity.x,
    sourceVelocity.y + tangentialY - targetVelocity.y,
    sourceVelocity.z + tangentialZ - targetVelocity.z
  );
}

function chainCollisionPair(first: PhysicsObject, second: PhysicsObject): { source: PhysicsObject; target: PhysicsObject } | null {
  if (isChainSource(first) && isChainTarget(second)) {
    return { source: first, target: second };
  }
  if (isChainSource(second) && isChainTarget(first)) {
    return { source: second, target: first };
  }
  return null;
}

function isChainSource(object: PhysicsObject): boolean {
  return object.chainSource && object.category !== "projectile" && object.bodyType === "dynamic";
}

function isChainTarget(object: PhysicsObject): boolean {
  return object.category !== "projectile" && !object.isDebris && object.destructible && object.canFracture;
}

function isVolatileHazard(object: ExplosionAffectedObject): boolean {
  const label = object.label.toLowerCase();
  const zone = object.zoneId ?? "";
  return (
    zone.includes("hazard-relay") ||
    zone.includes("power-grid") ||
    zone.includes("energy-plant") ||
    zone.includes("gas-station") ||
    zone.includes("propane-depot") ||
    zone.includes("electric-substation") ||
    zone.includes("parking-silo") ||
    zone.includes("parking-garage") ||
    zone.includes("fuel") ||
    zone.includes("gas") ||
    zone.includes("moving-vehicles") ||
    label.includes("shock canister") ||
    label.includes("power-grid") ||
    label.includes("substation") ||
    label.includes("propane") ||
    label.includes("parking silo") ||
    label.includes("parking garage") ||
    label.includes("energy plant") ||
    label.includes("gas pump") ||
    label.includes("gas station")
  );
}

function volatileHazardProfile(object: ExplosionAffectedObject): VolatileHazardProfile {
  const label = object.label.toLowerCase();
  const zone = object.zoneId ?? "";
  if (isPropaneDepotHazard(label, zone)) {
    return {
      strength: 36,
      radius: 3.65,
      projectileId: "ignite",
      color: 0xff8f38,
      powerScale: 1.18,
      sizeScale: 1.16
    };
  }
  if (isGasHazard(label, zone)) {
    return {
      strength: 32,
      radius: 3.35,
      projectileId: "ignite",
      color: 0xff7a35,
      powerScale: 1.08,
      sizeScale: 1.08
    };
  }
  if (isEnergyPlantHazard(label, zone)) {
    return {
      strength: 28,
      radius: 3.05,
      projectileId: "pulse",
      color: 0x8ff7ff,
      powerScale: 1.0,
      sizeScale: 1.0
    };
  }
  if (isElectricSubstationHazard(label, zone)) {
    return {
      strength: 27,
      radius: 3.1,
      projectileId: "pulse",
      color: 0x93f6ff,
      powerScale: 0.98,
      sizeScale: 0.94
    };
  }
  if (isParkingSiloHazard(label, zone)) {
    return {
      strength: 24,
      radius: 2.8,
      projectileId: "ignite",
      color: 0xffc241,
      powerScale: 0.92,
      sizeScale: 0.9
    };
  }
  if (zone.includes("power-grid") || label.includes("transformer") || label.includes("power-grid")) {
    return {
      strength: 21,
      radius: 2.35,
      projectileId: "pulse",
      color: 0x8ff7ff,
      powerScale: 0.84,
      sizeScale: 0.8
    };
  }
  return {
    strength: 18,
    radius: 2.55,
    projectileId: "scatter",
    color: 0xff4f66,
    powerScale: 0.84,
    sizeScale: 0.8
  };
}

function sortVolatileHazards(a: ExplosionAffectedObject, b: ExplosionAffectedObject): number {
  return volatileHazardPriority(b) - volatileHazardPriority(a) || b.energy - a.energy;
}

function volatileHazardPriority(object: ExplosionAffectedObject): number {
  const label = object.label.toLowerCase();
  const zone = object.zoneId ?? "";
  if (isPropaneDepotHazard(label, zone)) {
    return 125;
  }
  if (isGasHazard(label, zone)) {
    return 120;
  }
  if (isEnergyPlantHazard(label, zone)) {
    return 110;
  }
  if (isElectricSubstationHazard(label, zone)) {
    return 104;
  }
  if (isParkingSiloHazard(label, zone)) {
    return 92;
  }
  if (zone.includes("power-grid") || label.includes("transformer") || label.includes("power-grid")) {
    return 86;
  }
  if (zone.includes("hazard-relay") || label.includes("shock canister") || label.includes("canister")) {
    return 76;
  }
  if (zone.includes("moving-vehicles")) {
    return 62;
  }
  return 40;
}

function hazardExplosionLabel(object: ExplosionAffectedObject): string {
  return `${hazardSourceLabel(object)} BLAST`;
}

function ignitionExplosionLabel(object: ExplosionAffectedObject): string {
  return `${hazardSourceLabel(object)} IGNITES`;
}

function ignitionWarningColor(hazard: BurningHazard): THREE.ColorRepresentation {
  if (hazard.label.includes("PROPANE") || hazard.label.includes("GAS") || hazard.label.includes("VEHICLE")) {
    return 0xff8f38;
  }
  if (hazard.label.includes("PARKING")) {
    return 0xffc241;
  }
  if (hazard.label.includes("ENERGY") || hazard.label.includes("POWER")) {
    return 0x8ff7ff;
  }
  switch (hazard.materialId) {
    case "glass":
      return 0xb9fbff;
    case "metal":
      return 0xffd25c;
    case "wood":
      return 0xffb36a;
    case "foam":
      return 0xffe8a8;
    case "rubber":
      return 0xff6c92;
    case "concrete":
      return 0xff9a42;
  }
}

function chainImpactLabel(object: ExplosionAffectedObject): string {
  return `${scoreMaterialLabel(object.materialId)} ${object.fractured ? "BREAKS" : "HIT"}`;
}

function groundImpactLabel(object: ExplosionAffectedObject): string {
  return `${scoreMaterialLabel(object.materialId)} GROUND HIT`;
}

function hazardSourceLabel(object: ExplosionAffectedObject): string {
  const label = object.label.toLowerCase();
  const zone = object.zoneId ?? "";
  if (isPropaneDepotHazard(label, zone)) {
    return "PROPANE DEPOT";
  }
  if (isGasHazard(label, zone)) {
    return "GAS LINE";
  }
  if (isEnergyPlantHazard(label, zone)) {
    return "ENERGY PLANT";
  }
  if (isElectricSubstationHazard(label, zone)) {
    return "SUBSTATION";
  }
  if (isParkingSiloHazard(label, zone)) {
    return "PARKING SILO";
  }
  if (zone.includes("power-grid") || label.includes("transformer") || label.includes("power-grid")) {
    return "POWER RELAY";
  }
  if (label.includes("shock canister") || label.includes("canister")) {
    return "CANISTER";
  }
  if (zone.includes("moving-vehicles") || label.includes("vehicle") || label.includes("van") || label.includes("cart")) {
    return "VEHICLE";
  }
  if (zone.includes("hazard-relay") || label.includes("relay")) {
    return "HAZARD RELAY";
  }
  return `${scoreMaterialLabel(object.materialId)} HAZARD`;
}

function isEnergyPlantHazard(label: string, zone: string): boolean {
  return zone.includes("energy-plant") || label.includes("energy plant");
}

function isElectricSubstationHazard(label: string, zone: string): boolean {
  return zone.includes("electric-substation") || label.includes("electric substation") || label.includes("substation");
}

function isParkingSiloHazard(label: string, zone: string): boolean {
  return zone.includes("parking-silo") || zone.includes("parking-garage") || label.includes("parking silo") || label.includes("parking garage");
}

function isPropaneDepotHazard(label: string, zone: string): boolean {
  return zone.includes("propane-depot") || label.includes("propane");
}

function isGasHazard(label: string, zone: string): boolean {
  return [label, zone].some(
    (value) =>
      value.includes("gas") ||
      value.includes("fuel") ||
      value.includes("propane") ||
      value.includes("pipe") ||
      value.includes("conduit") ||
      value.includes("pipeline")
  );
}

function scoreMaterialLabel(materialId: ExplosionAffectedObject["materialId"]): string {
  switch (materialId) {
    case "glass":
      return "GLASS";
    case "metal":
      return "METAL";
    case "wood":
      return "WOOD";
    case "foam":
      return "FOAM";
    case "rubber":
      return "RUBBER";
    case "concrete":
      return "CONCRETE";
  }
}

function canIgniteObject(object: ExplosionAffectedObject): boolean {
  if (object.category !== "structure") {
    return false;
  }
  const zone = object.zoneId ?? "";
  return (
    object.materialId === "wood" ||
    object.materialId === "foam" ||
    object.materialId === "rubber" ||
    zone.includes("hazard") ||
    zone.includes("power-grid") ||
    zone.includes("energy-plant") ||
    zone.includes("gas-station") ||
    zone.includes("fuel") ||
    zone.includes("gas") ||
    zone.includes("moving-vehicles")
  );
}

function isGroundSurface(label: string): boolean {
  return label.toLowerCase().includes("floor");
}

function horizontalSpeed(velocity: { x: number; z: number }): number {
  return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
}

function canGroundImpactBreak(object: PhysicsObject, impactSpeed: number): boolean {
  if (object.isDebris) {
    return impactSpeed >= (object.materialId === "glass" || object.materialId === "foam" ? 3.2 : 3.8);
  }
  if (object.materialId === "glass" || object.materialId === "foam") {
    return impactSpeed >= 4.0;
  }
  if (object.materialId === "wood") {
    return impactSpeed >= 4.6;
  }
  return impactSpeed >= 5.1;
}

function projectileCollisionTarget(active: ActiveProjectile, collision: { first: PhysicsObject; second: PhysicsObject }): PhysicsObject | null {
  const target =
    collision.first.id === active.object.id
      ? collision.second
      : collision.second.id === active.object.id
        ? collision.first
        : null;
  if (!target || active.piercedObjectIds.has(target.id) || target.category === "projectile" || target.isDebris || target.zoneId === "surface") {
    return null;
  }
  return target;
}

function penetrationImpactScale(projectileId: ProjectileId, target: PhysicsObject): number {
  if (projectileId === "gravity") {
    if (target.materialId === "concrete" || target.materialId === "metal") {
      return 0.94;
    }
    if (target.materialId === "wood") {
      return 0.78;
    }
    if (target.materialId === "glass" || target.materialId === "foam") {
      return 0.58;
    }
  }
  return 0.18;
}

function penetrationRetainedSpeed(projectileId: ProjectileId, target: PhysicsObject): number {
  if (projectileId === "gravity") {
    if (target.materialId === "concrete" || target.materialId === "metal") {
      return 0.58;
    }
    if (target.materialId === "wood") {
      return 0.68;
    }
    if (target.materialId === "glass" || target.materialId === "foam") {
      return 0.76;
    }
  }
  return 0.42;
}

function directImpactScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 0.82;
    case "gravity":
      return 1.28;
    case "pulse":
      return 0.52;
    case "scatter":
      return 0.42;
    case "ignite":
      return 0.74;
  }
}

function residualBlastScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 0.72;
    case "gravity":
      return 0;
    case "pulse":
      return 0.38;
    case "scatter":
      return 0.34;
    case "ignite":
      return 0.78;
  }
}

function residualBlastRadiusScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 0.92;
    case "gravity":
      return 0;
    case "pulse":
      return 1.2;
    case "scatter":
      return 0.64;
    case "ignite":
      return 0.86;
  }
}

function impactVisualRadiusScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 1.1;
    case "gravity":
      return 0.82;
    case "pulse":
      return 1.38;
    case "scatter":
      return 0.82;
    case "ignite":
      return 1.06;
  }
}

function projectileImpactCandidate(
  active: ActiveProjectile,
  object: PhysicsObject,
  previous: THREE.Vector3,
  current: THREE.Vector3
): { point: THREE.Vector3; object: PhysicsObject; distance: number } | null {
  if (!segmentCanReachObject(previous, current, object, active.radius + 0.2)) {
    return null;
  }
  if (object.shape === "sphere") {
    const objectPosition = object.body.translation();
    const threshold = active.radius + object.radius;
    const distanceSq = distancePointToSegmentSq(objectPosition, previous, current);
    if (distanceSq > threshold * threshold) {
      return null;
    }
    const point = new THREE.Vector3(objectPosition.x, objectPosition.y, objectPosition.z).lerp(current, 0.35);
    return { point, object, distance: previous.distanceToSquared(point) };
  }

  const center = vectorFromRapier(object.body.translation());
  const rotation = quaternionFromRapier(object.body.rotation());
  const inverseRotation = rotation.clone().invert();
  const localPrevious = previous.clone().sub(center).applyQuaternion(inverseRotation);
  const localCurrent = current.clone().sub(center).applyQuaternion(inverseRotation);
  const originalHalf = object.dimensions.clone().multiplyScalar(0.5);
  const expandedHalf = originalHalf.clone().addScalar(active.radius + 0.08);
  const hitT = segmentAabbIntersection(localPrevious, localCurrent, expandedHalf);
  if (hitT === null) {
    return null;
  }

  const localHit = localPrevious.clone().lerp(localCurrent, hitT);
  const localSurface = clampVectorToBox(localHit, originalHalf);
  const point = localSurface.applyQuaternion(rotation).add(center);
  return { point, object, distance: previous.distanceToSquared(point) };
}

function segmentCanReachObject(previous: THREE.Vector3, current: THREE.Vector3, object: PhysicsObject, padding: number): boolean {
  const objectPosition = object.body.translation();
  const threshold = object.radius + padding;
  return !(
    objectPosition.x < Math.min(previous.x, current.x) - threshold ||
    objectPosition.x > Math.max(previous.x, current.x) + threshold ||
    objectPosition.y < Math.min(previous.y, current.y) - threshold ||
    objectPosition.y > Math.max(previous.y, current.y) + threshold ||
    objectPosition.z < Math.min(previous.z, current.z) - threshold ||
    objectPosition.z > Math.max(previous.z, current.z) + threshold
  );
}

function segmentAabbIntersection(start: THREE.Vector3, end: THREE.Vector3, halfSize: THREE.Vector3): number | null {
  const delta = end.clone().sub(start);
  let tMin = 0;
  let tMax = 1;

  const x = clipSegmentAxis(start.x, delta.x, -halfSize.x, halfSize.x, tMin, tMax);
  if (!x) {
    return null;
  }
  tMin = x.tMin;
  tMax = x.tMax;

  const y = clipSegmentAxis(start.y, delta.y, -halfSize.y, halfSize.y, tMin, tMax);
  if (!y) {
    return null;
  }
  tMin = y.tMin;
  tMax = y.tMax;

  const z = clipSegmentAxis(start.z, delta.z, -halfSize.z, halfSize.z, tMin, tMax);
  return z ? z.tMin : null;
}

function clipSegmentAxis(
  start: number,
  delta: number,
  min: number,
  max: number,
  tMin: number,
  tMax: number
): { tMin: number; tMax: number } | null {
  if (Math.abs(delta) < 0.000001) {
    return start >= min && start <= max ? { tMin, tMax } : null;
  }
  const inverseDelta = 1 / delta;
  let near = (min - start) * inverseDelta;
  let far = (max - start) * inverseDelta;
  if (near > far) {
    const swap = near;
    near = far;
    far = swap;
  }
  const nextMin = Math.max(tMin, near);
  const nextMax = Math.min(tMax, far);
  return nextMin <= nextMax ? { tMin: nextMin, tMax: nextMax } : null;
}

function closestPointOnObject(object: PhysicsObject, point: THREE.Vector3): THREE.Vector3 {
  if (object.shape === "sphere") {
    const center = vectorFromRapier(object.body.translation());
    const direction = point.clone().sub(center);
    if (direction.lengthSq() < 0.0001) {
      return center;
    }
    return center.add(direction.normalize().multiplyScalar(object.radius));
  }
  const center = vectorFromRapier(object.body.translation());
  const rotation = quaternionFromRapier(object.body.rotation());
  const localPoint = point.clone().sub(center).applyQuaternion(rotation.clone().invert());
  return clampVectorToBox(localPoint, object.dimensions.clone().multiplyScalar(0.5)).applyQuaternion(rotation).add(center);
}

function clampVectorToBox(point: THREE.Vector3, halfSize: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(
    THREE.MathUtils.clamp(point.x, -halfSize.x, halfSize.x),
    THREE.MathUtils.clamp(point.y, -halfSize.y, halfSize.y),
    THREE.MathUtils.clamp(point.z, -halfSize.z, halfSize.z)
  );
}

function distancePointToSegmentSq(point: { x: number; y: number; z: number }, a: THREE.Vector3, b: THREE.Vector3): number {
  const segmentX = b.x - a.x;
  const segmentY = b.y - a.y;
  const segmentZ = b.z - a.z;
  const lengthSq = segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ;
  if (lengthSq < 0.0001) {
    const dx = point.x - a.x;
    const dy = point.y - a.y;
    const dz = point.z - a.z;
    return dx * dx + dy * dy + dz * dz;
  }
  const pointX = point.x - a.x;
  const pointY = point.y - a.y;
  const pointZ = point.z - a.z;
  const t = THREE.MathUtils.clamp((pointX * segmentX + pointY * segmentY + pointZ * segmentZ) / lengthSq, 0, 1);
  const closestX = a.x + segmentX * t;
  const closestY = a.y + segmentY * t;
  const closestZ = a.z + segmentZ * t;
  const dx = point.x - closestX;
  const dy = point.y - closestY;
  const dz = point.z - closestZ;
  return dx * dx + dy * dy + dz * dz;
}

function disposeObject(object: THREE.Object3D, disposedMaterials = new Set<THREE.Material>()): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (child.geometry.userData.sharedGeometry !== true) {
        child.geometry.dispose();
      }
      if (child.userData.disposeMaterial === false) {
        return;
      }
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (disposedMaterials.has(material)) {
          continue;
        }
        material.dispose();
        disposedMaterials.add(material);
      }
    }
  });
}

function chamberToArcadeLevel(chamber: TestChamber): ArcadeLevelDefinition {
  const mission = chamber.mission;
  return {
    id: chamber.id,
    title: chamber.name,
    thresholds: {
      missionScore: mission.scoreThresholds.oneStar,
      twoStarScore: mission.scoreThresholds.twoStar,
      threeStarScore: mission.scoreThresholds.threeStar,
      threeStarBonus: mission.bonusThreshold
    }
  };
}

function scoreStatus(score: ScoreBreakdown, result: ArcadeResult): string {
  if (!result.completed) {
    return `Mission incomplete: ${score.totalScore}. Reach 2/3 stars to unlock the next level.`;
  }
  if (result.stars >= 3) {
    return `Perfect run: ${score.totalScore}. 3/3 stars earned.`;
  }
  return `Mission complete: ${score.totalScore}. ${result.stars}/3 stars earned.`;
}

function settingsStatus(settings: GameSettings): string {
  return `${GRAPHICS_QUALITY_LABELS[settings.graphicsQuality]}, ${RENDERER_BACKEND_LABELS[settings.rendererBackend]} renderer, ${Math.round(settings.masterVolume * 100)}% volume, ${Math.round(settings.cameraShake * 100)}% shake`;
}

boot().catch((error: unknown) => {
  console.error(error);
  document.body.replaceChildren();
  const pre = document.createElement("pre");
  pre.style.color = "#fff";
  pre.style.background = "#111";
  pre.style.padding = "24px";
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = String(error);
  document.body.appendChild(pre);
});
