const BASE = process.env.NEXT_PUBLIC_GAME_API || 'http://localhost:3003';

async function apiFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export type StartRoundResponse = {
  ok: true;
  roundId: string;
  newBalance: number;
  fairness: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
  };
};

export type FlipResponse = {
  ok: true;
  result: 'win' | 'lose';
  outcome: 'heads' | 'tails';
  payout: number;
  multiplier: number;
  newBalance: number;
  xp: number;
  fairness: {
    serverSeed: string;
    serverSeedHash: string;
    clientSeed: string;
    publicSeed: string;
    eisBlockHeight: number;
    nonce: number;
    ticket: number;
  };
};

export type VerifyResponse = {
  ok: true;
  computed: {
    serverSeedHash: string;
    ticket: number;
    outcome: 'heads' | 'tails';
  };
  matchesStoredRound: boolean;
};

export type CoinflipHistoryEntry = {
  roundId: string;
  result: 'win' | 'lose';
  choice: 'heads' | 'tails';
  outcome: 'heads' | 'tails';
  payout: number;
  betAmount: number;
  multiplier: number;
  serverSeedHash: string;
  clientSeed: string;
  publicSeed: string;
  eisBlockHeight?: number;
  nonce: number;
  ticket: number;
  settledAt: number;
};

export type HistoryResponse = {
  ok: true;
  history: CoinflipHistoryEntry[];
};

export type MetaResponse = {
  ok: true;
  likes: number;
  liked: boolean;
};

export const coinflipApi = {
  startRound: (token: string | undefined, betAmount: number, clientSeed?: string) =>
    apiFetch<StartRoundResponse>('POST', '/coinflip/round/start', { token, betAmount, clientSeed }),

  flip: (roundId: string, choice: 'heads' | 'tails') =>
    apiFetch<FlipResponse>('POST', '/coinflip/round/flip', { roundId, choice }),

  verify: (payload: {
    roundId: string;
    serverSeed: string;
    clientSeed: string;
    publicSeed: string;
    nonce: number;
  }) => apiFetch<VerifyResponse>('POST', '/coinflip/verify', payload),

  history: (limit = 20) => apiFetch<HistoryResponse>('GET', `/coinflip/history?limit=${limit}`),

  meta: (token?: string) =>
    apiFetch<MetaResponse>('GET', `/coinflip/meta${token ? `?token=${encodeURIComponent(token)}` : ''}`),

  like: (token?: string) => apiFetch<MetaResponse>('POST', '/coinflip/like', { token }),
};

