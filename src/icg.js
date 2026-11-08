/*
 * GateLang — Phase 4: Intermediate Code Generation
 *
 * Translates each assignment (in the topological order found by Phase 3)
 * into three-address code by a post-order traversal of its expression tree.
 * Each instruction is stored as a quadruple (op, arg1, arg2, result).
 *
 *   t1 = a AND b        quad: (AND, a, b, t1)
 *   t2 = NOT c          quad: (NOT, c, –, t2)
 *   out = t3            quad: (COPY, t3, –, out)
 *
 * One instruction = one gate, so the instruction count is the gate count.
 * Constants appear as the operands '0' and '1' (names can't start with a digit).
 */
(function (GL) {
  'use strict';

  function makeFresh(symtab, prefix) {
    let k = 0;
    return () => { let name; do { name = (prefix || 't') + (++k); } while (symtab && symtab.has(name)); return name; };
  }

  function generate(sem) {
    const st = sem.symtab;
    const fresh = makeFresh(st, 't');
    const quads = [];

    function gen(node, line) {
      switch (node.kind) {
        case 'Identifier': return node.name;
        case 'Constant': return String(node.value);
        case 'Unary': {
          const a = gen(node.operand, line);
          const res = fresh();
          quads.push({ op: 'NOT', a, b: null, res, line, id: quads.length });
          return res;
        }
        case 'Binary': {
          const a = gen(node.left, line);
          const b = gen(node.right, line);
          const res = fresh();
          quads.push({ op: node.op, a, b, res, line, id: quads.length });
          return res;
        }
        default: throw new Error('ICG: unexpected node ' + node.kind);
      }
    }

    for (const name of sem.order) {
      const asg = st.lookup(name).assignment;
      const line = asg.target.span.line;
      const v = gen(asg.expr, line);
      quads.push({ op: 'COPY', a: v, b: null, res: name, line, id: quads.length });
    }
    return { quads, fresh, temps: quads.filter((q) => /^t\d+$/.test(q.res) && !st.has(q.res)).length };
  }

  /** Text form of one quad: "t1 = a AND b". */
  function quadText(q) {
    if (q.op === 'COPY') return `${q.res} = ${q.a}`;
    if (q.op === 'NOT') return `${q.res} = NOT ${q.a}`;
    return `${q.res} = ${q.a} ${q.op} ${q.b}`;
  }

  /** Gate count, depth, transistor estimate and op histogram of a quad list. */
  const TRANSISTORS = { NOT: 2, NAND: 4, NOR: 4, AND: 6, OR: 6, XOR: 12, XNOR: 12, BUF: 4 };
  function stats(quads) {
    const depth = new Map();
    const d = (x) => (x === null || x === '0' || x === '1' ? 0 : depth.get(x) || 0);
    const byType = {};
    let gates = 0, transistors = 0, maxDepth = 0;
    for (const q of quads) {
      if (q.op === 'COPY') { depth.set(q.res, d(q.a)); continue; }
      gates++;
      byType[q.op] = (byType[q.op] || 0) + 1;
      transistors += TRANSISTORS[q.op];
      depth.set(q.res, 1 + Math.max(d(q.a), d(q.b)));
    }
    for (const v of depth.values()) maxDepth = Math.max(maxDepth, v);
    return { gates, depth: maxDepth, instructions: quads.length, transistors, byType, depthOf: depth };
  }

  GL.icg = { generate, quadText, stats, makeFresh, TRANSISTORS };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
