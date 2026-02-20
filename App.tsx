import React, { useState } from 'react';
import { GameMode } from './types';
import GameSetup from './components/GameSetup';
import ActiveGame from './components/ActiveGame';

type AppState = 'setup' | 'playing';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('setup');
  const [mode, setMode] = useState<GameMode>(GameMode.NFL);
  const [startPlayer, setStartPlayer] = useState('');
  const [targetPlayer, setTargetPlayer] = useState('');

  const handleStart = (gameMode: GameMode, start: string, target: string) => {
    setMode(gameMode);
    setStartPlayer(start);
    setTargetPlayer(target);
    setAppState('playing');
  };

  const handleReset = () => {
    setAppState('setup');
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      {appState === 'setup' ? (
        <GameSetup onStart={handleStart} />
      ) : (
        <ActiveGame
          mode={mode}
          startPlayer={startPlayer}
          targetPlayer={targetPlayer}
          onReset={handleReset}
        />
      )}
    </div>
  );
};

export default App;
