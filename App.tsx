import React, { useState, useEffect } from 'react';
import { GameMode, PlayerNode } from './types';  // Adjust if types.ts is in root or src/
import { areTeammates, findShortestPath, getRandomPlayers, searchPlayers, getPlayerCount } from './src/services/offlineData';

const App: React.FC = () => {
  const [mode, setMode] = useState<GameMode>(GameMode.MLB);
  const [startPlayer, setStartPlayer] = useState<string>('');
  const [targetPlayer, setTargetPlayer] = useState<string>('');
  const [currentChain, setCurrentChain] = useState<string[]>([]);
  const [solution, setSolution] = useState<PlayerNode[] | null>(null);
  const [error, setError] = useState<string>('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [playerCount, setPlayerCount] = useState(0);

  useEffect(() => {
    setIsLoading(false);
    setPlayerCount(getPlayerCount(mode));
  }, [mode]);

  const startNewGame = () => {
    const { start, target } = getRandomPlayers(mode);
    setStartPlayer(start);
    setTargetPlayer(target);
    setCurrentChain([start]);
    setSolution(null);
    setError('');
  };

  const handleAddPlayer = (newPlayer: string) => {
    if (!newPlayer) return;
    const lastPlayer = currentChain[currentChain.length - 1];
    if (areTeammates(mode, lastPlayer, newPlayer)) {
      setCurrentChain([...currentChain, newPlayer]);
      setError('');
      if (newPlayer === targetPlayer) {
        setError('You win! Degrees: ' + (currentChain.length));
      }
    } else {
      setError(`${newPlayer} was not a teammate of ${lastPlayer}.`);
    }
  };

  const handleSolve = () => {
    const path = findShortestPath(mode, startPlayer, targetPlayer);
    setSolution(path);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    if (query.length >= 3) {
      setSuggestions(searchPlayers(mode, query));
    } else {
      setSuggestions([]);
    }
  };

  const selectSuggestion = (player: string) => {
    handleAddPlayer(player);
    setSuggestions([]);
  };

  if (isLoading) return <div>Loading data...</div>;

  return (
    <div className="App">
      <h1>Sports Degrees ({mode})</h1>
      <p>Loaded {playerCount.toLocaleString()} players offline!</p>
      <button onClick={() => setMode(mode === GameMode.MLB ? GameMode.NFL : GameMode.MLB)}>
        Switch to {mode === GameMode.MLB ? 'NFL' : 'MLB'}
      </button>
      <button onClick={startNewGame}>New Random Game</button>

      <div>
        Start: {startPlayer}
        <br />
        Target: {targetPlayer}
      </div>

      <div>
        Chain: {currentChain.join(' → ')}
      </div>

      <input 
        type="text" 
        placeholder="Add next teammate" 
        onChange={handleInputChange}
      />
      {suggestions.length > 0 && (
        <ul>
          {suggestions.map(p => (
            <li key={p} onClick={() => selectSuggestion(p)}>{p}</li>
          ))}
        </ul>
      )}

      {error && <p>{error}</p>}

      <button onClick={handleSolve}>Solve</button>

      {solution && (
        <div>
          <h2>Shortest Path ({solution.length - 1} degrees):</h2>
          {solution.map((node, i) => (
            <p key={i}>
              {node.name} {node.connectionToPrev ? ` (with ${solution[i-1].name} on ${node.connectionToPrev.team} in ${node.connectionToPrev.years})` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

export default App;
