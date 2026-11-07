/*
 * GateLang — Phase 3: Semantic Analysis
 *
 * Pass 1  declarations   – fill the symbol table; detect duplicates/conflicts
 * Pass 2  statements     – resolve every name, check assignment targets,
 *                          record drivers and readers, build the dependency graph
 * Pass 3  graph analysis – cycle detection (iterative 3-colour DFS, prints the
 *                          cycle path), topological order (Kahn's algorithm,
 *                          O(V+E)), dependency levels, unused/undriven signals
 */
(function (GL) {
  'use strict';

  /** Closest declared name, for "did you mean …?" hints. */
  function suggest(name, candidates) {
    const low = name.toLowerCase();
    const caseMatch = candidates.find((c) => c.toLowerCase() === low && c !== name);
    if (caseMatch) return { name: caseMatch, caseOnly: true };
    if (name.length < 3) return null;
    let best = null, bestD = 3;
    for (const c of candidates) {
      const d = GL.parser.levenshtein(name, c);
      if (d < bestD && d <= Math.max(1, Math.floor(name.length / 3))) { best = c; bestD = d; }
    }
    return best ? { name: best, caseOnly: false } : null;
  }

  function analyze(program, diag) {
    const st = new GL.symtab.SymbolTable();
    const parseHadErrors = diag.hasErrors();
    const assignments = [];
    const checks = [];     // list of checks run, for the UI's checklist
    const errStart = diag.errorCount;
    const count = () => diag.errorCount;

    /* ── Pass 1: declarations ── */
    let c0 = count();
    for (const s of program.statements) {
      if (s.kind !== 'Declaration') continue;
      for (const n of s.names) {
        const prev = st.lookup(n.name);
        if (!prev) { st.insert(n.name, s.declKind, n.span); continue; }
        if (prev.kind === s.declKind) {
          diag.add('E302', `'${n.name}' is already declared at ${prev.declaredAt.line}:${prev.declaredAt.col}`, n.span,
            { hint: 'remove the second declaration', related: [{ span: prev.declaredAt, label: 'first declared here' }] });
        } else {
          diag.add('E303', `'${n.name}' is declared as ${prev.kind} (${prev.declaredAt.line}:${prev.declaredAt.col}) and as ${s.declKind} (${n.span.line}:${n.span.col})`, n.span,
            { hint: 'rename one of the signals', related: [{ span: prev.declaredAt, label: `declared as ${prev.kind} here` }] });
        }
      }
    }
    checks.push({ name: 'Every name is declared once', ok: count() === c0 });

    // names differing only by case
    const byLower = new Map();
    for (const e of st.all()) {
      const k = e.name.toLowerCase();
      if (byLower.has(k)) {
        const other = byLower.get(k);
        diag.add('W306', `'${e.name}' and '${other.name}' differ only by case`, e.declaredAt,
          { hint: 'rename one of them to avoid confusion', related: [{ span: other.declaredAt, label: `'${other.name}' declared here` }] });
      } else byLower.set(k, e);
    }

    /* ── Pass 2: assignments and uses ── */
    const undeclaredUses = new Map();     // name → [spans]
    const undeclaredTargets = new Set();
    const brokenTargets = new Set();
    const declaredNames = st.order.slice();
    c0 = count();
    let cTargets = 0, cDrivers = 0;

    for (const s of program.statements) {
      if (s.kind !== 'Assignment') continue;
      // the right-hand side is checked even when the target is broken
      if (s.expr) {
        GL.ast.walkExpr(s.expr, (node) => {
          if (node.kind !== 'Identifier') return;
          const e = st.lookup(node.name);
          if (!e) {
            if (!undeclaredUses.has(node.name)) undeclaredUses.set(node.name, []);
            undeclaredUses.get(node.name).push(node.span);
            return;
          }
          e.readAt.push(node.span);
        });
      }
      if (!s.target || !s.target.name) continue;
      const name = s.target.name;
      const e = st.lookup(name);
      if (s.broken) { brokenTargets.add(name); if (e) e.drivenAt.push(s.target.span); continue; }
      if (!e) {
        undeclaredTargets.add(name);
        const sug = suggest(name, declaredNames);
        const before = count();
        diag.add('E305', `'${name}' is not declared`, s.target.span,
          { hint: sug ? `did you mean '${sug.name}'?${sug.caseOnly ? ' (names are case-sensitive)' : ''}` : `declare it first: output ${name}; or wire ${name};` });
        cTargets += count() - before;
        continue;
      }
      if (e.kind === 'input') {
        const before = count();
        diag.add('E304', `'${name}' is an input and can't be assigned`, s.target.span,
          { hint: 'inputs are driven from outside; assign to an output or wire', related: [{ span: e.declaredAt, label: 'declared as input here' }] });
        cTargets += count() - before;
        continue;
      }
      e.drivenAt.push(s.target.span);
      if (e.drivenAt.length === 2) {
        const before = count();
        diag.add('E306', `'${name}' is assigned more than once (${e.drivenAt[0].line}:${e.drivenAt[0].col} and ${s.target.span.line}:${s.target.span.col}); a signal can have only one driver`, s.target.span,
          { hint: 'keep one assignment, or combine the expressions with AND/OR', related: [{ span: e.drivenAt[0], label: 'first assigned here' }] });
        cDrivers += count() - before;
      } else if (e.drivenAt.length > 2) {
        diag.add('E306', `'${name}' is assigned again (${e.drivenAt.length} drivers in total)`, s.target.span,
          { related: [{ span: e.drivenAt[0], label: 'first assigned here' }] });
        cDrivers++;
        continue;
      }
      if (e.drivenAt.length === 1) {
        e.assignment = s;
        assignments.push(s);
        if (s.expr) GL.ast.walkExpr(s.expr, (node) => { if (node.kind === 'Identifier' && st.has(node.name)) e.deps.add(node.name); });
        // W304 / W305: trivial outputs
        if (e.kind === 'output' && s.expr && !parseHadErrors) {
          if (s.expr.kind === 'Identifier' && st.lookup(s.expr.name) && st.lookup(s.expr.name).kind === 'input') {
            diag.add('W304', `output '${name}' just copies input '${s.expr.name}'`, s.span, { hint: 'it needs no gates; check that this is intended' });
          } else if (s.expr.kind === 'Constant') {
            e.literalConst = true;
            diag.add('W305', `output '${name}' is the constant ${s.expr.value}`, s.span, { hint: 'it never changes; check that this is intended' });
          }
        }
      }
    }
    // one E301 per undeclared name, listing every use
    c0 = count();
    const suggested = new Set();
    for (const [name, spans] of undeclaredUses) {
      if (undeclaredTargets.has(name)) continue;
      const sug = suggest(name, declaredNames);
      if (sug) suggested.add(sug.name);
      const uses = spans.length > 1 ? ` (used ${spans.length} times)` : '';
      diag.add('E301', `'${name}' is not declared${uses}`, spans[0], {
        hint: sug ? `did you mean '${sug.name}'?${sug.caseOnly ? ' (names are case-sensitive)' : ''}` : `declare it, e.g. input ${name};`,
        related: spans.slice(1, 4).map((sp) => ({ span: sp, label: 'also used here' })),
      });
    }
    checks.push({ name: 'Every name used is declared', ok: count() === c0 });
    checks.push({ name: 'Only outputs and wires are assigned', ok: cTargets === 0 });
    checks.push({ name: 'Each signal has exactly one driver', ok: cDrivers === 0 });

    /* ── undriven / unused signals ── */
    c0 = count();
    const outputs = st.ofKind('output');
    if (outputs.length === 0 && !parseHadErrors) {
      diag.add('E311', 'the program declares no outputs, so there is nothing to compute', { line: 1, col: 1, endLine: 1, endCol: 2 },
        { hint: 'declare and assign at least one output, e.g. output y; y = a AND b;' });
    }
    for (const e of outputs) {
      if (e.drivenAt.length === 0 && !brokenTargets.has(e.name)) {
        diag.add('E307', `output '${e.name}' is never assigned`, e.declaredAt, { hint: `assign it, e.g. ${e.name} = …;` });
      }
    }
    checks.push({ name: 'Every output is driven', ok: count() === c0 });
    c0 = count();
    for (const e of st.ofKind('wire')) {
      const driven = e.drivenAt.length > 0 || brokenTargets.has(e.name);
      if (e.readAt.length > 0 && !driven) {
        diag.add('E308', `wire '${e.name}' is used at ${e.readAt[0].line}:${e.readAt[0].col} but never assigned`, e.readAt[0],
          { hint: `assign it, e.g. ${e.name} = …;`, related: [{ span: e.declaredAt, label: 'declared here' }] });
      } else if (!parseHadErrors && driven && e.readAt.length === 0) {
        diag.add('W302', `wire '${e.name}' is assigned but never used`, e.declaredAt, { hint: 'use it or delete it; the optimizer removes it anyway' });
      } else if (!parseHadErrors && !driven && e.readAt.length === 0) {
        diag.add('W303', `wire '${e.name}' is declared but never assigned or used`, e.declaredAt, { hint: 'delete the declaration' });
      }
    }
    checks.push({ name: 'No floating wires', ok: count() === c0 });
    if (!parseHadErrors && outputs.length > 0) {
      for (const e of st.ofKind('input')) {
        if (e.readAt.length === 0 && !suggested.has(e.name)) diag.add('W301', `input '${e.name}' is declared but never used`, e.declaredAt, { hint: 'use it or remove it' });
      }
    }

    /* ── Pass 3: dependency graph ── */
    c0 = count();
    const driven = st.all().filter((e) => e.kind !== 'input' && e.assignment);
    const isDriven = (n) => { const e = st.lookup(n); return !!(e && e.kind !== 'input' && e.assignment); };
    const color = new Map();
    const cycles = [];
    const seenCycle = new Set();
    for (const start of driven) {
      if (color.get(start.name)) continue;
      // iterative DFS (no recursion → no stack overflow on long wire chains)
      const stack = [{ name: start.name, deps: [...start.deps], i: 0 }];
      const path = [start.name];
      const onPath = new Map([[start.name, 0]]);
      color.set(start.name, 1);
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.i < top.deps.length) {
          const d = top.deps[top.i++];
          if (!isDriven(d)) continue;
          const c = color.get(d) || 0;
          if (c === 0) {
            color.set(d, 1);
            onPath.set(d, path.length);
            path.push(d);
            stack.push({ name: d, deps: [...st.lookup(d).deps], i: 0 });
          } else if (c === 1) {
            const cyc = path.slice(onPath.get(d));
            const key = cyc.slice().sort().join('|');
            if (!seenCycle.has(key)) { seenCycle.add(key); cycles.push(cyc); }
          }
        } else {
          color.set(top.name, 2);
          onPath.delete(top.name);
          path.pop();
          stack.pop();
        }
      }
    }
    for (const cyc of cycles) {
      // dependency edges point backwards (x reads y), so print in data-flow order
      let flow = cyc.slice().reverse();
      // rotate so the loop is printed from the signal assigned first in the source
      let k = 0;
      flow.forEach((n, idx) => { if (st.lookup(n).assignment.target.span.line < st.lookup(flow[k]).assignment.target.span.line) k = idx; });
      flow = flow.slice(k).concat(flow.slice(0, k));
      const first = st.lookup(flow[0]);
      if (cyc.length === 1) {
        diag.add('E310', `'${cyc[0]}' depends on itself`, first.assignment.target.span, { hint: `remove '${cyc[0]}' from its own expression` });
      } else {
        diag.add('E309', `combinational loop: ${flow.concat(flow[0]).join(' → ')}`, first.assignment.target.span, {
          hint: 'break the cycle so every signal depends only on inputs and earlier signals',
          related: flow.slice(1).map((n) => ({ span: st.lookup(n).assignment.target.span, label: `'${n}' assigned here` })),
        });
      }
    }
    checks.push({ name: 'No combinational loops', ok: count() === c0 });
    if (diag.errorCount === errStart && !parseHadErrors) {
      for (const e of outputs) if (e.readAt.length > 0) diag.add('I301', `output '${e.name}' also feeds other logic (allowed)`, e.readAt[0]);
    }

    // Kahn's algorithm: evaluation order + dependency level
    let order = [];
    if (cycles.length === 0) {
      const indeg = new Map();
      const users = new Map();
      for (const e of driven) {
        let k = 0;
        for (const d of e.deps) if (isDriven(d)) { k++; if (!users.has(d)) users.set(d, []); users.get(d).push(e.name); }
        indeg.set(e.name, k);
      }
      const queue = driven.filter((e) => indeg.get(e.name) === 0).map((e) => e.name);
      for (let qi = 0; qi < queue.length; qi++) {
        const n = queue[qi];
        order.push(n);
        const e = st.lookup(n);
        let lvl = 0;
        for (const d of e.deps) { const de = st.lookup(d); lvl = Math.max(lvl, de.level || 0); }
        e.level = lvl + 1;
        for (const u of users.get(n) || []) { indeg.set(u, indeg.get(u) - 1); if (indeg.get(u) === 0) queue.push(u); }
      }
    } else {
      order = driven.map((e) => e.name);
    }

    return {
      symtab: st,
      order,                             // evaluation order (names of driven signals)
      assignments: order.map((n) => st.lookup(n).assignment),
      cycles,
      checks,
      errors: diag.errorCount - errStart,
    };
  }

  GL.semantic = { analyze, suggest };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
