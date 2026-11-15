/*
 * GateLang UI — circuit diagram and interactive simulator
 *
 * Layout: inputs on the left, gates in columns by logic level (from Phase 6),
 * outputs on the right. Within a column, gates are ordered by the average
 * height of the signals feeding them (barycenter heuristic) to reduce wire
 * crossings. Each wire gets its own vertical channel between columns.
 */
(function (GL) {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isConst = (x) => x === '0' || x === '1';

  const GW = 46, GH = 36, COL = 175, ROW = 74, X0 = 70;
  const BODY = {
    AND: 'M0,0 H24 A18,18 0 0 1 24,36 H0 Z',
    OR: 'M0,0 Q14,18 0,36 Q30,36 46,18 Q30,0 0,0 Z',
    NOT: 'M0,2 L34,18 L0,34 Z',
  };
  const SHAPE = {
    AND: { body: BODY.AND, bubble: false, curved: false }, NAND: { body: BODY.AND, bubble: true, curved: false },
    OR: { body: BODY.OR, bubble: false, curved: true }, NOR: { body: BODY.OR, bubble: true, curved: true },
    XOR: { body: BODY.OR, bubble: false, curved: true, xor: true }, XNOR: { body: BODY.OR, bubble: true, curved: true, xor: true },
    NOT: { body: BODY.NOT, bubble: true, curved: false, w: 34 },
  };

  function outX(g) { const s = SHAPE[g.type]; return (s.w || GW) + (s.bubble ? 8 : 0); }

  /**
   * Draw the circuit. Returns a controller with setValues(env, revealLevel).
   */
  function renderCircuit(container, gen, opts) {
    opts = opts || {};
    const gates = gen.gates;
    const maxLevel = gates.reduce((m, g) => Math.max(m, g.level), 0);
    const pos = new Map();         // net → {x, y} output point
    const consts = new Set();
    gates.forEach((g) => g.ins.forEach((x) => isConst(x) && consts.add(x)));
    gen.outputs.forEach((o) => isConst(gen.pins[o]) && consts.add(gen.pins[o]));

    // Layout in two passes: place gates with inputs in declaration order,
    // then reorder the inputs by the average height of the gates they feed
    // (barycenter heuristic) and place everything again. Fewer long wires.
    const TOP = 46;
    let maxY, gpos;
    const byLevel = new Map();
    gates.forEach((g) => { if (!byLevel.has(g.level)) byLevel.set(g.level, []); byLevel.get(g.level).push(g); });
    function place(inputOrder) {
      pos.clear();
      let y = TOP;
      inputOrder.forEach((name) => { pos.set(name, { x: X0 + 14, y, kind: 'input' }); y += 62; });
      [...consts].sort().forEach((k) => { pos.set(k, { x: X0 + 14, y, kind: 'tie' }); y += ROW * 0.8; });
      maxY = y;
      gpos = new Map();
      for (let L = 1; L <= maxLevel; L++) {
        const list = byLevel.get(L) || [];
        list.forEach((g) => {
          const ys = g.ins.map((x) => (pos.get(x) || { y: TOP }).y);
          g._bary = ys.reduce((a, b) => a + b, 0) / ys.length;
        });
        list.sort((a, b) => a._bary - b._bary);
        let prev = -Infinity;
        for (const g of list) {
          const gy = Math.max(g._bary, prev + ROW);
          prev = gy;
          const gx = X0 + 40 + (L - 1) * COL + 60;
          gpos.set(g.id, { x: gx, y: gy });
          pos.set(g.out, { x: gx + outX(g), y: gy, kind: 'gate' });
          maxY = Math.max(maxY, gy + ROW);
        }
      }
    }
    place(gen.inputs);
    if (gates.length > 1 && gen.inputs.length > 2) {
      const weight = (name) => {
        const ys = gates.filter((g) => g.ins.includes(name)).map((g) => gpos.get(g.id).y);
        return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 1e9;
      };
      const order = gen.inputs.map((n, i) => ({ n, w: weight(n), i })).sort((a, b) => a.w - b.w || a.i - b.i).map((x) => x.n);
      place(order);
    }
    // outputs
    const outXpos = X0 + 40 + maxLevel * COL + 90;
    const outs = gen.outputs.map((o) => ({ name: o, src: gen.pins[o], bary: (pos.get(gen.pins[o]) || { y: TOP }).y }));
    outs.sort((a, b) => a.bary - b.bary);
    let prevO = -Infinity;
    outs.forEach((o) => { o.y = Math.max(o.bary, prevO + ROW * 0.85); prevO = o.y; maxY = Math.max(maxY, o.y + ROW); });

    // wires: assign one vertical channel per (target column, source net)
    const channels = new Map();
    const channelFor = (colKey, net) => {
      if (!channels.has(colKey)) channels.set(colKey, new Map());
      const m = channels.get(colKey);
      if (!m.has(net)) m.set(net, m.size);
      return m.get(net);
    };
    const wires = [];
    const junctions = [];
    const fan = new Map();
    const addWire = (net, tx, ty, colKey) => {
      const s = pos.get(net);
      if (!s) return;
      const ch = channelFor(colKey, net);
      const mx = Math.max(s.x + 10, tx - 22 - ch * 10);
      const d = Math.abs(s.y - ty) < 0.5 ? `M${s.x},${s.y} H${tx}` : `M${s.x},${s.y} H${mx} V${ty} H${tx}`;
      wires.push({ net, d });
      fan.set(net, (fan.get(net) || 0) + 1);
      if (Math.abs(s.y - ty) >= 0.5) junctions.push({ net, x: mx, y: s.y });
    };
    for (const g of gates) {
      const p = gpos.get(g.id);
      const shape = SHAPE[g.type];
      const pinX = p.x + (shape.curved ? 5 : 0);
      if (g.ins.length === 1 || g.ins[0] === g.ins[1]) {
        addWire(g.ins[0], pinX, p.y, 'g' + g.level);
        if (g.ins.length === 2) wires.push({ net: g.ins[0], d: `M${pinX - 6},${p.y - 9} V${p.y + 9} M${pinX - 6},${p.y - 9} H${pinX} M${pinX - 6},${p.y + 9} H${pinX}` });
      } else {
        addWire(g.ins[0], pinX, p.y - 9, 'g' + g.level);
        addWire(g.ins[1], pinX, p.y + 9, 'g' + g.level);
      }
    }
    for (const o of outs) addWire(o.src, outXpos - 14, o.y, 'out');

    // ── SVG ──
    const W = outXpos + 120;
    const H = Math.max(maxY, TOP + ROW) + 10;
    const svg = [];
    svg.push(`<g class="wires">`);
    for (const w of wires) svg.push(`<path class="wire" data-net="${esc(w.net)}" d="${w.d}"/>`);
    for (const j of junctions) if (fan.get(j.net) > 1) svg.push(`<circle class="junction" data-net="${esc(j.net)}" cx="${j.x}" cy="${j.y}" r="3.2"/>`);
    svg.push(`</g>`);
    // input pins
    for (const name of gen.inputs) {
      const p = pos.get(name);
      svg.push(`<g class="pin-in" data-input="${esc(name)}" data-net="${esc(name)}" tabindex="0" role="switch" aria-label="input ${esc(name)}">` +
        `<rect class="hit" x="${p.x - 30 - name.length * 8}" y="${p.y - 20}" width="${name.length * 8 + 44}" height="40" rx="6"/>` +
        `<text class="pin-label" x="${p.x - 24}" y="${p.y + 5}" text-anchor="end">${esc(name)}</text>` +
        `<circle cx="${p.x - 2}" cy="${p.y}" r="12"/><text class="v" x="${p.x - 2}" y="${p.y + 4}" text-anchor="middle">0</text></g>`);
    }
    for (const k of consts) {
      const p = pos.get(k);
      svg.push(`<g class="tie"><rect x="${p.x - 30}" y="${p.y - 11}" width="30" height="22" rx="3"/><text x="${p.x - 15}" y="${p.y + 4}" text-anchor="middle">${k === '1' ? 'VCC' : 'GND'}</text></g>`);
    }
    // gates
    for (const g of gates) {
      const p = gpos.get(g.id);
      const s = SHAPE[g.type];
      const bodyW = s.w || GW;
      svg.push(`<g class="gate" data-net="${esc(g.out)}" data-level="${g.level}" transform="translate(${p.x},${p.y - GH / 2})">` +
        `<title>${g.id}: ${g.type}(${g.ins.join(', ')}) → ${g.out}${g.line ? ' (line ' + g.line + ')' : ''}</title>` +
        (s.xor ? `<path class="gate-body" d="M-7,0 Q7,18 -7,36" fill="none"/>` : '') +
        `<path class="gate-body" d="${s.body}"/>` +
        (s.bubble ? `<circle class="gate-bubble" cx="${bodyW + 4}" cy="18" r="4"/>` : '') +
        `<text class="gate-type" x="${bodyW / 2 - (s.curved ? -2 : 4)}" y="22" text-anchor="middle">${g.type === 'NOT' ? '' : g.type}</text>` +
        `<text class="gate-label" x="${bodyW / 2}" y="-5" text-anchor="middle">${g.id}</text></g>`);
    }
    // outputs
    for (const o of outs) {
      svg.push(`<g class="led" data-output="${esc(o.name)}" data-net="${esc(o.src)}">` +
        `<circle cx="${outXpos}" cy="${o.y}" r="13"/><text class="v" x="${outXpos}" y="${o.y + 4}" text-anchor="middle">0</text>` +
        `<text class="pin-label" x="${outXpos + 22}" y="${o.y + 5}">${esc(o.name)}</text></g>`);
    }
    const zoom = typeof opts.zoom === 'function' ? opts.zoom(W) : opts.zoom || 1;
    container.innerHTML = `<svg width="${W * zoom}" height="${H * zoom}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Circuit diagram">${svg.join('')}</svg>`;
    container.style.height = Math.min(620, Math.max(240, H * zoom + 6)) + 'px';

    const el = container.querySelector('svg');
    el.querySelectorAll('.pin-in').forEach((pin) => {
      const toggle = () => opts.onToggle && opts.onToggle(pin.dataset.input);
      pin.addEventListener('click', toggle);
      pin.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });

    return {
      width: W, height: H, zoom,
      /** Colour every net. env: Map net → 0|1; reveal: show only levels ≤ reveal. */
      setValues(env, reveal) {
        const lvl = gen.level;
        const state = (net) => {
          if (reveal != null && (lvl.get(net) || 0) > reveal) return 'x';
          const v = isConst(net) ? +net : env.get(net);
          return v ? 'hi' : 'lo';
        };
        el.querySelectorAll('[data-net]').forEach((node) => {
          const st = state(node.dataset.net);
          node.classList.toggle('hi', st === 'hi');
          node.classList.toggle('x', st === 'x');
        });
        el.querySelectorAll('.pin-in').forEach((p) => { p.querySelector('.v').textContent = env.get(p.dataset.input) ? '1' : '0'; p.setAttribute('aria-checked', env.get(p.dataset.input) ? 'true' : 'false'); });
        el.querySelectorAll('.led').forEach((p) => {
          const st = state(p.dataset.net);
          p.querySelector('.v').textContent = st === 'x' ? '?' : st === 'hi' ? '1' : '0';
        });
      },
    };
  }

  GL.ui = GL.ui || {};
  GL.ui.renderCircuit = renderCircuit;
})(window.GateLang = window.GateLang || {});
