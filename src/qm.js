/*
 * GateLang — Quine–McCluskey two-level minimisation (used by -O2)
 *
 * 1. Start from the minterms (rows where the output is 1).
 * 2. Repeatedly combine implicants that differ in exactly one bit
 *    (that bit becomes a don't-care). Implicants that never combine are the
 *    prime implicants.
 * 3. Choose essential primes (the only cover for some minterm), then cover the
 *    remaining minterms greedily (most new minterms first, fewest literals on ties).
 *
 * The cost grows exponentially with the number of variables, so the
 * optimizer only calls this for functions of at most 10 variables.
 */
(function (GL) {
  'use strict';

  const MAX_VARS = 10;
  const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

  /**
   * @param {number[]} minterms  row indices where f = 1 (over nvars variables)
   * @param {number} nvars
   * @returns {{constant: 0|1|null, terms: {value:number, mask:number}[]}}
   *          mask bit = 1 means "don't care" for that variable
   */
  function minimize(minterms, nvars) {
    const full = Math.pow(2, nvars);
    if (minterms.length === 0) return { constant: 0, terms: [] };
    if (minterms.length === full) return { constant: 1, terms: [] };

    let current = new Map();
    for (const m of minterms) current.set(m + ':0', { value: m, mask: 0 });
    const primes = [];
    while (current.size) {
      const next = new Map();
      const used = new Set();
      // group by mask (only implicants with the same don't-cares can combine), then by popcount
      const byMask = new Map();
      for (const [key, imp] of current) {
        if (!byMask.has(imp.mask)) byMask.set(imp.mask, []);
        byMask.get(imp.mask).push([key, imp]);
      }
      for (const group of byMask.values()) {
        const byOnes = new Map();
        for (const g of group) { const c = popcount(g[1].value); if (!byOnes.has(c)) byOnes.set(c, []); byOnes.get(c).push(g); }
        for (const [ones, list] of byOnes) {
          const nextList = byOnes.get(ones + 1);
          if (!nextList) continue;
          for (const [ka, a] of list) {
            for (const [kb, b] of nextList) {
              const diff = a.value ^ b.value;
              if (diff && (diff & (diff - 1)) === 0) {
                const imp = { value: a.value & ~diff, mask: a.mask | diff };
                next.set(imp.value + ':' + imp.mask, imp);
                used.add(ka); used.add(kb);
              }
            }
          }
        }
      }
      for (const [key, imp] of current) if (!used.has(key)) primes.push(imp);
      current = next;
    }

    const covers = (p, m) => ((m & ~p.mask) >>> 0) === p.value;
    const chosen = [];
    const uncovered = new Set(minterms);
    // essential prime implicants
    for (const m of minterms) {
      const cands = primes.filter((p) => covers(p, m));
      if (cands.length === 1 && !chosen.includes(cands[0])) chosen.push(cands[0]);
    }
    for (const p of chosen) for (const m of minterms) if (covers(p, m)) uncovered.delete(m);
    // greedy cover for the rest
    while (uncovered.size) {
      let best = null, bestGain = -1, bestLits = 99;
      for (const p of primes) {
        if (chosen.includes(p)) continue;
        let gain = 0;
        for (const m of uncovered) if (covers(p, m)) gain++;
        const lits = nvars - popcount(p.mask);
        if (gain > bestGain || (gain === bestGain && lits < bestLits)) { best = p; bestGain = gain; bestLits = lits; }
      }
      chosen.push(best);
      for (const m of [...uncovered]) if (covers(best, m)) uncovered.delete(m);
    }
    chosen.sort((a, b) => popcount(b.mask) - popcount(a.mask) || a.value - b.value);
    return { constant: null, terms: chosen, primes: primes.length };
  }

  /** Text of a term over variable names (first variable = most significant bit). */
  function termText(t, vars) {
    const n = vars.length;
    const lits = [];
    for (let i = 0; i < n; i++) {
      const bitPos = n - 1 - i;
      if ((t.mask >>> bitPos) & 1) continue;
      lits.push(((t.value >>> bitPos) & 1) ? vars[i] : vars[i] + "'");
    }
    return lits.length ? lits.join('·') : '1';
  }

  function sopText(result, vars) {
    if (result.constant !== null) return String(result.constant);
    return result.terms.map((t) => termText(t, vars)).join(' + ');
  }

  GL.qm = { minimize, termText, sopText, MAX_VARS, popcount };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
