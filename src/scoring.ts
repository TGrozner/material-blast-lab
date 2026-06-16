import * as THREE from "three";
import type { ExplosionAffectedObject, ExplosionResult } from "./destruction";
import { PhysicsWorld } from "./physics";
import type { ProjectileDefinition } from "./projectile";

export type ScoreEventKind = "target" | "protected" | "chain" | "purge" | "chaos";

export interface ScoreEvent {
  kind: ScoreEventKind;
  label: string;
  points: number;
  position: THREE.Vector3;
  combo?: number;
}

export interface ScoreBreakdown {
  targetDamage: number;
  cityChaos: number;
  contaminationPurge: number;
  chainReactionBonus: number;
  protectedPenalty: number;
  remainingDebrisMotion: number;
  containmentRating: string;
  totalScore: number;
  shotName: string;
  chainReactionCount: number;
  maxChainCombo: number;
}

export class ShotScoreTracker {
  private targetDamage = 0;
  private cityChaos = 0;
  private contaminationPurge = 0;
  private chainReactionBonus = 0;
  private protectedPenalty = 0;
  private currentProjectile: ProjectileDefinition | null = null;
  private chainReactionCount = 0;
  private maxChainCombo = 0;
  private readonly scoredObjects = new Map<number, { positive: number; penalty: number }>();

  beginShot(projectile: ProjectileDefinition): void {
    this.targetDamage = 0;
    this.cityChaos = 0;
    this.contaminationPurge = 0;
    this.chainReactionBonus = 0;
    this.protectedPenalty = 0;
    this.chainReactionCount = 0;
    this.maxChainCombo = 0;
    this.currentProjectile = projectile;
    this.scoredObjects.clear();
  }

  addExplosion(result: ExplosionResult, extraBioSplash = 0): ScoreEvent[] {
    const events: ScoreEvent[] = [];
    const target = this.dedupPositive(result);
    const protectedDamage = this.dedupPenalty(result);
    this.targetDamage += target.points;
    this.cityChaos += result.materialChaos;
    this.contaminationPurge += result.bioGelSplash + extraBioSplash;
    this.protectedPenalty += protectedDamage.points;
    events.push(...target.events, ...protectedDamage.events);

    const purge = Math.round(result.bioGelSplash + extraBioSplash);
    if (purge >= 45) {
      events.push({
        kind: "purge",
        label: "PURGE",
        points: purge,
        position: result.origin.clone().add(new THREE.Vector3(0, 1.05, 0))
      });
    }
    if (result.materialChaos >= 95) {
      events.push({
        kind: "chaos",
        label: "CHAOS",
        points: Math.round(result.materialChaos),
        position: result.origin.clone().add(new THREE.Vector3(0, 0.72, 0))
      });
    }
    return events;
  }

  addChainReaction(points: number, position?: THREE.Vector3): ScoreEvent[] {
    this.chainReactionCount += 1;
    this.maxChainCombo = Math.max(this.maxChainCombo, this.chainReactionCount);
    const combo = this.chainReactionCount;
    const multiplier = 1 + Math.min(2.2, (combo - 1) * 0.42);
    const awarded = Math.round(points * multiplier);
    this.chainReactionBonus += awarded;
    if (!position) {
      return [];
    }
    return [
      {
        kind: "chain",
        label: chainLabel(combo),
        points: awarded,
        combo,
        position: position.clone().add(new THREE.Vector3(0, 1.1, 0))
      }
    ];
  }

  addBioGelSplash(points: number, position?: THREE.Vector3): ScoreEvent[] {
    this.contaminationPurge += points;
    if (!position || points < 1) {
      return [];
    }
    return [
      {
        kind: "purge",
        label: "PURGE",
        points,
        position: position.clone().add(new THREE.Vector3(0, 1.1, 0))
      }
    ];
  }

  finalize(physics: PhysicsWorld): ScoreBreakdown {
    const projectile = this.currentProjectile;
    const remainingDebrisMotion = Math.round(
      physics
        .getDynamicObjects()
        .filter((object) => object.category !== "projectile" && object.scoreRole !== "protected")
        .reduce((sum, object) => {
          const velocity = object.body.linvel();
          const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
          return sum + Math.min(80, speed * (object.isDebris ? 5.5 : 2.6));
        }, 0)
    );
    const modifier = projectile?.scoreModifier ?? 1;
    const raw =
      this.targetDamage +
      this.cityChaos +
      this.contaminationPurge +
      this.chainReactionBonus +
      remainingDebrisMotion -
      this.protectedPenalty;
    const totalScore = Math.max(0, Math.round(raw * modifier));
    const protectedPenalty = Math.round(this.protectedPenalty * modifier);
    return {
      targetDamage: Math.round(this.targetDamage * modifier),
      cityChaos: Math.round(this.cityChaos * modifier),
      contaminationPurge: Math.round(this.contaminationPurge * modifier),
      chainReactionBonus: Math.round(this.chainReactionBonus * modifier),
      protectedPenalty,
      remainingDebrisMotion: Math.round(remainingDebrisMotion * modifier),
      containmentRating: containmentRating(protectedPenalty, totalScore),
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
      const previous = this.scoredObjects.get(object.id) ?? { positive: 0, penalty: 0 };
      if (next > previous.positive) {
        const delta = next - previous.positive;
        points += delta;
        events.push(scoreEventFromObject("target", "TARGET", delta, object));
        previous.positive = next;
        this.scoredObjects.set(object.id, previous);
      }
    }
    return { points, events: events.sort(sortScoreEvents).slice(0, 7) };
  }

  private dedupPenalty(result: ExplosionResult): { points: number; events: ScoreEvent[] } {
    let penalty = 0;
    const events: ScoreEvent[] = [];
    for (const object of result.affectedObjects) {
      if (object.scoreRole !== "protected") {
        continue;
      }
      const next = Math.max(0, Math.round(object.weightedDamage * (object.fractured ? 1.8 : 1)));
      const previous = this.scoredObjects.get(object.id) ?? { positive: 0, penalty: 0 };
      if (next > previous.penalty) {
        const delta = next - previous.penalty;
        penalty += delta;
        events.push(scoreEventFromObject("protected", "PROTECTED", -delta, object));
        previous.penalty = next;
        this.scoredObjects.set(object.id, previous);
      }
    }
    return { points: penalty, events: events.sort(sortScoreEvents).slice(0, 5) };
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
    return `RUNAWAY x${combo}`;
  }
  if (combo >= 3) {
    return `CASCADE x${combo}`;
  }
  if (combo >= 2) {
    return `CHAIN x${combo}`;
  }
  return "CHAIN";
}

function containmentRating(protectedPenalty: number, totalScore: number): string {
  if (protectedPenalty >= 900) {
    return "FAILED CONTAINMENT";
  }
  if (protectedPenalty >= 450) {
    return "DIRTY WIN";
  }
  if (protectedPenalty >= 120) {
    return "MESSY";
  }
  if (totalScore >= 2200) {
    return "CLEAN BLAST";
  }
  return "CONTAINED";
}
