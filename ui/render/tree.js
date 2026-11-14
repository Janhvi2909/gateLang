/*
 * GateLang UI — tree renderer (AST and parse tree) and dependency-graph renderer
 */
(function (GL) {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CH = 7.4;          // approx. width of one 12px mono character

  /* ─────────── tree ─────────── */
  function renderTree(container, tree, zoom) {
    const LEVEL = 58, GAP = 12, H = 24;
    let maxDepth = 0;
    const size = (n) => {
      n.w = Math.max(30, n.label.length * CH + 18);
      if (!n.children.length) { n.sw = n.w; return; }
      n.children.forEach(size);
      const kids = n.children.reduce((a, c) => a + c.sw, 0) + GAP * (n.children.length - 1);
      n.sw = Math.max(n.w, kids);
    };
    const place = (n, left, depth) => {
      n.y = 20 + depth * LEVEL;
      maxDepth = Math.max(maxDepth, depth);
      if (!n.children.length) { n.x = left + n.sw / 2; return; }
      const kids = n.children.reduce((a, c) => a + c.sw, 0) + GAP * (n.children.length - 1);
      let cx = left + (n.sw - kids) / 2;
      for (const c of n.children) { place(c, cx, depth + 1); cx += c.sw + GAP; }
      n.x = (n.children[0].x + n.children[n.children.length - 1].x) / 2;
    };
    size(tree);
    place(tree, 20, 0);
    const W = tree.sw + 40, Hh = 20 + maxDepth * LEVEL + H + 24;
    const edges = [], nodes = [];
    const walk = (n) => {
      for (const c of n.children) {
        const y1 = n.y + H, y2 = c.y, my = (y1 + y2) / 2;
        edges.push(`<path class="tree-edge" d="M${n.x},${y1} C${n.x},${my} ${c.x},${my} ${c.x},${y2}"/>`);
        walk(c);
      }
      const rx = n.kind === 'rule' ? 4 : n.kind === 'op' ? 12 : 8;
      const title = n.span ? `<title>${esc(n.label)} at ${n.span.line}:${n.span.col}</title>` : '';
      nodes.push(`<g class="tree-node ${n.kind}"${n.span ? ` data-line="${n.span.line}" data-col="${n.span.col}" style="cursor:pointer"` : ''}>${title}<rect x="${n.x - n.w / 2}" y="${n.y}" width="${n.w}" height="${H}" rx="${rx}"/>` +
        `<text x="${n.x}" y="${n.y + 16}" text-anchor="middle">${esc(n.label)}</text></g>`);
    };
    walk(tree);
    container.innerHTML = `<svg width="${W * zoom}" height="${Hh * zoom}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Syntax tree">${edges.join('')}${nodes.join('')}</svg>`;
    return { width: W, height: Hh };
  }

  /* ─────────── dependency graph ─────────── */
  function renderGraph(container, st) {
    const entries = st.all();
    const level = (e) => (e.kind === 'input' ? 0 : e.level || 1);
    const cols = new Map();
    for (const e of entries) { const L = level(e); if (!cols.has(L)) cols.set(L, []); cols.get(L).push(e); }
    const levels = [...cols.keys()].sort((a, b) => a - b);
    const COLW = 170, ROW = 40, NH = 26;
    const pos = new Map();
    let maxRows = 0;
    levels.forEach((L, ci) => {
      const list = cols.get(L);
      // order by the average position of what they read (fewer crossings)
      if (ci > 0) {
        list.forEach((e) => {
          const ys = [...e.deps].map((d) => (pos.get(d) || { y: 0 }).y);
          e._bary = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0;
        });
        list.sort((a, b) => a._bary - b._bary);
      }
      list.forEach((e, k) => { pos.set(e.name, { x: 30 + ci * COLW, y: 40 + k * ROW, w: Math.max(56, e.name.length * CH + 22) }); });
      maxRows = Math.max(maxRows, list.length);
    });
    const W = 60 + levels.length * COLW, H = 50 + maxRows * ROW;
    const parts = [];
    levels.forEach((L, ci) => parts.push(`<text class="g-col" x="${30 + ci * COLW}" y="20">${L === 0 ? 'Inputs' : 'Level ' + L}</text>`));
    for (const e of entries) {
      const p = pos.get(e.name);
      for (const d of e.deps) {
        const q = pos.get(d);
        if (!q) continue;
        const x1 = q.x + q.w, y1 = q.y + NH / 2, x2 = p.x, y2 = p.y + NH / 2, mx = (x1 + x2) / 2;
        parts.push(`<path class="g-edge" data-from="${esc(d)}" data-to="${esc(e.name)}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`);
      }
    }
    for (const e of entries) {
      const p = pos.get(e.name);
      parts.push(`<g class="g-node ${e.kind}" data-name="${esc(e.name)}"><title>${esc(e.name)} (${e.kind})</title><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${NH}" rx="13"/>` +
        `<text x="${p.x + p.w / 2}" y="${p.y + 17}" text-anchor="middle">${esc(e.name)}</text></g>`);
    }
    container.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Dependency graph">${parts.join('')}</svg>`;
    container.querySelectorAll('.g-node').forEach((g) => {
      const name = g.dataset.name;
      g.addEventListener('mouseenter', () => container.querySelectorAll('.g-edge').forEach((p) => { if (p.dataset.from === name || p.dataset.to === name) p.classList.add('hl'); }));
      g.addEventListener('mouseleave', () => container.querySelectorAll('.g-edge.hl').forEach((p) => p.classList.remove('hl')));
    });
  }

  GL.ui = GL.ui || {};
  GL.ui.renderTree = renderTree;
  GL.ui.renderGraph = renderGraph;
})(window.GateLang = window.GateLang || {});
