'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  coinflipApi,
  type CoinflipHistoryEntry,
  type FlipResponse,
  type StartRoundResponse,
} from '../lib/api';

type Phase = 'idle' | 'playing' | 'ended';
type Choice = 'heads' | 'tails';

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

function CoinflipGame() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [betAmount, setBetAmount] = useState(5);
  const [phase, setPhase] = useState<Phase>('idle');
  const [roundId, setRoundId] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [result, setResult] = useState<FlipResult | null>(null);
  const [clientSeedInput, setClientSeedInput] = useState('');
  const [fairness, setFairness] = useState<FairnessState | null>(null);
  const [history, setHistory] = useState<CoinflipHistoryEntry[]>([]);
  const [verifyResult, setVerifyResult] = useState<{
    outcome: Choice;
    ticket: number;
    matchesStoredRound: boolean;
  } | null>(null);
  const [status, setStatus] = useState('Waiting...');
  const [loading, setLoading] = useState(false);

  const notify = useCallback((msg: string) => setStatus(msg), []);

  useEffect(() => {
    if (!token) {
      notify('No session token detected. Standalone mode can still work if backend MODE=standalone.');
      return;
    }
    notify('Session ready. Start a coinflip round.');
  }, [token, notify]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await coinflipApi.history(15);
      setHistory(res.history);
    } catch {
      // ignore history errors in UI
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const startRound = useCallback(async () => {
    if (betAmount <= 0) return notify('Enter a valid bet amount.');

    setLoading(true);
    notify('Starting round...');
    try {
      const res = (await coinflipApi.startRound(token || undefined, betAmount, clientSeedInput.trim() || undefined)) as StartRoundResponse;
      setRoundId(res.roundId);
      setBalance(res.newBalance);
      setResult(null);
      setVerifyResult(null);
      setFairness({
        serverSeedHash: res.fairness.serverSeedHash,
        clientSeed: res.fairness.clientSeed,
        nonce: res.fairness.nonce,
      });
      setPhase('playing');
      notify(`Round started. Server seed hash committed. Balance: $${res.newBalance.toFixed(2)}`);
    } catch (err: any) {
      notify(`Error: ${err.message}`);
      setPhase('idle');
    } finally {
      setLoading(false);
    }
  }, [token, betAmount, clientSeedInput, notify]);

  const doFlip = useCallback(
    async (choice: Choice) => {
      if (!roundId || phase !== 'playing') return;
      setLoading(true);
      notify(`Flipping (${choice})...`);
      try {
        const res = (await coinflipApi.flip(roundId, choice)) as FlipResponse;
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
        setPhase('ended');
        notify(
          res.result === 'win'
            ? `You won! Coin: ${res.outcome}. +$${res.payout.toFixed(2)}`
            : `You lost. Coin: ${res.outcome}.`,
        );
        loadHistory();
      } catch (err: any) {
        notify(`Error: ${err.message}`);
      } finally {
        setLoading(false);
      }
    },
    [roundId, phase, notify, loadHistory],
  );

  const reset = useCallback(() => {
    setRoundId(null);
    setResult(null);
    setFairness(null);
    setVerifyResult(null);
    setPhase('idle');
    notify('Place a new bet and start another round.');
  }, [notify]);

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm bg-surface border border-border rounded-xl p-5">
        <div className="text-center mb-5">
          <h1 className="font-extrabold text-3xl tracking-wide">
            COIN<span className="text-gold">FLIP</span>
          </h1>
          {roundId && <p className="text-xs text-muted mt-1">{roundId}</p>}
        </div>

        {balance !== null && (
          <div className="flex justify-between items-center bg-surface2 border border-border rounded-xl px-4 py-3 mb-4">
            <span className="text-xs text-muted uppercase">Balance</span>
            <span className="font-extrabold text-gold text-xl">${balance.toFixed(2)}</span>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-xs text-muted uppercase mb-2">Bet Amount ($)</label>
          <input
            type="number"
            min={1}
            step={1}
            value={betAmount}
            onChange={(e) => setBetAmount(Math.max(1, Number(e.target.value)))}
            disabled={phase === 'playing' || loading}
            className="w-full bg-surface2 border border-border text-white px-3 py-2 rounded-lg"
          />
        </div>

        <div className="mb-4">
          <label className="block text-xs text-muted uppercase mb-2">Client Seed (optional)</label>
          <input
            type="text"
            value={clientSeedInput}
            onChange={(e) => setClientSeedInput(e.target.value)}
            disabled={phase === 'playing' || loading}
            placeholder="auto-generate if empty"
            className="w-full bg-surface2 border border-border text-white px-3 py-2 rounded-lg"
          />
        </div>

        {phase === 'idle' && (
          <button
            onClick={startRound}
            disabled={loading}
            className="w-full bg-gold text-black font-bold py-3 rounded-xl disabled:opacity-40"
          >
            START ROUND
          </button>
        )}

        {phase === 'playing' && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => doFlip('heads')}
              disabled={loading}
              className="bg-accent text-black font-bold py-3 rounded-xl disabled:opacity-40"
            >
              HEADS
            </button>
            <button
              onClick={() => doFlip('tails')}
              disabled={loading}
              className="bg-accent text-black font-bold py-3 rounded-xl disabled:opacity-40"
            >
              TAILS
            </button>
          </div>
        )}

        {phase === 'ended' && result && (
          <div className="mt-4 bg-surface2 border border-border rounded-xl p-4">
            <div className={`text-xl font-bold ${result.result === 'win' ? 'text-accent' : 'text-danger'}`}>
              {result.result === 'win' ? 'YOU WIN' : 'YOU LOSE'}
            </div>
            <div className="text-sm mt-1">Outcome: {result.outcome.toUpperCase()}</div>
            <div className="text-sm">Payout: ${result.payout.toFixed(2)}</div>
            {fairness && (
              <div className="mt-3 text-xs text-muted space-y-1">
                <div>Ticket: {fairness.ticket}</div>
                <div>EIS Block: {fairness.eisBlockHeight}</div>
                <div className="break-all">Server Seed: {fairness.serverSeed}</div>
                <div className="break-all">Public Seed: {fairness.publicSeed}</div>
              </div>
            )}
            <button
              onClick={verifyFlip}
              disabled={loading || !fairness?.serverSeed}
              className="mt-3 w-full bg-accent text-black font-bold py-2 rounded-lg disabled:opacity-40"
            >
              VERIFY RESULT
            </button>
            {verifyResult && (
              <div className={`mt-2 text-xs ${verifyResult.matchesStoredRound ? 'text-accent' : 'text-danger'}`}>
                Verify: {verifyResult.matchesStoredRound ? 'PASS' : 'FAIL'} | outcome {verifyResult.outcome.toUpperCase()} | ticket {verifyResult.ticket}
              </div>
            )}
            <button onClick={reset} className="mt-3 w-full bg-surface border border-border py-2 rounded-lg">
              Play Again
            </button>
          </div>
        )}

        {fairness && (
          <div className="mt-4 text-xs text-muted bg-surface2 border border-border rounded-lg px-3 py-2 space-y-1">
            <div className="text-white font-semibold">Provably Fair</div>
            <div className="break-all">Server Seed Hash: {fairness.serverSeedHash}</div>
            <div className="break-all">Client Seed: {fairness.clientSeed}</div>
            <div>Nonce: {fairness.nonce}</div>
            <button
              onClick={copyFairnessJson}
              className="mt-2 w-full bg-surface border border-border py-2 rounded-lg text-white"
            >
              COPY FAIRNESS JSON
            </button>
          </div>
        )}

        <div className="mt-4 bg-surface2 border border-border rounded-xl p-3">
          <div className="text-white font-semibold text-sm mb-2">Recent CoinFlip History</div>
          {history.length === 0 ? (
            <div className="text-xs text-muted">No completed rounds yet.</div>
          ) : (
            <div className="max-h-56 overflow-auto text-xs">
              <table className="w-full">
                <thead>
                  <tr className="text-muted">
                    <th className="text-left py-1">Round</th>
                    <th className="text-left py-1">Result</th>
                    <th className="text-left py-1">Outcome</th>
                    <th className="text-right py-1">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.roundId} className="border-t border-border">
                      <td className="py-1 pr-2">{h.roundId}</td>
                      <td className={`py-1 ${h.result === 'win' ? 'text-accent' : 'text-danger'}`}>
                        {h.result.toUpperCase()}
                      </td>
                      <td className="py-1">{h.outcome.toUpperCase()}</td>
                      <td className="py-1 text-right">${h.payout.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-4 text-xs text-muted bg-surface2 border border-border rounded-lg px-3 py-2">
          {status}
        </div>

        {!token && (
          <div className="mt-3 text-center text-xs text-muted">
            For production, open this game from the <a href="http://localhost:3002" className="text-gold underline">casino platform</a>
          </div>
        )}
      </div>
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

