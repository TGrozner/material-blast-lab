import type { ExplosionResult } from "./destruction";
import { PhysicsWorld } from "./physics";
import type { ProjectileDefinition } from "./projectile";

export interface ScoreBreakdown {
  structureDamage: number;
  materialChaos: number;
  bioGelSplash: number;
  chainReactionBonus: number;
  remainingDebrisMotion: number;
  totalScore: number;
  shotName: string;
}

export class ShotScoreTracker {
  private structureDamage = 0;
  private materialChaos = 0;
  private bioGelSplash = 0;
  private chainReactionBonus = 0;
  private currentProjectile: ProjectileDefinition | null = null;

  beginShot(projectile: ProjectileDefinition): void {
    this.structureDamage = 0;
    this.materialChaos = 0;
    this.bioGelSplash = 0;
    this.chainReactionBonus = 0;
    this.currentProjectile = projectile;
  }

  addExplosion(result: ExplosionResult, extraBioSplash = 0): void {
    this.structureDamage += result.structureDamage;
    this.materialChaos += result.materialChaos;
    this.bioGelSplash += result.bioGelSplash + extraBioSplash;
  }

  addChainReaction(points: number): void {
    this.chainReactionBonus += points;
  }

  addBioGelSplash(points: number): void {
    this.bioGelSplash += points;
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
      this.structureDamage +
      this.materialChaos +
      this.bioGelSplash +
      this.chainReactionBonus +
      remainingDebrisMotion;
    return {
      structureDamage: Math.round(this.structureDamage * modifier),
      materialChaos: Math.round(this.materialChaos * modifier),
      bioGelSplash: Math.round(this.bioGelSplash * modifier),
      chainReactionBonus: Math.round(this.chainReactionBonus * modifier),
      remainingDebrisMotion: Math.round(remainingDebrisMotion * modifier),
      totalScore: Math.round(raw * modifier),
      shotName: projectile?.name ?? "No Shot"
    };
  }
}
