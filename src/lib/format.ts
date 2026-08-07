import { COIN } from './brc';

export function weiToBr(f: bigint | number): string {
  const n = typeof f === 'bigint' ? f : BigInt(Math.round(f));
  const neg = n < 0n;
  const a = neg ? -n : n;
  const whole = a / COIN;
  const frac = a % COIN;
  const fracStr = frac.toString().padStart(8, '0').replace(/0+$/, '');
  let out = fracStr ? `${whole}.${fracStr}` : `${whole}`;
  return (neg ? '-' : '') + out;
}

export function brToWei(s: string): bigint {
  const trimmed = s.trim();
  const neg = trimmed.startsWith('-');
  const t = trimmed.replace(/^-/, '');
  const parts = t.split('.');
  const whole = parts[0] || '0';
  const frac = (parts[1] || '').padEnd(8, '0').slice(0, 8);
  const v = BigInt(whole) * COIN + (frac ? BigInt(frac) : 0n);
  return neg ? -v : v;
}

export function compactAddr(a: string, n = 10): string {
  if (!a) return '';
  return a.length <= n * 2 ? a : `${a.slice(0, n)}…${a.slice(-4)}`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
