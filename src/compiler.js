/*
 * GateLang — compiler driver
 *
 * Runs the six phases in order, times each one, and applies phase gating:
 * the lexer and parser always run to the end (to collect every error), the
 * semantic phase runs on whatever was parsed, and if any error exists after
 * Phase 3 the back end (Phases 4–6) is skipped. Warnings never block.
 */
(function (GL) {
  'use strict';

  const PHASES = [
    { id: 'lexical', name: 'Lexical analysis', short: 'Lexical' },
    { id: 'syntax', name: 'Syntax analysis', short: 'Syntax' },
    { id: 'semantic', name: 'Semantic analysis', short: 'Semantic' },
    { id: 'icg', name: 'Intermediate code', short: 'Intermediate' },
    { id: 'optimization', name: 'Optimization', short: 'Optimize' },
    { id: 'codegen', name: 'Code generation', short: 'Codegen' },
  ];
  const DISPLAY_ROWS = 65536;   // truth-table rows shown in the UI (2^16)

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  /** Normalise line endings and strip a byte-order mark. */
  function normalize(src) {
    return String(src == null ? '' : src).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  }

  function compile(source, options) {
    const opts = Object.assign({ opt: 'O1', target: 'std', filename: 'main.gate', noWarn: [], werror: false, keepComments: false }, options || {});
    const t0 = now();
    const src = normalize(source);
    const diag = new GL.diagnostics.Diagnostics({ noWarn: opts.noWarn, werror: opts.werror, maxErrors: opts.maxErrors });
    const timings = {};
    const R = { source: src, opts, timings, stoppedAt: null };
    let t;

    // Phase 1 — lexical analysis
    t = now();
    const lex = GL.lexer.tokenize(src, diag, { keepComments: opts.keepComments });
    R.tokens = lex.tokens; R.comments = lex.comments;
    timings.lexical = now() - t;

    // Phase 2 — syntax analysis
    t = now();
    R.ast = GL.parser.parse(lex.tokens, diag);
    timings.syntax = now() - t;

    // Phase 3 — semantic analysis
    t = now();
    R.sem = GL.semantic.analyze(R.ast, diag);
    timings.semantic = now() - t;

    if (diag.hasErrors()) {
      R.stoppedAt = PHASES.findIndex((p) => diag.errorsIn(p.id) > 0);
      if (R.stoppedAt < 0) R.stoppedAt = 2;
      return finish(R, diag, t0);
    }

    const st = R.sem.symtab;
    const inputs = st.names('input'), outputs = st.names('output'), wires = st.names('wire');
    R.io = { inputs, outputs, wires };

    // Phase 4 — intermediate code generation
    t = now();
    const icg = GL.icg.generate(R.sem);
    R.tac = { quads: icg.quads, temps: icg.temps, stats: GL.icg.stats(icg.quads) };
    timings.icg = now() - t;

    // Phase 5 — optimization (+ equivalence check against -O0)
    t = now();
    const S = GL.simulator;
    const n = inputs.length;
    const vectors = GL.verify.vectorsFor(n);
    const refCols = S.run(icg.quads, inputs, vectors, outputs);
    const opt = GL.optimizer.optimize(icg.quads, { level: opts.opt, inputs, outputs, fresh: icg.fresh, refCols }, diag);
    if (opts.injectFault) {
      // test hook: deliberately break the optimizer to prove the safety net works
      const g = opt.quads.find((q) => q.op !== 'COPY');
      if (g) g.op = g.op === 'AND' ? 'OR' : g.op === 'NOT' ? 'COPY' : 'AND';
      else opt.quads.find((q) => q.res === outputs[0]).op = 'NOT';
    }
    const optCols = S.run(opt.quads, inputs, vectors, outputs);
    let optOk = outputs.every((o) => S.equalCols(refCols.get(o), optCols.get(o)));
    opt.verify = { ok: optOk, mode: vectors.mode, vectors: vectors.rows };
    if (!optOk) {
      diag.add('W900', 'internal check failed: the optimized circuit differs from the original; falling back to -O0 output', null,
        { hint: 'please report the program that caused this' });
      opt.fellBack = true;
      opt.quads = icg.quads.map((q) => Object.assign({}, q));
      opt.after = GL.icg.stats(opt.quads);
    }
    analyse(R, diag, { inputs, outputs, vectors, cols: optOk ? optCols : refCols, st });
    const pct = opt.before.gates ? Math.round((1 - opt.after.gates / opt.before.gates) * 100) : 0;
    const vtext = vectors.mode === 'exhaustive'
      ? `verified over all ${vectors.rows.toLocaleString('en-US')} input combinations`
      : `checked with ${vectors.rows.toLocaleString('en-US')} random input vectors`;
    diag.add('I502', opts.opt === 'O0'
      ? `no optimization (-O0): ${opt.before.gates} gates, depth ${opt.before.depth}`
      : `${opt.before.gates} gates → ${opt.after.gates} gates (${pct > 0 ? '−' + pct : '±0'}%), depth ${opt.before.depth} → ${opt.after.depth}; ${vtext}`, null);
    R.opt = opt;
    timings.optimization = now() - t;

    // Phase 6 — code generation (+ check that the generated netlist is equivalent)
    t = now();
    const gen = GL.codegen.generate(opt.quads, { target: opts.target, inputs, outputs, wires: opts.opt === 'O0' ? wires : [], moduleName: opts.filename, optLevel: opts.opt });
    const genCols = S.run(gen.ops, inputs, vectors, outputs);
    gen.verify = { ok: outputs.every((o) => S.equalCols(refCols.get(o), genCols.get(o))), mode: vectors.mode, vectors: vectors.rows };
    if (!gen.verify.ok) diag.add('W900', 'internal check failed: the generated netlist differs from the program', null, { hint: 'please report the program that caused this' });
    if (gen.gates.length > 80) diag.add('W602', `the circuit has ${gen.gates.length} gates; the diagram is large, so use zoom or the netlist view`, null, { hint: 'raise the optimization level or split the design' });
    if (gen.stats.maxFanout > 8) {
      for (const [net, c] of gen.stats.fanout) {
        if (c <= 8) continue;
        const e = st.lookup(net);
        diag.add('W603', `'${net}' drives ${c} gates; real hardware would need a buffer`, e ? e.declaredAt : null, { hint: 'insert a wire as a buffer or restructure the logic' });
      }
    }
    if (gen.stats.depth > 10) {
      diag.add('W604', `the longest input-to-output path is ${gen.stats.depth} gates deep (propagation delay)`, null,
        { hint: 'balance the expression with parentheses, e.g. (a XOR b) XOR (c XOR d)' });
    }
    if (n > 16) {
      diag.add('W601', n <= S.MAX_TABLE_INPUTS
        ? `the truth table has ${Math.pow(2, n).toLocaleString('en-US')} rows; showing the first ${DISPLAY_ROWS.toLocaleString('en-US')} (CSV export has all rows)`
        : `the truth table is not computed for ${n} inputs (limit ${S.MAX_TABLE_INPUTS}); equivalence was checked with 4,096 random input vectors`, null,
        { hint: 'use the netlist or Verilog output, or split the circuit' });
    }
    R.gen = gen;
    R.table = vectors.mode === 'exhaustive'
      ? { inputs, outputs, n, rows: vectors.rows, displayRows: Math.min(vectors.rows, DISPLAY_ROWS), cols: genCols }
      : null;
    timings.codegen = now() - t;
    return finish(R, diag, t0);
  }

  /** Optimization-phase analysis of the final Boolean functions: W501–W504, minimal SOP. */
  function analyse(R, diag, ctx) {
    const S = GL.simulator;
    const { inputs, outputs, vectors, cols, st } = ctx;
    const n = inputs.length;
    const info = { support: {}, sop: {} };
    R.analysis = info;
    if (vectors.mode !== 'exhaustive') return;
    const constOut = new Set();
    for (const o of outputs) {
      const col = cols.get(o);
      const e = st.lookup(o);
      const sup = [];
      for (let k = 0; k < n; k++) if (S.dependsOn(col, k, n)) sup.push(inputs[k]);
      info.support[o] = sup;
      if (S.isAll(col, vectors.mask, 1)) { constOut.add(o); if (!e.literalConst) diag.add('W501', `output '${o}' is 1 for every input (tautology)`, e.assignment.span, { hint: 'check the logic; it could be replaced by 1' }); }
      else if (S.isAll(col, vectors.mask, 0)) { constOut.add(o); if (!e.literalConst) diag.add('W502', `output '${o}' is 0 for every input (contradiction)`, e.assignment.span, { hint: 'check the logic; it could be replaced by 0' }); }
      // canonical and minimal sum of products
      const rows = vectors.rows;
      const minterms = [];
      if (rows <= 4096) for (let r = 0; r < rows; r++) if (S.bit(col, r)) minterms.push(r);
      const entry = { minterms: rows <= 4096 ? minterms : null };
      if (sup.length <= 8) {   // display only; -O2 itself goes up to 10 variables
        const idx = sup.map((name) => inputs.indexOf(name));
        const m = idx.length, mins = [];
        for (let v = 0; v < (1 << m); v++) {
          let row = 0;
          for (let i = 0; i < m; i++) if ((v >>> (m - 1 - i)) & 1) row |= 1 << (n - 1 - idx[i]);
          if (S.bit(col, row)) mins.push(v);
        }
        entry.minimal = GL.qm.sopText(GL.qm.minimize(mins, m), sup);
      }
      info.sop[o] = entry;
    }
    // W504: equivalent outputs
    const groups = new Map();
    for (const o of outputs) {
      if (constOut.has(o)) continue;
      const key = Array.from(cols.get(o)).join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const list = g.length === 2 ? `'${g[0]}' and '${g[1]}'` : g.slice(0, -1).map((x) => `'${x}'`).join(', ') + ` and '${g[g.length - 1]}'`;
      diag.add('W504', `outputs ${list} compute the same function`, st.lookup(g[1]).assignment.span,
        { hint: 'keep one output, or check that they were meant to differ', related: [{ span: st.lookup(g[0]).assignment.span, label: `'${g[0]}' assigned here` }] });
    }
    // W503: inputs that are read but affect no output. Inputs that only reach
    // constant outputs are skipped: W501/W502 already explain those.
    const anySupport = new Set(Object.values(info.support).flat());
    const cone = (name, seen) => {
      const e = st.lookup(name);
      if (!e || seen.has(name)) return seen;
      seen.add(name);
      for (const d of e.deps) cone(d, seen);
      return seen;
    };
    const reachesLiveOutput = new Set();
    for (const o of outputs) if (!constOut.has(o)) for (const x of cone(o, new Set())) reachesLiveOutput.add(x);
    for (const i of inputs) {
      const e = st.lookup(i);
      if (e.readAt.length > 0 && !anySupport.has(i) && reachesLiveOutput.has(i)) {
        diag.add('W503', `input '${i}' has no effect on any output`, e.declaredAt, { hint: 'simplify the expression or remove the input', related: [{ span: e.readAt[0], label: 'used here' }] });
      }
    }
  }

  function finish(R, diag, t0) {
    R.timings.total = now() - t0;
    R.diagnostics = diag.sorted();
    R.counts = { error: diag.count('error'), warning: diag.count('warning'), info: diag.count('info') };
    R.ok = R.counts.error === 0;
    R.phases = PHASES.map((p, i) => {
      const ds = R.diagnostics.filter((d) => d.phase === p.id);
      const errors = ds.filter((d) => d.severity === 'error').length;
      const warnings = ds.filter((d) => d.severity === 'warning').length;
      // the front end (phases 1-3) always runs to collect every error;
      // the back end (phases 4-6) is skipped if any error was found
      let status = 'ok';
      if (R.stoppedAt !== null && i > 2) status = 'skipped';
      else if (errors) status = 'error';
      else if (warnings) status = 'warn';
      return Object.assign({}, p, { status, ms: R.timings[p.id] != null ? R.timings[p.id] : null, errors, warnings });
    });
    return R;
  }

  GL.compiler = { compile, normalize, PHASES, DISPLAY_ROWS };
  GL.compile = compile;
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
