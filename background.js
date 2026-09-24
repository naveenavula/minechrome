/**
 * XMR Idle Miner - Background Service Worker
 * 
 * Core responsibilities:
 * 1. Monitor PC idle state via chrome.idle API
 * 2. Start mining when idle, stop IMMEDIATELY when active
 * 3. Manage offscreen document for Web Worker mining
 * 4. Track mining statistics
 * 5. Handle messages from popup and offscreen document
 */

// ─── Mining State ───────────────────────────────────────────────────────────

const state = {
  enabled: false,
  mining: false,
  hashrate: 0,
  sharesAccepted: 0,
  sharesRejected: 0,
  startTime: null,
  idleState: 'active',
  totalHashes: 0,
  poolConnected: false
};

// ─── Extension Install / Startup ────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      walletAddress: '',
      poolUrl: 'wss://proxy.example.com:8443',
      poolPassword: 'x',
      threads: 4,
      idleTimeout: 60,
      enabled: false
    });
    console.log('[Miner] Extension installed with default settings');
  }
});

// Restore state on startup
chrome.storage.local.get(['enabled', 'idleTimeout'], (result) => {
  state.enabled = result.enabled || false;
  const timeout = result.idleTimeout || 60;
  chrome.idle.setDetectionInterval(timeout);
  console.log(`[Miner] Restored: enabled=${state.enabled}, idleTimeout=${timeout}s`);
});

// ─── Idle Detection (Core Feature) ─────────────────────────────────────────

chrome.idle.onStateChanged.addListener((newState) => {
  console.log(`[Miner] Idle state changed: ${state.idleState} → ${newState}`);
  state.idleState = newState;

  if (newState === 'idle' || newState === 'locked') {
    // PC is idle → start mining if enabled
    if (state.enabled && !state.mining) {
      startMining();
    }
  } else if (newState === 'active') {
    // PC is active → STOP mining immediately
    if (state.mining) {
      console.log('[Miner] User active — stopping mining immediately');
      stopMining();
    }
  }

  broadcastStatus();
});

// ─── Keep-Alive Alarm ──────────────────────────────────────────────────────
// Service workers can be killed after ~5 min of inactivity.
// Use alarms to periodically wake up and check state.

chrome.alarms.create('keepalive', { periodInMinutes: 0.4 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    chrome.storage.local.get(['idleTimeout'], (result) => {
      const timeout = result.idleTimeout || 60;
      chrome.idle.queryState(timeout, (idleState) => {
        if (idleState !== state.idleState) {
          console.log(`[Miner] Alarm check: state ${state.idleState} → ${idleState}`);
          state.idleState = idleState;

          if ((idleState === 'idle' || idleState === 'locked') && state.enabled && !state.mining) {
            startMining();
          } else if (idleState === 'active' && state.mining) {
            stopMining();
          }
        }
      });
    });
  }
});

// ─── Offscreen Document Management ─────────────────────────────────────────

let offscreenReady = false;

async function ensureOffscreen() {
  if (offscreenReady) return true;

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Run mining Web Workers in background'
    });
    offscreenReady = true;
    console.log('[Miner] Offscreen document created');
    return true;
  } catch (e) {
    if (e.message && e.message.includes('single offscreen')) {
      // Already exists
      offscreenReady = true;
      return true;
    }
    console.error('[Miner] Failed to create offscreen document:', e);
    return false;
  }
}

async function closeOffscreen() {
  if (!offscreenReady) return;
  try {
    await chrome.offscreen.closeDocument();
    offscreenReady = false;
    console.log('[Miner] Offscreen document closed');
  } catch (e) {
    offscreenReady = false;
  }
}

// ─── Mining Control ────────────────────────────────────────────────────────

async function startMining() {
  const config = await chrome.storage.local.get([
    'walletAddress', 'poolUrl', 'poolPassword', 'threads'
  ]);

  if (!config.walletAddress) {
    console.warn('[Miner] Cannot start: no wallet address configured');
    return;
  }

  console.log(`[Miner] Starting mining with ${config.threads || 4} threads`);

  const ready = await ensureOffscreen();
  if (!ready) {
    console.error('[Miner] Cannot start: offscreen document unavailable');
    return;
  }

  // Send start command to offscreen document
  try {
    chrome.runtime.sendMessage({
      type: 'start-mining',
      target: 'offscreen',
      config: {
        walletAddress: config.walletAddress,
        poolUrl: config.poolUrl || 'wss://proxy.example.com:8443',
        poolPassword: config.poolPassword || 'x',
        threads: config.threads || 4
      }
    });
  } catch (e) {
    console.error('[Miner] Error sending start message:', e);
    return;
  }

  state.mining = true;
  state.startTime = Date.now();
  state.sharesAccepted = 0;
  state.sharesRejected = 0;
  state.totalHashes = 0;

  // Green badge indicator
  chrome.action.setBadgeText({ text: '⛏' });
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

  broadcastStatus();
}

async function stopMining() {
  console.log('[Miner] Stopping mining');

  try {
    chrome.runtime.sendMessage({
      type: 'stop-mining',
      target: 'offscreen'
    });
  } catch (e) {
    // Offscreen might already be gone
  }

  state.mining = false;
  state.hashrate = 0;
  state.poolConnected = false;

  // Clear badge
  chrome.action.setBadgeText({ text: '' });

  // Close offscreen document after workers clean up
  setTimeout(() => closeOffscreen(), 1500);

  broadcastStatus();
}

// ─── Message Handling ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Ignore messages meant for offscreen
  if (msg.target === 'offscreen') return;

  switch (msg.type) {
    // ── Popup requests ──
    case 'get-status':
      sendResponse(getFullStatus());
      return true;

    case 'toggle-enabled':
      state.enabled = !!msg.enabled;
      chrome.storage.local.set({ enabled: state.enabled });
      console.log(`[Miner] Mining ${state.enabled ? 'enabled' : 'disabled'} by user`);

      if (!state.enabled && state.mining) {
        stopMining();
      } else if (state.enabled && !state.mining &&
                 (state.idleState === 'idle' || state.idleState === 'locked')) {
        startMining();
      }
      sendResponse(getFullStatus());
      return true;

    // ── Stats from offscreen/workers ──
    case 'mining-stats':
      if (msg.hashrate !== undefined) state.hashrate = msg.hashrate;
      if (msg.totalHashes !== undefined) state.totalHashes = msg.totalHashes;
      if (msg.poolConnected !== undefined) state.poolConnected = msg.poolConnected;
      broadcastStatus();
      break;

    case 'share-accepted':
      state.sharesAccepted++;
      console.log(`[Miner] Share accepted! Total: ${state.sharesAccepted}`);
      broadcastStatus();
      break;

    case 'share-rejected':
      state.sharesRejected++;
      console.log(`[Miner] Share rejected. Total: ${state.sharesRejected}`);
      broadcastStatus();
      break;

    case 'pool-connected':
      state.poolConnected = true;
      broadcastStatus();
      break;

    case 'pool-disconnected':
      state.poolConnected = false;
      broadcastStatus();
      break;
  }
});

// ─── Status Helpers ────────────────────────────────────────────────────────

function getFullStatus() {
  return {
    enabled: state.enabled,
    mining: state.mining,
    hashrate: state.hashrate,
    sharesAccepted: state.sharesAccepted,
    sharesRejected: state.sharesRejected,
    totalHashes: state.totalHashes,
    idleState: state.idleState,
    poolConnected: state.poolConnected,
    uptime: state.mining && state.startTime
      ? Math.floor((Date.now() - state.startTime) / 1000)
      : 0
  };
}

function broadcastStatus() {
  const status = { type: 'status-update', ...getFullStatus() };
  // Send to popup (may not be open — errors are expected)
  chrome.runtime.sendMessage(status).catch(() => {});
}

console.log('[Miner] Background service worker loaded');
