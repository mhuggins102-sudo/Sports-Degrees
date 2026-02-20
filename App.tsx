import React, { useState } from 'react';
import { GameMode, GameState } from './types';
import GameSetup from './components/GameSetup';
import ActiveGame from './components/ActiveGame';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>({
    status: 'SETUP',
    mode: GameMode.NFL,
    startPlayer: '',
    targetPlayer: '',
    chain: []
  });

  const handleStartGame = (mode: GameMode, start: string, target: string) => {
    setGameState({
      status: 'PLAYING',
      mode,
      startPlayer: start,
      targetPlayer: target,
      chain: [] // Handled inside ActiveGame
    });
  };

  const handleReset = () => {
    setGameState({
      status: 'SETUP',
      mode: GameMode.NFL,
      startPlayer: '',
      targetPlayer: '',
      chain: []
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-slate-700">
      <main className="container mx-auto px-4 py-8 md:py-12 flex flex-col items-center">
        {gameState.status === 'SETUP' && (
          <GameSetup onStart={handleStartGame} />
        )}
        
        {gameState.status === 'PLAYING' && (
          <ActiveGame 
            mode={gameState.mode}
            startPlayer={gameState.startPlayer}
            targetPlayer={gameState.targetPlayer}
            onReset={handleReset}
          />
        )}
      </main>

       {/* Footer */}
       <footer className="fixed bottom-2 right-4 text-[10px] text-slate-600 pointer-events-none">
         Offline Mode • Not affiliated with NFL/MLB
       </footer>

       <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.4s ease-out forwards;
        }
        .fade-in-up {
           animation: fadeIn 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default App;
