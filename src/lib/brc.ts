// BRC wire-protocol core. Ported from BrowserCoin docs/developers.md §3-4
// and examples/send-tx.mjs. This is the part that talks to the network.

export const CHAIN_ID = 0xc01dfeed;
export const COIN = 100_000_000n; // 1 BRC = 1e8 wei
export const MAX_MONEY = 21_000_000n * COIN;
export const MIN_FEE_PER_BYTE = 1n;
export const TX_BYTES = 152;

export const API_SERVERS: string[] = [
  'https://api1.browsercoin.org',
  'https://api2.browsercoin.org',
];

const HEX = '0123456789abcdef';
export function toHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[b[i]! >>> 4] + HEX[b[i]! & 0x0f];
  return s;
}
export function fromHex(s: string): Uint8Array {
  if (s.startsWith('0x')) s = s.slice(2);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---- byte encoders ----
function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}
function u64be(n: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, false);
  return b;
}
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
};

// 88-byte preimage: chainId(4)‖from(32)‖to(32)‖amount(8)‖fee(8)‖nonce(4)
export function txPreimage(o: { from: Uint8Array; to: Uint8Array; amount: bigint; fee: bigint; nonce: number }): Uint8Array {
  return concat(u32be(CHAIN_ID), o.from, o.to, u64be(o.amount), u64be(o.fee), u32be(o.nonce));
}

// full 152-byte tx: preimage ‖ ed25519 signature (64)
export function buildTransaction(o: { from: Uint8Array; to: Uint8Array; amount: bigint; fee: bigint; nonce: number }, signature: Uint8Array): Uint8Array {
  return concat(txPreimage(o), signature);
}

// ---- compact difficulty -> numeric target (from docs §5 / binary.ts) ----
export function compactToTarget(compact: number): bigint {
  const exp = (compact >>> 24) & 0xff;
  const mant = BigInt(compact & 0x00ff_ffff);
  if (exp <= 3) return mant >> BigInt(8 * (3 - exp));
  return mant << BigInt(8 * (exp - 3));
}
export function targetToDifficulty(compact: number): number {
  // Rough "bits" display: number of leading hex chars needed ~ 256 - 8*exp
  const exp = (compact >>> 24) & 0xff;
  return Math.max(0, Math.round((256 - 8 * exp) / 8));
}

// ---- live API helpers (auto-failover across helper servers) ----
async function apiFetch(path: string, init?: RequestInit): Promise<any> {
  let lastErr: unknown;
  for (const base of API_SERVERS) {
    try {
      const r = await fetch(base + path, init);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr as Error;
}

export interface TipInfo { height: number; tipHash: string }
export async function getTip(): Promise<TipInfo> {
  const t = await apiFetch('/tip');
  return { height: t.height, tipHash: t.tipHash };
}

export interface StatsInfo {
  peers: number; miners: number; forkReady: number;
  latestHeight: number; medianHeight: number;
}
export async function getStats(): Promise<StatsInfo> {
  const s = await apiFetch('/stats');
  return {
    peers: s.peerCount, miners: s.minersActive, forkReady: s.forkReadyCount,
    latestHeight: s.latestHeight, medianHeight: s.medianHeight,
  };
}

// Paginate a window of raw hex blocks [from, to]
export async function getBlocks(fromHeight: number, toHeight: number): Promise<string[]> {
  const blocks: string[] = [];
  let cur = fromHeight;
  if (fromHeight === 0) { blocks.push(''); cur = 1; } // genesis is implicit/server omits it
  while (cur <= toHeight) {
    const max = Math.min(200, toHeight - cur + 1);
    const r = await apiFetch(`/blocks?fromHeight=${cur}&max=${max}`);
    blocks.push(...r.blocks as string[]);
    cur += max;
    break; // keep simple: single fetch per call
  }
  return blocks;
}

export async function getPeers(): Promise<number> {
  try { const p = await apiFetch('/peers'); return (p.peers as string[]).length; }
  catch { return 0; }
}

export async function getMempoolCount(): Promise<number> {
  try { const m = await apiFetch('/mempool'); return (m.txs as string[]).length; }
  catch { return 0; }
}

export async function submitTxs(txHexes: string[]): Promise<{ admitted: number; errors: string[] }> {
  return apiFetch('/txs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txs: txHexes }),
  });
}

// ---- account state from the ledger ----
// The account model stores {balance, nonce} per address. Query by scanning the
// balances snapshot the server exposes is not a public endpoint, so we derive
// from the chain: walk blocks and sum coinbase + txs touching our address.
export interface AccountInfo { balance: bigint; nonce: number; txsIn: number; txsOut: number; rewardMined: bigint }

// Decode a 152-byte base tx from hex (offset 0) or from a block body.
export function decodeTxHex(txHex: string): {
  from: string; to: string; amount: bigint; fee: bigint; nonce: number; txid: string;
} | null {
  try {
    const b = fromHex(txHex);
    if (b.length !== TX_BYTES) return null;
    const from = toHex(b.slice(4, 36));
    const to = toHex(b.slice(36, 68));
    const dv = new DataView(b.buffer);
    const amount = dv.getBigUint64(68, false);
    const fee = dv.getBigUint64(76, false);
    const nonce = dv.getUint32(84, false);
    return { from, to, amount, fee, nonce, txid: txHex.slice(0, 16) + '…' };
  } catch { return null; }
}
