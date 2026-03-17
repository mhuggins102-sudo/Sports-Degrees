import React, { useState } from 'react';
import { GameMode, Difficulty } from './types';
import GameSetup from './components/GameSetup';
import ActiveGame from './components/ActiveGame';
import { getRandomPlayers } from './src/services/offlineData';

type AppState = 'setup' | 'playing';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('setup');
  const [mode, setMode] = useState<GameMode>(GameMode.NFL);
  const [difficulty, setDifficulty] = useState<Difficulty>('Easy');
  const [startPlayer, setStartPlayer] = useState('');
  const [targetPlayer, setTargetPlayer] = useState('');
  const [gameKey, setGameKey] = useState(0);

  const handleStart = (gameMode: GameMode, start: string, target: string, diff: Difficulty) => {
    setMode(gameMode);
    setDifficulty(diff);
    setStartPlayer(start);
    setTargetPlayer(target);
    setAppState('playing');
  };

  const handleReset = () => setAppState('setup');

  const handleNewGame = () => {
    const result = getRandomPlayers(mode, difficulty);
    if (result) {
      setStartPlayer(result.start);
      setTargetPlayer(result.target);
      setGameKey(k => k + 1);
    } else {
      handleReset();
    }
  };

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
        key={gameKey}
        mode={mode}
        difficulty={difficulty}
        startPlayer={startPlayer}
        targetPlayer={targetPlayer}
        onReset={handleReset}
        onNewGame={handleNewGame}
      />
    </div>
  );
};

export default App;
