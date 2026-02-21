export enum GameMode {
  NFL = 'NFL',
  MLB = 'MLB',
}

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface PlayerNode {
  id: string;
  name: string;
  connectionToPrev?: {
    team: string;
    years: string;
  };
  position?: string;    // e.g. "QB" (NFL only)
  careerYears?: string; // e.g. "1999-2022"
}

export interface GameState {
  status: 'SETUP' | 'PLAYING' | 'WON' | 'LOADING';
  mode: GameMode;
  startPlayer: string;
  targetPlayer: string;
  chain: PlayerNode[];
  error?: string;
  loadingMessage?: string;
}

export interface TeammateValidationResponse {
  isValid: boolean;
  correctedName?: string; // Standardized name if valid
  team?: string;
  years?: string;
  reason?: string; // Why invalid
}

export interface SolutionResponse {
  path: PlayerNode[];
  degrees: number;
  explanation?: string;
}
