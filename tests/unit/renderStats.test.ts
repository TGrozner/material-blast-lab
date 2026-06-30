import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { formatCompactScore } from "../../src/numberFormat";
import {
  captureFullRenderStats,
  captureFastRenderStats,
  createInitialRenderStats,
  levelCompositionLine,
  type FullRenderStatsInput,
  type RenderStatsInput
} from "../../src/renderStats";
import { rendererDrawCalls, rendererProgramCount } from "../../src/renderer";

describe("renderer stats helpers", () => {
  test("reads current and legacy Three.js draw-call counters", () => {
    expect(rendererDrawCalls(rendererWithInfo({ drawCalls: 14, calls: 9 }, {}))).toBe(14);
    expect(rendererDrawCalls(rendererWithInfo({ calls: 9 }, {}))).toBe(9);
    expect(rendererDrawCalls(rendererWithInfo({}, {}))).toBe(0);
  });

  test("reads renderer program counts from memory or program arrays", () => {
    expect(rendererProgramCount(rendererWithInfo({}, { programs: 5 }))).toBe(5);
    expect(
      rendererProgramCount({
        info: {
          render: {},
          memory: {},
          programs: [{}, {}, {}]
        }
      } as unknown as THREE.WebGLRenderer)
    ).toBe(3);
    expect(rendererProgramCount(rendererWithInfo({}, {}))).toBe(0);
  });

  test("formats compact score values consistently", () => {
    expect(formatCompactScore(1234)).toBe("1,234");
    expect(formatCompactScore(10_400)).toBe("10K");
    expect(formatCompactScore(1_250_000)).toBe("1.3M");
  });

  test("summarizes level composition from physics runtime stats", () => {
    expect(
      levelCompositionLine({
        fixedStructureCount: 2450,
        debrisBodyCount: 0,
        activeDebrisCount: 0,
        pendingSupportReleaseCount: 0
      })
    ).toBe("2,450 structures / low loose debris / supports stable");

    expect(
      levelCompositionLine({
        fixedStructureCount: 12_400,
        debrisBodyCount: 970,
        activeDebrisCount: 11,
        pendingSupportReleaseCount: 41
      })
    ).toBe("12K structures / 970 debris-ready / 41 staged supports");
  });

  test("preserves expensive visibility counts during fast captures", () => {
    const previous = {
      ...createInitialRenderStats(),
      visibleMeshes: 2612,
      visibleMaterials: 278
    };
    const next = captureFastRenderStats(previous, renderStatsInput());

    expect(next.frame).toBe(12);
    expect(next.drawCalls).toBe(88);
    expect(next.bodyCount).toBe(16);
    expect(next.visibleMeshes).toBe(2612);
    expect(next.visibleMaterials).toBe(278);
  });

  test("counts visible meshes and unique visible materials during full captures", () => {
    const scene = new THREE.Scene();
    const visibleMaterial = new THREE.MeshBasicMaterial();
    const secondVisibleMaterial = new THREE.MeshBasicMaterial();
    const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
    const hiddenMeshMaterial = new THREE.MeshBasicMaterial();
    const visibleMesh = new THREE.Mesh(new THREE.BoxGeometry(), visibleMaterial);
    const multiMaterialMesh = new THREE.Mesh(new THREE.BoxGeometry(), [hiddenMaterial, secondVisibleMaterial]);
    const hiddenMesh = new THREE.Mesh(new THREE.BoxGeometry(), hiddenMeshMaterial);
    hiddenMesh.visible = false;
    scene.add(visibleMesh, multiMaterialMesh, hiddenMesh);

    const stats = captureFullRenderStats({
      ...renderStatsInput(),
      scene,
      visibleMaterialsScratch: new Set()
    } satisfies FullRenderStatsInput);

    expect(stats.visibleMeshes).toBe(2);
    expect(stats.visibleMaterials).toBe(2);
  });
});

function rendererWithInfo(
  render: Record<string, number>,
  memory: Record<string, number>
): THREE.WebGLRenderer {
  return {
    info: {
      render,
      memory
    }
  } as unknown as THREE.WebGLRenderer;
}

function renderStatsInput(): RenderStatsInput {
  return {
    frame: 12,
    levelName: "Hazard Junction",
    rendererBackend: "webgl2",
    renderer: rendererWithInfo(
      {
        drawCalls: 88,
        triangles: 1200,
        lines: 2,
        points: 3
      },
      {
        geometries: 24,
        textures: 11,
        programs: 7
      }
    ),
    physicsStats: {
      bodyCount: 16,
      dynamicBodyCount: 7,
      awakeBodyCount: 4,
      debrisBodyCount: 2,
      awakeDebrisBodyCount: 1,
      fixedStructureCount: 9,
      activeDebrisCount: 2,
      frozenDebrisCount: 5,
      pendingSupportReleaseCount: 1
    },
    staticDetailStats: {
      batches: 3,
      dynamicBatches: 1,
      instances: 21,
      buckets: 4
    },
    fragmentStats: {
      buckets: 8,
      visibleBuckets: 2,
      warmupBuckets: 5,
      overflowBuckets: 0
    },
    visiblePooledVfxObjects: 6
  };
}
