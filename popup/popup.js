/**
 * XMR Idle Miner - Popup Script
 * 
 * Handles UI updates, user interactions, and communication
 * with the background service worker.
 */

// ─── DOM Elements ──────────────────────────────────────────────────────────

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const enableToggle = document.getElementById('enableToggle');
const forceToggle = document.getElementById('forceToggle');
const hashrateEl = document.getElementById('hashrate');
const uptimeEl = document.getElementById('uptime');
const sharesAcceptedEl = document.getElementById('sharesAccepted');
const sharesRejectedEl = document.getElementById('sharesRejected');
const walletDisplay = document.getElementById('walletDisplay');
const poolDisplay = document.getElementById('poolDisplay');
const idleStateDisplay = document.getElementById('idleStateDisplay');
const settingsBtn = document.getElementById('settingsBtn');

// ─── State ─────────────────────────────────────────────────────────────────

let uptimeSeconds = 0;
let uptimeInterval = null;
let miningStartTime = null;

// ─── Initialize ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Fetch current status from background
  chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
    if (response) {
      updateUI(response);
    }
  });

  // Load stored config for display
  chrome.storage.local.get(['walletAddress', 'poolUrl'], (config) => {
    updateWalletDisplay(config.walletAddress);
    updatePoolDisplay(config.poolUrl);
  });
});

// ─── Event Listeners ───────────────────────────────────────────────────────

// Toggle mining enabled/disabled
enableToggle.addEventListener('change', () => {
  const enabled = enableToggle.checked;
  chrome.runtime.sendMessage({ type: 'toggle-enabled', enabled }, (response) => {
    if (response) {
      updateUI(response);
    }
  });
});

// Toggle force/test mining
forceToggle.addEventListener('change', () => {
  const force = forceToggle.checked;
  // If force mining is turned on, also ensure enabled is true
  if (force && !enableToggle.checked) {
    enableToggle.checked = true;
    chrome.runtime.sendMessage({ type: 'toggle-enabled', enabled: true });
  }
  chrome.runtime.sendMessage({ type: 'toggle-force', force }, (response) => {
    if (response) {
      updateUI(response);
    }
  });
});

// Open settings page
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Listen for live status updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'status-update') {
    updateUI(msg);
  }
});

// ─── UI Update Functions ───────────────────────────────────────────────────

function updateUI(status) {
  // Toggle states
  enableToggle.checked = !!status.enabled;
  if (forceToggle) forceToggle.checked = !!status.forceMining;

  // Status indicator
  if (status.mining) {
    statusDot.className = 'status-dot mining';
    statusText.textContent = status.forceMining ? 'Mining (Test)' : 'Mining (Idle)';
  } else if (status.enabled && (status.idleState === 'active')) {
    statusDot.className = 'status-dot waiting';
    statusText.textContent = 'Paused (PC active)';
  } else if (status.enabled) {
    statusDot.className = 'status-dot waiting';
    statusText.textContent = 'Waiting for idle';
  } else {
    statusDot.className = 'status-dot';
    statusText.textContent = 'Disabled';
  }

  // Hashrate
  const hr = status.hashrate || 0;
  if (hr > 0) {
    hashrateEl.innerHTML = `${hr.toFixed(1)} <span class="stat-unit">H/s</span>`;
  } else if (status.lastHashrate > 0) {
    hashrateEl.innerHTML = `<span style="color:#aaa;">${status.lastHashrate.toFixed(1)}</span> <span class="stat-unit">H/s (last)</span>`;
  } else {
    hashrateEl.innerHTML = `0.0 <span class="stat-unit">H/s</span>`;
  }

  // Shares
  sharesAcceptedEl.textContent = status.sharesAccepted || 0;
  sharesRejectedEl.textContent = status.sharesRejected || 0;

  // Uptime
  uptimeSeconds = status.uptime || 0;
  updateUptime();

  // Idle state
  const stateMap = {
    'active': '🟢 Active',
    'idle': '🟡 Idle',
    'locked': '🔒 Locked'
  };
  idleStateDisplay.textContent = stateMap[status.idleState] || status.idleState || 'Unknown';

  // Pool connection
  if (status.poolConnected) {
    poolDisplay.textContent = '✓ Connected';
    poolDisplay.className = 'info-value connected';
  }

  // Start/stop uptime counter
  if (status.mining && !uptimeInterval) {
    startUptimeCounter();
  } else if (!status.mining && uptimeInterval) {
    stopUptimeCounter();
  }
}

function updateWalletDisplay(address) {
  if (address && address.length > 10) {
    // Truncate: show first 8 and last 6 chars
    walletDisplay.textContent = `${address.substring(0, 8)}...${address.substring(address.length - 6)}`;
    walletDisplay.className = 'info-value';
    walletDisplay.title = address; // Full address on hover
  } else {
    walletDisplay.textContent = 'Not configured';
    walletDisplay.className = 'info-value not-configured';
  }
}

function updatePoolDisplay(poolUrl) {
  if (poolUrl) {
    try {
      const url = new URL(poolUrl);
      poolDisplay.textContent = url.hostname;
    } catch {
      poolDisplay.textContent = poolUrl;
    }
  } else {
    poolDisplay.textContent = '—';
  }
}

// ─── Uptime Counter ────────────────────────────────────────────────────────

function startUptimeCounter() {
  if (uptimeInterval) return;
  uptimeInterval = setInterval(() => {
    uptimeSeconds++;
    updateUptime();
  }, 1000);
}

function stopUptimeCounter() {
  if (uptimeInterval) {
    clearInterval(uptimeInterval);
    uptimeInterval = null;
  }
  uptimeSeconds = 0;
  updateUptime();
}

function updateUptime() {
  const h = Math.floor(uptimeSeconds / 3600);
  const m = Math.floor((uptimeSeconds % 3600) / 60);
  const s = uptimeSeconds % 60;
  uptimeEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function pad(n) {
  return n.toString().padStart(2, '0');
}
