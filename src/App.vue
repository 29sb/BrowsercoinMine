<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import {
  tip as chainTip, stats as chainStats, wallet, privHex, syncing as chainSyncing,
  mempool as chainMempool, lastUpdate,
  initWallet, doCreateWallet, importWallet, wipeWallet, startPolling, refreshNetwork,
  onChainBalance, onChainNonce, balanceLoading, balanceHeight, refreshBalance,
} from './composables/useNetwork';
import { weiToBr, brToWei, compactAddr, formatCount } from './lib/format';
import { buildTransaction, txPreimage, submitTxs, getBlocks, fromHex, CHAIN_ID, MIN_FEE_PER_BYTE } from './lib/brc';
import MinerView from './Miner.vue';
import { signPreimage } from './lib/wallet';

type Tab = 'dashboard' | 'wallet' | 'send' | 'explorer' | 'mine';
const tab = ref<Tab>('dashboard');

const copied = ref(false);
const copiedWhat = ref('');

async function onCopy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true; copiedWhat.value = what;
    setTimeout(() => { copied.value = false; }, 1400);
  } catch { /* ignore */ }
}

// ---- send form ----
const sendTo = ref('');
const sendAmount = ref('');
const sendFee = ref('5');           // wei-per-byte fee; default low
const sendStatus = ref('');
const sendOk = ref(false);
async function doSend() {
  sendStatus.value = ''; sendOk.value = false;
  const w = wallet.value;
  if (!w) { sendStatus.value = '请先创建钱包'; return; }
  const to = sendTo.value.trim();
  let amount: bigint, fee: bigint;
  try {
    amount = brToWei(sendAmount.value.trim());
    if (amount <= 0n) throw new Error();
    fee = BigInt(sendFee.value.trim()) * BigInt(TX_BODY_BYTES + 4);
  } catch { sendStatus.value = '金额格式不正确'; return; }
  if (!/^[0-9a-fA-F]{64}$/.test(to) || to.toLowerCase() === w.address.toLowerCase()) {
    sendStatus.value = '收款地址需为 64 位十六进制，且不能是本人地址';
    return;
  }
  sendStatus.value = '签名并广播中…';
  try {
    if (amount + fee > onChainBalance.value) {
      sendStatus.value = `余额不足：可用 ${weiToBr(onChainBalance.value)} BRC，需 ${weiToBr(amount + fee)} BRC+手续费`;
      return;
    }
    // 用链上真实 nonce
    const unsigned = { from: w.pub, to: fromHex(to), amount, fee: fee as bigint, nonce: onChainNonce.value };
    const preimage = txPreimage(unsigned);
    const sig = await signPreimage(preimage, w.priv);
    const tx = buildTransaction(unsigned, sig);
    const hex = Array.from(tx).map((b) => b.toString(16).padStart(2, '0')).join('');
    const res = await submitTxs([hex]);
    if (res.admitted > 0) {
      sendOk.value = true;
      sendStatus.value = `已进入交易池 ✓（nonce=${onChainNonce.value}，矿工会打包）`;
    } else {
      sendStatus.value = '被拒绝：' + (res.errors?.[0] ?? 'unknown');
    }
  } catch (e: any) {
    sendStatus.value = '失败：' + (e?.message ?? String(e));
  }
}
const TX_BODY_BYTES = 152;

// ---- recent blocks (explorer) ----
const recentBlocks = ref<{ height: number; txs: number; miner: string }[]>([]);
async function loadRecent() {
  try {
    const t = chainTip?.height ?? 0;
    if (!t) return;
    const n = Math.max(t - 6, 1);
    const blocks = await getBlocks(n, t);
    recentBlocks.value = blocks.map((b) => {
      const raw = fromHex(b);
      const hdr = raw.subarray(0, 148);
      const dv = new DataView(hdr.buffer, hdr.byteOffset, 148);
      const height = dv.getUint32(0, false);
      const txCount = new DataView(raw.buffer, raw.byteOffset + 148, 4).getUint32(0, false);
      const miner = Array.from(hdr.subarray(116, 148)).map((x) => x.toString(16).padStart(2, '0')).join('');
      return { height, txs: txCount, miner: compactAddr(miner, 6) };
    }).reverse();
  } catch { recentBlocks.value = []; }
}

// ---- sparkline (miners over time sample) ----
const sparkData = ref<number[]>([]);
async function refreshSparkData() {
  const s = chainStats;
  if (!s) return;
  sparkData.value.push(s.miners);
  if (sparkData.value.length > 14) sparkData.value.shift();
}

onMounted(async () => {
  await initWallet();
  startPolling(5000);
  await refreshSparkData();
  const t1 = setInterval(refreshSparkData, 20000); // sample miners every 20s
  const t2 = setInterval(async () => {
    if (tab.value === 'explorer') await loadRecent();
  }, 15000);
  // store timers on window for cleanup
  (window as any).__t1 = t1; (window as any).__t2 = t2;
});
onUnmounted(() => {
  stopPolling();
  clearInterval((window as any).__t1);
  clearInterval((window as any).__t2);
});

// miner sparkline max for scaling
const sparkMax = () => Math.max(1, ...sparkData.value);
</script>

<template>
  <!-- Top bar -->
  <header class="topbar">
    <div class="brand">
      <div class="brand-logo">B</div>
      <div>
        <div class="brand-name">BRC Wallet</div>
        <div class="brand-sub">
          <span class="live-dot" :class="{ off: chainSyncing }"></span>
          BrowserCoin · {{ chainTip ? '#' + formatCount(chainTip.height) : '连接中…' }}
        </div>
      </div>
    </div>
    <button class="btn btn-ghost" style="width:auto;padding:8px 12px;font-size:12px" @click="refreshNetwork">刷新</button>
  </header>

  <!-- ===================== DASHBOARD ===================== -->
  <section v-if="tab === 'dashboard'">
    <div class="hero">
      <div class="balance-label">总余额</div>
      <div class="balance">
        <span v-if="wallet">{{ balanceLoading && onChainBalance === 0n ? '…' : weiToBr(onChainBalance) }}<span class="unit">BRC</span></span>
        <span v-else>——</span>
      </div>
      <div v-if="wallet" class="addr" @click="onCopy(wallet.address, '地址已复制')">
        {{ wallet.address }}
      </div>
      <div v-if="wallet" style="font-size:11px;color:var(--muted);margin-top:4px">
        nonce {{ onChainNonce }} · {{ balanceLoading ? '读取链上余额…' : balanceHeight ? `快照 @H${balanceHeight}` : '' }}
      </div>
      <div :class="['copy-hint', { show: copied }]">{{ copiedWhat }}</div>
      <p v-if="!wallet" class="notice" style="margin-top:12px">尚未创建钱包。<br>去「钱包」页生成你的 BrowserCoin 地址。</p>
    </div>

    <div class="card">
      <h3>实时链上状态</h3>
      <div class="stat-grid">
        <div class="stat">
          <div class="v green">{{ chainStats ? formatCount(chainStats.miners) : '—' }}</div>
          <div class="k">在线矿工数</div>
        </div>
        <div class="stat">
          <div class="v blue">{{ chainStats ? formatCount(chainStats.peers) : '—' }}</div>
          <div class="k">在线节点 (peer)</div>
        </div>
        <div class="stat">
          <div class="v">{{ chainTip ? formatCount(chainTip.height) : '—' }}</div>
          <div class="k">区块高度</div>
        </div>
        <div class="stat">
          <div class="v gold">{{ chainMempool ?? '—' }}</div>
          <div class="k">待打包交易</div>
        </div>
      </div>

      <div v-if="sparkData.length > 1" style="margin-top:14px">
        <div class="k" style="margin-bottom:4px">矿工数走势（近 {{ sparkData.length }}×20 秒）</div>
        <div class="spark">
          <div v-for="(v, i) in sparkData" :key="i" class="bar" :style="{ height: (20 + (v / sparkMax()) * 20) + 'px' }"></div>
        </div>
      </div>
      <div class="divider"></div>
      <p class="notice">
        提示：BrowserCoin 账户模型余额需从链上账本计算。当前版本为只读钱包骨架，余额与转账已经接上官方 API。<strong>真实余额</strong>需同步账本（见说明）。
      </p>
    </div>
  </section>

  <!-- ===================== WALLET ===================== -->
  <section v-if="tab === 'wallet'">
    <div class="card">
      <h3>我的钱包</h3>
      <template v-if="wallet">
        <div class="stat" style="margin-bottom:12px">
          <div class="v mono" style="font-size:13px;word-break:break-all">{{ wallet.address }}</div>
          <div class="k">地址（公钥）</div>
        </div>
        <div class="divider"></div>
        <p class="notice" style="margin-bottom:10px"><strong>私钥</strong>只保存在本机，不会上传。请务必备份，丢失无法找回。</p>
        <button class="btn btn-ghost" @click="onCopy(privHex, '私钥已复制，请妥善保管')">复制私钥</button>
        <div class="divider"></div>
        <button class="btn btn-danger" @click="wipeWallet()">清除钱包</button>
      </template>
      <template v-else>
        <p class="notice" style="margin-bottom:14px">
          创建一个 Ed25519 密钥对，你的<b>地址就是公钥</b>（64 位十六进制）。私钥保存在手机本地。
        </p>
        <button class="btn btn-primary" @click="() => doCreateWallet()">创建新钱包</button>
        <div class="divider"></div>
        <label>或导入已有钱包（粘贴 64 位十六进制私钥）</label>
        <input class="input" v-model="privHex" placeholder="6 位以上十六进制私钥" />
        <button class="btn btn-ghost" @click="importWallet(privHex)">导入</button>
      </template>
    </div>
  </section>

  <!-- ===================== SEND ===================== -->
  <section v-if="tab === 'send'">
    <div class="card">
      <h3>发送 BRC</h3>
      <div class="stat" style="margin-bottom:12px">
        <div class="v" style="font-size:18px">{{ weiToBr(onChainBalance) }} <span class="k">BRC 可用</span>
          <span style="font-size:12px;color:var(--muted)">· nonce {{ onChainNonce }}</span>
        </div>
        <div class="k">
          {{ balanceLoading ? '读取链上余额…' : `链上余额（快照 H${balanceHeight ?? '?'}）` }}
          <span @click="refreshBalance(true)" style="cursor:pointer;color:var(--accent2)">[刷新]</span>
        </div>
      </div>
      <label>收款地址（公钥，64 位十六进制）</label>
      <input class="input" v-model="sendTo" placeholder="2ab6d81c…" />
      <label>金额（BRC）</label>
      <input class="input" v-model="sendAmount" placeholder="0.01" />
      <label>手续费（wei / 字节，最低 {{ MIN_FEE_PER_BYTE.toString() }}）</label>
      <input class="input" v-model="sendFee" placeholder="5" />
      <div class="fee-hint">约 {{ sendFee || 0 }} × 152 字节 = {{ (Number(sendFee || 0) * 152).toLocaleString() }} wei</div>
      <button class="btn btn-primary" @click="doSend" :disabled="!wallet">
        {{ wallet ? '签名并广播交易' : '需先创建钱包' }}
      </button>
      <div v-if="sendStatus" class="notice" style="margin-top:12px;text-align:center" :style="{ color: sendOk ? 'var(--green)' : 'var(--red)' }">{{ sendStatus }}</div>
    </div>
    <div class="card">
      <h3>说明</h3>
      <p class="notice">
        · 交易为 152 字节，签名用 Ed25519，广播到官方 helper（api1/api2.browsercoin.org）。<br>
        · 使用<b>链上真实 nonce</b> 构造交易；余额需账户有 BRC 才能被矿工打包。<br>
        · 收到「被拒绝」通常是余额为 0 或 nonce 不符 —— 新地址无余额属正常。
      </p>
    </div>
  </section>

  <!-- ===================== EXPLORER ===================== -->
  <section v-if="tab === 'explorer'">
    <div class="card">
      <h3>最近区块</h3>
      <div v-if="recentBlocks.length === 0" class="notice">加载中…（点「刷新」触发）</div>
      <div v-for="b in recentBlocks" :key="b.height" class="stat" style="margin-bottom:8px">
        <div class="v" style="font-size:15px">
          <span style="color:var(--muted)">#</span>{{ b.height }}
          <span class="tag">{{ b.txs }} tx</span>
        </div>
        <div class="k mono" style="font-size:11px">矿工 {{ b.miner }}</div>
      </div>
    </div>
  </section>

  <!-- ===================== MINE ===================== -->
  <!-- v-show 保持 Miner 组件常驻,切走时不卸载,挖矿 worker 持续运行不被中断 -->
  <section v-show="tab === 'mine'">
    <MinerView />
  </section>

  <!-- Bottom nav -->
  <nav class="navbar">
    <div class="nav-item" :class="{ active: tab === 'dashboard' }" @click="tab = 'dashboard'">
      <span class="ico">📊</span>状态
    </div>
    <div class="nav-item" :class="{ active: tab === 'wallet' }" @click="tab = 'wallet'">
      <span class="ico">👛</span>钱包
    </div>
    <div class="nav-item" :class="{ active: tab === 'send' }" @click="tab = 'send'">
      <span class="ico">📤</span>发送
    </div>
    <div class="nav-item" :class="{ active: tab === 'mine' }" @click="tab = 'mine'">
      <span class="ico">⛏</span>挖矿
    </div>
    <div class="nav-item" :class="{ active: tab === 'explorer' }" @click="tab = 'explorer'; loadRecent()">
      <span class="ico">⛓️</span>浏览器
    </div>
  </nav>
</template>
