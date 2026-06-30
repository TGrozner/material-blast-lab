import type { ProjectileId } from "./projectile";
import type { ScoreBreakdown } from "./scoring";

export const ARCADE_PROGRESS_STORAGE_KEY = "downtown-mayhem:arcade-progress";
const ARCADE_PROGRESS_VERSION = 2;

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

export type ArcadeContractMetric = ArcadeBonusMetric | "totalScore" | "projectile";

export interface ArcadeContractObjective {
  id: string;
  label: string;
  metric: ArcadeContractMetric;
  minimum?: number;
  projectileIds?: ProjectileId[];
}

export interface ArcadeContractObjectiveResult {
  id: string;
  label: string;
  completed: boolean;
  value: number | string;
  target: number | string;
}

export interface ArcadeContractResult {
  completed: boolean;
  objectives: ArcadeContractObjectiveResult[];
}

export interface ArcadeRunContext {
  projectileId?: ProjectileId;
  contractObjectives?: readonly ArcadeContractObjective[];
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
  contractObjectives?: ArcadeContractObjective[];
}

export interface ArcadeResult {
  levelId: string;
  completed: boolean;
  stars: ArcadeStars;
  score: number;
  bonusCompleted: boolean;
  contract: ArcadeContractResult | null;
}

export interface ArcadeLevelProgress {
  attempts: number;
  bestScore: number;
  stars: ArcadeStars;
  completed: boolean;
  threeStarCleared: boolean;
  bestProjectileId: ProjectileId | null;
  bestCombo: number;
}

export interface ArcadeDistrictMastery {
  levelId: string;
  attempts: number;
  bestScore: number;
  stars: ArcadeStars;
  completed: boolean;
  threeStarCleared: boolean;
  bestProjectileId: ProjectileId | null;
  bestCombo: number;
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
      missionScore: 75_000,
      twoStarScore: 145_000,
      threeStarScore: 220_000,
      threeStarBonus: { metric: "chainReactionCount", minimum: 180 }
    }
  },
  {
    id: "breaker-yard",
    title: "Breaker Yard",
    thresholds: {
      missionScore: 115_000,
      twoStarScore: 230_000,
      threeStarScore: 390_000,
      threeStarBonus: { metric: "chainReactionCount", minimum: 210 }
    }
  },
  {
    id: "switchback-crush",
    title: "Switchback Crush",
    thresholds: {
      missionScore: 125_000,
      twoStarScore: 260_000,
      threeStarScore: 440_000,
      threeStarBonus: { metric: "collateralChaos", minimum: 95_000 }
    }
  },
  {
    id: "relay-gauntlet",
    title: "Relay Gauntlet",
    thresholds: {
      missionScore: 155_000,
      twoStarScore: 315_000,
      threeStarScore: 520_000,
      threeStarBonus: { metric: "maxChainCombo", minimum: 28 }
    }
  },
  {
    id: "overdrive-core",
    title: "Overdrive Core",
    thresholds: {
      missionScore: 180_000,
      twoStarScore: 360_000,
      threeStarScore: 610_000,
      threeStarBonus: { metric: "collateralChaos", minimum: 140_000 }
    }
  }
] as const;

export function evaluateArcadeResult(
  level: ArcadeLevelDefinition,
  score: ScoreBreakdown,
  context: ArcadeRunContext = {}
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
    bonusCompleted,
    contract: evaluateMayhemContract(context.contractObjectives ?? level.contractObjectives, score, context)
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
  score: ScoreBreakdown,
  context: ArcadeRunContext = {}
): { progress: ArcadeProgress; result: ArcadeResult } {
  const levelIndex = levels.findIndex((level) => level.id === levelId);
  if (levelIndex < 0) {
    throw new Error(`Unknown Arcade level: ${levelId}`);
  }

  const result = evaluateArcadeResult(levels[levelIndex], score, context);
  const previousLevel = progress.levels[levelId] ?? createEmptyLevelProgress();
  const previousAttempts = Math.max(0, toFiniteInteger(previousLevel.attempts, 0));
  const previousBestScore = Math.max(0, toFiniteInteger(previousLevel.bestScore, 0));
  const stars = maxStars(previousLevel.stars, result.stars);
  const bestScore = Math.max(previousBestScore, result.score);
  const isBestScoreRun = previousAttempts <= 0 || result.score > previousBestScore;
  const bestProjectileId =
    isBestScoreRun && context.projectileId
      ? context.projectileId
      : normalizeProjectileId(previousLevel.bestProjectileId);
  const bestCombo = Math.max(
    Math.max(0, toFiniteInteger(previousLevel.bestCombo, 0)),
    Math.max(0, toFiniteInteger(score.maxChainCombo, 0))
  );
  const levelsProgress: Record<string, ArcadeLevelProgress> = {
    ...progress.levels,
    [levelId]: {
      attempts: previousAttempts + 1,
      bestScore,
      stars,
      completed: stars >= 2,
      threeStarCleared: stars >= 3,
      bestProjectileId,
      bestCombo
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

export function districtMasteryForLevel(progress: ArcadeProgress, levelId: string): ArcadeDistrictMastery {
  const levelProgress = progress.levels[levelId] ?? createEmptyLevelProgress();
  const stars = normalizeStars(levelProgress.stars);
  const bestScore = Math.max(0, toFiniteInteger(levelProgress.bestScore, 0));
  return {
    levelId,
    attempts: Math.max(0, toFiniteInteger(levelProgress.attempts, 0)),
    bestScore,
    stars,
    completed: stars >= 2,
    threeStarCleared: stars >= 3,
    bestProjectileId: normalizeProjectileId(levelProgress.bestProjectileId),
    bestCombo: Math.max(0, toFiniteInteger(levelProgress.bestCombo, 0))
  };
}

function evaluateBonus(score: ScoreBreakdown, bonus: ArcadeBonusThreshold | undefined): boolean {
  if (!bonus) {
    return true;
  }
  return score[bonus.metric] >= bonus.minimum;
}

export function evaluateMayhemContract(
  objectives: readonly ArcadeContractObjective[] | undefined,
  score: ScoreBreakdown,
  context: ArcadeRunContext = {}
): ArcadeContractResult | null {
  if (!objectives || objectives.length === 0) {
    return null;
  }
  const results = objectives.map((objective) => evaluateContractObjective(objective, score, context));
  return {
    completed: results.every((objective) => objective.completed),
    objectives: results
  };
}

function evaluateContractObjective(
  objective: ArcadeContractObjective,
  score: ScoreBreakdown,
  context: ArcadeRunContext
): ArcadeContractObjectiveResult {
  if (objective.metric === "projectile") {
    const projectileIds = objective.projectileIds ?? [];
    const projectileId = context.projectileId ?? "";
    return {
      id: objective.id,
      label: objective.label,
      completed: projectileIds.includes(projectileId as ProjectileId),
      value: projectileId || "none",
      target: projectileIds.join(" or ") || "any"
    };
  }
  const minimum = objective.minimum ?? 0;
  const value = objective.metric === "totalScore" ? score.totalScore : score[objective.metric];
  return {
    id: objective.id,
    label: objective.label,
    completed: value >= minimum,
    value,
    target: minimum
  };
}

function createEmptyLevelProgress(): ArcadeLevelProgress {
  return {
    attempts: 0,
    bestScore: 0,
    stars: 0,
    completed: false,
    threeStarCleared: false,
    bestProjectileId: null,
    bestCombo: 0
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
    completed: stars >= 2,
    threeStarCleared: stars >= 3,
    bestProjectileId: normalizeProjectileId(value.bestProjectileId ?? value.bestProjectile),
    bestCombo: Math.max(0, toFiniteInteger(value.bestCombo, 0))
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

function normalizeProjectileId(value: unknown): ProjectileId | null {
  if (value === "slug" || value === "scatter" || value === "pulse" || value === "gravity" || value === "ignite") {
    return value;
  }
  return null;
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
