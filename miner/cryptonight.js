/**
 * CryptoNight-Lite Hash Implementation (JavaScript)
 * 
 * Pure JS implementation for browser-based mining.
 * For better performance (~10-50x), replace with a WASM module.
 * 
 * Algorithm: CryptoNight-Lite variant
 * - Scratchpad: 1 MB (1048576 bytes)
 * - Iterations: 262144 (half of standard CryptoNight)
 * - Address mask: 0x000FFFF0 (1MB, 16-byte aligned)
 * 
 * Note: Final hash uses Keccak-256 for all branches (simplified).
 * Standard CryptoNight selects Blake-256/Groestl-256/JH-256/Skein-256
 * based on state[0] & 3. For production mining, integrate a full
 * WASM implementation.
 */

// ─── Constants ─────────────────────────────────────────────────────────────

const SCRATCHPAD_SIZE = 1048576; // 1 MB for lite
const ITERATIONS = 262144;       // Half iterations for lite
const ADDRESS_MASK = 0x000FFFF0; // 1MB, 16-byte aligned

// ─── AES S-Box ─────────────────────────────────────────────────────────────

const SBOX = new Uint8Array([
  0x63, 0x7c, 0x77, 0x7b, 0xf2, 0x6b, 0x6f, 0xc5, 0x30, 0x01, 0x67, 0x2b, 0xfe, 0xd7, 0xab, 0x76,
  0xca, 0x82, 0xc9, 0x7d, 0xfa, 0x59, 0x47, 0xf0, 0xad, 0xd4, 0xa2, 0xaf, 0x9c, 0xa4, 0x72, 0xc0,
  0xb7, 0xfd, 0x93, 0x26, 0x36, 0x3f, 0xf7, 0xcc, 0x34, 0xa5, 0xe5, 0xf1, 0x71, 0xd8, 0x31, 0x15,
  0x04, 0xc7, 0x23, 0xc3, 0x18, 0x96, 0x05, 0x9a, 0x07, 0x12, 0x80, 0xe2, 0xeb, 0x27, 0xb2, 0x75,
  0x09, 0x83, 0x2c, 0x1a, 0x1b, 0x6e, 0x5a, 0xa0, 0x52, 0x3b, 0xd6, 0xb3, 0x29, 0xe3, 0x2f, 0x84,
  0x53, 0xd1, 0x00, 0xed, 0x20, 0xfc, 0xb1, 0x5b, 0x6a, 0xcb, 0xbe, 0x39, 0x4a, 0x4c, 0x58, 0xcf,
  0xd0, 0xef, 0xaa, 0xfb, 0x43, 0x4d, 0x33, 0x85, 0x45, 0xf9, 0x02, 0x7f, 0x50, 0x3c, 0x9f, 0xa8,
  0x51, 0xa3, 0x40, 0x8f, 0x92, 0x9d, 0x38, 0xf5, 0xbc, 0xb6, 0xda, 0x21, 0x10, 0xff, 0xf3, 0xd2,
  0xcd, 0x0c, 0x13, 0xec, 0x5f, 0x97, 0x44, 0x17, 0xc4, 0xa7, 0x7e, 0x3d, 0x64, 0x5d, 0x19, 0x73,
  0x60, 0x81, 0x4f, 0xdc, 0x22, 0x2a, 0x90, 0x88, 0x46, 0xee, 0xb8, 0x14, 0xde, 0x5e, 0x0b, 0xdb,
  0xe0, 0x32, 0x3a, 0x0a, 0x49, 0x06, 0x24, 0x5c, 0xc2, 0xd3, 0xac, 0x62, 0x91, 0x95, 0xe4, 0x79,
  0xe7, 0xc8, 0x37, 0x6d, 0x8d, 0xd5, 0x4e, 0xa9, 0x6c, 0x56, 0xf4, 0xea, 0x65, 0x7a, 0xae, 0x08,
  0xba, 0x78, 0x25, 0x2e, 0x1c, 0xa6, 0xb4, 0xc6, 0xe8, 0xdd, 0x74, 0x1f, 0x4b, 0xbd, 0x8b, 0x8a,
  0x70, 0x3e, 0xb5, 0x66, 0x48, 0x03, 0xf6, 0x0e, 0x61, 0x35, 0x57, 0xb9, 0x86, 0xc1, 0x1d, 0x9e,
  0xe1, 0xf8, 0x98, 0x11, 0x69, 0xd9, 0x8e, 0x94, 0x9b, 0x1e, 0x87, 0xe9, 0xce, 0x55, 0x28, 0xdf,
  0x8c, 0xa1, 0x89, 0x0d, 0xbf, 0xe6, 0x42, 0x68, 0x41, 0x99, 0x2d, 0x0f, 0xb0, 0x54, 0xbb, 0x16
]);

// ─── Keccak-f[1600] ────────────────────────────────────────────────────────
// Full 24-round Keccak permutation on a 5×5 matrix of 64-bit lanes.
// Uses pairs of 32-bit integers for 64-bit arithmetic.

// Round constants (split into hi/lo 32-bit pairs)
const KECCAK_RC_LO = new Uint32Array([
  0x00000001, 0x00008082, 0x0000808a, 0x80008000,
  0x0000808b, 0x80000001, 0x80008081, 0x00008009,
  0x0000008a, 0x00000088, 0x80008009, 0x8000000a,
  0x8000808b, 0x0000008b, 0x00008089, 0x00008003,
  0x00008002, 0x00000080, 0x0000800a, 0x8000000a,
  0x80008081, 0x00008080, 0x80000001, 0x80008008
]);

const KECCAK_RC_HI = new Uint32Array([
  0x00000000, 0x00000000, 0x80000000, 0x80000000,
  0x00000000, 0x00000000, 0x80000000, 0x80000000,
  0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x80000000, 0x80000000, 0x80000000,
  0x80000000, 0x80000000, 0x00000000, 0x80000000,
  0x80000000, 0x80000000, 0x00000000, 0x80000000
]);

// Rotation offsets for ρ (rho) step
const ROT_OFFSETS = [
   0,  1, 62, 28, 27,
  36, 44,  6, 55, 20,
   3, 10, 43, 25, 39,
  41, 45, 15, 21,  8,
  18,  2, 61, 56, 14
];

// π (pi) permutation indices
const PI_INDICES = [
  0, 10, 20,  5, 15,
  16,  1, 11, 21,  6,
   7, 17,  2, 12, 22,
  23,  8, 18,  3, 13,
  14, 24,  9, 19,  4
];

/**
 * Rotate a 64-bit value left by n bits (using two 32-bit halves)
 */
function rotl64(lo, hi, n) {
  if (n === 0) return [lo, hi];
  if (n === 32) return [hi, lo];
  if (n < 32) {
    return [
      (lo << n) | (hi >>> (32 - n)),
      (hi << n) | (lo >>> (32 - n))
    ];
  }
  n -= 32;
  return [
    (hi << n) | (lo >>> (32 - n)),
    (lo << n) | (hi >>> (32 - n))
  ];
}

/**
 * Keccak-f[1600] permutation
 * State is 25 pairs of [lo, hi] Uint32 values = 50 Uint32 values
 * Stored as stLo[25], stHi[25]
 */
function keccakF1600(stLo, stHi) {
  // Temporary arrays
  const cLo = new Uint32Array(5);
  const cHi = new Uint32Array(5);
  const dLo = new Uint32Array(5);
  const dHi = new Uint32Array(5);
  const bLo = new Uint32Array(25);
  const bHi = new Uint32Array(25);

  for (let round = 0; round < 24; round++) {
    // θ (theta) step
    for (let x = 0; x < 5; x++) {
      cLo[x] = stLo[x] ^ stLo[x + 5] ^ stLo[x + 10] ^ stLo[x + 15] ^ stLo[x + 20];
      cHi[x] = stHi[x] ^ stHi[x + 5] ^ stHi[x + 10] ^ stHi[x + 15] ^ stHi[x + 20];
    }

    for (let x = 0; x < 5; x++) {
      const x4 = (x + 4) % 5;
      const x1 = (x + 1) % 5;
      // d[x] = c[x-1] ^ rotl64(c[x+1], 1)
      const [rLo, rHi] = rotl64(cLo[x1], cHi[x1], 1);
      dLo[x] = cLo[x4] ^ rLo;
      dHi[x] = cHi[x4] ^ rHi;
    }

    for (let i = 0; i < 25; i++) {
      stLo[i] ^= dLo[i % 5];
      stHi[i] ^= dHi[i % 5];
    }

    // ρ (rho) and π (pi) steps combined
    for (let i = 0; i < 25; i++) {
      const r = ROT_OFFSETS[i];
      const [rLo, rHi] = rotl64(stLo[i], stHi[i], r);
      const j = PI_INDICES[i];
      bLo[j] = rLo;
      bHi[j] = rHi;
    }

    // χ (chi) step
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const x1 = (x + 1) % 5;
        const x2 = (x + 2) % 5;
        stLo[y + x] = bLo[y + x] ^ ((~bLo[y + x1]) & bLo[y + x2]);
        stHi[y + x] = bHi[y + x] ^ ((~bHi[y + x1]) & bHi[y + x2]);
      }
    }

    // ι (iota) step
    stLo[0] ^= KECCAK_RC_LO[round];
    stHi[0] ^= KECCAK_RC_HI[round];
  }
}

/**
 * Keccak-1600 hash function
 * Takes arbitrary-length input, returns 200-byte (1600-bit) state
 * 
 * Rate = 1088 bits (136 bytes) for Keccak used in CryptoNight
 */
function keccak1600(input) {
  const RATE = 136; // bytes (1088 bits)
  const stLo = new Uint32Array(25);
  const stHi = new Uint32Array(25);

  // Pad input: append 0x01, then zeros, then 0x80 at end of last rate block
  const inputLen = input.length;
  const padLen = RATE - (inputLen % RATE);
  const padded = new Uint8Array(inputLen + padLen);
  padded.set(input);
  padded[inputLen] = 0x01;
  padded[padded.length - 1] |= 0x80;

  // Absorb phase
  const view = new DataView(padded.buffer);
  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let i = 0; i < RATE / 8 && (offset + i * 8 + 7) < padded.length; i++) {
      const byteOff = offset + i * 8;
      stLo[i] ^= view.getUint32(byteOff, true);
      stHi[i] ^= view.getUint32(byteOff + 4, true);
    }
    keccakF1600(stLo, stHi);
  }

  // Squeeze: extract full 200-byte state
  const output = new Uint8Array(200);
  const outView = new DataView(output.buffer);
  for (let i = 0; i < 25; i++) {
    outView.setUint32(i * 8, stLo[i], true);
    outView.setUint32(i * 8 + 4, stHi[i], true);
  }

  return output;
}

/**
 * Keccak-256: Returns 32-byte hash
 */
function keccak256(input) {
  const state = keccak1600(input);
  return state.slice(0, 32);
}

// ─── AES Operations ────────────────────────────────────────────────────────

/**
 * GF(2^8) multiplication helper for MixColumns
 */
function gmul(a, b) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hiBit = a & 0x80;
    a = (a << 1) & 0xff;
    if (hiBit) a ^= 0x1b; // Reduction polynomial
    b >>= 1;
  }
  return p;
}

/**
 * AES SubBytes on a 16-byte block (in-place)
 */
function aesSubBytes(block) {
  for (let i = 0; i < 16; i++) {
    block[i] = SBOX[block[i]];
  }
}

/**
 * AES ShiftRows on a 16-byte block (in-place)
 * State is column-major: indices [0,4,8,12], [1,5,9,13], [2,6,10,14], [3,7,11,15]
 * Row 0: no shift
 * Row 1: shift left by 1
 * Row 2: shift left by 2
 * Row 3: shift left by 3
 */
function aesShiftRows(block) {
  // Row 1
  let t = block[1];
  block[1] = block[5];
  block[5] = block[9];
  block[9] = block[13];
  block[13] = t;

  // Row 2
  t = block[2];
  block[2] = block[10];
  block[10] = t;
  t = block[6];
  block[6] = block[14];
  block[14] = t;

  // Row 3
  t = block[15];
  block[15] = block[11];
  block[11] = block[7];
  block[7] = block[3];
  block[3] = t;
}

/**
 * AES MixColumns on a 16-byte block (in-place)
 */
function aesMixColumns(block) {
  for (let c = 0; c < 4; c++) {
    const i = c * 4;
    const s0 = block[i], s1 = block[i + 1], s2 = block[i + 2], s3 = block[i + 3];

    block[i]     = gmul(2, s0) ^ gmul(3, s1) ^ s2 ^ s3;
    block[i + 1] = s0 ^ gmul(2, s1) ^ gmul(3, s2) ^ s3;
    block[i + 2] = s0 ^ s1 ^ gmul(2, s2) ^ gmul(3, s3);
    block[i + 3] = gmul(3, s0) ^ s1 ^ s2 ^ gmul(2, s3);
  }
}

/**
 * Single AES encryption round: SubBytes → ShiftRows → MixColumns → AddRoundKey
 */
function aesRound(block, roundKey) {
  const out = new Uint8Array(block);
  aesSubBytes(out);
  aesShiftRows(out);
  aesMixColumns(out);
  // AddRoundKey
  for (let i = 0; i < 16; i++) {
    out[i] ^= roundKey[i];
  }
  return out;
}

/**
 * AES-256 key expansion: 32-byte key → 10 round keys (each 16 bytes)
 * CryptoNight uses a custom key schedule that expands to 10 round keys
 */
function aesKeyExpansion(key) {
  // AES-256 key schedule produces 15 round keys (240 bytes)
  // But CryptoNight only uses 10 for the scratchpad init
  const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];
  
  // Expand key to 240 bytes (60 uint32 words)
  const expanded = new Uint32Array(60);
  const keyView = new DataView(key.buffer, key.byteOffset, key.byteLength);
  
  // First 8 words come directly from the key
  for (let i = 0; i < 8; i++) {
    expanded[i] = keyView.getUint32(i * 4, true);
  }
  
  // Expand remaining words
  for (let i = 8; i < 60; i++) {
    let temp = expanded[i - 1];
    if (i % 8 === 0) {
      // RotWord + SubWord + Rcon
      temp = ((temp >>> 8) | (temp << 24)) >>> 0;
      temp = (SBOX[temp & 0xff]) |
             (SBOX[(temp >>> 8) & 0xff] << 8) |
             (SBOX[(temp >>> 16) & 0xff] << 16) |
             (SBOX[(temp >>> 24) & 0xff] << 24);
      temp = (temp ^ RCON[(i / 8) - 1]) >>> 0;
    } else if (i % 8 === 4) {
      // SubWord only
      temp = (SBOX[temp & 0xff]) |
             (SBOX[(temp >>> 8) & 0xff] << 8) |
             (SBOX[(temp >>> 16) & 0xff] << 16) |
             (SBOX[(temp >>> 24) & 0xff] << 24);
    }
    expanded[i] = (expanded[i - 8] ^ temp) >>> 0;
  }
  
  // Extract 10 round keys (each 16 bytes = 4 uint32 words)
  const roundKeys = [];
  for (let i = 0; i < 10; i++) {
    const rk = new Uint8Array(16);
    const rkView = new DataView(rk.buffer);
    for (let j = 0; j < 4; j++) {
      rkView.setUint32(j * 4, expanded[i * 4 + j], true);
    }
    roundKeys.push(rk);
  }
  
  return roundKeys;
}

// ─── Utility Functions ─────────────────────────────────────────────────────

function readUint32LE(arr, offset) {
  return (arr[offset]) |
         (arr[offset + 1] << 8) |
         (arr[offset + 2] << 16) |
         (arr[offset + 3] << 24);
}

function writeUint32LE(arr, offset, val) {
  arr[offset] = val & 0xff;
  arr[offset + 1] = (val >>> 8) & 0xff;
  arr[offset + 2] = (val >>> 16) & 0xff;
  arr[offset + 3] = (val >>> 24) & 0xff;
}

function readUint64LE(arr, offset) {
  const lo = readUint32LE(arr, offset) >>> 0;
  const hi = readUint32LE(arr, offset + 4) >>> 0;
  return [lo, hi];
}

function writeUint64LE(arr, offset, lo, hi) {
  writeUint32LE(arr, offset, lo);
  writeUint32LE(arr, offset + 4, hi);
}

function xorBytes(a, b) {
  const result = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

/**
 * 64-bit unsigned multiply: (aLo, aHi) * (bLo, bHi) → 128-bit result [lo, hi]
 * We only need the low 128 bits of the multiplication of two 64-bit numbers.
 * Actually for CryptoNight we multiply two 64-bit numbers and return 128-bit result.
 */
function mul64(aLo, aHi, bLo, bHi) {
  // Split each 32-bit value into 16-bit halves
  const a0 = aLo & 0xffff, a1 = aLo >>> 16;
  const a2 = aHi & 0xffff, a3 = aHi >>> 16;
  const b0 = bLo & 0xffff, b1 = bLo >>> 16;
  const b2 = bHi & 0xffff, b3 = bHi >>> 16;

  // Multiply: we need the result as [resLo_lo, resLo_hi, resHi_lo, resHi_hi]
  // For CryptoNight, we need hi64 and lo64 of (a64 * b64)
  // a64 = aHi:aLo, b64 = bHi:bLo (but we only use 64-bit numbers, not 128)
  // Actually, CryptoNight multiplies two 64-bit numbers (low 8 bytes of the 16-byte value)
  // and produces a 128-bit result [hi64, lo64]
  
  // Full 64×64→128 multiplication using 16-bit parts
  let r0 = 0, r1 = 0, r2 = 0, r3 = 0;
  let carry = 0;
  
  // a64 = a1:a0 (32-bit parts: aHi=a1, aLo=a0... wait)
  // Let me redo this. a is a 64-bit value: lo=aLo(32bit), hi=aHi(32bit)
  // b is a 64-bit value: lo=bLo(32bit), hi=bHi(32bit)
  // Result is 128-bit: [resultLo_lo, resultLo_hi, resultHi_lo, resultHi_hi]
  
  // Using schoolbook multiplication with 32-bit digits:
  // aLo * bLo → 64-bit result in [r0, r1]
  let t = Math.imul(aLo & 0xffff, bLo & 0xffff) >>> 0;
  r0 = t & 0xffff;
  carry = t >>> 16;
  
  t = (Math.imul(aLo >>> 16, bLo & 0xffff) >>> 0) + carry;
  let t2 = (Math.imul(aLo & 0xffff, bLo >>> 16) >>> 0);
  let sum = (t + t2) >>> 0;
  r1 = sum & 0xffff;
  carry = (sum >>> 16) + ((sum < t || sum < t2) ? 0x10000 : 0);
  
  t = (Math.imul(aLo >>> 16, bLo >>> 16) >>> 0) + carry;
  r2 = t & 0xffff;
  r3 = t >>> 16;
  
  // Add cross terms: aLo*bHi and aHi*bLo
  t = Math.imul(aLo & 0xffff, bHi & 0xffff) >>> 0;
  r2 += t & 0xffff;
  r3 += (t >>> 16) + (r2 >>> 16);
  r2 &= 0xffff;
  
  t = Math.imul(aHi & 0xffff, bLo & 0xffff) >>> 0;
  r2 += t & 0xffff;
  r3 += (t >>> 16) + (r2 >>> 16);
  r2 &= 0xffff;
  
  // More cross terms at higher positions
  t = Math.imul(aLo >>> 16, bHi & 0xffff) >>> 0;
  r3 += t & 0xffff;
  r3 &= 0xffffffff;
  
  t = Math.imul(aLo & 0xffff, bHi >>> 16) >>> 0;
  r3 += t & 0xffff;
  r3 &= 0xffffffff;
  
  t = Math.imul(aHi & 0xffff, bLo >>> 16) >>> 0;
  r3 += t & 0xffff;
  r3 &= 0xffffffff;
  
  t = Math.imul(aHi >>> 16, bLo & 0xffff) >>> 0;
  r3 += t & 0xffff;
  r3 &= 0xffffffff;
  
  // Also: aHi * bHi → goes into [r4, r5] but we only need up to r3 for 128-bit
  // Actually no, aHi*bHi contributes to the HIGH 64 bits
  t = Math.imul(aHi & 0xffff, bHi & 0xffff) >>> 0;
  r3 += (t >>> 16);
  
  // Build result
  const resultLoLo = (r0 | (r1 << 16)) >>> 0;
  const resultLoHi = (r2 | (r3 << 16)) >>> 0;
  
  // For the high 64 bits, we need a simpler approach
  // High 64 = (aHi * bHi) + carry from (aLo * bHi + aHi * bLo)
  // This is getting complex. Let me use a simpler but correct approach.
  
  return simpleMul64(aLo, aHi, bLo, bHi);
}

/**
 * Simpler 64×64→128 multiplication using Math.imul and manual carry propagation
 */
function simpleMul64(aLo, aHi, bLo, bHi) {
  // Split into 16-bit parts
  const a0 = aLo & 0xffff;
  const a1 = (aLo >>> 16) & 0xffff;
  const a2 = aHi & 0xffff;
  const a3 = (aHi >>> 16) & 0xffff;
  
  const b0 = bLo & 0xffff;
  const b1 = (bLo >>> 16) & 0xffff;
  const b2 = bHi & 0xffff;
  const b3 = (bHi >>> 16) & 0xffff;
  
  // Accumulate products into 16-bit result columns r[0..7]
  // result[i] = sum of a[j]*b[k] where j+k == i
  let r = [0, 0, 0, 0, 0, 0, 0, 0];
  
  const parts_a = [a0, a1, a2, a3];
  const parts_b = [b0, b1, b2, b3];
  
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const prod = parts_a[i] * parts_b[j]; // max 0xfffe0001, fits in double
      const idx = i + j;
      r[idx] += prod;
    }
  }
  
  // Propagate carries
  for (let i = 0; i < 7; i++) {
    r[i + 1] += (r[i] >>> 16);
    r[i] &= 0xffff;
  }
  r[7] &= 0xffff;
  
  // Build 128-bit result as [lo64_lo32, lo64_hi32, hi64_lo32, hi64_hi32]
  const resLoLo = (r[0] | (r[1] << 16)) >>> 0;
  const resLoHi = (r[2] | (r[3] << 16)) >>> 0;
  const resHiLo = (r[4] | (r[5] << 16)) >>> 0;
  const resHiHi = (r[6] | (r[7] << 16)) >>> 0;
  
  return {
    lo: [resLoLo, resLoHi],   // low 64 bits as [lo32, hi32]
    hi: [resHiLo, resHiHi]    // high 64 bits as [lo32, hi32]
  };
}

/**
 * 64-bit addition: (aLo, aHi) + (bLo, bHi) → [resultLo, resultHi]
 */
function add64(aLo, aHi, bLo, bHi) {
  const lo = (aLo + bLo) >>> 0;
  const carry = ((aLo & bLo) | ((aLo | bLo) & ~lo)) >>> 31;
  const hi = (aHi + bHi + carry) >>> 0;
  return [lo, hi];
}

// ─── CryptoNight-Lite Main Algorithm ───────────────────────────────────────

/**
 * CryptoNight-Lite slow hash
 * @param {Uint8Array} input - The data to hash (mining blob)
 * @returns {Uint8Array} 32-byte hash result
 */
function cryptonight(input) {
  // ── Step 1: Keccak-1600 ──
  const state = keccak1600(input); // 200 bytes

  // ── Step 2: AES Key Expansion ──
  const aesKey = state.slice(0, 32);
  const roundKeys = aesKeyExpansion(aesKey);

  // ── Step 3: Initialize Scratchpad (1MB) ──
  const scratchpad = new Uint8Array(SCRATCHPAD_SIZE);

  // Extract 128 bytes from state[64..191] as initial text
  const text = new Uint8Array(128);
  text.set(state.slice(64, 192));

  // Fill scratchpad by repeatedly AES-encrypting the text blocks
  for (let i = 0; i < SCRATCHPAD_SIZE; i += 128) {
    for (let j = 0; j < 8; j++) {
      let block = text.slice(j * 16, j * 16 + 16);
      for (let k = 0; k < 10; k++) {
        block = aesRound(block, roundKeys[k]);
      }
      text.set(block, j * 16);
    }
    scratchpad.set(text, i);
  }

  // ── Step 4: Main Loop (Memory-Hard) ──
  // Initialize a and b from state
  let a = xorBytes(state.slice(0, 16), state.slice(32, 48));
  let b = xorBytes(state.slice(16, 32), state.slice(48, 64));

  for (let i = 0; i < ITERATIONS; i++) {
    // ── Phase 1: AES round ──
    const addr1 = (readUint32LE(a, 0) >>> 0) & ADDRESS_MASK;
    
    // Read 16 bytes from scratchpad
    let cx = scratchpad.slice(addr1, addr1 + 16);
    
    // AES round with 'a' as the round key
    cx = aesRound(cx, a);
    
    // XOR with b, write to scratchpad
    const xored = xorBytes(cx, b);
    scratchpad.set(xored, addr1);
    
    // b takes the AES result
    b = cx;
    
    // ── Phase 2: Multiply-Add ──
    const addr2 = (readUint32LE(b, 0) >>> 0) & ADDRESS_MASK;
    
    // Read 16 bytes from scratchpad at new address
    const dx = scratchpad.slice(addr2, addr2 + 16);
    
    // 64-bit multiply: low 8 bytes of b × low 8 bytes of dx
    const [bLo, bHi] = readUint64LE(b, 0);
    const [dLo, dHi] = readUint64LE(dx, 0);
    const mulResult = simpleMul64(bLo, bHi, dLo, dHi);
    
    // 128-bit add: a += mul_result
    const [aLo, aHi] = readUint64LE(a, 0);
    const [aLo2, aHi2] = readUint64LE(a, 8);
    
    const [newALo, newAHi] = add64(aLo, aHi, mulResult.hi[0], mulResult.hi[1]);
    const [newALo2, newAHi2] = add64(aLo2, aHi2, mulResult.lo[0], mulResult.lo[1]);
    
    writeUint64LE(a, 0, newALo, newAHi);
    writeUint64LE(a, 8, newALo2, newAHi2);
    
    // Write a to scratchpad
    scratchpad.set(a, addr2);
    
    // XOR a with dx
    a = xorBytes(a, dx);
  }

  // ── Step 5: Final Scratchpad Extraction ──
  // Derive second set of AES keys from state[32..63]
  const aesKey2 = state.slice(32, 64);
  const roundKeys2 = aesKeyExpansion(aesKey2);

  // Extract text again from state
  const finalText = new Uint8Array(128);
  finalText.set(state.slice(64, 192));

  // XOR scratchpad chunks into text and AES-encrypt
  for (let i = 0; i < SCRATCHPAD_SIZE; i += 128) {
    for (let j = 0; j < 128; j++) {
      finalText[j] ^= scratchpad[i + j];
    }
    for (let j = 0; j < 8; j++) {
      let block = finalText.slice(j * 16, j * 16 + 16);
      for (let k = 0; k < 10; k++) {
        block = aesRound(block, roundKeys2[k]);
      }
      finalText.set(block, j * 16);
    }
  }

  // Write final text back to state
  const finalState = new Uint8Array(state);
  finalState.set(finalText, 64);

  // ── Step 6: Final Keccak ──
  // Re-run keccak on the modified state
  // We need to apply keccak-f[1600] to the state directly
  const stLo = new Uint32Array(25);
  const stHi = new Uint32Array(25);
  const stView = new DataView(finalState.buffer, finalState.byteOffset);
  for (let i = 0; i < 25; i++) {
    stLo[i] = stView.getUint32(i * 8, true);
    stHi[i] = stView.getUint32(i * 8 + 4, true);
  }
  keccakF1600(stLo, stHi);

  // Extract state back to bytes
  const hashState = new Uint8Array(200);
  const hashView = new DataView(hashState.buffer);
  for (let i = 0; i < 25; i++) {
    hashView.setUint32(i * 8, stLo[i], true);
    hashView.setUint32(i * 8 + 4, stHi[i], true);
  }

  // ── Step 7: Final Hash Selection ──
  // Standard CryptoNight selects one of: Blake-256, Groestl-256, JH-256, Skein-256
  // based on hashState[0] & 3. We use Keccak-256 for all branches (simplified).
  // For production, replace with proper final hash functions or use WASM module.
  return keccak256(hashState);
}

// ─── Export ────────────────────────────────────────────────────────────────

self.cryptonight = cryptonight;
