import Fuse from 'fuse.js';
import mlbDataRaw from '../data/mlb_data.json';
import nflDataRaw from '../data/nfl_data.json';
import { GameMode } from '../../types';
import type { PlayerNode, Difficulty } from '../../types';

export interface SportData {
  players: string[];
  playerSeasons: Record<string, Array<{ team: string; year: number }>>;
  teamSeasons: Record<string, string[]>;
  playerPositions?: Record<string, string>; // NFL only
}

const mlbData: SportData = mlbDataRaw as SportData;
const nflData: SportData = nflDataRaw as SportData;

const getData = (mode: GameMode): SportData =>
  mode === GameMode.MLB ? mlbData : nflData;

// Fuzzy search setup (one per mode)
const mlbFuse = new Fuse(mlbData.players, { threshold: 0.3, minMatchCharLength: 2 });
const nflFuse = new Fuse(nflData.players, { threshold: 0.3, minMatchCharLength: 2 });

export const searchPlayers = (mode: GameMode, query: string): string[] => {
  const fuse = mode === GameMode.MLB ? mlbFuse : nflFuse;
  return fuse.search(query).slice(0, 8).map(result => result.item);
};

export const areTeammates = (mode: GameMode, p1: string, p2: string): boolean => {
  const data = getData(mode);
  const s1 = data.playerSeasons[p1] ?? [];
  const s2 = data.playerSeasons[p2] ?? [];
  return s1.some(r1 => s2.some(r2 => r1.team === r2.team && r1.year === r2.year));
};

// maxDepth limits how deep BFS goes; use Infinity for gameplay, a small
// number (e.g. 10) for fast challenge generation.
export const findShortestPath = (
  mode: GameMode,
  start: string,
  target: string,
  maxDepth = Infinity,
): PlayerNode[] | null => {
  const data = getData(mode);
  if (!data.playerSeasons[start] || !data.playerSeasons[target]) return null;

  type QItem = { player: string; depth: number };
  const queue: QItem[] = [{ player: start, depth: 0 }];
  const visited = new Set([start]);
  const parent = new Map<string, { prev: string; team: string; year: number }>();

  while (queue.length) {
    const { player: current, depth } = queue.shift()!;

    if (current === target) break;
    if (depth >= maxDepth) continue;

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
        queue.push({ player: neigh, depth: depth + 1 });

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

// ── Difficulty-aware player generation ──────────────────────────────────────

// Minimum career length (distinct seasons) by mode + difficulty
const MIN_SEASONS: Record<GameMode, Record<Difficulty, number>> = {
  [GameMode.NFL]: { Easy: 14, Medium: 10, Hard: 8 },
  [GameMode.MLB]: { Easy: 15, Medium: 12, Hard: 10 },
};

// NFL positions mapped from depth_chart_position column
// Easy: QB, RB (incl. FB), WR, CB, LB (incl. ILB/OLB/MLB)
const NFL_EASY_POSITIONS = new Set(['QB', 'RB', 'FB', 'WR', 'CB', 'LB', 'ILB', 'OLB', 'MLB']);
// Medium adds TE, DE, S (FS/SS/DB)
const NFL_MEDIUM_POSITIONS = new Set([
  'QB', 'RB', 'FB', 'WR', 'TE',
  'CB', 'LB', 'ILB', 'OLB', 'MLB',
  'DE', 'FS', 'SS', 'DB',
]);

// Returns the set of unique years a player was active
const careerYears = (data: SportData, player: string): Set<number> =>
  new Set((data.playerSeasons[player] ?? []).map(s => s.year));

// Counts calendar years that both players were active (not necessarily same team)
const careerOverlap = (y1: Set<number>, y2: Set<number>): number => {
  let count = 0;
  for (const y of y1) if (y2.has(y)) count++;
  return count;
};

// Builds the initial eligible player list for the given mode + difficulty
const buildEligible = (mode: GameMode, difficulty: Difficulty): string[] => {
  const data = getData(mode);
  const minSeasons = MIN_SEASONS[mode][difficulty];

  let eligible = data.players.filter(
    p => careerYears(data, p).size >= minSeasons
  );

  if (mode === GameMode.NFL && difficulty !== 'Hard') {
    const allowed = difficulty === 'Easy' ? NFL_EASY_POSITIONS : NFL_MEDIUM_POSITIONS;
    const posMap = data.playerPositions ?? {};
    eligible = eligible.filter(p => allowed.has(posMap[p] ?? ''));
  }

  if (mode === GameMode.MLB && difficulty !== 'Hard') {
    const sinceYear = difficulty === 'Easy' ? 1990 : 1970;
    eligible = eligible.filter(p =>
      (data.playerSeasons[p] ?? []).some(s => s.year >= sinceYear)
    );
  }

  return eligible;
};

export const getRandomPlayers = (
  mode: GameMode,
  difficulty: Difficulty = 'Easy',
): { start: string; target: string } | null => {
  const data = getData(mode);
  const eligible = buildEligible(mode, difficulty);
  if (eligible.length < 2) return null;

  const BFS_CAP = 10;

  const pick = () => {
    const i1 = Math.floor(Math.random() * eligible.length);
    let i2 = Math.floor(Math.random() * eligible.length);
    while (i2 === i1) i2 = Math.floor(Math.random() * eligible.length);
    return [eligible[i1], eligible[i2]] as const;
  };

  for (let attempt = 0; attempt < 60; attempt++) {
    const [p1, p2] = pick();
    const y1 = careerYears(data, p1);
    const y2 = careerYears(data, p2);
    const overlap = careerOverlap(y1, y2);

    // Career-overlap gate (fast, before BFS)
    if (difficulty === 'Easy' && overlap < 3) continue;
    if (difficulty === 'Medium' && (overlap < 1 || overlap > 2)) continue;
    if (difficulty === 'Hard' && overlap > 0) continue;

    // Degree gate (BFS with depth cap)
    const path = findShortestPath(mode, p1, p2, BFS_CAP);
    if (!path) continue;

    const degrees = path.length - 1;
    if (difficulty === 'Easy' && (degrees < 2 || degrees > 4)) continue;
    if ((difficulty === 'Medium' || difficulty === 'Hard') && degrees < 3) continue;

    return { start: p1, target: p2 };
  }

  // Soft fallback: satisfy only the overlap rule (skip degree check)
  for (let attempt = 0; attempt < 30; attempt++) {
    const [p1, p2] = pick();
    const overlap = careerOverlap(careerYears(data, p1), careerYears(data, p2));
    if (difficulty === 'Easy' && overlap >= 3) return { start: p1, target: p2 };
    if (difficulty === 'Medium' && overlap >= 1 && overlap <= 2) return { start: p1, target: p2 };
    if (difficulty === 'Hard' && overlap === 0) return { start: p1, target: p2 };
  }

  return null;
};

export const getPlayerCount = (mode: GameMode): number => getData(mode).players.length;

export const getPlayerPosition = (mode: GameMode, player: string): string | undefined =>
  getData(mode).playerPositions?.[player];

export const getCareerRange = (mode: GameMode, player: string): string | undefined => {
  const seasons = getData(mode).playerSeasons[player] ?? [];
  if (seasons.length === 0) return undefined;
  const years = seasons.map(s => s.year);
  const min = Math.min(...years);
  const max = Math.max(...years);
  return min === max ? String(min) : `${min}-${max}`;
};

export const getPlayerSeasons = (mode: GameMode, player: string) =>
  getData(mode).playerSeasons[player] ?? [];

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
