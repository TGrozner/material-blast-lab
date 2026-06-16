import { describe, expect, test } from "vitest";
import type { ScoreBreakdown } from "../../src/scoring";
import {
  ARCADE_PROGRESS_STORAGE_KEY,
  type ArcadeLevelDefinition,
  type ArcadeStorage,
  createInitialArcadeProgress,
  evaluateArcadeResult,
  loadArcadeProgress,
  recordArcadeRun,
  saveArcadeProgress
} from "../../src/arcade";

const LEVELS: ArcadeLevelDefinition[] = [
  {
    id: "alpha",
    title: "Alpha",
    thresholds: {
      missionScore: 1000,
      missionMaxProtectedPenalty: 300,
      twoStarScore: 1500,
      twoStarMaxProtectedPenalty: 150,
      threeStarScore: 2000,
      threeStarMaxProtectedPenalty: 75,
      threeStarBonus: { metric: "chainReactionCount", minimum: 3 }
    }
  },
  {
    id: "bravo",
    title: "Bravo",
    thresholds: {
      missionScore: 1200,
      missionMaxProtectedPenalty: 250,
      twoStarScore: 1700,
      twoStarMaxProtectedPenalty: 100,
      threeStarScore: 2300,
      threeStarMaxProtectedPenalty: 40,
      threeStarBonus: { metric: "targetDamage", minimum: 900 }
    }
  },
  {
    id: "charlie",
    title: "Charlie",
    thresholds: {
      missionScore: 1400,
      missionMaxProtectedPenalty: 240,
      twoStarScore: 1900,
      twoStarMaxProtectedPenalty: 120,
      threeStarScore: 2600,
      threeStarMaxProtectedPenalty: 50
    }
  }
];

describe("Arcade result evaluation", () => {
  test("assigns 0, 1, 2, and 3 stars from score, protected penalty, and bonus thresholds", () => {
    expect(evaluateArcadeResult(LEVELS[0], score({ totalScore: 999, protectedPenalty: 0 })).stars).toBe(0);
    expect(evaluateArcadeResult(LEVELS[0], score({ totalScore: 1000, protectedPenalty: 300 })).stars).toBe(1);
    expect(evaluateArcadeResult(LEVELS[0], score({ totalScore: 1500, protectedPenalty: 150 })).stars).toBe(2);

    expect(
      evaluateArcadeResult(
        LEVELS[0],
        score({ totalScore: 2000, protectedPenalty: 75, chainReactionCount: 3 })
      )
    ).toMatchObject({
      completed: true,
      stars: 3,
      bonusCompleted: true
    });
  });

  test("protected penalty can fail a high-scoring run or block higher stars", () => {
    expect(
      evaluateArcadeResult(LEVELS[0], score({ totalScore: 5000, protectedPenalty: 301 }))
    ).toMatchObject({
      completed: false,
      stars: 0
    });

    expect(
      evaluateArcadeResult(
        LEVELS[0],
        score({ totalScore: 5000, protectedPenalty: 151, chainReactionCount: 3 })
      )
    ).toMatchObject({
      completed: true,
      stars: 1
    });
  });
});

describe("Arcade progress", () => {
  test("records attempts, keeps best score, and never downgrades stars", () => {
    const initial = createInitialArcadeProgress(LEVELS);
    const first = recordArcadeRun(
      initial,
      LEVELS,
      "alpha",
      score({ totalScore: 2100, protectedPenalty: 50, chainReactionCount: 3 })
    ).progress;
    const second = recordArcadeRun(first, LEVELS, "alpha", score({ totalScore: 1200, protectedPenalty: 100 })).progress;

    expect(second.levels.alpha).toEqual({
      attempts: 2,
      bestScore: 2100,
      stars: 3,
      completed: true
    });
    expect(second.totalStars).toBe(3);
  });

  test("unlocks the next highest level only after mission completion", () => {
    const initial = createInitialArcadeProgress(LEVELS);
    const failed = recordArcadeRun(initial, LEVELS, "alpha", score({ totalScore: 999 })).progress;
    const alphaComplete = recordArcadeRun(failed, LEVELS, "alpha", score({ totalScore: 1000 })).progress;
    const bravoComplete = recordArcadeRun(alphaComplete, LEVELS, "bravo", score({ totalScore: 1200 })).progress;

    expect(initial.highestUnlockedLevel).toBe(0);
    expect(failed.highestUnlockedLevel).toBe(0);
    expect(alphaComplete.highestUnlockedLevel).toBe(1);
    expect(bravoComplete.highestUnlockedLevel).toBe(2);
  });
});

describe("Arcade progress storage", () => {
  test("loads and saves progress through localStorage-compatible storage", () => {
    const storage = memoryStorage();
    const progress = recordArcadeRun(
      createInitialArcadeProgress(LEVELS),
      LEVELS,
      "alpha",
      score({ totalScore: 2000, protectedPenalty: 75, chainReactionCount: 3 })
    ).progress;

    expect(saveArcadeProgress(progress, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(ARCADE_PROGRESS_STORAGE_KEY) ?? "{}")).toMatchObject({
      highestUnlockedLevel: 1,
      totalStars: 3
    });
    expect(loadArcadeProgress(LEVELS, storage)).toEqual(progress);
  });

  test("falls back safely when storage is unavailable or throws", () => {
    const throwingStorage: ArcadeStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      }
    };

    expect(loadArcadeProgress(LEVELS, null)).toEqual(createInitialArcadeProgress(LEVELS));
    expect(loadArcadeProgress(LEVELS, throwingStorage)).toEqual(createInitialArcadeProgress(LEVELS));
    expect(saveArcadeProgress(createInitialArcadeProgress(LEVELS), null)).toBe(false);
    expect(saveArcadeProgress(createInitialArcadeProgress(LEVELS), throwingStorage)).toBe(false);
  });
});

function score(overrides: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    targetDamage: 0,
    cityChaos: 0,
    contaminationPurge: 0,
    chainReactionBonus: 0,
    protectedPenalty: 0,
    remainingDebrisMotion: 0,
    containmentRating: "CONTAINED",
    totalScore: 0,
    shotName: "Test Shot",
    chainReactionCount: 0,
    maxChainCombo: 0,
    ...overrides
  };
}

function memoryStorage(): ArcadeStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}
