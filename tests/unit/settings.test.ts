import { describe, expect, test } from "vitest";
import {
  COMFORT_GAME_SETTINGS,
  DEFAULT_GAME_SETTINGS,
  GAME_SETTINGS_STORAGE_KEY,
  type SettingsStorage,
  effectiveGraphicsPixelRatio,
  graphicsPixelRatioCap,
  loadGameSettings,
  sanitizeGameSettings,
  saveGameSettings
} from "../../src/settings";

describe("game settings", () => {
  test("defaults to the stable cinematic WebGL profile", () => {
    expect(DEFAULT_GAME_SETTINGS).toMatchObject({
      graphicsQuality: "cinematic",
      antialias: true
    });
  });

  test("provides a reduced-intensity comfort preset without changing the default profile", () => {
    expect(COMFORT_GAME_SETTINGS).toEqual({
      graphicsQuality: "performance",
      antialias: false,
      masterVolume: 0.68,
      cameraShake: 0.24,
      motionEffects: false,
      showFps: true
    });
    expect(DEFAULT_GAME_SETTINGS.graphicsQuality).toBe("cinematic");
    expect(DEFAULT_GAME_SETTINGS.motionEffects).toBe(true);
  });

  test("sanitizes unknown and out-of-range values", () => {
    expect(
      sanitizeGameSettings({
        graphicsQuality: "ultra",
        rendererBackend: "metal",
        antialias: "no",
        masterVolume: 3,
        cameraShake: -2,
        motionEffects: "yes",
        showFps: null
      })
    ).toEqual({
      ...DEFAULT_GAME_SETTINGS,
      masterVolume: 1,
      cameraShake: 0
    });
  });

  test("loads and saves settings through localStorage-compatible storage", () => {
    const storage = memoryStorage();
    const settings = {
      graphicsQuality: "performance" as const,
      antialias: false,
      masterVolume: 0.35,
      cameraShake: 0.2,
      motionEffects: false,
      showFps: false
    };

    expect(saveGameSettings(settings, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(GAME_SETTINGS_STORAGE_KEY) ?? "{}")).toMatchObject({
      graphicsQuality: "performance",
      antialias: false,
      masterVolume: 0.35,
      showFps: false
    });
    expect(loadGameSettings(storage)).toEqual(settings);
  });

  test("falls back safely when settings storage is unavailable or throws", () => {
    const throwingStorage: SettingsStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      }
    };

    expect(loadGameSettings(null)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(loadGameSettings(throwingStorage)).toEqual(DEFAULT_GAME_SETTINGS);
    expect(saveGameSettings(DEFAULT_GAME_SETTINGS, null)).toBe(false);
    expect(saveGameSettings(DEFAULT_GAME_SETTINGS, throwingStorage)).toBe(false);
  });

  test("maps graphics quality to renderer pixel ratio caps", () => {
    expect(graphicsPixelRatioCap("performance")).toBe(0.9);
    expect(graphicsPixelRatioCap("balanced")).toBe(1.2);
    expect(graphicsPixelRatioCap("cinematic")).toBe(1.45);
  });

  test("clamps renderer pixel ratio to the device ratio and quality cap", () => {
    expect(effectiveGraphicsPixelRatio(1.5, 1)).toBe(1);
    expect(effectiveGraphicsPixelRatio(1.5, 2)).toBe(1.5);
    expect(effectiveGraphicsPixelRatio(2.25, 3)).toBe(2.25);
    expect(effectiveGraphicsPixelRatio(1.15, 0)).toBe(1);
  });
});

function memoryStorage(): SettingsStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}
