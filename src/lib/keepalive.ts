// Capacitor 原生后台保活桥接。在原生 App 里调用 BGKeepAlivePlugin,
// 在浏览器(开发预览)里静默降级(no-op),不报错。
import { Capacitor } from '@capacitor/core';

interface BGKeepAlive {
  startWarmup(opts: { title?: string; body?: string }): Promise<{ ok: boolean }>;
  stopWarmup(): Promise<{ ok: boolean }>;
  requestIgnoreBattery(): Promise<{ granted: boolean }>;
  isIgnoringBattery(): Promise<{ ignoring: boolean }>;
  setCpuAwake(opts: { on: boolean }): Promise<{ ok: boolean }>;
  setScreenDim(opts: { on: boolean }): Promise<{ ok: boolean }>;
}

let plugin: BGKeepAlive | null = null;
let isNativeReady = false;

function loadPlugin(): BGKeepAlive | null {
  if (isNativeReady) return plugin;
  isNativeReady = true;
  try {
    if (!Capacitor.isNativePlatform()) return null;
    const p = (Capacitor as any).registerPlugin<BGKeepAlive>('BGKeepAlive', {
      // 无 web 实现;在浏览器里直接 no-op
      web: () => ({
        startWarmup: async () => ({ ok: false }),
        stopWarmup: async () => ({ ok: false }),
        requestIgnoreBattery: async () => ({ granted: false }),
        isIgnoringBattery: async () => ({ ignoring: false }),
        setCpuAwake: async () => ({ ok: false }),
        setScreenDim: async () => ({ ok: false }),
      }),
    });
    plugin = p;
    return plugin;
  } catch {
    return null;
  }
}

export function isNative(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/** 启动前台服务(常驻通知)。在浏览器里静默忽略。 */
export async function startKeepAlive(title = 'BRC Wallet 运行中', body = '后台服务已启动(挖矿/保活)'): Promise<boolean> {
  const p = loadPlugin();
  if (!p) return false;
  try { await p.startWarmup({ title, body }); return true; } catch { return false; }
}

/** 停止前台服务。 */
export async function stopKeepAlive(): Promise<boolean> {
  const p = loadPlugin();
  if (!p) return false;
  try { await p.stopWarmup(); return true; } catch { return false; }
}

/** 请求忽略电池优化。返回是否已豁免。 */
export async function requestIgnoreBattery(): Promise<boolean> {
  const p = loadPlugin();
  if (!p) return false;
  try { const r = await p.requestIgnoreBattery(); return r.granted; } catch { return false; }
}

/** 查询是否已受电池优化豁免。 */
export async function isIgnoringBattery(): Promise<boolean> {
  const p = loadPlugin();
  if (!p) return { ignoring: false } as any;
  try { const r = await p.isIgnoringBattery(); return r.ignoring; } catch { return false; }
}

/** CPU 常醒(on=false 关闭),锁屏后挖矿不休眠。 */
export async function setCpuAwake(on: boolean): Promise<boolean> {
  const p = loadPlugin();
  if (!p) return false;
  try { await p.setCpuAwake({ on }); return true; } catch { return false; }
}

/** 屏幕微亮/恢复(on=false 恢复自动熄屏)。 */
export async function setScreenDim(on: boolean): Promise<boolean> {
  const p = loadPlugin();
  if (!p) return false;
  try { await p.setScreenDim({ on }); return true; } catch { return false; }
}
