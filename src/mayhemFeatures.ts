import type { ArcadeContractObjective, ArcadeContractResult } from "./arcade";
import type { ArcadeMissionFields } from "./levels";
import type { ProjectileId } from "./projectile";
import type { ScoreBreakdown, ScoreEvent } from "./scoring";

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

export interface RunReplayMoment {
  label: string;
  points: number;
}

export interface RunFeedback {
  topSources: RunScoreSource[];
  nearMisses: string[];
  replayMoment: RunReplayMoment | null;
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

interface DailyContractLevel {
  id: string;
  mission: ArcadeMissionFields;
}

const DAILY_PROJECTILE_ORDER: readonly ProjectileId[] = ["slug", "scatter", "pulse", "gravity"];

const RUN_VARIANTS: RunVariant[] = [
  {
    id: "rush-hour",
    label: "Rush Hour",
    description: "Moving vehicles and fast secondary hits are worth chasing.",
    contractMultiplier: 1.04
  },
  {
    id: "relay-storm",
    label: "Relay Storm",
    description: "Secondary chains are the clean contract path.",
    contractMultiplier: 1.08
  },
  {
    id: "heavy-salvage",
    label: "Heavy Salvage",
    description: "Object damage matters more than raw splash.",
    contractMultiplier: 0.96
  },
  {
    id: "glass-rush",
    label: "Glass Rush",
    description: "Fast brittle hits turn into the highest highlight moments.",
    contractMultiplier: 1
  }
];

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
  levels: readonly DailyContractLevel[],
  date = new Date()
): DailyContractDefinition | null {
  if (levels.length === 0) {
    return null;
  }
  const dateKey = dailyDateKey(date);
  const seed = hashString(`downtown-daily:${dateKey}`);
  const levelIndex = seed % levels.length;
  const level = levels[levelIndex];
  const projectileId = DAILY_PROJECTILE_ORDER[Math.floor(seed / Math.max(1, levels.length)) % DAILY_PROJECTILE_ORDER.length];
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

export function projectileObjectiveFor(projectileId: ProjectileId, mission: ArcadeMissionFields): ProjectileObjective {
  switch (projectileId) {
    case "slug":
      return {
        id: "slug-core-hit",
        label: "Slug objective: break the target core",
        metric: "targetDamage",
        minimum: Math.round(mission.targetDamageThreshold * 0.9)
      };
    case "scatter":
      return {
        id: "scatter-secondary-hits",
        label: "Scatter objective: flood secondary hits",
        metric: "chainReactionCount",
        minimum: Math.max(30, Math.round(mission.bonusThreshold.minimum * 0.52))
      };
    case "pulse":
      return {
        id: "pulse-chaos-wave",
        label: "Pulse objective: spread collateral chaos",
        metric: "collateralChaos",
        minimum: Math.max(18_000, Math.round(mission.scoreThresholds.oneStar * 0.34))
      };
    case "gravity":
      return {
        id: "gravity-pierce-line",
        label: "Heavy objective: punch through dense structures",
        metric: "totalScore",
        minimum: Math.round(mission.scoreThresholds.twoStar * 0.86)
      };
    case "ignite":
      return {
        id: "ignite-relay-fire",
        label: "Ignite objective: light a chain reaction",
        metric: "chainReactionCount",
        minimum: Math.max(45, Math.round(mission.bonusThreshold.minimum * 0.62))
      };
  }
}

export function mayhemContractForRun(
  levelId: string,
  mission: ArcadeMissionFields,
  projectileId: ProjectileId,
  variant: RunVariant
): MayhemContract {
  const projectileObjective = projectileObjectiveFor(projectileId, mission);
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
  projectileId: ProjectileId;
}): RunFeedback {
  return {
    topSources: options.topSources,
    nearMisses: nearMissHints(options.score, options.mission, options.contractResult),
    replayMoment: options.replayMoment,
    projectileObjective: projectileObjectiveFor(options.projectileId, options.mission),
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
  let best: ScoreEvent | null = null;
  for (const event of events) {
    if (event.points <= 0) {
      continue;
    }
    if (!best || replayMomentWeight(event) > replayMomentWeight(best)) {
      best = event;
    }
  }
  if (!best) {
    return null;
  }
  return {
    label: best.combo && best.combo >= 2 ? `${best.label} combo` : best.label,
    points: best.points
  };
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
  return event.points + (event.combo ?? 0) * 18 + (event.kind === "chain" ? 120 : 0);
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
  contractResult: ArcadeContractResult | null
): string[] {
  const hints: string[] = [];
  if (score.totalScore < mission.scoreThresholds.twoStar) {
    hints.push(`Need ${(mission.scoreThresholds.twoStar - score.totalScore).toLocaleString("en-US")} more Mayhem for unlock.`);
  }
  if (score.targetDamage < mission.targetDamageThreshold) {
    hints.push(`Aim closer to target structures: ${(mission.targetDamageThreshold - score.targetDamage).toLocaleString("en-US")} object damage short.`);
  }
  if (score[mission.bonusThreshold.metric] < mission.bonusThreshold.minimum) {
    hints.push(`Bonus objective short by ${(mission.bonusThreshold.minimum - score[mission.bonusThreshold.metric]).toLocaleString("en-US")}.`);
  }
  for (const objective of contractResult?.objectives ?? []) {
    if (!objective.completed && typeof objective.value === "number" && typeof objective.target === "number") {
      hints.push(`${objective.label}: ${(objective.target - objective.value).toLocaleString("en-US")} short.`);
      break;
    }
  }
  return hints.slice(0, 3);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}
