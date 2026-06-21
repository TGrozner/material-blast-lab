export type GameMode = "cannon" | "plane";

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
  },
  plane: {
    id: "plane",
    name: "RC Crash Run",
    shortName: "RC Plane",
    description: "Pilot a small fictional RC plane into the district and turn the crash into one Mayhem Score."
  }
};

export const DEFAULT_GAME_MODE: GameMode = "cannon";

export function isGameMode(value: string | undefined): value is GameMode {
  return value === "cannon" || value === "plane";
}
