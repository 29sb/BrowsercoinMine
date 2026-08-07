// Smoke test: validate the full BRC wallet protocol against the live chain.
import { getTip, getStats, getBlocks, fromHex, decodeTxHex, buildTransaction, txPreimage } from '../src/lib/brc.js';
import { createWallet, signPreimage } from '../src/lib/wallet.js';
import { weiToBr } from '../src/lib/format.js';

const tip = await getTip();
console.log('tip height:', tip.height, 'hash:', tip.tipHash.slice(0, 16));
const stats = await getStats();
console.log('peers:', stats.peers, '| active miners:', stats.miners);

const blocks = await getBlocks(tip.height - 3, tip.height);
console.log('\nfetched blocks:', blocks.length);

if (blocks.length) {
  const last = blocks[0];
  const raw = fromHex(last); // 148-byte header + 4-byte txcount + body
  const hdr = raw.subarray(0, 148);
  const dv = new DataView(hdr.buffer, hdr.byteOffset, 148);
  const height = dv.getUint32(0, false);
  const diffBits = dv.getUint32(108, false);
  const txCount = new DataView(raw.buffer, raw.byteOffset + 148, 4).getUint32(0, false);
  console.log('  block bytes    :', raw.length);
  console.log('  height         :', height, '(matches tip:', height === tip.height, ')');
  console.log('  difficulty bits: 0x' + diffBits.toString(16));
  console.log('  tx count       :', txCount);
  console.log('  miner[116:148] :', toHex1(hdr.subarray(116, 148)));
}

// keygen + sign + build tx (do NOT submit — zero balance)
const w = await createWallet();
console.log('\ncreated wallet addr:', w.address.slice(0, 16) + '…');
const to = new Uint8Array(32); // some recipient (random)
const unsigned = {
  from: w.pub, to, amount: 100n, fee: 200n, nonce: 0,
};
const preimage = txPreimage(unsigned);
const sig = await signPreimage(preimage, w.priv);
const tx = buildTransaction(unsigned, sig);
console.log('signed tx bytes  :', tx.length, '(expect 152)');
console.log('tx hex head      :', toHex1(tx.subarray(0, 8)) + '…');
console.log('amount formatted :', weiToBr(100n), 'BRC');

function toHex1(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
