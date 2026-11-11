/*
 * GateLang — Phase 5: Code Optimization
 *
 *  -O0  no optimization (baseline)
 *  -O1  machine-independent passes, repeated until nothing changes (fixpoint):
 *         copy propagation → constant folding & algebraic simplification
 *         → common-subexpression elimination (value numbering) → dead-code elimination
 *  -O2  -O1, then Quine–McCluskey two-level minimisation per output
 *       (kept only when it lowers the total gate count), then -O1 again
 *
 * Every rewrite is logged with the law used and the source line.
 * Afterwards the result is checked against the -O0 code by the equivalence
 * checker; on a mismatch the compiler falls back to -O0 (W900).
 */
(function (GL) {
  'use strict';

  const COMMUTATIVE = new Set(['AND', 'OR', 'XOR', 'NAND', 'NOR', 'XNOR']);
  const COMPLEMENT = { AND: 'NAND', NAND: 'AND', OR: 'NOR', NOR: 'OR', XOR: 'XNOR', XNOR: 'XOR' };
  const isConst = (x) => x === '0' || x === '1';
  const MAX_ITER = 20;

  function evalConst(op, a, b) {
    a = +a; b = +b;
    switch (op) {
      case 'AND': return a & b; case 'OR': return a | b; case 'XOR': return a ^ b;
      case 'NAND': return (a & b) ^ 1; case 'NOR': return (a | b) ^ 1; case 'XNOR': return (a ^ b) ^ 1;
      case 'NOT': return a ^ 1;
    }
    return 0;
  }

  /**
   * Try to simplify one quad. Returns {op, a, b, law} or null.
   * def(x) gives the quad that defines x (each name is defined exactly once).
   */
  function simplify(q, def, uses, protectedNames) {
    const { op, a, b } = q;
    const D = (x) => (isConst(x) ? null : def.get(x) || null);
    const COPY = (x, law) => ({ op: 'COPY', a: x, b: null, law });
    const NOT = (x, law) => ({ op: 'NOT', a: x, b: null, law });

    if (op === 'COPY') return null;
    if (op === 'NOT') {
      if (isConst(a)) return COPY(String(evalConst('NOT', a)), 'Constant folding');
      const da = D(a);
      if (da && da.op === 'NOT') return COPY(da.a, 'Involution (NOT NOT x = x)');
      if (da && COMPLEMENT[da.op] && uses.get(a) === 1 && !protectedNames.has(a)) {
        return { op: COMPLEMENT[da.op], a: da.a, b: da.b, law: `Negation fusing (NOT (x ${da.op} y) = x ${COMPLEMENT[da.op]} y)` };
      }
      return null;
    }
    // binary
    if (isConst(a) && isConst(b)) return COPY(String(evalConst(op, a, b)), 'Constant folding');
    if (isConst(a) || isConst(b)) {
      const k = isConst(a) ? a : b, x = isConst(a) ? b : a;
      switch (op) {
        case 'AND': return k === '1' ? COPY(x, 'Identity (x AND 1 = x)') : COPY('0', 'Annihilator (x AND 0 = 0)');
        case 'OR': return k === '0' ? COPY(x, 'Identity (x OR 0 = x)') : COPY('1', 'Annihilator (x OR 1 = 1)');
        case 'XOR': return k === '0' ? COPY(x, 'Identity (x XOR 0 = x)') : NOT(x, 'Inversion (x XOR 1 = NOT x)');
        case 'XNOR': return k === '1' ? COPY(x, 'Identity (x XNOR 1 = x)') : NOT(x, 'Inversion (x XNOR 0 = NOT x)');
        case 'NAND': return k === '0' ? COPY('1', 'Annihilator (x NAND 0 = 1)') : NOT(x, 'Inversion (x NAND 1 = NOT x)');
        case 'NOR': return k === '1' ? COPY('0', 'Annihilator (x NOR 1 = 0)') : NOT(x, 'Inversion (x NOR 0 = NOT x)');
      }
    }
    if (a === b) {
      switch (op) {
        case 'AND': return COPY(a, 'Idempotent (x AND x = x)');
        case 'OR': return COPY(a, 'Idempotent (x OR x = x)');
        case 'XOR': return COPY('0', 'Self-inverse (x XOR x = 0)');
        case 'XNOR': return COPY('1', 'Self-inverse (x XNOR x = 1)');
        case 'NAND': return NOT(a, 'Idempotent (x NAND x = NOT x)');
        case 'NOR': return NOT(a, 'Idempotent (x NOR x = NOT x)');
      }
    }
    const da = D(a), db = D(b);
    const complementary = (da && da.op === 'NOT' && da.a === b) || (db && db.op === 'NOT' && db.a === a);
    if (complementary) {
      const v = { AND: '0', OR: '1', XOR: '1', XNOR: '0', NAND: '1', NOR: '0' }[op];
      return COPY(v, `Complement (x ${op} NOT x = ${v})`);
    }
    if (op === 'OR') {
      if (db && db.op === 'AND' && (db.a === a || db.b === a)) return COPY(a, 'Absorption (x OR (x AND y) = x)');
      if (da && da.op === 'AND' && (da.a === b || da.b === b)) return COPY(b, 'Absorption (x OR (x AND y) = x)');
    }
    if (op === 'AND') {
      if (db && db.op === 'OR' && (db.a === a || db.b === a)) return COPY(a, 'Absorption (x AND (x OR y) = x)');
      if (da && da.op === 'OR' && (da.a === b || da.b === b)) return COPY(b, 'Absorption (x AND (x OR y) = x)');
    }
    return null;
  }

  function countUses(quads) {
    const uses = new Map();
    for (const q of quads) {
      for (const x of [q.a, q.b]) if (x && !isConst(x)) uses.set(x, (uses.get(x) || 0) + 1);
    }
    return uses;
  }

  /**
   * -O1: run the passes until a fixpoint is reached.
   * ctx: {outputs: string[], inputs: string[]}
   */
  function optimizeO1(quadsIn, ctx, log) {
    const T = GL.icg.quadText;
    let quads = quadsIn.map((q) => Object.assign({}, q));
    const outputs = new Set(ctx.outputs);
    let iterations = 0;
    let changed = true;

    while (changed && iterations < MAX_ITER) {
      iterations++;
      changed = false;
      const def = new Map();
      const alias = new Map();
      const vn = new Map();
      const uses = countUses(quads);
      const resolve = (x) => { let k = 0; while (x && alias.has(x) && k++ < 1000) x = alias.get(x); return x; };

      for (const q of quads) {
        // 1. copy propagation
        const ra = resolve(q.a), rb = q.b != null ? resolve(q.b) : null;
        if (ra !== q.a || rb !== q.b) { q.a = ra; q.b = rb; changed = true; }
        // 2. constant folding and algebraic laws
        const before = T(q);
        const r = simplify(q, def, uses, outputs);
        if (r) {
          q.op = r.op; q.a = r.a; q.b = r.b;
          log.push({ iter: iterations, line: q.line, law: r.law.split(' (')[0], rule: r.law, before, after: T(q) });
          changed = true;
        }
        // 3. common-subexpression elimination by value numbering
        if (q.op !== 'COPY') {
          const args = q.b != null && COMMUTATIVE.has(q.op) ? [q.a, q.b].sort() : [q.a, q.b];
          const key = q.op + '|' + args.join('|');
          if (vn.has(key)) {
            const prevName = vn.get(key);
            const b2 = T(q);
            const comm = q.b != null && COMMUTATIVE.has(q.op) && def.get(prevName) && def.get(prevName).a !== q.a;
            q.op = 'COPY'; q.a = prevName; q.b = null;
            log.push({ iter: iterations, line: q.line, law: 'CSE', rule: 'Common subexpression elimination' + (comm ? ' (operands sorted, so a AND b = b AND a)' : ''), before: b2, after: T(q) });
            changed = true;
          } else vn.set(key, q.res);
        }
        if (q.op === 'COPY' && !outputs.has(q.res)) alias.set(q.res, q.a);
        def.set(q.res, q);
      }

      // 4. dead-code elimination (liveness from the outputs, backwards)
      const live = new Set(outputs);
      for (let i = quads.length - 1; i >= 0; i--) {
        const q = quads[i];
        if (!live.has(q.res)) continue;
        if (q.a && !isConst(q.a)) live.add(q.a);
        if (q.b && !isConst(q.b)) live.add(q.b);
      }
      const kept = quads.filter((q) => live.has(q.res));
      if (kept.length !== quads.length) {
        const removed = quads.length - kept.length;
        const gatesRemoved = quads.filter((q) => !live.has(q.res) && q.op !== 'COPY').length;
        if (gatesRemoved) log.push({ iter: iterations, line: null, law: 'Dead code', rule: 'Dead-code elimination', before: `${removed} unused instruction${removed > 1 ? 's' : ''}`, after: 'removed' });
        quads = kept;
        changed = true;
      }
    }

    // 5. coalesce "out = t" when t has no other use: the gate drives the output directly
    const uses = countUses(quads);
    const defIdx = new Map(quads.map((q, i) => [q.res, i]));
    const drop = new Set();
    for (const q of quads) {
      if (q.op !== 'COPY' || !outputs.has(q.res) || isConst(q.a)) continue;
      const di = defIdx.get(q.a);
      if (di === undefined) continue;                 // copy of an input
      const d = quads[di];
      if (outputs.has(d.res) || uses.get(q.a) !== 1 || ctx.inputs.includes(q.a)) continue;
      if (log) log.push({ iter: iterations, line: q.line, law: 'Copy propagation', rule: 'Copy propagation (the gate drives the output directly)', before: `${GL.icg.quadText(d)}; ${GL.icg.quadText(q)}`, after: GL.icg.quadText(Object.assign({}, d, { res: q.res })) });
      d.res = q.res;
      drop.add(q);
    }
    quads = quads.filter((q) => !drop.has(q));
    return { quads, iterations };
  }

  /** Build TAC for a minimal sum-of-products. */
  function sopQuads(result, vars, outName, fresh, line) {
    const quads = [];
    if (result.constant !== null) { quads.push({ op: 'COPY', a: String(result.constant), b: null, res: outName, line }); return quads; }
    const n = vars.length;
    const neg = new Map();
    const lit = (i, positive) => {
      if (positive) return vars[i];
      if (!neg.has(i)) { const t = fresh(); quads.push({ op: 'NOT', a: vars[i], b: null, res: t, line }); neg.set(i, t); }
      return neg.get(i);
    };
    const termOuts = result.terms.map((t) => {
      const lits = [];
      for (let i = 0; i < n; i++) {
        const bp = n - 1 - i;
        if ((t.mask >>> bp) & 1) continue;
        lits.push(lit(i, ((t.value >>> bp) & 1) === 1));
      }
      let acc = lits[0];
      for (let k = 1; k < lits.length; k++) { const r = fresh(); quads.push({ op: 'AND', a: acc, b: lits[k], res: r, line }); acc = r; }
      return acc;
    });
    let acc = termOuts[0];
    for (let k = 1; k < termOuts.length; k++) { const r = fresh(); quads.push({ op: 'OR', a: acc, b: termOuts[k], res: r, line }); acc = r; }
    quads.push({ op: 'COPY', a: acc, b: null, res: outName, line });
    return quads;
  }

  /**
   * Entry point.
   * @param quads0  -O0 TAC
   * @param ctx {level:'O0'|'O1'|'O2', inputs, outputs, fresh, vectors, refCols (Map of -O0 output columns)}
   */
  function optimize(quads0, ctx, diag) {
    const log = [];
    const level = ctx.level || 'O1';
    const before = GL.icg.stats(quads0);
    const qmResults = {};
    if (level === 'O0') {
      return { quads: quads0.map((q) => Object.assign({}, q)), log, iterations: 0, before, after: before, qm: qmResults };
    }
    let { quads, iterations } = optimizeO1(quads0, ctx, log);

    if (level === 'O2') {
      const S = GL.simulator;
      const n = ctx.inputs.length;
      if (n <= S.MAX_TABLE_INPUTS && ctx.refCols) {
        for (const out of ctx.outputs) {
          const col = ctx.refCols.get(out);
          const support = [];
          for (let k = 0; k < n; k++) if (S.dependsOn(col, k, n)) support.push(k);
          if (support.length > GL.qm.MAX_VARS) {
            diag.add('W505', `Quine–McCluskey skipped for '${out}' (${support.length} inputs > ${GL.qm.MAX_VARS}); the -O1 result is used`, null,
              { hint: 'the -O1 result is still verified' });
            continue;
          }
          // minterms over the support variables (other inputs held at 0; f doesn't depend on them)
          const m = support.length, mins = [];
          for (let v = 0; v < (1 << m); v++) {
            let row = 0;
            for (let i = 0; i < m; i++) if ((v >>> (m - 1 - i)) & 1) row |= 1 << (n - 1 - support[i]);
            if (S.bit(col, row)) mins.push(v);
          }
          const vars = support.map((k) => ctx.inputs[k]);
          const res = GL.qm.minimize(mins, m);
          qmResults[out] = { vars, sop: GL.qm.sopText(res, vars), terms: res.terms.length };
          // candidate: replace this output's logic with its minimal SOP
          const line = (quads.find((q) => q.res === out) || {}).line || null;
          const sop = sopQuads(res, vars, out, ctx.fresh, line);
          const candidate = sop.concat(quads.filter((q) => q.res !== out));
          const scratch = [];
          const cand = optimizeO1(candidate, ctx, scratch);
          const gNow = GL.icg.stats(quads).gates, gCand = GL.icg.stats(cand.quads).gates;
          if (gCand < gNow) {
            log.push({ iter: 'O2', line, law: 'Quine–McCluskey', rule: 'Two-level minimisation', before: `${out}: ${gNow} gates in total`, after: `${out} = ${qmResults[out].sop}  (${gCand} gates in total)` });
            quads = cand.quads;
            qmResults[out].used = true;
          } else {
            log.push({ iter: 'O2', line, law: 'Quine–McCluskey', rule: 'Two-level minimisation (not used)', before: `${out} = ${qmResults[out].sop}`, after: `kept -O1 form (${gNow} ≤ ${gCand} gates)` });
          }
        }
      } else {
        diag.add('W505', `Quine–McCluskey skipped: ${n} inputs exceeds the truth-table limit of ${S.MAX_TABLE_INPUTS}`, null, { hint: 'the -O1 result is used' });
      }
    }
    return { quads, log, iterations, before, after: GL.icg.stats(quads), qm: qmResults };
  }

  GL.optimizer = { optimize, optimizeO1, simplify, sopQuads, COMMUTATIVE };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
