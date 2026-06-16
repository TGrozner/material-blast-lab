import type { ScoreBreakdown } from "./scoring";

export const ARCADE_PROGRESS_STORAGE_KEY = "material-blast-lab:arcade-progress";
const ARCADE_PROGRESS_VERSION = 1;

export type ArcadeStars = 0 | 1 | 2 | 3;

export type ArcadeBonusMetric =
  | "targetDamage"
  | "cityChaos"
  | "contaminationPurge"
  | "chainReactionBonus"
  | "remainingDebrisMotion"
  | "chainReactionCount"
  | "maxChainCombo";

export interface ArcadeBonusThreshold {
  metric: ArcadeBonusMetric;
  minimum: number;
}

export interface ArcadeStarThresholds {
  missionScore: number;
  missionMaxProtectedPenalty: number;
  twoStarScore: number;
  twoStarMaxProtectedPenalty: number;
  threeStarScore: number;
  threeStarMaxProtectedPenalty: number;
  threeStarBonus?: ArcadeBonusThreshold;
}

export interface ArcadeLevelDefinition {
  id: string;
  title: string;
  thresholds: ArcadeStarThresholds;
}

export interface ArcadeResult {
  levelId: string;
  completed: boolean;
  stars: ArcadeStars;
  score: number;
  protectedPenalty: number;
  bonusCompleted: boolean;
}

export interface ArcadeLevelProgress {
  attempts: number;
  bestScore: number;
  stars: ArcadeStars;
  completed: boolean;
}

export interface ArcadeProgress {
  version: number;
  highestUnlockedLevel: number;
  totalStars: number;
  levels: Record<string, ArcadeLevelProgress>;
}

export type ArcadeStorage = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_ARCADE_LEVELS: ArcadeLevelDefinition[] = [
  {
    id: "target-primer",
    title: "Target Primer",
    thresholds: {
      missionScore: 900,
      missionMaxProtectedPenalty: 300,
      twoStarScore: 1300,
      twoStarMaxProtectedPenalty: 160,
      threeStarScore: 1800,
      threeStarMaxProtectedPenalty: 80,
      threeStarBonus: { metric: "targetDamage", minimum: 700 }
    }
  },
  {
    id: "cascade-lane",
    title: "Cascade Lane",
    thresholds: {
      missionScore: 1100,
      missionMaxProtectedPenalty: 340,
      twoStarScore: 1650,
      twoStarMaxProtectedPenalty: 170,
      threeStarScore: 2200,
      threeStarMaxProtectedPenalty: 90,
      threeStarBonus: { metric: "chainReactionCount", minimum: 3 }
    }
  },
  {
    id: "clinic-squeeze",
    title: "Clinic Squeeze",
    thresholds: {
      missionScore: 1200,
      missionMaxProtectedPenalty: 180,
      twoStarScore: 1600,
      twoStarMaxProtectedPenalty: 90,
      threeStarScore: 2100,
      threeStarMaxProtectedPenalty: 35,
      threeStarBonus: { metric: "maxChainCombo", minimum: 2 }
    }
  },
  {
    id: "purge-shot",
    title: "Purge Shot",
    thresholds: {
      missionScore: 1350,
      missionMaxProtectedPenalty: 260,
      twoStarScore: 1850,
      twoStarMaxProtectedPenalty: 130,
      threeStarScore: 2350,
      threeStarMaxProtectedPenalty: 70,
      threeStarBonus: { metric: "contaminationPurge", minimum: 450 }
    }
  },
  {
    id: "high-score-route",
    title: "High-Score Route",
    thresholds: {
      missionScore: 1500,
      missionMaxProtectedPenalty: 300,
      twoStarScore: 2100,
      twoStarMaxProtectedPenalty: 140,
      threeStarScore: 2800,
      threeStarMaxProtectedPenalty: 75,
      threeStarBonus: { metric: "chainReactionBonus", minimum: 500 }
    }
  }
] as const;

export function evaluateArcadeResult(
  level: ArcadeLevelDefinition,
  score: ScoreBreakdown
): ArcadeResult {
  const thresholds = level.thresholds;
  const completed =
    score.totalScore >= thresholds.missionScore &&
    score.protectedPenalty <= thresholds.missionMaxProtectedPenalty;
  const twoStar =
    completed &&
    score.totalScore >= thresholds.twoStarScore &&
    score.protectedPenalty <= thresholds.twoStarMaxProtectedPenalty;
  const bonusCompleted = evaluateBonus(score, thresholds.threeStarBonus);
  const threeStar =
    twoStar &&
    score.totalScore >= thresholds.threeStarScore &&
    score.protectedPenalty <= thresholds.threeStarMaxProtectedPenalty &&
    bonusCompleted;

  return {
    levelId: level.id,
    completed,
    stars: threeStar ? 3 : twoStar ? 2 : completed ? 1 : 0,
    score: score.totalScore,
    protectedPenalty: score.protectedPenalty,
    bonusCompleted
  };
}

export function createInitialArcadeProgress(levels: readonly ArcadeLevelDefinition[]): ArcadeProgress {
  return recalculateTotalStars({
    version: ARCADE_PROGRESS_VERSION,
    highestUnlockedLevel: levels.length > 0 ? 0 : -1,
    levels: Object.fromEntries(levels.map((level) => [level.id, createEmptyLevelProgress()])),
    totalStars: 0
  });
}

export function recordArcadeRun(
  progress: ArcadeProgress,
  levels: readonly ArcadeLevelDefinition[],
  levelId: string,
  score: ScoreBreakdown
): { progress: ArcadeProgress; result: ArcadeResult } {
  const levelIndex = levels.findIndex((level) => level.id === levelId);
  if (levelIndex < 0) {
    throw new Error(`Unknown Arcade level: ${levelId}`);
  }

  const result = evaluateArcadeResult(levels[levelIndex], score);
  const previousLevel = progress.levels[levelId] ?? createEmptyLevelProgress();
  const levelsProgress: Record<string, ArcadeLevelProgress> = {
    ...progress.levels,
    [levelId]: {
      attempts: previousLevel.attempts + 1,
      bestScore: Math.max(previousLevel.bestScore, result.score),
      stars: maxStars(previousLevel.stars, result.stars),
      completed: previousLevel.completed || result.completed
    }
  };

  const highestUnlockedLevel =
    result.completed && levelIndex >= progress.highestUnlockedLevel
      ? Math.min(levels.length - 1, levelIndex + 1)
      : clampUnlockedLevel(progress.highestUnlockedLevel, levels.length);

  return {
    result,
    progress: recalculateTotalStars({
      version: ARCADE_PROGRESS_VERSION,
      highestUnlockedLevel,
      levels: levelsProgress,
      totalStars: progress.totalStars
    })
  };
}

export function loadArcadeProgress(
  levels: readonly ArcadeLevelDefinition[],
  storage: ArcadeStorage | null = getLocalStorage()
): ArcadeProgress {
  if (!storage) {
    return createInitialArcadeProgress(levels);
  }

  try {
    const raw = storage.getItem(ARCADE_PROGRESS_STORAGE_KEY);
    if (!raw) {
      return createInitialArcadeProgress(levels);
    }
    return normalizeProgress(JSON.parse(raw), levels);
  } catch {
    return createInitialArcadeProgress(levels);
  }
}

export function saveArcadeProgress(
  progress: ArcadeProgress,
  storage: ArcadeStorage | null = getLocalStorage()
): boolean {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(ARCADE_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

function evaluateBonus(score: ScoreBreakdown, bonus: ArcadeBonusThreshold | undefined): boolean {
  if (!bonus) {
    return true;
  }
  return score[bonus.metric] >= bonus.minimum;
}

function createEmptyLevelProgress(): ArcadeLevelProgress {
  return {
    attempts: 0,
    bestScore: 0,
    stars: 0,
    completed: false
  };
}

function normalizeProgress(value: unknown, levels: readonly ArcadeLevelDefinition[]): ArcadeProgress {
  if (!isRecord(value)) {
    return createInitialArcadeProgress(levels);
  }

  const savedLevels = isRecord(value.levels) ? value.levels : {};
  const normalizedLevels: Record<string, ArcadeLevelProgress> = {};
  for (const level of levels) {
    normalizedLevels[level.id] = normalizeLevelProgress(savedLevels[level.id]);
  }

  const highestUnlockedLevel = clampUnlockedLevel(toFiniteInteger(value.highestUnlockedLevel, 0), levels.length);
  return recalculateTotalStars({
    version: ARCADE_PROGRESS_VERSION,
    highestUnlockedLevel,
    levels: normalizedLevels,
    totalStars: 0
  });
}

function normalizeLevelProgress(value: unknown): ArcadeLevelProgress {
  if (!isRecord(value)) {
    return createEmptyLevelProgress();
  }

  return {
    attempts: Math.max(0, toFiniteInteger(value.attempts, 0)),
    bestScore: Math.max(0, toFiniteInteger(value.bestScore, 0)),
    stars: normalizeStars(value.stars),
    completed: value.completed === true
  };
}

function recalculateTotalStars(progress: ArcadeProgress): ArcadeProgress {
  return {
    ...progress,
    totalStars: Object.values(progress.levels).reduce((sum, level) => sum + level.stars, 0)
  };
}

function maxStars(a: ArcadeStars, b: ArcadeStars): ArcadeStars {
  return a > b ? a : b;
}

function normalizeStars(value: unknown): ArcadeStars {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }
  return 0;
}

function clampUnlockedLevel(value: number, levelCount: number): number {
  if (levelCount <= 0) {
    return -1;
  }
  return Math.max(0, Math.min(levelCount - 1, value));
}

function toFiniteInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getLocalStorage(): ArcadeStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
