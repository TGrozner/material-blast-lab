import { describe, expect, test } from "vitest";
import type { ArcadeMissionFields } from "../../src/levels";
import {
  BEST_SHOT_GHOST_STORAGE_KEY,
  loadBestShotGhost,
  mayhemContractForRun,
  runVariantForSeed,
  saveBestShotGhost
} from "../../src/mayhemFeatures";

const MISSION: ArcadeMissionFields = {
  arc: "object-destruction",
  order: 1,
  targetZone: "hazard-core",
  scoreThresholds: {
    oneStar: 40_000,
    twoStar: 90_000,
    threeStar: 200_000
  },
  targetDamageThreshold: 10_000,
  bonusThreshold: { metric: "chainReactionCount", minimum: 100 },
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

  test("persists only the best shot ghost per level", () => {
    const storage = memoryStorage();
    expect(
      saveBestShotGhost(
        {
          version: 1,
          levelId: "hazard-junction",
          projectileId: "slug",
          score: 42_000,
          variantLabel: "Rush Hour",
          aimPoint: { x: 1, y: 0.16, z: 2 },
          createdAt: 1
        },
        storage
      )
    ).toBe(true);
    expect(
      saveBestShotGhost(
        {
          version: 1,
          levelId: "hazard-junction",
          projectileId: "gravity",
          score: 12_000,
          variantLabel: "Relay Storm",
          aimPoint: { x: 3, y: 0.16, z: 4 },
          createdAt: 2
        },
        storage
      )
    ).toBe(true);

    expect(loadBestShotGhost("hazard-junction", storage)).toMatchObject({
      projectileId: "slug",
      score: 42_000,
      variantLabel: "Rush Hour"
    });
    expect(JSON.parse(storage.getItem(BEST_SHOT_GHOST_STORAGE_KEY) ?? "{}")).toHaveProperty("hazard-junction");
  });
});

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    }
  };
}
