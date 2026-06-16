import type { ExplosionResult } from "./destruction";
import { PhysicsWorld } from "./physics";
import type { ProjectileDefinition } from "./projectile";

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
}

export class ShotScoreTracker {
  private targetDamage = 0;
  private cityChaos = 0;
  private contaminationPurge = 0;
  private chainReactionBonus = 0;
  private protectedPenalty = 0;
  private currentProjectile: ProjectileDefinition | null = null;
  private readonly scoredObjects = new Map<number, { positive: number; penalty: number }>();

  beginShot(projectile: ProjectileDefinition): void {
    this.targetDamage = 0;
    this.cityChaos = 0;
    this.contaminationPurge = 0;
    this.chainReactionBonus = 0;
    this.protectedPenalty = 0;
    this.currentProjectile = projectile;
    this.scoredObjects.clear();
  }

  addExplosion(result: ExplosionResult, extraBioSplash = 0): void {
    this.targetDamage += this.dedupPositive(result);
    this.cityChaos += result.materialChaos;
    this.contaminationPurge += result.bioGelSplash + extraBioSplash;
    this.protectedPenalty += this.dedupPenalty(result);
  }

  addChainReaction(points: number): void {
    this.chainReactionBonus += points;
  }

  addBioGelSplash(points: number): void {
    this.contaminationPurge += points;
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
      shotName: projectile?.name ?? "No Shot"
    };
  }

  private dedupPositive(result: ExplosionResult): number {
    let points = 0;
    for (const object of result.affectedObjects) {
      if (object.scoreRole !== "target") {
        continue;
      }
      const next = Math.max(0, Math.round(object.weightedDamage * (object.fractured ? 1.1 : 0.55)));
      const previous = this.scoredObjects.get(object.id) ?? { positive: 0, penalty: 0 };
      if (next > previous.positive) {
        points += next - previous.positive;
        previous.positive = next;
        this.scoredObjects.set(object.id, previous);
      }
    }
    return points;
  }

  private dedupPenalty(result: ExplosionResult): number {
    let penalty = 0;
    for (const object of result.affectedObjects) {
      if (object.scoreRole !== "protected") {
        continue;
      }
      const next = Math.max(0, Math.round(object.weightedDamage * (object.fractured ? 1.8 : 1)));
      const previous = this.scoredObjects.get(object.id) ?? { positive: 0, penalty: 0 };
      if (next > previous.penalty) {
        penalty += next - previous.penalty;
        previous.penalty = next;
        this.scoredObjects.set(object.id, previous);
      }
    }
    return penalty;
  }
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
