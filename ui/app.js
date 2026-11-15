/*
 * GateLang UI — application
 * Wires the editor, the six phase panels, diagnostics, the error catalog,
 * the test runner and the interactive simulator to the compiler in src/.
 */
(function (GL) {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtMs = (ms) => (ms == null ? '' : ms < 1 ? ms.toFixed(2) + ' ms' : ms < 10 ? ms.toFixed(1) + ' ms' : Math.round(ms) + ' ms');
  const plural = (n, w) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const PHASE_INFO = {
    lexical: { num: 1, title: 'Lexical analysis', lede: 'The lexer reads the source once, left to right, and groups characters into tokens. Whitespace and comments are dropped, and every token keeps its line and column for error messages.' },
    syntax: { num: 2, title: 'Syntax analysis', lede: 'A recursive-descent parser checks the tokens against the grammar and builds a syntax tree. NOT binds tightest, then AND/NAND, then XOR/XNOR, then OR/NOR.' },
    semantic: { num: 3, title: 'Semantic analysis', lede: 'Checks that the program makes sense as a circuit: every name declared, one driver per signal, no loops. Builds the symbol table and the order in which signals are evaluated.' },
    icg: { num: 4, title: 'Intermediate code', lede: 'Each assignment becomes three-address code with one operator per instruction, so one instruction is one gate. Instructions are stored as quadruples (op, arg1, arg2, result).' },
    optimization: { num: 5, title: 'Optimization', lede: 'Rewrites the three-address code with Boolean algebra, removes duplicate and dead logic, and then proves that the result behaves exactly like the original.' },
    codegen: { num: 6, title: 'Code generation', lede: 'Maps the optimized code onto the chosen gate library, then produces the circuit, truth table, netlist and Verilog.' },
    catalog: { title: 'Error catalog', lede: 'Every error, warning and note the compiler can report. Each entry has an example program; load it to see the diagnostic in context.' },
    tests: { title: 'Test suite', lede: 'Runs the compiler against every catalog example, the example circuits, edge cases, a deliberately broken optimizer, and hundreds of random and corrupted programs.' },
  };
  const PHASE_IDS = ['lexical', 'syntax', 'semantic', 'icg', 'optimization', 'codegen'];
  const GRAMMAR = `program      ::= { statement } EOF
statement    ::= declaration | assignment
declaration  ::= ( "input" | "output" | "wire" ) id_list ";"
id_list      ::= IDENT { "," IDENT }
assignment   ::= IDENT "=" expr ";"
expr         ::= or_expr
or_expr      ::= xor_expr { ( OR | NOR | "|" ) xor_expr }
xor_expr     ::= and_expr { ( XOR | XNOR | "^" ) and_expr }
and_expr     ::= unary { ( AND | NAND | "&" ) unary }
unary        ::= ( NOT | "!" | "~" ) unary | primary
primary      ::= IDENT | CONST | "(" expr ")"`;

  const state = {
    opt: 'O1', target: 'std', auto: true, tab: 'lexical', outTab: 'circuit', treeMode: 'ast', treeStmt: 'all',
    treeZoom: 1, circuitZoom: 'fit', filter: { error: true, warning: true, info: true }, filename: 'main.gate',
    result: null, sim: new Map(), reveal: null, catalogQuery: '', catalogPhase: 'all', testRun: null, userPickedTab: false,
  };
  let editor, circuitCtl = null, tableCtl = null, timer = 0, stepTimer = 0;

  /* ───────────────────────── compile ───────────────────────── */
  function compile(animate) {
    clearInterval(stepTimer); state.reveal = null;
    const r = GL.compile(editor.value, { opt: state.opt, target: state.target, filename: state.filename });
    state.result = r;
    if (r.io) {
      const next = new Map();
      for (const i of r.io.inputs) next.set(i, state.sim.get(i) || 0);
      state.sim = next;
    }
    editor.setDiagnostics(r.diagnostics);
    // follow the failure: if compilation stopped, show the failing phase
    if (r.stoppedAt != null && PHASE_IDS.includes(state.tab) && PHASE_IDS.indexOf(state.tab) > 2 && !state.userPickedTab) {
      state.tab = PHASE_IDS[r.stoppedAt];
    }
    renderPipeline(animate);
    renderSummary();
    renderDiagnostics();
    renderPanel();
  }
  function scheduleCompile() {
    if (!state.auto) return;
    clearTimeout(timer);
    timer = setTimeout(() => compile(false), 260);
  }

  /* ───────────────────────── pipeline & summary ───────────────────────── */
  function renderPipeline(animate) {
    const r = state.result;
    const trace = $('#trace');
    r.phases.forEach((p, i) => {
      const pad = $(`.pad[data-tab="${p.id}"]`);
      pad.className = 'pad ' + p.status;
      pad.setAttribute('aria-current', state.tab === p.id ? 'true' : 'false');
      const meta = p.status === 'skipped' ? 'skipped' : p.status === 'error' ? plural(p.errors || 0, 'error') : fmtMs(p.ms);
      $('.meta', pad).textContent = meta;
      pad.title = `${p.name}: ${p.status === 'skipped' ? 'did not run' : p.status === 'error' ? plural(p.errors, 'error') : 'completed in ' + fmtMs(p.ms)}${p.warnings ? ', ' + plural(p.warnings, 'warning') : ''}`;
    });
    const reach = r.stoppedAt == null ? 5 : 2;
    const cur = $('.current', trace);
    cur.classList.toggle('fail', r.stoppedAt != null);
    const target = `scaleX(${reach / 5})`;
    if (animate && !reduceMotion) {
      cur.style.transition = 'none';
      cur.style.transform = 'scaleX(0)';
      void cur.offsetWidth;
      cur.style.transition = '';
    }
    cur.style.transform = target;
    $$('.side-tabs button').forEach((b) => b.setAttribute('aria-current', state.tab === b.dataset.tab ? 'true' : 'false'));
  }

  function renderSummary() {
    const r = state.result;
    const el = $('#summary');
    if (!r.ok && r.stoppedAt != null) {
      const by = r.phases.slice(0, 3).filter((p) => p.errors).map((p) => `${p.errors} ${p.short.toLowerCase()}`).join(', ');
      el.innerHTML = `<span class="verdict bad">Code generation skipped</span>` +
        `<span><b>${r.counts.error}</b> ${r.counts.error === 1 ? 'error' : 'errors'}${by ? ` (${esc(by)})` : ''}</span>` +
        `<span><b>${r.counts.warning}</b> ${r.counts.warning === 1 ? 'warning' : 'warnings'}</span>` +
        `<span>Fix the first error, and the rest of the pipeline runs again automatically.</span>`;
      return;
    }
    const g = r.gen.stats, o = r.opt;
    const verified = o.verify.ok && r.gen.verify.ok;
    const how = o.verify.mode === 'exhaustive' ? `all ${o.verify.vectors.toLocaleString('en-US')} input combinations` : `${o.verify.vectors.toLocaleString('en-US')} random vectors`;
    el.innerHTML = `<span class="verdict ${verified ? 'ok' : 'bad'}">${verified ? 'Compiled and verified' : 'Verification failed'}</span>` +
      `<span>in <b>${fmtMs(r.timings.total)}</b></span>` +
      `<span><b>${g.gates}</b> ${GL.codegen.TARGETS[state.target].short} gates</span>` +
      `<span>depth <b>${g.depth}</b></span>` +
      `<span><b>${o.before.gates}</b> gates before optimization</span>` +
      `<span title="Exhaustive equivalence check between the -O0 code, the optimized code and the generated netlist">checked on ${how}</span>` +
      (r.counts.warning ? `<span><b>${r.counts.warning}</b> ${r.counts.warning === 1 ? 'warning' : 'warnings'}</span>` : '');
  }

  /* ───────────────────────── diagnostics ───────────────────────── */
  function renderDiagnostics() {
    const r = state.result;
    const counts = r.counts;
    $('#filters').innerHTML = ['error', 'warning', 'info'].map((s) =>
      `<button class="chip" data-sev="${s}" aria-pressed="${state.filter[s]}"><span class="dot ${s}"></span>${counts[s]} ${s === 'info' ? (counts[s] === 1 ? 'note' : 'notes') : s + (counts[s] === 1 ? '' : 's')}</button>`).join('');
    const list = r.diagnostics.filter((d) => state.filter[d.severity]);
    if (!r.diagnostics.length || (!list.length && !counts.error && !counts.warning)) {
      $('#diags').innerHTML = `<div class="empty-note"><b>No problems found.</b> Try the error demo from the Example menu, or break something on purpose.</div>`;
      return;
    }
    if (!list.length) { $('#diags').innerHTML = `<div class="empty-note">All diagnostics are hidden by the filters above.</div>`; return; }
    $('#diags').innerHTML = list.map((d, i) => `
      <div class="diag ${d.severity}" data-i="${r.diagnostics.indexOf(d)}" role="button" tabindex="0">
        <span class="dot ${d.severity}" aria-label="${d.severity}"></span>
        <button class="code-link" data-code="${d.code}" title="Open ${d.code} in the error catalog">${d.code}</button>
        <div><div class="msg">${esc(d.message)}</div>${d.hint ? `<div class="hint">${esc(d.hint)}</div>` : ''}</div>
        <div><span class="loc">${d.line ? `line ${d.line}, col ${d.col}` : ''}</span><span class="phase">${esc(GL.catalog.PHASES[d.phase] || '')}</span></div>
      </div>`).join('');
  }

  /* ───────────────────────── panels ───────────────────────── */
  function panelHead(tab, statsHtml) {
    const info = PHASE_INFO[tab];
    return `<header class="panel-head"><h2>${info.num ? `<span class="num">Phase ${info.num}</span>` : ''}${esc(info.title)}</h2><p>${esc(info.lede)}</p>${statsHtml ? `<div class="stats">${statsHtml}</div>` : ''}</header>`;
  }
  const stat = (v, label) => `<span><b>${v}</b>${esc(label)}</span>`;

  function skipped(tab) {
    const r = state.result;
    return `<div class="skipped-msg"><strong>This phase did not run.</strong> The front end (phases 1 to 3) found ${plural(r.counts.error, 'error')}, so the back end was skipped, just as a real compiler stops before generating code from an invalid program. The front end always runs to the end, so every error is reported in one go.
      <div style="margin-top:12px"><button class="btn small" data-goto="${PHASE_IDS[r.stoppedAt]}">Open phase ${r.stoppedAt + 1}, where the first error is</button></div></div>`;
  }

  function renderPanel() {
    const box = $('#panel');
    circuitCtl = null; tableCtl = null;
    const fn = { lexical: panelLexical, syntax: panelSyntax, semantic: panelSemantic, icg: panelICG, optimization: panelOpt, codegen: panelCodegen, catalog: panelCatalog, tests: panelTests }[state.tab];
    fn(box);
    $$('.pad').forEach((p) => p.setAttribute('aria-current', state.tab === p.dataset.tab ? 'true' : 'false'));
    $$('.side-tabs button').forEach((b) => b.setAttribute('aria-current', state.tab === b.dataset.tab ? 'true' : 'false'));
  }

  /* Phase 1 */
  function panelLexical(box) {
    const r = state.result;
    const toks = r.tokens.filter((t) => t.type !== 'EOF');
    const cats = {};
    for (const t of toks) { const c = GL.tokens.category(t.type); cats[c] = (cats[c] || 0) + 1; }
    const errs = r.phases[0].errors;
    const stats = stat(toks.length, 'tokens') + ['keyword', 'identifier', 'operator', 'constant', 'punctuation', 'error'].filter((c) => cats[c]).map((c) => stat(cats[c], c === 'punctuation' ? ' punctuation' : c === 'error' ? (cats[c] === 1 ? 'malformed token' : 'malformed tokens') : c + (cats[c] === 1 ? '' : 's'))).join('') +
      stat(fmtMs(r.timings.lexical), '') + (errs ? stat(errs, errs === 1 ? 'lexical error' : 'lexical errors') : '');
    const LIMIT = 3000;
    const rows = toks.slice(0, LIMIT).map((t, i) => {
      const c = GL.tokens.category(t.type);
      return `<tr class="clickable" data-line="${t.line}" data-col="${t.col}" data-end="${t.endCol}"><td class="num">${i + 1}</td><td><code>${t.type}</code></td><td><code>${esc(t.lexeme)}</code></td><td class="mono">${t.line}:${t.col}</td><td><span class="tag ${c}">${c}</span></td></tr>`;
    }).join('');
    box.innerHTML = `<div class="panel">${panelHead('lexical', stats)}<div class="panel-body">
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Token</th><th>Lexeme</th><th>Line:Col</th><th>Category</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${toks.length > LIMIT ? `<p class="note">Showing the first ${LIMIT.toLocaleString('en-US')} of ${toks.length.toLocaleString('en-US')} tokens.</p>` : ''}
      <p class="note">Click a row to highlight the token in the editor. Keywords are case-insensitive; names are case-sensitive.</p></div></div>`;
  }

  /* Phase 2 */
  function panelSyntax(box) {
    const r = state.result;
    const prog = r.ast;
    const good = prog.statements.filter((s) => !s.broken && !s.poisoned);
    const full = state.treeMode === 'ast' ? GL.ast.astView(prog) : GL.ast.parseTreeView(prog);
    const stmtOptions = good.map((s, i) => {
      const label = s.kind === 'Declaration' ? `${s.declKind} ${s.names.map((n) => n.name).join(', ')}` : `${s.target.name} = ${GL.ast.exprToString(s.expr)}`;
      return `<option value="${i}"${String(i) === state.treeStmt ? ' selected' : ''}>Line ${s.span.line}: ${esc(label.length > 46 ? label.slice(0, 45) + '…' : label)}</option>`;
    }).join('');
    let tree = full;
    const totalNodes = GL.ast.countNodes(full);
    if (state.treeStmt !== 'all' && full.children[+state.treeStmt]) {
      tree = { label: full.label, kind: full.kind, children: [full.children[+state.treeStmt]] };
    } else if (totalNodes > 1800 && full.children.length) {
      state.treeStmt = String(full.children.length - (state.treeMode === 'ast' ? 1 : 2));
      tree = { label: full.label, kind: full.kind, children: [full.children[Math.max(0, +state.treeStmt)]] };
    }
    const depth = (n) => 1 + Math.max(0, ...n.children.map(depth));
    const errs = r.phases[1].errors;
    const stats = stat(good.length, 'statements parsed') + stat(GL.ast.countNodes(GL.ast.astView(prog)), 'AST nodes') + stat(GL.ast.countNodes(GL.ast.parseTreeView(prog)), 'parse-tree nodes') +
      stat(depth(GL.ast.astView(prog)), 'tree depth') + stat(fmtMs(r.timings.syntax), '') + (errs ? stat(errs, errs === 1 ? 'syntax error' : 'syntax errors') : '');
    box.innerHTML = `<div class="panel">${panelHead('syntax', stats)}<div class="panel-body">
      <div class="toolbar">
        <div class="seg" role="group" aria-label="Tree view"><button data-tree="ast" aria-pressed="${state.treeMode === 'ast'}">Syntax tree (AST)</button><button data-tree="parse" aria-pressed="${state.treeMode === 'parse'}">Parse tree</button></div>
        <select class="select" id="tree-stmt" aria-label="Statement"><option value="all">All statements</option>${stmtOptions}</select>
        <span class="grow"></span>
        <button class="btn small" data-zoom="tree:-1" aria-label="Zoom out">−</button><button class="btn small" data-zoom="tree:0">${Math.round(state.treeZoom * 100)}%</button><button class="btn small" data-zoom="tree:1" aria-label="Zoom in">+</button>
      </div>
      <div class="canvas tree-canvas" id="tree"></div>
      <p class="note">${state.treeMode === 'ast' ? 'The AST keeps only what matters for meaning: operators and their operands.' : 'The parse tree shows every grammar rule used, including the chain or_expr → xor_expr → and_expr → unary → primary that encodes precedence.'} Click a node to find it in the source.${errs ? ' Statements with syntax errors are left out.' : ''}</p>
      <details><summary class="note" style="cursor:pointer">Grammar (EBNF, LL(1))</summary><pre class="codeblock" style="margin-top:8px">${esc(GRAMMAR)}</pre></details>
    </div></div>`;
    GL.ui.renderTree($('#tree'), tree, state.treeZoom);
  }

  /* Phase 3 */
  function panelSemantic(box) {
    const r = state.result;
    const sem = r.sem, st = sem.symtab;
    const ent = st.all();
    const kinds = { input: 0, output: 0, wire: 0 };
    ent.forEach((e) => kinds[e.kind]++);
    const errs = r.phases[2].errors;
    const stats = stat(kinds.input, 'inputs') + stat(kinds.output, 'outputs') + stat(kinds.wire, 'wires') + stat(sem.checks.filter((c) => c.ok).length + '/' + sem.checks.length, 'checks passed') + stat(fmtMs(r.timings.semantic), '') + (errs ? stat(errs, errs === 1 ? 'semantic error' : 'semantic errors') : '');
    const checks = sem.checks.map((c) => `<div><span class="${c.ok ? 'yes' : 'no'}">${c.ok ? '✓' : '✗'}</span>${esc(c.name)}</div>`).join('');
    const rows = ent.map((e) => `<tr class="clickable" data-line="${e.declaredAt.line}" data-col="${e.declaredAt.col}" data-end="${e.declaredAt.endCol}">
      <td><code>${esc(e.name)}</code></td><td><span class="tag ${e.kind}">${e.kind}</span></td><td class="mono">${e.declaredAt.line}:${e.declaredAt.col}</td>
      <td class="mono">${e.kind === 'input' ? '–' : e.drivenAt.map((s) => s.line).join(', ') || '<span style="color:var(--err)">never</span>'}</td>
      <td class="mono">${e.readAt.length || '–'}</td><td class="mono">${e.deps.size ? esc([...e.deps].join(', ')) : '–'}</td><td class="mono">${e.level == null ? '–' : e.level}</td></tr>`).join('');
    const order = sem.order.length && !sem.cycles.length
      ? sem.order.map((n, i) => `<span class="tag ${st.lookup(n).kind}">${i + 1}. ${esc(n)}</span>`).join(' ')
      : `<span class="note">${sem.cycles.length ? 'No valid order: the dependency graph has a loop.' : 'Nothing to evaluate.'}</span>`;
    box.innerHTML = `<div class="panel">${panelHead('semantic', stats)}<div class="panel-body">
      <h3>Checks</h3><div class="checks">${checks}</div>
      <h3>Symbol table</h3>
      <div class="tbl-wrap" style="max-height:260px"><table class="tbl"><thead><tr><th>Name</th><th>Kind</th><th>Declared</th><th>Assigned on line</th><th>Times read</th><th>Depends on</th><th>Level</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="note">No symbols declared.</td></tr>'}</tbody></table></div>
      <h3>Dependency graph</h3>
      <div class="canvas graph-canvas" id="graph"></div>
      <p class="note">Edges point from a signal to the signals that read it. A depth-first search on this graph finds combinational loops; Kahn's topological sort gives the evaluation order below. Hover a node to highlight its connections.</p>
      <h3>Evaluation order (topological sort)</h3><div class="histo">${order}</div>
    </div></div>`;
    if (ent.length) GL.ui.renderGraph($('#graph'), st); else $('#graph').innerHTML = '<p class="note" style="padding:12px">Nothing to draw yet.</p>';
  }

  function listing(quads, opts) {
    opts = opts || {};
    const fmt = (q) => {
      const v = (x) => (x === '0' || x === '1' ? `<span class="k">${x}</span>` : esc(x));
      if (q.op === 'COPY') return `${esc(q.res)} = ${v(q.a)}`;
      if (q.op === 'NOT') return `${esc(q.res)} = <span class="op">NOT</span> ${v(q.a)}`;
      return `${esc(q.res)} = ${v(q.a)} <span class="op">${q.op}</span> ${v(q.b)}`;
    };
    return `<div class="listing">${quads.map((q, i) => { const st = opts.status ? opts.status(q) : 'kept'; return `<div class="ln ${st}"${st === 'gone' ? ' title="removed by the optimizer"' : st === 'changed' ? ' title="rewritten by the optimizer"' : ''}><span class="n">${i + 1}</span><span class="t">${fmt(q)}</span><span class="src">${q.line ? 'line ' + q.line : ''}</span></div>`; }).join('')}</div>`;
  }

  /* Phase 4 */
  function panelICG(box) {
    const r = state.result;
    if (r.stoppedAt != null) { box.innerHTML = `<div class="panel">${panelHead('icg')}<div class="panel-body">${skipped('icg')}</div></div>`; return; }
    const q = r.tac.quads, s = r.tac.stats;
    const stats = stat(q.length, 'instructions') + stat(s.gates, 'gates') + stat(r.tac.temps, 'temporaries') + stat(s.depth, 'logic depth') + stat(fmtMs(r.timings.icg), '');
    const hist = Object.entries(s.byType).map(([k, v]) => `<span class="tag operator">${k} × ${v}</span>`).join('');
    const quadRows = q.map((x, i) => `<tr><td class="num">${i + 1}</td><td><code>${x.op}</code></td><td><code>${esc(x.a)}</code></td><td><code>${x.b == null ? '–' : esc(x.b)}</code></td><td><code>${esc(x.res)}</code></td></tr>`).join('');
    box.innerHTML = `<div class="panel">${panelHead('icg', stats)}<div class="panel-body">
      <div class="histo">${hist}<span class="tag">COPY × ${q.filter((x) => x.op === 'COPY').length} (wires, no gate)</span></div>
      <div class="two stack-md">
        <div><h3>Three-address code</h3>${listing(q)}</div>
        <div><h3>Quadruples</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>op</th><th>arg1</th><th>arg2</th><th>result</th></tr></thead><tbody>${quadRows}</tbody></table></div></div>
      </div>
      <p class="note">Generated by a post-order walk of each expression tree, in the evaluation order from phase 3. Temporaries t1, t2 … never clash with your signal names.</p>
    </div></div>`;
  }

  /* Phase 5 */
  function panelOpt(box) {
    const r = state.result;
    if (r.stoppedAt != null) { box.innerHTML = `<div class="panel">${panelHead('optimization')}<div class="panel-body">${skipped('optimization')}</div></div>`; return; }
    const o = r.opt, b = o.before, a = o.after;
    const pct = b.gates ? Math.round((1 - a.gates / b.gates) * 100) : 0;
    const stats = stat('-' + state.opt, 'level') + stat(`${b.gates} → ${a.gates}`, 'gates') + stat(`${pct}%`, 'fewer gates') + stat(`${b.depth} → ${a.depth}`, 'depth') + stat(o.iterations, o.iterations === 1 ? 'pass' : 'passes to fixpoint') + stat(fmtMs(r.timings.optimization), '');
    const bar = (label, x, y, unit) => {
      const m = Math.max(x, y, 1);
      return `<div class="label">${label}</div><div class="bars"><div class="bar" style="width:${(x / m) * 100}%"></div><div class="bar after" style="width:${(y / m) * 100}%"></div></div><div class="val">${x} <small>→</small> ${y}${unit || ''}</div>`;
    };
    const v = o.verify;
    const vtxt = v.ok
      ? `✓ Equivalent to the unoptimized program on ${v.mode === 'exhaustive' ? 'all ' + v.vectors.toLocaleString('en-US') + ' input combinations (bit-parallel, exhaustive)' : v.vectors.toLocaleString('en-US') + ' random input vectors'}`
      : '✗ The optimizer produced a different circuit, so the compiler fell back to -O0 (W900)';
    // match instructions by identity (id from phase 4), not by text
    const afterById = new Map(o.quads.filter((x) => x.id != null).map((x) => [x.id, x]));
    const statusBefore = (q) => { const x = afterById.get(q.id); return !x ? 'gone' : GL.icg.quadText(x) === GL.icg.quadText(q) ? 'kept' : 'changed'; };
    const beforeIds = new Set(r.tac.quads.map((q) => q.id));
    const statusAfter = (q) => (q.id == null || !beforeIds.has(q.id) ? 'new' : GL.icg.quadText(q) === GL.icg.quadText(r.tac.quads.find((b) => b.id === q.id)) ? 'kept' : 'changed');
    const removed = r.tac.quads.filter((q) => statusBefore(q) === 'gone').length, changedN = r.tac.quads.filter((q) => statusBefore(q) === 'changed').length;
    const logRows = o.log.map((l) => `<tr><td class="num">${l.iter}</td><td class="mono">${l.line || '–'}</td><td><span class="tag operator" title="${esc(l.rule)}">${esc(l.law)}</span></td><td><code>${esc(l.before)}</code></td><td><code>${esc(l.after)}</code></td></tr>`).join('');
    const qm = Object.entries(o.qm || {});
    box.innerHTML = `<div class="panel">${panelHead('optimization', stats)}<div class="panel-body">
      <div class="toolbar">Level <div class="seg" role="group" aria-label="Optimization level">${['O0', 'O1', 'O2'].map((l) => `<button data-set-opt="${l}" aria-pressed="${state.opt === l}">-${l}</button>`).join('')}</div>
        <span class="note">-O1: algebraic laws, CSE, copy propagation, dead code. -O2 adds Quine–McCluskey.</span></div>
      <div class="verified ${v.ok ? '' : 'bad'}">${vtxt}</div>
      <div class="compare">${bar('Gates', b.gates, a.gates)}${bar('Logic depth', b.depth, a.depth)}${bar('Instructions', b.instructions, a.instructions)}${bar('Transistors', b.transistors, a.transistors)}</div>
      <div class="legend"><span><i style="background:var(--trace-hi)"></i>before (-O0)</span><span><i style="background:var(--copper)"></i>after (-${state.opt})</span><span>Transistor estimate for static CMOS.</span></div>
      ${state.opt === 'O0' ? `<p class="skipped-msg" style="margin-top:14px">-O0 turns the optimizer off, which gives the baseline. Switch to -O1 or -O2 to watch the rewrites.</p>` : ''}
      <div class="two stack-md" style="margin-top:14px">
        <div><h3>Before: ${r.tac.quads.length} instructions</h3>${listing(r.tac.quads, { status: statusBefore })}</div>
        <div><h3>After: ${o.quads.length} instructions</h3>${listing(o.quads, { status: statusAfter })}</div>
      </div>
      <div class="legend" style="margin-top:8px"><span><s style="color:var(--ink-3)">struck</s> removed (${removed})</span><span><span style="color:var(--warn)">amber</span> rewritten (${changedN})</span><span><span style="color:var(--ok)">green</span> new, from -O2</span>
      </div>
      <h3>Rewrite log (${o.log.length} ${o.log.length === 1 ? 'step' : 'steps'})</h3>
      ${o.log.length ? `<div class="tbl-wrap" style="max-height:300px"><table class="tbl"><thead><tr><th>Pass</th><th>Line</th><th>Law</th><th>Before</th><th>After</th></tr></thead><tbody>${logRows}</tbody></table></div>` : '<p class="note">Nothing to rewrite: the code was already as simple as these rules can make it.</p>'}
      ${qm.length ? `<h3>Quine–McCluskey (two-level minimisation)</h3><div class="sop">${qm.map(([k, x]) => `<div><span class="k">${esc(k)}</span><code>${esc(x.sop)}${x.used ? '  (used)' : '  (kept -O1 form)'}</code></div>`).join('')}</div>` : ''}
    </div></div>`;
  }

  /* Phase 6 */
  function panelCodegen(box) {
    const r = state.result;
    if (r.stoppedAt != null) { box.innerHTML = `<div class="panel">${panelHead('codegen')}<div class="panel-body">${skipped('codegen')}</div></div>`; return; }
    const g = r.gen, s = g.stats;
    const stats = stat(GL.codegen.TARGETS[state.target].name, '') + stat(s.gates, 'gates') + (state.target !== 'std' ? stat(`${s.mapped} → ${s.gates}`, 'after peephole') : '') +
      stat(s.depth, 'depth') + stat(s.transistors, 'transistors') + stat(s.maxFanout, 'max fan-out') + stat(fmtMs(r.timings.codegen), '');
    const sub = ['circuit', 'table', 'netlist', 'verilog'];
    const names = { circuit: 'Circuit and simulator', table: 'Truth table', netlist: 'Netlist', verilog: 'Verilog' };
    box.innerHTML = `<div class="panel">${panelHead('codegen', stats)}<div class="panel-body">
      <div class="toolbar">Target <div class="seg" role="group" aria-label="Target gate library">${Object.entries(GL.codegen.TARGETS).map(([k, t]) => `<button data-set-target="${k}" aria-pressed="${state.target === k}">${t.short}</button>`).join('')}</div>
        <span class="note">${g.verify.ok ? '✓ Netlist verified against the source program' : '✗ Netlist verification failed'}</span></div>
      <div class="subtabs" role="tablist">${sub.map((k) => `<button data-out="${k}" aria-pressed="${state.outTab === k}">${names[k]}</button>`).join('')}</div>
      <div id="out-body"></div></div></div>`;
    renderOut();
  }

  function rowOfSim() {
    const ins = state.result.io.inputs, n = ins.length;
    let row = 0;
    ins.forEach((x, k) => { if (state.sim.get(x)) row |= 1 << (n - 1 - k); });
    return row;
  }
  function simulate() {
    const r = state.result;
    if (!circuitCtl && !tableCtl) return;
    const env = GL.simulator.evalOnce(r.gen.ops, Object.fromEntries(state.sim));
    if (circuitCtl) circuitCtl.setValues(env, state.reveal);
    if (tableCtl && r.io.inputs.length <= 16) tableCtl.select(rowOfSim(), true);
    const rd = $('#sim-readout');
    if (rd) rd.innerHTML = `Inputs <code>${r.io.inputs.map((i) => `${esc(i)}=${state.sim.get(i) || 0}`).join(' ') || '(none)'}</code>  outputs <code>${r.io.outputs.map((o) => `${esc(o)}=${env.get(o) ?? env.get(r.gen.pins[o]) ?? (r.gen.pins[o] === '1' ? 1 : 0)}`).join(' ')}</code>`;
  }

  function renderOut() {
    const r = state.result, g = r.gen;
    const host = $('#out-body');
    if (state.outTab === 'circuit') {
      host.innerHTML = `<div class="toolbar">
          <button class="btn small" data-sim="zero">All inputs 0</button><button class="btn small" data-sim="one">All inputs 1</button>
          <button class="btn small" data-sim="step">Step through levels</button>
          <span class="grow"></span>
          <button class="btn small" data-zoom="circuit:-1" aria-label="Zoom out">−</button><button class="btn small" data-zoom="circuit:0">${state.circuitZoom === 'fit' ? 'Fit' : Math.round(state.circuitZoom * 100) + '%'}</button><button class="btn small" data-zoom="circuit:1" aria-label="Zoom in">+</button>
        </div>
        <div class="canvas circuit-canvas" id="circuit"></div>
        <div class="toolbar" style="margin-top:8px"><span id="sim-readout" class="note"></span></div>
        <div class="legend"><span><i style="background:var(--copper)"></i>logic 1</span><span><i style="background:var(--low)"></i>logic 0</span><span>Click an input pin to toggle it. Gates are arranged by logic level, left to right.</span></div>`;
      const canvas = $('#circuit');
      circuitCtl = GL.ui.renderCircuit(canvas, g, { zoom: state.circuitZoom === 'fit' ? (w) => Math.max(0.6, Math.min(1.75, (canvas.clientWidth - 8) / w)) : state.circuitZoom, onToggle: (name) => { state.sim.set(name, state.sim.get(name) ? 0 : 1); state.reveal = null; simulate(); } });
      simulate();
    } else if (state.outTab === 'table') {
      if (!r.table) {
        host.innerHTML = `<div class="skipped-msg">The truth table is not computed for ${r.io.inputs.length} inputs (the limit is 20, which is 1,048,576 rows). The circuit was verified with 4,096 random input vectors instead.</div>`;
        return;
      }
      const t = r.table;
      const sops = r.io.outputs.map((o) => {
        const e = (r.analysis.sop || {})[o] || {};
        const mts = e.minterms ? (e.minterms.length > 40 ? e.minterms.slice(0, 40).join(', ') + ', …' : e.minterms.join(', ')) : '';
        return `<div><span class="k">${esc(o)}</span><code>${e.minterms ? `Σm(${mts || '–'})` : ''}${e.minimal ? `${e.minterms ? '   ' : ''}minimal: ${esc(e.minimal)}` : ''}</code></div>`;
      }).join('');
      host.innerHTML = `<div class="toolbar"><span>${t.rows.toLocaleString('en-US')} rows${t.displayRows < t.rows ? `, first ${t.displayRows.toLocaleString('en-US')} shown` : ''}. Click a row to load it into the simulator.</span><span class="grow"></span><button class="btn small" data-download="csv">Download CSV</button></div>
        <div id="tt"></div><div class="sop">${sops}</div>
        <p class="note">Computed bit-parallel: each gate is evaluated for 32 rows per CPU instruction. Minimal forms come from Quine–McCluskey (up to 8 variables shown here).</p>`;
      tableCtl = GL.ui.renderTable($('#tt'), t, { selected: rowOfSim(), onRow: (row) => { r.io.inputs.forEach((x, k) => state.sim.set(x, (row >>> (t.n - 1 - k)) & 1)); simulate(); } });
      tableCtl.select(rowOfSim(), true);
    } else {
      const text = state.outTab === 'netlist' ? g.netlist : g.verilog;
      host.innerHTML = `<div class="toolbar"><span class="note">${state.outTab === 'netlist' ? 'Gate-level netlist: one line per gate, nets named after your signals where possible.' : 'Synthesizable Verilog. Paste it into any simulator (Icarus Verilog, EDA Playground) to cross-check.'}</span><span class="grow"></span><button class="btn small" data-copy="${state.outTab}">Copy</button><button class="btn small" data-download="${state.outTab}">Download</button></div><pre class="codeblock">${esc(text)}</pre>`;
    }
  }

  /* Catalog */
  function panelCatalog(box) {
    const all = GL.catalog.list();
    const q = state.catalogQuery.toLowerCase();
    const shown = all.filter((e) => (state.catalogPhase === 'all' || e.phase === state.catalogPhase) &&
      (!q || (e.code + ' ' + e.title + ' ' + e.explain).toLowerCase().includes(q)));
    const sev = (c) => GL.catalog.severityOf(c);
    const counts = { error: 0, warning: 0, info: 0 };
    all.forEach((e) => counts[sev(e.code)]++);
    const stats = stat(all.length, 'diagnostics') + stat(counts.error, 'errors') + stat(counts.warning, 'warnings') + stat(counts.info, 'notes') + stat(all.filter((e) => e.example).length, 'with runnable examples');
    const groups = Object.entries(GL.catalog.PHASES).map(([pid, pname]) => {
      const items = shown.filter((e) => e.phase === pid);
      if (!items.length) return '';
      return `<div class="cat-group"><h3>${esc(pname)} <small>${items.length}</small></h3>${items.map((e) => `
        <details class="cat" id="cat-${e.code}"><summary><span class="dot ${sev(e.code)}"></span><b>${e.code}</b><span>${esc(e.title)}</span></summary>
        <div class="body"><p>${esc(e.explain)}</p>${e.fix ? `<p><b style="color:var(--ink)">How to fix:</b> ${esc(e.fix)}</p>` : ''}
        ${e.example ? `<pre>${esc(e.example.length > 600 ? e.example.slice(0, 600) + '\n…' : e.example)}</pre><button class="btn small" data-load-code="${e.code}">Load this example</button>` : '<p class="note">Reported by the compiler itself; it has no example program.</p>'}</div></details>`).join('')}</div>`;
    }).join('');
    box.innerHTML = `<div class="panel">${panelHead('catalog', stats)}<div class="panel-body">
      <div class="cat-tools"><input type="search" id="cat-q" placeholder="Search by code or words, e.g. E309 or loop" value="${esc(state.catalogQuery)}" aria-label="Search the catalog">
      <select class="select" id="cat-phase" aria-label="Phase"><option value="all">All phases</option>${Object.entries(GL.catalog.PHASES).map(([k, v]) => `<option value="${k}"${state.catalogPhase === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      ${groups || '<p class="note">No diagnostics match your search.</p>'}</div></div>`;
  }

  /* Tests */
  function panelTests(box) {
    const run = state.testRun;
    let body;
    if (!run) {
      body = `<p>The same suite runs from the command line with <code>node tests/run-tests.js</code>, together with 118 golden test files.</p>
        <div class="toolbar"><button class="btn primary" data-run-tests="quick">Run the test suite</button><button class="btn" data-run-tests="full">Run with 2,000 random circuits</button></div>`;
    } else {
      const groups = {};
      run.results.forEach((t) => { (groups[t.group] = groups[t.group] || []).push(t); });
      const passed = run.results.filter((t) => t.ok).length;
      body = `<div class="test-summary"><span class="big ${passed === run.results.length ? 'ok' : 'bad'}">${passed}/${run.results.length}</span><span>${run.done ? `tests passed in ${(run.ms / 1000).toFixed(1)} s` : 'running…'}</span><span class="grow"></span>${run.done ? '<button class="btn small" data-run-tests="quick">Run again</button>' : ''}</div>
        <div class="progress"><div style="width:${Math.round(run.progress * 100)}%"></div></div>
        ${Object.entries(groups).map(([g, list]) => `<div class="test-group"><h3>${esc(g)} <small class="note">${list.filter((t) => t.ok).length}/${list.length}</small></h3>
          ${list.map((t) => `<div class="test-row"><span class="${t.ok ? 'p' : 'f'}">${t.ok ? '✓' : '✗'}</span><span>${esc(t.name)}</span><span class="d">${esc(t.detail)}</span></div>`).join('')}</div>`).join('')}`;
    }
    box.innerHTML = `<div class="panel">${panelHead('tests')}<div class="panel-body">${body}</div></div>`;
  }

  function runTests(mode) {
    const S = GL.selftest;
    const steps = [
      () => S.catalogTests(), () => S.exampleTests(), () => S.robustnessTests(), () => S.faultTests(),
      () => S.fuzzEquivalence(mode === 'full' ? 2000 : 300, 2026), () => S.fuzzCrash(mode === 'full' ? 3000 : 1000, 99),
    ];
    const run = { results: [], progress: 0, done: false, t0: performance.now() };
    state.testRun = run;
    let i = 0;
    const next = () => {
      if (i >= steps.length) { run.done = true; run.ms = performance.now() - run.t0; if (state.tab === 'tests') renderPanel(); return; }
      run.results.push(...steps[i]());
      i++;
      run.progress = i / steps.length;
      if (state.tab === 'tests') renderPanel();
      setTimeout(next, 30);
    };
    renderPanel();
    setTimeout(next, 30);
  }

  /* ───────────────────────── helpers ───────────────────────── */
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function baseName() { return state.filename.replace(/\.[^.]*$/, '') || 'circuit'; }
  function csv() {
    const t = state.result.table;
    const lines = [[...t.inputs, ...t.outputs].join(',')];
    for (let row = 0; row < t.rows; row++) {
      const ins = t.inputs.map((_, k) => (row >>> (t.n - 1 - k)) & 1);
      const outs = t.outputs.map((o) => GL.simulator.bit(t.cols.get(o), row));
      lines.push([...ins, ...outs].join(','));
    }
    return lines.join('\n');
  }
  function setTab(tab, user) {
    state.tab = tab;
    if (user) state.userPickedTab = PHASE_IDS.includes(tab) && state.result && state.result.stoppedAt != null && PHASE_IDS.indexOf(tab) > 2;
    renderPanel();
  }
  function setOpt(o) { state.opt = o; $$('#opt button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === o)); compile(true); }
  function setTarget(t) { state.target = t; $$('#target button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === t)); compile(true); }
  function loadSource(src, name) {
    state.filename = name || 'main.gate';
    $('#fname').textContent = state.filename;
    editor.value = src;
    editor.ta.scrollTop = 0;
    state.treeStmt = 'all';
    state.sim = new Map();
    state.userPickedTab = false;
    compile(true);
  }
  function encodeSrc(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function decodeSrc(s) { return decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))); }

  /* ───────────────────────── events ───────────────────────── */
  function bind() {
    $('#compile').addEventListener('click', () => compile(true));
    $('#auto').addEventListener('change', (e) => { state.auto = e.target.checked; });
    $$('#opt button').forEach((b) => b.addEventListener('click', () => setOpt(b.dataset.v)));
    $$('#target button').forEach((b) => b.addEventListener('click', () => setTarget(b.dataset.v)));
    $('#example').addEventListener('change', (e) => {
      const ex = GL.examples.get(e.target.value);
      if (ex) { loadSource(ex.source, ex.id + '.gate'); if (ex.id === 'qm-demo') setOpt('O2'); }
    });
    $$('.pad, .side-tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab, true)));
    $('#filters').addEventListener('click', (e) => {
      const c = e.target.closest('.chip');
      if (!c) return;
      state.filter[c.dataset.sev] = !state.filter[c.dataset.sev];
      renderDiagnostics();
    });
    $('#diags').addEventListener('click', (e) => {
      const link = e.target.closest('.code-link');
      if (link) { openCatalog(link.dataset.code); return; }
      const row = e.target.closest('.diag');
      if (!row) return;
      const d = state.result.diagnostics[+row.dataset.i];
      if (d.line) editor.select(d.line, d.col, d.endLine, d.endCol);
      if (PHASE_IDS.includes(d.phase)) { state.tab = d.phase; renderPanel(); }
    });
    $('#diags').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('diag')) e.target.click(); });
    $('#copy-diag').addEventListener('click', () => {
      const r = state.result;
      const text = r.diagnostics.map((d) => GL.diagnostics.format(d, r.source, state.filename)).join('\n\n') || 'No diagnostics.';
      navigator.clipboard && navigator.clipboard.writeText(text).then(() => toast('Diagnostics copied as text'), () => toast('Copy failed'));
    });
    $('#open-file').addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((t) => loadSource(t, f.name));
      e.target.value = '';
    });
    $('#save-file').addEventListener('click', () => download(state.filename, editor.value));
    $('#share').addEventListener('click', () => {
      const url = location.href.split('#')[0] + '#code=' + encodeSrc(editor.value) + '&O=' + state.opt + '&t=' + state.target;
      history.replaceState(null, '', url);
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied: it opens this exact program'), () => toast('Link is in the address bar'));
    });
    $('#large').addEventListener('click', (e) => {
      document.documentElement.classList.toggle('large');
      e.currentTarget.setAttribute('aria-pressed', document.documentElement.classList.contains('large'));
      editor.render();
    });
    $('#help-btn').addEventListener('click', () => $('#help').showModal());
    $('#help-close').addEventListener('click', () => $('#help').close());

    // panel (delegated)
    const panel = $('#panel');
    panel.addEventListener('click', (e) => {
      const t = e.target.closest('[data-tree],[data-zoom],[data-set-opt],[data-set-target],[data-out],[data-sim],[data-download],[data-copy],[data-load-code],[data-run-tests],[data-goto],tr[data-line],.tree-node[data-line]');
      if (!t) return;
      const d = t.dataset;
      if (d.tree) { state.treeMode = d.tree; state.treeStmt = 'all'; renderPanel(); }
      else if (d.zoom) {
        const [what, dir] = d.zoom.split(':');
        const key = what + 'Zoom';
        const curZ = state[key] === 'fit' ? (circuitCtl ? circuitCtl.zoom : 1) : state[key];
        state[key] = dir === '0' ? (what === 'circuit' ? 'fit' : 1) : Math.min(2.5, Math.max(0.3, curZ * (dir === '1' ? 1.25 : 0.8)));
        if (what === 'circuit') renderOut(); else renderPanel();
      }
      else if (d.setOpt) setOpt(d.setOpt);
      else if (d.setTarget) setTarget(d.setTarget);
      else if (d.out) { state.outTab = d.out; $$('[data-out]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.out === d.out)); renderOut(); }
      else if (d.sim) {
        clearInterval(stepTimer);
        const ins = state.result.io.inputs;
        if (d.sim === 'zero' || d.sim === 'one') { ins.forEach((x) => state.sim.set(x, d.sim === 'one' ? 1 : 0)); state.reveal = null; simulate(); }
        else {
          const max = state.result.gen.stats.depth;
          state.reveal = 0; simulate();
          stepTimer = setInterval(() => {
            state.reveal++;
            if (state.reveal > max) { clearInterval(stepTimer); state.reveal = null; }
            simulate();
          }, reduceMotion ? 10 : 600);
        }
      }
      else if (d.download) {
        const g = state.result.gen;
        if (d.download === 'csv') download(baseName() + '-truth-table.csv', csv(), 'text/csv');
        else if (d.download === 'netlist') download(baseName() + '.net', g.netlist);
        else download(baseName() + '.v', g.verilog);
      }
      else if (d.copy) {
        const g = state.result.gen;
        navigator.clipboard && navigator.clipboard.writeText(d.copy === 'netlist' ? g.netlist : g.verilog).then(() => toast('Copied'));
      }
      else if (d.loadCode) {
        const e2 = GL.catalog.entries[d.loadCode];
        if (e2.opts && e2.opts.opt) { state.opt = e2.opts.opt; $$('#opt button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.opt)); }
        loadSource(e2.example, d.loadCode + '.gate');
        $('#example').value = '';
        const diag = state.result.diagnostics.find((x) => x.code === d.loadCode);
        if (diag && diag.line) editor.select(diag.line, diag.col, diag.endLine, diag.endCol);
        if (PHASE_IDS.includes(e2.phase)) setTab(e2.phase); else setTab('codegen');
        toast(`Loaded the ${d.loadCode} example`);
      }
      else if (d.runTests) runTests(d.runTests);
      else if (d.goto) setTab(d.goto, true);
      else if (d.line) editor.select(+d.line, +d.col, +d.line, d.end ? +d.end : undefined);
    });
    panel.addEventListener('change', (e) => {
      if (e.target.id === 'tree-stmt') { state.treeStmt = e.target.value; renderPanel(); }
      if (e.target.id === 'cat-phase') { state.catalogPhase = e.target.value; renderPanel(); }
    });
    panel.addEventListener('input', (e) => {
      if (e.target.id === 'cat-q') {
        state.catalogQuery = e.target.value;
        const pos = e.target.selectionStart;
        renderPanel();
        const box = $('#cat-q'); box.focus(); box.setSelectionRange(pos, pos);
      }
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); compile(true); }
      if (e.altKey && /^[1-8]$/.test(e.key)) {
        e.preventDefault();
        setTab([...PHASE_IDS, 'catalog', 'tests'][+e.key - 1], true);
      }
    });
  }

  function openCatalog(code) {
    state.catalogQuery = '';
    state.catalogPhase = 'all';
    setTab('catalog');
    const d = $('#cat-' + code);
    if (d) { d.open = true; d.scrollIntoView({ block: 'center' }); d.classList.add('flash-target'); }
  }

  /* ───────────────────────── init ───────────────────────── */
  function init() {
    const groups = {};
    GL.examples.list.forEach((e) => { (groups[e.group] = groups[e.group] || []).push(e); });
    $('#example').innerHTML = `<option value="">Choose an example…</option>` + Object.entries(groups).map(([g, list]) =>
      `<optgroup label="${esc(g)}">${list.map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join('')}</optgroup>`).join('');
    $('#trace').insertAdjacentHTML('beforeend', PHASE_IDS.map((id) => {
      const p = GL.compiler.PHASES.find((x) => x.id === id);
      return `<button class="pad" data-tab="${id}" aria-label="Phase ${PHASE_INFO[id].num}: ${p.name}"><span class="disc">${PHASE_INFO[id].num}</span><span class="name">${p.short}</span><span class="meta"></span></button>`;
    }).join(''));
    $('#cat-count').textContent = GL.catalog.list().length;

    editor = new GL.ui.Editor($('#editor'), {
      onChange: scheduleCompile,
      onCursor: (l, c) => { $('#cursor').textContent = `Ln ${l}, Col ${c}`; },
    });
    bind();

    // load from a shared link, or start with the full adder
    const hash = new URLSearchParams(location.hash.slice(1));
    let src = null;
    try { if (hash.get('code')) src = decodeSrc(hash.get('code')); } catch (err) { src = null; }
    if (hash.get('O') && /^O[012]$/.test(hash.get('O'))) state.opt = hash.get('O');
    if (hash.get('t') && GL.codegen.TARGETS[hash.get('t')]) state.target = hash.get('t');
    $$('#opt button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.opt));
    $$('#target button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.target));
    if (hash.get('tab') && PHASE_INFO[hash.get('tab')]) state.tab = hash.get('tab');
    if (src != null) loadSource(src, 'shared.gate');
    else { $('#example').value = 'full-adder'; loadSource(GL.examples.get('full-adder').source, 'full-adder.gate'); }
  }

  GL.ui = GL.ui || {};
  GL.ui.state = state;
  GL.ui.compile = compile;
  GL.ui.setTab = setTab;
  GL.ui.loadSource = loadSource;
  document.addEventListener('DOMContentLoaded', init);
})(window.GateLang = window.GateLang || {});
