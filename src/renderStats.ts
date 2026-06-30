import * as THREE from "three";
import type { FragmentInstanceStats } from "./destruction";
import { formatCompactScore } from "./numberFormat";
import type { PhysicsRuntimeStats, StaticDetailStats } from "./physics";
import { rendererDrawCalls, rendererProgramCount, type ActualRendererBackend } from "./renderer";

export interface DowntownMayhemRenderStats {
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
  staticDetailBatches: number;
  staticDetailDynamicBatches: number;
  staticDetailInstances: number;
  staticDetailBuckets: number;
  fragmentInstanceBuckets: number;
  fragmentInstanceVisibleBuckets: number;
  fragmentInstanceWarmupBuckets: number;
  fragmentInstanceOverflowBuckets: number;
  levelComposition: string;
}

export interface RenderStatsInput {
  frame: number;
  levelName: string;
  rendererBackend: ActualRendererBackend;
  renderer: THREE.WebGLRenderer;
  physicsStats: PhysicsRuntimeStats;
  staticDetailStats: StaticDetailStats;
  fragmentStats: FragmentInstanceStats;
  visiblePooledVfxObjects: number;
}

export interface FullRenderStatsInput extends RenderStatsInput {
  scene: THREE.Scene;
  visibleMaterialsScratch: Set<THREE.Material>;
}

export function createInitialRenderStats(rendererBackend: ActualRendererBackend = "webgl2"): DowntownMayhemRenderStats {
  return {
    frame: 0,
    levelName: "",
    rendererBackend,
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
    staticDetailBatches: 0,
    staticDetailDynamicBatches: 0,
    staticDetailInstances: 0,
    staticDetailBuckets: 0,
    fragmentInstanceBuckets: 0,
    fragmentInstanceVisibleBuckets: 0,
    fragmentInstanceWarmupBuckets: 0,
    fragmentInstanceOverflowBuckets: 0,
    levelComposition: "structure/debris mix"
  };
}

export function captureFullRenderStats(input: FullRenderStatsInput): DowntownMayhemRenderStats {
  const visibility = countVisibleSceneMeshes(input.scene, input.visibleMaterialsScratch);
  return {
    ...commonRenderStats(input),
    visibleMeshes: visibility.meshes,
    visibleMaterials: visibility.materials
  };
}

export function captureFastRenderStats(
  previous: DowntownMayhemRenderStats,
  input: RenderStatsInput
): DowntownMayhemRenderStats {
  return {
    ...previous,
    ...commonRenderStats(input),
    visibleMeshes: previous.visibleMeshes,
    visibleMaterials: previous.visibleMaterials
  };
}

export function levelCompositionLine(stats: {
  fixedStructureCount: number;
  debrisBodyCount: number;
  activeDebrisCount: number;
  pendingSupportReleaseCount: number;
}): string {
  const debris = stats.debrisBodyCount > 0 ? `${formatCompactScore(stats.debrisBodyCount)} debris-ready` : "low loose debris";
  const support =
    stats.pendingSupportReleaseCount > 0
      ? `${formatCompactScore(stats.pendingSupportReleaseCount)} staged supports`
      : "supports stable";
  return `${formatCompactScore(stats.fixedStructureCount)} structures / ${debris} / ${support}`;
}

function commonRenderStats(input: RenderStatsInput): DowntownMayhemRenderStats {
  const { renderer, physicsStats, staticDetailStats, fragmentStats } = input;
  return {
    frame: input.frame,
    levelName: input.levelName,
    rendererBackend: input.rendererBackend,
    bodyCount: physicsStats.bodyCount,
    dynamicBodyCount: physicsStats.dynamicBodyCount,
    awakeBodyCount: physicsStats.awakeBodyCount,
    debrisBodyCount: physicsStats.debrisBodyCount,
    awakeDebrisBodyCount: physicsStats.awakeDebrisBodyCount,
    fixedStructureCount: physicsStats.fixedStructureCount,
    activeDebrisCount: physicsStats.activeDebrisCount,
    frozenDebrisCount: physicsStats.frozenDebrisCount,
    pendingSupportReleaseCount: physicsStats.pendingSupportReleaseCount,
    drawCalls: rendererDrawCalls(renderer),
    triangles: renderer.info.render.triangles,
    lines: renderer.info.render.lines,
    points: renderer.info.render.points,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    programs: rendererProgramCount(renderer),
    visibleMeshes: 0,
    visibleMaterials: 0,
    visiblePooledVfxObjects: input.visiblePooledVfxObjects,
    staticDetailBatches: staticDetailStats.batches,
    staticDetailDynamicBatches: staticDetailStats.dynamicBatches,
    staticDetailInstances: staticDetailStats.instances,
    staticDetailBuckets: staticDetailStats.buckets,
    fragmentInstanceBuckets: fragmentStats.buckets,
    fragmentInstanceVisibleBuckets: fragmentStats.visibleBuckets,
    fragmentInstanceWarmupBuckets: fragmentStats.warmupBuckets,
    fragmentInstanceOverflowBuckets: fragmentStats.overflowBuckets,
    levelComposition: levelCompositionLine(physicsStats)
  };
}

function countVisibleSceneMeshes(
  scene: THREE.Scene,
  visibleMaterialsScratch: Set<THREE.Material>
): { meshes: number; materials: number } {
  visibleMaterialsScratch.clear();
  let visibleMeshes = 0;
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) {
      return;
    }
    const material = object.material;
    if (Array.isArray(material)) {
      let hasRenderableMaterial = false;
      for (const entry of material) {
        if (!entry.visible) {
          continue;
        }
        hasRenderableMaterial = true;
        visibleMaterialsScratch.add(entry);
      }
      if (hasRenderableMaterial) {
        visibleMeshes += 1;
      }
      return;
    }
    if (material.visible) {
      visibleMeshes += 1;
      visibleMaterialsScratch.add(material);
    }
  });
  return { meshes: visibleMeshes, materials: visibleMaterialsScratch.size };
}
