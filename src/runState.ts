import type { ScoreBreakdown } from "./scoring";

export type GamePhase = "aim" | "flight" | "spectacle" | "scored";
export type ScoreRevealDecision = "inactive" | "waiting" | "ready";

const SCORE_REVEAL_MIN_DELAY_MS = 2800;
const SCORE_REVEAL_TIMEOUT_MS = 8400;
const SCORE_SETTLED_FRAMES = 18;

export class ShotRunState {
  phase: GamePhase = "aim";
  shotAvailable = true;
  score: ScoreBreakdown | null = null;

  private scoreRevealAt: number | null = null;
  private scoreRevealStartedAt: number | null = null;
  private scoreSettleFrames = 0;

  resetAim(): void {
    this.phase = "aim";
    this.shotAvailable = true;
    this.score = null;
    this.scoreRevealAt = null;
    this.scoreRevealStartedAt = null;
    this.scoreSettleFrames = 0;
  }

  beginFlight(): void {
    this.phase = "flight";
    this.shotAvailable = false;
    this.score = null;
    this.scoreRevealAt = null;
    this.scoreRevealStartedAt = null;
    this.scoreSettleFrames = 0;
  }

  beginSpectacle(nowMs: number): void {
    this.phase = "spectacle";
    this.scoreRevealStartedAt = nowMs;
    this.scoreRevealAt = nowMs + SCORE_REVEAL_MIN_DELAY_MS;
    this.scoreSettleFrames = 0;
  }

  evaluateScoreReveal(nowMs: number, sceneSettled: boolean): ScoreRevealDecision {
    if ((this.phase !== "spectacle" && this.phase !== "scored") || this.scoreRevealAt === null || this.score) {
      return "inactive";
    }
    if (nowMs < this.scoreRevealAt) {
      return "waiting";
    }

    const timedOut = this.scoreRevealStartedAt !== null && nowMs - this.scoreRevealStartedAt >= SCORE_REVEAL_TIMEOUT_MS;
    this.scoreSettleFrames = sceneSettled ? this.scoreSettleFrames + 1 : 0;
    if (!timedOut && this.scoreSettleFrames < SCORE_SETTLED_FRAMES) {
      return "waiting";
    }
    return "ready";
  }

  markScored(score: ScoreBreakdown): void {
    this.score = score;
    this.phase = "scored";
    this.scoreRevealAt = null;
    this.scoreRevealStartedAt = null;
    this.scoreSettleFrames = 0;
  }
}
