import * as THREE from "three";
import {
  evaluateMayhemContract,
  loadArcadeProgress,
  recordArcadeRun,
  saveArcadeProgress,
  type ArcadeLevelDefinition,
  type ArcadeProgress,
  type ArcadeResult
} from "./arcade";
import { DestructionAudio } from "./audio";
import { CameraRig } from "./cameraRig";
import { Cannon, type CannonVisualState } from "./cannon";
import { decorateFragment } from "./cityVisuals";
import { withSuppressedConsoleWarning } from "./consoleWarnings";
import { DestructionSystem, type ExplosionAffectedObject, type ExplosionResult } from "./destruction";
import { GAME_MODES } from "./gameMode";
import { InputController } from "./input";
import { TEST_CHAMBERS, type TestChamber } from "./levels";
import {
  chainMilestoneForCombo,
  dailyContractForDate,
  loadDailyResult,
  mayhemContractForRun,
  recordDailyResult,
  replayMomentFromEvents,
  replayTimelineFromEvents,
  runFeedbackForScore,
  runVariantForSeed,
  summarizeScoreSources,
  weeklyMayhemRouteForDate,
  type DailyContractDefinition,
  type MayhemContract,
  type RunFeedback,
  type RunVariant,
  type WeeklyMayhemRoute,
  type WeeklyMayhemRouteEntry
} from "./mayhemFeatures";
import { MaterialCatalog, type MaterialId } from "./materialCatalog";
import { perfMonitor, type PerfFrameSnapshot, type PerfReport } from "./perf";
import { PhysicsWorld, type PhysicsObject } from "./physics";
import {
  IGNITE_UNLOCK_LEVEL_COUNT,
  PROJECTILES,
  ProjectileSystem,
  projectileOrderForUnlockedLevels,
  type ActiveProjectile,
  type ProjectileDefinition,
  type ProjectileId
} from "./projectile";
import { SeededRandom, createRunSeed, randomRange } from "./random";
import { ShotRunState } from "./runState";
import { ScorePopupLayer } from "./scorePopups";
import { ShotScoreTracker, type ScoreBreakdown, type ScoreEvent } from "./scoring";
import {
  COMFORT_GAME_SETTINGS,
  DEFAULT_GAME_SETTINGS,
  effectiveGraphicsPixelRatio,
  GRAPHICS_QUALITY_LABELS,
  type GameSettings,
  type GraphicsQuality,
  graphicsPixelRatioCap,
  loadGameSettings,
  saveGameSettings,
  sanitizeGameSettings
} from "./settings";
import { ExplosionSystem, ParticleSystem } from "./vfx";
import { GameUI, type UILevelOption, type UILiveMastery, type UIResultMeta } from "./ui";
import { graphicTexture, preloadGraphicTextures } from "./visualAssets";
import { registerDowntownMayhemServiceWorker } from "./serviceWorker";
import { initializeRapierCompat } from "./rapierInit";

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
const SCORE_AUTO_REVEAL_GRACE_MS = 2500;
const SCORE_SETTLE_QUIET_MS = 1500;
const SCORE_RESIDUAL_ACTIVITY_MAX_WAIT_MS = 20_000;
const SCORE_COLLISION_BACKLOG_SETTLE_LIMIT = 28;
const SCORE_STRUCTURAL_SETTLED_SPEED = 0.95;
const SCORE_FAST_DEBRIS_SPEED = 3.6;
const SCORE_MOVING_DEBRIS_LIMIT = 18;
const SCORE_FAST_DEBRIS_LIMIT = 6;
const AIM_FALLBACK_SURFACE_Y = 0.055;
const AIM_MARKER_SURFACE_OFFSET = 0.095;
const FIRE_MIN_DELAY_MS = 760;
const FIRE_MAX_DELAY_MS = 1850;
const MAX_BURNING_HAZARDS = 8;
const HAZARD_EXPLOSIONS_MAX_PER_FRAME = 1;
const FIRE_SPREAD_MIN_DELAY_MS = 620;
const FIRE_SPREAD_MAX_DELAY_MS = 1380;
const FIRE_SPREAD_SCAN_INTERVAL_MS = 520;
const FIRE_SPREAD_CANDIDATE_LIMIT = 3;
const FIRE_SPREAD_MAX_CHILDREN = 1;
const SCATTER_PHYSICAL_SHARD_COUNT = 8;
const VOLATILE_TRIGGER_LIMIT_BY_DEPTH = [3, 1, 0] as const;
const CAMERA_FOCUS_MIN_SCORE = 155;
const CAMERA_FOCUS_LOCK_MS = 1100;
const CAMERA_FOCUS_DECAY_MS = 3400;
const MONEY_SHOT_LOCK_MS = 1250;
const MONEY_SHOT_PRIORITY_MARGIN = 80;
const PRIMARY_IMPACT_SHAKE_MAGNITUDE = 0.56;
const PRIMARY_IMPACT_SHAKE_DURATION = 0.96;
const PRIMARY_IMPACT_HIT_STOP_SECONDS = 0.072;
const PRIMARY_IMPACT_SLOWMO_SECONDS = 0.58;
const GRAVITY_IMPACT_SHAKE_MAGNITUDE = 0.62;
const GRAVITY_IMPACT_SHAKE_DURATION = 0.72;
const GRAVITY_IMPACT_HIT_STOP_SECONDS = 0.08;
const GRAVITY_IMPACT_SLOWMO_SECONDS = 0.42;
const HEAVY_PROJECTILE_CAMERA_RELEASE_SPEED = 9.5;
const HEAVY_PROJECTILE_CAMERA_RELEASE_AGE = 3.9;
const CANNON_DECK_OFFSETS = [
  new THREE.Vector3(0, -3.23, 1.9),
  new THREE.Vector3(-3.3, -0.22, 1.9),
  new THREE.Vector3(3.3, -0.22, 1.9)
];
const MAX_PROJECTILE_PENETRATIONS: Record<ProjectileId, number> = {
  slug: 0,
  scatter: 0,
  pulse: 0,
  gravity: 11,
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
const RENDER_WARMUP_MAX_DURATION_MS = 6_000;
const RENDER_WARMUP_POST_CLEANUP_MAX_DURATION_MS = 3_000;
const RENDER_WARMUP_SYNTHETIC_ORIGIN = new THREE.Vector3(72, 1.2, 72);
const RENDER_WARMUP_SYNTHETIC_DESTRUCTION_ZONE = "render-warmup-destruction";
const AIM_TRAFFIC_STEP_SECONDS = 1 / 24;
const AIM_TRAFFIC_MAX_ACCUMULATED_SECONDS = 0.12;
const DAY_SKY_RADIUS = 118;
const SUN_DIRECTION = new THREE.Vector3(-0.24, 0.22, -0.95).normalize();
const PREMIUM_DAYLIGHT_RENDER_ORDER = 6;
const PREMIUM_ATMOSPHERE_RENDER_ORDER = 1;
const ARCADE_LEVELS = TEST_CHAMBERS.map(chamberToArcadeLevel);

interface BurningHazard {
  id: number;
  label: string;
  origin: THREE.Vector3;
  ignitedAt: number;
  explodeAt: number;
  nextFxAt: number;
  nextSpreadAt: number;
  strength: number;
  radius: number;
  heatRadius: number;
  spreadCount: number;
  maxSpreadCount: number;
  materialId: PhysicsObject["materialId"];
  projectileId: ProjectileId;
  color: THREE.ColorRepresentation;
  powerScale: number;
  sizeScale: number;
  densityScale: number;
  cascadeDepth: number;
  mushroomCloud: boolean;
}

interface VolatileHazardProfile {
  strength: number;
  radius: number;
  heatRadius: number;
  projectileId: ProjectileId;
  color: THREE.ColorRepresentation;
  powerScale: number;
  sizeScale: number;
  densityScale: number;
  delayScale: number;
  maxSpreadCount: number;
  mushroomCloud?: boolean;
}

interface ImpactBlastProfile {
  strength: number;
  radius: number;
  visualRadius: number;
  audioPowerScale: number;
  vfxPowerScale: number;
  sizeScale: number;
  ignitionBias: number;
}

interface DowntownMayhemRenderStats {
  frame: number;
  levelName: string;
  rendererBackend: ActualRendererBackend;
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
  levelComposition: string;
}

interface DowntownMayhemDebugApi {
  getRenderStats(): DowntownMayhemRenderStats;
  getPerfReport(): PerfReport;
  getRenderWarmupState(): RenderWarmupState;
  getCannonVisualState(): CannonVisualState;
  getRunFeedback(): RunFeedback | null;
  getLiveMastery(): UILiveMastery | null;
  getDailyContract(): DailyContractDefinition | null;
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
  stagedVisualActivationMaxPerFrame?: number;
  stagedVisualActivationTimeBudgetMs?: number;
  deadlineAt?: number;
  statusPrefix?: string;
}

interface RenderWarmupProfile {
  label: string;
  compileAllCameras: boolean;
  brutalPasses: number;
  framesPerBrutalPass: number;
  minFrames: number;
  stableFrames: number;
  maxFrames: number;
  maxDurationMs: number;
  syntheticDestructionPasses: number;
  postCleanupEffectPasses: number;
  postCleanupEffectFrames: number;
  postCleanupStableFrames: number;
  postCleanupMaxFrames: number;
  postCleanupMaxDurationMs: number;
}

type RenderWarmupMode = "none" | "smoke" | "full";
type ActualRendererBackend = "webgl2" | "webgl";

const FULL_RENDER_WARMUP_PROFILE: RenderWarmupProfile = {
  label: "renderer pipelines",
  compileAllCameras: true,
  brutalPasses: RENDER_WARMUP_BRUTAL_PASSES,
  framesPerBrutalPass: RENDER_WARMUP_FRAMES_PER_BRUTAL_PASS,
  minFrames: RENDER_WARMUP_MIN_FRAMES,
  stableFrames: RENDER_WARMUP_STABLE_FRAMES,
  maxFrames: RENDER_WARMUP_MAX_FRAMES,
  maxDurationMs: RENDER_WARMUP_MAX_DURATION_MS,
  syntheticDestructionPasses: RENDER_WARMUP_SYNTHETIC_DESTRUCTION_PASSES,
  postCleanupEffectPasses: RENDER_WARMUP_POST_CLEANUP_EFFECT_PASSES,
  postCleanupEffectFrames: RENDER_WARMUP_POST_CLEANUP_EFFECT_FRAMES,
  postCleanupStableFrames: RENDER_WARMUP_POST_CLEANUP_STABLE_FRAMES,
  postCleanupMaxFrames: RENDER_WARMUP_POST_CLEANUP_MAX_FRAMES,
  postCleanupMaxDurationMs: RENDER_WARMUP_POST_CLEANUP_MAX_DURATION_MS
};

interface DowntownMayhemRendererBundle {
  renderer: THREE.WebGLRenderer;
  backend: ActualRendererBackend;
}

interface GraphicsLightingProfile {
  background: THREE.ColorRepresentation;
  fog: THREE.ColorRepresentation;
  fogNear: number;
  fogFar: number;
  exposure: number;
  ambientSky: THREE.ColorRepresentation;
  ambientGround: THREE.ColorRepresentation;
  ambientIntensity: number;
  sunColor: THREE.ColorRepresentation;
  sunIntensity: number;
  skyFillColor: THREE.ColorRepresentation;
  skyFillIntensity: number;
  shadowMapSize: number;
}

interface CanvasGradeProfile {
  filter: string;
  boxShadow: string;
}

declare global {
  interface Window {
    __DOWNTOWN_MAYHEM_DEBUG__?: DowntownMayhemDebugApi;
  }
}

function createDowntownMayhemRenderer(settings: GameSettings): DowntownMayhemRendererBundle {
  const renderer = new THREE.WebGLRenderer({
    alpha: false,
    antialias: settings.antialias,
    powerPreference: "high-performance"
  });
  configureDowntownMayhemRenderer(renderer, settings);
  return {
    renderer,
    backend: activeWebGlRendererBackend(renderer)
  };
}

function configureDowntownMayhemRenderer(renderer: THREE.WebGLRenderer, settings: GameSettings): void {
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  setOptionalShadowMapFlag(renderer, "autoUpdate", false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setPixelRatio(effectiveGraphicsPixelRatio(graphicsPixelRatioCap(settings.graphicsQuality)));
}

function activeWebGlRendererBackend(renderer: THREE.WebGLRenderer): ActualRendererBackend {
  return renderer.capabilities.isWebGL2 ? "webgl2" : "webgl";
}

function rendererDrawCalls(renderer: THREE.WebGLRenderer): number {
  const renderInfo = renderer.info.render as typeof renderer.info.render & { calls?: number; drawCalls?: number };
  return renderInfo.drawCalls ?? renderInfo.calls ?? 0;
}

function rendererProgramCount(renderer: THREE.WebGLRenderer): number {
  const memoryInfo = renderer.info.memory as typeof renderer.info.memory & { programs?: number };
  const rendererInfo = renderer.info as typeof renderer.info & { programs?: unknown[] };
  return memoryInfo.programs ?? rendererInfo.programs?.length ?? 0;
}

function setOptionalShadowMapFlag(renderer: THREE.WebGLRenderer, key: "autoUpdate" | "needsUpdate", value: boolean): void {
  (renderer.shadowMap as typeof renderer.shadowMap & Partial<Record<typeof key, boolean>>)[key] = value;
}

const PARALLEL_SHADER_COMPILE_WARNING = "THREE.WebGLRenderer: KHR_parallel_shader_compile extension not supported.";

function compileRendererPipelines(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<unknown> {
  return withSuppressedConsoleWarning(PARALLEL_SHADER_COMPILE_WARNING, () => renderer.compileAsync(scene, camera));
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

function currentRenderWarmupMode(): RenderWarmupMode {
  try {
    const search = new URLSearchParams(globalThis.location?.search ?? "");
    if (search.has("smoke")) {
      return "smoke";
    }
    if (search.has("fullWarmup")) {
      return "full";
    }
    return "none";
  } catch {
    return "none";
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

function nextTaskYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForDomPaint(): Promise<void> {
  await renderWarmupYield();
  await nextTaskYield();
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

function createDaySkyDome(textureRegistry: THREE.Texture[]): THREE.Group {
  const group = new THREE.Group();
  group.name = "Warm daytime sky";

  const skyTexture = createDaySkyTexture();
  textureRegistry.push(skyTexture);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(DAY_SKY_RADIUS, 32, 16),
    new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    })
  );
  sky.name = "Soft blue daytime sky gradient";
  sky.renderOrder = -100;
  group.add(sky);

  const sunPosition = SUN_DIRECTION.clone().multiplyScalar(DAY_SKY_RADIUS * 0.72);
  const haloTexture = createSunHaloTexture();
  textureRegistry.push(haloTexture);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: haloTexture,
      color: 0xffe4a6,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      blending: THREE.NormalBlending
    })
  );
  halo.name = "Warm sun halo";
  halo.position.copy(sunPosition);
  halo.scale.set(54, 54, 1);
  halo.renderOrder = -40;
  group.add(halo);

  const sunTexture = createSunTexture();
  textureRegistry.push(sunTexture);
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: sunTexture,
      color: 0xffdd84,
      transparent: true,
      opacity: 0.96,
      depthWrite: false,
      blending: THREE.NormalBlending
    })
  );
  sun.name = "Soft midday sun";
  sun.position.copy(sunPosition.clone().multiplyScalar(0.995));
  sun.scale.set(15.4, 15.4, 1);
  sun.renderOrder = -35;
  group.add(sun);

  return group;
}

function createDaySkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create daytime sky texture context");
  }

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#2d6f9d");
  gradient.addColorStop(0.34, "#6aa9c4");
  gradient.addColorStop(0.72, "#b7c3b6");
  gradient.addColorStop(1, "#d0a15b");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const horizonGlow = context.createRadialGradient(
    canvas.width * 0.48,
    canvas.height * 1.08,
    24,
    canvas.width * 0.48,
    canvas.height * 1.08,
    canvas.width * 0.64
  );
  horizonGlow.addColorStop(0, "rgba(230, 198, 130, 0.34)");
  horizonGlow.addColorStop(0.46, "rgba(190, 137, 72, 0.18)");
  horizonGlow.addColorStop(1, "rgba(118, 190, 255, 0)");
  context.fillStyle = horizonGlow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const sunWash = context.createRadialGradient(
    canvas.width * 0.3,
    canvas.height * 0.36,
    16,
    canvas.width * 0.3,
    canvas.height * 0.36,
    canvas.width * 0.38
  );
  sunWash.addColorStop(0, "rgba(255, 220, 142, 0.44)");
  sunWash.addColorStop(0.34, "rgba(218, 139, 58, 0.2)");
  sunWash.addColorStop(1, "rgba(236, 205, 137, 0)");
  context.fillStyle = sunWash;
  context.fillRect(0, 0, canvas.width, canvas.height);

  paintCloud(context, 150, 128, 1.25, 0.13);
  paintCloud(context, 378, 96, 0.92, 0.1);
  paintCloud(context, 724, 146, 1.5, 0.11);
  paintCloud(context, 884, 216, 1.08, 0.08);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createSkyReflectionTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create sky reflection texture context");
  }

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#448caf");
  gradient.addColorStop(0.44, "#9ebfc4");
  gradient.addColorStop(0.58, "#cfa064");
  gradient.addColorStop(1, "#141f24");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const sun = context.createRadialGradient(canvas.width * 0.22, canvas.height * 0.22, 5, canvas.width * 0.22, canvas.height * 0.22, 98);
  sun.addColorStop(0, "rgba(255, 240, 188, 0.58)");
  sun.addColorStop(0.34, "rgba(229, 172, 77, 0.2)");
  sun.addColorStop(1, "rgba(255, 216, 122, 0)");
  context.fillStyle = sun;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = "rgba(19, 34, 40, 0.52)";
  for (const [x, width, height] of [
    [18, 18, 42],
    [48, 34, 68],
    [96, 22, 54],
    [138, 44, 82],
    [216, 28, 62],
    [278, 56, 74],
    [356, 28, 96],
    [404, 42, 66],
    [468, 22, 50]
  ] as const) {
    context.fillRect(x, canvas.height - height, width, height);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createGroundSunlightTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create ground sunlight texture context");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  const wash = context.createRadialGradient(170, 132, 20, 196, 166, 470);
  wash.addColorStop(0, "rgba(248, 224, 156, 0.2)");
  wash.addColorStop(0.42, "rgba(218, 158, 72, 0.085)");
  wash.addColorStop(1, "rgba(218, 174, 84, 0)");
  context.fillStyle = wash;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.translate(230, 258);
  context.rotate(-0.25);
  for (let index = -2; index <= 2; index += 1) {
    const x = index * 118;
    const band = context.createLinearGradient(x - 42, -260, x + 78, 260);
    band.addColorStop(0, "rgba(255, 255, 255, 0)");
    band.addColorStop(0.42, "rgba(244, 214, 135, 0.045)");
    band.addColorStop(0.5, "rgba(220, 158, 72, 0.095)");
    band.addColorStop(0.58, "rgba(244, 214, 135, 0.045)");
    band.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = band;
    context.fillRect(x - 46, -320, 124, 640);
  }
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create contact shadow texture context");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  const shadow = context.createRadialGradient(256, 256, 24, 256, 256, 236);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0.34)");
  shadow.addColorStop(0.46, "rgba(0, 0, 0, 0.18)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = shadow;
  context.save();
  context.scale(1, 0.58);
  context.beginPath();
  context.arc(256, 438, 236, 0, Math.PI * 2);
  context.fill();
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createDistantAtmosphereTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create distant atmosphere texture context");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  const airGlow = context.createRadialGradient(
    canvas.width * 0.42,
    canvas.height * 0.16,
    12,
    canvas.width * 0.44,
    canvas.height * 0.52,
    canvas.width * 0.58
  );
  airGlow.addColorStop(0, "rgba(230, 244, 248, 0.045)");
  airGlow.addColorStop(0.42, "rgba(166, 205, 216, 0.06)");
  airGlow.addColorStop(1, "rgba(190, 231, 240, 0)");
  context.fillStyle = airGlow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const haze = context.createLinearGradient(0, canvas.height * 0.55, 0, canvas.height);
  haze.addColorStop(0, "rgba(188, 235, 255, 0)");
  haze.addColorStop(0.5, "rgba(176, 212, 222, 0.045)");
  haze.addColorStop(0.8, "rgba(216, 180, 112, 0.07)");
  haze.addColorStop(1, "rgba(246, 219, 170, 0)");
  context.fillStyle = haze;
  context.fillRect(0, 0, canvas.width, canvas.height);

  paintDistantSkyline(context, canvas.width, canvas.height);

  context.save();
  context.translate(canvas.width * 0.5, canvas.height * 0.68);
  context.rotate(-0.04);
  for (let index = -3; index <= 3; index += 1) {
    const x = index * 165;
    const band = context.createLinearGradient(x - 130, 0, x + 180, 0);
    band.addColorStop(0, "rgba(255, 255, 255, 0)");
    band.addColorStop(0.5, "rgba(205, 223, 222, 0.035)");
    band.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = band;
    context.fillRect(x - 145, -18, 330, 36);
  }
  context.restore();
  applyAtmosphereTextureFade(context, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function paintDistantSkyline(context: CanvasRenderingContext2D, width: number, height: number): void {
  const skylineBase = height * 0.9;
  const rearTowers = [
    [18, 34, 96],
    [78, 46, 142],
    [146, 28, 112],
    [212, 64, 164],
    [318, 38, 136],
    [392, 76, 182],
    [512, 32, 118],
    [594, 58, 152],
    [690, 42, 104],
    [760, 84, 172],
    [900, 42, 126],
    [962, 34, 96]
  ] as const;
  const frontTowers = [
    [44, 42, 78],
    [118, 60, 104],
    [242, 44, 92],
    [288, 74, 118],
    [442, 62, 102],
    [552, 94, 132],
    [668, 44, 86],
    [826, 66, 108],
    [936, 56, 92]
  ] as const;

  context.save();
  context.fillStyle = "rgba(30, 48, 55, 0.2)";
  for (const [x, towerWidth, towerHeight] of rearTowers) {
    paintSkylineTower(context, x, skylineBase, towerWidth, towerHeight, 0.2);
  }
  context.fillStyle = "rgba(20, 34, 42, 0.26)";
  for (const [x, towerWidth, towerHeight] of frontTowers) {
    paintSkylineTower(context, x, skylineBase + 8, towerWidth, towerHeight, 0.32);
  }
  context.restore();

  const skylineFade = context.createLinearGradient(0, height * 0.5, 0, height);
  skylineFade.addColorStop(0, "rgba(188, 226, 234, 0)");
  skylineFade.addColorStop(0.68, "rgba(188, 226, 234, 0.06)");
  skylineFade.addColorStop(1, "rgba(232, 207, 158, 0.12)");
  context.fillStyle = skylineFade;
  context.fillRect(0, height * 0.45, width, height * 0.55);
}

function paintSkylineTower(context: CanvasRenderingContext2D, x: number, baseY: number, width: number, height: number, windowOpacity: number): void {
  const towerFill = context.fillStyle;
  const topY = baseY - height;
  context.fillRect(x, topY, width, height);
  if (height > 130) {
    context.fillRect(x + width * 0.42, topY - 28, width * 0.16, 28);
  }
  context.fillStyle = "rgba(180, 226, 232, 0.08)";
  context.fillRect(x + width * 0.08, topY + 8, width * 0.08, height - 12);
  context.fillStyle = `rgba(245, 222, 158, ${windowOpacity})`;
  const columns = Math.max(2, Math.floor(width / 14));
  const rows = Math.max(3, Math.floor(height / 18));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if ((row * 7 + column * 11 + Math.floor(x)) % 5 === 0) {
        continue;
      }
      context.fillRect(x + 7 + column * ((width - 14) / columns), topY + 14 + row * 15, Math.max(2, width * 0.055), 3);
    }
  }
  context.fillStyle = towerFill;
}

function createIndustrialHazeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create industrial haze texture context");
  }

  context.clearRect(0, 0, canvas.width, canvas.height);
  const base = context.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, "rgba(210, 242, 255, 0)");
  base.addColorStop(0.36, "rgba(166, 208, 218, 0.058)");
  base.addColorStop(0.72, "rgba(209, 166, 96, 0.088)");
  base.addColorStop(1, "rgba(240, 205, 149, 0)");
  context.fillStyle = base;
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const band of [
    [18, 82, 0.18, 0.074],
    [118, 118, -0.1, 0.062],
    [260, 68, 0.08, 0.052],
    [344, 148, -0.16, 0.058]
  ] as const) {
    const [x, y, tilt, opacity] = band;
    context.save();
    context.translate(x, y);
    context.rotate(tilt);
    const gradient = context.createLinearGradient(-150, 0, 190, 0);
    gradient.addColorStop(0, "rgba(210, 237, 240, 0)");
    gradient.addColorStop(0.48, `rgba(210, 237, 240, ${opacity})`);
    gradient.addColorStop(1, "rgba(210, 237, 240, 0)");
    context.fillStyle = gradient;
    context.fillRect(-160, -12, 360, 24);
    context.restore();
  }
  applyHazeTextureFade(context, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function applyAtmosphereTextureFade(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  context.globalCompositeOperation = "destination-in";
  const horizontal = context.createLinearGradient(0, 0, width, 0);
  horizontal.addColorStop(0, "rgba(0, 0, 0, 0)");
  horizontal.addColorStop(0.08, "rgba(0, 0, 0, 1)");
  horizontal.addColorStop(0.92, "rgba(0, 0, 0, 1)");
  horizontal.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = horizontal;
  context.fillRect(0, 0, width, height);

  const vertical = context.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, "rgba(0, 0, 0, 0)");
  vertical.addColorStop(0.16, "rgba(0, 0, 0, 0.92)");
  vertical.addColorStop(0.86, "rgba(0, 0, 0, 1)");
  vertical.addColorStop(1, "rgba(0, 0, 0, 0.56)");
  context.fillStyle = vertical;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function applyHazeTextureFade(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save();
  context.globalCompositeOperation = "destination-in";
  const horizontal = context.createLinearGradient(0, 0, width, 0);
  horizontal.addColorStop(0, "rgba(0, 0, 0, 0)");
  horizontal.addColorStop(0.12, "rgba(0, 0, 0, 1)");
  horizontal.addColorStop(0.88, "rgba(0, 0, 0, 1)");
  horizontal.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = horizontal;
  context.fillRect(0, 0, width, height);

  const vertical = context.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, "rgba(0, 0, 0, 0)");
  vertical.addColorStop(0.2, "rgba(0, 0, 0, 0.88)");
  vertical.addColorStop(0.74, "rgba(0, 0, 0, 0.82)");
  vertical.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = vertical;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function paintCloud(context: CanvasRenderingContext2D, x: number, y: number, scale: number, opacity: number): void {
  const cloud = context.createRadialGradient(x, y, 4, x, y, 92 * scale);
  cloud.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
  cloud.addColorStop(0.48, `rgba(255, 255, 255, ${opacity * 0.58})`);
  cloud.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = cloud;
  context.beginPath();
  context.ellipse(x, y, 128 * scale, 32 * scale, -0.08, 0, Math.PI * 2);
  context.fill();
}

function createSunTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create sun texture context");
  }

  const body = context.createRadialGradient(96, 82, 4, 128, 128, 116);
  body.addColorStop(0, "rgba(255, 255, 255, 1)");
  body.addColorStop(0.34, "rgba(255, 245, 198, 1)");
  body.addColorStop(0.74, "rgba(255, 199, 68, 0.98)");
  body.addColorStop(1, "rgba(255, 145, 24, 0)");
  context.fillStyle = body;
  context.beginPath();
  context.arc(128, 128, 112, 0, Math.PI * 2);
  context.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createSunHaloTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create sun halo texture context");
  }
  const glow = context.createRadialGradient(128, 128, 4, 128, 128, 126);
  glow.addColorStop(0, "rgba(255, 255, 255, 0.8)");
  glow.addColorStop(0.18, "rgba(255, 230, 158, 0.42)");
  glow.addColorStop(0.56, "rgba(255, 183, 80, 0.14)");
  glow.addColorStop(1, "rgba(255, 183, 80, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

type AppShellScreen = "menu" | "settings" | "loading";

interface AppShellCallbacks {
  startLevel(levelIndex: number): void;
  startDaily(contract: DailyContractDefinition): void;
  startWeekly(entry: WeeklyMayhemRouteEntry): void;
}

class AppShell {
  private readonly root: HTMLDivElement;
  private readonly levelRail: HTMLDivElement;
  private readonly statusValue: HTMLDivElement;
  private readonly progressSummaryValue: HTMLDivElement;
  private readonly dailyValue: HTMLDivElement;
  private readonly weeklyValue: HTMLDivElement;
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

  private screen: AppShellScreen = "menu";
  private busy = false;
  private settings = loadGameSettings();
  private progress = loadArcadeProgress(ARCADE_LEVELS);
  private dailyContract: DailyContractDefinition | null = null;
  private weeklyRoute: WeeklyMayhemRoute | null = null;
  private weeklyStartEntry: WeeklyMayhemRouteEntry | null = null;
  private renderedLevelKey = "";
  private renderedDailyKey = "";
  private renderedWeeklyKey = "";
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
            <p>Choose a district, wait through the renderer warmup, then make one spectacular cannon shot count.</p>
            <div class="app-shell__progress" data-role="shell-progress"></div>
            <div class="app-shell__daily" data-role="shell-daily"></div>
            <div class="app-shell__weekly" data-role="shell-weekly"></div>
            <div class="app-shell__status" data-role="shell-status"></div>
          </section>
          <section class="app-shell__levels" data-role="shell-levels" aria-label="Districts"></section>
        </main>
      </section>

      <section class="app-shell__settings" aria-label="Settings">
        <div class="app-shell__settings-panel">
          <div class="app-shell__settings-head">
            <button type="button" data-action="menu">Back</button>
            <button type="button" data-action="settings-comfort">Comfort</button>
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
    this.progressSummaryValue = this.requireElement("[data-role='shell-progress']");
    this.dailyValue = this.requireElement("[data-role='shell-daily']");
    this.weeklyValue = this.requireElement("[data-role='shell-weekly']");
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
    if (action === "start-daily") {
      if (this.dailyContract) {
        this.callbacks.startDaily(this.dailyContract);
      }
      return;
    }
    if (action === "start-weekly") {
      if (this.weeklyStartEntry) {
        this.callbacks.startWeekly(this.weeklyStartEntry);
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
    if (action === "settings-comfort") {
      this.updateSettings({ ...COMFORT_GAME_SETTINGS });
      return;
    }

    const quality = target.dataset.quality;
    if (quality === "performance" || quality === "balanced" || quality === "cinematic") {
      this.updateSettings({ graphicsQuality: quality });
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
    this.renderDaily();
    this.renderWeekly();
    this.renderSettings();
  }

  private renderLevels(): void {
    const key = [
      this.progress.highestUnlockedLevel,
      this.progress.totalStars,
      ...TEST_CHAMBERS.flatMap((level, index) => {
        const progress = this.progress.levels[level.id];
        return [
          index,
          level.name,
          level.objective,
          progress?.stars ?? 0,
          progress?.bestScore ?? 0,
          progress?.attempts ?? 0,
          progress?.threeStarCleared ? 1 : 0,
          progress?.bestProjectileId ?? "none",
          progress?.bestCombo ?? 0
        ];
      })
    ].join("|");
    if (this.renderedLevelKey === key) {
      return;
    }
    this.renderedLevelKey = key;
    const unlockedDistricts = Math.max(0, Math.min(TEST_CHAMBERS.length, this.progress.highestUnlockedLevel + 1));
    const perfectDistricts = TEST_CHAMBERS.filter((level) => this.progress.levels[level.id]?.threeStarCleared).length;
    setText(
      this.progressSummaryValue,
      `Campaign ${this.progress.totalStars}/${TEST_CHAMBERS.length * 3} stars / ${unlockedDistricts}/${TEST_CHAMBERS.length} districts open / Mastery ${perfectDistricts}/${TEST_CHAMBERS.length}`
    );
    this.levelRail.innerHTML = TEST_CHAMBERS.map((level, index) => {
      const progress = this.progress.levels[level.id];
      const locked = index > this.progress.highestUnlockedLevel;
      const stars = progress?.stars ?? 0;
      const bestScore = progress?.bestScore ?? 0;
      const attempts = progress?.attempts ?? 0;
      const previousLevel = TEST_CHAMBERS[index - 1];
      const previousProgress = previousLevel ? this.progress.levels[previousLevel.id] : null;
      const missingStars = previousProgress ? Math.max(0, 2 - previousProgress.stars) : 0;
      const progressText = locked
        ? `LOCKED / ${missingStars} more ${missingStars === 1 ? "star" : "stars"}`
        : `${stars}/3 stars`;
      const lockedText = previousLevel
        ? `Earn ${missingStars} more ${missingStars === 1 ? "star" : "stars"} on ${previousLevel.name}.`
        : "Earn 2 stars on the previous district.";
      const missionBrief = `${level.description} Target ${formatShellScore(level.mission.targetDamageThreshold)} object damage, ${formatShellScore(level.mission.scoreThresholds.twoStar)} for unlock, ${formatShellScore(level.mission.scoreThresholds.threeStar)} for 3 stars.`;
      const routeBrief = "Campaign district: choose any unlocked payload, chase 2 stars to open the next district.";
      const payloadLine = index + 1 >= IGNITE_UNLOCK_LEVEL_COUNT
        ? "New payload unlocked: Ignite"
        : "Campaign payloads: Normal, Frag, Impulse, Heavy";
      const masteryLine = progressMasteryLine(progress);
      const ariaLabel = locked
        ? `${level.name}, locked. ${lockedText}`
        : `${level.name}, ${level.objective}. ${missionBrief} ${attempts} attempts, best ${formatShellScore(bestScore)}. ${masteryLine}.`;
      return `
        <button type="button" class="app-shell__level-card${locked ? " is-locked" : ""}" data-action="start-arcade" data-level-index="${index}" aria-label="${escapeShellHtml(ariaLabel)}" title="${escapeShellHtml(locked ? lockedText : missionBrief)}" ${locked ? "disabled" : ""}>
          <span>${String(index + 1).padStart(2, "0")} / ${progressText}</span>
          <strong>${escapeShellHtml(level.name)}</strong>
          <em>${escapeShellHtml(level.objective)}</em>
          <small>${escapeShellHtml(locked ? lockedText : missionBrief)}</small>
          <small>${locked ? "Previous district gate: 2 stars" : escapeShellHtml(routeBrief)}</small>
          <small>${locked ? "Payload preview hidden until unlock" : escapeShellHtml(payloadLine)}</small>
          <small>${locked ? "Mastery hidden until unlock" : `Start ${GAME_MODES.cannon.name} / ${formatShellScore(attempts)} attempts / Best ${formatShellScore(bestScore)}`}</small>
          <small>${locked ? "Mastery hidden until unlock" : escapeShellHtml(masteryLine)}</small>
        </button>
      `;
    }).join("");
  }

  private renderDaily(): void {
    const unlockedCount = Math.max(0, Math.min(TEST_CHAMBERS.length, this.progress.highestUnlockedLevel + 1));
    this.dailyContract = dailyContractForDate(TEST_CHAMBERS.slice(0, unlockedCount));
    const daily = this.dailyContract;
    const dailyBest = daily ? loadDailyResult(daily) : null;
    const key = daily
      ? [
          daily.dateKey,
          daily.levelIndex,
          daily.projectileId,
          daily.variant.id,
          daily.contract.id,
          dailyBest?.attempts ?? 0,
          dailyBest?.bestScore ?? 0,
          dailyBest?.bestStars ?? 0,
          dailyBest?.bestContractCompleted ? 1 : 0
        ].join("|")
      : "none";
    if (this.renderedDailyKey === key) {
      return;
    }
    this.renderedDailyKey = key;
    if (!daily) {
      this.dailyValue.innerHTML = "";
      return;
    }
    const level = TEST_CHAMBERS[daily.levelIndex];
    const projectile = PROJECTILES[daily.projectileId];
    const bestLine = dailyBest
      ? `Best ${formatShellScore(dailyBest.bestScore)} / ${dailyBest.bestStars}/3 stars / ${dailyBest.attempts} attempts`
      : "No daily score yet";
    const replayLine = dailyBest ? "Replay today's fixed seed and improve the share card" : "Play today's fixed seed for a shareable result";
    const routeLine = "Daily fixed seed: same district, same payload, same contract all UTC day.";
    this.dailyValue.innerHTML = `
      <button type="button" data-action="start-daily" aria-label="Daily Contract, ${escapeShellHtml(level.name)}. ${escapeShellHtml(replayLine)}.">
        <span>Daily Contract / ${escapeShellHtml(daily.dateKey)}</span>
        <strong>${escapeShellHtml(level.name)}</strong>
        <em>Fixed payload: ${escapeShellHtml(projectile.shortName)} / ${escapeShellHtml(daily.contract.label)} / ${escapeShellHtml(daily.contract.summary)}</em>
        <small>${escapeShellHtml(routeLine)}</small>
        <small>${escapeShellHtml(replayLine)}</small>
        <small>${escapeShellHtml(bestLine)}</small>
      </button>
    `;
  }

  private renderWeekly(): void {
    this.weeklyRoute = weeklyMayhemRouteForDate(TEST_CHAMBERS, new Date(), this.progress);
    const route = this.weeklyRoute;
    const unlockedHighest = this.progress.highestUnlockedLevel;
    this.weeklyStartEntry =
      route.entries.find((entry) => entry.levelIndex <= unlockedHighest && entry.localBestStars < 2) ??
      route.entries.find((entry) => entry.levelIndex <= unlockedHighest) ??
      null;
    const key = [
      route.weekKey,
      route.seed,
      route.localCumulativeBestScore,
      route.localCompletedRuns,
      route.localStars,
      this.weeklyStartEntry?.levelId ?? "none",
      this.weeklyStartEntry?.projectileId ?? "none"
    ].join("|");
    if (this.renderedWeeklyKey === key) {
      return;
    }
    this.renderedWeeklyKey = key;
    if (!this.weeklyStartEntry) {
      this.weeklyValue.innerHTML = "";
      return;
    }

    const nextLevel = TEST_CHAMBERS[this.weeklyStartEntry.levelIndex];
    const nextProjectile = PROJECTILES[this.weeklyStartEntry.projectileId];
    const routeLine = route.entries
      .map((entry) => `${TEST_CHAMBERS[entry.levelIndex]?.name ?? entry.levelId} ${PROJECTILES[entry.projectileId].shortName}`)
      .join(" / ");
    const routeStatus = `${route.localCompletedRuns}/${route.entries.length} cleared / ${route.localStars}/${route.entries.length * 3} stars / ${formatShellScore(route.localCumulativeBestScore)} cumulative`;
    const weeklyModeLine = "Weekly fixed payload route: five seeded stops, payload locked per stop, cumulative score chase.";
    this.weeklyValue.innerHTML = `
      <button type="button" data-action="start-weekly" aria-label="Weekly Fixed Payload Route, ${escapeShellHtml(nextLevel.name)} with ${escapeShellHtml(nextProjectile.shortName)}.">
        <span>Weekly Fixed Payload Route / ${escapeShellHtml(route.weekKey)}</span>
        <strong>${escapeShellHtml(nextLevel.name)} next</strong>
        <em>Fixed payload: ${escapeShellHtml(nextProjectile.shortName)} / ${escapeShellHtml(this.weeklyStartEntry.contract.label)} / ${escapeShellHtml(this.weeklyStartEntry.contract.summary)}</em>
        <small>${escapeShellHtml(weeklyModeLine)}</small>
        <small>${escapeShellHtml(routeStatus)}</small>
        <small>${escapeShellHtml(routeLine)}</small>
      </button>
    `;
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

function progressMasteryLine(progress: ArcadeProgress["levels"][string] | undefined): string {
  const bestProjectile = progress?.bestProjectileId ? PROJECTILES[progress.bestProjectileId].shortName : "No payload best";
  const combo = progress?.bestCombo && progress.bestCombo > 0 ? `x${formatShellScore(progress.bestCombo)} combo` : "no combo best";
  const perfect = progress?.threeStarCleared ? "3-star badge" : "3-star badge open";
  return `District Mastery: ${perfect} / ${bestProjectile} / ${combo}`;
}

function weeklyEntryToFixedContract(entry: WeeklyMayhemRouteEntry): DailyContractDefinition {
  return {
    dateKey: entry.weekKey,
    seed: entry.seed,
    levelIndex: entry.levelIndex,
    levelId: entry.levelId,
    projectileId: entry.projectileId,
    variant: entry.variant,
    contract: entry.contract
  };
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
    .app-shell__daily span,
    .app-shell__daily em,
    .app-shell__daily small,
    .app-shell__weekly span,
    .app-shell__weekly em,
    .app-shell__weekly small,
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
    .app-shell__daily button,
    .app-shell__weekly button,
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

    .app-shell__progress {
      min-height: 38px;
      width: min(420px, 100%);
      padding: 10px 12px;
      border: 1px solid rgba(255, 207, 105, 0.22);
      border-radius: 7px;
      color: #ffe08b;
      background: rgba(255, 207, 105, 0.08);
      font-size: 13px;
      font-weight: 900;
      line-height: 1.25;
    }

    .app-shell__levels {
      display: grid;
      gap: 10px;
      min-width: 0;
    }

    .app-shell__daily,
    .app-shell__weekly {
      width: min(520px, 100%);
    }

    .app-shell__daily button,
    .app-shell__weekly button {
      display: grid;
      gap: 5px;
      width: 100%;
      min-height: 88px;
      padding: 12px;
      text-align: left;
      border-color: rgba(255, 207, 105, 0.34);
      background: rgba(255, 207, 105, 0.1);
    }

    .app-shell__weekly button {
      border-color: rgba(117, 230, 255, 0.34);
      background: rgba(117, 230, 255, 0.1);
    }

    .app-shell__daily button:hover,
    .app-shell__daily button:focus-visible,
    .app-shell__weekly button:hover,
    .app-shell__weekly button:focus-visible {
      border-color: rgba(255, 224, 139, 0.86);
      background: rgba(255, 207, 105, 0.16);
      outline: none;
    }

    .app-shell__weekly button:hover,
    .app-shell__weekly button:focus-visible {
      border-color: rgba(147, 246, 255, 0.86);
      background: rgba(117, 230, 255, 0.16);
    }

    .app-shell__daily strong,
    .app-shell__weekly strong {
      color: #ffffff;
      font-size: 17px;
      line-height: 1.05;
    }

    .app-shell__daily em,
    .app-shell__weekly em {
      color: #b8ccd6;
      font-size: 12px;
      font-style: normal;
      line-height: 1.25;
    }

    .app-shell__daily small,
    .app-shell__weekly small {
      color: #ffe08b;
      font-size: 12px;
      font-weight: 900;
      line-height: 1.25;
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
      line-height: 1.3;
      overflow-wrap: anywhere;
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
  dailyContract?: DailyContractDefinition | null;
  challengeKind?: "daily" | "weekly";
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
  let max = 0;
  for (const frame of frames) {
    max = Math.max(max, readValue(frame) ?? 0);
  }
  return max;
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
  private readonly renderer: THREE.WebGLRenderer;
  private readonly rendererBackend: ActualRendererBackend;
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
  private readonly fireSpreadCandidates: PhysicsObject[] = [];
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
  private readonly premiumSceneTextures: THREE.Texture[] = [];
  private skyReflectionTexture: THREE.Texture | null = null;
  private renderWarmupGroup: THREE.Group | null = null;
  private ambientLight: THREE.HemisphereLight | null = null;
  private sunKeyLight: THREE.DirectionalLight | null = null;
  private skyFillLight: THREE.DirectionalLight | null = null;
  private readonly renderWarmupPersistentObjects: THREE.Object3D[] = [];
  private readonly handleResize = () => this.resize();
  private readonly handleBeforeUnload = () => this.input.dispose();
  private readonly chainImpactCooldowns = new Map<string, number>();
  private readonly surfaceImpactCooldowns = new Map<number, number>();
  private readonly processedSurfaceImpactObjectIds = new Set<number>();
  private readonly triggeredHazards = new Set<number>();
  private readonly burningHazards = new Map<number, BurningHazard>();
  private readonly visibleRenderMaterialsScratch = new Set<THREE.Material>();

  private settings: GameSettings;
  private selectedProjectile: ProjectileId = "slug";
  private powerScale = 1;
  private sizeScale = 1;
  private levelIndex = 0;
  private arcadeProgress = loadArcadeProgress(ARCADE_LEVELS);
  private levelOptionsCache: UILevelOption[] | null = null;
  private levelOptionsCacheProgress: ArcadeProgress | null = null;
  private arcadeResult: ArcadeResult | null = null;
  private arcadeResultMeta: UIResultMeta | null = null;
  private runFeedback: RunFeedback | null = null;
  private runSeed = createRunSeed();
  private runVariant: RunVariant = runVariantForSeed("hazard-junction", this.runSeed);
  private mayhemContract: MayhemContract | null = null;
  private shotMayhemContract: MayhemContract | null = null;
  private primaryImpactStarted = false;
  private readonly runScoreEvents: ScoreEvent[] = [];
  private readonly chainMilestonesAwarded = new Set<number>();
  private scoreReadyToFinalize = false;
  private scoreAutoRevealAt: number | null = null;
  private scoreSpectacleStartedAt: number | null = null;
  private scoreSettleLastActivityAt: number | null = null;
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
  private moneyShotScore = 0;
  private moneyShotLockedUntil = 0;
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
    fragmentInstanceOverflowBuckets: 0,
    levelComposition: "structure/debris mix"
  };

  constructor(settings: GameSettings, rendererBundle: DowntownMayhemRendererBundle, private readonly options: GameOptions = {}) {
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) {
      throw new Error("Missing #app");
    }

    this.settings = settings;
    this.renderer = rendererBundle.renderer;
    this.rendererBackend = rendererBundle.backend;
    this.renderer.domElement.dataset.rendererBackend = this.rendererBackend;
    app.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xa8dcff);
    this.scene.fog = new THREE.Fog(0xd9eef2, 66, 148);
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
      focusReplayMoment: (index) => this.focusReplayMoment(index),
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

    this.scene.add(createDaySkyDome(this.premiumSceneTextures));
    this.configureLights();
    this.applySettings();
    this.buildArena();
    this.levelIndex = clampInitialLevelIndex(options.initialLevelIndex, this.arcadeProgress.highestUnlockedLevel);
    this.loadLevel();
    this.audio.preload();
    this.resize();
    this.prepareRenderWarmup(currentRenderWarmupMode());
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

  getCannonVisualState(): CannonVisualState {
    return this.cannon.getVisualState();
  }

  getRunFeedback(): RunFeedback | null {
    return this.runFeedback;
  }

  getLiveMastery(): UILiveMastery | null {
    return this.liveMasteryPreview();
  }

  getDailyContract(): DailyContractDefinition | null {
    return this.options.challengeKind === "daily" ? (this.options.dailyContract ?? null) : null;
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
    if (this.runState.phase === "aim") {
      this.cameraRig.setCityAimView(this.cannon.getCameraAnchor(), this.currentLevel().cameraTarget);
    }
    this.cameraRig.snapToDesiredView();
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
    this.scene.remove(this.aimMarker);
    disposeObject(this.aimMarker, disposedMaterials);
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
    this.scene.environment = null;
    this.skyReflectionTexture = null;
    for (const texture of this.premiumSceneTextures) {
      texture.dispose();
    }
    this.premiumSceneTextures.length = 0;
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
        this.physics.updateTrafficVisuals(delta);
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
      this.pushScoreEvents(chainEvents);
      startedAt = perfMonitor.timeStart();
      const fireEvents = this.updateBurningHazards();
      perfMonitor.addTiming("game.updateBurningHazards", startedAt);
      this.pushScoreEvents(fireEvents);
      startedAt = perfMonitor.timeStart();
      this.updatePhase(simulationDelta * timeScale);
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
      availableProjectiles: this.availableProjectileIds(),
      shotAvailable: this.runState.shotAvailable,
      canFinishRun: this.runState.phase === "spectacle" && !this.runState.score && this.scoreReadyToFinalize,
      bodyCount: this.physics.getDynamicBodyCount(),
      levelName: level.name,
      levelDescription: level.description,
      objective: this.objectiveBrief(level),
      chaosBrief: this.chaosBrief(level),
      levelSignal: this.levelSignal(level),
      mission: level.mission,
      levelIndex: this.levelIndex,
      levelCount: TEST_CHAMBERS.length,
      levels: this.levelOptions(),
      levelProgress: this.currentLevelProgress(),
      totalStars: this.arcadeProgress.totalStars,
      arcadeResult: this.arcadeResult,
      resultMeta: this.arcadeResultMeta,
      runFeedback: this.runFeedback,
      loadoutLocked: Boolean(this.activeFixedContract()),
      settings: this.settings,
      status: this.status,
      fps: this.displayedFps,
      liveScore: this.liveScorePreview(),
      liveMastery: this.liveMasteryPreview(),
      score: this.runState.score
    });
  }

  private liveScorePreview(): ScoreBreakdown | null {
    if (this.runState.phase !== "spectacle" || this.runState.score) {
      return null;
    }
    return this.scoreTracker.preview();
  }

  private liveMasteryPreview(): UILiveMastery | null {
    const score = this.liveScorePreview();
    if (!score) {
      return null;
    }
    const level = this.currentLevel();
    const scoreTarget =
      score.totalScore < level.mission.scoreThresholds.oneStar
        ? level.mission.scoreThresholds.oneStar
        : score.totalScore < level.mission.scoreThresholds.twoStar
          ? level.mission.scoreThresholds.twoStar
          : level.mission.scoreThresholds.threeStar;
    const bonusMetric = level.mission.bonusThreshold.metric;
    const bonusValue = score[bonusMetric];
    const bonusTarget = level.mission.bonusThreshold.minimum;
    const contractResult = evaluateMayhemContract(this.shotMayhemContract?.objectives ?? this.mayhemContract?.objectives, score, {
      projectileId: this.selectedProjectile
    });
    const completedContract = contractResult?.objectives.filter((objective) => objective.completed).length ?? 0;
    const totalContract = contractResult?.objectives.length ?? 0;
    return {
      scoreLabel: "Mayhem",
      scoreValue: `${formatCompactScore(score.totalScore)} / ${formatCompactScore(scoreTarget)}`,
      scoreProgress: scoreTarget <= 0 ? 1 : THREE.MathUtils.clamp(score.totalScore / scoreTarget, 0, 1),
      bonusLabel: metricShortLabel(bonusMetric),
      bonusValue: `${formatCompactScore(bonusValue)} / ${formatCompactScore(bonusTarget)}`,
      bonusProgress: bonusTarget <= 0 ? 1 : THREE.MathUtils.clamp(bonusValue / bonusTarget, 0, 1),
      contractLabel: this.shotMayhemContract?.label ?? this.mayhemContract?.label ?? "Contract",
      contractValue: totalContract > 0 ? `${completedContract}/${totalContract}` : "0/0",
      contractProgress: totalContract > 0 ? completedContract / totalContract : 0,
      contractCompleted: totalContract > 0 && completedContract === totalContract,
      signals: this.liveMasterySignals(score, level, contractResult)
    };
  }

  private liveMasterySignals(
    score: ScoreBreakdown,
    level: TestChamber,
    contractResult: ReturnType<typeof evaluateMayhemContract>
  ): string[] {
    const signals: string[] = [];
    if (score.bossBreakCount > 0 || score.weakPointBreakCount >= 2) {
      signals.push(score.bossBreakCount > 0 ? "Boss core armed" : "Weak-point route active");
    }
    if (level.id === "relay-gauntlet" || score.chainReactionCount >= 16) {
      signals.push(score.chainReactionCount >= 16 ? "Relay chain active" : "Relay route primed");
    }
    if (score.totalScore >= level.mission.scoreThresholds.twoStar * 0.86) {
      signals.push(score.totalScore >= level.mission.scoreThresholds.twoStar ? "2-star pace locked" : "2-star pace");
    }
    if (this.selectedProjectile === "ignite") {
      const igniteTarget =
        level.mission.bonusThreshold.metric === "maxChainCombo"
          ? Math.max(12, Math.round(level.mission.bonusThreshold.minimum * 0.68))
          : 12;
      if (score.maxChainCombo >= igniteTarget || score.chainReactionBonus > level.mission.scoreThresholds.oneStar * 0.2) {
        signals.push("Ignition Chain ready");
      }
    }
    if (contractResult?.completed) {
      signals.push("Contract armed");
    }
    return signals.slice(0, 3);
  }

  private refreshRunPlanning(): void {
    const level = this.currentLevel();
    this.mayhemContract = mayhemContractForRun(
      level.id,
      level.mission,
      this.selectedProjectile,
      this.runVariant
    );
    this.updateScorePopupChainGoal(level);
  }

  private updateScorePopupChainGoal(level: TestChamber): void {
    this.scorePopups.setChainGoal(
      level.mission.bonusThreshold.metric === "chainReactionCount"
        ? { minimum: level.mission.bonusThreshold.minimum, label: "secondary hits" }
        : null
    );
  }

  private resetRunTelemetry(): void {
    this.shotMayhemContract = null;
    this.primaryImpactStarted = false;
    this.chainMilestonesAwarded.clear();
    this.runScoreEvents.length = 0;
    this.runFeedback = null;
    this.scoreReadyToFinalize = false;
    this.scoreAutoRevealAt = null;
    this.scoreSpectacleStartedAt = null;
    this.scoreSettleLastActivityAt = null;
    this.moneyShotScore = 0;
    this.moneyShotLockedUntil = 0;
  }

  private beginSpectacle(nowMs = performance.now()): void {
    this.scoreReadyToFinalize = false;
    this.scoreAutoRevealAt = null;
    this.scoreSpectacleStartedAt = nowMs;
    this.scoreSettleLastActivityAt = nowMs;
    this.runState.beginSpectacle(nowMs);
  }

  private pushScoreEvents(events: ScoreEvent[], revealDelaySeconds = 0): void {
    if (events.length === 0) {
      return;
    }
    this.runScoreEvents.push(...events);
    this.scoreSettleLastActivityAt = performance.now();
    this.scorePopups.push(events, revealDelaySeconds);
    const milestone = this.nextChainMilestone(events);
    if (milestone) {
      this.scorePopups.showChainMilestone(milestone.label, milestone.combo, revealDelaySeconds);
    }
  }

  private nextChainMilestone(events: readonly ScoreEvent[]): { combo: number; label: string } | null {
    let bestMilestone: { combo: number; label: string } | null = null;
    for (const event of events) {
      if (event.kind !== "chain" || !event.combo) {
        continue;
      }
      const milestone = chainMilestoneForCombo(event.combo);
      if (!milestone || this.chainMilestonesAwarded.has(milestone.combo)) {
        continue;
      }
      this.chainMilestonesAwarded.add(milestone.combo);
      if (!bestMilestone || milestone.combo > bestMilestone.combo) {
        bestMilestone = milestone;
      }
    }
    return bestMilestone;
  }

  private captureRenderStats(): DowntownMayhemRenderStats {
    const visibleMaterials = this.visibleRenderMaterialsScratch;
    visibleMaterials.clear();
    let visibleMeshes = 0;
    const physicsStats = this.physics.getRuntimeStats();
    const fragmentStats = this.destruction.getFragmentInstanceStats();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) {
        return;
      }
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const renderableMaterials = objectMaterials.filter((material) => material.visible);
      if (renderableMaterials.length === 0) {
        return;
      }
      visibleMeshes += 1;
      for (const material of renderableMaterials) {
        visibleMaterials.add(material);
      }
    });
    this.lastRenderStats = {
      frame: this.renderStatsFrame,
      levelName: this.currentLevel().name,
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
      fragmentInstanceOverflowBuckets: fragmentStats.overflowBuckets,
      levelComposition: levelCompositionLine(physicsStats)
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
      fragmentInstanceOverflowBuckets: fragmentStats.overflowBuckets,
      levelComposition: levelCompositionLine(physicsStats)
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

  private updatePhase(_deltaSeconds: number): void {
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

    this.updateScoreReveal();
  }

  private updateScoreReveal(): void {
    const now = performance.now();
    const sceneSettled = this.isSceneSettled();
    const scoreRevealDecision = this.runState.evaluateScoreReveal(now, sceneSettled);
    if (scoreRevealDecision === "waiting") {
      this.scoreReadyToFinalize = false;
      this.scoreAutoRevealAt = null;
      this.status = sceneSettled
        ? "Confirming the district is settled..."
        : "Watching active explosions and collapses...";
      return;
    }
    if (scoreRevealDecision === "ready") {
      if (!this.scoreReadyToFinalize) {
        this.scoreReadyToFinalize = true;
        this.scoreAutoRevealAt = now + SCORE_AUTO_REVEAL_GRACE_MS;
        this.status = "Mayhem settled. Scoring in a moment.";
        return;
      }
      if (this.scoreAutoRevealAt === null || now < this.scoreAutoRevealAt) {
        this.status = "Mayhem settled. Tap to score.";
        return;
      }
      this.finalizeScore();
    }
  }

  private configureLights(): void {
    const ambient = new THREE.HemisphereLight(0xc9efff, 0xe2c287, 0.84);
    this.ambientLight = ambient;
    this.scene.add(ambient);

    const sunKey = new THREE.DirectionalLight(0xffedac, 3.15);
    sunKey.position.copy(SUN_DIRECTION.clone().multiplyScalar(22));
    sunKey.castShadow = this.settings.graphicsQuality === "cinematic";
    sunKey.shadow.mapSize.set(1536, 1536);
    sunKey.shadow.camera.near = 1;
    sunKey.shadow.camera.far = 70;
    sunKey.shadow.camera.left = -24;
    sunKey.shadow.camera.right = 24;
    sunKey.shadow.camera.top = 24;
    sunKey.shadow.camera.bottom = -24;
    this.sunKeyLight = sunKey;
    this.scene.add(sunKey);

    const skyFill = new THREE.DirectionalLight(0x9fdbff, 0.24);
    skyFill.position.set(7, 6, 8);
    this.skyFillLight = skyFill;
    this.scene.add(skyFill);
    this.applyGraphicsQualityLighting();
  }

  private applyGraphicsQualityLighting(): void {
    const profile = graphicsLightingProfile(this.settings.graphicsQuality);
    this.renderer.toneMappingExposure = profile.exposure;
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.set(profile.background);
    } else {
      this.scene.background = new THREE.Color(profile.background);
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.set(profile.fog);
      this.scene.fog.near = profile.fogNear;
      this.scene.fog.far = profile.fogFar;
    }
    if (this.ambientLight) {
      this.ambientLight.color.set(profile.ambientSky);
      this.ambientLight.groundColor.set(profile.ambientGround);
      this.ambientLight.intensity = profile.ambientIntensity;
    }
    if (this.sunKeyLight) {
      this.sunKeyLight.color.set(profile.sunColor);
      this.sunKeyLight.intensity = profile.sunIntensity;
      this.sunKeyLight.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
    }
    if (this.skyFillLight) {
      this.skyFillLight.color.set(profile.skyFillColor);
      this.skyFillLight.intensity = profile.skyFillIntensity;
    }
  }

  private buildArena(): void {
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x2e342f,
      roughness: 0.82,
      metalness: 0.08,
      map: graphicTexture("arenaFloor", { repeat: [7, 11], anisotropy: 8 })
    });
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x525d5f,
      roughness: 0.72,
      metalness: 0.05,
      map: graphicTexture("arenaWall", { repeat: [5, 1], anisotropy: 8 })
    });
    const cannonDeckMaterial = new THREE.MeshStandardMaterial({
      color: 0x3c4443,
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

    this.addPremiumDaylightBakes();
    this.addPremiumCityAtmosphere();
  }

  private trackPremiumSceneTexture<T extends THREE.Texture>(texture: T): T {
    this.premiumSceneTextures.push(texture);
    return texture;
  }

  private addPremiumDaylightBakes(): void {
    const sunlightTexture = this.trackPremiumSceneTexture(createGroundSunlightTexture());
    const sunlightMaterial = new THREE.MeshBasicMaterial({
      map: sunlightTexture,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false
    });
    this.addArenaDecalPlane(
      "Premium baked sunlight across the boulevard",
      new THREE.Vector3(-0.5, 0.024, 6.2),
      new THREE.Vector2(40, 60),
      sunlightMaterial,
      -0.04,
      PREMIUM_DAYLIGHT_RENDER_ORDER
    );

    const shadowTexture = this.trackPremiumSceneTexture(createContactShadowTexture());
    const cityShadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      toneMapped: false
    });
    this.addArenaDecalPlane(
      "Soft city block contact shadow",
      new THREE.Vector3(-0.2, 0.028, 5.2),
      new THREE.Vector2(36, 34),
      cityShadowMaterial,
      0.08,
      PREMIUM_DAYLIGHT_RENDER_ORDER + 1
    );

    const cannonShadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
      toneMapped: false
    });
    this.addArenaDecalPlane(
      "Soft cannon platform contact shadow",
      new THREE.Vector3(0, 2.886, 26.35),
      new THREE.Vector2(9.8, 7.2),
      cannonShadowMaterial,
      -0.16,
      PREMIUM_DAYLIGHT_RENDER_ORDER + 2
    );
  }

  private addPremiumCityAtmosphere(): void {
    const atmosphereTexture = this.trackPremiumSceneTexture(createDistantAtmosphereTexture());
    const atmosphereMaterial = new THREE.MeshBasicMaterial({
      map: atmosphereTexture,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: false,
      toneMapped: false
    });
    this.addArenaBillboardPlane(
      "Distant atmospheric depth",
      new THREE.Vector3(0, 5.2, -25.8),
      new THREE.Vector2(78, 14.2),
      atmosphereMaterial,
      PREMIUM_ATMOSPHERE_RENDER_ORDER
    );

    const hazeTexture = this.trackPremiumSceneTexture(createIndustrialHazeTexture());
    const hazeMaterial = new THREE.MeshBasicMaterial({
      map: hazeTexture,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
      toneMapped: false
    });
    this.addArenaBillboardPlane(
      "Low morning dust haze",
      new THREE.Vector3(0, 3.8, -14.4),
      new THREE.Vector2(66, 10.5),
      hazeMaterial,
      PREMIUM_ATMOSPHERE_RENDER_ORDER + 1
    );
  }

  private addArenaDecalPlane(
    label: string,
    position: THREE.Vector3,
    size: THREE.Vector2,
    material: THREE.Material,
    rotationZ: number,
    renderOrder: number
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), material);
    mesh.name = label;
    mesh.position.copy(position);
    mesh.rotation.set(-Math.PI / 2, 0, rotationZ);
    mesh.renderOrder = renderOrder;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.arenaObjects.push(mesh);
    return mesh;
  }

  private addArenaBillboardPlane(
    label: string,
    position: THREE.Vector3,
    size: THREE.Vector2,
    material: THREE.Material,
    renderOrder: number
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), material);
    mesh.name = label;
    mesh.position.copy(position);
    mesh.renderOrder = renderOrder;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    this.scene.add(mesh);
    this.arenaObjects.push(mesh);
    return mesh;
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

  private resetLevelRuntimeState(level: TestChamber): void {
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
    this.arcadeResultMeta = null;
    this.runFeedback = null;
    this.resetRunTelemetry();
    const fixedContract = this.activeFixedContract();
    if (fixedContract) {
      this.runSeed = fixedContract.seed;
      this.selectedProjectile = fixedContract.projectileId;
      this.runVariant = fixedContract.variant;
    } else {
      this.runSeed = createRunSeed();
      this.runVariant = runVariantForSeed(level.id, this.runSeed);
      if (!this.availableProjectileIds().includes(this.selectedProjectile)) {
        this.selectedProjectile = "slug";
      }
    }
    this.rng.reset(this.runSeed);
    if (import.meta.env.DEV) {
      console.debug(
        `[Downtown Mayhem] run seed ${this.runSeed}${
          fixedContract ? ` ${this.options.challengeKind ?? "daily"} ${fixedContract.dateKey}` : ""
        }`
      );
    }
    this.scorePopups.clear();
    this.slowMotionTimer = 0;
    this.hitStopTimer = 0;
    this.aimTrafficAccumulator = 0;
    this.cameraRig.resetTransientMotion();
    this.cannon.setBasePosition(level.cannonPosition);
    this.cannon.group.visible = true;
    this.cannon.setTrajectoryVisible(true);
    this.positionCannonBattery(level.cannonPosition);
    for (const object of this.cannonBatteryObjects) {
      object.visible = true;
    }
    this.aimPoint.copy(level.defaultAimPoint ?? DEFAULT_AIM_POINT);
    this.aimMarkerPoint.set(this.aimPoint.x, AIM_FALLBACK_SURFACE_Y, this.aimPoint.z);
    this.aimSurfaceNormal.copy(AIM_SURFACE_NORMAL);
    this.status = "";
    this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
    this.refreshRunPlanning();
  }

  private loadLevel(): void {
    const level = this.currentLevel();
    this.physics.clearDynamic();
    this.clearLevelDecorations();
    this.resetLevelRuntimeState(level);
    level.setup({
      physics: this.physics,
      materials: this.materials,
      addDecoration: (object) => this.addDecoration(object)
    });
    this.physics.batchStaticDetails();
    this.invalidateAimSurfaceTargets();
    setOptionalShadowMapFlag(this.renderer, "needsUpdate", true);
  }

  waitForRenderWarmup(): Promise<void> {
    return this.renderWarmupPromise ?? Promise.resolve();
  }

  private createImmediateReadyWarmupState(startedAt: number): RenderWarmupState {
    return {
      phase: "ready",
      token: this.renderWarmupToken,
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      programs: rendererProgramCount(this.renderer),
      geometries: this.renderer.info.memory.geometries,
      frames: 0,
      bodyCountAfterCleanup: this.physics.getDynamicBodyCount()
    };
  }

  private prepareRenderWarmup(mode: RenderWarmupMode): void {
    if (mode === "none") {
      this.renderWarmupToken += 1;
      this.renderWarmupPromise = null;
      this.renderWarmupState = this.createImmediateReadyWarmupState(performance.now());
      return;
    }
    this.scheduleRenderWarmup(mode);
  }

  private scheduleRenderWarmup(mode: RenderWarmupMode): void {
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
    this.renderWarmupPromise =
      mode === "smoke"
        ? this.runSmokeRenderWarmup(token, group)
        : this.runRenderWarmup(token, group, FULL_RENDER_WARMUP_PROFILE);
  }

  private async runSmokeRenderWarmup(token: number, group: THREE.Group): Promise<void> {
    this.scene.add(group);
    const restoreFrustumCulling = disableSceneFrustumCullingForWarmup(this.scene);
    try {
      this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
      await compileRendererPipelines(this.renderer, this.scene, this.cameraRig.camera);
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

  private async runRenderWarmup(token: number, group: THREE.Group, profile: RenderWarmupProfile): Promise<void> {
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
      if (profile.compileAllCameras) {
        for (const camera of warmupCameras) {
          await compileRendererPipelines(this.renderer, this.scene, camera);
        }
      }
      let frames = 0;
      let stableFrames = 0;
      let lastProgramCount = rendererProgramCount(this.renderer);
      const warmupDeadline = performance.now() + profile.maxDurationMs;
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
      for (let pass = 0; pass < profile.brutalPasses && performance.now() < warmupDeadline; pass += 1) {
        this.status = `Preparing ${profile.label} before impact (${pass + 1}/${profile.brutalPasses}).`;
        this.physics.flushStagedVisualActivations(Number.POSITIVE_INFINITY, 0);
        this.destruction.showFragmentVisualWarmupPreview();
        this.playRenderWarmupEffects(pass);
        for (let frame = 0; frame < profile.framesPerBrutalPass && performance.now() < warmupDeadline; frame += 1) {
          if (!(await renderWarmupFrame())) {
            return;
          }
        }
        lastProgramCount = rendererProgramCount(this.renderer);
        stableFrames = 0;
      }
      if (
        performance.now() < warmupDeadline &&
        !(await this.runSyntheticDestructionWarmup(token, renderWarmupFrame, {
          deadlineAt: warmupDeadline,
          passes: profile.syntheticDestructionPasses,
          framesPerPass: profile.framesPerBrutalPass
        }))
      ) {
        return;
      }
      while (
        performance.now() < warmupDeadline &&
        frames < profile.maxFrames &&
        (frames < profile.minFrames || stableFrames < profile.stableFrames)
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
      this.status = `Preparing ${profile.label} before impact (runtime cascade pools).`;
      const postCleanupDeadline = performance.now() + profile.postCleanupMaxDurationMs;
      for (
        let pass = 0;
        pass < profile.postCleanupEffectPasses && performance.now() < postCleanupDeadline;
        pass += 1
      ) {
        this.destruction.showFragmentVisualWarmupPreview();
        this.playRenderWarmupEffects(profile.brutalPasses + pass);
        for (
          let frame = 0;
          frame < profile.postCleanupEffectFrames && performance.now() < postCleanupDeadline;
          frame += 1
        ) {
          if (!(await renderWarmupFrame())) {
            return;
          }
        }
        this.destruction.parkFragmentVisualWarmupPreview();
        this.particles.clearTransientEffects();
        this.particles.keepPoolPipelinesResident();
        this.destruction.flushFragmentInstanceBounds();
        this.physics.flushInstancedRenderBounds();
        if (profile.compileAllCameras) {
          for (const camera of warmupCameras) {
            await compileRendererPipelines(this.renderer, this.scene, camera);
          }
        }
      }
      this.status = `Preparing ${profile.label} before impact (settling runtime scene).`;
      lastProgramCount = rendererProgramCount(this.renderer);
      stableFrames = 0;
      let postCleanupFrames = 0;
      while (
        performance.now() < postCleanupDeadline &&
        postCleanupFrames < profile.postCleanupMaxFrames &&
        stableFrames < profile.postCleanupStableFrames
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
    const stagedVisualActivationMaxPerFrame = options.stagedVisualActivationMaxPerFrame ?? Number.POSITIVE_INFINITY;
    const stagedVisualActivationTimeBudgetMs = options.stagedVisualActivationTimeBudgetMs ?? 0;
    const deadlineAt = options.deadlineAt ?? Number.POSITIVE_INFINITY;
    const statusPrefix = options.statusPrefix ?? "Preparing renderer pipelines before impact";
    const objectIds = this.createSyntheticDestructionWarmupObjects();
    try {
      for (let pass = 0; pass < passes && performance.now() < deadlineAt; pass += 1) {
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
        for (let frame = 0; frame < framesPerPass && performance.now() < deadlineAt; frame += 1) {
          this.destruction.processQueuedFractures(fractureProcessMaxPerFrame, fractureProcessTimeBudgetMs);
          this.physics.flushStagedVisualActivations(stagedVisualActivationMaxPerFrame, stagedVisualActivationTimeBudgetMs);
          if (!(await renderWarmupFrame())) {
            return false;
          }
          if (this.disposed || token !== this.renderWarmupToken) {
            return false;
          }
        }
      }
      while (this.destruction.getQueuedFractureCount() > 0 && performance.now() < deadlineAt) {
        this.destruction.processQueuedFractures(fractureProcessMaxPerFrame, fractureProcessTimeBudgetMs);
        this.physics.flushStagedVisualActivations(stagedVisualActivationMaxPerFrame, stagedVisualActivationTimeBudgetMs);
        if (!(await renderWarmupFrame())) {
          return false;
        }
        if (this.disposed || token !== this.renderWarmupToken) {
          return false;
        }
      }
      this.physics.flushStagedVisualActivations(stagedVisualActivationMaxPerFrame, stagedVisualActivationTimeBudgetMs);
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
    this.refreshRunPlanning();
    this.resetRunTelemetry();
    this.shotMayhemContract = this.mayhemContract;
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
    if (!this.scoreReadyToFinalize) {
      this.status = this.isSceneSettled()
        ? "Confirming the district is settled..."
        : "Watching active explosions and collapses...";
      return;
    }
    this.finalizeScore("Score locked manually.");
  }

  private finalizeScore(statusPrefix = ""): void {
    if (this.runState.phase !== "spectacle" || this.runState.score || !this.scoreReadyToFinalize) {
      return;
    }
    const level = this.currentLevel();
    const score = this.scoreTracker.finalize(this.physics);
    const shotContract = this.shotMayhemContract ?? this.mayhemContract;
    const previousProgress = this.currentLevelProgress();
    const previousBestScore = previousProgress?.bestScore ?? 0;
    const previousStars = previousProgress?.stars ?? 0;
    const previousHighestUnlockedLevel = this.arcadeProgress.highestUnlockedLevel;
    this.runState.markScored(score);
    const recorded = recordArcadeRun(this.arcadeProgress, ARCADE_LEVELS, level.id, score, {
      projectileId: this.selectedProjectile,
      contractObjectives: shotContract?.objectives
    });
    this.arcadeProgress = recorded.progress;
    this.arcadeResult = recorded.result;
    const daily = this.activeDailyContract();
    const dailyResult = daily
      ? recordDailyResult(daily, {
          score,
          stars: recorded.result.stars,
          contractCompleted: Boolean(recorded.result.contract?.completed),
          levelName: level.name,
          projectileLabel: PROJECTILES[daily.projectileId].shortName
        })
      : undefined;
    this.runFeedback = runFeedbackForScore({
      score,
      mission: level.mission,
      variant: this.runVariant,
      contract: shotContract,
      contractResult: recorded.result.contract,
      topSources: summarizeScoreSources(this.runScoreEvents),
      replayMoment: replayMomentFromEvents(this.runScoreEvents),
      replayTimeline: replayTimelineFromEvents(this.runScoreEvents),
      projectileId: this.selectedProjectile,
      levelId: level.id
    });
    const newBest = score.totalScore > previousBestScore;
    this.arcadeResultMeta = {
      previousBestScore,
      previousStars,
      newBest,
      starsGained: Math.max(0, recorded.result.stars - previousStars),
      dailyResult,
      justUnlockedLevelName:
        recorded.progress.highestUnlockedLevel > previousHighestUnlockedLevel
          ? TEST_CHAMBERS[recorded.progress.highestUnlockedLevel]?.name
          : undefined,
      justUnlockedPayloadName:
        previousHighestUnlockedLevel + 1 < IGNITE_UNLOCK_LEVEL_COUNT &&
        recorded.progress.highestUnlockedLevel + 1 >= IGNITE_UNLOCK_LEVEL_COUNT
          ? PROJECTILES.ignite.shortName
          : undefined
    };
    saveArcadeProgress(this.arcadeProgress);
    this.audio.playScoreCeremony(score.totalScore, recorded.result.stars, recorded.result.completed);
    this.scoreReadyToFinalize = false;
    this.scoreAutoRevealAt = null;
    const unlockStatus = this.arcadeResultMeta.justUnlockedPayloadName
      ? ` New payload unlocked: ${this.arcadeResultMeta.justUnlockedPayloadName}.`
      : "";
    this.status = `${statusPrefix}${statusPrefix ? " " : ""}${scoreStatus(score, recorded.result)}${unlockStatus}`;
    this.perfDiskLogger?.flush("score-finalized");
  }

  private focusReplayMoment(index: number): void {
    const moment = this.runFeedback?.replayTimeline[index];
    if (!moment) {
      this.status = "Replay moment is no longer available.";
      this.updateHud();
      return;
    }
    const focus = new THREE.Vector3(moment.position.x, moment.position.y, moment.position.z);
    focus.y = THREE.MathUtils.clamp(focus.y + 0.6, 0.9, 5.2);
    this.cameraRig.spectacle(focus);
    this.cameraRig.shake(0.12, 0.24);
    this.status = `Replay focus: ${moment.label}`;
    this.updateHud();
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
    this.primaryImpactStarted = true;
    const projectile = active.definition;
    const direction = active.object.body.linvel();
    const directionVector = new THREE.Vector3(direction.x, direction.y, direction.z);
    if (directionVector.lengthSq() > 0.0001) {
      directionVector.normalize();
    } else {
      directionVector.copy(this.cannon.getDirection());
    }
    if (hitObject && this.shouldProjectilePenetrate(active, hitObject)) {
      this.handleProjectilePenetration(point, active, hitObject, directionVector);
      return;
    }

    if (projectile.id === "gravity") {
      if (hitObject && !hitObject.canFracture) {
        this.applyDirectImpactImpulse(projectile, hitObject, directionVector, active.powerScale);
      }
      const directResult =
        hitObject && hitObject.destructible
          ? this.destruction.impact(active.object, hitObject, point, speedOf(active.object) * directImpactScale(projectile.id))
          : null;
      this.projectiles.removeActive();
      const scoreEvents = directResult ? this.applyExplosionResult(directResult, 0, 0) : [];
      this.pushScoreEvents(scoreEvents, scorePopupImpactDelay(projectile.id));
      if (directResult) {
        this.markProjectileSpectacleFocus(point, directResult);
        this.focusSpectacleOn(point, directResult, 120, true);
        this.explosion.play(point, gravityImpactVisualRadius(active, directResult), directResult.dustColors, {
          projectileId: projectile.id,
          result: directResult,
          powerScale: active.powerScale,
          sizeScale: active.sizeScale,
          hitMaterialId: hitObject?.materialId,
          impactDirection: directionVector,
          role: "primary"
        });
        if (directResult.dustColors.length > 0) {
          this.particles.cityDebrisSpray(point, directResult.dustColors, 0.8 + directResult.fracturedBodies * 0.08);
        }
      } else {
        this.focusProjectileSpectacle(point);
        this.explosion.play(point, gravityImpactVisualRadius(active, null), [projectile.color], {
          projectileId: projectile.id,
          powerScale: active.powerScale,
          sizeScale: active.sizeScale,
          hitMaterialId: hitObject?.materialId,
          impactDirection: directionVector,
          role: "primary"
        });
      }
      this.particles.spark(point, projectile.color, 1.35 * active.sizeScale * active.powerScale);
      this.audio.playGravityCrush(point, active.sizeScale * active.powerScale);
      this.cameraRig.shake(GRAVITY_IMPACT_SHAKE_MAGNITUDE, GRAVITY_IMPACT_SHAKE_DURATION);
      this.hitStopTimer = this.settings.motionEffects ? GRAVITY_IMPACT_HIT_STOP_SECONDS : 0;
      this.slowMotionTimer = this.settings.motionEffects ? GRAVITY_IMPACT_SLOWMO_SECONDS : 0;
      this.beginSpectacle();
      this.status = directResult
        ? `${projectile.name} impact: ${directResult.fracturedBodies} direct fractures, no blast.`
        : `${projectile.name} spent its velocity without detonating.`;
      if (directResult) {
        this.playCinematicImpact(point, directResult, directionVector, 180, true);
      }
      return;
    }

    this.resolveArcadeImpact({
      point,
      projectile,
      sourceObject: active.object,
      hitObject,
      directionVector,
      sourceSpeed: speedOf(active.object),
      powerScale: active.powerScale,
      sizeScale: active.sizeScale,
      cleanupSource: () => this.projectiles.removeActive(),
      specialActive: active,
      statusName: projectile.name
    });
  }

  private resolveArcadeImpact(options: {
    point: THREE.Vector3;
    projectile: ProjectileDefinition;
    sourceObject: PhysicsObject;
    hitObject: PhysicsObject | null;
    directionVector: THREE.Vector3;
    sourceSpeed: number;
    powerScale: number;
    sizeScale: number;
    cleanupSource: () => void;
    directResults?: ExplosionResult[];
    specialActive?: ActiveProjectile;
    statusName: string;
  }): void {
    const { point, projectile, sourceObject, hitObject, directionVector, sourceSpeed, powerScale, sizeScale } = options;
    const directResults: ExplosionResult[] = [];
    if (options.directResults) {
      directResults.push(...options.directResults);
    } else if (hitObject) {
      if (!hitObject.canFracture) {
        this.applyDirectImpactImpulse(projectile, hitObject, directionVector, powerScale);
      }
      if (hitObject.destructible) {
        directResults.push(this.destruction.impact(sourceObject, hitObject, point, sourceSpeed * directImpactScale(projectile.id)));
      }
    }

    options.cleanupSource();

    const blastProfile = impactBlastProfile(projectile, hitObject, powerScale, sizeScale, sourceSpeed, this.materials);
    const result = this.destruction.explode(point, blastProfile.strength, blastProfile.radius);
    this.audio.playProjectileImpact({
      point,
      projectileId: projectile.id,
      result,
      powerScale: blastProfile.audioPowerScale,
      sizeScale: blastProfile.sizeScale,
      hitMaterialId: hitObject?.materialId,
      role: "primary"
    });
    this.focusSpectacleOn(point, result, 160, true);
    const scoreEvents = [
      ...directResults.flatMap((directResult) => this.applyExplosionResult(directResult, 0, projectile.id === "ignite" ? 1 : 0)),
      ...this.applyExplosionResult(result, 0, blastProfile.ignitionBias),
      ...(options.specialActive ? this.playProjectileSpecial(projectile.id, point, directionVector, options.specialActive) : [])
    ];
    this.pushScoreEvents(scoreEvents, scorePopupImpactDelay(projectile.id));

    this.explosion.play(point, blastProfile.visualRadius, result.dustColors, {
      projectileId: projectile.id,
      result,
      powerScale: blastProfile.vfxPowerScale,
      sizeScale: blastProfile.sizeScale,
      hitMaterialId: hitObject?.materialId,
      impactDirection: directionVector,
      role: "primary"
    });
    this.particles.cityDebrisSpray(point, result.dustColors, 1 + result.fracturedBodies * 0.085);
    const shake = projectileImpactShake(projectile.id);
    this.cameraRig.shake(shake.magnitude, shake.duration);
    this.hitStopTimer = this.settings.motionEffects ? projectileImpactHitStop(projectile.id) : 0;
    this.slowMotionTimer = this.settings.motionEffects ? projectileImpactSlowMo(projectile.id) : 0;
    this.beginSpectacle();
    const directFractures = directResults.reduce((total, directResult) => total + directResult.fracturedBodies, 0);
    const directHits = directResults.reduce((total, directResult) => total + directResult.affectedBodies, 0);
    this.status = `${options.statusName} impact: ${directFractures + result.fracturedBodies} fractures, ${
      directHits + result.affectedBodies
    } objects hit.`;
    this.playCinematicImpact(point, result, directionVector, 190, true);
  }

  private applyDirectImpactImpulse(
    projectile: ProjectileDefinition,
    hitObject: PhysicsObject,
    directionVector: THREE.Vector3,
    powerScale: number
  ): void {
    const directImpulse = directionVector
      .clone()
      .multiplyScalar(projectile.impulse * powerScale * 0.22 / Math.max(0.8, this.materials.get(hitObject.materialId).massFactor));
    hitObject.body.applyImpulse({ x: directImpulse.x, y: directImpulse.y, z: directImpulse.z }, true);
    hitObject.body.applyTorqueImpulse({ x: directImpulse.z * 0.06, y: directImpulse.x * 0.06, z: directImpulse.y * 0.06 }, true);
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

  private playCinematicImpact(
    point: THREE.Vector3,
    result: ExplosionResult,
    direction?: THREE.Vector3,
    bonus = 0,
    force = false
  ): boolean {
    if (!this.settings.motionEffects) {
      return false;
    }
    if (this.currentLevel().id !== "hazard-junction") {
      return false;
    }
    const score = explosionFocusScore(result) + bonus;
    if (!force && score < CAMERA_FOCUS_MIN_SCORE + 110) {
      return false;
    }
    const candidate = moneyShotCandidate(result, score, point);
    if (!candidate) {
      return false;
    }

    const now = performance.now();
    if (now < this.moneyShotLockedUntil && candidate.priority < this.moneyShotScore + MONEY_SHOT_PRIORITY_MARGIN) {
      return false;
    }
    this.moneyShotScore = candidate.priority;
    this.moneyShotLockedUntil = now + (candidate.priority >= 900 ? MONEY_SHOT_LOCK_MS + 320 : MONEY_SHOT_LOCK_MS);

    const intensity = THREE.MathUtils.clamp(0.62 + candidate.priority / 820, 0.78, 2.25);
    const focus = candidate.focus.clone();
    focus.y = THREE.MathUtils.clamp(focus.y + result.fracturedBodies * 0.025 + result.affectedBodies * 0.004, 0.95, 5.6);
    this.cameraRig.cinematicImpact(focus, intensity * 1.18, direction);
    this.slowMotionTimer = Math.max(this.slowMotionTimer, candidate.priority >= 900 ? 1.05 : 0.82);
    this.hitStopTimer = Math.max(this.hitStopTimer, candidate.priority >= 900 ? 0.07 : 0.055);
    this.cameraRig.shake(candidate.priority >= 900 ? 0.42 : 0.34, 0.72);
    this.status = cinematicImpactStatus(result, score);
    return true;
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
    if (active.piercedObjectIds.size < 3 && active.age < 2.2 && position.y > active.radius * 2.1) {
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
    if (active.piercedObjectIds.size >= 4 && retainedSpeed <= releaseSpeed) {
      return true;
    }
    if (active.piercedObjectIds.size >= 9) {
      return true;
    }
    return active.age >= HEAVY_PROJECTILE_CAMERA_RELEASE_AGE && retainedSpeed <= releaseSpeed * 1.32;
  }

  private releaseProjectileCameraToSpectacle(fallback: THREE.Vector3): void {
    this.focusProjectileSpectacle(fallback);
    this.projectiles.releaseActive();
    this.beginSpectacle();
    this.status = `${PROJECTILES.gravity.name} spent its momentum; watching the damage unfold.`;
  }

  private shouldProjectilePenetrate(active: ActiveProjectile, hitObject: PhysicsObject): boolean {
    if (active.piercedObjectIds.size >= MAX_PROJECTILE_PENETRATIONS[active.definition.id]) {
      return false;
    }
    if (active.definition.id !== "gravity") {
      return false;
    }
    if (!hitObject.destructible) {
      return false;
    }
    if (!hitObject.canFracture && !isBrittlePenetrationMaterial(hitObject.materialId)) {
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
    const measuredSpeed = speedOf(active.object);
    const speed = heavyPenetrationSpeed(active, hitObject, measuredSpeed);
    const impactSpeed = speed * penetrationImpactScale(active.definition.id, hitObject);
    const result = this.destruction.impact(active.object, hitObject, point, impactSpeed);
    if (active.definition.id === "gravity" && result.fracturedBodies > 0) {
      this.markProjectileSpectacleFocus(point, result);
    }
    const scoreEvents = this.applyExplosionResult(result, 0, active.definition.id === "ignite" ? 0.9 : 0);
    this.pushScoreEvents(scoreEvents, active.definition.id === "gravity" ? 0.16 : scorePopupImpactDelay(active.definition.id));

    if (result.dustColors.length > 0) {
      this.particles.cityDebrisSpray(point, result.dustColors, 0.42 + result.fracturedBodies * 0.08);
    }
    if (active.definition.id === "gravity" && result.fracturedBodies > 0) {
      const punchVisualRadius = Math.max(2.6, active.radius * 6.4 + Math.min(2.8, result.fracturedBodies * 0.18));
      this.explosion.play(point, punchVisualRadius, result.dustColors.length > 0 ? result.dustColors : [active.definition.color], {
        projectileId: active.definition.id,
        result,
        powerScale: active.powerScale * 0.78,
        sizeScale: active.sizeScale * 0.72,
        densityScale: 0.48,
        hitMaterialId: hitObject.materialId,
        impactDirection: direction,
        role: "secondary"
      });
    }
    this.particles.spark(point, hitObject.materialId === "glass" ? 0xb6fbff : active.definition.color, 0.55);
      this.audio.playChainImpact({
        point,
        result,
        relativeSpeed: impactSpeed,
        materialId: hitObject.materialId,
        role: "penetration"
      });

    const retainedSpeed = speed * penetrationRetainedSpeed(active.definition.id, hitObject);
    const exitDistance = penetrationExitDistance(active, hitObject);
    const nextPosition = point.clone().add(direction.clone().multiplyScalar(exitDistance));
    const nextVelocity = direction.clone().multiplyScalar(retainedSpeed);
    active.object.body.setTranslation({ x: nextPosition.x, y: nextPosition.y, z: nextPosition.z }, true);
    active.object.body.setLinvel({ x: nextVelocity.x, y: nextVelocity.y, z: nextVelocity.z }, true);
    active.previousPosition.copy(nextPosition);
    this.cameraRig.shake(active.definition.id === "gravity" ? 0.18 : 0.1, 0.22);
    if (result.fracturedBodies > 0 && this.shouldReleaseHeavyProjectileAfterPenetration(active, retainedSpeed)) {
      this.focusSpectacleOn(point, result, 130, true);
      this.projectiles.releaseActive();
      this.beginSpectacle();
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
        hitMaterialId: "rubber",
        role: "ignition"
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
      const queued = this.queueBurningHazardFromAffectedObject(object, profile, origin, cascadeDepth);
      if (queued) {
        this.particles.fireBurst(origin, 0.95 + profile.powerScale * 0.35);
        this.particles.armingPulse(origin, 0.6, profile.color);
        this.focusSpectacleOn(origin, result, hazardCameraFocusBonus(object));
      }
    }
    return events;
  }

  private queueIgnitions(result: ExplosionResult, igniteBias: number, cascadeDepth: number): void {
    if (igniteBias <= 0 && cascadeDepth > 0) {
      return;
    }
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
      const origin = ignitionOriginForObject(sourceObject);
      const delay = THREE.MathUtils.lerp(FIRE_MAX_DELAY_MS, FIRE_MIN_DELAY_MS, THREE.MathUtils.clamp(igniteBias + energyRatio * 0.18, 0, 1));
      this.queueBurningHazardFromAffectedObject(
        object,
        ignitionHazardProfile(object, igniteBias, energyRatio),
        origin,
        cascadeDepth,
        delay + Math.random() * 320
      );
      this.particles.fireBurst(origin, 0.72 + igniteBias * 0.45);
    }
  }

  private queueBurningHazardFromAffectedObject(
    object: ExplosionAffectedObject,
    profile: VolatileHazardProfile,
    origin: THREE.Vector3,
    cascadeDepth: number,
    delayMs?: number
  ): boolean {
    if (this.burningHazards.size >= MAX_BURNING_HAZARDS || this.burningHazards.has(object.id)) {
      return false;
    }
    const now = performance.now();
    const delay = delayMs ?? THREE.MathUtils.lerp(FIRE_MAX_DELAY_MS, FIRE_MIN_DELAY_MS, THREE.MathUtils.clamp(profile.delayScale, 0, 1));
    this.burningHazards.set(object.id, {
      id: object.id,
      label: ignitionExplosionLabel(object),
      origin: origin.clone(),
      ignitedAt: now,
      explodeAt: now + delay + Math.random() * 260,
      nextFxAt: now,
      nextSpreadAt: now + THREE.MathUtils.randInt(FIRE_SPREAD_MIN_DELAY_MS, FIRE_SPREAD_MAX_DELAY_MS),
      strength: profile.strength,
      radius: profile.radius,
      heatRadius: profile.heatRadius,
      spreadCount: 0,
      maxSpreadCount: profile.maxSpreadCount,
      materialId: object.materialId,
      projectileId: profile.projectileId,
      color: profile.color,
      powerScale: profile.powerScale,
      sizeScale: profile.sizeScale,
      densityScale: profile.densityScale,
      cascadeDepth,
      mushroomCloud: Boolean(profile.mushroomCloud)
    });
    return true;
  }

  private updateBurningHazards(): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    if (this.burningHazards.size === 0 || this.runState.phase === "aim" || this.runState.score) {
      return events;
    }
    const now = performance.now();
    let detonationsThisFrame = 0;
    for (const hazard of [...this.burningHazards.values()]) {
      const sourceObject = this.physics.getObject(hazard.id);
      if (!sourceObject) {
        this.burningHazards.delete(hazard.id);
        continue;
      }
      hazard.origin.copy(ignitionOriginForObject(sourceObject));
      const remainingMs = hazard.explodeAt - now;
      const burnAge = THREE.MathUtils.clamp((now - hazard.ignitedAt) / Math.max(1, hazard.explodeAt - hazard.ignitedAt), 0, 1);
      if (now >= hazard.nextFxAt) {
        this.particles.fireLick(hazard.origin, 0.56 + burnAge * 0.5);
        if (remainingMs < 820) {
          const warningProgress = 1 - Math.max(0, remainingMs) / 820;
          this.particles.armingPulse(hazard.origin, warningProgress, ignitionWarningColor(hazard));
          this.audio.playHazardWarning(hazard.origin, warningProgress, hazard.materialId);
        }
        hazard.nextFxAt = now + (remainingMs < 820 ? 110 : 180);
      }
      if (now >= hazard.nextSpreadAt && remainingMs > 260 && hazard.spreadCount < hazard.maxSpreadCount) {
        events.push(...this.spreadBurningHazard(hazard));
        hazard.nextSpreadAt = now + FIRE_SPREAD_SCAN_INTERVAL_MS + Math.random() * 360;
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
      this.particles.hazardDetonationCue(hazard.origin, hazard.color, hazard.powerScale, hazard.mushroomCloud);
      this.focusSpectacleOn(hazard.origin, result, hazard.mushroomCloud ? 260 : 145);
      this.playCinematicImpact(hazard.origin, result, undefined, hazard.mushroomCloud ? 240 : 120);
      this.explosion.play(hazard.origin, hazard.radius * 1.24, result.dustColors, {
        projectileId: hazard.projectileId,
        result,
        powerScale: hazard.powerScale,
        sizeScale: hazard.sizeScale,
        densityScale: hazard.densityScale,
        hitMaterialId: hazard.materialId,
        role: "ignition",
        variant: hazard.mushroomCloud ? "mushroom" : undefined
      });
      this.particles.fireBurst(hazard.origin, hazard.mushroomCloud ? 2.7 : 1.25);
      this.audio.playProjectileImpact({
        point: hazard.origin,
        projectileId: hazard.projectileId,
        result,
        powerScale: hazard.powerScale,
        sizeScale: hazard.sizeScale,
        hitMaterialId: hazard.materialId,
        role: "ignition"
      });
      this.audio.playHazardDetonationCue(hazard.origin, hazard.powerScale, hazard.materialId, hazard.mushroomCloud);
      events.push(...this.scoreTracker.addChainReaction(Math.max(58, Math.round((result.materialChaos + result.structureDamage) * 0.28)), hazard.origin, hazard.label));
      events.push(...this.applyExplosionResult(result, Math.min(2, hazard.cascadeDepth + 1), hazard.mushroomCloud ? 0.8 : 0.24));
    }
    return events;
  }

  private spreadBurningHazard(hazard: BurningHazard): ScoreEvent[] {
    if (this.burningHazards.size >= MAX_BURNING_HAZARDS) {
      return [];
    }
    const candidates = this.physics
      .getBlastCandidatesInto(this.fireSpreadCandidates, hazard.origin, hazard.heatRadius)
      .filter((candidate) => candidate.id !== hazard.id && !this.burningHazards.has(candidate.id) && canIgnitePhysicsObject(candidate))
      .sort((a, b) => fireSpreadPriority(b, hazard.origin) - fireSpreadPriority(a, hazard.origin))
      .slice(0, FIRE_SPREAD_CANDIDATE_LIMIT);
    if (candidates.length === 0) {
      return [];
    }

    const target = candidates[0];
    hazard.spreadCount += 1;
    const origin = ignitionOriginForObject(target);
    const pseudoAffected = affectedObjectFromPhysics(target, origin, hazard.strength * 0.42);
    const profile = ignitionHazardProfile(pseudoAffected, 0.55, hazard.strength / Math.max(1, target.scoreValue));
    profile.strength = Math.max(profile.strength, hazard.strength * 0.56);
    profile.radius = Math.max(profile.radius, hazard.radius * 0.64);
    profile.heatRadius = Math.max(profile.heatRadius, hazard.heatRadius * 0.72);
    profile.maxSpreadCount = Math.min(FIRE_SPREAD_MAX_CHILDREN, Math.max(1, hazard.maxSpreadCount - hazard.spreadCount));
    const queued = this.queueBurningHazardFromAffectedObject(
      pseudoAffected,
      profile,
      origin,
      Math.min(2, hazard.cascadeDepth + 1),
      THREE.MathUtils.randInt(FIRE_SPREAD_MIN_DELAY_MS, FIRE_SPREAD_MAX_DELAY_MS)
    );
    if (!queued) {
      return [];
    }

    this.particles.fireBurst(origin, 0.72);
    this.particles.fireLick(hazard.origin, 0.9);
    const heatPulse = this.destruction.explode(hazard.origin, hazard.strength * 0.16, Math.min(hazard.heatRadius, hazard.radius * 0.78));
    if (heatPulse.affectedBodies === 0) {
      return [];
    }
    return [
      ...this.scoreTracker.addChainReaction(Math.max(24, Math.round(heatPulse.materialChaos * 0.12)), hazard.origin, `${hazardSourceLabel(pseudoAffected)} CATCHES FIRE`),
      ...this.applyExplosionResult(heatPulse, Math.min(2, hazard.cascadeDepth + 1), 0.12)
    ];
  }

  private processDebrisImpacts(): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    if (this.runState.phase === "aim" || this.runState.score) {
      this.physics.drainCollisionEventsInto(() => undefined);
      this.physics.drainSurfaceCollisionEventsInto(() => undefined);
      return events;
    }
    const activeProjectile = this.runState.phase === "flight" ? this.projectiles.getActive() : null;
    const secondaryImpactsLocked = this.runState.phase === "flight" && !this.primaryImpactStarted;

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
    const chainCollisionDrainLimit = secondaryImpactsLocked ? Number.POSITIVE_INFINITY : CHAIN_COLLISION_DRAIN_MAX_PER_FRAME;
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
          if (!candidate) {
            return;
          }
          this.primaryImpactStarted = true;
          this.handleImpact(candidate.point, activeProjectile, projectileTarget);
          projectileImpactHandled = true;
          return;
        }
      }
      if (secondaryImpactsLocked) {
        return;
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
      const minImpactSpeed = chainImpactMinSpeed(source);
      if (relativeSpeedSq < minImpactSpeed * minImpactSpeed) {
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
        materialId: damaged.materialId,
        role: "chain"
      });
      this.playCinematicImpact(origin, result, relativeVelocity, 0);
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
    }, chainCollisionDrainLimit);
    perfMonitor.addCount("collision.chainDrained", chainCollisionsDrained);
    if (projectileImpactHandled) {
      return events;
    }
    if (secondaryImpactsLocked) {
      perfMonitor.addCount("collision.surfacePrePrimaryDrained", this.physics.drainSurfaceCollisionEventsInto(() => undefined));
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
        materialId: damaged.materialId,
        role: "surface"
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

  private isSceneSettled(now = performance.now()): boolean {
    const spectacleStartedAt = this.scoreSpectacleStartedAt ?? now;
    const lastActivityAt = this.scoreSettleLastActivityAt ?? spectacleStartedAt;
    const residualActivityExpired = now - spectacleStartedAt >= SCORE_RESIDUAL_ACTIVITY_MAX_WAIT_MS;
    if (!residualActivityExpired && this.burningHazards.size > 0) {
      return false;
    }
    if (!residualActivityExpired && this.destruction.getQueuedFractureCount() > 0) {
      return false;
    }
    const physicsStats = this.physics.getRuntimeStats();
    if (!residualActivityExpired && physicsStats.pendingSupportReleaseCount > 0) {
      return false;
    }
    const collisionBacklog =
      this.physics.getPendingCollisionBacklogCount() + this.physics.getPendingSurfaceCollisionBacklogCount();
    if (!residualActivityExpired && collisionBacklog > SCORE_COLLISION_BACKLOG_SETTLE_LIMIT) {
      return false;
    }
    if (!residualActivityExpired && now - lastActivityAt < SCORE_SETTLE_QUIET_MS) {
      return false;
    }
    let movingStructureCount = 0;
    let movingDebrisCount = 0;
    let fastDebrisCount = 0;
    for (const object of this.physics.objects.values()) {
      if (object.category === "projectile" || object.bodyType === "fixed" || object.body.isSleeping()) {
        continue;
      }
      const speed = speedOf(object);
      if (object.isDebris || object.category === "debris") {
        if (speed >= SCORE_SETTLED_SPEED) {
          movingDebrisCount += 1;
        }
        if (speed >= SCORE_FAST_DEBRIS_SPEED) {
          fastDebrisCount += 1;
        }
        continue;
      }
      if (speed >= SCORE_STRUCTURAL_SETTLED_SPEED) {
        movingStructureCount += 1;
      }
    }
    if (!residualActivityExpired) {
      if (movingStructureCount > 0) {
        return false;
      }
      if (movingDebrisCount > SCORE_MOVING_DEBRIS_LIMIT || fastDebrisCount > SCORE_FAST_DEBRIS_LIMIT) {
        return false;
      }
    }
    return true;
  }

  private spawnScatterFragments(origin: THREE.Vector3, direction: THREE.Vector3, sizeScale: number): void {
    const material = this.materials.get("metal");
    const renderMaterial = this.projectiles.getRenderMaterial("scatter");
    for (let i = 0; i < SCATTER_PHYSICAL_SHARD_COUNT; i += 1) {
      const scatterDirection = direction
        .clone()
        .add(new THREE.Vector3(randomRange(this.rng, -0.55, 0.55), randomRange(this.rng, 0.05, 0.72), randomRange(this.rng, -0.55, 0.55)))
        .normalize();
      this.physics.addDynamicSphere({
        label: "Scatter shard",
        material,
        renderMaterial,
        position: origin.clone().add(scatterDirection.clone().multiplyScalar(0.28)),
        radius: 0.095 * sizeScale,
        linearVelocity: scatterDirection.multiplyScalar(randomRange(this.rng, 16, 29)),
        angularVelocity: new THREE.Vector3(randomRange(this.rng, 2, 11), randomRange(this.rng, 2, 11), randomRange(this.rng, 2, 11)),
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
    const performanceMode = this.settings.graphicsQuality === "performance";
    const clusterCount = performanceMode ? 2 : 5;
    const secondaryDensity = performanceMode ? 0.42 : 0.82;
    for (let i = 0; i < clusterCount; i += 1) {
      const lateral = (i - (clusterCount - 1) * 0.5) * 0.74 * active.sizeScale;
      const depth = randomRange(this.rng, 0.35, 1.42) * active.sizeScale;
      const lift = randomRange(this.rng, 0.02, 0.18);
      const clusterOrigin = origin
        .clone()
        .add(forward.clone().multiplyScalar(depth))
        .add(side.clone().multiplyScalar(lateral))
        .add(new THREE.Vector3(0, lift, 0));
      const cluster = this.destruction.explode(clusterOrigin, 9.8 * active.powerScale, 1.42 * active.sizeScale);
      const miniDelay = performanceMode ? i * 0.035 : i * 0.055;
      this.explosion.play(clusterOrigin, 1.82 * active.sizeScale, cluster.dustColors, {
        projectileId: "scatter",
        result: cluster,
        powerScale: 0.58 * active.powerScale,
        sizeScale: 0.52 * active.sizeScale,
        densityScale: secondaryDensity,
        hitMaterialId: "foam",
        impactDirection: forward,
        role: "secondary"
      });
      this.audio.playScatterMiniDetonation(clusterOrigin, active.powerScale * active.sizeScale, miniDelay);
      if (cluster.dustColors.length > 0) {
        const debrisSpray = (0.18 + cluster.fracturedBodies * 0.025) * (performanceMode ? 0.65 : 1);
        this.particles.cityDebrisSpray(clusterOrigin, cluster.dustColors, debrisSpray);
      }
      events.push(...this.applyExplosionResult(cluster, 1, 0));
    }
    return events;
  }

  private async reset(): Promise<void> {
    if (this.ui.isGameplayBlocked() || this.levelReloadInProgress) {
      return;
    }
    await this.reloadLevelWithLoading("Loading district");
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

  private async reloadLevelWithLoading(status: string): Promise<void> {
    this.levelReloadInProgress = true;
    void this.renderer.setAnimationLoop(null);
    const level = this.currentLevel();
    const warmupMode = currentRenderWarmupMode();
    this.perfDiskLogger?.flush("level-reload-start");
    this.options.showLoading?.(level.name, status);
    await waitForDomPaint();
    try {
      this.loadLevel();
      this.ui.hideScorePanel();
      this.prepareRenderWarmup(warmupMode);
      this.options.updateLoadingStatus?.(warmupMode === "none" ? "Ready" : "Warming renderer pipelines");
      await this.waitForRenderWarmup();
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
    if (this.activeFixedContract()) {
      this.status = "Daily and weekly contracts use a fixed payload.";
      this.audio.playUiReject();
      return;
    }
    if (!this.availableProjectileIds().includes(id)) {
      this.status = `${PROJECTILES[id].name} unlocks with the final district.`;
      this.audio.playUiReject();
      return;
    }
    if (!this.runState.shotAvailable || this.runState.phase !== "aim") {
      this.status = "Reset before changing projectile.";
      this.audio.playUiReject();
      return;
    }
    this.selectedProjectile = id;
    this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
    this.refreshRunPlanning();
    this.audio.playLoadoutPreview(id, this.powerScale, this.sizeScale);
    this.status = `${PROJECTILES[id].name}: ${PROJECTILES[id].usageTip}`;
  }

  private activeDailyContract(): DailyContractDefinition | null {
    if (this.options.challengeKind === "weekly") {
      return null;
    }
    return this.activeFixedContract();
  }

  private activeFixedContract(): DailyContractDefinition | null {
    const daily = this.options.dailyContract;
    if (!daily || daily.levelId !== this.currentLevel().id) {
      return null;
    }
    return daily;
  }

  private updateSettings(patch: Partial<GameSettings>): void {
    this.settings = sanitizeGameSettings({ ...this.settings, ...patch });
    this.applySettings();
    saveGameSettings(this.settings);
    this.status = `Settings saved: ${settingsStatus(this.settings)}.`;
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
    this.applyGraphicsQualityLighting();
    this.applyCanvasGrade();
    this.scene.environment = this.settings.graphicsQuality === "performance" ? null : this.ensureSkyReflectionTexture();
    this.renderer.shadowMap.enabled = this.settings.graphicsQuality === "cinematic";
    if (this.sunKeyLight) {
      this.sunKeyLight.castShadow = this.settings.graphicsQuality === "cinematic";
    }
    setOptionalShadowMapFlag(this.renderer, "needsUpdate", true);
    this.resize();
  }

  private applyCanvasGrade(): void {
    const grade = canvasGradeProfile(this.settings.graphicsQuality);
    this.renderer.domElement.style.filter = grade.filter;
    this.renderer.domElement.style.boxShadow = grade.boxShadow;
  }

  private ensureSkyReflectionTexture(): THREE.Texture {
    if (!this.skyReflectionTexture) {
      this.skyReflectionTexture = this.trackPremiumSceneTexture(createSkyReflectionTexture());
    }
    return this.skyReflectionTexture;
  }

  private currentLevel(): TestChamber {
    return TEST_CHAMBERS[this.levelIndex];
  }

  private currentLevelProgress() {
    return this.arcadeProgress.levels[this.currentLevel().id];
  }

  private objectiveBrief(level: TestChamber): string {
    const projectileObjective = this.mayhemContract?.objectives[0]?.label;
    return projectileObjective ? `${level.objective} / ${projectileObjective}` : level.objective;
  }

  private chaosBrief(level: TestChamber): string {
    const contract = this.mayhemContract;
    return contract ? `${level.chaosBrief} Route: ${contract.summary}.` : level.chaosBrief;
  }

  private levelSignal(level: TestChamber): string {
    const stats = this.lastRenderStats;
    const physicsStats = this.physics.getRuntimeStats();
    const density = stats.bodyCount > 0 ? stats.bodyCount : physicsStats.bodyCount;
    const structures = stats.fixedStructureCount > 0 ? stats.fixedStructureCount : physicsStats.fixedStructureCount;
    return `Level scan: ${level.name} / density ${formatCompactScore(density)} objects / ${formatCompactScore(structures)} fixed structures / ${stats.levelComposition}`;
  }

  private levelOptions(): UILevelOption[] {
    if (this.levelOptionsCache && this.levelOptionsCacheProgress === this.arcadeProgress) {
      return this.levelOptionsCache;
    }
    this.levelOptionsCacheProgress = this.arcadeProgress;
    this.levelOptionsCache = TEST_CHAMBERS.map((level, index) => ({
      index,
      name: level.name,
      description: level.description,
      objective: level.objective,
      progress: this.arcadeProgress.levels[level.id],
      locked: index > this.arcadeProgress.highestUnlockedLevel
    }));
    return this.levelOptionsCache;
  }

  private availableProjectileIds(): readonly ProjectileId[] {
    const unlockedLevelCount = Math.max(1, Math.min(TEST_CHAMBERS.length, this.arcadeProgress.highestUnlockedLevel + 1));
    return projectileOrderForUnlockedLevels(unlockedLevelCount);
  }

  private resize(): void {
    const viewport = window.visualViewport;
    this.cameraRig.resize(Math.round(viewport?.width ?? window.innerWidth), Math.round(viewport?.height ?? window.innerHeight));
    if (this.runState.phase === "aim") {
      this.cameraRig.setCityAimView(this.cannon.getCameraAnchor(), this.currentLevel().cameraTarget);
    }
  }

  private updateAimMarker(): void {
    const visible = this.runState.phase === "aim";
    this.aimMarker.visible = visible;
    this.renderer.domElement.classList.toggle("is-cannon-aim", visible);
    if (!visible) {
      return;
    }
    this.aimMarker.position.copy(this.aimMarkerPoint).addScaledVector(this.aimSurfaceNormal, AIM_MARKER_SURFACE_OFFSET);
    this.aimMarker.quaternion.setFromUnitVectors(AIM_SURFACE_NORMAL, this.aimSurfaceNormal);
    const cameraDistance = this.cameraRig.camera.position.distanceTo(this.aimMarker.position);
    this.aimMarker.scale.setScalar(THREE.MathUtils.clamp(cameraDistance * 0.035, 0.9, 1.8));
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

  const backingMaterial = new THREE.MeshBasicMaterial({
    color: 0x031016,
    transparent: true,
    opacity: 0.74,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });
  const backingRing = new THREE.Mesh(new THREE.RingGeometry(0.23, 0.45, 42), backingMaterial);
  backingRing.rotation.x = -Math.PI * 0.5;
  backingRing.renderOrder = 99;

  const backingDot = new THREE.Mesh(new THREE.CircleGeometry(0.065, 18), backingMaterial);
  backingDot.rotation.x = -Math.PI * 0.5;
  backingDot.renderOrder = 99;

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
  const backingTickMaterial = backingMaterial;
  const backingTicks = [
    { geometry: new THREE.PlaneGeometry(0.24, 0.07), position: new THREE.Vector3(-0.5, 0, 0) },
    { geometry: new THREE.PlaneGeometry(0.24, 0.07), position: new THREE.Vector3(0.5, 0, 0) },
    { geometry: new THREE.PlaneGeometry(0.07, 0.24), position: new THREE.Vector3(0, 0, -0.5) },
    { geometry: new THREE.PlaneGeometry(0.07, 0.24), position: new THREE.Vector3(0, 0, 0.5) }
  ].map(({ geometry, position }) => {
    const tick = new THREE.Mesh(geometry, backingTickMaterial);
    tick.position.copy(position);
    tick.rotation.x = -Math.PI * 0.5;
    tick.renderOrder = 99;
    return tick;
  });

  group.add(backingRing, backingDot, ...backingTicks, ring, dot, ...tickMeshes);
  return group;
}

let activeGame: Game | null = null;
let activeShell: AppShell | null = null;
let rapierReady: Promise<unknown> | null = null;
let startToken = 0;

async function boot(): Promise<void> {
  registerDowntownMayhemServiceWorker();
  activeShell?.dispose();
  const shell = new AppShell({
    startLevel: (levelIndex) => {
      void startLevelFromShell(shell, levelIndex);
    },
    startDaily: (contract) => {
      void startLevelFromShell(shell, contract.levelIndex, contract, "daily");
    },
    startWeekly: (entry) => {
      void startLevelFromShell(shell, entry.levelIndex, weeklyEntryToFixedContract(entry), "weekly");
    }
  });
  activeShell = shell;
  shell.showMenu();
  void preloadGraphicTextures();
  void ensureRapierReady().catch((error: unknown) => {
    console.warn("Downtown Mayhem: physics engine preload failed.", error);
  });

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

async function startLevelFromShell(
  shell: AppShell,
  requestedLevelIndex: number,
  dailyContract: DailyContractDefinition | null = null,
  challengeKind: "daily" | "weekly" = "daily"
): Promise<void> {
  const progress = loadArcadeProgress(ARCADE_LEVELS);
  const levelIndex = clampInitialLevelIndex(requestedLevelIndex, progress.highestUnlockedLevel);
  const level = TEST_CHAMBERS[levelIndex];
  const token = startToken + 1;
  startToken = token;
  activeGame?.dispose();
  activeGame = null;
  delete window.__DOWNTOWN_MAYHEM_DEBUG__;
  shell.showLoading(level.name, "Initializing physics engine");
  await waitForDomPaint();

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
    await waitForDomPaint();
    const game = new Game(settings, rendererBundle, {
      initialLevelIndex: levelIndex,
      dailyContract: dailyContract?.levelIndex === levelIndex ? dailyContract : null,
      challengeKind,
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
  rapierReady ??= initializeRapierCompat();
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
    getCannonVisualState: () => game.getCannonVisualState(),
    getRunFeedback: () => game.getRunFeedback(),
    getLiveMastery: () => game.getLiveMastery(),
    getDailyContract: () => game.getDailyContract(),
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
  if (isNuclearReactorHazard(label, zone)) {
    return 260;
  }
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
  if (isElevatedMetroHazard(label, zone)) {
    return 130;
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

function chainImpactMinSpeed(source: PhysicsObject): number {
  const impactVolumeScale = source.impactVolumeScale ?? 1;
  if (impactVolumeScale <= 1) {
    return CHAIN_DEBRIS_MIN_SPEED;
  }
  return Math.max(1.15, CHAIN_DEBRIS_MIN_SPEED - Math.min(0.7, Math.log2(impactVolumeScale) * 0.18));
}

function isChainTarget(object: PhysicsObject): boolean {
  return object.category !== "projectile" && !object.isDebris && object.destructible && object.canFracture;
}

function isVolatileHazard(object: ExplosionAffectedObject): boolean {
  const label = object.label.toLowerCase();
  const zone = object.zoneId ?? "";
  return isIdentifiableExplosiveHazard(label, zone);
}

function volatileHazardProfile(object: ExplosionAffectedObject): VolatileHazardProfile {
  const label = object.label.toLowerCase();
  const zone = object.zoneId ?? "";
  if (isNuclearReactorHazard(label, zone)) {
    return volatileProfileWithObjectScale(
      {
        strength: 58,
        radius: 5.8,
        heatRadius: 5.4,
        projectileId: "ignite",
        color: 0xffd15c,
        powerScale: 2.05,
        sizeScale: 1.85,
        densityScale: 0.9,
        delayScale: 0.22,
        maxSpreadCount: 2,
        mushroomCloud: true
      },
      object
    );
  }
  if (isPropaneDepotHazard(label, zone)) {
    return volatileProfileWithObjectScale({
      strength: 36,
      radius: 3.65,
      heatRadius: 3.5,
      projectileId: "ignite",
      color: 0xff8f38,
      powerScale: 1.18,
      sizeScale: 1.16,
      densityScale: 0.72,
      delayScale: 0.42,
      maxSpreadCount: 2
    }, object);
  }
  if (isGasHazard(label, zone)) {
    return volatileProfileWithObjectScale({
      strength: 32,
      radius: 3.35,
      heatRadius: 3.35,
      projectileId: "ignite",
      color: 0xff7a35,
      powerScale: 1.08,
      sizeScale: 1.08,
      densityScale: 0.68,
      delayScale: 0.46,
      maxSpreadCount: 2
    }, object);
  }
  if (isEnergyPlantHazard(label, zone)) {
    return volatileProfileWithObjectScale({
      strength: 28,
      radius: 3.05,
      heatRadius: 2.9,
      projectileId: "pulse",
      color: 0x8ff7ff,
      powerScale: 1.0,
      sizeScale: 1.0,
      densityScale: 0.66,
      delayScale: 0.58,
      maxSpreadCount: 1
    }, object);
  }
  if (isElectricSubstationHazard(label, zone)) {
    return volatileProfileWithObjectScale({
      strength: 27,
      radius: 3.1,
      heatRadius: 2.75,
      projectileId: "pulse",
      color: 0x93f6ff,
      powerScale: 0.98,
      sizeScale: 0.94,
      densityScale: 0.64,
      delayScale: 0.62,
      maxSpreadCount: 1
    }, object);
  }
  if (isParkingSiloHazard(label, zone)) {
    return volatileProfileWithObjectScale({
      strength: 24,
      radius: 2.8,
      heatRadius: 3.0,
      projectileId: "ignite",
      color: 0xffc241,
      powerScale: 0.92,
      sizeScale: 0.9,
      densityScale: 0.62,
      delayScale: 0.66,
      maxSpreadCount: 2
    }, object);
  }
  if (isElevatedMetroHazard(label, zone)) {
    const trainCar = isElevatedMetroTrainHazard(label, zone);
    return volatileProfileWithObjectScale({
      strength: trainCar ? 26 : 22,
      radius: trainCar ? 2.85 : 2.45,
      heatRadius: trainCar ? 2.8 : 2.35,
      projectileId: "pulse",
      color: 0x9bf8ff,
      powerScale: trainCar ? 1.02 : 0.9,
      sizeScale: trainCar ? 0.98 : 0.84,
      densityScale: trainCar ? 0.64 : 0.56,
      delayScale: trainCar ? 0.64 : 0.7,
      maxSpreadCount: 1
    }, object);
  }
  if (zone.includes("power-grid") || label.includes("transformer") || label.includes("power-grid")) {
    return volatileProfileWithObjectScale({
      strength: 21,
      radius: 2.35,
      heatRadius: 2.45,
      projectileId: "pulse",
      color: 0x8ff7ff,
      powerScale: 0.84,
      sizeScale: 0.8,
      densityScale: 0.58,
      delayScale: 0.72,
      maxSpreadCount: 1
    }, object);
  }
  if (isVehicleExplosionHazard(label, zone)) {
    const largeVehicle = isLargeVehicleHazard(label);
    return volatileProfileWithObjectScale({
      strength: largeVehicle ? 21 : 16,
      radius: largeVehicle ? 2.38 : 1.92,
      heatRadius: largeVehicle ? 2.55 : 2.05,
      projectileId: "ignite",
      color: 0xff8f38,
      powerScale: largeVehicle ? 0.88 : 0.72,
      sizeScale: largeVehicle ? 0.82 : 0.68,
      densityScale: 0.52,
      delayScale: largeVehicle ? 0.76 : 0.82,
      maxSpreadCount: 1
    }, object);
  }
  return volatileProfileWithObjectScale({
    strength: 18,
    radius: 2.55,
    heatRadius: 2.5,
    projectileId: "scatter",
    color: 0xff4f66,
    powerScale: 0.84,
    sizeScale: 0.8,
    densityScale: 0.58,
    delayScale: 0.74,
    maxSpreadCount: 1
  }, object);
}

function volatileProfileWithObjectScale(profile: VolatileHazardProfile, object: ExplosionAffectedObject): VolatileHazardProfile {
  const scoreScale = THREE.MathUtils.clamp(Math.sqrt(Math.max(1, object.scoreValue) / 360), 0.82, 1.48);
  const energyScale = THREE.MathUtils.clamp(Math.sqrt(Math.max(1, object.energy) / Math.max(1, object.scoreValue * 0.65)), 0.86, 1.38);
  return {
    ...profile,
    strength: profile.strength * THREE.MathUtils.lerp(0.92, scoreScale, 0.48) * THREE.MathUtils.lerp(0.94, energyScale, 0.34),
    radius: profile.radius * THREE.MathUtils.lerp(0.92, scoreScale, 0.32),
    heatRadius: profile.heatRadius * THREE.MathUtils.lerp(0.92, scoreScale, 0.36),
    powerScale: profile.powerScale * THREE.MathUtils.lerp(0.96, energyScale, 0.28),
    sizeScale: profile.sizeScale * THREE.MathUtils.lerp(0.96, scoreScale, 0.25)
  };
}

function sortVolatileHazards(a: ExplosionAffectedObject, b: ExplosionAffectedObject): number {
  return volatileHazardPriority(b) - volatileHazardPriority(a) || b.energy - a.energy;
}

function volatileHazardPriority(object: ExplosionAffectedObject): number {
  const label = object.label.toLowerCase();
  const zone = object.zoneId ?? "";
  if (isNuclearReactorHazard(label, zone)) {
    return 160;
  }
  if (isPropaneDepotHazard(label, zone)) {
    return 125;
  }
  if (isGasHazard(label, zone)) {
    return 120;
  }
  if (isElevatedMetroHazard(label, zone)) {
    return isElevatedMetroTrainHazard(label, zone) ? 68 : 58;
  }
  if (zone.includes("hazard-relay") || label.includes("shock canister") || label.includes("canister")) {
    return 76;
  }
  if (label.includes("tanker")) {
    return 62;
  }
  if (isVehicleExplosionHazard(label, zone)) {
    return isLargeVehicleHazard(label) ? 52 : 44;
  }
  return 40;
}

function ignitionExplosionLabel(object: ExplosionAffectedObject): string {
  return `${hazardSourceLabel(object)} IGNITES`;
}

function ignitionWarningColor(hazard: BurningHazard): THREE.ColorRepresentation {
  if (hazard.mushroomCloud || hazard.label.includes("NUCLEAR") || hazard.label.includes("REACTOR")) {
    return 0xffd15c;
  }
  if (hazard.label.includes("PROPANE") || hazard.label.includes("GAS") || hazard.label.includes("VEHICLE")) {
    return 0xff8f38;
  }
  if (hazard.label.includes("METRO") || hazard.label.includes("TRANSIT")) {
    return 0x9bf8ff;
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
  if (isNuclearReactorHazard(label, zone)) {
    return "NUCLEAR PLANT";
  }
  if (isPropaneDepotHazard(label, zone)) {
    return "PROPANE DEPOT";
  }
  if (isGasHazard(label, zone)) {
    return "GAS LINE";
  }
  if (isElevatedMetroHazard(label, zone)) {
    return isElevatedMetroTrainHazard(label, zone) ? "METRO CAR" : "METRO LINE";
  }
  if (label.includes("shock canister") || label.includes("canister")) {
    return "CANISTER";
  }
  if (isVehicleExplosionHazard(label, zone)) {
    return "VEHICLE";
  }
  if (zone.includes("hazard-relay") || label.includes("relay")) {
    return "HAZARD RELAY";
  }
  return `${scoreMaterialLabel(object.materialId)} HAZARD`;
}

function isIdentifiableExplosiveHazard(label: string, zone: string): boolean {
  return (
    isNuclearReactorHazard(label, zone) ||
    isPropaneDepotHazard(label, zone) ||
    isGasHazard(label, zone) ||
    isElevatedMetroHazard(label, zone) ||
    isVehicleExplosionHazard(label, zone) ||
    isExplosiveCanisterHazard(label, zone)
  );
}

function isNuclearReactorHazard(label: string, zone: string): boolean {
  return (zone.includes("nuclear-plant") || label.includes("nuclear plant")) && (zone.includes("reactor") || label.includes("reactor"));
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
  return isGasPumpHazard(label, zone) || isGasLineHazard(label, zone) || isFuelTankHazard(label, zone);
}

function isGasPumpHazard(label: string, zone: string): boolean {
  return zone.includes("fuel-pump") || label.includes("gas pump") || label.includes("fuel pump");
}

function isGasLineHazard(label: string, zone: string): boolean {
  return (
    label.includes("gas line") ||
    label.includes("fuel line") ||
    label.includes("pipeline") ||
    label.includes("conduit") ||
    (label.includes("pipe") && (zone.includes("gas") || zone.includes("fuel")))
  );
}

function isFuelTankHazard(label: string, zone: string): boolean {
  const fuelZone = zone.includes("fuel") || zone.includes("gas") || zone.includes("propane");
  return (
    zone.includes("moving-fuel-tanker") ||
    label.includes("tanker") ||
    (fuelZone && (label.includes("tank") || label.includes("fuel depot") || label.includes("fuel rack")))
  );
}

function isExplosiveCanisterHazard(label: string, zone: string): boolean {
  return label.includes("shock canister") || label.includes("canister") || zone.includes("hazard-relay explosive");
}

function isElevatedMetroHazard(label: string, zone: string): boolean {
  return zone.includes("elevated-metro") || label.includes("elevated metro");
}

function isElevatedMetroTrainHazard(label: string, zone: string): boolean {
  return isElevatedMetroHazard(label, zone) && (label.includes("lead car") || label.includes("middle car") || label.includes("tail car") || label.includes("metro bus"));
}

function isVehicleExplosionHazard(label: string, zone: string): boolean {
  if (isElevatedMetroHazard(label, zone)) {
    return false;
  }
  return hasVehicleLabel(label);
}

function isLargeVehicleHazard(label: string): boolean {
  return hasAnyLabelToken(label, ["bus", "van", "truck", "tram", "hauler", "shuttle", "microbus", "flatbed", "tanker"]);
}

function hasVehicleLabel(label: string): boolean {
  return hasAnyLabelToken(label, [
    "vehicle",
    "car",
    "microbus",
    "scooter",
    "shuttle",
    "truck",
    "cart",
    "tram",
    "hauler",
    "loader",
    "taxi",
    "courier",
    "coupe",
    "van",
    "hatchback",
    "fastback",
    "flatbed",
    "tanker",
    "pod"
  ]);
}

function hasAnyLabelToken(label: string, terms: readonly string[]): boolean {
  const tokens = label.split(/[^a-z0-9]+/).filter(Boolean);
  return terms.some((term) => tokens.includes(term));
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
  return isIdentifiableExplosiveHazard(object.label.toLowerCase(), zone);
}

function canIgnitePhysicsObject(object: PhysicsObject): boolean {
  if (object.category !== "structure" || !object.destructible || object.zoneId === "surface") {
    return false;
  }
  const zone = object.zoneId ?? "";
  return isIdentifiableExplosiveHazard(object.label.toLowerCase(), zone);
}

function affectedObjectFromPhysics(object: PhysicsObject, position: THREE.Vector3, energy: number): ExplosionAffectedObject {
  return {
    id: object.id,
    label: object.label,
    materialId: object.materialId,
    category: object.category,
    scoreRole: object.scoreRole,
    zoneId: object.zoneId,
    position: position.clone(),
    energy,
    weightedDamage: Math.round(Math.max(1, object.scoreValue) * 0.18),
    scoreValue: object.scoreValue,
    fractured: false
  };
}

function fireSpreadPriority(object: PhysicsObject, origin: THREE.Vector3): number {
  const label = object.label.toLowerCase();
  const zone = object.zoneId ?? "";
  const distancePenalty = vectorFromRapier(object.body.translation()).distanceTo(origin) * 9;
  let priority = object.scoreValue * 0.5;
  if (isNuclearReactorHazard(label, zone)) {
    priority += 150;
  }
  if (isPropaneDepotHazard(label, zone) || isFuelTankHazard(label, zone)) {
    priority += 90;
  }
  if (isGasPumpHazard(label, zone) || isGasLineHazard(label, zone)) {
    priority += 72;
  }
  if (isElevatedMetroHazard(label, zone)) {
    priority += 62;
  }
  if (isVehicleExplosionHazard(label, zone)) {
    priority += isLargeVehicleHazard(label) ? 44 : 34;
  }
  if (isExplosiveCanisterHazard(label, zone)) {
    priority += 58;
  }
  return priority - distancePenalty;
}

function ignitionHazardProfile(object: ExplosionAffectedObject, igniteBias: number, energyRatio: number): VolatileHazardProfile {
  const zone = object.zoneId ?? "";
  const label = object.label.toLowerCase();
  if (isElevatedMetroHazard(label, zone)) {
    return volatileProfileWithObjectScale(
      {
        strength: 19,
        radius: 2.35,
        heatRadius: 2.3,
        projectileId: "pulse",
        color: 0x9bf8ff,
        powerScale: THREE.MathUtils.clamp(0.72 + igniteBias * 0.24 + energyRatio * 0.04, 0.72, 1.05),
        sizeScale: THREE.MathUtils.clamp(0.72 + igniteBias * 0.2, 0.72, 1.0),
        densityScale: 0.52,
        delayScale: igniteBias,
        maxSpreadCount: 1
      },
      object
    );
  }
  if (isVehicleExplosionHazard(label, zone)) {
    const largeVehicle = isLargeVehicleHazard(label);
    return volatileProfileWithObjectScale(
      {
        strength: largeVehicle ? 18 : 14,
        radius: largeVehicle ? 2.18 : 1.78,
        heatRadius: largeVehicle ? 2.3 : 1.95,
        projectileId: "ignite",
        color: 0xff8f38,
        powerScale: THREE.MathUtils.clamp(0.66 + igniteBias * 0.28 + energyRatio * 0.04, 0.68, 1.05),
        sizeScale: THREE.MathUtils.clamp(0.68 + igniteBias * 0.2, 0.68, 1.0),
        densityScale: 0.5,
        delayScale: igniteBias,
        maxSpreadCount: 1
      },
      object
    );
  }
  const radius = zone.includes("power-grid") ? 2.15 : object.materialId === "foam" ? 2.65 : object.materialId === "rubber" ? 2.55 : 2.35;
  const strength = object.materialId === "wood" || object.materialId === "foam" || object.materialId === "rubber" ? 18 : zone.includes("energy-plant") ? 20 : 14;
  return volatileProfileWithObjectScale(
    {
      strength,
      radius,
      heatRadius: radius * (object.materialId === "foam" || object.materialId === "rubber" ? 1.18 : 1.02),
      projectileId: zone.includes("power-grid") || zone.includes("energy-plant") ? "pulse" : "ignite",
      color: zone.includes("power-grid") || zone.includes("energy-plant") ? 0x8ff7ff : 0xff8f38,
      powerScale: THREE.MathUtils.clamp(0.68 + igniteBias * 0.34 + energyRatio * 0.04, 0.72, 1.18),
      sizeScale: THREE.MathUtils.clamp(0.74 + igniteBias * 0.24, 0.76, 1.12),
      densityScale: 0.58,
      delayScale: igniteBias,
      maxSpreadCount: object.materialId === "foam" || object.materialId === "rubber" || zone.includes("gas") || zone.includes("fuel") ? 2 : 1
    },
    object
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

function isBrittlePenetrationMaterial(materialId: MaterialId): boolean {
  return materialId === "glass" || materialId === "foam" || materialId === "wood";
}

function heavyPenetrationSpeed(active: ActiveProjectile, target: PhysicsObject, measuredSpeed: number): number {
  if (active.definition.id !== "gravity") {
    return measuredSpeed;
  }
  const launchSpeed = active.definition.speed * active.powerScale;
  const floorScale =
    target.materialId === "glass" || target.materialId === "foam"
      ? 0.82
      : target.materialId === "wood"
        ? 0.7
        : target.materialId === "concrete" || target.materialId === "metal"
          ? 0.54
          : 0.62;
  return Math.max(measuredSpeed, launchSpeed * floorScale);
}

function penetrationExitDistance(active: ActiveProjectile, target: PhysicsObject): number {
  const base = active.radius + 0.34;
  if (active.definition.id !== "gravity") {
    return base;
  }
  const halfThickness = Math.max(target.dimensions.x, target.dimensions.y, target.dimensions.z) * 0.5;
  const materialBoost = isBrittlePenetrationMaterial(target.materialId) ? 0.62 : 0.42;
  return Math.max(base, active.radius + halfThickness * materialBoost + 0.34);
}

function penetrationImpactScale(projectileId: ProjectileId, target: PhysicsObject): number {
  if (projectileId === "gravity") {
    if (target.materialId === "concrete" || target.materialId === "metal") {
      return 1.08;
    }
    if (target.materialId === "wood") {
      return 0.9;
    }
    if (target.materialId === "glass" || target.materialId === "foam") {
      return 0.82;
    }
  }
  return 0.18;
}

function penetrationRetainedSpeed(projectileId: ProjectileId, target: PhysicsObject): number {
  if (projectileId === "gravity") {
    if (target.materialId === "concrete" || target.materialId === "metal") {
      return 0.66;
    }
    if (target.materialId === "wood") {
      return 0.76;
    }
    if (target.materialId === "glass" || target.materialId === "foam") {
      return 0.94;
    }
  }
  return 0.42;
}

function directImpactScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 0.94;
    case "gravity":
      return 1.44;
    case "pulse":
      return 0.52;
    case "scatter":
      return 0.54;
    case "ignite":
      return 0.74;
  }
}

function impactBlastProfile(
  projectile: ProjectileDefinition,
  hitObject: PhysicsObject | null,
  powerScale: number,
  sizeScale: number,
  sourceSpeed: number,
  materials: MaterialCatalog
): ImpactBlastProfile {
  const residualStrength = residualBlastScale(projectile.id);
  const residualRadius = residualBlastRadiusScale(projectile.id);
  const baseStrength = projectile.impulse * powerScale * projectile.fractureBoost * residualStrength;
  const baseRadius = projectile.blastRadius * sizeScale * residualRadius;
  const baseVisualRadius = projectile.blastRadius * sizeScale * impactVisualRadiusScale(projectile.id);
  if (!hitObject || residualStrength <= 0 || residualRadius <= 0) {
    return {
      strength: baseStrength,
      radius: baseRadius,
      visualRadius: baseVisualRadius,
      audioPowerScale: powerScale,
      vfxPowerScale: powerScale,
      sizeScale,
      ignitionBias: projectile.id === "ignite" ? 1.35 : projectile.id === "pulse" ? 0.35 : 0
    };
  }

  const material = materials.get(hitObject.materialId);
  const volume = Math.max(0.08, hitObject.dimensions.x * hitObject.dimensions.y * hitObject.dimensions.z);
  const massScore = volume * Math.max(0.6, material.massFactor) * Math.max(0.6, hitObject.fractureResistance ?? 1);
  const massScale = THREE.MathUtils.clamp(0.82 + Math.log1p(massScore) * 0.16 + hitObject.scoreValue / 2800, 0.86, 1.58);
  const speedScale = THREE.MathUtils.clamp(sourceSpeed / Math.max(1, projectile.speed * powerScale), 0.78, 1.32);
  const targetRoleScale = hitObject.scoreRole === "target" ? 1.08 : 1;
  const strengthScale = massScale * THREE.MathUtils.lerp(0.9, speedScale, 0.42) * targetRoleScale;
  const radiusScale = THREE.MathUtils.clamp(0.88 + (massScale - 1) * 0.5 + (sizeScale - 1) * 0.12, 0.82, 1.36);
  const ignitionBias =
    projectile.id === "ignite"
      ? THREE.MathUtils.clamp(1.08 + (massScale - 1) * 0.42, 1.05, 1.65)
      : projectile.id === "pulse"
        ? 0.35
        : canIgnitePhysicsObject(hitObject)
          ? THREE.MathUtils.clamp(0.16 + (massScale - 1) * 0.34, 0.12, 0.58)
          : 0;

  return {
    strength: baseStrength * strengthScale,
    radius: baseRadius * radiusScale,
    visualRadius: baseVisualRadius * THREE.MathUtils.clamp(0.9 + (strengthScale - 1) * 0.22 + (radiusScale - 1) * 0.42, 0.88, 1.42),
    audioPowerScale: powerScale * THREE.MathUtils.clamp(0.9 + (strengthScale - 1) * 0.22, 0.88, 1.34),
    vfxPowerScale: powerScale * THREE.MathUtils.clamp(0.92 + (strengthScale - 1) * 0.28, 0.9, 1.42),
    sizeScale: sizeScale * THREE.MathUtils.clamp(radiusScale, 0.86, 1.34),
    ignitionBias
  };
}

function residualBlastScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 0.82;
    case "gravity":
      return 0;
    case "pulse":
      return 0.38;
    case "scatter":
      return 0.46;
    case "ignite":
      return 0.78;
  }
}

function residualBlastRadiusScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 1;
    case "gravity":
      return 0;
    case "pulse":
      return 1.2;
    case "scatter":
      return 0.74;
    case "ignite":
      return 0.86;
  }
}

function impactVisualRadiusScale(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 1.62;
    case "gravity":
      return 1.44;
    case "pulse":
      return 1.82;
    case "scatter":
      return 1.58;
    case "ignite":
      return 1.55;
  }
}

function gravityImpactVisualRadius(active: ActiveProjectile, result: ExplosionResult | null): number {
  const fractureBoost = Math.min(2.2, (result?.fracturedBodies ?? 0) * 0.07);
  return Math.max(7.8, active.definition.blastRadius * active.sizeScale * 10.1 + fractureBoost);
}

function projectileImpactShake(projectileId: ProjectileId): { magnitude: number; duration: number } {
  switch (projectileId) {
    case "slug":
      return { magnitude: PRIMARY_IMPACT_SHAKE_MAGNITUDE * 1.16, duration: PRIMARY_IMPACT_SHAKE_DURATION * 1.04 };
    case "scatter":
      return { magnitude: PRIMARY_IMPACT_SHAKE_MAGNITUDE * 1.05, duration: PRIMARY_IMPACT_SHAKE_DURATION * 0.9 };
    case "pulse":
      return { magnitude: PRIMARY_IMPACT_SHAKE_MAGNITUDE * 1.22, duration: PRIMARY_IMPACT_SHAKE_DURATION };
    case "gravity":
      return { magnitude: GRAVITY_IMPACT_SHAKE_MAGNITUDE * 1.06, duration: GRAVITY_IMPACT_SHAKE_DURATION * 1.08 };
    case "ignite":
      return { magnitude: PRIMARY_IMPACT_SHAKE_MAGNITUDE * 1.26, duration: PRIMARY_IMPACT_SHAKE_DURATION * 1.12 };
  }
}

function projectileImpactHitStop(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "scatter":
      return PRIMARY_IMPACT_HIT_STOP_SECONDS * 0.9;
    case "pulse":
      return PRIMARY_IMPACT_HIT_STOP_SECONDS * 0.98;
    case "gravity":
      return GRAVITY_IMPACT_HIT_STOP_SECONDS * 1.08;
    case "slug":
    case "ignite":
      return PRIMARY_IMPACT_HIT_STOP_SECONDS * 1.18;
  }
}

function projectileImpactSlowMo(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "scatter":
      return PRIMARY_IMPACT_SLOWMO_SECONDS * 0.88;
    case "pulse":
      return PRIMARY_IMPACT_SLOWMO_SECONDS;
    case "gravity":
      return GRAVITY_IMPACT_SLOWMO_SECONDS * 1.14;
    case "slug":
    case "ignite":
      return PRIMARY_IMPACT_SLOWMO_SECONDS * 1.18;
  }
}

function scorePopupImpactDelay(projectileId: ProjectileId): number {
  switch (projectileId) {
    case "slug":
      return 0.28;
    case "scatter":
      return 0.24;
    case "pulse":
      return 0.34;
    case "gravity":
      return 0.2;
    case "ignite":
      return 0.26;
  }
}

function projectileImpactCandidate(
  active: ActiveProjectile,
  object: PhysicsObject,
  previous: THREE.Vector3,
  current: THREE.Vector3
): { point: THREE.Vector3; object: PhysicsObject; distance: number } | null {
  return sweptImpactCandidate(active.radius, object, previous, current);
}

function sweptImpactCandidate(
  radius: number,
  object: PhysicsObject,
  previous: THREE.Vector3,
  current: THREE.Vector3
): { point: THREE.Vector3; object: PhysicsObject; distance: number } | null {
  if (!segmentCanReachObject(previous, current, object, radius + 0.2)) {
    return null;
  }
  if (object.shape === "sphere") {
    const objectPosition = object.body.translation();
    const threshold = radius + object.radius;
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
  const expandedHalf = originalHalf.clone().addScalar(radius + 0.08);
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

function formatCompactScore(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(rounded) >= 1_000_000) {
    return `${Math.round(rounded / 100_000) / 10}M`;
  }
  if (Math.abs(rounded) >= 10_000) {
    return `${Math.round(rounded / 1_000)}K`;
  }
  return rounded.toLocaleString("en-US");
}

function levelCompositionLine(stats: {
  fixedStructureCount: number;
  debrisBodyCount: number;
  activeDebrisCount: number;
  pendingSupportReleaseCount: number;
}): string {
  const debris = stats.debrisBodyCount > 0 ? `${formatCompactScore(stats.debrisBodyCount)} debris-ready` : "low loose debris";
  const support = stats.pendingSupportReleaseCount > 0 ? `${formatCompactScore(stats.pendingSupportReleaseCount)} staged supports` : "supports stable";
  return `${formatCompactScore(stats.fixedStructureCount)} structures / ${debris} / ${support}`;
}

function metricShortLabel(metric: TestChamber["mission"]["bonusThreshold"]["metric"]): string {
  switch (metric) {
    case "targetDamage":
      return "Object";
    case "collateralChaos":
      return "Chaos";
    case "chainReactionBonus":
      return "Chain score";
    case "remainingDebrisMotion":
      return "Motion";
    case "chainReactionCount":
      return "Hits";
    case "maxChainCombo":
      return "Combo";
  }
}

function cinematicImpactStatus(result: ExplosionResult, focusScore: number): string {
  const topLabel = result.affectedObjects
    .filter((object) => object.fractured)
    .sort((a, b) => b.weightedDamage - a.weightedDamage)[0]?.label;
  if (focusScore >= 720) {
    return topLabel ? `Cinematic hit: ${topLabel} is driving a major collapse.` : "Cinematic hit: major collapse in progress.";
  }
  if (result.fracturedBodies >= 5) {
    return topLabel ? `Cinematic hit: ${topLabel} triggered a chain break.` : "Cinematic hit: chain break triggered.";
  }
  return topLabel ? `Cinematic hit: ${topLabel} cracked open.` : "Cinematic hit: watching the damage unfold.";
}

interface MoneyShotCandidate {
  priority: number;
  focus: THREE.Vector3;
}

function moneyShotCandidate(result: ExplosionResult, focusScore: number, fallback: THREE.Vector3): MoneyShotCandidate | null {
  let best: MoneyShotCandidate | null = null;
  for (const object of result.affectedObjects) {
    if (!object.fractured) {
      continue;
    }
    const priority = moneyShotObjectPriority(object, result, focusScore);
    if (priority <= 0) {
      continue;
    }
    const candidate = {
      priority: priority + Math.min(80, object.weightedDamage * 0.18),
      focus: object.position.clone()
    };
    if (!best || candidate.priority > best.priority) {
      best = candidate;
    }
  }

  if (best) {
    return best;
  }

  if (focusScore >= 860 || result.fracturedBodies >= 9) {
    return { priority: Math.max(680, Math.min(780, focusScore * 0.88)), focus: fallback.clone() };
  }
  return null;
}

function moneyShotObjectPriority(
  object: ExplosionResult["affectedObjects"][number],
  result: ExplosionResult,
  focusScore: number
): number {
  const text = `${object.label} ${object.zoneId ?? ""}`.toLowerCase();
  let priority = 0;

  if (text.includes("skyneedle") && (text.includes("crown") || text.includes("spire") || text.includes("signature-debris"))) {
    priority = 900;
  } else if (text.includes("weak-point") || text.includes("weak point") || text.includes("shear pin") || text.includes("release") || text.includes("latch")) {
    priority = 860;
  } else if (text.includes("support column") || text.includes("support-column")) {
    priority = 820;
  } else if (
    text.includes("parking-silo") ||
    text.includes("parking silo") ||
    text.includes("elevated-metro") ||
    text.includes("elevated metro") ||
    text.includes("construction crane") ||
    text.includes("construction-scaffold") ||
    text.includes("skyneedle")
  ) {
    priority = 760;
  } else if (
    text.includes("nuclear-plant") ||
    text.includes("reactor") ||
    text.includes("substation") ||
    text.includes("propane") ||
    text.includes("gas-station")
  ) {
    priority = 700;
  }

  if (priority <= 0 && (focusScore >= 760 || result.fracturedBodies >= 7) && object.scoreRole === "target") {
    priority = 650;
  }
  if (priority <= 0) {
    return 0;
  }
  return Math.min(1040, priority + Math.min(70, result.fracturedBodies * 7) + Math.min(45, result.affectedBodies * 1.8));
}

function settingsStatus(settings: GameSettings): string {
  return `${GRAPHICS_QUALITY_LABELS[settings.graphicsQuality]}, WebGL renderer, ${Math.round(settings.masterVolume * 100)}% volume, ${Math.round(settings.cameraShake * 100)}% shake`;
}

function graphicsLightingProfile(quality: GraphicsQuality): GraphicsLightingProfile {
  switch (quality) {
    case "performance":
      return {
        background: 0x8fc7dc,
        fog: 0xcfd2c5,
        fogNear: 58,
        fogFar: 138,
        exposure: 1.09,
        ambientSky: 0x9fd1dc,
        ambientGround: 0xa47b4a,
        ambientIntensity: 0.86,
        sunColor: 0xffc474,
        sunIntensity: 3.02,
        skyFillColor: 0x6faec6,
        skyFillIntensity: 0.34,
        shadowMapSize: 1536
      };
    case "balanced":
      return {
        background: 0x81bed8,
        fog: 0xcac8b7,
        fogNear: 52,
        fogFar: 128,
        exposure: 1.13,
        ambientSky: 0x93c8d8,
        ambientGround: 0x9e7242,
        ambientIntensity: 0.88,
        sunColor: 0xffb85f,
        sunIntensity: 3.18,
        skyFillColor: 0x64a8c2,
        skyFillIntensity: 0.37,
        shadowMapSize: 1536
      };
    case "cinematic":
      return {
        background: 0x72aec8,
        fog: 0xc7bca3,
        fogNear: 46,
        fogFar: 118,
        exposure: 1.19,
        ambientSky: 0x8ec1d0,
        ambientGround: 0x9a6a3a,
        ambientIntensity: 0.92,
        sunColor: 0xffad55,
        sunIntensity: 3.34,
        skyFillColor: 0x5d9fbd,
        skyFillIntensity: 0.42,
        shadowMapSize: 2048
      };
  }
}

function canvasGradeProfile(quality: GraphicsQuality): CanvasGradeProfile {
  switch (quality) {
    case "performance":
      return {
        filter: "none",
        boxShadow: "none"
      };
    case "balanced":
      return {
        filter: "contrast(1.06) saturate(0.96) sepia(0.05)",
        boxShadow: "inset 0 0 62px rgba(5, 13, 18, 0.16)"
      };
    case "cinematic":
      return {
        filter: "contrast(1.095) saturate(0.94) sepia(0.08)",
        boxShadow: "inset 0 0 98px rgba(5, 13, 18, 0.22)"
      };
  }
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
