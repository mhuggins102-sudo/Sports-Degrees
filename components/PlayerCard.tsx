import React from 'react';
import { PlayerNode, GameMode } from '../types';
import { User, Shield, Trophy } from 'lucide-react';

interface PlayerCardProps {
  node: PlayerNode;
  isStart?: boolean;
  isEnd?: boolean;
  isTarget?: boolean;
  mode: GameMode;
  index: number;
}

const PlayerCard: React.FC<PlayerCardProps> = ({ node, isStart, isEnd, isTarget, mode, index }) => {
  const isNFL = mode === GameMode.NFL;
  
  // Dynamic styles based on state and mode
  const baseBorder = isNFL ? 'border-sky-700' : 'border-emerald-700';
  const baseBg = isNFL ? 'bg-sky-900/40' : 'bg-emerald-900/40';
  const iconColor = isNFL ? 'text-sky-400' : 'text-emerald-400';
  
  const activeClass = isEnd && !isTarget ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-yellow-500 scale-105 shadow-xl shadow-yellow-900/20' : '';
  const targetClass = isTarget ? `border-dashed ${isNFL ? 'border-sky-500/50 bg-sky-900/20' : 'border-emerald-500/50 bg-emerald-900/20'}` : '';

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto relative fade-in-up">
      {/* Connection Info (if not first) */}
      {node.connectionToPrev && (
        <div className={`flex flex-col items-center my-2 animate-fadeIn`}>
          <div className={`h-8 w-1 ${isNFL ? 'bg-sky-800' : 'bg-emerald-800'}`}></div>
          <div className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-sm border ${isNFL ? 'bg-slate-900 border-sky-800 text-sky-400' : 'bg-slate-900 border-emerald-800 text-emerald-400'}`}>
            {node.connectionToPrev.team} <span className="opacity-50 mx-1">|</span> {node.connectionToPrev.years}
          </div>
          <div className={`h-8 w-1 ${isNFL ? 'bg-sky-800' : 'bg-emerald-800'}`}></div>
        </div>
      )}

      {/* The Card */}
      <div 
        className={`
          relative w-full p-4 rounded-xl border-2 transition-all duration-300
          ${isTarget ? targetClass : `${baseBg} ${baseBorder} shadow-lg`}
          ${activeClass}
        `}
      >
        <div className="flex items-center space-x-4">
          <div className={`p-3 rounded-full ${isNFL ? 'bg-sky-950 border border-sky-800' : 'bg-emerald-950 border border-emerald-800'}`}>
            {isStart ? <Shield className={`w-6 h-6 ${iconColor}`} /> : 
             isTarget ? <Trophy className={`w-6 h-6 ${iconColor}`} /> :
             <User className={`w-6 h-6 ${iconColor}`} />
            }
          </div>
          
          <div className="flex-1">
            <p className={`text-xs font-semibold uppercase tracking-wider opacity-70 ${isNFL ? 'text-sky-300' : 'text-emerald-300'}`}>
              {isStart ? 'Start Player' : isTarget ? 'Target Player' : `Link #${index}`}
            </p>
            <h3 className={`text-xl font-bold ${isNFL ? 'text-white' : 'text-white'}`}>
              {node.name}
            </h3>
          </div>
        </div>
        
        {isEnd && !isTarget && (
          <div className="absolute -right-2 -top-2">
            <span className="relative flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-yellow-500"></span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlayerCard;
