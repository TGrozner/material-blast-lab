import type { ArcadeContractObjective, ArcadeContractResult, ArcadeProgress, ArcadeStars } from "./arcade";
import type { ArcadeMissionFields } from "./levels";
import {
  IGNITE_CHAIN_LABEL,
  IGNITE_CHAIN_OBJECTIVE_ID,
  LATE_GAME_PROJECTILE_ORDER,
  projectileOrderForUnlockedLevels,
  type ProjectileId
} from "./projectile";
import type { ScoreBreakdown, ScoreEvent } from "./scoring";

export const DAILY_RESULTS_STORAGE_KEY = "downtown-mayhem:daily-results";
const DAILY_RESULTS_VERSION = 1;

export interface RunVariant {
  id: string;
  label: string;
  description: string;
  contractMultiplier: number;
}

export interface ProjectileObjective {
  id: string;
  label: string;
  metric: ArcadeContractObjective["metric"];
  minimum?: number;
  projectileIds?: ProjectileId[];
}

export type ProjectileObjectivesByProjectile = Record<ProjectileId, ProjectileObjective>;

export interface LevelProjectileObjectives {
  levelId: string;
  objectives: ProjectileObjectivesByProjectile;
}

export interface MayhemContract {
  id: string;
  label: string;
  summary: string;
  objectives: ArcadeContractObjective[];
}

export interface RunScoreSource {
  kind: ScoreEvent["kind"];
  label: string;
  points: number;
}

export type RunReplayMomentKind = "impact" | "boss" | "ignition" | "chain" | "source";

export interface RunReplayMoment {
  id: string;
  kind: RunReplayMomentKind;
  label: string;
  points: number;
  position: { x: number; y: number; z: number };
}

export interface RunFeedback {
  topSources: RunScoreSource[];
  nearMisses: string[];
  replayMoment: RunReplayMoment | null;
  replayTimeline: RunReplayMoment[];
  projectileObjective: ProjectileObjective | null;
  variant: RunVariant;
  contract: MayhemContract | null;
  contractResult: ArcadeContractResult | null;
}

export interface DailyContractDefinition {
  dateKey: string;
  seed: number;
  levelIndex: number;
  levelId: string;
  projectileId: ProjectileId;
  variant: RunVariant;
  contract: MayhemContract;
}

export interface DailyResultEntry {
  dateKey: string;
  levelId: string;
  projectileId: ProjectileId;
  contractId: string;
  attempts: number;
  bestScore: number;
  bestStars: ArcadeStars;
  bestContractCompleted: boolean;
  bestRating: string;
}

export interface DailyResultMeta {
  dateKey: string;
  attempts: number;
  previousBestScore: number;
  previousBestStars: ArcadeStars;
  bestScore: number;
  bestStars: ArcadeStars;
  newBest: boolean;
  starsGained: number;
  contractCompleted: boolean;
  shareText: string;
}

export interface MayhemFeatureLevel {
  id: string;
  mission: ArcadeMissionFields;
}

export interface WeeklyMayhemRouteEntry {
  weekKey: string;
  seed: number;
  runIndex: number;
  levelIndex: number;
  levelId: string;
  projectileId: ProjectileId;
  variant: RunVariant;
  projectileObjective: ProjectileObjective;
  contract: MayhemContract;
  localBestScore: number;
  localBestStars: ArcadeStars;
  localThreeStarCleared: boolean;
}

export interface WeeklyMayhemRoute {
  weekKey: string;
  seed: number;
  entries: WeeklyMayhemRouteEntry[];
  localCumulativeBestScore: number;
  localCompletedRuns: number;
  localStars: number;
}

type DailyResultStorage = Pick<Storage, "getItem" | "setItem">;

interface DailyResultsState {
  version: number;
  entries: Record<string, DailyResultEntry>;
}

const RUN_VARIANTS: RunVariant[] = [
  {
    id: "rush-hour",
    label: "Rush Hour",
    description: "Vehicles + fast hits.",
    contractMultiplier: 1.04
  },
  {
    id: "relay-storm",
    label: "Relay Storm",
    description: "Chain the relays.",
    contractMultiplier: 1.08
  },
  {
    id: "heavy-salvage",
    label: "Heavy Salvage",
    description: "Big object damage.",
    contractMultiplier: 0.96
  },
  {
    id: "glass-rush",
    label: "Glass Rush",
    description: "Fast glass breaks.",
    contractMultiplier: 1
  }
];

const DISTRICT_PROJECTILE_OBJECTIVES: Record<
  string,
  Partial<
    Record<
      ProjectileId,
      {
        idSuffix: string;
        label: string;
        metric?: ArcadeContractObjective["metric"];
        minimum?: number;
        minimumMultiplier?: number;
        projectileIds?: ProjectileId[];
      }
    >
  >
> = {
  "hazard-junction": {
    slug: {
      idSuffix: "slug-toxic-core",
      label: "Normal: toxic core first",
      minimumMultiplier: 0.95
    },
    scatter: {
      idSuffix: "frag-tanker-spray",
      label: "Frag: tankers + traffic for secondary hits",
      minimumMultiplier: 1.08
    },
    pulse: {
      idSuffix: "impulse-storefront-wave",
      label: "Impulse: shoot low, shove storefronts",
      minimumMultiplier: 1.05
    },
    gravity: {
      idSuffix: "heavy-pump-line",
      label: "Heavy: pierce pump, sign, depot",
      metric: "totalScore",
      minimumMultiplier: 0.9
    },
    ignite: {
      idSuffix: "ignite-fuel-relay",
      label: `${IGNITE_CHAIN_LABEL}: fuel lane relay`,
      minimumMultiplier: 0.96
    }
  },
  "breaker-yard": {
    slug: {
      idSuffix: "slug-breaker-spine",
      label: "Normal: breaker spine first",
      minimumMultiplier: 1.02
    },
    scatter: {
      idSuffix: "frag-relay-row",
      label: "Frag: relay rows for secondary hits",
      minimumMultiplier: 1.14
    },
    pulse: {
      idSuffix: "impulse-yard-surge",
      label: "Impulse: shove substation cargo",
      minimumMultiplier: 1.08
    },
    gravity: {
      idSuffix: "heavy-transformer-punch",
      label: "Heavy: spine + transformer pierce",
      metric: "targetDamage",
      minimumMultiplier: 1.04
    },
    ignite: {
      idSuffix: "ignite-power-grid",
      label: `${IGNITE_CHAIN_LABEL}: power grid first`,
      minimumMultiplier: 1.02
    }
  },
  "switchback-crush": {
    slug: {
      idSuffix: "slug-archive-spine",
      label: "Normal: archive spine first",
      minimumMultiplier: 1
    },
    scatter: {
      idSuffix: "frag-glass-baffles",
      label: "Frag: glass baffle lanes",
      minimumMultiplier: 1.1
    },
    pulse: {
      idSuffix: "impulse-foam-redirect",
      label: "Impulse: foam into archive glass",
      metric: "collateralChaos",
      minimumMultiplier: 1.16
    },
    gravity: {
      idSuffix: "heavy-switchback-line",
      label: "Heavy: pierce both switchbacks",
      metric: "totalScore",
      minimumMultiplier: 0.94
    },
    ignite: {
      idSuffix: "ignite-archive-fire",
      label: `${IGNITE_CHAIN_LABEL}: tanker to glass`,
      minimumMultiplier: 1
    }
  },
  "relay-gauntlet": {
    slug: {
      idSuffix: "slug-capacitor-shield",
      label: "Normal: shield, then core",
      metric: "targetDamage",
      minimumMultiplier: 1.06
    },
    scatter: {
      idSuffix: "frag-relay-gates",
      label: "Frag: relay gates feed boss lane",
      metric: "chainReactionCount",
      minimumMultiplier: 1.2
    },
    pulse: {
      idSuffix: "impulse-traffic-latch",
      label: "Impulse: traffic into latch phase",
      metric: "collateralChaos",
      minimumMultiplier: 1.14
    },
    gravity: {
      idSuffix: "heavy-capacitor-core",
      label: "Heavy: shield + latch + core",
      metric: "totalScore",
      minimumMultiplier: 0.98
    },
    ignite: {
      idSuffix: "ignite-relay-chain",
      label: `${IGNITE_CHAIN_LABEL}: relay gates before core`,
      metric: "maxChainCombo",
      minimumMultiplier: 1.08
    }
  },
  "overdrive-core": {
    slug: {
      idSuffix: "slug-prism-order",
      label: "Normal: prism seal first",
      metric: "targetDamage",
      minimumMultiplier: 1.04
    },
    scatter: {
      idSuffix: "frag-pressure-bulbs",
      label: "Frag: pressure bulbs",
      metric: "chainReactionCount",
      minimumMultiplier: 1.16
    },
    pulse: {
      idSuffix: "impulse-cashout-wave",
      label: "Impulse: cash-out rebound",
      metric: "collateralChaos",
      minimumMultiplier: 1.2
    },
    gravity: {
      idSuffix: "heavy-prism-core",
      label: "Heavy: order, latch, core",
      metric: "totalScore",
      minimumMultiplier: 1
    },
    ignite: {
      idSuffix: "ignite-overdrive-route",
      label: `${IGNITE_CHAIN_LABEL}: bulbs before prism`,
      metric: "maxChainCombo",
      minimumMultiplier: 1.12
    }
  }
};

export function runVariantForSeed(levelId: string, seed: number): RunVariant {
  const hash = hashString(`${levelId}:${seed}`);
  return RUN_VARIANTS[hash % RUN_VARIANTS.length];
}

export function dailyDateKey(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dailyContractForDate(
  levels: readonly MayhemFeatureLevel[],
  date = new Date()
): DailyContractDefinition | null {
  if (levels.length === 0) {
    return null;
  }
  const dateKey = dailyDateKey(date);
  const seed = hashString(`downtown-daily:${dateKey}`);
  const levelIndex = seed % levels.length;
  const level = levels[levelIndex];
  const projectileOrder = projectileOrderForUnlockedLevels(levels.length);
  const projectileId = projectileOrder[Math.floor(seed / Math.max(1, levels.length)) % projectileOrder.length];
  const variantSeed = hashString(`${dateKey}:${level.id}:${projectileId}`);
  const variant = runVariantForSeed(level.id, variantSeed);
  return {
    dateKey,
    seed: variantSeed,
    levelIndex,
    levelId: level.id,
    projectileId,
    variant,
    contract: mayhemContractForRun(level.id, level.mission, projectileId, variant)
  };
}

export function weeklyRouteKey(date = new Date()): string {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const weekYear = utcDate.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const weekNumber = Math.ceil(((utcDate.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${weekYear}-W${String(weekNumber).padStart(2, "0")}`;
}

export function weeklyMayhemRouteForDate(
  levels: readonly MayhemFeatureLevel[],
  date = new Date(),
  progress: ArcadeProgress | null = null
): WeeklyMayhemRoute {
  const weekKey = weeklyRouteKey(date);
  const seed = hashString(`downtown-weekly:${weekKey}`);
  const routeLevels = levels.slice(0, 5);
  const unlockedLevelCount = progress ? Math.max(1, Math.min(routeLevels.length, progress.highestUnlockedLevel + 1)) : routeLevels.length;
  const projectileOrder = weeklyProjectileOrder(seed, unlockedLevelCount);
  const entries = routeLevels.map((level, levelIndex): WeeklyMayhemRouteEntry => {
    const projectileId = projectileOrder[levelIndex % projectileOrder.length];
    const variantSeed = hashString(`${weekKey}:${level.id}:${projectileId}:${levelIndex}`);
    const variant = runVariantForSeed(level.id, variantSeed);
    const localProgress = progress?.levels[level.id];
    const localBestStars = normalizeStars(localProgress?.stars);
    return {
      weekKey,
      seed: variantSeed,
      runIndex: levelIndex + 1,
      levelIndex,
      levelId: level.id,
      projectileId,
      variant,
      projectileObjective: projectileObjectiveForRun(level.id, projectileId, level.mission),
      contract: mayhemContractForRun(level.id, level.mission, projectileId, variant),
      localBestScore: clampWholeNumber(localProgress?.bestScore),
      localBestStars,
      localThreeStarCleared: localBestStars >= 3
    };
  });

  return {
    weekKey,
    seed,
    entries,
    localCumulativeBestScore: entries.reduce((sum, entry) => sum + entry.localBestScore, 0),
    localCompletedRuns: entries.filter((entry) => entry.localBestStars >= 2).length,
    localStars: entries.reduce((sum, entry) => sum + entry.localBestStars, 0)
  };
}

export function loadDailyResult(
  contract: DailyContractDefinition,
  storage: DailyResultStorage | null = getLocalStorage()
): DailyResultEntry | null {
  return loadDailyResults(storage).entries[dailyResultKey(contract)] ?? null;
}

export function recordDailyResult(
  contract: DailyContractDefinition,
  options: {
    score: ScoreBreakdown;
    stars: ArcadeStars;
    contractCompleted: boolean;
    levelName: string;
    projectileLabel: string;
  },
  storage: DailyResultStorage | null = getLocalStorage()
): DailyResultMeta {
  const state = loadDailyResults(storage);
  const key = dailyResultKey(contract);
  const previous = state.entries[key] ?? createEmptyDailyResult(contract);
  const newBest = previous.attempts === 0 || options.score.totalScore > previous.bestScore;
  const bestStars = maxStars(previous.bestStars, options.stars);
  const bestScore = Math.max(previous.bestScore, options.score.totalScore);
  const next: DailyResultEntry = {
    ...previous,
    attempts: previous.attempts + 1,
    bestScore,
    bestStars,
    bestContractCompleted: previous.bestContractCompleted || options.contractCompleted,
    bestRating: newBest ? options.score.mayhemRating : previous.bestRating
  };
  saveDailyResults(
    {
      version: DAILY_RESULTS_VERSION,
      entries: {
        ...state.entries,
        [key]: next
      }
    },
    storage
  );

  return {
    dateKey: contract.dateKey,
    attempts: next.attempts,
    previousBestScore: previous.bestScore,
    previousBestStars: previous.bestStars,
    bestScore: next.bestScore,
    bestStars: next.bestStars,
    newBest,
    starsGained: Math.max(0, options.stars - previous.bestStars),
    contractCompleted: options.contractCompleted,
    shareText: dailyResultShareText(contract, {
      levelName: options.levelName,
      projectileLabel: options.projectileLabel,
      score: options.score,
      stars: options.stars,
      contractCompleted: options.contractCompleted
    })
  };
}

export function dailyResultShareText(
  contract: DailyContractDefinition,
  options: {
    levelName: string;
    projectileLabel: string;
    score: ScoreBreakdown;
    stars: ArcadeStars;
    contractCompleted: boolean;
  }
): string {
  const contractState = options.contractCompleted ? "contract complete" : "contract missed";
  return [
    `Downtown Mayhem Daily ${contract.dateKey}`,
    `${formatScore(options.score.totalScore)} Mayhem`,
    `${options.stars}/3 stars`,
    options.levelName,
    options.projectileLabel,
    contractState
  ].join(" / ");
}

export function projectileObjectiveFor(projectileId: ProjectileId, mission: ArcadeMissionFields): ProjectileObjective {
  switch (projectileId) {
    case "slug":
      return {
        id: "slug-core-hit",
        label: "Normal: target core first",
        metric: "targetDamage",
        minimum: Math.round(mission.targetDamageThreshold * 0.9)
      };
    case "scatter":
      return {
        id: "scatter-secondary-hits",
        label: "Frag: clusters for secondary hits",
        metric: "chainReactionCount",
        minimum: Math.max(30, Math.round(mission.bonusThreshold.minimum * 0.52))
      };
    case "pulse":
      return {
        id: "pulse-chaos-wave",
        label: "Impulse: shoot low, wide wave",
        metric: "collateralChaos",
        minimum: Math.max(18_000, Math.round(mission.scoreThresholds.oneStar * 0.34))
      };
    case "gravity":
      return {
        id: "gravity-pierce-line",
        label: "Heavy: pierce dense line",
        metric: "totalScore",
        minimum: Math.round(mission.scoreThresholds.twoStar * 0.86)
      };
    case "ignite":
      return {
        id: IGNITE_CHAIN_OBJECTIVE_ID,
        label: `${IGNITE_CHAIN_LABEL}: delayed relay fire`,
        metric: "maxChainCombo",
        minimum: igniteChainMinimum(mission)
      };
  }
}

export function projectileObjectivesForLevel(level: MayhemFeatureLevel): LevelProjectileObjectives {
  return {
    levelId: level.id,
    objectives: projectileObjectivesByProjectileForLevel(level.id, level.mission)
  };
}

export function projectileObjectiveForLevel(
  levels: readonly MayhemFeatureLevel[],
  levelId: string,
  projectileId: ProjectileId
): ProjectileObjective | null {
  const level = levels.find((candidate) => candidate.id === levelId);
  return level ? projectileObjectiveForRun(level.id, projectileId, level.mission) : null;
}

export function projectileObjectivesForLevels(levels: readonly MayhemFeatureLevel[]): LevelProjectileObjectives[] {
  return levels.map((level) => projectileObjectivesForLevel(level));
}

export function projectileObjectiveForRun(
  levelId: string,
  projectileId: ProjectileId,
  mission: ArcadeMissionFields
): ProjectileObjective {
  const base = projectileObjectiveFor(projectileId, mission);
  const override = DISTRICT_PROJECTILE_OBJECTIVES[levelId]?.[projectileId];
  if (!override) {
    return {
      ...base,
      id: `${levelId}-${base.id}`
    };
  }
  const minimum =
    override.minimum ??
    (typeof base.minimum === "number"
      ? Math.round(base.minimum * (override.minimumMultiplier ?? 1))
      : undefined);
  return {
    ...base,
    id: `${levelId}-${override.idSuffix}`,
    label: override.label,
    metric: override.metric ?? base.metric,
    minimum,
    projectileIds: override.projectileIds ?? base.projectileIds
  };
}

export function mayhemContractForRun(
  levelId: string,
  mission: ArcadeMissionFields,
  projectileId: ProjectileId,
  variant: RunVariant
): MayhemContract {
  const projectileObjective = projectileObjectiveForRun(levelId, projectileId, mission);
  const districtMetric = districtContractMetric(variant, projectileId);
  const districtMinimum = districtContractMinimum(mission, districtMetric, variant.contractMultiplier);
  const objectives: ArcadeContractObjective[] = [
    {
      id: projectileObjective.id,
      label: projectileObjective.label,
      metric: projectileObjective.metric,
      minimum: projectileObjective.minimum,
      projectileIds: projectileObjective.projectileIds
    },
    {
      id: `${variant.id}-district-contract`,
      label: `District contract: ${variant.label}`,
      metric: districtMetric,
      minimum: districtMinimum
    }
  ];
  return {
    id: `${levelId}:${variant.id}:${projectileId}`,
    label: `${variant.label} Contract`,
    summary: metricContractCopy(districtMetric, districtMinimum),
    objectives
  };
}

export function runFeedbackForScore(options: {
  score: ScoreBreakdown;
  mission: ArcadeMissionFields;
  variant: RunVariant;
  contract: MayhemContract | null;
  contractResult: ArcadeContractResult | null;
  topSources: RunScoreSource[];
  replayMoment: RunReplayMoment | null;
  replayTimeline?: RunReplayMoment[];
  projectileId: ProjectileId;
  levelId?: string;
}): RunFeedback {
  const replayTimeline = options.replayTimeline ?? (options.replayMoment ? [options.replayMoment] : []);
  return {
    topSources: options.topSources,
    nearMisses: nearMissHints(options.score, options.mission, options.contractResult, options.projectileId, options.variant),
    replayMoment: options.replayMoment,
    replayTimeline,
    projectileObjective: projectileObjectiveForRun(options.levelId ?? "generic", options.projectileId, options.mission),
    variant: options.variant,
    contract: options.contract,
    contractResult: options.contractResult
  };
}

export function summarizeScoreSources(events: readonly ScoreEvent[], limit = 3): RunScoreSource[] {
  const sources = new Map<string, RunScoreSource>();
  for (const event of events) {
    if (event.points <= 0) {
      continue;
    }
    const label = scoreSourceKey(event);
    const current = sources.get(label);
    if (current) {
      current.points += event.points;
    } else {
      sources.set(label, {
        kind: event.kind,
        label,
        points: event.points
      });
    }
  }
  return [...sources.values()]
    .sort((a, b) => b.points - a.points || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, limit));
}

export function replayMomentFromEvents(events: readonly ScoreEvent[]): RunReplayMoment | null {
  return replayTimelineFromEvents(events, 1)[0] ?? null;
}

export function replayTimelineFromEvents(events: readonly ScoreEvent[], limit = 4): RunReplayMoment[] {
  const bestByKind = new Map<RunReplayMomentKind, ScoreEvent>();
  for (const event of events) {
    if (event.points <= 0) {
      continue;
    }
    const kind = replayMomentKind(event);
    const current = bestByKind.get(kind);
    if (!current || replayMomentWeight(event) > replayMomentWeight(current)) {
      bestByKind.set(kind, event);
    }
  }
  return [...bestByKind.entries()]
    .sort((a, b) => replayMomentWeight(b[1]) - replayMomentWeight(a[1]))
    .slice(0, Math.max(0, limit))
    .map(([kind, event], index) => replayMomentFromEvent(event, kind, index));
}

export function scoreSourceKey(event: ScoreEvent): string {
  if (event.kind === "chain") {
    return "Secondary chain";
  }
  if (event.kind === "target") {
    return "Target damage";
  }
  return event.label
    .toLowerCase()
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function replayMomentWeight(event: ScoreEvent): number {
  const kind = replayMomentKind(event);
  const bossBonus = kind === "boss" ? 220 : 0;
  const ignitionBonus = kind === "ignition" ? 180 : 0;
  return event.points + (event.combo ?? 0) * 18 + (event.kind === "chain" ? 120 : 0) + bossBonus + ignitionBonus;
}

function replayMomentFromEvent(event: ScoreEvent, kind: RunReplayMomentKind, index: number): RunReplayMoment {
  return {
    id: `${kind}-${index}-${Math.max(0, Math.round(event.points))}`,
    kind,
    label: event.combo && event.combo >= 2 ? `${event.label} combo` : event.label,
    points: event.points,
    position: {
      x: event.position.x,
      y: event.position.y,
      z: event.position.z
    }
  };
}

function replayMomentKind(event: ScoreEvent): RunReplayMomentKind {
  const label = event.label.toLowerCase();
  if (label.includes("boss") || label.includes("weak point") || label.includes("weak-point")) {
    return "boss";
  }
  if (label.includes(IGNITE_CHAIN_LABEL.toLowerCase()) || label.includes("ignite") || label.includes("ignition")) {
    return "ignition";
  }
  if (event.kind === "chain" || (event.combo ?? 0) >= 4) {
    return "chain";
  }
  if (event.kind === "target") {
    return "impact";
  }
  return "source";
}

export function chainMilestoneForCombo(combo: number): { combo: number; label: string } | null {
  if (combo >= 150) {
    return { combo: 150, label: "Citywide cascade" };
  }
  if (combo >= 100) {
    return { combo: 100, label: "Mayhem surge" };
  }
  if (combo >= 50) {
    return { combo: 50, label: "Chain milestone" };
  }
  if (combo >= 25) {
    return { combo: 25, label: "Chain warmup" };
  }
  return null;
}

function districtContractMetric(variant: RunVariant, projectileId: ProjectileId): ArcadeContractObjective["metric"] {
  if (projectileId === "ignite") {
    return "chainReactionBonus";
  }
  if (variant.id === "heavy-salvage" || projectileId === "gravity") {
    return "targetDamage";
  }
  if (variant.id === "glass-rush" || projectileId === "pulse") {
    return "collateralChaos";
  }
  return "chainReactionCount";
}

function districtContractMinimum(
  mission: ArcadeMissionFields,
  metric: ArcadeContractObjective["metric"],
  multiplier: number
): number {
  switch (metric) {
    case "chainReactionCount":
      return Math.round(Math.max(24, mission.bonusThreshold.minimum * 0.72) * multiplier);
    case "collateralChaos":
      return Math.round(Math.max(16_000, mission.scoreThresholds.oneStar * 0.32) * multiplier);
    case "targetDamage":
      return Math.round(mission.targetDamageThreshold * 0.92 * multiplier);
    case "totalScore":
      return Math.round(mission.scoreThresholds.twoStar * 0.82 * multiplier);
    case "chainReactionBonus":
      return Math.round(mission.scoreThresholds.oneStar * 0.36 * multiplier);
    case "remainingDebrisMotion":
      return Math.round(1_200 * multiplier);
    case "maxChainCombo":
      return Math.round(18 * multiplier);
    case "projectile":
      return 1;
  }
}

function metricContractCopy(metric: ArcadeContractObjective["metric"], minimum: number): string {
  switch (metric) {
    case "chainReactionCount":
      return `${minimum}+ secondary hits`;
    case "collateralChaos":
      return `${minimum.toLocaleString("en-US")}+ collateral chaos`;
    case "targetDamage":
      return `${minimum.toLocaleString("en-US")}+ object damage`;
    case "totalScore":
      return `${minimum.toLocaleString("en-US")}+ Mayhem`;
    case "chainReactionBonus":
      return `${minimum.toLocaleString("en-US")}+ chain score`;
    case "remainingDebrisMotion":
      return `${minimum.toLocaleString("en-US")}+ motion bonus`;
    case "maxChainCombo":
      return `x${minimum}+ max chain`;
    case "projectile":
      return "specific payload";
  }
}

function nearMissHints(
  score: ScoreBreakdown,
  mission: ArcadeMissionFields,
  contractResult: ArcadeContractResult | null,
  projectileId: ProjectileId,
  variant: RunVariant
): string[] {
  const hints: string[] = [];
  if (projectileId === "ignite" && score.maxChainCombo < igniteChainMinimum(mission)) {
    hints.push(`Ignition: arm hazards; wait for delayed ${IGNITE_CHAIN_LABEL}.`);
  }
  if (score.totalScore < mission.scoreThresholds.twoStar) {
    hints.push(`Need ${formatScore(mission.scoreThresholds.twoStar - score.totalScore)} Mayhem: ${variantRetryRoute(variant, projectileId)}.`);
  }
  if (score.targetDamage < mission.targetDamageThreshold) {
    hints.push(`Need ${formatScore(mission.targetDamageThreshold - score.targetDamage)} damage: hit target core first.`);
  }
  if (score[mission.bonusThreshold.metric] < mission.bonusThreshold.minimum) {
    hints.push(`Bonus: ${metricRetryPlan(mission.bonusThreshold.metric)} +${formatScore(mission.bonusThreshold.minimum - score[mission.bonusThreshold.metric])}.`);
  }
  for (const objective of contractResult?.objectives ?? []) {
    if (!objective.completed && typeof objective.value === "number" && typeof objective.target === "number") {
      hints.push(`${objective.label}: +${formatScore(objective.target - objective.value)} via ${variantRetryRoute(variant, projectileId)}.`);
      break;
    }
  }
  return hints.slice(0, 3);
}

function loadDailyResults(storage: DailyResultStorage | null): DailyResultsState {
  if (!storage) {
    return createEmptyDailyResults();
  }
  try {
    const raw = storage.getItem(DAILY_RESULTS_STORAGE_KEY);
    if (!raw) {
      return createEmptyDailyResults();
    }
    return normalizeDailyResults(JSON.parse(raw));
  } catch {
    return createEmptyDailyResults();
  }
}

function saveDailyResults(state: DailyResultsState, storage: DailyResultStorage | null): boolean {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(DAILY_RESULTS_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function normalizeDailyResults(value: unknown): DailyResultsState {
  if (!value || typeof value !== "object") {
    return createEmptyDailyResults();
  }
  const raw = value as Partial<DailyResultsState>;
  const entries: Record<string, DailyResultEntry> = {};
  if (raw.entries && typeof raw.entries === "object") {
    for (const [key, entry] of Object.entries(raw.entries)) {
      const normalized = normalizeDailyResultEntry(entry);
      if (normalized) {
        entries[key] = normalized;
      }
    }
  }
  return {
    version: DAILY_RESULTS_VERSION,
    entries
  };
}

function normalizeDailyResultEntry(value: unknown): DailyResultEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Partial<DailyResultEntry>;
  if (
    typeof raw.dateKey !== "string" ||
    typeof raw.levelId !== "string" ||
    typeof raw.projectileId !== "string" ||
    typeof raw.contractId !== "string"
  ) {
    return null;
  }
  return {
    dateKey: raw.dateKey,
    levelId: raw.levelId,
    projectileId: raw.projectileId as ProjectileId,
    contractId: raw.contractId,
    attempts: clampWholeNumber(raw.attempts),
    bestScore: clampWholeNumber(raw.bestScore),
    bestStars: normalizeStars(raw.bestStars),
    bestContractCompleted: Boolean(raw.bestContractCompleted),
    bestRating: typeof raw.bestRating === "string" ? raw.bestRating : ""
  };
}

function createEmptyDailyResults(): DailyResultsState {
  return {
    version: DAILY_RESULTS_VERSION,
    entries: {}
  };
}

function createEmptyDailyResult(contract: DailyContractDefinition): DailyResultEntry {
  return {
    dateKey: contract.dateKey,
    levelId: contract.levelId,
    projectileId: contract.projectileId,
    contractId: contract.contract.id,
    attempts: 0,
    bestScore: 0,
    bestStars: 0,
    bestContractCompleted: false,
    bestRating: ""
  };
}

function dailyResultKey(contract: DailyContractDefinition): string {
  return `${contract.dateKey}:${contract.levelId}:${contract.projectileId}:${contract.contract.id}`;
}

function maxStars(first: ArcadeStars, second: ArcadeStars): ArcadeStars {
  return normalizeStars(Math.max(first, second));
}

function projectileObjectivesByProjectileForLevel(levelId: string, mission: ArcadeMissionFields): ProjectileObjectivesByProjectile {
  return Object.fromEntries(
    LATE_GAME_PROJECTILE_ORDER.map((projectileId) => [projectileId, projectileObjectiveForRun(levelId, projectileId, mission)])
  ) as ProjectileObjectivesByProjectile;
}

function weeklyProjectileOrder(seed: number, unlockedLevelCount: number): readonly ProjectileId[] {
  const unlockedProjectiles = projectileOrderForUnlockedLevels(unlockedLevelCount);
  const offset = seed % unlockedProjectiles.length;
  return unlockedProjectiles.map((_projectileId, index) => unlockedProjectiles[(index + offset) % unlockedProjectiles.length]);
}

function normalizeStars(value: unknown): ArcadeStars {
  const stars = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  if (stars >= 3) {
    return 3;
  }
  if (stars >= 2) {
    return 2;
  }
  if (stars >= 1) {
    return 1;
  }
  return 0;
}

function clampWholeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function variantRetryRoute(variant: RunVariant, projectileId: ProjectileId): string {
  if (projectileId === "scatter") {
    return "seed Frag clusters through vehicles and relays";
  }
  if (projectileId === "pulse") {
    return "land the Impulse Orb between dense blocks and traffic";
  }
  if (projectileId === "gravity") {
    return "line the Heavy shot through the thickest structure row";
  }
  if (projectileId === "ignite") {
    return "arm a hazard lane with Ignite, then let the delayed relay fire spread";
  }
  if (variant.id === "rush-hour") {
    return "hit the busiest lane before traffic clears";
  }
  if (variant.id === "relay-storm") {
    return "open on a transformer or relay tower";
  }
  if (variant.id === "heavy-salvage") {
    return "aim deeper into the main target mass";
  }
  if (variant.id === "glass-rush") {
    return "drive the blast across brittle glass clusters";
  }
  return "start from a volatile setpiece";
}

function metricRetryPlan(metric: ArcadeContractObjective["metric"]): string {
  switch (metric) {
    case "chainReactionCount":
      return "secondary hits from vehicles, relays, and loose cargo";
    case "collateralChaos":
      return "collateral chaos through traffic lanes and fragile props";
    case "targetDamage":
      return "direct object damage on the named target";
    case "totalScore":
      return "a higher-scoring opening route";
    case "chainReactionBonus":
      return "chain bonus by keeping impacts close together";
    case "remainingDebrisMotion":
      return "more moving debris before the score locks";
    case "maxChainCombo":
      return "one longer unbroken combo";
    case "projectile":
      return "the required payload";
  }
}

function igniteChainMinimum(mission: ArcadeMissionFields): number {
  if (mission.bonusThreshold.metric === "maxChainCombo") {
    return Math.max(18, Math.round(mission.bonusThreshold.minimum * 0.86));
  }
  if (mission.bonusThreshold.metric === "chainReactionCount") {
    return Math.max(18, Math.round(mission.bonusThreshold.minimum * 0.12));
  }
  return Math.max(20, Math.round(mission.scoreThresholds.twoStar / 14_500));
}

function formatScore(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function getLocalStorage(): DailyResultStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
