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
      twoStarScore: 1500,
      threeStarScore: 2000,
      threeStarBonus: { metric: "chainReactionCount", minimum: 3 }
    }
  },
  {
    id: "bravo",
    title: "Bravo",
    thresholds: {
      missionScore: 1200,
      twoStarScore: 1700,
      threeStarScore: 2300,
      threeStarBonus: { metric: "targetDamage", minimum: 900 }
    }
  },
  {
    id: "charlie",
    title: "Charlie",
    thresholds: {
      missionScore: 1400,
      twoStarScore: 1900,
      threeStarScore: 2600,
    }
  }
];

describe("Arcade result evaluation", () => {
  test("assigns 0, 1, 2, and 3 stars from score and bonus thresholds", () => {
    expect(evaluateArcadeResult(LEVELS[0], score({ totalScore: 999 })).stars).toBe(0);
    expect(evaluateArcadeResult(LEVELS[0], score({ totalScore: 1000 })).stars).toBe(1);
    expect(evaluateArcadeResult(LEVELS[0], score({ totalScore: 1500 })).stars).toBe(2);

    expect(
      evaluateArcadeResult(
        LEVELS[0],
        score({ totalScore: 2000, chainReactionCount: 3 })
      )
    ).toMatchObject({
      completed: true,
      stars: 3,
      bonusCompleted: true
    });
  });

  test("bonus gates the third star without blocking lower stars", () => {
    expect(
      evaluateArcadeResult(LEVELS[0], score({ totalScore: 5000 }))
    ).toMatchObject({
      completed: true,
      stars: 2
    });

    expect(
      evaluateArcadeResult(
        LEVELS[0],
        score({ totalScore: 5000, chainReactionCount: 3 })
      )
    ).toMatchObject({
      completed: true,
      stars: 3
    });
  });

  test("evaluates mayhem contract objectives without changing star thresholds", () => {
    const result = evaluateArcadeResult(
      {
        ...LEVELS[0],
        contractObjectives: [
          { id: "score-contract", label: "Score contract", metric: "totalScore", minimum: 1800 },
          { id: "payload-contract", label: "Payload contract", metric: "projectile", projectileIds: ["gravity"] }
        ]
      },
      score({ totalScore: 1900 }),
      { projectileId: "gravity" }
    );

    expect(result).toMatchObject({
      stars: 2,
      contract: {
        completed: true,
        objectives: [
          { id: "score-contract", completed: true, value: 1900, target: 1800 },
          { id: "payload-contract", completed: true, value: "gravity", target: "gravity" }
        ]
      }
    });
  });

  test("accepts run-context contracts for projectile-specific variants", () => {
    const result = recordArcadeRun(
      createInitialArcadeProgress(LEVELS),
      LEVELS,
      "alpha",
      score({ totalScore: 2100, chainReactionCount: 3 }),
      {
        projectileId: "scatter",
        contractObjectives: [
          { id: "scatter-only", label: "Scatter contract", metric: "projectile", projectileIds: ["scatter"] },
          { id: "chain-contract", label: "Chain contract", metric: "chainReactionCount", minimum: 4 }
        ]
      }
    ).result;

    expect(result).toMatchObject({
      stars: 3,
      contract: {
        completed: false,
        objectives: [
          { id: "scatter-only", completed: true },
          { id: "chain-contract", completed: false, value: 3, target: 4 }
        ]
      }
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
      score({ totalScore: 2100, chainReactionCount: 3 })
    ).progress;
    const second = recordArcadeRun(first, LEVELS, "alpha", score({ totalScore: 1200 })).progress;

    expect(second.levels.alpha).toEqual({
      attempts: 2,
      bestScore: 2100,
      stars: 3,
      completed: true
    });
    expect(second.totalStars).toBe(3);
  });

  test("unlocks the next highest level only after earning two stars", () => {
    const initial = createInitialArcadeProgress(LEVELS);
    const failed = recordArcadeRun(initial, LEVELS, "alpha", score({ totalScore: 999 })).progress;
    const alphaOneStar = recordArcadeRun(failed, LEVELS, "alpha", score({ totalScore: 1000 })).progress;
    const alphaComplete = recordArcadeRun(alphaOneStar, LEVELS, "alpha", score({ totalScore: 1500 })).progress;
    const bravoComplete = recordArcadeRun(alphaComplete, LEVELS, "bravo", score({ totalScore: 1700 })).progress;

    expect(initial.highestUnlockedLevel).toBe(0);
    expect(failed.highestUnlockedLevel).toBe(0);
    expect(alphaOneStar.highestUnlockedLevel).toBe(0);
    expect(alphaOneStar.levels.alpha).toMatchObject({ stars: 1, completed: false });
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
      score({ totalScore: 2000, chainReactionCount: 3 })
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

  test("normalizes old completed one-star saves back to locked progression", () => {
    const storage = memoryStorage();
    storage.setItem(
      ARCADE_PROGRESS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        highestUnlockedLevel: 2,
        totalStars: 1,
        levels: {
          alpha: { attempts: 1, bestScore: 1000, stars: 1, completed: true },
          bravo: { attempts: 0, bestScore: 0, stars: 0, completed: false },
          charlie: { attempts: 0, bestScore: 0, stars: 0, completed: false }
        }
      })
    );

    expect(loadArcadeProgress(LEVELS, storage)).toMatchObject({
      highestUnlockedLevel: 0,
      levels: {
        alpha: { stars: 1, completed: false }
      }
    });
  });
});

function score(overrides: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    targetDamage: 0,
    collateralChaos: 0,
    chainReactionBonus: 0,
    remainingDebrisMotion: 0,
    mayhemRating: "SPARK SHOW",
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
