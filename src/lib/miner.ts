// BRC 挖矿核心 — 用于钱包内"挖矿"页。
// 只填 64 位 hex 公钥收款地址,不需私钥。在浏览器/WebView 中直接跑(fetch + 同步 Sandglass)。
import type { State } from '../vendor/bcochain/chain/state.js';
import { deserializeState, cloneState, applyBlockTxs, stateRoot } from '../vendor/bcochain/chain/state.js';
import { encodeHeader, decodeHeader, decodeBlock, type Block, type BlockHeader } from '../vendor/bcochain/chain/block.js';
import { sha256 } from '../vendor/bcochain/crypto/hash.js';
import { sandglassHash } from '../vendor/bcochain/crypto/sandglass.js';
import { nextDifficulty } from '../vendor/bcochain/chain/consensus.js';
import { compactToTarget, hashMeetsTarget, bytesToHex, hexToBytes } from '../vendor/bcochain/util/binary.js';

export const API = 'https://api1.browsercoin.org';
const ANCHOR = 35_550;

async function api(path: string): Promise<any> {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${await r.text()}`);
  return r.json();
}

async function fetchHeaderAt(height: number): Promise<BlockHeader> {
  const j = await api(`/blocks?fromHeight=${height}&max=1`);
  return decodeHeader(hexToBytes(j.blocks[0] as string), 0);
}

export interface MinerSession {
  state: State;
  tipHeight: number;
  tipHeader: BlockHeader;
  anchor: BlockHeader;
}

/** 初始化: 拉 snapshot + replay 到最新 + 取锚定块 */
export async function initSession(): Promise<MinerSession> {
  const snap = await api('/snapshot');
  const snapHeight = snap.height as number;
  let state: State = deserializeState(
    snap.accounts as [string, string, number][],
    (snap.locks ?? []) as [string, string, string, number][],
  );
  const tip = await api('/tip');
  const tipHeight = tip.height as number;
  if (tipHeight > snapHeight) {
    let cur = snapHeight + 1;
    while (cur <= tipHeight) {
      const max = Math.min(200, tipHeight - cur + 1);
      const j = await api(`/blocks?fromHeight=${cur}&max=${max}`);
      for (const b of j.blocks as string[]) {
        const blk = decodeBlock(hexToBytes(b));
        const ns = cloneState(state);
        const err = applyBlockTxs(ns, blk.header.height, blk.header.miner, blk.transactions, {
          scriptsActive: true, blockMtp: 0,
        });
        if (err) throw new Error(`replay #${blk.header.height}: ${err}`);
        state = ns;
      }
      cur += max;
    }
  }
  const tipHeader = await fetchHeaderAt(tipHeight);
  const anchor = await fetchHeaderAt(ANCHOR);
  return { state, tipHeight, tipHeader, anchor };
}

/** 建下一个空块候选(coinbase 给 miner) */
export function buildCandidate(s: MinerSession, miner: Uint8Array, timestamp: number): Block {
  const height = s.tipHeader.height + 1;
  const ns = cloneState(s.state);
  const err = applyBlockTxs(ns, height, miner, [], { scriptsActive: true, blockMtp: timestamp });
  if (err) throw new Error(`coinbase: ${err}`);
  const root = stateRoot(ns);
  const difficulty = nextDifficulty(height, [s.tipHeader], timestamp, s.anchor);
  return {
    header: {
      height,
      prevHash: sha256(encodeHeader(s.tipHeader)),
      txRoot: new Uint8Array(32),
      stateRoot: root,
      timestamp,
      difficulty,
      nonce: 0,
      miner,
    },
    transactions: [],
  };
}

/**
 * 同步找 nonce(Sandglass)。返回命中 nonce;-1 表示 32-bit 耗尽需换时间戳。
 * 单个 nonce 一次 sandglassHash(同步)。
 */
export function grindSync(header: BlockHeader, target: bigint, onProbe?: (n: number) => void): number {
  let nonce = header.nonce >>> 0;
  let count = 0;
  for (; ;) {
    header.nonce = nonce;
    if (hashMeetsTarget(sandglassHash(encodeHeader(header)), target)) return nonce;
    if (nonce === 0xffffffff) return -1;
    nonce++;
    count++;
    if (onProbe && (count & 0x1f) === 0) onProbe(count);
  }
}

/** 广播候选块(POST /block) */
export async function submitBlock(b: Block): Promise<string> {
  const body = new Uint8Array(148 + 4);
  body.set(encodeHeader(b.header), 0);
  new DataView(body.buffer).setUint32(148, 0, false);
  const r = await fetch(`${API}/block`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ block: bytesToHex(body) }),
  });
  return r.text();
}

export { compactToTarget, bytesToHex, hexToBytes, encodeHeader };

/** 每块平均期望哈希数 = 2^256 / target。difficulty 为 compact。 */
export function expectedHashesForDifficulty(difficulty: number): bigint {
  const target = compactToTarget(difficulty);
  if (target <= 0n) return 2n ** 256n;
  return (2n ** 256n) / target;
}

/** 全网算力估计(H/s) ≈ 每块期望哈希 / 目标区块时间(150s)。 */
export function estimateNetHashrate(difficulty: number): number {
  const exp = expectedHashesForDifficulty(difficulty);
  return Number(exp / 150n);
}
