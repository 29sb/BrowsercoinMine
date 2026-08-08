<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { wallet } from './composables/useNetwork';
import { initSession, buildCandidate, submitBlock, compactToTarget, encodeHeader as encHeader, expectedHashesForDifficulty, estimateNetHashrate, type MinerSession } from './lib/miner';
import { startKeepAlive, stopKeepAlive, requestIgnoreBattery, isIgnoringBattery, isNative, setCpuAwake, setScreenDim } from './lib/keepalive';
import { weiToBr } from './lib/format';

// ---- 状态 ----
const running = ref(false);
const status = ref('idle');
const hashrate = ref(0);
const attempts = ref(0);
const currHeight = ref<number | null>(null);
const currDifficulty = ref<number | null>(null);
const mined = ref<{ h: number; nonce: number } | null>(null);
const log = ref<string[]>([]);
const error = ref('');
const useMaxThreads = ref(true);
const minerHex = ref(wallet.value?.address ?? '');
const batteryIgnored = ref(false);
const nativeReady = ref(isNative());
const screenDim = ref(true); // 挖矿时屏幕微亮默认开

// ---- 实时统计(官网风格) ----
const netHashrate = ref(0);        // 全网算力估计(H/s)
const expectedPerBlock = ref(0n);  // 每块期望哈希数
const templateHashes = ref(0);     // 当前模板已试哈希(算 P(found))
const pFoundRate = ref(0);         // P(found by now) 0~100
const etaSec = ref(0);             // 预计出块时间(秒)
const sessionBlocks = ref(0);      // 本会话挖到块数
const sessionRewards = ref(0n);    // 本会话收益(wei)
const workerHps = ref<number[]>([]); // 各 worker 算力
let workerHpsArr: number[] = [];

// ---- 内部 ----
let keepRunning = false;
let session: MinerSession | null = null;
let workerPool: Worker[] = [];
let currentTemplate: { header: Uint8Array; targetHex: string; height: number } | null = null;
let currentBlock: Awaited<ReturnType<typeof buildCandidate>> | null = null;
let activeWorkers = 0;
let tipTimer: ReturnType<typeof setInterval> | null = null;

const cpuCores = () => navigator.hardwareConcurrency || 1;
const threadCount = ref(cpuCores());
function fmtEta(sec: number): string {
  if (!sec || sec <= 0) return '—';
  if (sec < 90) return `${sec}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(0)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}
function fmtNetHr(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function pushLog(msg: string) {
  log.value.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  if (log.value.length > 40) log.value.shift();
}

function ensureAddress(): string {
  const w = wallet.value;
  if (!w || !/^[0-9a-fA-F]{64}$/.test(w.address)) {
    error.value = '请先在「钱包」页创建/导入钱包,挖矿会使用钱包地址';
    return '';
  }
  minerHex.value = w.address;
  return w.address;
}
function addrToBytes(hex: string): Uint8Array {
  const u = new Uint8Array(32);
  for (let i = 0; i < 32; i++) u[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return u;
}

// ---- worker 池 ----
function buildTemplate() {
  if (!session || !keepRunning) return;
  const miner = addrToBytes(minerHex.value);
  const cand = buildCandidate(session, miner, Math.floor(Date.now() / 1000));
  currentBlock = cand;
  currHeight.value = cand.header.height;
  currDifficulty.value = cand.header.difficulty;
  const target = compactToTarget(cand.header.difficulty);
  currentTemplate = { header: encHeader(cand.header), targetHex: target.toString(16), height: cand.header.height };
  expectedPerBlock.value = expectedHashesForDifficulty(cand.header.difficulty);
  netHashrate.value = estimateNetHashrate(cand.header.difficulty);
  templateHashes.value = 0;
  pFoundRate.value = 0;
  pushLog(`▷ 模板 #${cand.header.height} 难度0x${cand.header.difficulty.toString(16)}`);
}

function stopWorkers() {
  for (const w of workerPool) w?.terminate();
  workerPool = [];
  activeWorkers = 0;
  hashrate.value = 0;
  totalHash = 0;
  hashWinT0 = Date.now();
  workerHpsArr = [];
  workerHps.value = [];
  templateHashes.value = 0;
  pFoundRate.value = 0;
  etaSec.value = 0;
}

// 算力统计(多核求和): 主线程累加各 worker 上报的 hash 数,按时间窗算总算力
let totalHash = 0;
let hashWinT0 = Date.now();
let lastUiTs = 0;
let statsInterval: ReturnType<typeof setInterval> | null = null;

function clearStats() {
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = null;
}

function startWorkers() {
  if (!currentTemplate || !keepRunning) return;
  const n = useMaxThreads.value ? cpuCores() : Math.max(1, threadCount.value);
  threadCount.value = n;
  totalHash = 0;
  hashWinT0 = Date.now();
  workerHpsArr = new Array(n).fill(0);
  workerHps.value = [...workerHpsArr];
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./miner.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        attempts.value += m.count;
        templateHashes.value += m.count;
        // 把 worker hps 存到非响应式数组,避免每个 worker 每秒触发 Vue 重渲染
        workerHpsArr[i] = m.hps;
        // 用常量节流更新显示(约每 1s 刷新一次即可,不必每次 progress)
        if (Date.now() - lastUiTs > 900) {
          lastUiTs = Date.now();
          hashrate.value = workerHpsArr.reduce((a, b) => a + b, 0);
          workerHps.value = [...workerHpsArr];
        }
      } else if (m.type === 'found') {
        const h = currentBlock!.header.height;
        mined.value = { h, nonce: m.nonce };
        sessionBlocks.value += 1;
        // 当前奖励约 50 BRC(减半前);更精确从 miner.ts blockReward 拿但简化
        sessionRewards.value += 5_000_000_000n; // 50 BRC
        pushLog(`🎉 命中 nonce=${m.nonce}! 提交…`);
        stopWorkers();
        currentBlock!.header.nonce = m.nonce;
        submitBlock(currentBlock!)
          .then(async (r) => {
            pushLog(`广播: ${r}`);
            session!.tipHeight = h;
            session = await initSession();
            if (keepRunning) { buildTemplate(); startWorkers(); }
          })
          .catch((e) => pushLog(`广播失败: ${e.message}`));
      } else if (m.type === 'error') {
        pushLog(`worker 错误: ${m.message}`);
      }
    };
    w.onerror = () => { pushLog('worker error'); };
    const slice = Math.floor(0x1_0000_0000 / n);
    // 每个 worker 分一段连续 nonce(与官方一致,避免 stride 跳跃)
    w.postMessage({
      type: 'start',
      headerBytes: currentTemplate.header,
      targetHex: currentTemplate.targetHex,
      startNonce: (i * slice) >>> 0,
    });
    workerPool.push(w);
    activeWorkers++;
  }
  hashrate.value = 0;
};

function startMining() {
  error.value = '';
  const addrHex = ensureAddress();
  if (!addrHex) return;
  keepRunning = true;
  running.value = true;
  status.value = '初始化: 同步链状态…';
  attempts.value = 0;
  hashrate.value = 0;
  mined.value = null;
  sessionBlocks.value = 0;
  sessionRewards.value = 0n;
  // 每 2s 计算一次命中率/ETA(独立于 worker 上报,避免热路径)
  if (statsInterval) clearInterval(statsInterval);
  statsInterval = setInterval(() => {
    if (!running.value) return;
    if (expectedPerBlock.value > 0n && templateHashes.value > 0) {
      const p = 1 - Math.exp(-Number(templateHashes.value) / Number(expectedPerBlock.value));
      pFoundRate.value = Math.min(99.9, p * 100);
    }
    if (hashrate.value > 0 && expectedPerBlock.value > 0n) {
      etaSec.value = Math.round(Number(expectedPerBlock.value) / hashrate.value);
    }
  }, 2000);
  pushLog(`开始挖矿 (收款 ${addrHex.slice(0, 10)}…)`);
  // 原生环境: 启动前台服务 + CPU 常醒 + 屏幕微亮
  if (isNative()) {
    startKeepAlive('BRC Wallet 挖矿中', `收款 ${addrHex.slice(0, 10)}… · 保活中`)
      .then((ok) => pushLog(ok ? '⏫ 前台服务+CPU常醒已开启(锁屏不休眠)' : '通知不可用,继续挖矿'));
    setCpuAwake(true);
    if (screenDim.value) setScreenDim(true);
  }
  initSession().then((s) => {
    if (!keepRunning) return;
    session = s;
    pushLog(`链状态就绪 height=${s.tipHeight} 账户=${s.state.accounts.size}`);
    buildTemplate();
    startWorkers();
    status.value = '挖矿中…';
  }).catch((e) => {
    if (!keepRunning) return;
    error.value = '初始化失败: ' + (e.message ?? e);
    status.value = 'error';
  });
  tipTimer = setInterval(async () => {
    if (!session || !keepRunning) return;
    try {
      const r = await fetch('https://api1.browsercoin.org/tip');
      const j = await r.json();
      if (j.height > session!.tipHeight) {
        pushLog(`▲ 新块 #${j.height},重建模板`);
        stopWorkers();
        session = await initSession();
        if (keepRunning) { buildTemplate(); startWorkers(); }
      }
    } catch { /* ignore */ }
  }, 15000);
}

function stopMining() {
  keepRunning = false;
  running.value = false;
  status.value = '已停止';
  if (tipTimer) clearInterval(tipTimer);
  tipTimer = null;
  stopWorkers();
  clearStats();
  if (isNative()) {
    stopKeepAlive();
    setCpuAwake(false);
    setScreenDim(false);
  }
}

// 请求忽略电池优化(原生)
async function onRequestBattery() {
  if (!nativeReady.value) return;
  const granted = await requestIgnoreBattery();
  batteryIgnored.value = await isIgnoringBattery();
  if (batteryIgnored.value) pushLog('🔋 已获得电池优化豁免(后台更不易被杀)');
  else pushLog('🔋 已请求忽略电池优化,请在系统弹窗确认');
}

onMounted(() => {
  if (nativeReady.value) isIgnoringBattery().then((v) => { batteryIgnored.value = v; });
});

onUnmounted(() => {
  keepRunning = false;
  if (tipTimer) clearInterval(tipTimer);
  stopWorkers();
});
</script>

<template>
  <div class="miner-page">
    <div class="card">
      <p class="notice" style="margin-bottom:12px">
        内置独立矿工 —— Web Worker <b>多核并行</b>跑 Sandglass v3,不冻结界面。
        <b>自动使用钱包地址</b>,不需私钥。
      </p>
      <div class="stat" style="margin-bottom:10px">
        <div class="v mono" style="font-size:13px;word-break:break-all">{{ minerHex || '尚未创建钱包' }}</div>
        <div class="k">收款地址(钱包公钥)</div>
      </div>

      <div class="stat" style="margin-bottom:10px" @click="useMaxThreads = !useMaxThreads">
        <div class="v blue" style="font-size:15px">{{ useMaxThreads ? '自动(满核)' : '手动 '+threadCount+' 核' }}</div>
        <div class="k">点击切换 · 用 {{ useMaxThreads ? cpuCores() : threadCount }} 核</div>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" v-if="!running" @click="startMining">⏳ 开始挖矿</button>
        <button class="btn btn-danger" v-else @click="stopMining">⏹ 停止</button>
      </div>

      <div v-if="nativeReady" style="margin-top:6px" @click="onRequestBattery">
        <button class="btn btn-ghost" style="width:100%">
          🔋 {{ batteryIgnored ? '已忽略电池优化 ✓' : '忽略电池优化(后台保活)' }}
        </button>
      </div>

      <div v-if="nativeReady" style="margin-top:6px">
        <button class="btn btn-ghost" style="width:100%" @click="screenDim = !screenDim">
          <template v-if="running">
            <span v-if="screenDim" @click.stop>💡 CPU常醒+屏幕微亮 开启中</span>
            <span v-else @click.stop>⌛ CPU常醒 (屏幕可熄)</span>
          </template>
          <template v-else>💡 挖矿时{{ screenDim ? '屏幕微亮' : '屏幕可熄' }}（点切换）</template>
        </button>
      </div>

      <div v-if="error" class="notice" style="color:var(--red);margin-bottom:8px">{{ error }}</div>

      <div v-if="running" style="margin-top:10px">
        <!-- 大号算力 Hero -->
        <div style="text-align:center;padding:4px 0 2px">
          <div class="v green" style="font-size:44px;font-weight:800;line-height:1">{{ hashrate }}<span style="font-size:16px;margin-left:4px;color:var(--muted)">H/s</span></div>
          <div class="k" style="margin-top:2px">{{ useMaxThreads ? cpuCores() : threadCount }} 核 · mining block #{{ currHeight ?? '…' }}</div>
        </div>

        <!-- 实时统计 -->
        <div class="stat-grid" style="grid-template-columns:1fr 1fr;margin-top:10px">
          <div class="stat"><div class="v">{{ fmtEta(etaSec) }}</div><div class="k">预计出块</div></div>
          <div class="stat"><div class="v gold">{{ pFoundRate.toFixed(2) }}%</div><div class="k">当前命中率</div></div>
          <div class="stat"><div class="v blue">{{ fmtNetHr(netHashrate) }}</div><div class="k">全网算力 H/s</div></div>
          <div class="stat"><div class="v">{{ attempts.toLocaleString() }}</div><div class="k">已试 nonce</div></div>
          <div class="stat"><div class="v mono" style="font-size:12px">{{ currDifficulty != null ? '0x'+currDifficulty.toString(16) : '—' }}</div><div class="k">难度</div></div>
          <div class="stat"><div class="v green">{{ sessionBlocks }}</div><div class="k">本会话出块</div></div>
        </div>

        <!-- 会话收益 + 诊断 -->
        <div class="stat" style="margin-top:8px">
          <div class="v">{{ weiToBr(sessionRewards) }} <span class="k" style="font-size:11px">BRC 本会话挖得</span></div>
          <div class="k">每块满额 50 BRC · halves every 210000 blocks</div>
        </div>
        <details style="margin-top:8px">
          <summary class="k" style="cursor:pointer">MINING DIAGNOSTICS (展开 per-worker 算力)</summary>
          <div v-if="workerHps.length" style="margin-top:6px">
            <div v-for="(w, i) in workerHps" :key="i" class="k mono">
              核#{{ i }}: {{ w }} H/s
            </div>
          </div>
        </details>
        <p class="notice" style="margin-top:10px">{{ status }}</p>
      </div>

      <div v-if="mined" style="margin-top:12px;padding:10px;background:var(--card2);border:1px solid var(--green);border-radius:10px">
        🎉 命中块 #{{ mined.h }} (nonce {{ mined.nonce }})! 广播中…
      </div>
    </div>

    <div class="card">
      <h3>挖矿日志</h3>
      <div v-if="!log.length" class="notice">尚未开始。</div>
      <div class="notice mono" style="white-space:pre-wrap;font-size:11px">
        <div v-for="(l, i) in log" :key="i">{{ l }}</div>
      </div>
    </div>

    <div class="card">
      <h3>真实说明</h3>
      <p class="notice">
        · 多核 = 每核独立挖一段 nonce → 单核串行,多核并行不重叠,总算力 ≈ 核数 × 单核。<br>
        · 全网约 43 万 H/s → 几核算力<b>基本挖不到块</b>;发热耗电,不建议长期后台挖。
      </p>
    </div>
  </div>
</template>
