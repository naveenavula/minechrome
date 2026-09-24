/**
 * WebSocket-to-Stratum Proxy for XMR Idle Miner
 * 
 * Translates WebSocket connections from the Chrome extension
 * into TCP Stratum connections to a mining pool.
 * 
 * Usage:
 *   node proxy.js
 * 
 * Then set Pool URL in the extension to: ws://localhost:3340
 */

const net = require('net');
const http = require('http');

// ─── Configuration ─────────────────────────────────────────────────────────
const PROXY_PORT = 3340;

// Choose your mining pool (uncomment one):
const POOL_HOST = 'gulf.moneroocean.stream';  // MoneroOcean (auto-converts to XMR)
const POOL_PORT = 10128;

// Alternative pools (uncomment to use):
// const POOL_HOST = 'pool.supportxmr.com'; const POOL_PORT = 3333;
// const POOL_HOST = 'xmr.2miners.com';     const POOL_PORT = 2222;
// const POOL_HOST = 'xmr-eu1.nanopool.org'; const POOL_PORT = 14433;

// ─── WebSocket Implementation (minimal, no dependencies) ──────────────────

const crypto = require('crypto');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('XMR Mining Proxy Running\n');
});

server.on('upgrade', (req, socket) => {
  // WebSocket handshake
  const key = req.headers['sec-websocket-key'];
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-5AB5DC085B41')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  console.log('[Proxy] Browser connected');

  // Connect to mining pool via TCP
  const pool = net.createConnection(POOL_PORT, POOL_HOST, () => {
    console.log(`[Proxy] Connected to pool ${POOL_HOST}:${POOL_PORT}`);
  });

  let poolBuffer = '';

  // Pool → Browser (TCP → WebSocket)
  pool.on('data', (data) => {
    poolBuffer += data.toString();
    const lines = poolBuffer.split('\n');
    poolBuffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        console.log('[Pool→Browser]', line.trim().substring(0, 120));
        sendWsFrame(socket, line.trim());
      }
    }
  });

  // Browser → Pool (WebSocket → TCP)
  let wsBuffer = Buffer.alloc(0);

  socket.on('data', (data) => {
    wsBuffer = Buffer.concat([wsBuffer, data]);

    while (wsBuffer.length >= 2) {
      const frame = parseWsFrame(wsBuffer);
      if (!frame) break;

      wsBuffer = wsBuffer.slice(frame.totalLength);

      if (frame.opcode === 0x08) {
        // Close frame
        console.log('[Proxy] Browser disconnected');
        pool.end();
        socket.end();
        return;
      }

      if (frame.opcode === 0x09) {
        // Ping → Pong
        sendWsFrame(socket, frame.payload, 0x0A);
        continue;
      }

      if (frame.payload) {
        const msg = frame.payload.toString();
        console.log('[Browser→Pool]', msg.substring(0, 120));
        pool.write(msg + '\n');
      }
    }
  });

  pool.on('error', (err) => {
    console.error('[Proxy] Pool error:', err.message);
    try { socket.end(); } catch(e) {}
  });

  pool.on('close', () => {
    console.log('[Proxy] Pool disconnected');
    try { socket.end(); } catch(e) {}
  });

  socket.on('error', (err) => {
    console.error('[Proxy] Browser error:', err.message);
    try { pool.end(); } catch(e) {}
  });

  socket.on('close', () => {
    console.log('[Proxy] Browser disconnected');
    try { pool.end(); } catch(e) {}
  });
});

// ─── WebSocket Frame Helpers ───────────────────────────────────────────────

function sendWsFrame(socket, data, opcode = 0x01) {
  const payload = typeof data === 'string' ? Buffer.from(data) : data;
  const len = payload.length;

  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN + opcode
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  try {
    socket.write(Buffer.concat([header, payload]));
  } catch(e) {}
}

function parseWsFrame(buf) {
  if (buf.length < 2) return null;

  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let payloadLen = buf[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (buf.length < 4) return null;
    payloadLen = buf.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null;
    payloadLen = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }

  const maskSize = masked ? 4 : 0;
  const totalLength = offset + maskSize + payloadLen;
  if (buf.length < totalLength) return null;

  let payload = buf.slice(offset + maskSize, offset + maskSize + payloadLen);

  if (masked) {
    const mask = buf.slice(offset, offset + 4);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { opcode, payload, totalLength };
}

// ─── Start ─────────────────────────────────────────────────────────────────

server.listen(PROXY_PORT, () => {
  console.log('');
  console.log('  ⛏️  XMR Mining Proxy Running');
  console.log(`  Pool: ${POOL_HOST}:${POOL_PORT}`);
  console.log(`  Proxy: ws://localhost:${PROXY_PORT}`);
  console.log('');
  console.log('  Set this in the extension settings:');
  console.log(`  Pool WebSocket URL → ws://localhost:${PROXY_PORT}`);
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('');
});
