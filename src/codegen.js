/*
 * GateLang — Phase 6: Code Generation
 *
 * The target "machine" is a gate library, the way a C compiler targets x86 or ARM.
 *
 *  1. Instruction selection (technology mapping): each TAC instruction becomes
 *     one or more gates of the chosen library.
 *        std   AND OR NOT XOR NAND NOR XNOR (1 gate each)
 *        nand  NAND only   (NOT=1, AND=2, OR=3, NOR=4, XOR=4, XNOR=5)
 *        nor   NOR only    (NOT=1, OR=2, AND=3, NAND=4, XNOR=4, XOR=5)
 *  2. Peephole optimization (NAND/NOR targets): remove the double inversions
 *     the mapping creates and merge identical gates, then drop dead gates.
 *  3. Emission: a gate-level netlist and synthesizable Verilog.
 *  4. Levelisation: the logic level of every net (used for depth, the
 *     circuit layout and the step-by-step simulator).
 */
(function (GL) {
  'use strict';

  const TARGETS = {
    std: { name: 'Standard gates', short: 'Standard' },
    nand: { name: 'NAND-only', short: 'NAND-only' },
    nor: { name: 'NOR-only', short: 'NOR-only' },
  };
  const isConst = (x) => x === '0' || x === '1';

  const VERILOG_KEYWORDS = new Set(('always assign automatic begin buf bufif0 bufif1 case casex casez cell cmos config deassign default defparam design disable edge else end endcase endconfig endfunction endgenerate endmodule endprimitive endspecify endtable endtask event for force forever fork function generate genvar highz0 highz1 if ifnone incdir include initial inout instance integer join large liblist library localparam logic macromodule medium module negedge nmos noshowcancelled notif0 notif1 parameter pmos posedge primitive pull0 pull1 pulldown pullup pulsestyle_ondetect pulsestyle_onevent rcmos real realtime reg release repeat rnmos rpmos rtran rtranif0 rtranif1 scalared showcancelled signed small specify specparam strong0 strong1 supply0 supply1 table task time tran tranif0 tranif1 tri tri0 tri1 triand trior trireg unsigned use uwire vectored wait wand weak0 weak1 while wor').split(' '));

  function generate(quads, ctx) {
    const target = ctx.target || 'std';
    const used = new Set([...ctx.inputs, ...ctx.outputs, ...(ctx.wires || []), ...quads.map((q) => q.res)]);
    let k = 0;
    const newNet = () => { let n; do { n = 'n' + (++k); } while (used.has(n)); used.add(n); return n; };

    // COPY instructions are wires, not gates: resolve them away
    const alias = new Map();
    for (const q of quads) if (q.op === 'COPY') alias.set(q.res, q.a);
    const resolve = (x) => { let s = 0; while (x != null && alias.has(x) && s++ < 10000) x = alias.get(x); return x; };

    let gates = [];
    const add = (type, ins, out, line) => gates.push({ type, ins, out, line });

    for (const q of quads) {
      if (q.op === 'COPY') continue;
      const a = resolve(q.a), b = q.b != null ? resolve(q.b) : null, out = q.res, L = q.line;
      if (target === 'std') { add(q.op, b != null ? [a, b] : [a], out, L); continue; }
      const G = target === 'nand' ? 'NAND' : 'NOR';
      const inv = (x, o) => add(G, [x, x], o, L);
      if (target === 'nand') {
        switch (q.op) {
          case 'NOT': inv(a, out); break;
          case 'NAND': add(G, [a, b], out, L); break;
          case 'AND': { const n = newNet(); add(G, [a, b], n, L); inv(n, out); break; }
          case 'OR': { const na = newNet(), nb = newNet(); inv(a, na); inv(b, nb); add(G, [na, nb], out, L); break; }
          case 'NOR': { const na = newNet(), nb = newNet(), n = newNet(); inv(a, na); inv(b, nb); add(G, [na, nb], n, L); inv(n, out); break; }
          case 'XOR': case 'XNOR': {
            const n1 = newNet(), n2 = newNet(), n3 = newNet();
            add(G, [a, b], n1, L); add(G, [a, n1], n2, L); add(G, [b, n1], n3, L);
            if (q.op === 'XOR') add(G, [n2, n3], out, L); else { const n4 = newNet(); add(G, [n2, n3], n4, L); inv(n4, out); }
            break;
          }
        }
      } else {
        switch (q.op) {
          case 'NOT': inv(a, out); break;
          case 'NOR': add(G, [a, b], out, L); break;
          case 'OR': { const n = newNet(); add(G, [a, b], n, L); inv(n, out); break; }
          case 'AND': { const na = newNet(), nb = newNet(); inv(a, na); inv(b, nb); add(G, [na, nb], out, L); break; }
          case 'NAND': { const na = newNet(), nb = newNet(), n = newNet(); inv(a, na); inv(b, nb); add(G, [na, nb], n, L); inv(n, out); break; }
          case 'XNOR': case 'XOR': {
            const n1 = newNet(), n2 = newNet(), n3 = newNet();
            add(G, [a, b], n1, L); add(G, [a, n1], n2, L); add(G, [b, n1], n3, L);
            if (q.op === 'XNOR') add(G, [n2, n3], out, L); else { const n4 = newNet(); add(G, [n2, n3], n4, L); inv(n4, out); }
            break;
          }
        }
      }
    }

    // output pins: which net drives each output
    const pins = {};
    for (const o of ctx.outputs) pins[o] = resolve(o);
    const mapped = gates.length;

    // ── peephole optimization for the universal-gate targets ──
    let doubleInv = 0, dupMerged = 0;
    if (target !== 'std') {
      const G = target === 'nand' ? 'NAND' : 'NOR';
      let changed = true, guard = 0;
      while (changed && guard++ < 50) {
        changed = false;
        const subst = new Map();
        const r = (x) => { let s = 0; while (subst.has(x) && s++ < 10000) x = subst.get(x); return x; };
        const driver = new Map();
        const seen = new Map();
        const keep = [];
        for (const g of gates) {
          g.ins = g.ins.map(r);
          const isInv = g.type === G && g.ins.length === 2 && g.ins[0] === g.ins[1];
          if (isInv) {
            const h = driver.get(g.ins[0]);
            if (h && h.type === G && h.ins[0] === h.ins[1]) { subst.set(g.out, h.ins[0]); doubleInv++; changed = true; continue; }
          }
          const key = g.type + '|' + g.ins.slice().sort().join('|');
          if (seen.has(key)) { subst.set(g.out, seen.get(key).out); dupMerged++; changed = true; continue; }
          seen.set(key, g);
          driver.set(g.out, g);
          keep.push(g);
        }
        gates = keep;
        for (const o of Object.keys(pins)) pins[o] = r(pins[o]);
      }
    }
    // dead gates (only those orphaned by the peephole pass; wires are kept at -O0)
    {
      const live = new Set(Object.values(pins));
      for (const w of ctx.wires || []) live.add(resolve(w));
      for (let i = gates.length - 1; i >= 0; i--) if (live.has(gates[i].out)) gates[i].ins.forEach((x) => live.add(x));
      gates = gates.filter((g) => live.has(g.out));
    }
    gates.forEach((g, i) => { g.id = 'G' + (i + 1); });

    // ── levels, depth, fan-out ──
    const level = new Map();
    for (const i of ctx.inputs) level.set(i, 0);
    level.set('0', 0); level.set('1', 0);
    for (const g of gates) { g.level = 1 + Math.max(...g.ins.map((x) => level.get(x) || 0)); level.set(g.out, g.level); }
    let depth = 0;
    for (const o of ctx.outputs) depth = Math.max(depth, level.get(pins[o]) || 0);
    const fan = new Map();
    for (const g of gates) for (const x of new Set(g.ins)) if (!isConst(x)) fan.set(x, (fan.get(x) || 0) + 1);
    let maxFanout = 0, fanoutNet = null;
    for (const [net, c] of fan) if (c > maxFanout) { maxFanout = c; fanoutNet = net; }
    const byType = {};
    let transistors = 0;
    for (const g of gates) { byType[g.type] = (byType[g.type] || 0) + 1; transistors += GL.icg.TRANSISTORS[g.type]; }

    const result = {
      target, targetName: TARGETS[target].name, gates, pins, level, inputs: ctx.inputs.slice(), outputs: ctx.outputs.slice(),
      stats: { gates: gates.length, mapped, doubleInv, dupMerged, byType, depth, transistors, maxFanout, fanoutNet, fanout: fan },
    };
    result.netlist = emitNetlist(result, ctx);
    result.verilog = emitVerilog(result, ctx);
    result.ops = toOps(result);
    return result;
  }

  /** Netlist as simulator operations (gates + output pins). */
  function toOps(gen) {
    const ops = gen.gates.map((g) => ({ op: g.type, a: g.ins[0], b: g.ins.length > 1 ? g.ins[1] : null, res: g.out }));
    for (const o of gen.outputs) if (gen.pins[o] !== o) ops.push({ op: 'COPY', a: gen.pins[o], b: null, res: o });
    return ops;
  }

  function emitNetlist(gen, ctx) {
    const lines = [];
    lines.push(`// GateLang netlist`);
    lines.push(`// target: ${gen.targetName}   optimization: -${ctx.optLevel || 'O1'}   gates: ${gen.gates.length}   depth: ${gen.stats.depth}`);
    lines.push(`INPUT   ${gen.inputs.join(', ') || '(none)'}`);
    lines.push(`OUTPUT  ${gen.outputs.join(', ')}`);
    lines.push('');
    const w = Math.max(4, ...gen.gates.map((g) => g.id.length));
    for (const g of gen.gates) {
      lines.push(`${g.id.padEnd(w)}  ${g.type.padEnd(4)}  (${g.ins.join(', ')})`.padEnd(w + 26) + `-> ${g.out}`);
    }
    for (const o of gen.outputs) {
      const src = gen.pins[o];
      if (src === o) continue;
      if (isConst(src)) lines.push(`${''.padEnd(w)}  ${('TIE' + src).padEnd(4)}  ()`.padEnd(w + 26) + `-> ${o}`);
      else lines.push(`${''.padEnd(w)}  BUF   (${src})`.padEnd(w + 26) + `-> ${o}`);
    }
    return lines.join('\n');
  }

  function vname(n) {
    if (n === '0') return "1'b0";
    if (n === '1') return "1'b1";
    return VERILOG_KEYWORDS.has(n) ? '\\' + n + ' ' : n;
  }

  function emitVerilog(gen, ctx) {
    let mod = (ctx.moduleName || 'circuit').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_');
    if (!/^[A-Za-z_]/.test(mod)) mod = 'm_' + mod;
    if (VERILOG_KEYWORDS.has(mod)) mod += '_m';
    const lines = [];
    lines.push(`// Generated by GateLang — target: ${gen.targetName}, -${ctx.optLevel || 'O1'}`);
    const ports = [...gen.inputs.map((i) => `  input  wire ${vname(i)}`), ...gen.outputs.map((o) => `  output wire ${vname(o)}`)];
    lines.push(`module ${mod} (`);
    lines.push(ports.join(',\n'));
    lines.push(');');
    const outSet = new Set(gen.outputs);
    const internal = gen.gates.map((g) => g.out).filter((n) => !outSet.has(n));
    if (internal.length) {
      for (let i = 0; i < internal.length; i += 10) lines.push(`  wire ${internal.slice(i, i + 10).map(vname).join(', ')};`);
    }
    const OPS = { AND: '&', OR: '|', XOR: '^' };
    for (const g of gen.gates) {
      const [a, b] = g.ins.map(vname);
      if (gen.target === 'std') {
        let e;
        switch (g.type) {
          case 'NOT': e = `~${a}`; break;
          case 'AND': case 'OR': case 'XOR': e = `${a} ${OPS[g.type]} ${b}`; break;
          case 'NAND': e = `~(${a} & ${b})`; break;
          case 'NOR': e = `~(${a} | ${b})`; break;
          case 'XNOR': e = `~(${a} ^ ${b})`; break;
        }
        lines.push(`  assign ${vname(g.out)} = ${e};`);
      } else {
        lines.push(`  ${g.type.toLowerCase()} ${g.id} (${vname(g.out)}, ${a}, ${b});`);
      }
    }
    for (const o of gen.outputs) if (gen.pins[o] !== o) lines.push(`  assign ${vname(o)} = ${vname(gen.pins[o])};`);
    lines.push('endmodule');
    return lines.join('\n');
  }

  GL.codegen = { generate, TARGETS, emitVerilog, emitNetlist };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
