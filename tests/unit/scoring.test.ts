import { describe, expect, test } from "vitest";
import * as THREE from "three";
import type { ExplosionAffectedObject, ExplosionResult } from "../../src/destruction";
import type { PhysicsWorld } from "../../src/physics";
import { PROJECTILE_ORDER, PROJECTILES } from "../../src/projectile";
import { goldenEggMultiplierForRawScore, ShotScoreTracker } from "../../src/scoring";

describe("ShotScoreTracker", () => {
  test("exposes exactly four player projectile choices on keys one through four", () => {
    expect(PROJECTILE_ORDER).toEqual(["slug", "scatter", "pulse", "gravity"]);
    expect(PROJECTILE_ORDER.map((id) => PROJECTILES[id].key)).toEqual(["1", "2", "3", "4"]);
    expect(PROJECTILE_ORDER.map((id) => PROJECTILES[id].shortName)).toEqual(["Normal", "Frag", "Impulse", "Heavy"]);
    expect(PROJECTILE_ORDER.map((id) => PROJECTILES[id].role)).toEqual([
      "Classic fireball",
      "Shrapnel pops",
      "Cyan shockwave",
      "Purple crush"
    ]);
  });

  test("keeps Impulse stable while buffing Normal, Frag, and Heavy identities", () => {
    expect(PROJECTILES.pulse).toMatchObject({
      impulse: 74,
      blastRadius: 7.8,
      fractureBoost: 0.72,
      scoreModifier: 1.12
    });

    expect(PROJECTILES.slug).toMatchObject({
      impulse: 64,
      blastRadius: 3.75,
      fractureBoost: 1.38,
      scoreModifier: 1.08
    });
    expect(PROJECTILES.scatter).toMatchObject({
      impulse: 44,
      blastRadius: 3.05,
      fractureBoost: 0.98,
      scoreModifier: 1.22
    });
    expect(PROJECTILES.gravity).toMatchObject({
      baseRadius: 0.42,
      density: 10.2,
      speed: 34,
      scoreModifier: 1.25
    });
  });

  test("deduplicates object damage while emitting high-value collateral chaos events", () => {
    const tracker = new ShotScoreTracker();
    tracker.beginShot(PROJECTILES.slug);

    const events = tracker.addExplosion(
      result({
        materialChaos: 96,
        affectedObjects: [
          affectedObject({ id: 1, scoreRole: "target", weightedDamage: 100, fractured: true }),
          affectedObject({ id: 2, scoreRole: "neutral", weightedDamage: 40, fractured: false })
        ]
      })
    );

    expect(events.map((event) => [event.kind, event.label, event.points])).toEqual([
      ["target", "TARGET BREAK", 110],
      ["chaos", "COLLATERAL SURGE", 96]
    ]);

    expect(
      tracker.addExplosion(
        result({
          affectedObjects: [affectedObject({ id: 1, scoreRole: "target", weightedDamage: 80, fractured: true })]
        })
      )
    ).toEqual([]);

    expect(
      tracker.addExplosion(
        result({
          affectedObjects: [affectedObject({ id: 1, scoreRole: "target", weightedDamage: 130, fractured: true })]
        })
      ).map((event) => event.points)
    ).toEqual([33]);
  });

  test("applies chain combo scaling and projectile score modifiers", () => {
    const tracker = new ShotScoreTracker();
    tracker.beginShot(PROJECTILES.slug);

    expect(tracker.addChainReaction(100, new THREE.Vector3(0, 0, 0))[0]).toMatchObject({
      kind: "chain",
      label: "CHAIN START",
      points: 100,
      combo: 1
    });
    expect(tracker.addChainReaction(100, new THREE.Vector3(0, 0, 0))[0]).toMatchObject({
      label: "CHAIN x2",
      points: 112,
      combo: 2
    });
    expect(tracker.addChainReaction(100, new THREE.Vector3(0, 0, 0))[0]).toMatchObject({
      label: "CASCADE x3",
      points: 124,
      combo: 3
    });
    expect(tracker.addChainReaction(100, new THREE.Vector3(0, 0, 0))[0]).toMatchObject({
      label: "MAYHEM COMBO x4",
      points: 115,
      combo: 4
    });
    expect(tracker.addChainReaction(100, new THREE.Vector3(0, 0, 0), "POWER RELAY BLAST")[0]).toMatchObject({
      label: "POWER RELAY BLAST x5",
      points: 109,
      combo: 5
    });

    expect(tracker.finalize(fakePhysics([]))).toMatchObject({
      chainReactionBonus: 605,
      chainReactionCount: 5,
      maxChainCombo: 5,
      totalScore: 605
    });
  });

  test("scores remaining motion only for non-projectile bodies", () => {
    const tracker = new ShotScoreTracker();
    tracker.beginShot(PROJECTILES.slug);

    expect(
      tracker.finalize(
        fakePhysics([
          { category: "debris", scoreRole: "neutral", isDebris: true, velocity: { x: 10, y: 0, z: 0 } },
          { category: "structure", scoreRole: "target", isDebris: false, velocity: { x: 20, y: 0, z: 0 } },
          { category: "projectile", scoreRole: "neutral", isDebris: false, velocity: { x: 100, y: 0, z: 0 } },
          { category: "structure", scoreRole: "neutral", isDebris: false, velocity: { x: 100, y: 0, z: 0 } }
        ])
      )
    ).toMatchObject({
      remainingDebrisMotion: 202,
      totalScore: 202
    });
  });

  test("keeps mayhem ratings on the same scale as million-point score targets", () => {
    const tracker = new ShotScoreTracker();
    tracker.beginShot(PROJECTILES.slug);

    tracker.addExplosion(result({ materialChaos: 2_500_000 }));

    expect(tracker.finalize(fakePhysics([]))).toMatchObject({
      totalScore: 2_700_000,
      mayhemRating: "CITY WRECKER"
    });
  });

  test("caps oversized chain events while keeping combo readable", () => {
    const tracker = new ShotScoreTracker();
    tracker.beginShot(PROJECTILES.slug);

    expect(tracker.addChainReaction(50_000, new THREE.Vector3(0, 0, 0), "GAS LINE BLAST")[0]).toMatchObject({
      label: "GAS LINE BLAST",
      points: 900,
      combo: 1
    });
    expect(tracker.addChainReaction(50_000, new THREE.Vector3(0, 0, 0), "GAS LINE BLAST")[0]).toMatchObject({
      label: "GAS LINE BLAST x2",
      points: 1008,
      combo: 2
    });
  });

  test("highlights weak point and boss breaks without counting golden egg boss parts", () => {
    const tracker = new ShotScoreTracker();
    tracker.beginShot(PROJECTILES.slug);

    const events = tracker.addExplosion(
      result({
        affectedObjects: [
          affectedObject({
            id: 11,
            label: "Breaker boss shear pin",
            zoneId: "breaker-boss weak-point",
            scoreRole: "target",
            weightedDamage: 100,
            fractured: true
          }),
          affectedObject({
            id: 12,
            label: "Archive boss prism lens",
            zoneId: "archive-boss glass-depot",
            materialId: "glass",
            scoreRole: "target",
            weightedDamage: 80,
            fractured: true
          }),
          affectedObject({
            id: 99,
            label: "Golden egg boss",
            zoneId: "golden-egg-boss",
            scoreRole: "target",
            weightedDamage: 120_000,
            fractured: true
          })
        ]
      })
    );

    expect(events.map((event) => event.label)).toEqual(["SHEAR PIN BREAK", "BOSS BREAK"]);
    expect(tracker.finalize(fakePhysics([]))).toMatchObject({
      weakPointBreakCount: 1,
      bossBreakCount: 2,
      goldenEggDestroyed: true
    });
  });

  test("charges the golden egg multiplier from normal destruction instead of boss-only damage", () => {
    expect(goldenEggMultiplierForRawScore(20_000, { goldenEggChargeStart: 40_000, goldenEggFullCharge: 200_000 })).toBe(1);
    expect(goldenEggMultiplierForRawScore(200_000, { goldenEggChargeStart: 40_000, goldenEggFullCharge: 200_000 })).toBe(8);

    const bossOnly = new ShotScoreTracker();
    bossOnly.beginShot(PROJECTILES.slug);
    bossOnly.addExplosion(
      result({
        materialChaos: 0,
        affectedObjects: [
          affectedObject({
            id: 99,
            label: "Golden egg boss",
            zoneId: "golden-egg-boss",
            scoreRole: "target",
            weightedDamage: 50_000,
            scoreValue: 50_000,
            fractured: true
          })
        ]
      })
    );

    expect(
      bossOnly.finalize(fakePhysics([]), { goldenEggChargeStart: 40_000, goldenEggFullCharge: 200_000 })
    ).toMatchObject({
      goldenEggDestroyed: true,
      goldenEggMultiplier: 1,
      goldenEggBonus: 0,
      totalScore: 0
    });

    const strongRun = new ShotScoreTracker();
    strongRun.beginShot(PROJECTILES.slug);
    strongRun.addExplosion(
      result({
        materialChaos: 80_000,
        affectedObjects: [
          affectedObject({ id: 1, scoreRole: "target", weightedDamage: 120_000, fractured: true }),
          affectedObject({
            id: 99,
            label: "Golden egg boss",
            zoneId: "golden-egg-boss",
            scoreRole: "target",
            weightedDamage: 50_000,
            scoreValue: 50_000,
            fractured: true
          })
        ]
      })
    );

    const score = strongRun.finalize(fakePhysics([]), { goldenEggChargeStart: 40_000, goldenEggFullCharge: 200_000 });
    expect(score.goldenEggDestroyed).toBe(true);
    expect(score.goldenEggMultiplier).toBeGreaterThan(1);
    expect(score.goldenEggBonus).toBeGreaterThan(0);
    expect(score.totalScore).toBeGreaterThan(score.targetDamage + score.collateralChaos);
  });
});

function result(overrides: Partial<ExplosionResult> = {}): ExplosionResult {
  return {
    origin: new THREE.Vector3(1, 0, 2),
    affectedBodies: overrides.affectedObjects?.length ?? 0,
    fracturedBodies: 0,
    dustColors: [],
    affectedObjects: [],
    structureDamage: 0,
    materialChaos: 0,
    ...overrides
  };
}

function affectedObject(overrides: Partial<ExplosionAffectedObject> = {}): ExplosionAffectedObject {
  return {
    id: 1,
    label: "test object",
    materialId: "concrete",
    category: "structure",
    scoreRole: "target",
    position: new THREE.Vector3(0, 0, 0),
    energy: 20,
    weightedDamage: 100,
    scoreValue: 100,
    fractured: true,
    ...overrides
  };
}

function fakePhysics(
  objects: Array<{
    category: string;
    scoreRole: string;
    isDebris: boolean;
    velocity: { x: number; y: number; z: number };
  }>
): PhysicsWorld {
  return {
    getDynamicObjects: () =>
      objects.map((object) => ({
        category: object.category,
        scoreRole: object.scoreRole,
        isDebris: object.isDebris,
        body: {
          linvel: () => object.velocity
        }
      }))
  } as unknown as PhysicsWorld;
}
