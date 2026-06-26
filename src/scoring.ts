import * as THREE from "three";
import type { ExplosionAffectedObject, ExplosionResult } from "./destruction";
import { PhysicsWorld } from "./physics";
import type { ProjectileDefinition } from "./projectile";

const CHAIN_BASE_POINTS_CAP = 900;
const CHAIN_AWARDED_POINTS_CAP = 1_200;

export type ScoreEventKind = "target" | "chain" | "chaos";

export interface ScoreEvent {
  kind: ScoreEventKind;
  label: string;
  points: number;
  position: THREE.Vector3;
  combo?: number;
}

export interface ScoreBreakdown {
  targetDamage: number;
  collateralChaos: number;
  chainReactionBonus: number;
  remainingDebrisMotion: number;
  mayhemRating: string;
  totalScore: number;
  shotName: string;
  chainReactionCount: number;
  maxChainCombo: number;
}

export class ShotScoreTracker {
  private targetDamage = 0;
  private collateralChaos = 0;
  private chainReactionBonus = 0;
  private currentProjectile: ProjectileDefinition | null = null;
  private chainReactionCount = 0;
  private maxChainCombo = 0;
  private readonly scoredObjects = new Map<number, number>();

  beginShot(projectile: ProjectileDefinition): void {
    this.targetDamage = 0;
    this.collateralChaos = 0;
    this.chainReactionBonus = 0;
    this.chainReactionCount = 0;
    this.maxChainCombo = 0;
    this.currentProjectile = projectile;
    this.scoredObjects.clear();
  }

  addExplosion(result: ExplosionResult): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    const target = this.dedupPositive(result);
    this.targetDamage += target.points;
    this.collateralChaos += result.materialChaos;
    events.push(...target.events);
    events.push(...this.collateralEvents(result));

    if (result.materialChaos >= 95) {
      events.push({
        kind: "chaos",
        label: "COLLATERAL SURGE",
        points: Math.round(result.materialChaos),
        position: result.origin.clone().add(new THREE.Vector3(0, 0.72, 0))
      });
    }
    return events;
  }

  addChainReaction(points: number, position?: THREE.Vector3, label?: string): ScoreEvent[] {
    this.chainReactionCount += 1;
    this.maxChainCombo = Math.max(this.maxChainCombo, this.chainReactionCount);
    const combo = this.chainReactionCount;
    const cappedPoints = Math.min(points, CHAIN_BASE_POINTS_CAP);
    const multiplier = 1 + Math.min(0.9, (combo - 1) * 0.12);
    const decay = combo <= 3 ? 1 : 1 / (1 + (combo - 3) * 0.18);
    const awarded = Math.min(CHAIN_AWARDED_POINTS_CAP, Math.round(cappedPoints * multiplier * decay));
    this.chainReactionBonus += awarded;
    if (!position) {
      return [];
    }
    return [
      {
        kind: "chain",
        label: label ? chainSourceLabel(label, combo) : chainLabel(combo),
        points: awarded,
        combo,
        position: position.clone().add(new THREE.Vector3(0, 1.1, 0))
      }
    ];
  }

  finalize(physics: PhysicsWorld): ScoreBreakdown {
    const projectile = this.currentProjectile;
    const remainingDebrisMotion = Math.round(
      physics
        .getDynamicObjects()
        .filter((object) => object.category !== "projectile")
        .reduce((sum, object) => {
          const velocity = object.body.linvel();
          const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
          return sum + Math.min(80, speed * (object.isDebris ? 5.5 : 2.6));
        }, 0)
    );
    const modifier = projectile?.scoreModifier ?? 1;
    const raw =
      this.targetDamage +
      this.collateralChaos +
      this.chainReactionBonus +
      remainingDebrisMotion;
    const totalScore = Math.max(0, Math.round(raw * modifier));
    return {
      targetDamage: Math.round(this.targetDamage * modifier),
      collateralChaos: Math.round(this.collateralChaos * modifier),
      chainReactionBonus: Math.round(this.chainReactionBonus * modifier),
      remainingDebrisMotion: Math.round(remainingDebrisMotion * modifier),
      mayhemRating: mayhemRating(totalScore),
      totalScore,
      shotName: projectile?.name ?? "No Shot",
      chainReactionCount: this.chainReactionCount,
      maxChainCombo: this.maxChainCombo
    };
  }

  private dedupPositive(result: ExplosionResult): { points: number; events: ScoreEvent[] } {
    let points = 0;
    const events: ScoreEvent[] = [];
    for (const object of result.affectedObjects) {
      if (object.scoreRole !== "target") {
        continue;
      }
      const next = Math.max(0, Math.round(object.weightedDamage * (object.fractured ? 1.1 : 0.55)));
      const previous = this.scoredObjects.get(object.id) ?? 0;
      if (next > previous) {
        const delta = next - previous;
        points += delta;
        events.push(scoreEventFromObject("target", objectScoreLabel(object), delta, object));
        this.scoredObjects.set(object.id, next);
      }
    }
    return { points, events: events.sort(sortScoreEvents).slice(0, 7) };
  }

  private collateralEvents(result: ExplosionResult): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    for (const object of result.affectedObjects) {
      if (object.scoreRole === "target") {
        continue;
      }
      const points = Math.round(object.weightedDamage * (object.fractured ? 0.42 : 0.24));
      if (points < 18) {
        continue;
      }
      events.push(scoreEventFromObject("chaos", objectScoreLabel(object), points, object));
    }
    return events.sort(sortScoreEvents).slice(0, 2);
  }
}

function scoreEventFromObject(kind: ScoreEventKind, label: string, points: number, object: ExplosionAffectedObject): ScoreEvent {
  return {
    kind,
    label,
    points,
    position: object.position.clone().add(new THREE.Vector3(0, object.fractured ? 0.88 : 0.58, 0))
  };
}

function sortScoreEvents(a: ScoreEvent, b: ScoreEvent): number {
  return Math.abs(b.points) - Math.abs(a.points);
}

function chainLabel(combo: number): string {
  if (combo >= 4) {
    return `COMBO x${combo}`;
  }
  if (combo >= 3) {
    return `CASCADE x${combo}`;
  }
  if (combo >= 2) {
    return `CHAIN x${combo}`;
  }
  return "CHAIN";
}

function chainSourceLabel(label: string, combo: number): string {
  return combo >= 2 ? `${label} x${combo}` : label;
}

function objectScoreLabel(object: ExplosionAffectedObject): string {
  if (object.scoreRole === "target") {
    return object.fractured ? "TARGET BREAK" : "TARGET HIT";
  }
  return `${materialLabel(object.materialId)} ${object.fractured ? fracturedVerb(object.materialId) : damagedVerb(object.materialId)}`;
}

function materialLabel(materialId: ExplosionAffectedObject["materialId"]): string {
  switch (materialId) {
    case "glass":
      return "GLASS";
    case "metal":
      return "METAL";
    case "wood":
      return "WOOD";
    case "foam":
      return "FOAM";
    case "rubber":
      return "RUBBER";
    case "concrete":
      return "CONCRETE";
  }
}

function fracturedVerb(materialId: ExplosionAffectedObject["materialId"]): string {
  switch (materialId) {
    case "glass":
      return "SHATTER";
    case "metal":
      return "CRUMPLE";
    case "wood":
      return "SPLINTER";
    case "foam":
      return "POP";
    case "rubber":
      return "RUPTURE";
    case "concrete":
      return "CRACK";
  }
}

function damagedVerb(materialId: ExplosionAffectedObject["materialId"]): string {
  switch (materialId) {
    case "glass":
      return "RATTLE";
    case "metal":
      return "DENT";
    case "wood":
      return "CHIP";
    case "foam":
      return "BUCKLE";
    case "rubber":
      return "BOUNCE";
    case "concrete":
      return "CHIP";
  }
}

function mayhemRating(totalScore: number): string {
  if (totalScore >= 3_600_000) {
    return "MAXIMUM MAYHEM";
  }
  if (totalScore >= 2_600_000) {
    return "CITY WRECKER";
  }
  if (totalScore >= 1_600_000) {
    return "DISTRICT WRECKER";
  }
  return "SPARK SHOW";
}
