import Fuse from 'fuse.js';
import mlbDataRaw from '../data/mlb_data.json';
import nflDataRaw from '../data/nfl_data.json';
import { GameMode } from '../../types';
import type { PlayerNode, Difficulty } from '../../types';

export interface SportData {
  players: string[];
  playerSeasons: Record<string, Array<{ team: string; year: number }>>;
  teamSeasons: Record<string, string[]>;
  playerPositions?: Record<string, string>;
  wellKnown?: string[]; // sorted list of well-known player names
}

const mlbData: SportData = mlbDataRaw as SportData;
const nflData: SportData = nflDataRaw as SportData;

const getData = (mode: GameMode): SportData =>
  mode === GameMode.MLB ? mlbData : nflData;

// Pre-compute well-known sets for O(1) lookup
const mlbWellKnownSet = new Set(mlbData.wellKnown ?? []);
const nflWellKnownSet = new Set(nflData.wellKnown ?? []);
const getWellKnownSet = (mode: GameMode): Set<string> =>
  mode === GameMode.MLB ? mlbWellKnownSet : nflWellKnownSet;

export const isWellKnown = (mode: GameMode, player: string): boolean =>
  getWellKnownSet(mode).has(player);

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

// Returns the best shared connection between two players:
// picks the team with the most shared seasons and returns the full year range.
const findConnectionFull = (
  data: SportData,
  p1: string,
  p2: string,
): { team: string; years: string } | null => {
  const s1 = data.playerSeasons[p1] ?? [];
  const s2 = data.playerSeasons[p2] ?? [];

  const teamYears = new Map<string, number[]>();
  for (const r1 of s1) {
    for (const r2 of s2) {
      if (r1.team === r2.team && r1.year === r2.year) {
        const arr = teamYears.get(r1.team) ?? [];
        arr.push(r1.year);
        teamYears.set(r1.team, arr);
      }
    }
  }

  if (teamYears.size === 0) return null;

  // Pick the team with the most shared seasons
  let bestTeam = '';
  let bestYears: number[] = [];
  for (const [team, years] of teamYears) {
    if (years.length > bestYears.length) {
      bestTeam = team;
      bestYears = years;
    }
  }

  bestYears.sort((a, b) => a - b);
  const min = bestYears[0];
  const max = bestYears[bestYears.length - 1];
  return { team: bestTeam, years: min === max ? String(min) : `${min}–${max}` };
};

// maxDepth limits how deep BFS goes; use Infinity for gameplay, a small
// number (e.g. 10) for fast challenge generation.
// When wellKnownOnly is true, intermediate nodes (not start/target) must be well-known.
export const findShortestPath = (
  mode: GameMode,
  start: string,
  target: string,
  maxDepth = Infinity,
  wellKnownOnly = false,
): PlayerNode[] | null => {
  const data = getData(mode);
  if (!data.playerSeasons[start] || !data.playerSeasons[target]) return null;

  const wkSet = wellKnownOnly ? getWellKnownSet(mode) : null;

  type QItem = { player: string; depth: number };
  const queue: QItem[] = [{ player: start, depth: 0 }];
  const visited = new Set([start]);
  const parent = new Map<string, string>(); // neigh → prev player name

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
        // In well-known mode, only allow well-known intermediates (target is always allowed)
        if (wkSet && neigh !== target && !wkSet.has(neigh)) continue;
        visited.add(neigh);
        queue.push({ player: neigh, depth: depth + 1 });
        parent.set(neigh, current);
      }
    }
  }

  if (!parent.has(target) && start !== target) return null;

  const path: PlayerNode[] = [];
  let curr = target;
  while (true) {
    let connectionToPrev: PlayerNode['connectionToPrev'] | undefined;
    if (curr !== start && parent.has(curr)) {
      const prev = parent.get(curr)!;
      const conn = findConnectionFull(data, prev, curr);
      connectionToPrev = conn ? { team: conn.team, years: conn.years } : undefined;
    }
    path.unshift({ id: curr, name: curr, ...(connectionToPrev ? { connectionToPrev } : {}) });
    if (curr === start) break;
    curr = parent.get(curr)!;
  }
  return path;
};

// ── Fame scoring & difficulty-aware player generation ─────────────────────

// Position bonuses for NFL fame score (QBs most recognizable, then skill positions)
const POSITION_BONUS: Record<string, number> = {
  QB: 3, RB: 2, FB: 2, WR: 2, TE: 1, LB: 1, ILB: 1, OLB: 1, MLB: 1, CB: 1,
};

// Returns the set of unique years a player was active
const careerYears = (data: SportData, player: string): Set<number> =>
  new Set((data.playerSeasons[player] ?? []).map(s => s.year));

// Compute fame score for a player: careerLength + positionBonus + teammateBonus
const computeFameScore = (data: SportData, player: string): number => {
  const seasons = data.playerSeasons[player] ?? [];
  if (seasons.length === 0) return 0;

  const career = careerYears(data, player).size;

  // Position bonus (NFL only)
  const pos = data.playerPositions?.[player] ?? '';
  const posBonus = POSITION_BONUS[pos] ?? 0;

  // Teammate bonus: unique teammates / 50, capped at 3
  const teammates = new Set<string>();
  for (const s of seasons) {
    const key = `${s.team}-${s.year}`;
    (data.teamSeasons[key] ?? []).forEach(p => {
      if (p !== player) teammates.add(p);
    });
  }
  const teammateBonus = Math.min(3, Math.floor(teammates.size / 50));

  return career + posBonus + teammateBonus;
};

// Pre-computed fame scores per mode (lazily initialized)
const fameScoreCache = new Map<GameMode, Map<string, number>>();

const getFameScores = (mode: GameMode): Map<string, number> => {
  if (fameScoreCache.has(mode)) return fameScoreCache.get(mode)!;
  const data = getData(mode);
  const scores = new Map<string, number>();
  for (const player of data.players) {
    scores.set(player, computeFameScore(data, player));
  }
  fameScoreCache.set(mode, scores);
  return scores;
};

// Start/target players must be household names: always use the well-known pool
// and a high fame threshold. Difficulty only controls the degree range.
const ENDPOINT_FAME_THRESHOLD: Record<GameMode, number> = {
  [GameMode.NFL]: 15,
  [GameMode.MLB]: 12,
};

const DEGREE_RANGE: Record<Difficulty, [number, number]> = {
  Easy: [2, 3],
  Medium: [3, 5],
  Hard: [4, 7],
};

// Builds the eligible endpoint list: must be well-known AND have high fame score
const buildEndpointEligible = (mode: GameMode): string[] => {
  const scores = getFameScores(mode);
  const threshold = ENDPOINT_FAME_THRESHOLD[mode];
  const wkSet = getWellKnownSet(mode);
  return getData(mode).players.filter(p =>
    wkSet.has(p) && (scores.get(p) ?? 0) >= threshold
  );
};

export const getRandomPlayers = (
  mode: GameMode,
  difficulty: Difficulty = 'Easy',
): { start: string; target: string } | null => {
  const eligible = buildEndpointEligible(mode);
  if (eligible.length < 2) return null;

  const BFS_CAP = 10;
  const [minDeg, maxDeg] = DEGREE_RANGE[difficulty];

  const pick = () => {
    const i1 = Math.floor(Math.random() * eligible.length);
    let i2 = Math.floor(Math.random() * eligible.length);
    while (i2 === i1) i2 = Math.floor(Math.random() * eligible.length);
    return [eligible[i1], eligible[i2]] as const;
  };

  // Primary: find pairs matching the target degree range
  for (let attempt = 0; attempt < 80; attempt++) {
    const [p1, p2] = pick();

    const path = findShortestPath(mode, p1, p2, BFS_CAP);
    if (!path) continue;

    const degrees = path.length - 1;
    if (degrees < minDeg || degrees > maxDeg) continue;

    return { start: p1, target: p2 };
  }

  // Soft fallback: accept any connected pair from the eligible pool
  for (let attempt = 0; attempt < 40; attempt++) {
    const [p1, p2] = pick();
    const path = findShortestPath(mode, p1, p2, BFS_CAP);
    if (path && path.length - 1 >= 2) return { start: p1, target: p2 };
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

  const conn = findConnectionFull(data, currentPlayer, canonicalName);

  if (conn) {
    return {
      isValid: true as const,
      correctedName: canonicalName,
      team: conn.team,
      years: conn.years,
    };
  }

  return { isValid: false as const, reason: `${canonicalName} was not a teammate of ${currentPlayer}.` };
};
