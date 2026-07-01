import { describe, expect, test } from "vitest";
import {
  FULL_RENDER_WARMUP_PROFILE,
  createInitialRenderWarmupState,
  renderWarmupModeFromSearch
} from "../../src/renderWarmup";

describe("render warmup helpers", () => {
  test("maps query strings to warmup modes", () => {
    expect(renderWarmupModeFromSearch("?smoke")).toBe("smoke");
    expect(renderWarmupModeFromSearch("?perf=1&smoke=1")).toBe("smoke");
    expect(renderWarmupModeFromSearch("?fullWarmup=1")).toBe("full");
    expect(renderWarmupModeFromSearch("?perf=1")).toBe("none");
  });

  test("ignores warmup query flags when diagnostics are unavailable", () => {
    expect(renderWarmupModeFromSearch("?smoke=1", false)).toBe("none");
    expect(renderWarmupModeFromSearch("?fullWarmup=1", false)).toBe("none");
  });

  test("creates an idle initial warmup state", () => {
    expect(createInitialRenderWarmupState()).toEqual({
      phase: "idle",
      token: 0,
      startedAt: 0,
      finishedAt: null,
      durationMs: null,
      programs: 0,
      geometries: 0,
      frames: 0
    });
  });

  test("keeps the full warmup profile internally consistent", () => {
    expect(FULL_RENDER_WARMUP_PROFILE).toMatchObject({
      label: "renderer pipelines",
      compileAllCameras: true,
      brutalPasses: 4,
      framesPerBrutalPass: 10
    });
    expect(FULL_RENDER_WARMUP_PROFILE.maxFrames).toBeGreaterThan(FULL_RENDER_WARMUP_PROFILE.minFrames);
    expect(FULL_RENDER_WARMUP_PROFILE.postCleanupMaxFrames).toBeGreaterThan(
      FULL_RENDER_WARMUP_PROFILE.postCleanupStableFrames
    );
  });
});
