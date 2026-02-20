
import { GameMode, PlayerNode, TeammateValidationResponse, SolutionResponse, Difficulty } from "../types";
import { NFL_PLAYERS, NFL_PUZZLES } from "../src/data/nflData";
import { MLB_PLAYERS, MLB_PUZZLES } from "../src/data/mlbData";
import { GoogleGenAI } from "@google/genai";

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Helper to normalize names for comparison
const normalize = (name: string) => name.toLowerCase().trim();

// Helper to get player data
const getPlayerData = (name: string, mode: GameMode) => {
  const db = mode === GameMode.NFL ? NFL_PLAYERS : MLB_PLAYERS;
  // Case insensitive lookup
  const key = Object.keys(db).find(k => normalize(k) === normalize(name));
  return key ? db[key] : null;
};

// Helper to get correct name casing
const getCorrectName = (name: string, mode: GameMode) => {
  const db = mode === GameMode.NFL ? NFL_PLAYERS : MLB_PLAYERS;
  const key = Object.keys(db).find(k => normalize(k) === normalize(name));
  return key || name;
};

const getPlayerYears = (name: string, mode: GameMode): { start: number, end: number } | null => {
    const data = getPlayerData(name, mode);
    if (!data) return null;
    let start = 9999;
    let end = 0;
    data.teams.forEach(t => {
        if (t.start < start) start = t.start;
        if (t.end > end) end = t.end;
    });
    return { start, end };
};

export const generateChallenge = async (mode: GameMode, difficulty: Difficulty): Promise<{ start: string; target: string }> => {
  const puzzles = mode === GameMode.NFL ? NFL_PUZZLES : MLB_PUZZLES;
  
  // 1. Try to find a premade puzzle that matches
  const matchingPremade = puzzles.filter(p => p.difficulty === difficulty);
  
  // 50% chance to use premade if available, otherwise generate dynamic
  if (matchingPremade.length > 0 && Math.random() > 0.5) {
      const randomPuzzle = matchingPremade[Math.floor(Math.random() * matchingPremade.length)];
      return { start: randomPuzzle.start, target: randomPuzzle.target };
  }

  // 2. Generate Dynamic Puzzle
  const db = mode === GameMode.NFL ? NFL_PLAYERS : MLB_PLAYERS;
  const playerNames = Object.keys(db);
  
  let attempts = 0;
  while (attempts < 50) {
      attempts++;
      const start = playerNames[Math.floor(Math.random() * playerNames.length)];
      const target = playerNames[Math.floor(Math.random() * playerNames.length)];

      if (start === target) continue;

      const startYears = getPlayerYears(start, mode);
      const targetYears = getPlayerYears(target, mode);

      if (!startYears || !targetYears) continue;

      const overlap = (startYears.end >= targetYears.start && targetYears.end >= startYears.start);
      
      // Filter by generation overlap based on difficulty
      if (difficulty === 'Easy') {
          // Easy: Should overlap or be close
          if (!overlap && Math.abs(startYears.end - targetYears.start) > 5) continue;
      } else if (difficulty === 'Medium') {
          // Medium: No overlap preferred
          if (overlap) continue; 
      } else if (difficulty === 'Hard') {
          // Hard: No overlap, significant gap
          if (overlap || Math.abs(startYears.end - targetYears.start) < 5) continue;
      }

      // Check path length (degrees of separation)
      const pathResult = await findShortestPath(start, target, mode);
      const degrees = pathResult.degrees;

      if (degrees < 2) continue; // Must be at least 2 degrees (1 intermediate player)

      let valid = false;
      if (difficulty === 'Easy' && degrees >= 2 && degrees <= 4) valid = true;
      if (difficulty === 'Medium' && degrees >= 2 && degrees <= 5) valid = true;
      if (difficulty === 'Hard' && degrees >= 3 && degrees <= 7) valid = true;

      if (valid) {
          console.log(`Generated ${difficulty} puzzle: ${start} -> ${target} (${degrees} degrees)`);
          return { start, target };
      }
  }

  // Fallback to any premade if generation fails
  const fallback = puzzles[Math.floor(Math.random() * puzzles.length)];
  return { start: fallback.start, target: fallback.target };
};


export const validateTeammate = async (
  currentDetails: { name: string },
  guessName: string,
  mode: GameMode
): Promise<TeammateValidationResponse> => {
  
  // 1. Try Local Database First
  const p1Data = getPlayerData(currentDetails.name, mode);
  const p2Data = getPlayerData(guessName, mode);

  if (p1Data && p2Data) {
      // Check overlap locally
      for (const t1 of p1Data.teams) {
        for (const t2 of p2Data.teams) {
          if (t1.name === t2.name) {
            const start = Math.max(t1.start, t2.start);
            const end = Math.min(t1.end, t2.end);
            
            if (start <= end) {
              return {
                isValid: true,
                correctedName: getCorrectName(guessName, mode),
                team: t1.name,
                years: `${start}-${end}`
              };
            }
          }
        }
      }
  }

  // 2. Fallback to Gemini API
  try {
      const prompt = `
      Verify if ${mode} players "${currentDetails.name}" and "${guessName}" were ever teammates.
      If yes, return JSON: {"isValid": true, "team": "Team Name", "years": "YYYY-YYYY", "correctedName": "Correct Name of Guess"}.
      If no, return JSON: {"isValid": false, "reason": "Brief explanation"}.
      Be strict about them being on the SAME roster at the SAME time.
      `;

      const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
              responseMimeType: "application/json"
          }
      });

      const text = response.text;
      if (text) {
          const result = JSON.parse(text);
          if (result.isValid) {
              return {
                  isValid: true,
                  correctedName: result.correctedName || guessName,
                  team: result.team,
                  years: result.years
              };
          } else {
              return {
                  isValid: false,
                  reason: result.reason || "No teammate connection found."
              };
          }
      }
  } catch (e) {
      console.error("Gemini validation failed:", e);
  }

  // 3. Final Fallback
  return {
    isValid: false,
    reason: `Could not verify connection between ${guessName} and ${currentDetails.name}.`
  };
};

export const validatePlayerExists = async (
  name: string,
  mode: GameMode
): Promise<{ exists: boolean; correctedName: string }> => {
  const correctName = getCorrectName(name, mode);
  const exists = !!getPlayerData(name, mode);
  return { exists, correctedName: exists ? correctName : name };
};

export const findShortestPath = async (
  start: string,
  target: string,
  mode: GameMode
): Promise<SolutionResponse> => {
  const db = mode === GameMode.NFL ? NFL_PLAYERS : MLB_PLAYERS;
  const startNode = getCorrectName(start, mode);
  const targetNode = getCorrectName(target, mode);

  // 1. Try Local BFS
  if (db[startNode] && db[targetNode]) {
      // BFS with path reconstruction
      const queue: { name: string; path: PlayerNode[] }[] = [{ 
          name: startNode, 
          path: [{ id: 'start', name: startNode }] 
      }];
      
      const visited = new Set<string>([startNode]);

      while (queue.length > 0) {
        const { name, path } = queue.shift()!;

        if (name === targetNode) {
          return { 
            path, 
            degrees: path.length - 1,
            explanation: `Shortest path found: ${path.map(n => n.name).join(" -> ")}` 
          };
        }

        // Find neighbors
        const p1Data = db[name];
        if (!p1Data) continue;

        for (const candidateName of Object.keys(db)) {
          if (visited.has(candidateName)) continue;

          const p2Data = db[candidateName];
          let connection: { team: string, years: string } | null = null;

          // Check overlap
          for (const t1 of p1Data.teams) {
            for (const t2 of p2Data.teams) {
              if (t1.name === t2.name) {
                const s = Math.max(t1.start, t2.start);
                const e = Math.min(t1.end, t2.end);
                if (s <= e) {
                  connection = { team: t1.name, years: `${s}-${e}` };
                  break;
                }
              }
            }
            if (connection) break;
          }

          if (connection) {
            visited.add(candidateName);
            queue.push({ 
                name: candidateName, 
                path: [
                    ...path, 
                    { 
                        id: candidateName, 
                        name: candidateName, 
                        connectionToPrev: connection 
                    }
                ] 
            });
          }
        }
      }
  }

  // 2. Fallback to Gemini API for Pathfinding
  try {
      const prompt = `
      Find the shortest teammate connection path between ${mode} players "${start}" and "${target}".
      Return JSON: {
        "path": [
          {"name": "Player Name", "connectionToPrev": {"team": "Team", "years": "Years"}}
        ],
        "degrees": number
      }
      The first item in path is the start player (connectionToPrev is null).
      The last item is the target player.
      Example: A -> B -> C is 2 degrees.
      `;

      const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
              responseMimeType: "application/json"
          }
      });

      const text = response.text;
      if (text) {
          const result = JSON.parse(text);
          if (result.path && Array.isArray(result.path)) {
              // Map to PlayerNode
              const path: PlayerNode[] = result.path.map((p: any, i: number) => ({
                  id: `ai-${i}`,
                  name: p.name,
                  connectionToPrev: p.connectionToPrev
              }));
              
              return {
                  path,
                  degrees: result.degrees || path.length - 1,
                  explanation: `Path found by AI: ${path.map(n => n.name).join(" -> ")}`
              };
          }
      }
  } catch (e) {
      console.error("Gemini pathfinding failed:", e);
  }

  return { path: [], degrees: 0, explanation: "Could not find a path in offline database or via AI." };
};
