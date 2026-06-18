import { describe, expect, test } from "vitest";
import * as THREE from "three";
import type { ExplosionAffectedObject, ExplosionResult } from "../../src/destruction";
import type { PhysicsWorld } from "../../src/physics";
import { PROJECTILE_ORDER, PROJECTILES } from "../../src/projectile";
import { ShotScoreTracker } from "../../src/scoring";

describe("ShotScoreTracker", () => {
  test("exposes exactly four player projectile choices on keys one through four", () => {
    expect(PROJECTILE_ORDER).toEqual(["slug", "scatter", "pulse", "gravity"]);
    expect(PROJECTILE_ORDER.map((id) => PROJECTILES[id].key)).toEqual(["1", "2", "3", "4"]);
    expect(PROJECTILE_ORDER.map((id) => PROJECTILES[id].shortName)).toEqual(["Normal", "Frag", "Impulse", "Heavy"]);
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
      label: "CHAIN",
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
      label: "COMBO x4",
      points: 115,
      combo: 4
    });
    expect(tracker.addChainReaction(100, new THREE.Vector3(0, 0, 0), "POWER RELAY BLAST")[0]).toMatchObject({
      label: "POWER RELAY BLAST x5",
      points: 109,
      combo: 5
    });

    expect(tracker.finalize(fakePhysics([]))).toMatchObject({
      chainReactionBonus: 588,
      chainReactionCount: 5,
      maxChainCombo: 5,
      totalScore: 588
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
      remainingDebrisMotion: 196,
      totalScore: 196
    });
  });

  test("keeps mayhem ratings on the same scale as million-point route targets", () => {
    const tracker = new ShotScoreTracker();
    tracker.beginShot(PROJECTILES.slug);

    tracker.addExplosion(result({ materialChaos: 2_500_000 }));

    expect(tracker.finalize(fakePhysics([]))).toMatchObject({
      totalScore: 2_625_000,
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
