# BRC Wallet — BrowserCoin 轻钱包 (Android)

一个运行在手机的 **BrowserCoin 轻钱包 + 独立矿工**：
- **实时链上状态**：在线矿工数、在线节点 (peer)、区块高度、待打包交易（官方 API 拉取，自动轮询）
- **钱包**：创建/导入 Ed25519 钱包（地址=公钥），私钥本地持久化，可复制备份；显示**真实链上余额与 nonce**
- **发送**：用**链上真实 nonce** 构造 152 字节交易、Ed25519 签名、广播到官方 helper，发送前校验余额
- **挖矿**：内置多核独立矿工（每核一个 Worker，并行磨 Sandglass v3 nonce，不冻结 UI），**自动取钱包页地址**，不需私钥；带**官网风格实时界面**（算力 Hero / nonce 动画 / 预计出块 / 命中率 / 会话统计）
- **后台保活**：忽略电池优化 + 前台服务常驻通知 + **CPU 常醒 + 屏幕微亮**，抗后台被杀
- **区块浏览器**：最近区块列表（高度 / 交易数 / 矿工）

前端是 **Vue 3 + Vite**，通过 **Capacitor 6** 打包成原生 Android APK。

---

## 功能清单（一览）

| 功能 | 说明 |
|---|---|
| 实时链上状态 | 矿工数 / 节点 / 高度 / 待打包交易，自动 5s 轮询 |
| 钱包（真实余额）| Ed25519 地址=公钥，从 `/snapshot` 读真实 balance + nonce，缓存 60s |
| 发送（真实转账）| 用真实 nonce 签名构造交易，`POST /txs`，发送前余额校验 |
| 多核挖矿 | 每核一 Worker 分 nonce 区间并行沙漏；`v-show` 常驻切 tab 不断矿 |
| 官网风格矿界面 | 算力 Hero / nonce ticker 动画 / 预计出块 / 命中率 / 全网算力 / 会话统计 / per-worker 诊断 |
| 后台保活 | 忽略电池优化 + 前台服务 + CPU 常醒(`PARTIAL_WAKE_LOCK`) + 屏幕微亮(`SCREEN_DIM`) |
| 区块浏览器 | 最近区块高度 / 交易数 / 矿工 |
| 挖矿收款 | 自动用钱包地址，不需私钥 |

---

## 适用的人
- 想在手机上**看 BrowserCoin 链上状态、管 BRC 钱包、发交易、体验挖矿**。
- **注意**：这是**轻钱包 + 独立矿工**（通过官方 HTTP API 挖空块），不是全节点，也不含 P2P 直连。

---

## 一键打包 APK（在你有 Android 环境的电脑上做）

> **本仓库代码 + Capacitor 配置已在真实设备验证（App 能跑、能连官方 API、工程结构完整、含原生保活插件）。**
> 我在开发机的 PRoot 沙箱里被**架构问题**卡住（沙箱 ARM64，Google 的 build-tools 只有 x86_64 版），因此在普通 **x86_64 电脑**上按下面步骤即可顺利出 APK。

### 前置（一次性）
1. **Node.js 18+**（建议 20）
2. **JDK 17**（`java -version` 显示 17；Capacitor 6 / AGP 需要，别用太新或太旧）
3. **Android SDK**（Android Studio 装好，含 platform 34 + build-tools）
   - 建好 `local.properties` 或设 `ANDROID_HOME` 环境变量
4. **互联网**（首次构建要下载 Gradle + 依赖）

### 构建
```bash
cd bco-wallet
npm install                     # 装依赖（含 @noble/ed25519、@capacitor/core）

npm run build                   # 构建 web 前端 → dist/
npx cap sync android            # 把 web 资源同步进 android 原生工程

cd android
./gradlew assembleDebug         # 生成 debug APK（可直接安装）
# release（需配签名密钥）：
#   ./gradlew assembleRelease
```

> **注意**：`npx cap sync android` 只同步 `dist/`（web 资源）。原生 Java 代码（保活插件 `MineService` / `BGKeepAlivePlugin`）已在 `android/` 里，**不要删除** `android/app/src/main/java/org/browsercoin/wallet/` 下的文件。改完 web 后如果重新 `cap add android` 会清掉原生改动，务必只在现有 android/ 上 `cap sync`（不会覆盖 java 目录）。

**产物位置**：`android/app/build/outputs/apk/debug/app-debug.apk`
安装到手机：`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`

### 常用命令
| 命令 | 作用 |
|---|---|
| `npm run dev` | 浏览器里开发预览（Vite dev server） |
| `npm run build` | 构建生产 web 前端 |
| `npx cap open android` | 在 Android Studio 打开并构建 |
| `./gradlew assembleDebug` | 命令行出 debug APK |

---

## 挖矿功能说明
- 挖矿页在 App 底部第 5 个 tab（⛏）。
- **多核并发**：每个 CPU 核一个 Web Worker，分配互不重叠的 nonce 区间并行磨 Sandglass；界面显示**总算力**（多核求和）。
- **地址自动取钱包**：不需要手动填地址，直接用钱包 tab 的公钥作为收款地址；**全程不需要私钥**（挖矿只认公钥）。
- **切换 tab 不断矿**：挖矿用 `v-show` 常驻，切到别的 tab 挖矿继续，不重置。
- **官网风格实时界面**（开始挖矿后显示）：
  - 大号算力 Hero（H/s）+ 核数 + "mining block #N"
  - nonce ticker 动画（`nonce 0x… hash 0x…` 跳动）
  - 实时统计：**预计出块 / 当前命中率 / 全网算力 / 已试 nonce / 难度 / 本会话出块**
  - 会话收益（`X BRC 本会话挖得`）
  - **MINING DIAGNOSTICS**（展开后显示 per-worker 算力）
  - 全网算力从难度估算 `2^256/target ÷ 150s`；命中率用 `1-e^(-hashes/expected)`
- **诚实提醒**：全网约 43 万 H/s，你的几核算力占比极低 → **真实主网基本挖不到块**；多核全开会发热耗电。适合学习/体验，不建议长期后台挖。

## 后台保活说明
挖矿页有 **🔋 忽略电池优化** 按钮（进系统白名单）；开始挖矿时自动启动：
- **前台服务**（常驻通知 "BRC Wallet 挖矿中…"），停止时关闭
- **CPU 常醒**（`PARTIAL_WAKE_LOCK`）：锁屏/灭屏后挖矿逻辑不休眠
- **屏幕微亮**（`SCREEN_DIM_WAKE_LOCK`）：开着屏挖矿时不自动暗/灭，能瞥一眼状态；可在挖矿页切换为"屏幕可熄"（省电，但 CPU 常醒仍在）
- **能**：前台服务 + 电池白名单 + CPU 常醒显著降低后台被杀概率；`START_STICKY` 尽力重启。
- **限制**（安卓平台硬规则）：电池优化仍需用户手动确认弹窗，且部分厂商系统要额外关自启/省电；低内存时系统仍可能杀，无法绝对保证。这让挖矿在后台更持久，但也更耗电发热。

移植来的官方链模块（`src/vendor/bcochain/`），挖矿用到的链逻辑都在这里。

## 关于"挖矿在哪挖"（solo vs 矿池）
- 本 App 是 **独立挖矿（solo）**，不是连任何矿池。
- 流程：拉 `/snapshot` + `/tip` → 构建候选空块（coinbase 给你）→ 用 Sandglass 找 nonce → `POST /block` 直接广播给官方网络，全网共识验证。
- 这跟比特币 solo 挖矿一样：**看运气，撞到块直接 +50 BRC（当前未减半满额）到你的地址，不需要中间人**。
- **诚实期望**：期望出块时间 ≈ `150s × (全网算力 ÷ 你的算力)`。以你 600 H/s、全网 43 万 H/s 计 ≈ **30 小时以上**，且方差极大，可能 1 小时也可能一个月。适合当"彩票/技术体验"，不适合当收益。

## 关于显卡挖矿（作者实测）
- Sandglass 是 **memory-latency-hard** 串行指针追逐 → **显卡没有架构优势**，官方设计目标就是"让 GPU 无优势、浏览器/CPU 公平"。
- 官方作者 `browsercoinSandglassV3` 仓库实测（RTX 5090）：**单卡 2,460 H/s vs 24 核 CPU 2,281 H/s，只高 8%，但功耗 258W**——每焦耳产出 CPU/浏览器反而更优。
- **结论**：想靠显卡多算力不划算；已有显卡可当技术探索（官方仓库有 `native/sandglass_hip.cpp` AMD 适配 + `bench_gpu.py`）。

---

## 目录结构
```
bco-wallet/
├── src/lib/brc.ts        BRC 协议核心：地址/交易/compact难度/官方 API
├── src/lib/wallet.ts     Ed25519 钱包（keygen/签名/本地持久化）
├── src/lib/format.ts     金额格式化 (wei↔BRC)、地址缩写
├── src/lib/miner.ts      挖矿核心：snapshot同步、建空块、stateRoot、广播、全网算力/命中率估算
├── src/lib/keepalive.ts  Capacitor 原生保活桥接（前台服务/电池/CPU常醒/屏幕微亮，native降级 no-op）
├── src/miner.worker.ts   挖矿 Worker（多核，每核一段 nonce，不冻结 UI）
├── src/vendor/bcochain/  官方链模块（crypto/chain/util，精简去 argon2id）
├── src/composables/useNetwork.ts  实时状态轮询 + 钱包状态
├── src/App.vue           主界面（状态/钱包/发送/挖矿/浏览器 5 tab）
├── src/Miner.vue         挖矿页（多核 + 官网风格实时界面 + 保活按钮）
├── src/style.css         深色主题样式
├── src/main.ts           入口（含 Vue 错误边界，出错会显示而非白屏）
├── capacitor.config.ts   Capacitor 配置
├── vite.config.ts        Vite 配置
└── android/
    ├── app/src/main/AndroidManifest.xml    前台服务/电池/通知权限声明
    ├── app/src/main/java/org/browsercoin/wallet/
    │   ├── MainActivity.java                注册 BGKeepAlivePlugin
    │   ├── MineService.java                 前台保活服务(START_STICKY+常驻通知)
    │   └── BGKeepAlivePlugin.java           Capacitor 插件桥(start/stopWarmup、电池优化)
    └── ...  Capacitor 生成的原生工程
```

> ⚠️ **原生保活文件别删**：`android/app/src/main/java/org/browsercoin/wallet/` 下的 `MineService.java` / `BGKeepAlivePlugin.java` 是保活功能的核心。重新 `cap add android` 会清掉它们；日常迭代只用 `cap sync`。

---

## 已踩的坑 & 对应解法（给接手的人 / 别的 AI agent）

这些是我在这个环境里逐个解决的真实问题，**照着做能少走很多弯路**：

1. **@noble/ed25519 必须用 v2.1.0**，别用 v3.x。
   - v3 API 大改（`randomPrivateKey` → `keygen()`），且 symbol 导出不同，会踩坑。
   - 官方 BrowserCoin 仓库用的就是 `^2.1.0`，`send-tx.mjs` 也是 v2 写法。
   - `package.json` 已锁定 `^2.1.0`。

2. **@noble/hashes 的导入路径必须带 `.js`**：新版 `@noble/hashes` 的 exports 只导出 `./sha2.js` 而非 `./sha256`，写 `@noble/hashes/sha2.js`。

3. **noble ed25519 需要 SHA-512 绑定**：在节点/浏览器里要么用**异步 API**（`getPublicKeyAsync`/`signAsync`），并给 `ed.etc.sha512` 接上 `webcrypto.subtle.digest('SHA-512', ...)`。本工程已处理好，见 `src/lib/wallet.ts`。

4. **Vue 的 `readonly()` 包着 `{ ref }` 会踩雷**：`readonly({ tip: ref(null) })` 之后 `network.tip.value = x` 会抛 "Cannot set properties of null (setting 'value')"，导致白屏。
   - **解法**：不用 `readonly` 包 ref，直接导出顶层 `ref`。已在 `useNetwork.ts` 修好。

5. **Vue App 一定要加错误边界**：`app.config.errorHandler` + `window.onerror` + `unhandledrejection`，否则组件/异步出错就是一片白屏，极难排查。已在 `src/main.ts` 实现。

6. **Capacitor 8 要求 Java 21 + compileSdk 36**，本工程为了兼容更广（JDK17）用了 **Capacitor 6**（Java 17 + compileSdk 34）。如果你有新环境想升级 Capacitor，注意这是配套关系。

7. **Capacitor 用 `.ts` 配置文件时，TypeScript 必须装 5.x**：TS 7 移除了 Capacitor 需要的 compiler API，会报 "Your installed version of TypeScript no longer provides the compiler API"。本工程已 lock TS 5.7。

8. **Vue 多根节点 + 某些组件会触发 `insertBefore` 白屏错误**（runtime-15）：挖矿页曾因此整页白屏。解法：① 组件根包成**单根节点**（如 `<div class="miner-page">`）；② 避免在模板里用 `<input type="range" v-model>` 配合复杂条件分支（换成点击切换/按钮）。

9. **挖矿页切 tab 会重置/停止**：因为 tab 用 `v-if` 会卸载组件，`onUnmounted` 里 `stopWorkers()` 被执行。**解法**：挖矿 section 改用 `v-show`（常驻不卸载），切走挖矿继续。见 `src/App.vue`。

10. **多核算力显示要"求和"而非"取最大"**：别写 `hashrate = Math.max(prev, workerHps)`（那只会显示单核）。应主线程累加各 worker 上报 hash 数、按时间窗求总算力。已在 `src/Miner.vue` 修好。

11. **Capacitor 6 本地插件要双保险注册**：既要有 `@CapacitorPlugin` 注解，还要在 `MainActivity` 里 `registerPlugin(BGKeepAlivePlugin.class)`，否则插件可能不被发现（尤其 debug 构建）。

12. **官方 `/snapshot` 接口偏慢（~20s）**：是官方限流/重建缓存所致，非本项目问题。余额查询用**异步加载 + 60s 缓存**，避免卡 UI。见 `useNetwork.ts` 的 `refreshBalance`。

13. **挖矿算力统计**：别用 `Math.max` 取单核最大值（会少算）；应主线程**累加各 worker 上报 hash 数**、或按 worker 存 `hps` 求和。命中率用 `1-e^(-已试哈希/每块期望)`，全网算力用 `2^256/target ÷ 150s` 估算，均与官网一致。

14. **`/snapshot` 是 finalize 后状态（约落后 tip 30 分钟）**：钱包余额显示的是确认区高度，不是实时 tip——对钱包够用，但刚挖到块的 coinbase 要等确认才显示。要有此预期。

---

## 关于挖矿 / 全节点
本仓库是**轻钱包 + 独立矿工**（通过官方 HTTP API 挖**空块**，coinbase 全归收款地址；不含 P2P 直连全节点）。
- BrowserCoin 的 PoW 已硬分叉为 **Sandglass v3**（memory-latency-hard，串行指针追逐），live 链高度已过 4.3 万。
- live helper：`https://api1.browsercoin.org`、`https://api2.browsercoin.org`（`/tip`、`/stats`、`/blocks`、`/txs`、`/block`、`/snapshot` 等，CORS `*`）。
- 官方文档 `docs/developers.md` 里的 PoW 参数**已过时**（还是 Argon2id/v2），真正实行的是 `src/crypto/pow.ts` + `src/crypto/sandglass.ts`（盐 `browsercoin-pow-v5`）。

---

MIT，独立开发，与 BrowserCoin 官方无隶属关系。
