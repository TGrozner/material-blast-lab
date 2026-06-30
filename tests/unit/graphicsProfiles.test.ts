import { describe, expect, test } from "vitest";
import { canvasGradeProfile, graphicsLightingProfile, settingsStatus } from "../../src/graphicsProfiles";

describe("graphics profiles", () => {
  test("formats settings status for shell and in-game messages", () => {
    expect(
      settingsStatus({
        graphicsQuality: "cinematic",
        antialias: true,
        masterVolume: 0.84,
        cameraShake: 0.78,
        motionEffects: true,
        showFps: true
      })
    ).toBe("Cinematic, WebGL renderer, 84% volume, 78% shake");
  });

  test("keeps cinematic lighting richer than performance lighting", () => {
    const performance = graphicsLightingProfile("performance");
    const cinematic = graphicsLightingProfile("cinematic");

    expect(performance.shadowMapSize).toBe(1536);
    expect(cinematic.shadowMapSize).toBe(2048);
    expect(cinematic.sunIntensity).toBeGreaterThan(performance.sunIntensity);
    expect(cinematic.fogFar).toBeLessThan(performance.fogFar);
  });

  test("disables canvas grading only for performance", () => {
    expect(canvasGradeProfile("performance")).toEqual({
      filter: "none",
      boxShadow: "none"
    });
    expect(canvasGradeProfile("balanced").filter).toContain("contrast");
    expect(canvasGradeProfile("cinematic").boxShadow).toContain("98px");
  });
});
