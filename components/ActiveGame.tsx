import React, { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { GameMode, Difficulty, PlayerNode, SolutionResponse } from '../types';
import {
  validateTeammateOffline, findShortestPath, searchPlayers,
  getPlayerPosition, getCareerRange, getPlayerSeasons, isWellKnown,
} from '../src/services/offlineData';
import PlayerCard from './PlayerCard';
import { Loader2, ArrowRight, RotateCcw, AlertCircle, Trophy, Zap, X, Star, Share2, Home, Eye } from 'lucide-react';

interface ActiveGameProps {
  mode: GameMode;
  difficulty: Difficulty;
  startPlayer: string;
  targetPlayer: string;
  onReset: () => void;
  onNewGame: () => void;
}

// Build a fully-populated PlayerNode (position + career range included)
function makeNode(mode: GameMode, name: string, connectionToPrev?: PlayerNode['connectionToPrev']): PlayerNode {
  return {
    id: `node-${Date.now()}-${Math.random()}`,
    name,
    connectionToPrev,
    position: getPlayerPosition(mode, name),
    careerYears: getCareerRange(mode, name),
  };
}

// Group consecutive same-team seasons into ranges for the popup
function groupSeasons(seasons: Array<{ team: string; year: number }>): Array<{ team: string; range: string }> {
  const sorted = [...seasons].sort((a, b) => a.year - b.year || a.team.localeCompare(b.team));

  const teamYears = new Map<string, number[]>();
  for (const s of sorted) {
    const arr = teamYears.get(s.team) ?? [];
    arr.push(s.year);
    teamYears.set(s.team, arr);
  }

  const result: Array<{ team: string; range: string; startYear: number }> = [];
  for (const [team, years] of teamYears) {
    const uniqueYears = [...new Set(years)].sort((a, b) => a - b);
    let runStart = uniqueYears[0];
    let runEnd = uniqueYears[0];

    for (let i = 1; i < uniqueYears.length; i++) {
      if (uniqueYears[i] === runEnd + 1) {
        runEnd = uniqueYears[i];
      } else {
        result.push({ team, range: runStart === runEnd ? String(runStart) : `${runStart}–${runEnd}`, startYear: runStart });
        runStart = uniqueYears[i];
        runEnd = uniqueYears[i];
      }
    }
    result.push({ team, range: runStart === runEnd ? String(runStart) : `${runStart}–${runEnd}`, startYear: runStart });
  }

  return result.sort((a, b) => a.startYear - b.startYear);
}

// Score calculation
function computeScore(
  userDegrees: number,
  bestDegrees: number,
  hintsUsed: number,
  incorrectGuesses: number,
  uniqueCardViews: number,
) {
  if (hintsUsed >= userDegrees) return { total: 0, extraSteps: 0, hintsUsed, incorrectGuesses, uniqueCardViews, hintPenalty: 0, stepPenalty: 0, wrongPenalty: 0, viewPenalty: 0 };

  const extraSteps = Math.max(0, userDegrees - bestDegrees);
  const hintPenalty = userDegrees > 0 ? Math.round(hintsUsed * (70 / userDegrees)) : 0;
  const stepPenalty = extraSteps * 5;
  const wrongPenalty = incorrectGuesses * 5;
  const viewPenalty = uniqueCardViews * 5;
  const total = Math.max(0, 100 - hintPenalty - stepPenalty - wrongPenalty - viewPenalty);

  return { total, extraSteps, hintsUsed, incorrectGuesses, uniqueCardViews, hintPenalty, stepPenalty, wrongPenalty, viewPenalty };
}

type HintMode = 'optimal' | 'wellKnown';

const ActiveGame: React.FC<ActiveGameProps> = ({ mode, difficulty, startPlayer, targetPlayer, onReset, onNewGame }) => {
  const [chain, setChain] = useState<PlayerNode[]>(() => [{
    id: 'start',
    name: startPlayer,
    position: getPlayerPosition(mode, startPlayer),
    careerYears: getCareerRange(mode, startPlayer),
  }]);

  const [guess, setGuess] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [won, setWon] = useState(false);

  const [solution, setSolution] = useState<SolutionResponse | null>(null);
  const [loadingSolution, setLoadingSolution] = useState(false);

  // Popup: which player's seasons to show (null = closed)
  const [popupPlayer, setPopupPlayer] = useState<string | null>(null);

  // Autocomplete
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSugIdx, setActiveSugIdx] = useState(-1);

  // Hint mode selector
  const [hintMode, setHintMode] = useState<HintMode>('wellKnown');
  const [showHintMenu, setShowHintMenu] = useState(false);
  const hintMenuRef = useRef<HTMLDivElement>(null);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Share: pre-captured image file
  const chainContentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'sharing' | 'done'>('idle');

  // Scoring trackers
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hintedPlayers, setHintedPlayers] = useState<Set<string>>(new Set());
  const [cardViews, setCardViews] = useState(0);
  const [viewedPlayers, setViewedPlayers] = useState<Set<string>>(new Set());
  const [incorrectGuesses, setIncorrectGuesses] = useState(0);
  const [surrendered, setSurrendered] = useState(false);

  const currentNode = chain[chain.length - 1];
  const isNFL = mode === GameMode.NFL;

  // Close hint menu on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (hintMenuRef.current && !hintMenuRef.current.contains(e.target as Node)) {
        setShowHintMenu(false);
      }
    };
    if (showHintMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showHintMenu]);

  // Scroll to bottom when chain grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chain.length, won]);

  // Pre-capture share image when user wins (not surrender)
  useEffect(() => {
    if (!won || surrendered || !chainContentRef.current) return;
    const capture = async () => {
      try {
        const chainEl = chainContentRef.current;
        if (!chainEl) return;

        // Build an offscreen wrapper: branding header + cloned chain + footer
        // Match the chain container's actual rendered width so cards look identical
        const chainWidth = chainEl.offsetWidth;
        const wrapperPx = chainWidth + 32; // 32px = px-4 padding on each side
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `position:fixed;left:-9999px;top:0;width:${Math.max(wrapperPx, 360)}px;`;
        wrapper.className = 'bg-slate-950';

        // Header
        const header = document.createElement('div');
        header.className = `px-5 py-2.5 text-center ${
          isNFL
            ? 'bg-gradient-to-b from-sky-900/80 via-slate-900 to-slate-950'
            : 'bg-gradient-to-b from-emerald-900/80 via-slate-900 to-slate-950'
        }`;
        header.innerHTML = `
          <h2 class="text-lg font-bold ${isNFL ? 'text-sky-400' : 'text-emerald-400'}">Sports Degrees</h2>
          <p class="opacity-90 text-sm text-slate-300">${startPlayer} → ${targetPlayer}</p>
          <p class="text-xl font-black text-white">${userDegrees} degree${userDegrees !== 1 ? 's' : ''}</p>
        `;
        wrapper.appendChild(header);

        // Clone the visible chain content
        const cloned = chainEl.cloneNode(true) as HTMLElement;
        // Remove the bottomRef spacer div (last child)
        if (cloned.lastElementChild && !(cloned.lastElementChild as HTMLElement).className) {
          cloned.removeChild(cloned.lastElementChild);
        }
        const chainWrap = document.createElement('div');
        chainWrap.className = 'px-4 py-4';
        chainWrap.style.marginTop = '-3px';
        chainWrap.appendChild(cloned);
        wrapper.appendChild(chainWrap);

        // Footer
        const footer = document.createElement('p');
        footer.className = 'text-center text-[10px] text-slate-500 pb-3';
        footer.textContent = 'sportsdegrees.netlify.app';
        wrapper.appendChild(footer);

        document.body.appendChild(wrapper);

        const canvas = await html2canvas(wrapper, { backgroundColor: '#020617', scale: 2 });
        document.body.removeChild(wrapper);

        canvas.toBlob(blob => {
          if (blob) {
            setShareFile(new File([blob], 'sports-degrees.png', { type: 'image/png' }));
          }
        }, 'image/png');
      } catch { /* ignore */ }
    };
    const timer = setTimeout(capture, 300);
    return () => clearTimeout(timer);
  }, [won, surrendered]);

  // Open player card popup (tracks views during active play)
  const openPlayerCard = (name: string) => {
    setPopupPlayer(name);
    if (!won) {
      setCardViews(v => v + 1);
      setViewedPlayers(prev => new Set(prev).add(name.toLowerCase()));
    }
  };

  // ── Core submission ───────────────────────────────────────────────────────

  const submitGuess = (playerName: string) => {
    const trimmed = playerName.trim();
    if (!trimmed || loading || won) return;

    if (chain.some(n => n.name.toLowerCase() === trimmed.toLowerCase())) {
      setError('This player is already in your chain!');
      return;
    }

    setLoading(true);
    setError(null);
    setSuggestions([]);

    const result = validateTeammateOffline(mode, currentNode.name, trimmed);

    if (result.isValid) {
      const newNode = makeNode(mode, result.correctedName, { team: result.team, years: result.years });
      const newChain = [...chain, newNode];
      setChain(newChain);
      setGuess('');

      if (result.correctedName.toLowerCase() === targetPlayer.toLowerCase()) {
        setWon(true);
        fetchSolution();
      }
    } else {
      setError(result.reason ?? 'Invalid connection.');
      setIncorrectGuesses(g => g + 1);
      setGuess('');
      inputRef.current?.blur();
    }

    setLoading(false);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeSugIdx >= 0 && suggestions[activeSugIdx]) {
      const chosen = suggestions[activeSugIdx];
      setGuess(chosen);
      setSuggestions([]);
      setActiveSugIdx(-1);
      submitGuess(chosen);
    } else {
      submitGuess(guess);
    }
  };

  // ── Autocomplete ──────────────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setGuess(val);
    setError(null);
    setActiveSugIdx(-1);
    setSuggestions(val.length >= 2 ? searchPlayers(mode, val) : []);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveSugIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveSugIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Escape') { setSuggestions([]); setActiveSugIdx(-1); }
  };

  const selectSuggestion = (player: string) => {
    setGuess(player);
    setSuggestions([]);
    setActiveSugIdx(-1);
    submitGuess(player);
  };

  // ── Hint: auto-add the next well-known (NFL) or best (MLB) player ──────

  const handleHint = (overrideMode?: HintMode) => {
    if (loading || won) return;
    setShowHintMenu(false);
    const HINT_BUDGET = 500_000;

    if (isNFL) {
      const path = findShortestPath(mode, currentNode.name, targetPlayer, 10, true, HINT_BUDGET);
      if (path && path.length > 1) {
        const hintName = path[1].name;
        setHintsUsed(h => h + 1);
        setHintedPlayers(prev => new Set(prev).add(hintName.toLowerCase()));
        submitGuess(hintName);
      } else {
        setError('No path found from here to the target.');
      }
    } else {
      const effectiveMode = overrideMode ?? hintMode;
      const useWellKnown = effectiveMode === 'wellKnown';
      const path = findShortestPath(mode, currentNode.name, targetPlayer, 10, useWellKnown, HINT_BUDGET);
      if (path && path.length > 1) {
        const hintName = path[1].name;
        setHintsUsed(h => h + 1);
        setHintedPlayers(prev => new Set(prev).add(hintName.toLowerCase()));
        submitGuess(hintName);
      } else if (useWellKnown) {
        const optPath = findShortestPath(mode, currentNode.name, targetPlayer, 10, false, HINT_BUDGET);
        if (optPath && optPath.length > 1) {
          const hintName = optPath[1].name;
          setHintsUsed(h => h + 1);
          setHintedPlayers(prev => new Set(prev).add(hintName.toLowerCase()));
          submitGuess(hintName);
        } else {
          setError('No path found from here to the target.');
        }
      } else {
        setError('No path found from here to the target.');
      }
    }
  };

  // ── Solution (win / surrender) ────────────────────────────────────────────

  const fetchSolution = () => {
    setLoadingSolution(true);
    setTimeout(() => {
      const VISIT_BUDGET = 500_000;

      if (isNFL) {
        const wkPath = findShortestPath(mode, startPlayer, targetPlayer, 15, true, VISIT_BUDGET);
        setSolution({
          optimalPath: [],
          optimalDegrees: 0,
          wellKnownPath: wkPath,
          wellKnownDegrees: wkPath ? wkPath.length - 1 : null,
          explanation: wkPath ? undefined : 'Could not find a path using well-known players.',
        });
      } else {
        const optPath = findShortestPath(mode, startPlayer, targetPlayer, 10, false, VISIT_BUDGET);
        const wkPath = findShortestPath(mode, startPlayer, targetPlayer, 15, true, VISIT_BUDGET);
        setSolution({
          optimalPath: optPath ?? [],
          optimalDegrees: optPath ? optPath.length - 1 : 0,
          wellKnownPath: wkPath,
          wellKnownDegrees: wkPath ? wkPath.length - 1 : null,
          explanation: optPath ? undefined : 'Could not find a path in the offline database.',
        });
      }
      setLoadingSolution(false);
    }, 50);
  };

  const handleSurrender = () => {
    setSurrendered(true);
    setWon(true);
    fetchSolution();
  };

  // ── Share (one-click using pre-captured image) ─────────────────────────────

  const handleShare = async () => {
    if (!shareFile) return;
    setShareStatus('sharing');
    const degrees = chain.length - 1;
    const shareText = `Sports Degrees: ${startPlayer} \u2192 ${targetPlayer} in ${degrees} degree${degrees !== 1 ? 's' : ''}!\nhttps://sportsdegrees.netlify.app`;

    try {
      if (navigator.share && navigator.canShare?.({ files: [shareFile] })) {
        await navigator.share({ text: shareText, files: [shareFile] });
      } else if (navigator.share) {
        await navigator.share({ text: shareText });
      } else {
        const url = URL.createObjectURL(shareFile);
        window.open(url, '_blank');
      }
    } catch {
      // User cancelled — that's fine
    }

    setShareStatus('done');
    setTimeout(() => setShareStatus('idle'), 2000);
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  const showCareerYears = (_idx: number) => true;

  const accentActive = isNFL ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white';
  const accentHover  = isNFL ? 'hover:bg-blue-700' : 'hover:bg-emerald-700';

  const targetPosition = getPlayerPosition(mode, targetPlayer);
  const targetCareer = getCareerRange(mode, targetPlayer);

  // ── Render ────────────────────────────────────────────────────────────────

  const userDegrees = chain.length - 1;
  const bestDegrees = solution
    ? (solution.optimalDegrees > 0 ? solution.optimalDegrees : solution.wellKnownDegrees ?? userDegrees)
    : userDegrees;
  const score = solution ? computeScore(userDegrees, bestDegrees, hintsUsed, incorrectGuesses, viewedPlayers.size) : null;
  const userCompleted = chain[chain.length - 1]?.name === targetPlayer;

  // Render a chain annotation for a player name in the Your Chain / solution sections
  const renderAnnotatedName = (name: string, isFirst: boolean) => {
    const isHinted = hintedPlayers.has(name.toLowerCase());
    const isViewed = viewedPlayers.has(name.toLowerCase());
    return (
      <>
        {isHinted && <Zap className="w-3 h-3 inline mr-1 text-yellow-500" />}
        <span className={`font-semibold ${isHinted ? 'text-yellow-400' : 'text-slate-100'}`}>{name}</span>
        {isViewed && <Eye className="w-3 h-3 inline ml-1 text-slate-500" />}
      </>
    );
  };

  return (
    <div className="h-full flex flex-col">

      {/* ── Fixed header ── */}
      <div className="flex-shrink-0 bg-slate-900 border-b border-slate-800 px-4 pt-3 pb-2.5 flex items-center justify-between">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">Target</span>
          <div className="flex items-baseline gap-2">
            <span className={`text-base font-bold leading-tight ${isNFL ? 'text-blue-400' : 'text-emerald-400'}`}>
              {targetPlayer}
            </span>
            {targetPosition && (
              <span className={`text-xs font-bold uppercase tracking-wide ${isNFL ? 'text-sky-400/70' : 'text-emerald-400/70'}`}>
                {targetPosition}
              </span>
            )}
          </div>
          {targetCareer && (
            <span className="text-xs text-slate-400 leading-tight">{targetCareer}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="text-right mr-1 hidden sm:block">
            <span className="block text-[10px] uppercase font-bold text-slate-400 tracking-wider">Degree</span>
            <span className="block text-lg font-black text-slate-200">{chain.length - 1}</span>
          </div>
          {/* Hint button — NFL: direct fire, MLB: mode menu */}
          <div className="relative" ref={hintMenuRef}>
            <button
              onClick={() => isNFL ? handleHint('wellKnown') : setShowHintMenu(v => !v)}
              disabled={loading || won}
              title="Hint"
              className="p-2 rounded-full transition-colors hover:bg-slate-800 text-slate-300 hover:text-yellow-400"
            >
              <Zap className="w-4 h-4" />
            </button>
            {!isNFL && showHintMenu && (
              <div className="absolute right-0 top-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden w-52">
                <button
                  onClick={() => { setHintMode('wellKnown'); handleHint('wellKnown'); }}
                  className={`w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 transition-colors ${hintMode === 'wellKnown' ? 'bg-emerald-900/50 text-emerald-200' : 'text-slate-300 hover:bg-slate-700'}`}
                >
                  <Star className="w-3 h-3" />
                  Well-known player
                </button>
                <button
                  onClick={() => { setHintMode('optimal'); handleHint('optimal'); }}
                  className={`w-full text-left px-3 py-2.5 text-xs flex items-center gap-2 border-t border-slate-700 transition-colors ${hintMode === 'optimal' ? 'bg-emerald-900/50 text-emerald-200' : 'text-slate-300 hover:bg-slate-700'}`}
                >
                  <Zap className="w-3 h-3" />
                  Optimal (any player)
                </button>
              </div>
            )}
          </div>
          <button onClick={onNewGame} title="New game"
            className="p-2 hover:bg-slate-800 rounded-full text-slate-300 hover:text-slate-100 transition-colors">
            <RotateCcw className="w-4 h-4" />
          </button>
          <button onClick={onReset} title="Home"
            className="p-2 hover:bg-slate-800 rounded-full text-slate-300 hover:text-slate-100 transition-colors">
            <Home className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Scrollable card area ── */}
      <div ref={scrollAreaRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col justify-end">
        <div ref={chainContentRef}>
          {chain.map((node, idx) => (
            <PlayerCard
              key={node.id}
              node={node}
              index={idx}
              mode={mode}
              isStart={idx === 0}
              isEnd={idx === chain.length - 1}
              isTarget={node.name === targetPlayer}
              showCareerYears={showCareerYears(idx)}
              onCardClick={() => openPlayerCard(node.name)}
            />
          ))}

          {/* Ghost target card */}
          {!won && (
            <div className="opacity-75">
              <div className="flex flex-col items-center my-1">
                <div className="h-5 w-px border-l-2 border-dashed border-slate-500" />
              </div>
              <PlayerCard
                node={{ id: 'target', name: targetPlayer, position: targetPosition, careerYears: targetCareer }}
                index={chain.length}
                mode={mode}
                isTarget
                showCareerYears={true}
                onCardClick={() => openPlayerCard(targetPlayer)}
              />
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar ── */}
      {!won && (
        <div className="flex-shrink-0 bg-slate-900 border-t border-slate-800 relative">
          {/* Autocomplete — positioned above the input bar */}
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 bg-slate-900 border border-slate-700 rounded-t-xl shadow-2xl overflow-hidden z-50">
              {suggestions.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={e => { e.preventDefault(); selectSuggestion(s); }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                    i === activeSugIdx
                      ? isNFL ? 'bg-blue-900/50 text-blue-200' : 'bg-emerald-900/50 text-emerald-200'
                      : 'text-slate-200 hover:bg-slate-800'
                  } ${i > 0 ? 'border-t border-slate-800' : ''}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="px-4 pt-3 pb-3">
            <form onSubmit={handleFormSubmit}>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={guess}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onFocus={() => setTimeout(() => {
                    if (scrollAreaRef.current) {
                      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
                    }
                  }, 300)}
                  onBlur={() => setTimeout(() => setSuggestions([]), 100)}
                  placeholder={`Who played with ${currentNode.name}?`}
                  disabled={loading}
                  autoComplete="off"
                  className={`
                    flex-1 pl-4 py-3 rounded-xl border-2 font-medium outline-none transition-all bg-slate-950 text-white placeholder-slate-500 text-base
                    ${error ? 'border-red-900/50 bg-red-900/10 focus:border-red-500' : 'border-slate-700 focus:border-slate-500'}
                    ${loading ? 'opacity-50' : ''}
                  `}
                />
                <button
                  type="submit"
                  disabled={!guess.trim() || loading}
                  className={`px-4 flex items-center justify-center rounded-xl transition-all ${
                    !guess.trim() || loading
                      ? 'bg-slate-800 text-slate-500'
                      : `${accentActive} ${accentHover}`
                  }`}
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                </button>
              </div>
            </form>

            {error && (
              <div className="flex items-start gap-1.5 mt-2 text-red-400">
                <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0" />
                <p className="text-xs font-medium">{error}</p>
              </div>
            )}

            <div className="mt-2 flex justify-end">
              <button onClick={handleSurrender}
                className="text-xs text-slate-400 hover:text-slate-200 underline">
                Show answer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Player seasons popup ── */}
      {popupPlayer && (() => {
        const grouped = groupSeasons(getPlayerSeasons(mode, popupPlayer));
        const pos = getPlayerPosition(mode, popupPlayer);
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setPopupPlayer(null)}
          >
            <div
              className="bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xs border border-slate-700 overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Career Seasons</p>
                  <div className="flex items-baseline gap-2">
                    <p className={`text-sm font-bold ${isNFL ? 'text-sky-300' : 'text-emerald-300'}`}>{popupPlayer}</p>
                    {pos && (
                      <span className={`text-[10px] font-bold uppercase tracking-wide ${isNFL ? 'text-sky-400/70' : 'text-emerald-400/70'}`}>
                        {pos}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setPopupPlayer(null)}
                  className="p-1.5 hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="overflow-y-auto max-h-72">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-950">
                    <tr>
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-400">Years</th>
                      <th className="text-left px-4 py-2 text-[10px] uppercase tracking-wider font-bold text-slate-400">Team</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map((s, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-slate-900' : 'bg-slate-800/40'}>
                        <td className="px-4 py-1.5 text-slate-200 font-medium">{s.range}</td>
                        <td className="px-4 py-1.5 text-slate-300">{s.team}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Win / Surrender modal ── */}
      {won && (
        <>
          {/* Visible modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <div className="bg-slate-900 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-700 flex flex-col max-h-[85vh]">

              {/* Header */}
              <div className={`flex-shrink-0 px-5 py-3 border-t-2 ${
                isNFL
                  ? 'bg-gradient-to-r from-blue-900/60 via-slate-800 to-slate-900 border-blue-500'
                  : 'bg-gradient-to-r from-emerald-900/60 via-slate-800 to-slate-900 border-emerald-500'
              } rounded-t-2xl`}>
                {surrendered ? (
                  <p className="text-base font-bold text-slate-200 text-center py-1">Here's our best solution</p>
                ) : (
                  <div className="flex items-center justify-between">
                    {/* Left: title + score */}
                    <div>
                      <p className="text-sm font-bold text-slate-300 mb-0.5">You did it!</p>
                      {score ? (
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-4xl font-black text-white leading-none">{score.total}</span>
                          <span className="text-xs text-slate-400">/ 100</span>
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">
                          {userDegrees} degree{userDegrees !== 1 ? 's' : ''}
                        </p>
                      )}
                    </div>
                    {/* Right: deduction tally */}
                    {score && (score.stepPenalty > 0 || score.hintPenalty > 0 || score.wrongPenalty > 0 || score.viewPenalty > 0) && (
                      <div className="text-right space-y-0.5">
                        {score.stepPenalty > 0 && (
                          <p className="text-xs text-slate-400">
                            {score.extraSteps} extra step{score.extraSteps !== 1 ? 's' : ''} = <span className={`font-bold ${isNFL ? 'text-blue-400' : 'text-emerald-400'}`}>-{score.stepPenalty}</span>
                          </p>
                        )}
                        {score.hintPenalty > 0 && (
                          <p className="text-xs text-slate-400">
                            {score.hintsUsed} hint{score.hintsUsed !== 1 ? 's' : ''} = <span className={`font-bold ${isNFL ? 'text-blue-400' : 'text-emerald-400'}`}>-{score.hintPenalty}</span>
                          </p>
                        )}
                        {score.wrongPenalty > 0 && (
                          <p className="text-xs text-slate-400">
                            {score.incorrectGuesses} wrong = <span className={`font-bold ${isNFL ? 'text-blue-400' : 'text-emerald-400'}`}>-{score.wrongPenalty}</span>
                          </p>
                        )}
                        {score.viewPenalty > 0 && (
                          <p className="text-xs text-slate-400">
                            {score.uniqueCardViews} card view{score.uniqueCardViews !== 1 ? 's' : ''} = <span className={`font-bold ${isNFL ? 'text-blue-400' : 'text-emerald-400'}`}>-{score.viewPenalty}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">

                {/* Your chain — only shown on actual win */}
                {userCompleted && (
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2">
                      Your chain: {userDegrees} degree{userDegrees !== 1 ? 's' : ''}
                    </p>
                    <div className="space-y-1.5 text-sm">
                      {chain.map((n, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${i === 0 ? 'bg-slate-500' : isNFL ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                          <div>
                            {renderAnnotatedName(n.name, i === 0)}
                            {n.connectionToPrev && (
                              <span className="text-xs text-slate-400 ml-1.5">
                                via {n.connectionToPrev.team} ({n.connectionToPrev.years})
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Solutions */}
                {loadingSolution ? (
                  <div className="flex flex-col items-center py-6 text-slate-300">
                    <Loader2 className="w-6 h-6 animate-spin mb-2" />
                    <p className="text-sm">Finding best path…</p>
                  </div>
                ) : solution ? (() => {
                  const hasWk = solution.wellKnownPath && solution.wellKnownDegrees !== null;
                  const optIsShorter = hasWk && solution.optimalDegrees < solution.wellKnownDegrees!;
                  const showOptimal = !hasWk || optIsShorter;
                  const showWellKnown = hasWk;

                  const renderPath = (path: PlayerNode[], label: string, _icon: React.ReactNode, dotColor: string) => (
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2">{label}</p>
                      <div className="space-y-1.5 text-sm">
                        {path.map((n, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${i === 0 ? 'bg-slate-500' : dotColor}`} />
                            <div>
                              <span className="font-semibold text-slate-100">{n.name}</span>
                              {n.connectionToPrev && (
                                <span className="text-xs text-slate-400 ml-1.5">
                                  via {n.connectionToPrev.team} ({n.connectionToPrev.years})
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );

                  return (
                    <>
                      {showOptimal && solution.optimalPath.length > 0 && renderPath(
                        solution.optimalPath,
                        `Optimal: ${solution.optimalDegrees} degree${solution.optimalDegrees !== 1 ? 's' : ''}`,
                        <Trophy className="w-4 h-4 text-yellow-500" />,
                        isNFL ? 'bg-blue-500' : 'bg-emerald-500',
                      )}
                      {showOptimal && solution.optimalPath.length === 0 && solution.explanation && (
                        <div>
                          <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2">Solution unavailable</p>
                          <p className="text-slate-300 text-sm italic">{solution.explanation}</p>
                        </div>
                      )}
                      {showWellKnown && renderPath(
                        solution.wellKnownPath!,
                        `${optIsShorter ? 'Well-known' : 'Best path'}: ${solution.wellKnownDegrees} degree${solution.wellKnownDegrees !== 1 ? 's' : ''}`,
                        <Star className="w-4 h-4 text-amber-400" />,
                        'bg-amber-500',
                      )}
                    </>
                  );
                })() : null}
              </div>

              {/* Fixed bottom buttons */}
              <div className="flex-shrink-0 border-t border-slate-700 px-4 py-3 grid gap-2" style={{ gridTemplateColumns: userCompleted ? '1fr 1fr 1fr' : '1fr 1fr' }}>
                {userCompleted && (
                  <button
                    onClick={handleShare}
                    disabled={!shareFile || shareStatus === 'sharing'}
                    className={`py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-1.5 transition-colors ${
                      shareStatus === 'done'
                        ? 'bg-green-600 text-white'
                        : !shareFile
                          ? 'bg-slate-700 text-slate-400'
                          : isNFL
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}>
                    {shareStatus === 'sharing' ? <Loader2 className="w-4 h-4 animate-spin" /> :
                     shareStatus === 'done' ? 'Shared!' :
                     !shareFile ? <Loader2 className="w-4 h-4 animate-spin" /> :
                     <><Share2 className="w-4 h-4" /> Share</>}
                  </button>
                )}
                <button onClick={onNewGame}
                  className="py-2.5 bg-white text-slate-900 rounded-lg font-bold text-sm hover:bg-slate-200 transition-colors flex items-center justify-center gap-2">
                  <RotateCcw className="w-4 h-4" /> Restart
                </button>
                <button onClick={onReset}
                  className="py-2.5 rounded-lg font-bold text-sm border border-slate-600 text-slate-300 hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5">
                  <Home className="w-4 h-4" /> Home
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ActiveGame;
