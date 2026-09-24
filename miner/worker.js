/**
 * XMR Mining Web Worker
 * 
 * This worker receives mining jobs and continuously hashes with different nonces
 * until a valid share is found or the job is cancelled.
 * 
 * Messages IN:
 *   { type: 'start-job', job: { blob, job_id, target }, nonceStart, nonceEnd, workerId }
 *   { type: 'new-job', job: { blob, job_id, target }, nonceStart, nonceEnd }
 *   { type: 'stop' }
 * 
 * Messages OUT:
 *   { type: 'share-found', nonce, result, job_id, workerId }
 *   { type: 'hashrate', rate, workerId, totalHashes }
 */

// Import CryptoNight hash function
importScripts('cryptonight.js');

let currentJob = null;
let running = false;
let workerId = 0;
let totalHashes = 0;
let hashCount = 0;
let lastHashrateTime = 0;

// Target difficulty threshold
let targetThreshold = null;

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes) {
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
}

/**
 * Write a 32-bit little-endian value into a byte array
 */
function writeUint32LE(arr, offset, value) {
    arr[offset] = value & 0xff;
    arr[offset + 1] = (value >>> 8) & 0xff;
    arr[offset + 2] = (value >>> 16) & 0xff;
    arr[offset + 3] = (value >>> 24) & 0xff;
}

/**
 * Check if hash meets the target difficulty
 * The hash (32 bytes) must be less than or equal to the target
 * Target is given as a compact hex string from the pool
 */
function meetsTarget(hash, targetHex) {
    // Pool sends target as a 8-char hex (4 bytes) representing difficulty
    // The hash (in LE) last 4 bytes must be <= target value
    // Actually, target is the threshold: hash[31..28] as uint32LE <= target
    
    if (!targetHex || targetHex.length === 0) return false;
    
    // Expand target to 32 bytes (right-padded with zeros means high difficulty,
    // right-padded with FF means low difficulty)
    // Pool target format: 4-byte hex like "7fff0000" 
    // Convert to full 256-bit target for comparison
    
    const targetBytes = hexToBytes(targetHex.padEnd(64, '0'));
    
    // Compare hash with target (both 32 bytes, big-endian comparison)
    // CryptoNight output is compared as a 256-bit LE integer
    // We compare from the most significant byte (index 31) downward
    for (let i = 31; i >= 0; i--) {
        if (hash[i] < targetBytes[i]) return true;
        if (hash[i] > targetBytes[i]) return false;
    }
    return true; // equal
}

/**
 * Main mining loop
 * Runs continuously, hashing the job blob with incrementing nonces
 */
function mine() {
    if (!running || !currentJob) return;

    const blob = hexToBytes(currentJob.blob);
    const target = currentJob.target;
    let nonce = currentJob.nonceStart || 0;
    const nonceEnd = currentJob.nonceEnd || 0xFFFFFFFF;
    
    const BATCH_SIZE = 10; // Hashes per batch before yielding
    lastHashrateTime = performance.now();
    hashCount = 0;

    function processBatch() {
        if (!running || !currentJob) return;

        for (let i = 0; i < BATCH_SIZE; i++) {
            if (nonce > nonceEnd) {
                // Exhausted nonce range
                self.postMessage({ 
                    type: 'nonce-exhausted', 
                    workerId 
                });
                return;
            }

            // Set nonce at byte offset 39 in the blob (standard position)
            writeUint32LE(blob, 39, nonce);

            // Compute CryptoNight hash
            const hash = self.cryptonight(blob);
            
            hashCount++;
            totalHashes++;
            nonce++;

            // Check if hash meets target
            if (meetsTarget(hash, target)) {
                // Found a valid share!
                const nonceHex = nonce.toString(16).padStart(8, '0');
                // Convert nonce to LE hex
                const nonceLEHex = bytesToHex(new Uint8Array([
                    nonce & 0xff,
                    (nonce >>> 8) & 0xff,
                    (nonce >>> 16) & 0xff,
                    (nonce >>> 24) & 0xff
                ]));

                self.postMessage({
                    type: 'share-found',
                    nonce: nonceLEHex,
                    result: bytesToHex(hash),
                    job_id: currentJob.job_id,
                    workerId
                });
            }
        }

        // Report hashrate every 2 seconds
        const now = performance.now();
        const elapsed = (now - lastHashrateTime) / 1000;
        if (elapsed >= 2) {
            const rate = hashCount / elapsed;
            self.postMessage({
                type: 'hashrate',
                rate: Math.round(rate * 10) / 10,
                workerId,
                totalHashes
            });
            hashCount = 0;
            lastHashrateTime = now;
        }

        // Yield to allow message processing, then continue
        setTimeout(processBatch, 0);
    }

    processBatch();
}

/**
 * Handle messages from the offscreen document
 */
self.onmessage = function(e) {
    const msg = e.data;

    switch (msg.type) {
        case 'start-job':
            workerId = msg.workerId || 0;
            currentJob = {
                blob: msg.job.blob,
                job_id: msg.job.job_id,
                target: msg.job.target,
                nonceStart: msg.nonceStart || 0,
                nonceEnd: msg.nonceEnd || 0xFFFFFFFF
            };
            running = true;
            totalHashes = 0;
            hashCount = 0;
            mine();
            break;

        case 'new-job':
            // Update job without resetting worker
            currentJob = {
                blob: msg.job.blob,
                job_id: msg.job.job_id,
                target: msg.job.target,
                nonceStart: msg.nonceStart || 0,
                nonceEnd: msg.nonceEnd || 0xFFFFFFFF
            };
            hashCount = 0;
            // Mining loop will pick up new job on next iteration
            if (!running) {
                running = true;
                mine();
            }
            break;

        case 'stop':
            running = false;
            currentJob = null;
            // Send final hashrate
            self.postMessage({
                type: 'hashrate',
                rate: 0,
                workerId,
                totalHashes
            });
            break;
    }
};

// Signal ready
self.postMessage({ type: 'ready', workerId: 0 });
