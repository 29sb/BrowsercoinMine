// Wallet key management via @noble/ed25519. Address = pubkey (32 bytes, 64 hex).
// We use ONLY the async API, wired to WebCrypto's SHA-512 — works on Android
// WebView and Node without any native binary dependency.
import * as ed from '@noble/ed25519';
import { toHex, fromHex } from './brc';

ed.etc.sha512 = async (msg: Uint8Array): Promise<Uint8Array> => {
  const buf = await crypto.subtle.digest('SHA-512', msg as unknown as ArrayBuffer);
  return new Uint8Array(buf);
};

export interface Wallet {
  priv: Uint8Array;
  pub: Uint8Array;
  address: string;
}

export async function createWallet(): Promise<Wallet> {
  const priv = ed.utils.randomPrivateKey();
  return walletFromPriv(priv);
}

export async function walletFromPriv(priv: Uint8Array): Promise<Wallet> {
  const pub = await ed.getPublicKeyAsync(priv);
  return { priv, pub, address: toHex(pub) };
}

export async function walletFromHex(privHex: string): Promise<Wallet> {
  return walletFromPriv(fromHex(privHex));
}

export async function restoreWallet(): Promise<Wallet | null> {
  try {
    const hex = localStorage.getItem(KEY_PRIVATE);
    if (!hex) return null;
    return walletFromPriv(fromHex(hex));
  } catch { return null; }
}

export function saveWallet(w: Wallet): void {
  localStorage.setItem(KEY_PRIVATE, toHex(w.priv));
}

export function clearWallet(): void {
  localStorage.removeItem(KEY_PRIVATE);
}

/** Sign the 88-byte preimage (Ed25519, pure RFC8032). Returns 64-byte sig. */
export async function signPreimage(preimage: Uint8Array, priv: Uint8Array): Promise<Uint8Array> {
  return ed.signAsync(preimage, priv);
}

const KEY_PRIVATE = 'brc:privkey';
