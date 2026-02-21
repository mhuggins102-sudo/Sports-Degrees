import React, { useState } from 'react';
import { GameMode, Difficulty } from '../types';
import { getRandomPlayers, getPlayerCount } from '../src/services/offlineData';
import { Zap, Trophy, Club, Database, Loader2 } from 'lucide-react';

interface GameSetupProps {
  onStart: (mode: GameMode, start: string, target: string, difficulty: Difficulty) => void;
}

const DIFFICULTY_DESC: Record<Difficulty, string> = {
  Easy:   'Same generation • careers overlap 3+ yrs • 2–4 degrees',
  Medium: 'Near misses • careers overlap 1–2 yrs • 3+ degrees',
  Hard:   'Different eras • no career overlap • 3+ degrees',
};

const GameSetup: React.FC<GameSetupProps> = ({ onStart }) => {
  const [mode, setMode] = useState<GameMode>(GameMode.NFL);
  const [difficulty, setDifficulty] = useState<Difficulty>('Easy');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = () => {
    setGenerating(true);
    setError(null);
    // Defer the CPU-intensive BFS so React can paint the loading state first
    setTimeout(() => {
      const result = getRandomPlayers(mode, difficulty);
      if (result) {
        onStart(mode, result.start, result.target, difficulty);
      } else {
        setError('Could not generate a valid challenge. Please try again.');
        setGenerating(false);
      }
    }, 30);
  };

  const isNFL = mode === GameMode.NFL;
  const accent = isNFL ? 'blue' : 'emerald';

  return (
    <div className="w-full max-w-lg bg-slate-900 rounded-2xl shadow-xl border border-slate-800">
      <div className="p-8">

        {/* Title */}
        <div className="text-center mb-7">
          <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">
            Sports{' '}
            <span className={isNFL ? 'text-blue-500' : 'text-emerald-500'}>
              Degrees
            </span>
          </h1>
          <p className="text-slate-400 text-sm">
            We pick the players — you find the connection.
          </p>
        </div>

        {/* Sport Mode */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            onClick={() => setMode(GameMode.NFL)}
            className={`
              relative p-5 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-2
              ${isNFL
                ? 'border-blue-600 bg-blue-900/20 text-blue-400 ring-2 ring-blue-900'
                : 'border-slate-800 bg-slate-900 text-slate-500 hover:border-slate-700 hover:bg-slate-800'}
            `}
          >
            <Trophy className={`w-9 h-9 ${isNFL ? 'text-blue-500' : 'text-slate-600'}`} />
            <span className="font-black text-xl">NFL</span>
            {isNFL && (
              <span className="absolute top-2 right-2 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
              </span>
            )}
          </button>

          <button
            onClick={() => setMode(GameMode.MLB)}
            className={`
              relative p-5 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-2
              ${!isNFL
                ? 'border-emerald-600 bg-emerald-900/20 text-emerald-400 ring-2 ring-emerald-900'
                : 'border-slate-800 bg-slate-900 text-slate-500 hover:border-slate-700 hover:bg-slate-800'}
            `}
          >
            <Club className={`w-9 h-9 ${!isNFL ? 'text-emerald-500' : 'text-slate-600'}`} />
            <span className="font-black text-xl">MLB</span>
            {!isNFL && (
              <span className="absolute top-2 right-2 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </span>
            )}
          </button>
        </div>

        {/* Difficulty */}
        <div className="mb-6">
          <div className={`flex gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 mb-2`}>
            {(['Easy', 'Medium', 'Hard'] as Difficulty[]).map(d => (
              <button
                key={d}
                onClick={() => setDifficulty(d)}
                className={`
                  flex-1 py-2 rounded-lg text-sm font-bold transition-all
                  ${difficulty === d
                    ? isNFL
                      ? 'bg-blue-600 text-white shadow'
                      : 'bg-emerald-600 text-white shadow'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}
                `}
              >
                {d}
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-slate-500 leading-relaxed">
            {DIFFICULTY_DESC[difficulty]}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-900/30 text-red-400 text-sm rounded-lg border border-red-800 text-center">
            {error}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleStart}
          disabled={generating}
          className={`
            w-full py-4 rounded-xl font-bold text-lg text-white shadow-lg transition-all active:scale-[0.98]
            flex items-center justify-center gap-2
            ${isNFL
              ? 'bg-gradient-to-r from-blue-700 to-blue-900 hover:to-blue-800 shadow-blue-900/50'
              : 'bg-gradient-to-r from-emerald-700 to-emerald-900 hover:to-emerald-800 shadow-emerald-900/50'}
            ${generating ? 'opacity-80 cursor-wait' : ''}
          `}
        >
          {generating ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Finding players…
            </>
          ) : (
            <>
              <Zap className="w-5 h-5 fill-current" />
              Generate Challenge
            </>
          )}
        </button>

        {/* Footer */}
        <p className="mt-4 text-center text-xs text-slate-600 flex items-center justify-center gap-1.5">
          <Database className="w-3 h-3" />
          {getPlayerCount(mode).toLocaleString()} players loaded offline
        </p>

      </div>
    </div>
  );
};

export default GameSetup;
