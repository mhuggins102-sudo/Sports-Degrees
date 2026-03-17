import React, { useState, useEffect, useRef } from 'react';
import { GameMode, Difficulty, PlayerNode, SolutionResponse } from '../types';
import {
  validateTeammateOffline, findShortestPath, searchPlayers,
  getPlayerPosition, getCareerRange, getPlayerSeasons, isWellKnown,
} from '../src/services/offlineData';
import PlayerCard from './PlayerCard';
import { Loader2, ArrowRight, RotateCcw, AlertCircle, Trophy, Zap, X, Star } from 'lucide-react';

interface ActiveGameProps {
  mode: GameMode;
  difficulty: Difficulty;
  startPlayer: string;
  targetPlayer: string;
  onReset: () => void;
}

// Build a fully-populated PlayerNode (position + career range included)
function makeNode(mode: GameMode, name: string, connectionToPrev?: PlayerNode['connectionToPrev']): PlayerNode {
  return {
    id: `node-${Date.now()}-${Math.random()}`,
    name,
    connectionToPrev,
    position: getPlayerPosition(mode, name),
    careerYears: getCareerRange(mode, name),
  };
}

// Group consecutive same-team seasons into ranges for the popup
function groupSeasons(seasons: Array<{ team: string; year: number }>): Array<{ team: string; range: string }> {
  const sorted = [...seasons].sort((a, b) => a.year - b.year || a.team.localeCompare(b.team));

  // Group by team, then find consecutive runs
  const teamYears = new Map<string, number[]>();
  for (const s of sorted) {
    const arr = teamYears.get(s.team) ?? [];
    arr.push(s.year);
    teamYears.set(s.team, arr);
  }

  const result: Array<{ team: string; range: string; startYear: number }> = [];
  for (const [team, years] of teamYears) {
    const uniqueYears = [...new Set(years)].sort((a, b) => a - b);
    let runStart = uniqueYears[0];
    let runEnd = uniqueYears[0];

    for (let i = 1; i < uniqueYears.length; i++) {
      if (uniqueYears[i] === runEnd + 1) {
        runEnd = uniqueYears[i];
      } else {
        result.push({ team, range: runStart === runEnd ? String(runStart) : `${runStart}–${runEnd}`, startYear: runStart });
        runStart = uniqueYears[i];
        runEnd = uniqueYears[i];
      }
    }
    result.push({ team, range: runStart === runEnd ? String(runStart) : `${runStart}–${runEnd}`, startYear: runStart });
  }

  return result.sort((a, b) => a.startYear - b.startYear);
}

type HintMode = 'optimal' | 'wellKnown';

const ActiveGame: React.FC<ActiveGameProps> = ({ mode, difficulty, startPlayer, targetPlayer, onReset }) => {
  const [chain, setChain] = useState<PlayerNode[]>(() => [{
    id: 'start',
    name: startPlayer,
    position: getPlayerPosition(mode, startPlayer),
    careerYears: getCareerRange(mode, startPlayer),
  }]);

  const [guess, setGuess] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [won, setWon] = useState(false);

  const [solution, setSolution] = useState<SolutionResponse | null>(null);
  const [loadingSolution, setLoadingSolution] = useState(false);

  // Popup: which player's seasons to show (null = closed)
  const [popupPlayer, setPopupPlayer] = useState<string | null>(null);

  // Autocomplete
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSugIdx, setActiveSugIdx] = useState(-1);

  // Hint mode selector
  const [hintMode, setHintMode] = useState<HintMode>('wellKnown');
  const [showHintMenu, setShowHintMenu] = useState(false);
  const hintMenuRef = useRef<HTMLDivElement>(null);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const currentNode = chain[chain.length - 1];
  const isNFL = mode === GameMode.NFL;

  // Close hint menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (hintMenuRef.current && !hintMenuRef.current.contains(e.target as Node)) {
        setShowHintMenu(false);
      }
    };
    if (showHintMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showHintMenu]);

  // Scroll to bottom when chain grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chain.length, won]);

  // ── Core submission ───────────────────────────────────────────────────────

  const submitGuess = (playerName: string) => {
    const trimmed = playerName.trim();
    if (!trimmed || loading || won) return;

    if (chain.some(n => n.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('This player is already in your chain!');
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestions([]);

    const result = validateTeammateOffline(mode, currentNode.name, trimmed);

    if (result.isValid) {
      const newNode = makeNode(mode, result.correctedName, { team: result.team, years: result.years });
      const newChain = [...chain, newNode];
      setChain(newChain);
      setGuess('');

      if (result.correctedName.toLowerCase() === targetPlayer.toLowerCase()) {
        setWon(true);
        fetchSolution();
      }
    } else {
      setError(result.reason ?? 'Invalid connection.');
    }

    setLoading(false);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeSugIdx >= 0 && suggestions[activeSugIdx]) {
      const chosen = suggestions[activeSugIdx];
      setGuess(chosen);
      setSuggestions([]);
      setActiveSugIdx(-1);
      submitGuess(chosen);
    } else {
      submitGuess(guess);
    }
  };

  // ── Autocomplete ──────────────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setGuess(val);
    setError(null);
    setActiveSugIdx(-1);
    setSuggestions(val.length >= 2 ? searchPlayers(mode, val) : []);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSugIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSugIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Escape') { setSuggestions([]); setActiveSugIdx(-1); }
  };

  const selectSuggestion = (player: string) => {
    setGuess(player);
    setSuggestions([]);
    setActiveSugIdx(-1);
    submitGuess(player);
  };

  // ── Hint: auto-add the next optimal player ───────────────────────────────

  const handleHint = (overrideMode?: HintMode) => {
    if (loading || won) return;
    setShowHintMenu(false);
    const effectiveMode = overrideMode ?? hintMode;
    const useWellKnown = effectiveMode === 'wellKnown';
    const HINT_BUDGET = 500_000;
    const path = findShortestPath(mode, currentNode.name, targetPlayer, 10, useWellKnown, HINT_BUDGET);
    if (path && path.length > 1) {
      submitGuess(path[1].name);
    } else if (useWellKnown) {
      // Fall back to optimal if well-known path not found
      const optPath = findShortestPath(mode, currentNode.name, targetPlayer, 10, false, HINT_BUDGET);
      if (optPath && optPath.length > 1) {
        submitGuess(optPath[1].name);
      } else {
        setError('No path found from here to the target.');
      }
    } else {
      setError('No path found from here to the target.');
    }
  };

  // ── Solution (win / surrender) ────────────────────────────────────────────

  const fetchSolution = () => {
    setLoadingSolution(true);
    // Use setTimeout so the loading spinner renders before BFS blocks the thread
    setTimeout(() => {
      // Cap BFS depth and visits to avoid freezing on dense NFL graphs.
      // 500K visits is enough to explore ~3 degrees in NFL; covers most paths.
      const VISIT_BUDGET = 500_000;
      const optPath = findShortestPath(mode, startPlayer, targetPlayer, 10, false, VISIT_BUDGET);
      const wkPath = findShortestPath(mode, startPlayer, targetPlayer, 15, true, VISIT_BUDGET);
      setSolution({
        optimalPath: optPath ?? [],
        optimalDegrees: optPath ? optPath.length - 1 : 0,
        wellKnownPath: wkPath,
        wellKnownDegrees: wkPath ? wkPath.length - 1 : null,
        explanation: optPath ? undefined : 'Could not find a short path. The optimal route may require deep exploration.',
      });
      setLoadingSolution(false);
    }, 50);
  };

  const handleSurrender = () => {
    setWon(true);
    fetchSolution();
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Career years are always visible on all difficulties
  const showCareerYears = (_idx: number) => true;

  const accentActive = isNFL ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white';
  const accentHover  = isNFL ? 'hover:bg-blue-700' : 'hover:bg-emerald-700';

  // Target player info for header display
  const targetPosition = getPlayerPosition(mode, targetPlayer);
  const targetCareer = getCareerRange(mode, targetPlayer);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">

      {/* ── Fixed header ── */}
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 pt-3 pb-2.5 flex items-center justify-between">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Target</span>
          <div className="flex items-baseline gap-2">
            <span className={`text-base font-bold leading-tight ${isNFL ? 'text-blue-400' : 'text-emerald-400'}`}>
              {targetPlayer}
            </span>
            {targetPosition && (
              <span className={`text-xs font-bold uppercase tracking-wide ${isNFL ? 'text-sky-400/70' : 'text-emerald-400/70'}`}>
                {targetPosition}
              </span>
            )}
          </div>
          {targetCareer && (
            <span className="text-xs text-slate-400 leading-tight">{targetCareer}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="text-right mr-1 hidden sm:block">
            <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">Degree</span>
            <span className="block text-lg font-black text-slate-200">{chain.length - 1}</span>
          </div>
          {/* Hint button — tap opens mode menu, selecting fires hint */}
          <div className="relative" ref={hintMenuRef}>
            <button
              onClick={() => setShowHintMenu(v => !v)}
              disabled={loading || won}
              title="Hint"
              className="p-2 rounded-full transition-colors hover:bg-slate-800 text-slate-300 hover:text-yellow-400"
            >
              <Zap className="w-4 h-4" />
            </button>
            {showHintMenu && (
              <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden w-52">
                <button
                  onClick={() => { setHintMode('wellKnown'); handleHint('wellKnown'); }}
                  className={`w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 transition-colors ${hintMode === 'wellKnown' ? (isNFL ? 'bg-blue-900/50 text-blue-200' : 'bg-emerald-900/50 text-emerald-200') : 'text-slate-300 hover:bg-slate-700'}`}
                >
                  <Star className="w-3 h-3" />
                  Well-known player
                </button>
                <button
                  onClick={() => { setHintMode('optimal'); handleHint('optimal'); }}
                  className={`w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 border-t border-slate-700 transition-colors ${hintMode === 'optimal' ? (isNFL ? 'bg-blue-900/50 text-blue-200' : 'bg-emerald-900/50 text-emerald-200') : 'text-slate-300 hover:bg-slate-700'}`}
                >
                  <Zap className="w-3 h-3" />
                  Optimal (any player)
                </button>
              </div>
            )}
          </div>
          <button onClick={onReset} title="New game"
            className="p-2 hover:bg-slate-800 rounded-full text-slate-300 hover:text-slate-100 transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Scrollable card area ── */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-0">
        {chain.map((node, idx) => (
          <PlayerCard
            key={node.id}
            node={node}
            index={idx}
            mode={mode}
            isStart={idx === 0}
            isEnd={idx === chain.length - 1}
            isTarget={node.name === targetPlayer}
            showCareerYears={showCareerYears(idx)}
            onCardClick={() => setPopupPlayer(node.name)}
          />
        ))}

        {/* Ghost target card */}
        {!won && (
          <div className="opacity-75">
            <div className="flex flex-col items-center my-1">
              <div className="h-5 w-px border-l-2 border-dashed border-slate-500" />
            </div>
            <PlayerCard
              node={{ id: 'target', name: targetPlayer, position: targetPosition, careerYears: targetCareer }}
              index={chain.length}
              mode={mode}
              isTarget
              showCareerYears={true}
              onCardClick={() => setPopupPlayer(targetPlayer)}
            />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Input bar (flex-shrink-0 so it sticks to bottom) ── */}
      {!won && (
        <div className="flex-shrink-0 bg-slate-900 border-t border-slate-800 relative">
          {/* Autocomplete — positioned above the input bar */}
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 bg-slate-900 border border-slate-700 rounded-t-xl shadow-2xl overflow-hidden z-50">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); selectSuggestion(s); }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    i === activeSugIdx
                      ? isNFL ? 'bg-blue-900/50 text-blue-200' : 'bg-emerald-900/50 text-emerald-200'
                      : 'text-slate-200 hover:bg-slate-800'
                  } ${i > 0 ? 'border-t border-slate-800' : ''}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="px-4 pt-3 pb-3">
            <form onSubmit={handleFormSubmit}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={guess}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onBlur={() => setTimeout(() => setSuggestions([]), 100)}
                  placeholder={`Who played with ${currentNode.name}?`}
                  disabled={loading}
                  autoFocus
                  autoComplete="off"
                  className={`
                    flex-1 pl-4 py-3 rounded-xl border-2 font-medium outline-none transition-all bg-slate-950 text-white placeholder-slate-500 text-base
                    ${error ? 'border-red-900/50 bg-red-900/10 focus:border-red-500' : 'border-slate-700 focus:border-slate-500'}
                    ${loading ? 'opacity-50' : ''}
                  `}
                />
                <button
                  type="submit"
                  disabled={!guess.trim() || loading}
                  className={`px-4 flex items-center justify-center rounded-xl transition-all ${
                    !guess.trim() || loading
                      ? 'bg-slate-800 text-slate-500'
                      : `${accentActive} ${accentHover}`
                  }`}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            </form>

            {error && (
              <div className="flex items-start gap-1.5 mt-2 text-red-400">
                <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                <p className="text-xs font-medium">{error}</p>
              </div>
            )}

            <div className="mt-2 flex justify-between items-center">
              <p className="text-xs text-slate-400">
                Reach <strong className={isNFL ? 'text-blue-300' : 'text-emerald-300'}>{targetPlayer}</strong>
              </p>
              <button onClick={handleSurrender}
                className="text-xs text-slate-400 hover:text-slate-200 underline">
                Show answer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Player seasons popup ── */}
      {popupPlayer && (() => {
        const grouped = groupSeasons(getPlayerSeasons(mode, popupPlayer));
        const pos = getPlayerPosition(mode, popupPlayer);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setPopupPlayer(null)}
          >
            <div
              className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xs border border-slate-700 overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Career Seasons</p>
                  <div className="flex items-baseline gap-2">
                    <p className={`text-sm font-bold ${isNFL ? 'text-sky-300' : 'text-emerald-300'}`}>{popupPlayer}</p>
                    {pos && (
                      <span className={`text-[10px] font-bold uppercase tracking-wide ${isNFL ? 'text-sky-400/70' : 'text-emerald-400/70'}`}>
                        {pos}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setPopupPlayer(null)}
                  className="p-1.5 hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Table */}
              <div className="overflow-y-auto max-h-72">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-950">
                    <tr>
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-400">Years</th>
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-400">Team</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map((s, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/40'}>
                        <td className="px-4 py-1.5 text-slate-200 font-medium">{s.range}</td>
                        <td className="px-4 py-1.5 text-slate-300">{s.team}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Win modal ── */}
      {won && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-700">
            <div className={`p-5 text-center text-white ${isNFL ? 'bg-blue-700' : 'bg-emerald-700'}`}>
              <h2 className="text-2xl font-bold mb-1">
                {chain[chain.length - 1].name === targetPlayer ? 'You did it!' : 'Game Over'}
              </h2>
              <p className="opacity-90 text-sm">
                Connected in <span className="font-bold text-xl">{chain.length - 1}</span> degree{chain.length - 1 !== 1 ? 's' : ''}.
              </p>
            </div>

            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {loadingSolution ? (
                <div className="flex flex-col items-center py-6 text-slate-300">
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                  <p className="text-sm">Finding optimal path…</p>
                </div>
              ) : solution ? (() => {
                const hasWk = solution.wellKnownPath && solution.wellKnownDegrees !== null;
                const optIsShorter = hasWk && solution.optimalDegrees < solution.wellKnownDegrees!;
                // If well-known exists at same degree count, show only well-known.
                // If optimal is shorter, show both.
                const showOptimal = !hasWk || optIsShorter;
                const showWellKnown = hasWk;

                const renderPath = (path: PlayerNode[], label: string, icon: React.ReactNode, dotColor: string) => (
                  <div className="bg-slate-950 rounded-xl p-4 border border-slate-700">
                    <h3 className="font-bold text-slate-200 mb-3 text-sm flex items-center gap-2">
                      {icon}
                      {label}
                    </h3>
                    <div className="space-y-2 text-sm">
                      {path.map((n, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${i === 0 ? 'bg-slate-500' : dotColor}`} />
                          <div>
                            <span className="font-semibold text-slate-100">{n.name}</span>
                            {n.connectionToPrev && (
                              <span className="text-xs text-slate-400 block">
                                via {n.connectionToPrev.team} ({n.connectionToPrev.years})
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );

                return (
                  <>
                    {showOptimal && solution.optimalPath.length > 0 && renderPath(
                      solution.optimalPath,
                      `Optimal: ${solution.optimalDegrees} degree${solution.optimalDegrees !== 1 ? 's' : ''}`,
                      <Trophy className="w-4 h-4 text-yellow-500" />,
                      isNFL ? 'bg-blue-500' : 'bg-emerald-500',
                    )}
                    {showOptimal && solution.optimalPath.length === 0 && (
                      <div className="bg-slate-950 rounded-xl p-4 border border-slate-700">
                        <h3 className="font-bold text-slate-200 mb-3 text-sm flex items-center gap-2">
                          <Trophy className="w-4 h-4 text-yellow-500" /> Solution unavailable
                        </h3>
                        <p className="text-slate-300 text-sm italic">{solution.explanation}</p>
                      </div>
                    )}
                    {showWellKnown && renderPath(
                      solution.wellKnownPath!,
                      `${optIsShorter ? 'Well-known' : 'Best path'}: ${solution.wellKnownDegrees} degree${solution.wellKnownDegrees !== 1 ? 's' : ''}`,
                      <Star className="w-4 h-4 text-amber-400" />,
                      'bg-amber-500',
                    )}
                  </>
                );
              })() : null}

              <button onClick={onReset}
                className="w-full py-2.5 bg-white text-slate-900 rounded-lg font-bold text-sm hover:bg-slate-200 transition-colors">
                Play Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActiveGame;
