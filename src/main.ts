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
import { DestructionSystem, type ExplosionAffectedObject, type ExplosionResult } from "./destruction";
import { InputController } from "./input";
import { TEST_CHAMBERS, type TestChamber } from "./levels";
import { MaterialCatalog } from "./materialCatalog";
import { perfMonitor, type PerfReport } from "./perf";
import { PhysicsWorld, type PhysicsObject } from "./physics";
import { PROJECTILES, ProjectileSystem, type ActiveProjectile, type ProjectileId } from "./projectile";
import { SeededRandom, createRunSeed, randomRange } from "./random";
import { ShotRunState } from "./runState";
import { ScorePopupLayer } from "./scorePopups";
import { ShotScoreTracker, type ScoreBreakdown, type ScoreEvent } from "./scoring";
import {
  DEFAULT_GAME_SETTINGS,
  type GameSettings,
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
const CHAIN_COLLISION_DRAIN_MAX_PER_FRAME = 192;
const CRANE_CRUSH_MAX_PER_FRAME = 8;
const SURFACE_IMPACT_MAX_PER_FRAME = 6;
const SURFACE_COLLISION_MAX_PER_FRAME = 160;
const FRACTURE_PROCESS_MAX_PER_FRAME = 2;
const FRACTURE_PROCESS_TIME_BUDGET_MS = 3.2;
const CHAIN_IMPACT_SWEEP_MS = 160;
const SCORE_SETTLED_SPEED = 1.55;
const AIM_FALLBACK_SURFACE_Y = 0.055;
const AIM_MARKER_SURFACE_OFFSET = 0.095;
const FIRE_MIN_DELAY_MS = 760;
const FIRE_MAX_DELAY_MS = 1850;
const MAX_BURNING_HAZARDS = 18;
const HAZARD_EXPLOSIONS_MAX_PER_FRAME = 1;
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
  drawCalls: number;
  triangles: number;
  lines: number;
  points: number;
  geometries: number;
  textures: number;
  programs: number;
  visibleMeshes: number;
  visibleMaterials: number;
}

interface DowntownMayhemDebugApi {
  getRenderStats(): DowntownMayhemRenderStats;
  getPerfReport(): PerfReport;
  setPerfEnabled(enabled: boolean): void;
  clearPerfReport(): void;
  freezeForCapture(): DowntownMayhemRenderStats;
  resume(): void;
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
  renderer.setPixelRatio(graphicsPixelRatioCap(settings.graphicsQuality));
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
  private readonly aimSurfaceHits: THREE.Intersection<THREE.Object3D>[] = [];
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
  private readonly handleResize = () => this.resize();
  private readonly handleBeforeUnload = () => this.input.dispose();
  private readonly chainImpactCooldowns = new Map<string, number>();
  private readonly surfaceImpactCooldowns = new Map<number, number>();
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
  private nextChainCooldownSweep = 0;
  private spectacleFocusScore = 0;
  private spectacleFocusUpdatedAt = 0;
  private readonly projectileSpectacleFocus = new THREE.Vector3();
  private hasProjectileSpectacleFocus = false;
  private disposed = false;
  private frozenForCapture = false;
  private renderStatsFrame = 0;
  private lastRenderStats: DowntownMayhemRenderStats = {
    frame: 0,
    levelName: "",
    rendererPreference: "auto",
    rendererBackend: "webgl2",
    bodyCount: 0,
    drawCalls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    geometries: 0,
    textures: 0,
    programs: 0,
    visibleMeshes: 0,
    visibleMaterials: 0
  };

  constructor(settings: GameSettings, rendererBundle: DowntownMayhemRendererBundle) {
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

    this.scene.background = new THREE.Color(0x080b10);
    this.scene.fog = new THREE.Fog(0x080b10, 28, 78);
    this.timer.connect(document);

    this.rng = new SeededRandom(this.runSeed);
    this.cameraRig = new CameraRig(this.renderer);
    this.physics = new PhysicsWorld(this.scene);
    this.destruction = new DestructionSystem(this.physics, this.materials, this.rng);
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

    this.configureLights();
    this.applySettings();
    this.buildArena();
    this.loadLevel();
    this.audio.preload();
    this.resize();
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
    if (window.__DOWNTOWN_MAYHEM_DEBUG__?.getRenderStats().frame === this.lastRenderStats.frame) {
      delete window.__DOWNTOWN_MAYHEM_DEBUG__;
    }
    this.input.dispose();
    this.scorePopups.dispose();
    this.particles.dispose();
    this.projectiles.clearActive();
    this.physics.clearDynamic();
    this.physics.clearStatics();
    this.clearLevelDecorations();
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
    const delta = Math.min(frameDelta, 0.05);
    perfMonitor.beginFrame(frameDelta * 1000, this.physics.getDynamicBodyCount());
    try {
      this.updateFps(frameDelta);
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
        this.physics.advanceTrafficRoutes(delta);
        perfMonitor.addTiming("physics.traffic", startedAt);
      }
      if (this.runState.phase !== "aim") {
        startedAt = perfMonitor.timeStart();
        this.physics.step(delta * timeScale);
        perfMonitor.addTiming("physics.step", startedAt);
        startedAt = perfMonitor.timeStart();
        this.projectiles.update(delta * timeScale);
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
      this.destruction.processQueuedFractures(FRACTURE_PROCESS_MAX_PER_FRAME, FRACTURE_PROCESS_TIME_BUDGET_MS);

      startedAt = perfMonitor.timeStart();
      this.particles.update(delta * visualScale);
      perfMonitor.addTiming("vfx.update", startedAt);
      this.cameraRig.update(delta * visualScale);
      this.updateAimMarker();
      this.scorePopups.update(delta * visualScale, this.cameraRig.camera);
      startedAt = perfMonitor.timeStart();
      this.ui.update({
        projectileId: this.selectedProjectile,
        projectile: PROJECTILES[this.selectedProjectile],
        shotAvailable: this.runState.shotAvailable,
        canFinishRun: this.runState.phase === "spectacle" && !this.runState.score,
        bodyCount: this.physics.getDynamicBodyCount(),
        levelName: this.currentLevel().name,
        levelDescription: this.currentLevel().description,
        objective: this.currentLevel().objective,
        chaosBrief: this.currentLevel().chaosBrief,
        mission: this.currentLevel().mission,
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
      perfMonitor.addTiming("game.ui", startedAt);
      startedAt = perfMonitor.timeStart();
      this.renderer.render(this.scene, this.cameraRig.camera);
      perfMonitor.addTiming("renderer.render", startedAt);
    } finally {
      perfMonitor.endFrame();
    }
  }

  private captureRenderStats(): DowntownMayhemRenderStats {
    const visibleMaterials = new Set<THREE.Material>();
    let visibleMeshes = 0;
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
      bodyCount: this.physics.getDynamicBodyCount(),
      drawCalls: rendererDrawCalls(this.renderer),
      triangles: this.renderer.info.render.triangles,
      lines: this.renderer.info.render.lines,
      points: this.renderer.info.render.points,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: rendererProgramCount(this.renderer),
      visibleMeshes,
      visibleMaterials: visibleMaterials.size
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
    const ambient = new THREE.AmbientLight(0xb6c6d5, 0.52);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xf7fbff, 3.4);
    key.position.set(7, 11, 6);
    key.castShadow = false;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.camera.left = -22;
    key.shadow.camera.right = 22;
    key.shadow.camera.top = 22;
    key.shadow.camera.bottom = -22;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0x6aa7ff, 1.05);
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
    this.projectiles.clearActive();
    this.destruction.clearQueuedFractures();
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
    setOptionalShadowMapFlag(this.renderer, "needsUpdate", true);
    this.status = `${level.name}: ${level.objective}`;
    this.cannon.aimAtWorldPoint(this.aimPoint, PROJECTILES[this.selectedProjectile].speed * this.powerScale);
  }

  private aim(pointer: THREE.Vector2): void {
    if (this.ui.isGameplayBlocked()) {
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
    this.aimSurfaceTargets.length = 0;
    for (const object of this.physics.getDynamicObjects()) {
      if (object.category === "projectile" || object.isDebris || object.zoneId === "surface" || !object.mesh.visible) {
        continue;
      }
      this.aimSurfaceTargets.push(object.mesh);
    }
    for (const mesh of this.physics.staticMeshes) {
      if (mesh.visible) {
        this.aimSurfaceTargets.push(mesh);
      }
    }
    if (this.aimSurfaceTargets.length === 0) {
      return false;
    }

    this.aimSurfaceHits.length = 0;
    this.aimRaycaster.intersectObjects(this.aimSurfaceTargets, false, this.aimSurfaceHits);
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

  private fire(): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    if (!this.runState.shotAvailable || this.runState.phase !== "aim") {
      return;
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
  }

  private detectImpact(active: ActiveProjectile): { point: THREE.Vector3; object: PhysicsObject | null } | null {
    const current = vectorFromRapier(active.object.body.translation());
    const previous = active.previousPosition.clone();

    if (
      current.y < 0.18 ||
      current.x < IMPACT_BOUNDS.minX ||
      current.x > IMPACT_BOUNDS.maxX ||
      current.z < IMPACT_BOUNDS.minZ ||
      current.z > IMPACT_BOUNDS.maxZ
    ) {
      active.previousPosition.copy(current);
      return { point: current, object: null };
    }

    let best: { point: THREE.Vector3; object: PhysicsObject; distance: number } | null = null;
    for (const object of this.physics.getSegmentCandidates(previous, current, active.radius + 0.28)) {
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
        hitMaterialId: object.materialId,
        role: "secondary"
      });
      this.particles.spark(origin, profile.color, profile.projectileId === "ignite" ? 2.1 : 1.7);
      if (secondary.dustColors.length > 0) {
        this.particles.cityDebrisSpray(origin, secondary.dustColors, 0.42 + secondary.fracturedBodies * 0.08);
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
      this.physics.drainCollisionEvents();
      this.physics.drainSurfaceCollisionEvents();
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
    const collisions = this.physics.drainCollisionEvents(CHAIN_COLLISION_DRAIN_MAX_PER_FRAME);
    perfMonitor.addCount("collision.chainDrained", collisions.length);
    for (const collision of collisions) {
      if (impactsThisFrame >= CHAIN_IMPACT_MAX_PER_FRAME) {
        break;
      }
      if (!collision.started) {
        continue;
      }
      if (activeProjectile) {
        const projectileTarget = projectileCollisionTarget(activeProjectile, collision);
        if (projectileTarget) {
          const current = vectorFromRapier(activeProjectile.object.body.translation());
          const previous = activeProjectile.previousPosition.clone();
          const candidate = projectileImpactCandidate(activeProjectile, projectileTarget, previous, current);
          this.handleImpact(candidate?.point ?? closestPointOnObject(projectileTarget, current), activeProjectile, projectileTarget);
          return events;
        }
      }
      const pair = chainCollisionPair(collision.first, collision.second);
      if (!pair) {
        continue;
      }
      const { source, target } = pair;
      if (!this.physics.getObject(source.id) || !this.physics.getObject(target.id)) {
        continue;
      }
      const impactProfile = chainImpactProfile(source);
      const sourcePosition = vectorFromRapier(source.body.translation());
      const targetPosition = vectorFromRapier(target.body.translation());
      const relativeVelocity = impactVelocityAtTarget(source, target, sourcePosition, targetPosition);
      const relativeSpeedSq = velocityLengthSq(relativeVelocity);
      const minSpeed = impactProfile?.minSpeed ?? CHAIN_DEBRIS_MIN_SPEED;
      if (relativeSpeedSq < minSpeed * minSpeed) {
        continue;
      }
      const towardTarget = targetPosition.clone().sub(sourcePosition);
      if (
        impactProfile?.ignoreApproach !== true &&
        towardTarget.lengthSq() > 0.0001 &&
        relativeVelocity.x * towardTarget.x + relativeVelocity.y * towardTarget.y + relativeVelocity.z * towardTarget.z <= 0
      ) {
        continue;
      }

      const pairKey = `${source.id}:${target.id}`;
      if ((this.chainImpactCooldowns.get(pairKey) ?? 0) > now) {
        continue;
      }
      this.chainImpactCooldowns.set(pairKey, now + CHAIN_IMPACT_COOLDOWN_MS);

      const origin = sourcePosition.clone().lerp(targetPosition, 0.5);
      const relativeSpeed = adjustedChainImpactSpeed(Math.sqrt(relativeSpeedSq), impactProfile);
      const result = this.destruction.impact(source, target, origin, relativeSpeed);
      const damaged = result.affectedObjects[0];
      if (!damaged?.fractured) {
        continue;
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
      this.particles.spark(origin, 0xffd25c, Math.min(1.4, 0.55 + relativeSpeed * 0.045));
      if (result.dustColors.length > 0) {
        this.particles.cityDebrisSpray(origin, result.dustColors, 0.35 + result.fracturedBodies * 0.04);
      }
      impactsThisFrame += 1;
    }
    events.push(...this.processPersistentCrushImpacts(now));
    events.push(...this.processSurfaceImpacts(now));
    return events;
  }

  private processPersistentCrushImpacts(now: number): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    let impactsThisFrame = 0;
    for (const sourceSnapshot of this.physics.getDynamicObjects()) {
      const source = this.physics.getObject(sourceSnapshot.id);
      if (!source) {
        continue;
      }
      const impactProfile = chainImpactProfile(source);
      if (!impactProfile?.persistentCrush || source.bodyType !== "dynamic") {
        continue;
      }
      const sourcePosition = vectorFromRapier(source.body.translation());
      for (const targetSnapshot of this.physics.getBlastCandidates(sourcePosition, impactProfile.reach)) {
        if (impactsThisFrame >= CRANE_CRUSH_MAX_PER_FRAME) {
          return events;
        }
        const liveSource = this.physics.getObject(source.id);
        const target = this.physics.getObject(targetSnapshot.id);
        if (!liveSource || !target) {
          break;
        }
        if (target.id === source.id || !isChainTarget(target) || target.label.includes("Central construction crane")) {
          continue;
        }
        const liveSourcePosition = vectorFromRapier(liveSource.body.translation());
        const targetPosition = vectorFromRapier(target.body.translation());
        if (!isWithinCraneCrushEnvelope(liveSource, target, liveSourcePosition, targetPosition)) {
          continue;
        }
        const pairKey = `${liveSource.id}:${target.id}`;
        if ((this.chainImpactCooldowns.get(pairKey) ?? 0) > now) {
          continue;
        }
        const relativeVelocity = impactVelocityAtTarget(liveSource, target, liveSourcePosition, targetPosition);
        const relativeSpeed = adjustedChainImpactSpeed(Math.sqrt(velocityLengthSq(relativeVelocity)), impactProfile);
        this.chainImpactCooldowns.set(pairKey, now + CHAIN_IMPACT_COOLDOWN_MS);

        const origin = liveSourcePosition.clone().lerp(targetPosition, 0.5);
        const result = this.destruction.impact(liveSource, target, origin, relativeSpeed);
        const damaged = result.affectedObjects[0];
        if (!damaged?.fractured) {
          continue;
        }

        this.audio.playChainImpact({
          point: origin,
          result,
          relativeSpeed,
          materialId: damaged.materialId
        });
        events.push(...this.applyExplosionResult(result));
        const points = Math.max(80, Math.round(damaged.weightedDamage * 1.1 + relativeSpeed * 11));
        events.push(...this.scoreTracker.addChainReaction(points, damaged.position, chainImpactLabel(damaged)));
        this.particles.spark(origin, 0xffd25c, Math.min(1.6, 0.75 + relativeSpeed * 0.04));
        if (result.dustColors.length > 0) {
          this.particles.cityDebrisSpray(origin, result.dustColors, 0.42 + result.fracturedBodies * 0.045);
        }
        impactsThisFrame += 1;
      }
    }
    return events;
  }

  private processSurfaceImpacts(now: number): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    const processedObjectIds = new Set<number>();
    let surfaceCollisionsChecked = 0;
    let impactsThisFrame = 0;
    const surfaceImpacts = this.physics.drainSurfaceCollisionEvents(SURFACE_COLLISION_MAX_PER_FRAME);
    perfMonitor.addCount("collision.surfaceDrained", surfaceImpacts.length);
    for (const surfaceImpact of surfaceImpacts) {
      if (surfaceCollisionsChecked >= SURFACE_COLLISION_MAX_PER_FRAME || impactsThisFrame >= SURFACE_IMPACT_MAX_PER_FRAME) {
        break;
      }
      surfaceCollisionsChecked += 1;
      if (!surfaceImpact.started || !isGroundSurface(surfaceImpact.surfaceLabel)) {
        continue;
      }
      const object = this.physics.getObject(surfaceImpact.object.id);
      if (!object || processedObjectIds.has(object.id)) {
        continue;
      }
      processedObjectIds.add(object.id);
      if (!object.destructible || !object.canFracture || object.bodyType !== "dynamic" || object.category === "projectile") {
        continue;
      }
      if ((this.surfaceImpactCooldowns.get(object.id) ?? 0) > now) {
        continue;
      }

      const downwardSpeed = Math.max(0, -surfaceImpact.impactVelocity.y);
      const impactSpeed = downwardSpeed + horizontalSpeed(surfaceImpact.impactVelocity) * 0.22;
      if (!canGroundImpactBreak(object, impactSpeed)) {
        continue;
      }

      this.surfaceImpactCooldowns.set(object.id, now + 520);
      const objectPosition = vectorFromRapier(object.body.translation());
      const origin = objectPosition.clone();
      origin.y -= object.dimensions.y * 0.5;
      const result = this.destruction.groundImpact(object, origin, impactSpeed);
      const damaged = result.affectedObjects[0];
      if (!damaged?.fractured) {
        continue;
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
      if (result.dustColors.length > 0) {
        this.particles.cityDebrisSpray(origin, result.dustColors, 0.22 + result.fracturedBodies * 0.045);
      }
      impactsThisFrame += 1;
    }
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
    for (let i = 0; i < 14; i += 1) {
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
        hitMaterialId: "foam",
        impactDirection: forward,
        role: "secondary"
      });
      if (cluster.dustColors.length > 0) {
        this.particles.cityDebrisSpray(clusterOrigin, cluster.dustColors, 0.24 + cluster.fracturedBodies * 0.035);
      }
      events.push(...this.applyExplosionResult(cluster, 1, 0));
    }
    return events;
  }

  private reset(): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    this.loadLevel();
    this.ui.showPlayScreen();
  }

  private nextLevel(): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    const unlockedCount = Math.max(1, Math.min(TEST_CHAMBERS.length, this.arcadeProgress.highestUnlockedLevel + 1));
    this.levelIndex = (this.levelIndex + 1) % unlockedCount;
    this.loadLevel();
  }

  private selectLevel(index: number): boolean {
    if (!Number.isFinite(index)) {
      return false;
    }
    const levelIndex = THREE.MathUtils.clamp(Math.trunc(index), 0, TEST_CHAMBERS.length - 1);
    if (levelIndex > this.arcadeProgress.highestUnlockedLevel) {
      return false;
    }
    this.levelIndex = levelIndex;
    this.loadLevel();
    return true;
  }

  private clearDebris(): void {
    if (this.ui.isGameplayBlocked()) {
      return;
    }
    this.physics.clearDebris();
    this.audio.playUiTick();
    this.status = "Loose debris cleared. The trial state is unchanged.";
  }

  private selectProjectile(id: ProjectileId): void {
    if (this.ui.isGameplayBlocked()) {
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

async function boot(): Promise<void> {
  await RAPIER.init();
  const settings = loadGameSettings();
  const rendererBundle = await createDowntownMayhemRenderer(settings);
  activeGame?.dispose();
  const game = new Game(settings, rendererBundle);
  activeGame = game;
  window.__DOWNTOWN_MAYHEM_DEBUG__ = {
    getRenderStats: () => game.getRenderStats(),
    getPerfReport: () => perfMonitor.report(),
    setPerfEnabled: (enabled) => perfMonitor.setEnabled(enabled),
    clearPerfReport: () => perfMonitor.clear(),
    freezeForCapture: () => game.freezeForCapture(),
    resume: () => game.resume()
  };
  game.start();
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      activeGame?.dispose();
      activeGame = null;
      delete window.__DOWNTOWN_MAYHEM_DEBUG__;
    });
  }
}

function vectorFromRapier(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
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

interface ChainImpactProfile {
  minSpeed: number;
  speedScale: number;
  persistentCrush: boolean;
  reach: number;
  ignoreApproach: boolean;
}

function chainImpactProfile(source: PhysicsObject): ChainImpactProfile | null {
  if (source.label === "Central construction crane boom assembly") {
    return {
      minSpeed: 0.55,
      speedScale: 4.6,
      persistentCrush: true,
      reach: 17.5,
      ignoreApproach: true
    };
  }
  if (source.label === "Central construction crane mast assembly") {
    return {
      minSpeed: 0.5,
      speedScale: 3.4,
      persistentCrush: true,
      reach: 7.5,
      ignoreApproach: true
    };
  }
  if (source.label === "Central construction crane heavy payload") {
    return {
      minSpeed: 0.45,
      speedScale: 3.8,
      persistentCrush: true,
      reach: 3.8,
      ignoreApproach: true
    };
  }
  return null;
}

function adjustedChainImpactSpeed(rawSpeed: number, profile: ChainImpactProfile | null): number {
  if (!profile) {
    return rawSpeed;
  }
  return Math.max(profile.minSpeed * 6.5, rawSpeed * profile.speedScale);
}

function impactVelocityAtTarget(
  source: PhysicsObject,
  target: PhysicsObject,
  sourcePosition: THREE.Vector3,
  targetPosition: THREE.Vector3
): { x: number; y: number; z: number } {
  const sourceVelocity = source.body.linvel();
  const targetVelocity = target.body.linvel();
  const lever = targetPosition.clone().sub(sourcePosition);
  const maxLever = Math.max(
    0.35,
    source.radius * 2.2,
    Math.max(source.dimensions.x, source.dimensions.y, source.dimensions.z) * 0.85
  );
  if (lever.lengthSq() > maxLever * maxLever) {
    lever.setLength(maxLever);
  }
  const angularVelocity = source.body.angvel();
  const tangentialVelocity = new THREE.Vector3(
    angularVelocity.y * lever.z - angularVelocity.z * lever.y,
    angularVelocity.z * lever.x - angularVelocity.x * lever.z,
    angularVelocity.x * lever.y - angularVelocity.y * lever.x
  );
  return {
    x: sourceVelocity.x + tangentialVelocity.x - targetVelocity.x,
    y: sourceVelocity.y + tangentialVelocity.y - targetVelocity.y,
    z: sourceVelocity.z + tangentialVelocity.z - targetVelocity.z
  };
}

function isWithinCraneCrushEnvelope(
  source: PhysicsObject,
  target: PhysicsObject,
  sourcePosition: THREE.Vector3,
  targetPosition: THREE.Vector3
): boolean {
  if (source.label === "Central construction crane heavy payload") {
    const reach = Math.max(2.35, target.radius + source.radius * 0.65);
    return targetPosition.distanceToSquared(sourcePosition) <= reach * reach;
  }

  const rotation = source.body.rotation();
  const inverseRotation = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).invert();
  const localTarget = targetPosition.clone().sub(sourcePosition).applyQuaternion(inverseRotation);
  const targetPadX = Math.max(0.75, target.dimensions.x * 0.55);
  const targetPadY = Math.max(0.85, target.dimensions.y * 0.58);
  const targetPadZ = Math.max(0.72, target.dimensions.z * 0.58);

  if (source.label === "Central construction crane boom assembly") {
    return (
      localTarget.x >= -4.45 - targetPadX &&
      localTarget.x <= 13.4 + targetPadX &&
      Math.abs(localTarget.y) <= 1.15 + targetPadY &&
      Math.abs(localTarget.z) <= 0.85 + targetPadZ
    );
  }

  if (source.label !== "Central construction crane mast assembly") {
    return false;
  }

  return (
    Math.abs(localTarget.x) <= 0.72 + targetPadX &&
    localTarget.y >= -source.dimensions.y * 0.5 - targetPadY &&
    localTarget.y <= source.dimensions.y * 0.5 + targetPadY &&
    Math.abs(localTarget.z) <= 0.72 + targetPadZ
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

function horizontalSpeed(velocity: THREE.Vector3): number {
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
  return `${settings.graphicsQuality}, ${settings.rendererBackend} renderer, ${Math.round(settings.masterVolume * 100)}% volume, ${Math.round(settings.cameraShake * 100)}% shake`;
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
