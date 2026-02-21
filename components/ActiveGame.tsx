import React, { useState, useEffect, useRef } from 'react';
import { GameMode, Difficulty, PlayerNode, SolutionResponse } from '../types';
import {
  validateTeammateOffline, findShortestPath, searchPlayers,
  getPlayerPosition, getCareerRange, getPlayerSeasons,
} from '../src/services/offlineData';
import PlayerCard from './PlayerCard';
import { Loader2, ArrowRight, RotateCcw, AlertCircle, Trophy, Zap, X } from 'lucide-react';

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

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const currentNode = chain[chain.length - 1];
  const isNFL = mode === GameMode.NFL;

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

  const handleHint = () => {
    if (loading || won) return;
    const path = findShortestPath(mode, currentNode.name, targetPlayer);
    if (path && path.length > 1) {
      submitGuess(path[1].name);
    } else {
      setError('No path found from here to the target.');
    }
  };

  // ── Solution (win / surrender) ────────────────────────────────────────────

  const fetchSolution = () => {
    setLoadingSolution(true);
    const path = findShortestPath(mode, startPlayer, targetPlayer);
    setSolution(
      path
        ? { path, degrees: path.length - 1 }
        : { path: [], degrees: 0, explanation: 'Could not find a path in the offline database.' }
    );
    setLoadingSolution(false);
  };

  const handleSurrender = () => {
    setWon(true);
    fetchSolution();
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Career years are shown on a card as soon as the NEXT card exists,
  // except in Easy mode where they show immediately on every card.
  const showCareerYears = (idx: number) =>
    difficulty === 'Easy' || idx < chain.length - 1;

  const accentActive = isNFL ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white';
  const accentHover  = isNFL ? 'hover:bg-blue-700' : 'hover:bg-emerald-700';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">

      {/* ── Fixed header ── */}
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 pt-3 pb-2.5 flex items-center justify-between">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Target</span>
          <span className={`text-base font-bold leading-tight ${isNFL ? 'text-blue-400' : 'text-emerald-400'}`}>
            {targetPlayer}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="text-right mr-1 hidden sm:block">
            <span className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Degree</span>
            <span className="block text-lg font-black text-slate-200">{chain.length - 1}</span>
          </div>
          <button
            onClick={handleHint}
            disabled={loading || won}
            title="Auto-add next player"
            className="p-2 rounded-full transition-colors hover:bg-slate-800 text-slate-400 hover:text-yellow-400"
          >
            <Zap className="w-4 h-4" />
          </button>
          <button onClick={onReset} title="New game"
            className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-200 transition-colors">
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
          <div className="opacity-35 grayscale pointer-events-none">
            <div className="flex flex-col items-center my-1">
              <div className="h-5 w-px border-l-2 border-dashed border-slate-500" />
            </div>
            <PlayerCard
              node={{ id: 'target', name: targetPlayer }}
              index={chain.length}
              mode={mode}
              isTarget
              showCareerYears={false}
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
                      : 'text-slate-300 hover:bg-slate-800'
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
                    flex-1 pl-4 py-3 rounded-xl border-2 font-medium outline-none transition-all bg-slate-950 text-white placeholder-slate-600 text-sm
                    ${error ? 'border-red-900/50 bg-red-900/10 focus:border-red-500' : 'border-slate-800 focus:border-slate-600'}
                    ${loading ? 'opacity-50' : ''}
                  `}
                />
                <button
                  type="submit"
                  disabled={!guess.trim() || loading}
                  className={`px-4 flex items-center justify-center rounded-xl transition-all ${
                    !guess.trim() || loading
                      ? 'bg-slate-800 text-slate-600'
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
              <p className="text-xs text-slate-600">
                Reach <strong className="text-slate-400">{targetPlayer}</strong>
              </p>
              <button onClick={handleSurrender}
                className="text-xs text-slate-600 hover:text-slate-300 underline">
                Show answer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Player seasons popup ── */}
      {popupPlayer && (() => {
        const seasons = [...getPlayerSeasons(mode, popupPlayer)].sort((a, b) => a.year - b.year || a.team.localeCompare(b.team));
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setPopupPlayer(null)}
          >
            <div
              className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xs border border-slate-800 overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Career Seasons</p>
                  <p className={`text-sm font-bold ${isNFL ? 'text-sky-300' : 'text-emerald-300'}`}>{popupPlayer}</p>
                </div>
                <button
                  onClick={() => setPopupPlayer(null)}
                  className="p-1.5 hover:bg-slate-800 rounded-full text-slate-500 hover:text-slate-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Table */}
              <div className="overflow-y-auto max-h-72">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-950">
                    <tr>
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">Season</th>
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-500">Team</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seasons.map((s, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/40'}>
                        <td className="px-4 py-1.5 text-slate-300 font-medium">{s.year}</td>
                        <td className="px-4 py-1.5 text-slate-400">{s.team}</td>
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
          <div className="bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-800">
            <div className={`p-5 text-center text-white ${isNFL ? 'bg-blue-700' : 'bg-emerald-700'}`}>
              <h2 className="text-2xl font-bold mb-1">
                {chain[chain.length - 1].name === targetPlayer ? 'You did it!' : 'Game Over'}
              </h2>
              <p className="opacity-90 text-sm">
                Connected in <span className="font-bold text-xl">{chain.length - 1}</span> degree{chain.length - 1 !== 1 ? 's' : ''}.
              </p>
            </div>

            <div className="p-5 space-y-4">
              {loadingSolution ? (
                <div className="flex flex-col items-center py-6 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin mb-2" />
                  <p className="text-sm">Finding optimal path…</p>
                </div>
              ) : solution ? (
                <div className="bg-slate-950 rounded-xl p-4 border border-slate-800">
                  <h3 className="font-bold text-slate-300 mb-3 text-sm flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-yellow-500" />
                    {solution.path.length > 0
                      ? `Optimal: ${solution.degrees} degree${solution.degrees !== 1 ? 's' : ''}`
                      : 'Solution unavailable'}
                  </h3>
                  {solution.path.length > 0 ? (
                    <div className="space-y-2 text-sm">
                      {solution.path.map((n, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${i === 0 ? 'bg-slate-600' : isNFL ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                          <div>
                            <span className="font-semibold text-slate-200">{n.name}</span>
                            {n.connectionToPrev && (
                              <span className="text-xs text-slate-500 block">
                                via {n.connectionToPrev.team} ({n.connectionToPrev.years})
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-sm italic">{solution.explanation}</p>
                  )}
                </div>
              ) : null}

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
