# ⛏️ XMR Idle Miner — Chrome Extension

Mine Monero (XMR) automatically when your PC is idle. Mining stops **immediately** when you touch the mouse or keyboard.

## Features

- **Auto idle detection** — uses Chrome's `idle` API to detect inactivity
- **Instant stop** — mining halts the moment you move your mouse or press a key
- **Full CPU utilization** — configurable thread count (Web Workers) for mining when idle
- **Wallet management** — add your XMR wallet address in settings
- **Pool connection** — connects to mining pools via WebSocket (Stratum protocol)
- **Live stats** — hashrate, accepted/rejected shares, uptime in the popup dashboard
- **Works on Mac & Windows** — runs on any OS with Chrome

## How to Install (Sideload)

> ⚠️ Chrome Web Store **prohibits** mining extensions. You must sideload it.

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the `xmr-idle-miner` folder
5. The extension icon (⛏️) appears in your toolbar

## Setup

1. Click the extension icon → **Settings** (⚙️)
2. Enter your **XMR wallet address** (starts with `4`, ~95 characters)
3. Enter your **Pool WebSocket URL** (see Pool Setup below)
4. Set **pool password** (usually `x`)
5. Adjust **threads** (higher = more CPU when idle)
6. Set **idle timeout** (seconds of inactivity before mining starts)
7. Click **Save**
8. Toggle **Mining → ON** in the popup

## Pool Setup

This extension connects to mining pools via **WebSocket** (browsers can't do raw TCP). You have two options:

### Option A: Use a WebSocket-compatible pool

Some pools support WebSocket connections directly. Check if your preferred pool offers a `wss://` endpoint.

### Option B: Run a WebSocket-to-Stratum proxy

Run a small proxy on your machine that translates WebSocket → Stratum TCP:

```bash
# Install the proxy
npm install -g xmr-proxy

# Run it (connects to your pool)
xmr-proxy --pool pool.supportxmr.com:3333 --port 8443
```

Then set the pool URL in the extension to: `ws://localhost:8443`

### Popular XMR Mining Pools

| Pool | Stratum Address |
|------|----------------|
| SupportXMR | `pool.supportxmr.com:3333` |
| MoneroOcean | `gulf.moneroocean.stream:10128` |
| Nanopool | `xmr-eu1.nanopool.org:14433` |
| 2Miners | `xmr.2miners.com:2222` |

## How It Works

```
┌─────────────────────────────────────────────────┐
│  Chrome Extension                               │
│                                                 │
│  ┌──────────────┐     ┌──────────────────┐     │
│  │  Background   │────▶│  Offscreen Doc    │     │
│  │  Service      │     │                  │     │
│  │  Worker       │     │  ┌────────────┐  │     │
│  │              │     │  │  Worker 1   │  │     │
│  │  • Idle API   │     │  │  Worker 2   │──┼──▶ Pool (WSS)
│  │  • Start/Stop │     │  │  Worker 3   │  │     │
│  │  • Stats      │     │  │  Worker N   │  │     │
│  └──────┬───────┘     │  └────────────┘  │     │
│         │              └──────────────────┘     │
│  ┌──────▼───────┐                               │
│  │  Popup UI    │                               │
│  │  • Hashrate  │                               │
│  │  • Shares    │                               │
│  │  • Toggle    │                               │
│  └──────────────┘                               │
└─────────────────────────────────────────────────┘
```

1. **Background service worker** monitors idle state via `chrome.idle` API
2. When PC goes **idle** → creates an offscreen document → spawns Web Workers
3. Workers connect to pool via WebSocket, receive jobs, compute CryptoNight hashes
4. Valid shares (hash < target) are submitted to the pool
5. When you **touch mouse/keyboard** → workers are instantly terminated, mining stops

## File Structure

```
xmr-idle-miner/
├── manifest.json          # Extension manifest (MV3)
├── background.js          # Service worker (idle detection, orchestration)
├── offscreen.html/js      # Hidden document for Web Workers
├── popup/
│   ├── popup.html         # Dashboard UI
│   ├── popup.css          # Dark theme styles
│   └── popup.js           # UI logic
├── options/
│   ├── options.html       # Settings page
│   └── options.js         # Settings logic
├── miner/
│   ├── worker.js          # Mining Web Worker
│   └── cryptonight.js     # CryptoNight-Lite hash (JavaScript)
├── icons/                 # Extension icons
└── README.md
```

## Performance Notes

| Method | Hashrate | Notes |
|--------|----------|-------|
| **This extension (JS)** | ~5-20 H/s | JavaScript-based, runs in browser |
| **WASM module** | ~50-200 H/s | Replace `cryptonight.js` with WASM build |
| **XMRig (native)** | ~1,000-5,000+ H/s | Dedicated native miner |

Browser-based mining is **significantly slower** than native mining. The main value of this extension is **convenience** — it automatically mines when your PC is idle without any setup beyond the extension.

### Upgrading to WASM

For better hashrate, you can replace the JavaScript CryptoNight implementation with a WebAssembly module:

1. Build a CryptoNight WASM module from C source
2. Replace `miner/cryptonight.js` with the WASM loader
3. Export the same `self.cryptonight = function(input)` interface

## Transferring Mined XMR

Mined XMR is deposited to your wallet via the mining pool:

1. **Pool accumulates** your shares and credits XMR to your pool balance
2. **Pool pays out** when your balance reaches the minimum threshold (varies by pool)
3. **XMR appears** in your wallet automatically
4. You can then **transfer** from your wallet to any exchange or other wallet

### Recommended XMR Wallets

- **Monero GUI Wallet** — Official desktop wallet
- **Cake Wallet** — Mobile wallet (iOS/Android)
- **Feather Wallet** — Lightweight desktop wallet

## Disclaimer

- This extension is for **personal use only** on your own hardware
- Mining profitability depends on your CPU, electricity cost, and XMR price
- Browser mining is inherently less efficient than native mining
- This extension cannot be published on the Chrome Web Store (policy violation)
- Use at your own discretion
