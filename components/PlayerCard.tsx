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
  showCareerYears: boolean;
}

const PlayerCard: React.FC<PlayerCardProps> = ({ node, isStart, isEnd, isTarget, mode, index, showCareerYears }) => {
  const isNFL = mode === GameMode.NFL;

  const borderColor   = isNFL ? 'border-sky-700'              : 'border-emerald-700';
  const bgColor       = isNFL ? 'bg-sky-900/40'               : 'bg-emerald-900/40';
  const iconRingColor = isNFL ? 'bg-sky-950 border-sky-800'   : 'bg-emerald-950 border-emerald-800';
  const iconColor     = isNFL ? 'text-sky-400'                : 'text-emerald-400';
  const labelColor    = isNFL ? 'text-sky-300'                : 'text-emerald-300';
  const connColor     = isNFL ? 'bg-sky-800'                  : 'bg-emerald-800';
  const connBorder    = isNFL ? 'border-sky-800 text-sky-400' : 'border-emerald-800 text-emerald-400';

  const activeRing = isEnd && !isTarget
    ? 'ring-2 ring-offset-1 ring-offset-slate-900 ring-yellow-500 scale-[1.02] shadow-lg shadow-yellow-900/20'
    : '';

  const targetStyle = isTarget
    ? `border-dashed ${isNFL ? 'border-sky-500/50 bg-sky-900/20' : 'border-emerald-500/50 bg-emerald-900/20'}`
    : `${bgColor} ${borderColor} shadow`;

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto">
      {/* Connector between cards */}
      {node.connectionToPrev && (
        <div className="flex flex-col items-center my-1">
          <div className={`h-3 w-px ${connColor}`} />
          <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border bg-slate-900 ${connBorder}`}>
            {node.connectionToPrev.team}
            <span className="opacity-40 mx-1">|</span>
            {node.connectionToPrev.years}
          </div>
          <div className={`h-3 w-px ${connColor}`} />
        </div>
      )}

      {/* Card */}
      <div className={`relative w-full px-3 py-2.5 rounded-lg border-2 transition-all duration-300 ${targetStyle} ${activeRing}`}>
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className={`p-1.5 rounded-full border flex-shrink-0 ${iconRingColor}`}>
            {isStart  ? <Shield  className={`w-3.5 h-3.5 ${iconColor}`} /> :
             isTarget ? <Trophy  className={`w-3.5 h-3.5 ${iconColor}`} /> :
                        <User    className={`w-3.5 h-3.5 ${iconColor}`} />}
          </div>

          {/* Name + meta */}
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] font-semibold uppercase tracking-wide opacity-60 ${labelColor}`}>
              {isStart ? 'Start' : isTarget ? 'Target' : `Link #${index}`}
            </p>

            {/* Name row: player name + position badge */}
            <div className="flex items-baseline gap-2 min-w-0">
              <h3 className="text-sm font-bold text-white leading-tight truncate">
                {node.name}
              </h3>
              {node.position && (
                <span className={`text-[10px] font-bold uppercase tracking-wide flex-shrink-0 ${isNFL ? 'text-sky-400' : 'text-emerald-400'}`}>
                  {node.position}
                </span>
              )}
            </div>

            {/* Career years — shown when showCareerYears is true */}
            {showCareerYears && node.careerYears && (
              <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                {node.careerYears}
              </p>
            )}
          </div>
        </div>

        {/* Active pulse dot */}
        {isEnd && !isTarget && (
          <span className="absolute -right-1.5 -top-1.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-yellow-500" />
          </span>
        )}
      </div>
    </div>
  );
};

export default PlayerCard;
