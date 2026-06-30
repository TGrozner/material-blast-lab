import * as THREE from "three";
import { withSuppressedConsoleWarning } from "./consoleWarnings";
import { effectiveGraphicsPixelRatio, graphicsPixelRatioCap, type GameSettings } from "./settings";

export type ActualRendererBackend = "webgl2" | "webgl";

export interface DowntownMayhemRendererBundle {
  renderer: THREE.WebGLRenderer;
  backend: ActualRendererBackend;
}

const PARALLEL_SHADER_COMPILE_WARNING = "THREE.WebGLRenderer: KHR_parallel_shader_compile extension not supported.";

export function createDowntownMayhemRenderer(settings: GameSettings): DowntownMayhemRendererBundle {
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

export function configureDowntownMayhemRenderer(renderer: THREE.WebGLRenderer, settings: GameSettings): void {
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  setOptionalShadowMapFlag(renderer, "autoUpdate", false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setPixelRatio(effectiveGraphicsPixelRatio(graphicsPixelRatioCap(settings.graphicsQuality)));
}

export function activeWebGlRendererBackend(renderer: THREE.WebGLRenderer): ActualRendererBackend {
  return renderer.capabilities.isWebGL2 ? "webgl2" : "webgl";
}

export function rendererDrawCalls(renderer: THREE.WebGLRenderer): number {
  const renderInfo = renderer.info.render as typeof renderer.info.render & { calls?: number; drawCalls?: number };
  return renderInfo.drawCalls ?? renderInfo.calls ?? 0;
}

export function rendererProgramCount(renderer: THREE.WebGLRenderer): number {
  const memoryInfo = renderer.info.memory as typeof renderer.info.memory & { programs?: number };
  const rendererInfo = renderer.info as typeof renderer.info & { programs?: unknown[] };
  return memoryInfo.programs ?? rendererInfo.programs?.length ?? 0;
}

export function setOptionalShadowMapFlag(
  renderer: THREE.WebGLRenderer,
  key: "autoUpdate" | "needsUpdate",
  value: boolean
): void {
  (renderer.shadowMap as typeof renderer.shadowMap & Partial<Record<typeof key, boolean>>)[key] = value;
}

export function compileRendererPipelines(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): Promise<unknown> {
  return withSuppressedConsoleWarning(PARALLEL_SHADER_COMPILE_WARNING, () => renderer.compileAsync(scene, camera));
}
