export enum GameMode {
  NFL = 'NFL',
  MLB = 'MLB',
}

export interface PlayerNode {
  id: string; // Unique ID for keying
  name: string;
  // If this node connects to the PREVIOUS node, describe that connection
  connectionToPrev?: {
    team: string;
    years: string;
  };
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
