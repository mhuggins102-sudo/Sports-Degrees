import React, { useState, useEffect, useRef } from 'react';
import { GameMode, PlayerNode, TeammateValidationResponse, SolutionResponse } from '../types';
import { validateTeammate, findShortestPath } from '../services/geminiService';
import PlayerCard from './PlayerCard';
import { Loader2, ArrowRight, RotateCcw, HelpCircle, AlertCircle, Trophy, Zap } from 'lucide-react';

interface ActiveGameProps {
  mode: GameMode;
  startPlayer: string;
  targetPlayer: string;
  onReset: () => void;
}

const ActiveGame: React.FC<ActiveGameProps> = ({ mode, startPlayer, targetPlayer, onReset }) => {
  const [chain, setChain] = useState<PlayerNode[]>([
    { id: 'start', name: startPlayer }
  ]);
  const [guess, setGuess] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [won, setWon] = useState(false);
  
  // Solution state
  const [showingSolution, setShowingSolution] = useState(false);
  const [solution, setSolution] = useState<SolutionResponse | null>(null);
  const [loadingSolution, setLoadingSolution] = useState(false);

  const [hint, setHint] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto scroll to bottom when chain updates
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chain, won, hint]);

  const currentNode = chain[chain.length - 1];

  const handleHint = async () => {
    if (loading || won) return;
    setLoading(true);
    try {
      const result = await findShortestPath(currentNode.name, targetPlayer, mode);
      if (result.path && result.path.length > 1) {
        // path[0] is start, path[1] is next step
        setHint(`Try connecting to: ${result.path[1].name}`);
      } else {
        setHint("No hint available (path not found in database).");
      }
    } catch (e) {
      setHint("Could not generate hint.");
    }
    setLoading(false);
  };

  const handleGuess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guess.trim() || loading || won) return;

    // Local check for duplicates
    if (chain.some(node => node.name.toLowerCase() === guess.trim().toLowerCase())) {
        setError("This player is already in your chain!");
        return;
    }
    if (guess.trim().toLowerCase() === currentNode.name.toLowerCase()) {
        setError("You are already at this player.");
        return;
    }

    setLoading(true);
    setError(null);
    setHint(null);

    const result: TeammateValidationResponse = await validateTeammate(
      { name: currentNode.name },
      guess,
      mode
    );

    if (result.isValid && result.correctedName) {
      const newNode: PlayerNode = {
        id: `node-${Date.now()}`,
        name: result.correctedName,
        connectionToPrev: {
          team: result.team || 'Unknown Team',
          years: result.years || 'Unknown Years'
        }
      };
      
      const newChain = [...chain, newNode];
      setChain(newChain);
      setGuess('');
      
      // Check win condition
      if (result.correctedName.toLowerCase() === targetPlayer.toLowerCase()) {
        setWon(true);
        // Pre-fetch solution for comparison
        fetchSolution(); 
      }
    } else {
      setError(result.reason || "Invalid connection.");
    }

    setLoading(false);
  };

  const fetchSolution = async () => {
    setLoadingSolution(true);
    const result = await findShortestPath(startPlayer, targetPlayer, mode);
    setSolution(result);
    setLoadingSolution(false);
  };

  const handleSurrender = () => {
    setWon(true); // Technically ended
    fetchSolution();
    setShowingSolution(true);
  };

  const isNFL = mode === GameMode.NFL;
  const themeColor = isNFL ? 'blue' : 'emerald';

  return (
    <div className="w-full max-w-2xl mx-auto pb-32">
        {/* Header - Sticky */}
        <div className="sticky top-4 z-20 flex justify-between items-center bg-slate-900/90 backdrop-blur-md p-4 rounded-xl shadow-lg border border-slate-800 mb-8 mx-4 md:mx-0">
            <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Target</span>
                <span className={`text-lg font-bold ${isNFL ? 'text-blue-400' : 'text-emerald-400'}`}>{targetPlayer}</span>
            </div>
            <div className="flex items-center gap-3">
                 <div className="text-right hidden sm:block">
                    <span className="block text-[10px] uppercase font-bold text-slate-500 tracking-wider">Current Degree</span>
                    <span className="block text-xl font-black text-slate-200">{chain.length - 1}</span>
                </div>
                <button 
                    onClick={handleHint}
                    disabled={loading || won}
                    className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-yellow-400 transition-colors"
                    title="Get Hint"
                >
                    <Zap className="w-5 h-5" />
                </button>
                <button 
                    onClick={onReset}
                    className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-200 transition-colors"
                    title="Restart"
                >
                    <RotateCcw className="w-5 h-5" />
                </button>
            </div>
        </div>

        {/* Hint Display */}
        {hint && (
          <div className="mx-4 md:mx-0 mb-6 p-3 bg-yellow-900/20 border border-yellow-700/30 text-yellow-200 rounded-lg text-sm flex items-center gap-2 animate-fadeIn">
            <Zap className="w-4 h-4 text-yellow-400" />
            {hint}
          </div>
        )}

      {/* The Chain */}
      <div className="space-y-2 px-4">
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

        {/* Pending Target Card Ghost */}
        {!won && (
             <div className="opacity-40 grayscale pointer-events-none transform scale-95 mt-8">
                <div className="flex flex-col items-center my-2">
                    <div className="h-8 w-1 border-l-2 border-dashed border-slate-300"></div>
                </div>
                <PlayerCard 
                    node={{ id: 'target', name: targetPlayer }} 
                    index={chain.length} 
                    mode={mode} 
                    isTarget={true}
                />
            </div>
        )}
        
        <div ref={bottomRef} />
      </div>

      {/* Win / End State */}
      {won && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
            <div className="bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-800">
                <div className={`p-6 text-center text-white ${isNFL ? 'bg-blue-700' : 'bg-emerald-700'}`}>
                    <h2 className="text-3xl font-bold mb-2">
                        {chain[chain.length-1].name === targetPlayer ? "Game Over!" : "Game Ended"}
                    </h2>
                    <p className="opacity-90">
                       You connected them in <span className="font-bold text-2xl">{chain.length - 1}</span> degrees.
                    </p>
                </div>

                <div className="p-6 space-y-6">
                    {loadingSolution ? (
                        <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                             <Loader2 className="w-8 h-8 animate-spin mb-2" />
                             <p>Consulting the archives for the optimal path...</p>
                        </div>
                    ) : solution ? (
                        <div className="bg-slate-950 rounded-xl p-4 border border-slate-800">
                            <h3 className="font-bold text-slate-300 mb-3 flex items-center gap-2">
                                <Trophy className="w-4 h-4 text-yellow-500" />
                                {solution.path.length > 0 ? `Optimal Path (${solution.degrees} degrees)` : 'Solution Unavailable'}
                            </h3>
                            
                            {solution.path.length > 0 ? (
                                <div className="space-y-3 text-sm">
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
                                <div className="text-slate-400 text-sm italic">
                                    {solution.explanation || "Could not calculate a path for these players in the offline database."}
                                </div>
                            )}
                        </div>
                    ) : null}

                    <div className="grid grid-cols-2 gap-3">
                         <button 
                            onClick={onReset}
                            className="col-span-2 py-3 bg-white text-slate-900 rounded-lg font-bold hover:bg-slate-200 transition-colors"
                        >
                            Play Again
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Input Controls */}
      {!won && (
        <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 p-4 shadow-lg-up z-40">
            <div className="max-w-2xl mx-auto">
                <form onSubmit={handleGuess} className="flex gap-2 relative">
                    <input
                        type="text"
                        value={guess}
                        onChange={(e) => setGuess(e.target.value)}
                        placeholder={`Who played with ${currentNode.name}?`}
                        disabled={loading}
                        className={`
                            flex-1 pl-4 pr-12 py-4 rounded-xl border-2 font-medium text-lg outline-none transition-all bg-slate-950 text-white placeholder-slate-600
                            ${error ? 'border-red-900/50 bg-red-900/10 focus:border-red-500' : 'border-slate-800 focus:border-slate-600'}
                            ${loading ? 'opacity-50' : ''}
                        `}
                        autoFocus
                    />
                    <button 
                        type="submit"
                        disabled={!guess.trim() || loading}
                        className={`
                            absolute right-2 top-2 bottom-2 aspect-square flex items-center justify-center rounded-lg transition-all
                            ${!guess.trim() || loading ? 'bg-slate-800 text-slate-600' : isNFL ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-emerald-600 text-white hover:bg-emerald-700'}
                        `}
                    >
                        {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ArrowRight className="w-6 h-6" />}
                    </button>
                </form>
                
                {error && (
                    <div className="flex items-start gap-2 mt-3 text-red-400 animate-fadeIn">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                        <p className="text-sm font-medium">{error}</p>
                    </div>
                )}

                <div className="mt-4 flex justify-between items-center px-1">
                    <p className="text-xs text-slate-500">
                        Try to reach <strong className="text-slate-300">{targetPlayer}</strong>
                    </p>
                    <button 
                        onClick={handleSurrender} 
                        className="text-xs font-semibold text-slate-500 hover:text-slate-300 underline"
                    >
                        I give up, show me the answer
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default ActiveGame;