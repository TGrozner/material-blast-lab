import { describe, expect, test } from "vitest";
import {
  DEFAULT_GAME_SETTINGS,
  GAME_SETTINGS_STORAGE_KEY,
  type SettingsStorage,
  graphicsPixelRatioCap,
  loadGameSettings,
  sanitizeGameSettings,
  saveGameSettings
} from "../../src/settings";

describe("game settings", () => {
  test("sanitizes unknown and out-of-range values", () => {
    expect(
      sanitizeGameSettings({
        graphicsQuality: "ultra",
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
    expect(graphicsPixelRatioCap("performance")).toBe(1.15);
    expect(graphicsPixelRatioCap("balanced")).toBe(1.5);
    expect(graphicsPixelRatioCap("cinematic")).toBe(2.25);
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
