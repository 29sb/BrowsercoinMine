// Composable: live network stats polling + wallet state management.
import { ref, watch } from 'vue';
import type { Wallet } from '../lib/wallet';
import { restoreWallet, createWallet, saveWallet as persist, clearWallet } from '../lib/wallet';
import { getTip, getStats, getPeers, getMempoolCount, type TipInfo, type StatsInfo } from '../lib/brc';

// State exposed as plain refs (no readonly wrapper — readonly+ref was breaking
// `.value` assignment). Components use them directly in templates; reactivity
// still works.
export const tip = ref<TipInfo | null>(null);
export const stats = ref<StatsInfo | null>(null);
export const peers = ref<number | null>(null);
export const mempool = ref<number | null>(null);
export const syncing = ref(true);
export const lastUpdate = ref<number | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;

export async function refreshNetwork(): Promise<void> {
  try {
    const results = await Promise.allSettled([
      getTip(), getStats(), getPeers(), getMempoolCount(),
    ]);
    if (results[0].status === 'fulfilled') tip.value = results[0].value;
    if (results[1].status === 'fulfilled') stats.value = results[1].value;
    if (results[2].status === 'fulfilled') peers.value = results[2].value;
    if (results[3].status === 'fulfilled') mempool.value = results[3].value;
    syncing.value = false;
    lastUpdate.value = Date.now();
  } catch {
    syncing.value = true;
  }
}

export function startPolling(ms = 5000): void {
  stopPolling();
  refreshNetwork();
  pollTimer = setInterval(refreshNetwork, ms);
}

export function stopPolling(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ---- wallet ----
export const wallet = ref<Wallet | null>(null);
export const privHex = ref('');

export async function initWallet(): Promise<void> {
  wallet.value = await restoreWallet();
  if (wallet.value) privHex.value = hexOf(wallet.value.priv);
}

export async function doCreateWallet(): Promise<Wallet> {
  const w = await createWallet();
  await persistWallet(w);
  return w;
}

export async function importWallet(privHexStr: string): Promise<Wallet> {
  const { walletFromHex } = await import('../lib/wallet');
  const w = await walletFromHex(privHexStr.trim());
  await persistWallet(w);
  return w;
}

async function persistWallet(w: Wallet): Promise<void> {
  persist(w);
  wallet.value = w;
  privHex.value = hexOf(w.priv);
}

export function wipeWallet(): void {
  clearWallet();
  wallet.value = null;
  privHex.value = '';
}

function hexOf(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

watch(wallet, (w) => {
  if (w) startPolling(); else stopPolling();
});
