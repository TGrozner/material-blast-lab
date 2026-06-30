export type GameMode = "cannon";

export interface GameModeDefinition {
  id: GameMode;
  name: string;
  shortName: string;
  description: string;
}

export const GAME_MODES: Record<GameMode, GameModeDefinition> = {
  cannon: {
    id: "cannon",
    name: "Cannon Trial",
    shortName: "Cannon",
    description: "Aim the siege cannon, fire one arcade projectile, then watch the city settle into a score."
  }
};

export const DEFAULT_GAME_MODE: GameMode = "cannon";
