import React, { useState } from 'react';
import { GameMode, Difficulty } from './types';
import GameSetup from './components/GameSetup';
import ActiveGame from './components/ActiveGame';

type AppState = 'setup' | 'playing';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('setup');
  const [mode, setMode] = useState<GameMode>(GameMode.NFL);
  const [difficulty, setDifficulty] = useState<Difficulty>('Easy');
  const [startPlayer, setStartPlayer] = useState('');
  const [targetPlayer, setTargetPlayer] = useState('');

  const handleStart = (gameMode: GameMode, start: string, target: string, diff: Difficulty) => {
    setMode(gameMode);
    setDifficulty(diff);
    setStartPlayer(start);
    setTargetPlayer(target);
    setAppState('playing');
  };

  const handleReset = () => setAppState('setup');

  if (appState === 'setup') {
    return (
      <div className="h-screen overflow-hidden bg-slate-950 flex items-center justify-center p-4">
        <GameSetup onStart={handleStart} />
      </div>
    );
  }

  return (
    <div className="h-screen bg-slate-950">
      <ActiveGame
        mode={mode}
        difficulty={difficulty}
        startPlayer={startPlayer}
        targetPlayer={targetPlayer}
        onReset={handleReset}
      />
    </div>
  );
};

export default App;
