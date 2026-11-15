/*
 * GateLang — self-test suite (runs in the browser "Tests" tab and in Node)
 *
 *  1. Catalog tests      every diagnostic's example program triggers that code
 *  2. Example circuits   compile cleanly and verify at -O0/-O1/-O2 × 3 targets
 *  3. Robustness         edge-case inputs never crash the compiler
 *  4. Fault injection    a deliberately broken optimizer is caught (W900)
 *  5. Equivalence fuzz   random circuits: every level and target is equivalent
 *  6. Crash fuzz         randomly corrupted programs never throw
 */
(function (GL) {
  'use strict';

  function rng(seed) {
    let x = (seed >>> 0) || 1;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  }
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const LEVELS = ['O0', 'O1', 'O2'];
  const TARGETS = ['std', 'nand', 'nor'];

  function codesOf(r) { return r.diagnostics.map((d) => d.code); }

  /* 1 — catalog */
  function catalogTests() {
    const results = [];
    for (const e of GL.catalog.list()) {
      if (!e.example) continue;
      let ok = false, detail = '';
      try {
        const r = GL.compile(e.example, Object.assign({ filename: e.code + '.gate' }, e.opts || {}));
        const codes = codesOf(r);
        const errors = r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
        const has = codes.includes(e.code);
        let clean;
        if (e.code === 'E901') clean = errors.every((c) => c === 'E101' || c === 'E901');
        else if (e.code[0] === 'E') clean = errors.every((c) => c === e.code);
        else clean = errors.length === 0;
        ok = has && clean;
        detail = ok ? `${e.code} reported` : `got ${[...new Set(codes)].join(', ') || 'nothing'}`;
      } catch (err) { detail = 'threw ' + err.message; }
      results.push({ group: 'Catalog', name: `${e.code} ${e.title}`, ok, detail });
    }
    return results;
  }

  /* 2 — example circuits */
  function exampleTests() {
    const results = [];
    for (const ex of GL.examples.list.filter((x) => x.group === 'Circuits' || x.id === 'opt-demo')) {
      let ok = true, detail = '';
      try {
        for (const opt of LEVELS) for (const target of TARGETS) {
          const r = GL.compile(ex.source, { opt, target });
          if (!r.ok || !r.opt.verify.ok || !r.gen.verify.ok) { ok = false; detail = `failed at -${opt} ${target}`; break; }
        }
        if (ok) detail = 'verified at 3 levels × 3 targets';
      } catch (err) { ok = false; detail = 'threw ' + err.message; }
      results.push({ group: 'Examples', name: ex.title, ok, detail });
    }
    return results;
  }

  /* 3 — robustness */
  function robustnessTests() {
    const big = ['input a, b;', 'output y;', 'wire w0;', 'w0 = a AND b;'];
    for (let i = 1; i < 2500; i++) { big.splice(2, 0, ''); }
    const chain = ['input a, b;', 'output y;'];
    const wires = [];
    for (let i = 0; i < 3000; i++) wires.push('w' + i);
    chain.push('wire ' + wires.join(', ') + ';');
    chain.push('w0 = a XOR b;');
    for (let i = 1; i < 3000; i++) chain.push(`w${i} = w${i - 1} ${i % 2 ? 'AND' : 'OR'} ${i % 3 ? 'a' : 'b'};`);
    chain.push('y = w2999;');
    let garbage = '';
    const g = rng(7);
    for (let i = 0; i < 2000; i++) garbage += String.fromCharCode(Math.floor(g() * 256));
    const cases = [
      { name: 'Empty file', src: '', expect: 'E311' },
      { name: 'Whitespace only', src: '   \n\t\n  ', expect: 'E311' },
      { name: 'Comments only', src: '// nothing\n/* still nothing */', expect: 'E311' },
      { name: 'Windows line endings', src: 'input a;\r\noutput y;\r\ny = NOT a;\r\n', expect: null },
      { name: 'Byte-order mark', src: '\uFEFFinput a;\noutput y;\ny = NOT a;', expect: null },
      { name: 'Tabs', src: 'input\ta;\noutput\ty;\ny\t=\tNOT a;', expect: null },
      { name: '10,000 nested parentheses', src: 'input a;\noutput y;\ny = ' + '('.repeat(10000) + 'a' + ')'.repeat(10000) + ';', expect: 'E219' },
      { name: '10,000 nested NOTs', src: 'input a;\noutput y;\ny = ' + 'NOT '.repeat(10000) + 'a;', expect: 'E219' },
      { name: '1,000-character identifier', src: `input ${'x'.repeat(1000)};\noutput y;\ny = NOT ${'x'.repeat(1000)};`, expect: 'E107' },
      { name: '200 errors (capped at 50)', src: 'input a;\noutput y;\ny = NOT a;\n' + Array(200).fill('@').join(' '), expect: 'E901' },
      { name: 'Random binary garbage', src: garbage, expect: null, anyErrors: true },
      { name: 'Zero inputs', src: 'output y;\ny = 1 AND 0;', expect: 'W502', noErrors: true },
      { name: 'All outputs constant', src: 'input a;\noutput y, z;\ny = a AND NOT a;\nz = a OR NOT a;', expect: 'W501', noErrors: true },
      { name: 'Output copies an input', src: 'input a;\noutput y;\ny = a;', expect: 'W304', noErrors: true },
      { name: '3,000-wire chain', src: chain.join('\n'), expect: null, noErrors: true },
      { name: '2,500 blank lines', src: big.concat(['y = w0;']).join('\n'), expect: null, noErrors: true },
      { name: '24 inputs (random-vector verification)', src: `input ${Array.from({ length: 24 }, (_, i) => 'i' + i).join(', ')};\noutput y;\ny = ${Array.from({ length: 24 }, (_, i) => 'i' + i).join(' AND ')};`, expect: 'W601', noErrors: true },
    ];
    return cases.map((c) => {
      let ok = false, detail = '';
      try {
        const t = now();
        const r = GL.compile(c.src, {});
        const codes = codesOf(r);
        ok = true;
        if (c.expect && !codes.includes(c.expect)) ok = false;
        if (c.noErrors && r.counts.error > 0) ok = false;
        if (c.anyErrors && r.counts.error === 0) ok = false;
        if (!c.expect && !c.anyErrors && !c.noErrors && r.counts.error > 0) ok = false;
        detail = `${ok ? 'handled' : 'unexpected: ' + [...new Set(codes)].join(', ')} in ${(now() - t).toFixed(1)} ms`;
      } catch (err) { detail = 'threw ' + err.message; }
      return { group: 'Robustness', name: c.name, ok, detail };
    });
  }

  /* 4 — fault injection */
  function faultTests() {
    const r = GL.compile(GL.examples.get('full-adder').source, { injectFault: true });
    const ok = codesOf(r).includes('W900') && r.opt.fellBack && r.gen.verify.ok;
    return [{ group: 'Safety net', name: 'Broken optimizer is detected and bypassed', ok, detail: ok ? 'W900 raised, fell back to -O0, output still correct' : 'safety net failed' }];
  }

  /* random program generator */
  function randomProgram(rand) {
    const nIn = 1 + Math.floor(rand() * 6), nOut = 1 + Math.floor(rand() * 3), nWire = Math.floor(rand() * 3);
    const ins = Array.from({ length: nIn }, (_, i) => 'i' + i);
    const outs = Array.from({ length: nOut }, (_, i) => 'o' + i);
    const wires = Array.from({ length: nWire }, (_, i) => 'w' + i);
    const ops = ['AND', 'OR', 'XOR', 'NAND', 'NOR', 'XNOR'];
    const avail = ins.slice();
    const expr = (d) => {
      const p = rand();
      if (d <= 0 || p < 0.25) return rand() < 0.08 ? String(rand() < 0.5 ? 0 : 1) : avail[Math.floor(rand() * avail.length)];
      if (p < 0.4) return 'NOT ' + (rand() < 0.5 ? '(' + expr(d - 1) + ')' : expr(0));
      return '(' + expr(d - 1) + ' ' + ops[Math.floor(rand() * ops.length)] + ' ' + expr(d - 1) + ')';
    };
    const lines = [`input ${ins.join(', ')};`, `output ${outs.join(', ')};`];
    if (wires.length) lines.push(`wire ${wires.join(', ')};`);
    for (const w of wires) { lines.push(`${w} = ${expr(3)};`); avail.push(w); }
    for (const o of outs) { lines.push(`${o} = ${expr(4)};`); avail.push(o); }
    return lines.join('\n');
  }

  /* 5 — equivalence fuzz */
  function fuzzEquivalence(count, seed) {
    const rand = rng(seed || 2026);
    let pass = 0, fail = null, configs = 0;
    const t = now();
    for (let i = 0; i < count; i++) {
      const src = randomProgram(rand);
      let ok = true;
      for (const opt of LEVELS) for (const target of TARGETS) {
        configs++;
        try {
          const r = GL.compile(src, { opt, target, noWarn: [] });
          if (r.counts.error || !r.opt.verify.ok || !r.gen.verify.ok) { ok = false; }
        } catch (e) { ok = false; }
        if (!ok) break;
      }
      if (!ok) { if (!fail) fail = src; continue; }
      pass++;
    }
    return [{ group: 'Fuzzing', name: `Equivalence: ${count.toLocaleString('en-US')} random circuits × 9 configurations`, ok: pass === count,
      detail: `${pass}/${count} equivalent (${configs.toLocaleString('en-US')} compilations, ${((now() - t) / 1000).toFixed(1)} s)`, failure: fail }];
  }

  /* 6 — crash fuzz */
  function fuzzCrash(count, seed) {
    const rand = rng(seed || 99);
    const bases = GL.examples.list.map((e) => e.source);
    const junk = ['(', ')', ';', ',', '=', '==', 'AND', 'NOT', '@', '2', '1a', 'input', 'output', 'wire', '/*', '&&', '∧', ' ', '\n', 'x'];
    let pass = 0, fail = null;
    const t = now();
    for (let i = 0; i < count; i++) {
      let s = bases[Math.floor(rand() * bases.length)];
      const edits = 1 + Math.floor(rand() * 4);
      for (let k = 0; k < edits; k++) {
        const pos = Math.floor(rand() * (s.length + 1));
        const r = rand();
        if (r < 0.4) s = s.slice(0, pos) + s.slice(pos + 1 + Math.floor(rand() * 4));
        else if (r < 0.8) s = s.slice(0, pos) + junk[Math.floor(rand() * junk.length)] + s.slice(pos);
        else { const q = Math.floor(rand() * s.length); s = s.slice(0, Math.min(pos, q)) + s.slice(Math.max(pos, q)) + s.slice(Math.min(pos, q), Math.max(pos, q)); }
      }
      try { const r = GL.compile(s, { opt: LEVELS[i % 3], target: TARGETS[i % 3] }); if (r && r.diagnostics) pass++; }
      catch (e) { if (!fail) fail = { src: s, error: e.message }; }
    }
    return [{ group: 'Fuzzing', name: `Crash: ${count.toLocaleString('en-US')} randomly corrupted programs`, ok: pass === count,
      detail: `${pass}/${count} handled without crashing (${((now() - t) / 1000).toFixed(1)} s)`, failure: fail }];
  }

  function runAll(opts) {
    opts = opts || {};
    const t = now();
    const results = [].concat(
      catalogTests(), exampleTests(), robustnessTests(), faultTests(),
      fuzzEquivalence(opts.fuzz || 300, opts.seed), fuzzCrash(opts.crash || 1000, opts.seed));
    return { results, passed: results.filter((r) => r.ok).length, total: results.length, ms: now() - t };
  }

  GL.selftest = { runAll, catalogTests, exampleTests, robustnessTests, faultTests, fuzzEquivalence, fuzzCrash, randomProgram, rng };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
