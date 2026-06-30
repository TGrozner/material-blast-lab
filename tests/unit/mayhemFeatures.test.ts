import { describe, expect, test } from "vitest";
import * as THREE from "three";
import type { ArcadeMissionFields } from "../../src/levels";
import type { ScoreBreakdown, ScoreEvent } from "../../src/scoring";
import {
  dailyContractForDate,
  mayhemContractForRun,
  replayMomentFromEvents,
  runFeedbackForScore,
  runVariantForSeed,
  summarizeScoreSources
} from "../../src/mayhemFeatures";

const MISSION: ArcadeMissionFields = {
  arc: "object-destruction",
  order: 1,
  targetZone: "hazard-core",
  scoreThresholds: {
    oneStar: 75_000,
    twoStar: 145_000,
    threeStar: 220_000
  },
  targetDamageThreshold: 30_000,
  bonusThreshold: { metric: "chainReactionCount", minimum: 180 },
  bonusObjective: "Sustain secondary hits.",
  briefingHint: "Aim at named setpieces."
};

describe("mayhem feature helpers", () => {
  test("builds deterministic variant contracts for the current projectile", () => {
    const variant = runVariantForSeed("hazard-junction", 12345);
    const contract = mayhemContractForRun("hazard-junction", MISSION, "scatter", variant);

    expect(runVariantForSeed("hazard-junction", 12345)).toEqual(variant);
    expect(contract.label).toContain(variant.label);
    expect(contract.objectives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "scatter-secondary-hits", metric: "chainReactionCount" }),
        expect.objectContaining({ id: `${variant.id}-district-contract` })
      ])
    );
  });

  test("builds a deterministic daily contract from the UTC date", () => {
    const levels = [
      { id: "hazard-junction", mission: MISSION },
      { id: "breaker-yard", mission: { ...MISSION, order: 2, targetZone: "breaker-spine" } }
    ];
    const first = dailyContractForDate(levels, new Date("2026-06-30T22:30:00.000Z"));
    const second = dailyContractForDate(levels, new Date("2026-06-30T01:15:00.000Z"));
    const nextDay = dailyContractForDate(levels, new Date("2026-07-01T01:15:00.000Z"));

    expect(first).toEqual(second);
    expect(first?.dateKey).toBe("2026-06-30");
    expect(first?.contract.objectives).toHaveLength(2);
    expect(nextDay?.dateKey).toBe("2026-07-01");
  });

  test("summarizes score sources and chooses a replay moment", () => {
    const events: ScoreEvent[] = [
      event("target", "TARGET BREAK", 420),
      event("target", "TARGET HIT", 180),
      event("chain", "CHAIN x8", 260, 8),
      event("chaos", "GLASS POP", 95)
    ];

    expect(summarizeScoreSources(events, 2)).toEqual([
      { kind: "target", label: "Target damage", points: 600 },
      { kind: "chain", label: "Secondary chain", points: 260 }
    ]);
    expect(replayMomentFromEvents(events)).toEqual({
      label: "CHAIN x8 combo",
      points: 260
    });
  });

  test("returns useful retry feedback for near misses", () => {
    const variant = runVariantForSeed("hazard-junction", 12345);
    const contract = mayhemContractForRun("hazard-junction", MISSION, "pulse", variant);
    const feedback = runFeedbackForScore({
      score: score({ totalScore: 130_000, targetDamage: 24_000, chainReactionCount: 120 }),
      mission: MISSION,
      variant,
      contract,
      contractResult: {
        completed: false,
        objectives: [{ id: "district", label: "District contract", completed: false, value: 120, target: 140 }]
      },
      topSources: [{ kind: "chain", label: "Secondary chain", points: 22_000 }],
      replayMoment: { label: "CHAIN x120 combo", points: 900 },
      projectileId: "pulse"
    });

    expect(feedback.nearMisses).toEqual(
      expect.arrayContaining([
        expect.stringContaining("more Mayhem"),
        expect.stringContaining("object damage short"),
        expect.stringContaining("Bonus objective short")
      ])
    );
    expect(feedback.projectileObjective?.id).toBe("pulse-chaos-wave");
  });
});

function event(kind: ScoreEvent["kind"], label: string, points: number, combo?: number): ScoreEvent {
  return {
    kind,
    label,
    points,
    combo,
    position: new THREE.Vector3()
  };
}

function score(overrides: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    targetDamage: 0,
    collateralChaos: 0,
    chainReactionBonus: 0,
    remainingDebrisMotion: 0,
    weakPointBreakCount: 0,
    bossBreakCount: 0,
    damageHotspots: [],
    mayhemRating: "SPARK SHOW",
    totalScore: 0,
    shotName: "Test Shot",
    chainReactionCount: 0,
    maxChainCombo: 0,
    ...overrides
  };
}
