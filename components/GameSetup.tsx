import React, { useState } from 'react';
import { GameMode, Difficulty } from '../types';
import { generateChallenge } from '../services/geminiService';
import { Loader2, Zap, Trophy, Club } from 'lucide-react';

interface GameSetupProps {
  onStart: (mode: GameMode, start: string, target: string) => void;
}

const GameSetup: React.FC<GameSetupProps> = ({ onStart }) => {
  const [mode, setMode] = useState<GameMode>(GameMode.NFL);
  const [difficulty, setDifficulty] = useState<Difficulty>('Easy');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setGenerating(true);
    setError(null);

    try {
      const challenge = await generateChallenge(mode, difficulty);
      if (challenge.start && challenge.target) {
        onStart(mode, challenge.start, challenge.target);
      } else {
        setError("Could not generate a challenge. Please try again.");
      }
    } catch (e) {
      setError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const isNFL = mode === GameMode.NFL;

  return (
    <div className="w-full max-w-lg bg-slate-900 rounded-2xl shadow-xl overflow-hidden border border-slate-800">
      <div className="p-10">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-extrabold text-white tracking-tight mb-3">
            Sports <span className={isNFL ? 'text-blue-500' : 'text-emerald-500'}>Degrees</span>
          </h1>
          <p className="text-slate-400 text-lg">
            Test your knowledge. We pick the players, you find the connection.
          </p>
        </div>

        {/* Mode Select Cards */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            onClick={() => setMode(GameMode.NFL)}
            className={`
              relative p-6 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-3
              ${isNFL 
                ? 'border-blue-600 bg-blue-900/20 text-blue-400 shadow-md ring-2 ring-blue-900' 
                : 'border-slate-800 bg-slate-900 text-slate-500 hover:border-slate-700 hover:bg-slate-800'}
            `}
          >
            <Trophy className={`w-10 h-10 ${isNFL ? 'text-blue-500' : 'text-slate-600'}`} />
            <span className="font-black text-xl">NFL</span>
            {isNFL && (
              <span className="absolute top-2 right-2 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
              </span>
            )}
          </button>

          <button
            onClick={() => setMode(GameMode.MLB)}
            className={`
              relative p-6 rounded-xl border-2 transition-all flex flex-col items-center justify-center gap-3
              ${!isNFL 
                ? 'border-emerald-600 bg-emerald-900/20 text-emerald-400 shadow-md ring-2 ring-emerald-900' 
                : 'border-slate-800 bg-slate-900 text-slate-500 hover:border-slate-700 hover:bg-slate-800'}
            `}
          >
            <Club className={`w-10 h-10 ${!isNFL ? 'text-emerald-500' : 'text-slate-600'}`} />
            <span className="font-black text-xl">MLB</span>
             {!isNFL && (
              <span className="absolute top-2 right-2 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            )}
          </button>
        </div>

        {/* Difficulty Selection */}
        <div className="mb-8">
            <div className="flex justify-center gap-2 bg-slate-950 p-1 rounded-xl border border-slate-800">
                {(['Easy', 'Medium', 'Hard'] as Difficulty[]).map((d) => (
                    <button
                        key={d}
                        onClick={() => setDifficulty(d)}
                        className={`
                            flex-1 py-2 rounded-lg text-sm font-bold transition-all
                            ${difficulty === d 
                                ? (isNFL ? 'bg-blue-600 text-white shadow-lg' : 'bg-emerald-600 text-white shadow-lg') 
                                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'}
                        `}
                    >
                        {d}
                    </button>
                ))}
            </div>
            <p className="text-center text-xs text-slate-500 mt-2">
                {difficulty === 'Easy' && "Same generation (2-4 degrees)"}
                {difficulty === 'Medium' && "Different generations (2-5 degrees)"}
                {difficulty === 'Hard' && "No overlap (3-7 degrees)"}
            </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 text-red-400 text-sm rounded-lg border border-red-800 font-medium text-center">
            {error}
          </div>
        )}

        <button
          onClick={handleStart}
          disabled={generating}
          className={`
            w-full py-5 rounded-xl font-bold text-xl text-white shadow-lg transform transition-all active:scale-[0.98] flex items-center justify-center gap-3
            ${isNFL 
              ? 'bg-gradient-to-r from-blue-700 to-blue-900 hover:to-blue-800 shadow-blue-900/50' 
              : 'bg-gradient-to-r from-emerald-700 to-emerald-900 hover:to-emerald-800 shadow-emerald-900/50'}
            ${generating ? 'opacity-80 cursor-wait' : ''}
          `}
        >
          {generating ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Finding Players...</span>
            </>
          ) : (
            <>
              <Zap className="w-6 h-6 fill-current" />
              <span>Generate Challenge</span>
            </>
          )}
        </button>

        <div className="mt-6 text-center">
            <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                Powered by AI • Infinite Combinations
            </p>
        </div>
      </div>
    </div>
  );
};

export default GameSetup;