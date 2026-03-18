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
  wellKnown?: string[]; // legacy — sorted list of well-known player names
  playerFame?: Record<string, number>; // era-adjusted WAR (MLB) or AV (NFL)
  challengePairs?: Record<string, Array<[string, string, number]>>; // pre-computed pairs per difficulty
}

const mlbData: SportData = mlbDataRaw as unknown as SportData;
const nflData: SportData = nflDataRaw as unknown as SportData;

const getData = (mode: GameMode): SportData =>
  mode === GameMode.MLB ? mlbData : nflData;

// Pre-compute well-known sets for O(1) lookup
// A player is "well-known" if they have a positive fame score (era-adjusted WAR/AV)
// Falls back to legacy wellKnown list if playerFame is not available
const buildWellKnownSet = (data: SportData): Set<string> => {
  if (data.playerFame) return new Set(Object.keys(data.playerFame));
  return new Set(data.wellKnown ?? []);
};
const mlbWellKnownSet = buildWellKnownSet(mlbData);
const nflWellKnownSet = buildWellKnownSet(nflData);
const getWellKnownSet = (mode: GameMode): Set<string> =>
  mode === GameMode.MLB ? mlbWellKnownSet : nflWellKnownSet;

export const isWellKnown = (mode: GameMode, player: string): boolean =>
  getWellKnownSet(mode).has(player);

// Fuzzy search setup (one per mode)
const mlbFuse = new Fuse(mlbData.players, { threshold: 0.25, minMatchCharLength: 2 });
const nflFuse = new Fuse(nflData.players, { threshold: 0.25, minMatchCharLength: 2 });

export const searchPlayers = (mode: GameMode, query: string): string[] => {
  const fuse = mode === GameMode.MLB ? mlbFuse : nflFuse;
  return fuse.search(query).slice(0, 5).map(result => result.item);
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
// maxVisits caps total nodes visited to avoid freezing on dense graphs (0 = unlimited).
// When wellKnownOnly is true, intermediate nodes (not start/target) must be well-known.
export const findShortestPath = (
  mode: GameMode,
  start: string,
  target: string,
  maxDepth = Infinity,
  wellKnownOnly = false,
  maxVisits = 0,
): PlayerNode[] | null => {
  const data = getData(mode);
  if (!data.playerSeasons[start] || !data.playerSeasons[target]) return null;

  const wkSet = wellKnownOnly ? getWellKnownSet(mode) : null;

  type QItem = { player: string; depth: number };
  const queue: QItem[] = [{ player: start, depth: 0 }];
  const visited = new Set([start]);
  const parent = new Map<string, string>(); // neigh → prev player name
  let head = 0; // index-based queue for O(1) dequeue
  let found = false;

  while (head < queue.length) {
    if (maxVisits > 0 && head >= maxVisits) break;
    const { player: current, depth } = queue[head++];

    if (current === target) { found = true; break; }
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

  if (!found && !parent.has(target)) return null;

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

const DEGREE_RANGE: Record<Difficulty, [number, number]> = {
  Easy: [2, 3],
  Medium: [3, 5],
  Hard: [4, 7],
};

// Fame thresholds per difficulty per mode (era-adjusted WAR for MLB, AV for NFL)
const MLB_FAME_THRESHOLDS: Record<Difficulty, number> = {
  Easy: 30,
  Medium: 15,
  Hard: 5,
};
const NFL_FAME_THRESHOLDS: Record<Difficulty, number> = {
  Easy: 60,
  Medium: 40,
  Hard: 30,
};

// Position filters per difficulty (NFL only)
const EASY_POSITIONS = new Set(['QB', 'RB', 'WR']);
const MEDIUM_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'CB', 'LB', 'S', 'SS', 'FS', 'ILB', 'OLB', 'MLB']);

// Builds the eligible endpoint list for a given difficulty.
// Cached per (mode, difficulty) to avoid recomputing.
const eligibleCache = new Map<string, string[]>();
const buildEndpointEligible = (mode: GameMode, difficulty: Difficulty = 'Easy'): string[] => {
  const key = `${mode}-${difficulty}`;
  if (eligibleCache.has(key)) return eligibleCache.get(key)!;

  const data = getData(mode);
  const fame = data.playerFame ?? {};
  const threshold = mode === GameMode.MLB
    ? MLB_FAME_THRESHOLDS[difficulty]
    : NFL_FAME_THRESHOLDS[difficulty];

  let result: string[];

  if (mode === GameMode.MLB) {
    result = data.players.filter(p => {
      const f = fame[p];
      if (!f || f < threshold) return false;
      // Easy: restrict to players active 1990+
      if (difficulty === 'Easy') {
        const seasons = data.playerSeasons[p] ?? [];
        const hasModernSeason = seasons.some(s => s.year >= 1990);
        if (!hasModernSeason) return false;
      }
      return true;
    });
  } else {
    // NFL: position filters per difficulty
    const posFilter = difficulty === 'Easy' ? EASY_POSITIONS
      : difficulty === 'Medium' ? MEDIUM_POSITIONS
      : null;
    result = data.players.filter(p => {
      const f = fame[p];
      if (!f || f < threshold) return false;
      if (posFilter) {
        const pos = data.playerPositions?.[p] ?? '';
        if (!posFilter.has(pos)) return false;
      }
      return true;
    });
  }

  eligibleCache.set(key, result);
  return result;
};

// Lightweight BFS that only returns the distance (no path reconstruction).
// Much faster for challenge generation where we only need the degree count.
const findDistance = (
  mode: GameMode,
  start: string,
  target: string,
  maxDepth: number,
): number | null => {
  const data = getData(mode);
  if (!data.playerSeasons[start] || !data.playerSeasons[target]) return null;
  if (start === target) return 0;

  type QItem = { player: string; depth: number };
  const queue: QItem[] = [{ player: start, depth: 0 }];
  const visited = new Set([start]);
  let head = 0; // index-based queue for O(1) dequeue

  while (head < queue.length) {
    const { player: current, depth } = queue[head++];
    if (depth >= maxDepth) continue;

    const mySeasons = data.playerSeasons[current];
    for (const r of mySeasons) {
      const key = `${r.team}-${r.year}`;
      const roster = data.teamSeasons[key];
      if (!roster) continue;
      for (const p of roster) {
        if (p === current || visited.has(p)) continue;
        if (p === target) return depth + 1;
        visited.add(p);
        queue.push({ player: p, depth: depth + 1 });
      }
    }
  }

  return null;
};

export const getRandomPlayers = (
  mode: GameMode,
  difficulty: Difficulty = 'Easy',
): { start: string; target: string } | null => {
  const data = getData(mode);
  const pairs = data.challengePairs?.[difficulty];

  // Use pre-computed pairs when available (NFL)
  if (pairs && pairs.length > 0) {
    const idx = Math.floor(Math.random() * pairs.length);
    const [start, target] = pairs[idx];
    // Verify both players still exist in the dataset
    if (data.playerSeasons[start] && data.playerSeasons[target]) {
      return { start, target };
    }
  }

  // Fallback to BFS-based generation (for MLB or if no pairs available)
  const eligible = buildEndpointEligible(mode, difficulty);
  if (eligible.length < 2) return null;

  const [minDeg, maxDeg] = DEGREE_RANGE[difficulty];

  const pick = () => {
    const i1 = Math.floor(Math.random() * eligible.length);
    let i2 = Math.floor(Math.random() * eligible.length);
    while (i2 === i1) i2 = Math.floor(Math.random() * eligible.length);
    return [eligible[i1], eligible[i2]] as const;
  };

  for (let attempt = 0; attempt < 80; attempt++) {
    const [p1, p2] = pick();
    const dist = findDistance(mode, p1, p2, maxDeg);
    if (dist === null || dist < minDeg) continue;
    return { start: p1, target: p2 };
  }

  for (let attempt = 0; attempt < 40; attempt++) {
    const [p1, p2] = pick();
    const dist = findDistance(mode, p1, p2, maxDeg);
    if (dist !== null && dist >= 2) return { start: p1, target: p2 };
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
