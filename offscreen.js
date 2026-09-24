/**
 * XMR Idle Miner - Offscreen Document
 * 
 * Runs inside chrome.offscreen document (hidden page).
 * Manages:
 * 1. WebSocket connection to mining pool (Stratum protocol)
 * 2. Spawning/managing Web Worker threads for hashing
 * 3. Job distribution to workers
 * 4. Share submission to pool
 * 5. Hashrate aggregation and reporting
 */

// ─── State ─────────────────────────────────────────────────────────────────

let workers = [];
let ws = null;
let config = null;
let currentJob = null;
let reconnectTimer = null;
let reconnectDelay = 1000; // Start at 1s, exponential backoff
const MAX_RECONNECT_DELAY = 30000;

// Hashrate tracking
const workerHashrates = {};
let statsInterval = null;

// ─── Message Handler (from Background) ─────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  switch (msg.type) {
    case 'start-mining':
      console.log('[Offscreen] Start mining command received');
      config = msg.config;
      startMiningSession();
      break;

    case 'stop-mining':
      console.log('[Offscreen] Stop mining command received');
      stopMiningSession();
      break;
  }
});

// ─── Mining Session ────────────────────────────────────────────────────────

function startMiningSession() {
  if (!config) return;

  // Connect to pool
  connectToPool();

  // Start stats reporting
  statsInterval = setInterval(reportStats, 2000);
}

function stopMiningSession() {
  // Stop all workers
  terminateWorkers();

  // Close pool connection
  disconnectFromPool();

  // Stop stats reporting
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }

  // Clear reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Report final stats
  chrome.runtime.sendMessage({
    type: 'mining-stats',
    hashrate: 0,
    totalHashes: 0,
    poolConnected: false
  }).catch(() => {});
}

// ─── Web Worker Management ─────────────────────────────────────────────────

function spawnWorkers(threadCount) {
  terminateWorkers();

  const count = Math.max(1, Math.min(threadCount, 32));
  console.log(`[Offscreen] Spawning ${count} mining workers`);

  for (let i = 0; i < count; i++) {
    const worker = new Worker('miner/worker.js');
    worker.workerId = i;

    worker.onmessage = (e) => handleWorkerMessage(e.data, i);
    worker.onerror = (e) => {
      console.error(`[Offscreen] Worker ${i} error:`, e.message);
    };

    workers.push(worker);
  }
}

function terminateWorkers() {
  workers.forEach((w, i) => {
    try {
      w.postMessage({ type: 'stop' });
      w.terminate();
    } catch (e) { /* ignore */ }
  });
  workers = [];
  Object.keys(workerHashrates).forEach(k => delete workerHashrates[k]);
}

function distributeJob(job) {
  if (!job || workers.length === 0) return;

  currentJob = job;
  const totalNonceRange = 0xFFFFFFFF;
  const rangePerWorker = Math.floor(totalNonceRange / workers.length);

  workers.forEach((worker, i) => {
    const nonceStart = i * rangePerWorker;
    const nonceEnd = (i === workers.length - 1)
      ? totalNonceRange
      : nonceStart + rangePerWorker - 1;

    worker.postMessage({
      type: workers.length > 0 ? 'start-job' : 'new-job',
      job: {
        blob: job.blob,
        job_id: job.job_id,
        target: job.target
      },
      nonceStart,
      nonceEnd,
      workerId: i
    });
  });

  console.log(`[Offscreen] Distributed job ${job.job_id} to ${workers.length} workers`);
}

function handleWorkerMessage(msg, workerId) {
  switch (msg.type) {
    case 'share-found':
      console.log(`[Offscreen] Worker ${workerId} found share!`);
      submitShare(msg);
      break;

    case 'hashrate':
      workerHashrates[workerId] = msg.rate;
      break;

    case 'ready':
      console.log(`[Offscreen] Worker ${workerId} ready`);
      break;

    case 'nonce-exhausted':
      console.log(`[Offscreen] Worker ${workerId} exhausted nonce range`);
      break;
  }
}

// ─── Pool Connection (Stratum over WebSocket) ──────────────────────────────

function connectToPool() {
  if (ws) disconnectFromPool();

  const poolUrl = config.poolUrl;
  console.log(`[Offscreen] Connecting to pool: ${poolUrl}`);

  try {
    ws = new WebSocket(poolUrl);
  } catch (e) {
    console.error('[Offscreen] WebSocket creation failed:', e);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[Offscreen] Connected to pool');
    reconnectDelay = 1000; // Reset backoff

    chrome.runtime.sendMessage({ type: 'pool-connected' }).catch(() => {});

    // Send login
    const loginMsg = {
      id: 1,
      method: 'login',
      params: {
        login: config.walletAddress,
        pass: config.poolPassword || 'x',
        agent: 'XMR-IdleMiner/1.0.0'
      }
    };
    ws.send(JSON.stringify(loginMsg));
    console.log('[Offscreen] Login sent');
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handlePoolMessage(data);
    } catch (e) {
      console.error('[Offscreen] Failed to parse pool message:', e);
    }
  };

  ws.onerror = (e) => {
    console.error('[Offscreen] WebSocket error');
  };

  ws.onclose = (e) => {
    console.log(`[Offscreen] Disconnected from pool (code: ${e.code})`);
    ws = null;
    chrome.runtime.sendMessage({ type: 'pool-disconnected' }).catch(() => {});

    // Auto-reconnect if we should still be mining
    if (config) {
      scheduleReconnect();
    }
  };
}

function disconnectFromPool() {
  if (ws) {
    try {
      ws.close();
    } catch (e) { /* ignore */ }
    ws = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  console.log(`[Offscreen] Reconnecting in ${reconnectDelay / 1000}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (config) {
      connectToPool();
    }
  }, reconnectDelay);

  // Exponential backoff
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

// ─── Stratum Protocol ──────────────────────────────────────────────────────

let messageId = 2; // 1 was used for login

function handlePoolMessage(data) {
  // Login response
  if (data.id === 1 && data.result) {
    console.log('[Offscreen] Login successful');

    // The login response usually contains the first job
    if (data.result.job) {
      console.log('[Offscreen] Received initial job');
      spawnWorkers(config.threads || 4);
      distributeJob(data.result.job);
    }
    return;
  }

  // Submit response
  if (data.id && data.id >= 2) {
    if (data.result && data.result.status === 'OK') {
      chrome.runtime.sendMessage({ type: 'share-accepted' }).catch(() => {});
    } else if (data.error) {
      console.error('[Offscreen] Share rejected:', data.error);
      chrome.runtime.sendMessage({ type: 'share-rejected' }).catch(() => {});
    }
    return;
  }

  // New job notification
  if (data.method === 'job' && data.params) {
    console.log('[Offscreen] New job received:', data.params.job_id);
    distributeJob(data.params);
    return;
  }
}

function submitShare(shareData) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[Offscreen] Cannot submit share: not connected');
    return;
  }

  const submitMsg = {
    id: messageId++,
    method: 'submit',
    params: {
      id: currentJob ? currentJob.job_id : shareData.job_id,
      job_id: shareData.job_id,
      nonce: shareData.nonce,
      result: shareData.result
    }
  };

  ws.send(JSON.stringify(submitMsg));
  console.log(`[Offscreen] Submitted share for job ${shareData.job_id}`);
}

// ─── Stats Reporting ───────────────────────────────────────────────────────

function reportStats() {
  const totalHashrate = Object.values(workerHashrates)
    .reduce((sum, rate) => sum + rate, 0);

  const totalHashes = workers.reduce((sum, w) => {
    return sum + (workerHashrates[w.workerId] || 0);
  }, 0);

  chrome.runtime.sendMessage({
    type: 'mining-stats',
    hashrate: Math.round(totalHashrate * 10) / 10,
    totalHashes,
    poolConnected: ws !== null && ws.readyState === WebSocket.OPEN
  }).catch(() => {});
}

console.log('[Offscreen] Offscreen document loaded and ready');
