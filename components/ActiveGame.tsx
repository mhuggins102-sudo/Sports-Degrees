import React, { useState, useEffect, useRef } from 'react';
import { GameMode, PlayerNode, SolutionResponse } from '../types';
import { validateTeammateOffline, findShortestPath, searchPlayers } from '../src/services/offlineData';
import PlayerCard from './PlayerCard';
import { Loader2, ArrowRight, RotateCcw, AlertCircle, Trophy, Zap } from 'lucide-react';

interface ActiveGameProps {
  mode: GameMode;
  startPlayer: string;
  targetPlayer: string;
  onReset: () => void;
}

const ActiveGame: React.FC<ActiveGameProps> = ({ mode, startPlayer, targetPlayer, onReset }) => {
  const [chain, setChain] = useState<PlayerNode[]>([{ id: 'start', name: startPlayer }]);
  const [guess, setGuess] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [won, setWon] = useState(false);

  const [solution, setSolution] = useState<SolutionResponse | null>(null);
  const [loadingSolution, setLoadingSolution] = useState(false);

  const [hint, setHint] = useState<string | null>(null);

  // Autocomplete
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSugIdx, setActiveSugIdx] = useState(-1);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chain, won, hint]);

  const currentNode = chain[chain.length - 1];
  const isNFL = mode === GameMode.NFL;

  // ── Submission logic ────────────────────────────────────────────────────

  const submitGuess = (playerName: string) => {
    const trimmed = playerName.trim();
    if (!trimmed || loading || won) return;

    if (chain.some(n => n.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('This player is already in your chain!');
      return;
    }

    setLoading(true);
    setError(null);
    setHint(null);
    setSuggestions([]);

    const result = validateTeammateOffline(mode, currentNode.name, trimmed);

    if (result.isValid) {
      const newNode: PlayerNode = {
        id: `node-${Date.now()}`,
        name: result.correctedName,
        connectionToPrev: { team: result.team, years: result.years },
      };
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
    // If a suggestion is highlighted, use it; otherwise use raw input
    if (activeSugIdx >= 0 && suggestions[activeSugIdx]) {
      setGuess(suggestions[activeSugIdx]);
      setSuggestions([]);
      setActiveSugIdx(-1);
      submitGuess(suggestions[activeSugIdx]);
    } else {
      submitGuess(guess);
    }
  };

  // ── Autocomplete ─────────────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setGuess(val);
    setError(null);
    setActiveSugIdx(-1);
    setSuggestions(val.length >= 2 ? searchPlayers(mode, val) : []);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSugIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSugIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setSuggestions([]);
      setActiveSugIdx(-1);
    }
  };

  const selectSuggestion = (player: string) => {
    setGuess(player);
    setSuggestions([]);
    setActiveSugIdx(-1);
    submitGuess(player);
  };

  // ── Hint / Solution ──────────────────────────────────────────────────────

  const handleHint = () => {
    if (loading || won) return;
    const path = findShortestPath(mode, currentNode.name, targetPlayer);
    if (path && path.length > 1) {
      setHint(`Try: ${path[1].name}`);
    } else {
      setHint('No hint available.');
    }
  };

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full max-w-2xl mx-auto pb-36">

      {/* Sticky Header */}
      <div className="sticky top-4 z-20 flex justify-between items-center bg-slate-900/90 backdrop-blur-md px-4 py-3 rounded-xl shadow-lg border border-slate-800 mb-6 mx-4 md:mx-0">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">Target</span>
          <span className={`text-base font-bold ${isNFL ? 'text-blue-400' : 'text-emerald-400'}`}>{targetPlayer}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right hidden sm:block mr-1">
            <span className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Degree</span>
            <span className="block text-lg font-black text-slate-200">{chain.length - 1}</span>
          </div>
          <button onClick={handleHint} disabled={loading || won} title="Hint"
            className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-yellow-400 transition-colors">
            <Zap className="w-4 h-4" />
          </button>
          <button onClick={onReset} title="New game"
            className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-200 transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Hint */}
      {hint && (
        <div className="mx-4 md:mx-0 mb-4 px-3 py-2 bg-yellow-900/20 border border-yellow-700/30 text-yellow-200 rounded-lg text-sm flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
          {hint}
        </div>
      )}

      {/* Chain */}
      <div className="space-y-0 px-4">
        {chain.map((node, idx) => (
          <PlayerCard
            key={node.id}
            node={node}
            index={idx}
            mode={mode}
            isStart={idx === 0}
            isEnd={idx === chain.length - 1}
            isTarget={node.name === targetPlayer}
          />
        ))}

        {/* Ghost target */}
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
            />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Win Modal */}
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

      {/* Input bar */}
      {!won && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 p-3 shadow-lg z-40">
          <div className="max-w-2xl mx-auto">
            <form onSubmit={handleFormSubmit} className="relative">
              {/* Autocomplete dropdown (appears above input) */}
              {suggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute bottom-full left-0 right-0 mb-1.5 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50"
                >
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
                    flex-1 pl-4 pr-12 py-3.5 rounded-xl border-2 font-medium outline-none transition-all bg-slate-950 text-white placeholder-slate-600
                    ${error ? 'border-red-900/50 bg-red-900/10 focus:border-red-500' : 'border-slate-800 focus:border-slate-600'}
                    ${loading ? 'opacity-50' : ''}
                  `}
                />
                <button
                  type="submit"
                  disabled={!guess.trim() || loading}
                  className={`
                    px-4 flex items-center justify-center rounded-xl transition-all
                    ${!guess.trim() || loading
                      ? 'bg-slate-800 text-slate-600'
                      : isNFL ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'}
                  `}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            </form>

            {error && (
              <div className="flex items-start gap-2 mt-2 text-red-400">
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <p className="text-xs font-medium">{error}</p>
              </div>
            )}

            <div className="mt-2 flex justify-between items-center px-0.5">
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
    </div>
  );
};

export default ActiveGame;
