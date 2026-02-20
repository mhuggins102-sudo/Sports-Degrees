import Fuse from 'fuse.js';
import mlbDataRaw from '../data/mlb_data.json';
import nflDataRaw from '../data/nfl_data.json';
import { GameMode } from '../../types';
import type { PlayerNode } from '../../types';

export interface SportData {
  players: string[];
  playerSeasons: Record<string, Array<{ team: string; year: number }>>;
  teamSeasons: Record<string, string[]>;
}

const mlbData: SportData = mlbDataRaw as SportData;
const nflData: SportData = nflDataRaw as SportData;

const getData = (mode: GameMode): SportData =>
  mode === GameMode.MLB ? mlbData : nflData;

// Fuzzy search setup (one per mode)
const mlbFuse = new Fuse(mlbData.players, { threshold: 0.3, minMatchCharLength: 3 });
const nflFuse = new Fuse(nflData.players, { threshold: 0.3, minMatchCharLength: 3 });

export const searchPlayers = (mode: GameMode, query: string): string[] => {
  const fuse = mode === GameMode.MLB ? mlbFuse : nflFuse;
  return fuse.search(query).slice(0, 10).map(result => result.item);
};

export const areTeammates = (mode: GameMode, p1: string, p2: string): boolean => {
  const data = getData(mode);
  const s1 = data.playerSeasons[p1] ?? [];
  const s2 = data.playerSeasons[p2] ?? [];
  return s1.some(r1 => s2.some(r2 => r1.team === r2.team && r1.year === r2.year));
};

export const findShortestPath = (mode: GameMode, start: string, target: string): PlayerNode[] | null => {
  const data = getData(mode);
  if (!data.playerSeasons[start] || !data.playerSeasons[target]) return null;

  const queue: string[] = [start];
  const visited = new Set([start]);
  const parent = new Map<string, { prev: string; team: string; year: number }>();

  while (queue.length) {
    const current = queue.shift()!;

    if (current === target) break;

    const mySeasons = data.playerSeasons[current];
    const neighbors = new Set<string>();

    for (const r of mySeasons) {
      const key = `${r.team}-${r.year}`;
      (data.teamSeasons[key] ?? []).forEach(p => {
        if (p !== current) neighbors.add(p);
      });
    }

    for (const neigh of neighbors) {
      if (!visited.has(neigh)) {
        visited.add(neigh);
        queue.push(neigh);

        // Find shared season (first match)
        let sharedTeam = '', sharedYear = 0;
        for (const r1 of mySeasons) {
          for (const r2 of data.playerSeasons[neigh] ?? []) {
            if (r1.team === r2.team && r1.year === r2.year) {
              sharedTeam = r1.team;
              sharedYear = r1.year;
              break;
            }
          }
          if (sharedTeam) break;
        }
        parent.set(neigh, { prev: current, team: sharedTeam, year: sharedYear });
      }
    }
  }

  if (!parent.has(target) && start !== target) return null;

  // Reconstruct path
  const path: PlayerNode[] = [];
  let curr = target;
  while (true) {
    path.unshift({ 
      id: curr, 
      name: curr, 
      ...(curr !== start && parent.has(curr) ? { connectionToPrev: { team: parent.get(curr)!.team, years: parent.get(curr)!.year.toString() } } : {}) 
    });
    if (curr === start) break;
    curr = parent.get(curr)!.prev;
  }
  return path;
};

export const getRandomPlayers = (mode: GameMode): { start: string; target: string } => {
  const players = getData(mode).players;
  const idx1 = Math.floor(Math.random() * players.length);
  let idx2 = Math.floor(Math.random() * players.length);
  while (idx2 === idx1) idx2 = Math.floor(Math.random() * players.length);
  return { start: players[idx1], target: players[idx2] };
};

export const getPlayerCount = (mode: GameMode): number => getData(mode).players.length;

export const validateTeammateOffline = (mode: GameMode, currentPlayer: string, guessName: string) => {
  const data = getData(mode);
  const fuse = mode === GameMode.MLB ? mlbFuse : nflFuse;

  // Exact match first, then fuzzy
  let canonicalName: string | null = null;
  if (data.playerSeasons[guessName] !== undefined) {
    canonicalName = guessName;
  } else {
    const results = fuse.search(guessName);
    canonicalName = results.length > 0 ? results[0].item : null;
  }

  if (!canonicalName) {
    return { isValid: false as const, reason: `"${guessName}" not found in the database.` };
  }

  const s1 = data.playerSeasons[currentPlayer] ?? [];
  const s2 = data.playerSeasons[canonicalName] ?? [];

  for (const r1 of s1) {
    for (const r2 of s2) {
      if (r1.team === r2.team && r1.year === r2.year) {
        return {
          isValid: true as const,
          correctedName: canonicalName,
          team: r1.team,
          years: r1.year.toString(),
        };
      }
    }
  }

  return { isValid: false as const, reason: `${canonicalName} was not a teammate of ${currentPlayer}.` };
};
