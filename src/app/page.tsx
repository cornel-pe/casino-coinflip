'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import {
  Button,
  Card,
  CardBody,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Slider,
  Switch,
  Tab,
  Tabs,
} from '@heroui/react';
import {
  coinflipApi,
  type CoinflipHistoryEntry,
  type FlipResponse,
  type StartRoundResponse,
} from '../lib/api';

type Phase = 'idle' | 'playing' | 'ended' | 'streak_decision';
type Choice = 'heads' | 'tails';
type PlayMode = 'solo' | 'streak';

type FlipResult = {
  result: 'win' | 'lose';
  outcome: Choice;
  payout: number;
  multiplier: number;
};

type FairnessState = {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  serverSeed?: string;
  publicSeed?: string;
  eisBlockHeight?: number;
  ticket?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function CoinflipGame() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [playMode, setPlayMode] = useState<PlayMode>('solo');
  const [betAmount, setBetAmount] = useState(5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [roundId, setRoundId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [result, setResult] = useState<FlipResult | null>(null);
  const [clientSeedInput, setClientSeedInput] = useState('');
  const [fairness, setFairness] = useState<FairnessState | null>(null);
  const [history, setHistory] = useState<CoinflipHistoryEntry[]>([]);
  const [likes, setLikes] = useState(0);
  const [liked, setLiked] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showFairness, setShowFairness] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [streakRound, setStreakRound] = useState(0);
  const [streakCurrentBet, setStreakCurrentBet] = useState<number | null>(null);
  const [streakProfit, setStreakProfit] = useState(0);
  const [verifyResult, setVerifyResult] = useState<{
    outcome: Choice;
    ticket: number;
    matchesStoredRound: boolean;
  } | null>(null);
  const [status, setStatus] = useState('Waiting...');
  const [loading, setLoading] = useState(false);
  const [animationEnabled, setAnimationEnabled] = useState(true);
  const [turboMode, setTurboMode] = useState(false);
  const [allSounds, setAllSounds] = useState(true);
  const [musicVolume, setMusicVolume] = useState(50);
  const [effectsVolume, setEffectsVolume] = useState(50);

  const [spriteOutcome, setSpriteOutcome] = useState<Choice>('heads');
  const [flipping, setFlipping] = useState(false);
  const [countDown, setCountDown] = useState(0);
  const [coinRotateDeg, setCoinRotateDeg] = useState(45);
  /** From backend: 2 * (1 - houseEdge) for a fair coin. */
  const [baseMultiplier, setBaseMultiplier] = useState(1.96);
  const [houseEdge, setHouseEdge] = useState(0.02);

  const notify = useCallback((msg: string) => setStatus(msg), []);

  const displayedMultiplier = useMemo(() => {
    const streakFactor = playMode === 'streak' ? 2 ** streakRound : 1;
    return +(baseMultiplier * streakFactor).toFixed(2);
  }, [baseMultiplier, playMode, streakRound]);

  useEffect(() => {
    if (!token) {
      notify('No session token detected. Standalone mode can still work if backend MODE=standalone.');
      return;
    }
    notify('Session ready. Start a coinflip round.');
  }, [token, notify]);

  useEffect(() => {
    if (!flipping) {
      setCoinRotateDeg(45);
      return;
    }
    const from = Math.random() * 45;
    const to = from + 45;
    setCoinRotateDeg(from);
    const t = window.setTimeout(() => setCoinRotateDeg(to), 30);
    return () => clearTimeout(t);
  }, [flipping]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await coinflipApi.history(15);
      setHistory(res.history);
    } catch {
      // ignore history errors in UI
    }
  }, []);

  const loadMeta = useCallback(async () => {
    try {
      const res = await coinflipApi.meta(token || undefined);
      setLikes(res.likes);
      setLiked(res.liked);
      if (typeof res.baseMultiplier === 'number') setBaseMultiplier(res.baseMultiplier);
      if (typeof res.houseEdge === 'number') setHouseEdge(res.houseEdge);
    } catch {
      // ignore
    }
  }, [token]);

  useEffect(() => {
    loadHistory();
    loadMeta();
  }, [loadHistory, loadMeta]);

  const startRound = useCallback(async (overrideBet?: number) => {
    if (betAmount <= 0) return notify('Enter a valid bet amount.');
    const activeBet = overrideBet ?? betAmount;
    if (activeBet <= 0) return notify('Enter a valid bet amount.');

    setLoading(true);
    notify('Starting round...');
    try {
      const res = (await coinflipApi.startRound(
        token || undefined,
        activeBet,
        clientSeedInput.trim() || undefined,
      )) as StartRoundResponse;
      setRoundId(res.roundId);
      setBalance(res.newBalance);
      setResult(null);
      setVerifyResult(null);
      setFlipping(false);
      setCountDown(0);
      setFairness({
        serverSeedHash: res.fairness.serverSeedHash,
        clientSeed: res.fairness.clientSeed,
        nonce: res.fairness.nonce,
      });
      if (typeof res.baseMultiplier === 'number') setBaseMultiplier(res.baseMultiplier);
      if (typeof res.houseEdge === 'number') setHouseEdge(res.houseEdge);
      if (playMode === 'streak') {
        if (!overrideBet) {
          setStreakRound(0);
          setStreakProfit(0);
        }
        setStreakCurrentBet(activeBet);
      }
      setPhase('playing');
      notify(`Round started. Server seed hash committed. Balance: $${res.newBalance.toFixed(2)}`);
    } catch (err: any) {
      notify(`Error: ${err.message}`);
      setPhase('idle');
    } finally {
      setLoading(false);
    }
  }, [token, betAmount, clientSeedInput, notify, playMode]);

  const doFlip = useCallback(
    async (choice: Choice) => {
      if (!roundId || phase !== 'playing') return;
      setLoading(true);
      notify(`Flipping (${choice})...`);
      setResult(null);
      try {
        const countdownDelay = turboMode ? 300 : 700;
        for (let n = 3; n >= 1; n--) {
          setCountDown(n);
          await sleep(countdownDelay);
        }
        setCountDown(0);

        const res = (await coinflipApi.flip(roundId, choice)) as FlipResponse;
        setSpriteOutcome(res.outcome);
        setFlipping(true);
        await sleep(turboMode ? 1200 : 3000);

        flushSync(() => {
          setBalance(res.newBalance);
          setResult({
            result: res.result,
            outcome: res.outcome,
            payout: res.payout,
            multiplier: res.multiplier,
          });
          setFairness((prev) => ({
            serverSeedHash: res.fairness.serverSeedHash,
            clientSeed: res.fairness.clientSeed,
            nonce: res.fairness.nonce,
            serverSeed: res.fairness.serverSeed,
            publicSeed: res.fairness.publicSeed,
            eisBlockHeight: res.fairness.eisBlockHeight,
            ticket: res.fairness.ticket,
          }));

          if (playMode === 'streak') {
            if (res.result === 'win') {
              const nextBet = res.payout;
              const base = streakCurrentBet ?? betAmount;
              setStreakCurrentBet(nextBet);
              setStreakRound((prev) => prev + 1);
              setStreakProfit((prev) => +(prev + (res.payout - base)).toFixed(2));
              setPhase('streak_decision');
            } else {
              setStreakCurrentBet(null);
              setStreakRound(0);
              setPhase('ended');
            }
          } else {
            setPhase('ended');
          }

          setFlipping(false);
        });

        if (playMode === 'streak') {
          if (res.result === 'win') {
            notify(`Streak win! Next bet $${res.payout.toFixed(2)} or cashout.`);
          } else {
            notify(`Streak ended. Coin: ${res.outcome}.`);
          }
        } else {
          notify(
            res.result === 'win'
              ? `You won! Coin: ${res.outcome}. +$${res.payout.toFixed(2)}`
              : `You lost. Coin: ${res.outcome}.`,
          );
        }
        loadHistory();
      } catch (err: any) {
        notify(`Error: ${err.message}`);
        setCountDown(0);
        setFlipping(false);
      } finally {
        setLoading(false);
      }
    },
    [roundId, phase, notify, loadHistory, playMode, streakCurrentBet, betAmount, turboMode],
  );

  const reset = useCallback(() => {
    setRoundId(null);
    setResult(null);
    setFairness(null);
    setVerifyResult(null);
    setFlipping(false);
    setCountDown(0);
    setPhase('idle');
    setStreakRound(0);
    setStreakCurrentBet(null);
    setStreakProfit(0);
    notify('Place a new bet and start another round.');
  }, [notify]);

  const continueStreak = useCallback(async () => {
    if (playMode !== 'streak') return;
    const nextBet = streakCurrentBet ?? 0;
    if (nextBet <= 0) return;
    await startRound(nextBet);
  }, [playMode, streakCurrentBet, startRound]);

  const cashoutStreak = useCallback(() => {
    setPhase('idle');
    notify(`Streak cashed out. Total streak profit: $${streakProfit.toFixed(2)}`);
  }, [streakProfit, notify]);

  const verifyFlip = useCallback(async () => {
    if (
      !roundId ||
      !fairness?.serverSeed ||
      !fairness.clientSeed ||
      !fairness.publicSeed ||
      fairness.nonce === undefined
    ) {
      notify('Missing fairness data to verify.');
      return;
    }

    setLoading(true);
    notify('Verifying result...');
    try {
      const res = await coinflipApi.verify({
        roundId,
        serverSeed: fairness.serverSeed,
        clientSeed: fairness.clientSeed,
        publicSeed: fairness.publicSeed,
        nonce: fairness.nonce,
      });
      setVerifyResult({
        outcome: res.computed.outcome,
        ticket: res.computed.ticket,
        matchesStoredRound: res.matchesStoredRound,
      });
      notify(res.matchesStoredRound ? 'Verification passed.' : 'Verification mismatch.');
    } catch (err: any) {
      notify(`Verify error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [roundId, fairness, notify]);

  const copyFairnessJson = useCallback(async () => {
    if (!roundId || !fairness) {
      notify('No fairness data to copy.');
      return;
    }

    const payload = {
      roundId,
      serverSeedHash: fairness.serverSeedHash,
      clientSeed: fairness.clientSeed,
      nonce: fairness.nonce,
      serverSeed: fairness.serverSeed,
      publicSeed: fairness.publicSeed,
      eisBlockHeight: fairness.eisBlockHeight,
      ticket: fairness.ticket,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      notify('Fairness JSON copied to clipboard.');
    } catch {
      notify('Could not copy to clipboard.');
    }
  }, [roundId, fairness, notify]);

  const likeGame = useCallback(async () => {
    if (liked) return;
    try {
      const res = await coinflipApi.like(token || undefined);
      setLikes(res.likes);
      setLiked(res.liked);
    } catch {
      notify('Could not register like.');
    }
  }, [liked, token, notify]);

  const quickSetBet = useCallback((value: number) => {
    setBetAmount(Math.max(1, value));
  }, []);

  const halveBet = useCallback(() => setBetAmount((v) => Math.max(1, +(v / 2).toFixed(2))), []);
  const doubleBet = useCallback(() => setBetAmount((v) => +(v * 2).toFixed(2)), []);
  const maxBet = useCallback(() => {
    const b = balance ?? betAmount;
    setBetAmount(Math.max(1, +b.toFixed(2)));
  }, [balance, betAmount]);

  return (
    <div className="min-h-screen bg-bg p-3">
      <div className="mx-auto max-w-[1200px]">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-3">
          <Card className="bg-surface border border-border">
            <CardBody className="gap-3">
              <Tabs
                selectedKey={playMode}
                onSelectionChange={(k) => setPlayMode(String(k) as PlayMode)}
                variant="underlined"
                fullWidth
                color="primary"
                classNames={{
                  tabList: "scrollbar-hide!"
                }}
              >
                <Tab key="solo" title="Solo" />
                <Tab key="streak" title="Streak" />
              </Tabs>

              <div className="text-sm font-semibold text-white flex items-center justify-between">
                <span>Amount</span>
                <span>${(balance ?? 0).toFixed(2)}</span>
              </div>

              <div className="flex items-stretch rounded-lg border border-border bg-surface2 min-h-12 overflow-hidden">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={String(betAmount)}
                  onChange={(e) => setBetAmount(Math.max(1, Number(e.target.value)))}
                  isDisabled={phase === 'playing' || loading}
                  classNames={{
                    base: 'flex-1 min-w-0',
                    inputWrapper:
                      'bg-transparent shadow-none border-none rounded-none h-12 min-h-12 px-3 data-[hover=true]:bg-transparent group-data-[focus=true]:bg-transparent',
                    input: 'text-lg font-medium text-white! placeholder:text-muted',
                  }}
                />
                <div className="flex items-center gap-1 shrink-0 pr-2 pl-1 border-l border-border">
                  <Button
                    size="md"
                    color="warning"
                    variant="flat"
                    className="w-12 px-2 text-white font-medium"
                    onPress={halveBet}
                    isDisabled={phase === 'playing' || loading}
                  >
                    /2
                  </Button>
                  <Button
                    size="md"
                    color="warning"
                    variant="flat"
                    className="w-12 px-2 text-white font-medium"
                    onPress={doubleBet}
                    isDisabled={phase === 'playing' || loading}
                  >
                    x2
                  </Button>
                  <Button
                    size="md"
                    color="warning"
                    variant="flat"
                    className="w-12 px-2 text-white font-medium"
                    onPress={maxBet}
                    isDisabled={phase === 'playing' || loading}
                  >
                    Max
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[1, 10, 100, 1000].map((n) => (
                  <Button key={n} size="md" variant="flat" onPress={() => quickSetBet(n)} className='font-bold text-white' color='warning'>
                    {n >= 1000 ? '1K' : n}
                  </Button>
                ))}
              </div>

              <Input
                type="text"
                value={clientSeedInput}
                onChange={(e) => setClientSeedInput(e.target.value)}
                isDisabled={phase === 'playing' || loading}
                placeholder="Client Seed (optional)"
                classNames={{ inputWrapper: 'bg-surface2 border border-border' }}
              />

              {phase === 'idle' && (
                <Button
                  color="primary"
                  onPress={() => startRound()}
                  isDisabled={loading}
                  className="font-bold text-black"
                  fullWidth
                >
                  Start Round
                </Button>
              )}

              {(phase === 'playing' || phase === 'streak_decision') && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onPress={() => doFlip('heads')}
                    isDisabled={loading || phase !== 'playing' || flipping || countDown > 0}
                    variant="flat"
                    fullWidth
                    className='font-bold bg-success'
                  >
                    Bet Heads
                  </Button>
                  <Button
                    onPress={() => doFlip('tails')}
                    isDisabled={loading || phase !== 'playing' || flipping || countDown > 0}
                    variant="flat"
                    fullWidth
                    className='font-bold bg-default'
                  >
                    Bet Tails
                  </Button>
                </div>
              )}

              {playMode === 'streak' && phase === 'streak_decision' && (
                <div className="grid grid-cols-2 gap-2">
                  <Button color="primary" onPress={continueStreak} isDisabled={loading} className="font-bold">
                    Continue
                  </Button>
                  <Button variant="flat" onPress={cashoutStreak} className="font-bold">
                    Cashout
                  </Button>
                </div>
              )}

              {phase === 'ended' && (
                <Button variant="flat" onPress={reset} fullWidth className='bg-primary font-bold'>
                  Play Again
                </Button>
              )}

              <div className="flex items-center justify-between text-sm bg-surface2 border border-border rounded-lg px-3 py-2">
                <span className="text-muted">Profit</span>
                <span className="font-semibold text-white">
                  {playMode === 'streak' ? `$${streakProfit.toFixed(2)}` : `$${((result?.payout ?? 0) - betAmount).toFixed(2)}`}
                </span>
              </div>

              {playMode === 'streak' && (
                <div className="flex items-center justify-between text-xs text-muted bg-surface2 border border-border rounded-lg px-3 py-2">
                  <span>Current Streak Bet</span>
                  <span className="text-white font-semibold">${(streakCurrentBet ?? betAmount).toFixed(2)}</span>
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="bg-surface border border-border">
            <CardBody className="flex flex-col justify-between min-h-[560px]">
              <div className="mb-3 rounded-lg border border-border bg-surface2 px-2 py-2 overflow-x-auto">
                <div className="flex gap-2 min-w-max">
                  {history.slice(0, 20).map((h) => (
                    <span
                      key={`${h.roundId}-${h.settledAt}`}
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${h.result === 'win' ? 'bg-accent/15 text-accent' : 'bg-danger/15 text-danger'
                        }`}
                    >
                      {h.outcome === 'heads' ? 'H' : 'T'}
                    </span>
                  ))}
                  {history.length === 0 && <span className="text-xs text-muted px-2">No recent flips</span>}
                </div>
              </div>

              <div className="relative flex-1 grid place-items-center overflow-x-hidden overflow-y-visible min-h-[280px] rounded-xl border border-border bg-[radial-gradient(circle_at_center,#111827_0%,#070b12_60%,#04070d_100%)]">

                <div className="text-center w-full max-w-[520px]">
                  <div className="grid grid-cols-[80px_1fr_110px] items-center gap-2">
                    <div
                      className={`rounded-xl border border-border w-[120px] h-[80px] py-4 flex flex-col items-center justify-center text-sm font-bold ${
                        playMode === 'streak'
                          ? streakRound > 0
                            ? 'text-accent bg-accent/10'
                            : 'text-muted bg-surface2'
                          : result?.result === 'win'
                            ? 'text-accent bg-accent/10'
                            : 'text-muted bg-surface2'
                      }`}
                    >
                      <span className="font-bold text-base tabular-nums">
                        {playMode === 'streak' ? streakRound : result?.result?.toUpperCase() ?? '—'}
                      </span>
                      <span className="text-xs font-medium">{playMode === 'streak' ? 'Streak' : 'Series'}</span>
                    </div>
                    <div className="">
                      <div className="mx-auto h-[100px] w-[100px] ">
                        <div className='z-50 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'>
                          {countDown === 0 ? <div
                            className="mx-auto"
                            style={{
                              zIndex: 1000,
                              width: '248px',
                              height: '248px',
                              rotate: `12deg`,
                              backgroundImage: `url(/assets/images/coinflip_${spriteOutcome}.png)`,
                              backgroundSize: '248px 12648px',
                              backgroundPosition: flipping ? '0px -12648px' : '0px 248px',
                              transition: flipping ? `background-position ${turboMode ? 1.2 : 3}s steps(52)` : 'none',
                            }}
                          /> :
                            <div className="relative">
                              <p className="text-primary text-4xl font-bold animate-ping absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                                {countDown}
                              </p>
                              <p className="text-primary text-4xl font-bold drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]">
                                {countDown}
                              </p>
                            </div>
                          }
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-surface2 py-4 w-[120px]">
                      <div className="text-3xl font-bold text-white tabular-nums">x{displayedMultiplier.toFixed(2)}</div>
                      <div className="text-xs text-muted">Multiplier</div>
                      <div className="text-[10px] text-muted leading-tight mt-1 px-1">
                        {playMode === 'streak' && streakRound > 0
                          ? `Base ×2^${streakRound}`
                          : `Base x${baseMultiplier.toFixed(2)} · ${(houseEdge * 100).toFixed(1)}% edge`}
                      </div>
                    </div>
                  </div>
                  {/* {result && (
                    <div className={`mt-8 text-sm ${result.result === 'win' ? 'text-accent' : 'text-danger'}`}>
                      {result.result.toUpperCase()} · {result.outcome.toUpperCase()} ·
                    </div>
                  )} */}
                  {/* {isFlipping && (
                    <div className="mt-2 text-sm text-gold animate-pulse absolute top-3/4 left-1/2 -translate-x-1/2 -translate-y-1/2">Flipping coin...</div>
                  )} */}
                </div>
              </div>

              <div className="mt-4 text-xs text-muted bg-surface2 border border-border rounded-lg px-3 py-2">
                {status}
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div>
            <Button size="sm" variant="flat" onPress={likeGame} isDisabled={liked}>
              {liked ? '♥' : '♡'} {likes}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="flat" isIconOnly onPress={() => setShowStats(true)} aria-label="Statistic">
              📊
            </Button>
            <Button size="sm" variant="flat" isIconOnly onPress={() => setShowFairness(true)} aria-label="Fairness">
              🛡️
            </Button>
            <Button size="sm" variant="flat" isIconOnly aria-label="Help">
              ❔
            </Button>
            <Button size="sm" variant="flat" isIconOnly aria-label="Keyboard">
              ⌨️
            </Button>
            <Button size="sm" variant="flat" isIconOnly aria-label="Fullscreen">
              ⛶
            </Button>
            <Button size="sm" variant="flat" isIconOnly onPress={() => setShowSettings(true)} aria-label="Setting">
              ⚙️
            </Button>
          </div>
        </div>

        {!token && (
          <div className="mt-2 text-center text-xs text-muted">
            For production, open this game from the <a href="http://localhost:3002" className="text-gold underline">casino platform</a>
          </div>
        )}
      </div>

      <Modal isOpen={showStats} onOpenChange={setShowStats} size="xl" placement="center">
        <ModalContent className="bg-surface text-white">
          <ModalHeader>Recent CoinFlip History</ModalHeader>
          <ModalBody>
            {history.length === 0 ? (
              <div className="text-sm text-muted mb-4">No completed rounds yet.</div>
            ) : (
              <div className="max-h-96 overflow-auto text-sm">
                <table className="w-full">
                  <thead>
                    <tr className="text-muted">
                      <th className="text-left py-1">Round</th>
                      <th className="text-left py-1">Result</th>
                      <th className="text-left py-1">Outcome</th>
                      <th className="text-right py-1">Bet</th>
                      <th className="text-right py-1">Payout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.roundId} className="border-t border-border">
                        <td className="py-1 pr-2">{h.roundId}</td>
                        <td className={h.result === 'win' ? 'text-accent' : 'text-danger'}>{h.result.toUpperCase()}</td>
                        <td>{h.outcome.toUpperCase()}</td>
                        <td className="text-right">${h.betAmount.toFixed(2)}</td>
                        <td className="text-right">${h.payout.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      <Modal isOpen={showFairness} onOpenChange={setShowFairness} size="lg" placement="center">
        <ModalContent className="bg-surface text-white">
          <ModalHeader>Provably Fair</ModalHeader>
          <ModalBody>
            {fairness ? (
              <div className="space-y-2 text-sm pb-4">
                <div className="break-all"><span className="text-muted">Server Seed Hash:</span> {fairness.serverSeedHash}</div>
                <div className="break-all"><span className="text-muted">Client Seed:</span> {fairness.clientSeed}</div>
                <div><span className="text-muted">Nonce:</span> {fairness.nonce}</div>
                {fairness.publicSeed && <div className="break-all"><span className="text-muted">Public Seed:</span> {fairness.publicSeed}</div>}
                {fairness.eisBlockHeight !== undefined && <div><span className="text-muted">EIS Block:</span> {fairness.eisBlockHeight}</div>}
                {fairness.ticket !== undefined && <div><span className="text-muted">Ticket:</span> {fairness.ticket}</div>}
                {fairness.serverSeed && <div className="break-all"><span className="text-muted">Server Seed:</span> {fairness.serverSeed}</div>}
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <Button onPress={verifyFlip} isDisabled={loading || !fairness.serverSeed} color="primary">Verify Result</Button>
                  <Button onPress={copyFairnessJson} variant="flat">Copy JSON</Button>
                </div>
                {verifyResult && (
                  <div className={verifyResult.matchesStoredRound ? 'text-accent' : 'text-danger'}>
                    {verifyResult.matchesStoredRound ? 'PASS' : 'FAIL'} | outcome {verifyResult.outcome.toUpperCase()} | ticket {verifyResult.ticket}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted pb-4">Start and resolve a round to see fairness data.</div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      <Modal isOpen={showSettings} onOpenChange={setShowSettings} size="sm" placement="bottom-center">
        <ModalContent className="bg-surface text-white">
          <ModalHeader>Settings</ModalHeader>
          <ModalBody>
            <div className="space-y-4 pb-4">
              <Switch isSelected={animationEnabled} onValueChange={setAnimationEnabled}>Animation</Switch>
              <Switch isSelected={turboMode} onValueChange={setTurboMode}>Turbo Mode</Switch>
              <Switch isSelected={allSounds} onValueChange={setAllSounds}>All Sounds</Switch>

              <div className="pt-2">
                <div className="text-sm text-muted mb-1">Music</div>
                <Slider
                  size="sm"
                  color="warning"
                  value={musicVolume}
                  onChange={(v) => setMusicVolume(Number(v))}
                  minValue={0}
                  maxValue={100}
                  isDisabled={!allSounds}
                  aria-label="Music volume"
                />
              </div>
              <div className="pt-1">
                <div className="text-sm text-muted mb-1">Effects</div>
                <Slider
                  size="sm"
                  color="warning"
                  value={effectsVolume}
                  onChange={(v) => setEffectsVolume(Number(v))}
                  minValue={0}
                  maxValue={100}
                  isDisabled={!allSounds}
                  aria-label="Effects volume"
                />
              </div>
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-bg flex items-center justify-center text-muted">Loading...</div>}>
      <CoinflipGame />
    </Suspense>
  );
}

