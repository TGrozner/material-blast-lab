import * as THREE from "three";
import type { MaterialId } from "./materialCatalog";

export const RENDER_WARMUP_FRAGMENT_MATERIALS: readonly MaterialId[] = ["glass", "concrete", "metal", "rubber", "foam", "wood"];
export const RENDER_WARMUP_RUNTIME_FRAGMENT_BATCHES = 8;
export const RENDER_WARMUP_FRAMES_PER_BRUTAL_PASS = 10;
export const RENDER_WARMUP_DELTA_SECONDS = 1 / 30;
export const RENDER_WARMUP_SYNTHETIC_DESTRUCTION_PASSES = 3;
export const RENDER_WARMUP_SYNTHETIC_OBJECTS_PER_MATERIAL = 8;
export const RENDER_WARMUP_SYNTHETIC_ORIGIN = new THREE.Vector3(72, 1.2, 72);
export const RENDER_WARMUP_SYNTHETIC_DESTRUCTION_ZONE = "render-warmup-destruction";

const RENDER_WARMUP_BRUTAL_PASSES = 4;
const RENDER_WARMUP_MIN_FRAMES = 64;
const RENDER_WARMUP_STABLE_FRAMES = 24;
const RENDER_WARMUP_MAX_FRAMES = 180;
const RENDER_WARMUP_POST_CLEANUP_EFFECT_PASSES = 2;
const RENDER_WARMUP_POST_CLEANUP_EFFECT_FRAMES = 8;
const RENDER_WARMUP_POST_CLEANUP_STABLE_FRAMES = 72;
const RENDER_WARMUP_POST_CLEANUP_MAX_FRAMES = 260;
const RENDER_WARMUP_MAX_DURATION_MS = 6_000;
const RENDER_WARMUP_POST_CLEANUP_MAX_DURATION_MS = 3_000;

export interface RenderWarmupState {
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

export interface RenderWarmupProfile {
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

export type RenderWarmupMode = "none" | "smoke" | "full";

export const FULL_RENDER_WARMUP_PROFILE: RenderWarmupProfile = {
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

export function createInitialRenderWarmupState(): RenderWarmupState {
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

export function currentRenderWarmupMode(): RenderWarmupMode {
  try {
    return renderWarmupModeFromSearch(globalThis.location?.search ?? "");
  } catch {
    return "none";
  }
}

export function renderWarmupModeFromSearch(search: string): RenderWarmupMode {
  const params = new URLSearchParams(search);
  if (params.has("smoke")) {
    return "smoke";
  }
  if (params.has("fullWarmup")) {
    return "full";
  }
  return "none";
}
