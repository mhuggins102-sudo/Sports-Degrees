import React, { useState } from 'react';
import { GameMode } from '../types';
import { getRandomPlayers, getPlayerCount } from '../src/services/offlineData';
import { Zap, Trophy, Club, Database } from 'lucide-react';

interface GameSetupProps {
  onStart: (mode: GameMode, start: string, target: string) => void;
}

const GameSetup: React.FC<GameSetupProps> = ({ onStart }) => {
  const [mode, setMode] = useState<GameMode>(GameMode.NFL);

  const handleStart = () => {
    const { start, target } = getRandomPlayers(mode);
    onStart(mode, start, target);
  };

  const isNFL = mode === GameMode.NFL;
  const playerCount = getPlayerCount(mode);

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
        <div className="grid grid-cols-2 gap-4 mb-8">
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

        <button
          onClick={handleStart}
          className={`
            w-full py-5 rounded-xl font-bold text-xl text-white shadow-lg transform transition-all active:scale-[0.98] flex items-center justify-center gap-3
            ${isNFL
              ? 'bg-gradient-to-r from-blue-700 to-blue-900 hover:to-blue-800 shadow-blue-900/50'
              : 'bg-gradient-to-r from-emerald-700 to-emerald-900 hover:to-emerald-800 shadow-emerald-900/50'}
          `}
        >
          <Zap className="w-6 h-6 fill-current" />
          <span>Generate Challenge</span>
        </button>

        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500 flex items-center justify-center gap-1.5">
            <Database className="w-3 h-3" />
            {playerCount.toLocaleString()} players loaded offline
          </p>
        </div>
      </div>
    </div>
  );
};

export default GameSetup;
