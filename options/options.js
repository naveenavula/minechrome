/**
 * XMR Idle Miner - Options Page Script
 * 
 * Loads/saves settings to chrome.storage.local
 * and validates user inputs.
 */

// ─── DOM Elements ──────────────────────────────────────────────────────────

const walletInput = document.getElementById('walletAddress');
const poolUrlInput = document.getElementById('poolUrl');
const poolPasswordInput = document.getElementById('poolPassword');
const threadsSlider = document.getElementById('threads');
const threadsValue = document.getElementById('threadsValue');
const idleTimeoutSlider = document.getElementById('idleTimeout');
const idleTimeoutValue = document.getElementById('idleTimeoutValue');
const saveBtn = document.getElementById('saveBtn');
const resetBtn = document.getElementById('resetBtn');
const statusMsg = document.getElementById('statusMsg');

// ─── Defaults ──────────────────────────────────────────────────────────────

const DEFAULTS = {
  walletAddress: '',
  poolUrl: 'wss://pool.example.com:8443',
  poolPassword: 'x',
  threads: navigator.hardwareConcurrency || 4,
  idleTimeout: 60
};

// ─── Initialize ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Set slider max based on available cores
  const maxThreads = (navigator.hardwareConcurrency || 4) * 2;
  threadsSlider.max = Math.min(maxThreads, 32);

  loadSettings();
});

// ─── Slider Live Updates ───────────────────────────────────────────────────

threadsSlider.addEventListener('input', () => {
  threadsValue.textContent = threadsSlider.value;
});

idleTimeoutSlider.addEventListener('input', () => {
  idleTimeoutValue.textContent = `${idleTimeoutSlider.value}s`;
});

// ─── Save Settings ─────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
  const wallet = walletInput.value.trim();
  const poolUrl = poolUrlInput.value.trim();
  const poolPassword = poolPasswordInput.value.trim() || 'x';
  const threads = parseInt(threadsSlider.value, 10);
  const idleTimeout = parseInt(idleTimeoutSlider.value, 10);

  // Validate wallet address
  if (wallet && (wallet.length < 90 || wallet.length > 110)) {
    showStatus('Invalid wallet address. XMR addresses are ~95 characters long.', 'error');
    return;
  }

  // Validate pool URL
  if (poolUrl && !poolUrl.startsWith('ws://') && !poolUrl.startsWith('wss://')) {
    showStatus('Pool URL must start with ws:// or wss://', 'error');
    return;
  }

  // Save to storage
  chrome.storage.local.set({
    walletAddress: wallet,
    poolUrl: poolUrl,
    poolPassword: poolPassword,
    threads: threads,
    idleTimeout: idleTimeout
  }, () => {
    // Update idle detection interval
    chrome.idle.setDetectionInterval(idleTimeout);
    showStatus('Settings saved successfully!', 'success');

    // Auto-hide after 3 seconds
    setTimeout(() => {
      statusMsg.style.display = 'none';
    }, 3000);
  });
});

// ─── Reset Defaults ────────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  walletInput.value = DEFAULTS.walletAddress;
  poolUrlInput.value = DEFAULTS.poolUrl;
  poolPasswordInput.value = DEFAULTS.poolPassword;
  threadsSlider.value = DEFAULTS.threads;
  threadsValue.textContent = DEFAULTS.threads;
  idleTimeoutSlider.value = DEFAULTS.idleTimeout;
  idleTimeoutValue.textContent = `${DEFAULTS.idleTimeout}s`;
  showStatus('Reset to defaults. Click Save to apply.', 'success');
});

// ─── Load Settings ─────────────────────────────────────────────────────────

function loadSettings() {
  chrome.storage.local.get(
    ['walletAddress', 'poolUrl', 'poolPassword', 'threads', 'idleTimeout'],
    (result) => {
      walletInput.value = result.walletAddress || '';
      poolUrlInput.value = result.poolUrl || DEFAULTS.poolUrl;
      poolPasswordInput.value = result.poolPassword || DEFAULTS.poolPassword;

      const threads = result.threads || DEFAULTS.threads;
      threadsSlider.value = threads;
      threadsValue.textContent = threads;

      const timeout = result.idleTimeout || DEFAULTS.idleTimeout;
      idleTimeoutSlider.value = timeout;
      idleTimeoutValue.textContent = `${timeout}s`;
    }
  );
}

// ─── Status Message ────────────────────────────────────────────────────────

function showStatus(message, type) {
  statusMsg.textContent = message;
  statusMsg.className = `status-msg ${type}`;
}
