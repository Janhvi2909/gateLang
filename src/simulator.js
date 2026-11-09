/*
 * GateLang — bit-parallel simulator (used by Phases 5 and 6)
 *
 * Each signal's whole truth-table column is packed into a Uint32Array:
 * bit r of the column is the signal's value in row r. One bitwise CPU
 * operation (&, |, ^, ~) therefore evaluates a gate for 32 rows at once,
 * and a circuit with g gates and n inputs costs g · 2ⁿ / 32 word operations.
 *
 * Row order is the usual truth-table order: the first declared input is the
 * most significant bit.
 *
 * Memory: columns of temporaries are released after their last use, so only
 * the live signals are kept in memory at any time.
 */
(function (GL) {
  'use strict';

  const MAX_TABLE_INPUTS = 20;   // exhaustive evaluation limit (2^20 = 1,048,576 rows)

  const wordsFor = (n) => Math.max(1, Math.ceil(Math.pow(2, n) / 32));
  const lastMask = (n) => (n >= 5 ? 0xFFFFFFFF : ((1 << Math.pow(2, n)) - 1) >>> 0);

  /** Truth-table input columns for n inputs. Input k toggles every 2^(n-1-k) rows. */
  function systematicInputs(n) {
    const W = wordsFor(n);
    const cols = [];
    for (let k = 0; k < n; k++) {
      const s = n - 1 - k;
      const col = new Uint32Array(W);
      if (s >= 5) {
        for (let w = 0; w < W; w++) col[w] = ((w * 32) >>> s) & 1 ? 0xFFFFFFFF : 0;
      } else {
        let pat = 0;
        for (let b = 0; b < 32; b++) if ((b >>> s) & 1) pat |= (1 << b);
        col.fill(pat >>> 0);
      }
      col[W - 1] &= lastMask(n);
      cols.push(col);
    }
    return { cols, words: W, mask: lastMask(n), rows: Math.pow(2, n), mode: 'exhaustive' };
  }

  /** Random input columns (used to verify circuits with more than 20 inputs). */
  function randomInputs(n, words, seed) {
    let x = (seed || 0x9E3779B9) >>> 0;
    const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
    const cols = [];
    for (let k = 0; k < n; k++) { const c = new Uint32Array(words); for (let w = 0; w < words; w++) c[w] = rnd(); cols.push(c); }
    return { cols, words, mask: 0xFFFFFFFF, rows: words * 32, mode: 'random' };
  }

  /**
   * Evaluate a list of operations over packed columns.
   * ops: [{op, a, b, res}] with op ∈ AND OR XOR NAND NOR XNOR NOT COPY BUF
   * @returns Map name → Uint32Array for every name in `keep`
   */
  function run(ops, inputNames, vectors, keep) {
    const W = vectors.words, mask = vectors.mask;
    const env = new Map();
    inputNames.forEach((name, k) => env.set(name, vectors.cols[k]));
    const zero = new Uint32Array(W);
    const one = new Uint32Array(W).fill(0xFFFFFFFF); one[W - 1] &= mask;
    const get = (x) => (x === '0' ? zero : x === '1' ? one : env.get(x));
    const keepSet = new Set(keep);

    // last use of each name, so dead columns can be released
    const lastUse = new Map();
    ops.forEach((o, i) => { if (o.a) lastUse.set(o.a, i); if (o.b) lastUse.set(o.b, i); });

    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      const A = get(o.a), B = o.b != null ? get(o.b) : null;
      if (!A || (o.b != null && !B)) throw new Error(`simulator: undefined operand in ${o.res}`);
      let R;
      switch (o.op) {
        case 'COPY': case 'BUF': R = A; break;
        case 'NOT': R = new Uint32Array(W); for (let w = 0; w < W; w++) R[w] = ~A[w]; break;
        case 'AND': R = new Uint32Array(W); for (let w = 0; w < W; w++) R[w] = A[w] & B[w]; break;
        case 'OR': R = new Uint32Array(W); for (let w = 0; w < W; w++) R[w] = A[w] | B[w]; break;
        case 'XOR': R = new Uint32Array(W); for (let w = 0; w < W; w++) R[w] = A[w] ^ B[w]; break;
        case 'NAND': R = new Uint32Array(W); for (let w = 0; w < W; w++) R[w] = ~(A[w] & B[w]); break;
        case 'NOR': R = new Uint32Array(W); for (let w = 0; w < W; w++) R[w] = ~(A[w] | B[w]); break;
        case 'XNOR': R = new Uint32Array(W); for (let w = 0; w < W; w++) R[w] = ~(A[w] ^ B[w]); break;
        default: throw new Error('simulator: unknown op ' + o.op);
      }
      if (R !== A) R[W - 1] &= mask;
      env.set(o.res, R);
      // release columns that are no longer needed
      for (const x of [o.a, o.b]) {
        if (x && lastUse.get(x) === i && !keepSet.has(x) && !inputNames.includes(x)) env.delete(x);
      }
    }
    const out = new Map();
    for (const k of keep) out.set(k, get(k) || zero);
    return out;
  }

  const bit = (col, r) => (col[r >>> 5] >>> (r & 31)) & 1;

  function equalCols(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  const isAll = (col, mask, v) => {
    const full = v ? 0xFFFFFFFF : 0;
    for (let i = 0; i < col.length - 1; i++) if (col[i] !== (full >>> 0)) return false;
    return (col[col.length - 1] >>> 0) === ((v ? mask : 0) >>> 0);
  };

  /** Does the function in `col` depend on input k (of n)? Uses word operations. */
  function dependsOn(col, k, n) {
    const s = n - 1 - k;
    if (s >= 5) {
      const B = 1 << (s - 5);
      for (let w = 0; w < col.length; w++) if (((w >>> (s - 5)) & 1) === 0 && col[w] !== col[w + B]) return true;
      return false;
    }
    const sh = 1 << s;
    let m = 0;
    for (let b = 0; b < 32; b++) if (((b >>> s) & 1) === 0) m |= (1 << b);
    for (let w = 0; w < col.length; w++) if (((col[w] & m) >>> 0) !== (((col[w] >>> sh) & m) >>> 0)) return true;
    return false;
  }

  /** Scalar evaluation of a netlist for one input vector (interactive simulator). */
  function evalOnce(ops, values) {
    const env = new Map(Object.entries(values));
    const g = (x) => (x === '0' ? 0 : x === '1' ? 1 : env.get(x) || 0);
    for (const o of ops) {
      const a = g(o.a), b = o.b != null ? g(o.b) : 0;
      let r;
      switch (o.op) {
        case 'COPY': case 'BUF': r = a; break;
        case 'NOT': r = a ^ 1; break;
        case 'AND': r = a & b; break;
        case 'OR': r = a | b; break;
        case 'XOR': r = a ^ b; break;
        case 'NAND': r = (a & b) ^ 1; break;
        case 'NOR': r = (a | b) ^ 1; break;
        case 'XNOR': r = (a ^ b) ^ 1; break;
        default: r = 0;
      }
      env.set(o.res, r);
    }
    return env;
  }

  GL.simulator = { MAX_TABLE_INPUTS, wordsFor, lastMask, systematicInputs, randomInputs, run, bit, equalCols, isAll, dependsOn, evalOnce };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
