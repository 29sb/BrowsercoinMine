/// <reference lib="webworker" />
// 挖矿 Worker — 在主线程外跑 Sandglass 找 nonce,避免冻结 UI。
// 支持并行: 每个 worker 用 startNonce + i*stride 分配互不重叠的 nonce。
import { sandglassHash } from './vendor/bcochain/crypto/sandglass.js';
import { encodeHeader } from './vendor/bcochain/chain/block.js';
import { hashMeetsTarget } from './vendor/bcochain/util/binary.js';

interface StartMsg {
  type: 'start';
  headerBytes: Uint8Array;
  targetHex: string;
  startNonce: number;   // 该 worker 的第一个 nonce
  stride: number;       // 核数(步长),保证并行不重叠
}
type Msg = StartMsg | { type: 'stop' };

let mining = false;

self.onmessage = (e: MessageEvent<Msg>) => {
  const msg = e.data;
  if (msg.type === 'stop') {
    mining = false;
    return;
  }
  if (msg.type === 'start') {
    mining = true;
    try {
      grindLoop(msg.headerBytes, msg.targetHex, msg.startNonce, msg.stride);
    } catch (err: any) {
      self.postMessage({ type: 'error', message: String(err?.message ?? err) });
    }
  }
};

function grindLoop(headerBytes: Uint8Array, targetHex: string, startNonce: number, stride: number): void {
  const header = new Uint8Array(headerBytes);
  const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const target = BigInt('0x' + targetHex);
  let nonce = startNonce >>> 0;
  let count = 0;
  const t0 = Date.now();
  let reportAt = Date.now() + 2000;

  while (mining) {
    dv.setUint32(112, nonce, false); // nonce 在 header 的 offset 112
    if (hashMeetsTarget(sandglassHash(header), target)) {
      self.postMessage({ type: 'found', nonce });
      // 命中后告知其它 worker 停止
      self.postMessage({ type: 'stop-others' });
      return;
    }
    nonce = (nonce + stride) >>> 0; // 每隔 stride 一个,与其他核不重叠
    count++;
    if (Date.now() >= reportAt) {
      const hps = Math.round(count / ((Date.now() - t0) / 1000));
      self.postMessage({ type: 'progress', hps, count });
      reportAt = Date.now() + 2000;
      count = 0;
    }
  }
}
