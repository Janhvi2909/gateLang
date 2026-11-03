/*
 * GateLang — AST definitions and tree views
 *
 * Node kinds
 *   Program      { statements }
 *   Declaration  { declKind: 'input'|'output'|'wire', names: [{name, span}] }
 *   Assignment   { target: {name, span} | null, expr, broken?, poisoned? }
 *   Binary       { op, left, right, opSpan }
 *   Unary        { op: 'NOT', operand, opSpan }
 *   Identifier   { name }
 *   Constant     { value: 0|1 }
 *   Error        { children }   — placeholder for a part already reported as an error
 *
 * Every node has `span` {line, col, endLine, endCol}. Parenthesised
 * expressions carry `parens` = number of enclosing parentheses.
 */
(function (GL) {
  'use strict';

  const PREC = { OR: 1, NOR: 1, XOR: 2, XNOR: 2, AND: 3, NAND: 3 };

  /** Print an expression with the minimum parentheses needed. */
  function exprToString(node, parentPrec) {
    if (!node) return '?';
    parentPrec = parentPrec || 0;
    switch (node.kind) {
      case 'Identifier': return node.name;
      case 'Constant': return String(node.value);
      case 'Unary': {
        const inner = exprToString(node.operand, 4);
        return 'NOT ' + inner;
      }
      case 'Binary': {
        const p = PREC[node.op];
        const s = `${exprToString(node.left, p)} ${node.op} ${exprToString(node.right, p + 0.5)}`;
        return p < parentPrec ? `(${s})` : s;
      }
      default: return '…';
    }
  }

  /** Walk every node of an expression (including Error children). */
  function walkExpr(node, fn) {
    if (!node) return;
    fn(node);
    if (node.kind === 'Binary') { walkExpr(node.left, fn); walkExpr(node.right, fn); }
    else if (node.kind === 'Unary') walkExpr(node.operand, fn);
    else if (node.kind === 'Error') (node.children || []).forEach((c) => walkExpr(c, fn));
  }

  /* ─────────── Tree views for the UI ─────────── */

  // Display tree node: {label, kind, children, span}
  const leaf = (label, kind, span) => ({ label, kind, children: [], span });

  /** Compact AST view. */
  function astView(program) {
    const exprView = (e) => {
      if (!e) return leaf('∅', 'error');
      switch (e.kind) {
        case 'Identifier': return leaf(e.name, 'ident', e.span);
        case 'Constant': return leaf(String(e.value), 'const', e.span);
        case 'Unary': return { label: 'NOT', kind: 'op', span: e.span, children: [exprView(e.operand)] };
        case 'Binary': return { label: e.op, kind: 'op', span: e.span, children: [exprView(e.left), exprView(e.right)] };
        default: return leaf('error', 'error', e.span);
      }
    };
    const stmts = program.statements.filter((s) => !s.broken && !s.poisoned).map((s) => {
      if (s.kind === 'Declaration') {
        return { label: s.declKind, kind: 'decl', span: s.span, children: s.names.map((n) => leaf(n.name, 'ident', n.span)) };
      }
      return { label: '=', kind: 'assign', span: s.span, children: [leaf(s.target.name, 'target', s.target.span), exprView(s.expr)] };
    });
    return { label: 'Program', kind: 'root', children: stmts };
  }

  /**
   * Concrete parse tree, derived from the AST using the grammar rules
   * (program → statement → assignment → expr → or_expr → xor_expr → and_expr
   * → unary → primary). The grammar is unambiguous, so the AST plus the
   * recorded parentheses determine the parse tree exactly.
   */
  function parseTreeView(program) {
    const RULES = ['or_expr', 'xor_expr', 'and_expr'];
    const T = (label, span) => leaf(label, 'terminal', span);
    const N = (label, children) => ({ label, kind: 'rule', children });

    function level(node, li) {
      if (li >= 3) return unary(node);
      const rule = RULES[li];
      const myLevel = li + 1;
      const isMine = (x) => x && x.kind === 'Binary' && !x.parens && PREC[x.op] === myLevel;
      if (!isMine(node)) return N(rule, [level(node, li + 1)]);
      // flatten the left spine of same-level binaries: a OR b OR c
      const parts = [];
      let cur = node;
      const rights = [];
      while (isMine(cur)) { rights.unshift({ op: cur.op, right: cur.right, opSpan: cur.opSpan }); cur = cur.left; }
      parts.push(level(cur, li + 1));
      for (const r of rights) { parts.push(T(r.op, r.opSpan)); parts.push(level(r.right, li + 1)); }
      return N(rule, parts);
    }
    function unary(node) {
      if (node && node.kind === 'Unary' && !node.parens) return N('unary', [T('NOT', node.opSpan), unary(node.operand)]);
      return N('unary', [primary(node)]);
    }
    function primary(node) {
      if (!node) return N('primary', [T('?')]);
      if (node.parens) {
        const inner = Object.assign({}, node, { parens: node.parens - 1 });
        return N('primary', [T('('), N('expr', [level(inner, 0)]), T(')')]);
      }
      if (node.kind === 'Identifier') return N('primary', [T(node.name, node.span)]);
      if (node.kind === 'Constant') return N('primary', [T(String(node.value), node.span)]);
      // a binary/unary reaching primary without parens cannot happen for valid trees
      return N('primary', [T('…')]);
    }

    const stmts = program.statements.filter((s) => !s.broken && !s.poisoned).map((s) => {
      if (s.kind === 'Declaration') {
        const ids = [];
        s.names.forEach((n, k) => { if (k) ids.push(T(',')); ids.push(T(n.name, n.span)); });
        return N('statement', [N('declaration', [T(s.declKind, s.kwSpan), N('id_list', ids), T(';')])]);
      }
      return N('statement', [N('assignment', [T(s.target.name, s.target.span), T('='), N('expr', [level(s.expr, 0)]), T(';')])]);
    });
    return N('program', stmts.concat([T('EOF')]));
  }

  /** Count nodes in a display tree. */
  function countNodes(t) { return 1 + t.children.reduce((a, c) => a + countNodes(c), 0); }

  GL.ast = { exprToString, walkExpr, astView, parseTreeView, countNodes, PREC };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
