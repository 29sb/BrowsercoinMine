/// <reference lib="webworker" />
// 挖矿 Worker — 逐字节对齐官方 miner.worker.ts 的 grind 结构。
// 要点: 用 async powHash + 动态 batch + nonce 连续递增(contiguous),与官方一致,
// 因为官方这套在同样浏览器里能达到多核算力(431 H/s)。
import { powHash } from './vendor/bcochain/crypto/pow.js';
import { hashMeetsTarget } from './vendor/bcochain/util/binary.js';

const NONCE_OFFSET = 112;
const YIELD_TARGET_MS = 64;
const MAX_BATCH = 1024;

interface StartMsg {
  type: 'start';
  headerBytes: Uint8Array;
  targetHex: string;    // hex of bigint target (256-bit)
  startNonce: number;   // 该 worker 的起始 nonce
}
type Msg = StartMsg | { type: 'stop' };

let mining = false;
let generation = 0;

self.onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data;
  if (msg.type === 'stop') {
    mining = false;
    generation++;
    return;
  }
  if (msg.type === 'start') {
    mining = true;
    const myGen = generation;
    grind(msg, myGen);
  }
};

async function grind(msg: StartMsg, myGen: number): Promise<void> {
  const header = new Uint8Array(msg.headerBytes); // own copy; we mutate nonce
  const target = BigInt('0x' + msg.targetHex);
  let nonce = msg.startNonce >>> 0;
  let hashes = 0;
  let report = performance.now();
  let workWindowStart = report;
  let batch = 1; // ~1 在 Argon2id,~7 在 Sandglass(与官方同策略)

  while (mining && myGen === generation) {
    let completed = 0;
    const batchStart = performance.now();
    for (let i = 0; i < batch; i++) {
      header[NONCE_OFFSET]     = (nonce >>> 24) & 0xff;
      header[NONCE_OFFSET + 1] = (nonce >>> 16) & 0xff;
      header[NONCE_OFFSET + 2] = (nonce >>> 8) & 0xff;
      header[NONCE_OFFSET + 3] = nonce & 0xff;
      const h = await powHash(header);
      if (hashMeetsTarget(h, target)) {
        self.postMessage({ type: 'found', nonce });
      }
      nonce = (nonce + 1) >>> 0; // 连续递增(与官方一致)
      completed++;
      if (nonce === msg.startNonce) {
        self.postMessage({ type: 'exhausted' });
        return;
      }
    }
    hashes += completed;

    const now = performance.now();
    if (completed === batch) {
      const per = (now - batchStart) / batch;
      if (per > 0) batch = Math.max(1, Math.min(MAX_BATCH, Math.round(YIELD_TARGET_MS / per)));
    }

    if (now - workWindowStart >= 1000) {
      const hps = Math.round(hashes / ((now - workWindowStart) / 1000));
      self.postMessage({ type: 'progress', hps, count: hashes });
      workWindowStart = now;
      hashes = 0;
    }
  }
}
