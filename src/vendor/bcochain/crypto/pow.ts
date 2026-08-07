// Slim PoW for the live wallet/miner.
// The live chain is past the Sandglass fork (height 33,550), so pre-fork Argon2id
// history is finalized in the snapshot and never re-verified here. Only the
// Sandglass v3 path is needed — this drops the argon2id wasm dependency entirely.
import { sandglassHash } from './sandglass.js';
import { SANDGLASS_FORK_HEIGHT } from '../chain/genesis.js';

/**
 * Proof-of-work hash (Sandglass v3 only). For any height >= fork, returns the
 * sandglass digest synchronously. Blocks below the fork are not expected here
 * (they're historical/finalized); we still delegate to sandglass for safety.
 */
export async function powHash(headerBytes: Uint8Array): Promise<Uint8Array> {
  return sandglassHash(headerBytes);
}
