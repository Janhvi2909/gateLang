/*
 * GateLang — equivalence checker
 *
 * Proves that an optimized (or generated) circuit computes exactly the same
 * outputs as the unoptimized program. Up to 20 inputs the check is exhaustive
 * over all 2ⁿ rows (bit-parallel); above that it uses 4,096 random vectors.
 */
(function (GL) {
  'use strict';

  function vectorsFor(n) {
    const S = GL.simulator;
    return n <= S.MAX_TABLE_INPUTS ? S.systematicInputs(n) : S.randomInputs(n, 128, 12345);
  }

  /**
   * @param {object[]} refOps   reference operations (the -O0 code)
   * @param {object[]} newOps   operations to check
   * @param {string[]} inputs
   * @param {string[]} outputs
   * @param {object} [vectors]  reuse precomputed input vectors
   */
  function equivalent(refOps, newOps, inputs, outputs, vectors) {
    const S = GL.simulator;
    const v = vectors || vectorsFor(inputs.length);
    const a = S.run(refOps, inputs, v, outputs);
    const b = S.run(newOps, inputs, v, outputs);
    for (const o of outputs) {
      if (!S.equalCols(a.get(o), b.get(o))) return { ok: false, mismatch: o, mode: v.mode, vectors: v.rows };
    }
    return { ok: true, mode: v.mode, vectors: v.rows };
  }

  GL.verify = { equivalent, vectorsFor };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
