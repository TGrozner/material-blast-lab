import { describe, expect, test } from "vitest";
import { shouldEnablePerfFromSearch, type PerfFrameSnapshot, type PerfReport } from "../../src/perf";
import { summarizePerfReport } from "../../src/perfSummary";

describe("perf monitor query flags", () => {
  test("enables perf monitoring for full reports even without the short perf flag", () => {
    expect(shouldEnablePerfFromSearch("?perfFull")).toBe(true);
    expect(shouldEnablePerfFromSearch("?smoke=1&perfFull=1")).toBe(true);
    expect(shouldEnablePerfFromSearch("?perf=1")).toBe(true);
    expect(shouldEnablePerfFromSearch("?smoke=1")).toBe(false);
  });

  test("summarizes shot slow frames in one ordered report", () => {
    const idle = perfFrame(1, 41, {
      timings: { "renderer.render": 9 },
      counters: {}
    });
    const shot = perfFrame(2, 35, {
      timings: { "physics.step": 6, "renderer.render": 12, "physics.rapierStep": 3 },
      counters: {
        "destruction.fragmentsCreated": 4,
        "physics.dynamicBoxesAdded": 5,
        "vfx.particlesSpawned": 22
      }
    });
    const slowerShot = perfFrame(3, 52, {
      timings: { "game.projectiles": 2, "renderer.render": 18, "destruction.fracture": 7 },
      counters: {
        "destruction.visualOnlyFragmentsCreated": 3,
        "destruction.physicalFragmentsCreated": 2,
        "render.boxGeometryCacheMiss": 1,
        "physics.substepsDropped": 1
      }
    });
    const report: PerfReport = {
      enabled: true,
      frameCount: 20,
      slowFrameCount: 3,
      maxFrameMs: slowerShot.totalMs,
      maxFrame: slowerShot,
      recentSlowFrames: [idle, shot, slowerShot],
      counterTotals: {},
      counterMax: {}
    };

    const summary = summarizePerfReport(report);

    expect(summary.slowRatioPercent).toBe(15);
    expect(summary.shotFrameCount).toBe(2);
    expect(summary.shotMax).toMatchObject({
      totalMs: 52,
      renderMs: 18,
      physicsStepMs: 6,
      fractureMs: 7,
      fragmentsInFrame: 4,
      particlesInFrame: 22,
      droppedSubstepsInFrame: 1
    });
    expect(summary.shotTotals).toMatchObject({
      fragments: 4,
      dynamicBoxes: 5,
      particles: 22,
      visualOnlyFragments: 3,
      physicalFragments: 2,
      droppedSubsteps: 1
    });
    expect(summary.topAllSlowFrames.map((frame) => frame.frame)).toEqual([3, 1, 2]);
    expect(summary.topShotSlowFrames.map((frame) => frame.frame)).toEqual([3, 2]);
  });
});

function perfFrame(
  frame: number,
  totalMs: number,
  values: {
    timings: Record<string, number>;
    counters: Record<string, number>;
  }
): PerfFrameSnapshot {
  return {
    frame,
    totalMs,
    deltaMs: 16.7,
    bodyCount: 100,
    dynamicBodyCount: 12,
    awakeBodyCount: 8,
    debrisBodyCount: 6,
    awakeDebrisBodyCount: 4,
    activeDebrisCount: 3,
    frozenDebrisCount: 2,
    pendingSupportReleaseCount: 1,
    accountedMs: 12,
    unattributedMs: Math.max(0, totalMs - 12),
    timings: values.timings,
    counters: values.counters
  };
}
