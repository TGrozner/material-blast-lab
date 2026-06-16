export const GAME_SETTINGS_STORAGE_KEY = "material-blast-lab:settings:v1";

export type GraphicsQuality = "performance" | "balanced" | "cinematic";

export interface GameSettings {
  graphicsQuality: GraphicsQuality;
  antialias: boolean;
  masterVolume: number;
  cameraShake: number;
  motionEffects: boolean;
  showFps: boolean;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  graphicsQuality: "balanced",
  antialias: true,
  masterVolume: 0.84,
  cameraShake: 0.78,
  motionEffects: true,
  showFps: true
};

export const GRAPHICS_QUALITY_LABELS: Record<GraphicsQuality, string> = {
  performance: "Performance",
  balanced: "Balanced",
  cinematic: "Cinematic"
};

export function graphicsPixelRatioCap(quality: GraphicsQuality): number {
  switch (quality) {
    case "performance":
      return 1.5;
    case "balanced":
      return 2;
    case "cinematic":
      return 2.5;
  }
}

export function sanitizeGameSettings(value: unknown): GameSettings {
  const source = isRecord(value) ? value : {};
  const graphicsQuality = readGraphicsQuality(source.graphicsQuality);

  return {
    graphicsQuality,
    antialias: readBoolean(source.antialias, DEFAULT_GAME_SETTINGS.antialias),
    masterVolume: readNumber(source.masterVolume, DEFAULT_GAME_SETTINGS.masterVolume, 0, 1),
    cameraShake: readNumber(source.cameraShake, DEFAULT_GAME_SETTINGS.cameraShake, 0, 1),
    motionEffects: readBoolean(source.motionEffects, DEFAULT_GAME_SETTINGS.motionEffects),
    showFps: readBoolean(source.showFps, DEFAULT_GAME_SETTINGS.showFps)
  };
}

export function loadGameSettings(storage = getDefaultStorage()): GameSettings {
  if (!storage) {
    return { ...DEFAULT_GAME_SETTINGS };
  }

  try {
    const raw = storage.getItem(GAME_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_GAME_SETTINGS };
    }
    return sanitizeGameSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

export function saveGameSettings(settings: GameSettings, storage = getDefaultStorage()): boolean {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeGameSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

function getDefaultStorage(): SettingsStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readGraphicsQuality(value: unknown): GraphicsQuality {
  if (value === "performance" || value === "balanced" || value === "cinematic") {
    return value;
  }
  return DEFAULT_GAME_SETTINGS.graphicsQuality;
}

function readNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
