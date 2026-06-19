import type { ScoreBreakdown } from "./scoring";

export const ARCADE_PROGRESS_STORAGE_KEY = "downtown-mayhem:arcade-progress";
const ARCADE_PROGRESS_VERSION = 1;

export type ArcadeStars = 0 | 1 | 2 | 3;

export type ArcadeBonusMetric =
  | "targetDamage"
  | "collateralChaos"
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
  twoStarScore: number;
  threeStarScore: number;
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
    id: "hazard-junction",
    title: "Hazard Junction",
    thresholds: {
      missionScore: 40_000,
      twoStarScore: 90_000,
      threeStarScore: 200_000,
      threeStarBonus: { metric: "chainReactionCount", minimum: 100 }
    }
  },
  {
    id: "breaker-yard",
    title: "Breaker Yard",
    thresholds: {
      missionScore: 55_000,
      twoStarScore: 120_000,
      threeStarScore: 260_000,
      threeStarBonus: { metric: "chainReactionCount", minimum: 120 }
    }
  },
  {
    id: "switchback-crush",
    title: "Switchback Crush",
    thresholds: {
      missionScore: 60_000,
      twoStarScore: 135_000,
      threeStarScore: 300_000,
      threeStarBonus: { metric: "collateralChaos", minimum: 28_000 }
    }
  }
] as const;

export function evaluateArcadeResult(
  level: ArcadeLevelDefinition,
  score: ScoreBreakdown
): ArcadeResult {
  const thresholds = level.thresholds;
  const oneStar = score.totalScore >= thresholds.missionScore;
  const twoStar = score.totalScore >= thresholds.twoStarScore;
  const bonusCompleted = evaluateBonus(score, thresholds.threeStarBonus);
  const threeStar = twoStar && score.totalScore >= thresholds.threeStarScore && bonusCompleted;

  return {
    levelId: level.id,
    completed: twoStar,
    stars: threeStar ? 3 : twoStar ? 2 : oneStar ? 1 : 0,
    score: score.totalScore,
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
  const stars = maxStars(previousLevel.stars, result.stars);
  const levelsProgress: Record<string, ArcadeLevelProgress> = {
    ...progress.levels,
    [levelId]: {
      attempts: previousLevel.attempts + 1,
      bestScore: Math.max(previousLevel.bestScore, result.score),
      stars,
      completed: stars >= 2
    }
  };

  return {
    result,
    progress: recalculateTotalStars({
      version: ARCADE_PROGRESS_VERSION,
      highestUnlockedLevel: deriveHighestUnlockedLevel(levels, levelsProgress),
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

  return recalculateTotalStars({
    version: ARCADE_PROGRESS_VERSION,
    highestUnlockedLevel: deriveHighestUnlockedLevel(levels, normalizedLevels),
    levels: normalizedLevels,
    totalStars: 0
  });
}

function normalizeLevelProgress(value: unknown): ArcadeLevelProgress {
  if (!isRecord(value)) {
    return createEmptyLevelProgress();
  }

  const stars = normalizeStars(value.stars);
  return {
    attempts: Math.max(0, toFiniteInteger(value.attempts, 0)),
    bestScore: Math.max(0, toFiniteInteger(value.bestScore, 0)),
    stars,
    completed: stars >= 2
  };
}

function deriveHighestUnlockedLevel(
  levels: readonly ArcadeLevelDefinition[],
  progressLevels: Record<string, ArcadeLevelProgress>
): number {
  if (levels.length <= 0) {
    return -1;
  }
  let highestUnlockedLevel = 0;
  for (let index = 0; index < levels.length - 1; index += 1) {
    const levelProgress = progressLevels[levels[index].id];
    if (!levelProgress || levelProgress.stars < 2) {
      break;
    }
    highestUnlockedLevel = index + 1;
  }
  return highestUnlockedLevel;
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
