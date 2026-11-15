/*
 * GateLang UI — virtualised truth table
 * Only the rows in view are in the DOM, so 65,536-row tables scroll smoothly.
 * Clicking a row sets the simulator's inputs to that row.
 */
(function (GL) {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const RH = 26;

  function renderTable(container, table, opts) {
    opts = opts || {};
    const { inputs, outputs, n } = table;
    const rows = table.displayRows;
    const width = (name) => Math.max(40, name.length * 8.4 + 20);
    const rowW = Math.max(56, String(rows - 1).length * 8.4 + 22);
    const tmpl = [rowW + 'px', ...inputs.map((x) => width(x) + 'px'), ...outputs.map((x) => width(x) + 'px'), '1fr'].join(' ');
    const head = `<div class="tt-head" style="grid-template-columns:${tmpl}"><div>row</div>` +
      inputs.map((x, i) => `<div${i === inputs.length - 1 ? ' class="sep"' : ''} title="input ${esc(x)}">${esc(x)}</div>`).join('') +
      outputs.map((x) => `<div title="output ${esc(x)}" style="color:var(--copper-hi)">${esc(x)}</div>`).join('') + '<div style="border:0"></div></div>';
    container.innerHTML = `<div class="tt">${head}<div class="tt-body" tabindex="0" aria-label="Truth table rows"><div class="tt-spacer" style="height:${rows * RH}px"></div></div></div>`;
    const body = container.querySelector('.tt-body');
    const spacer = container.querySelector('.tt-spacer');
    const bit = GL.simulator.bit;
    let selected = opts.selected != null ? opts.selected : -1;
    let raf = 0;

    function draw() {
      raf = 0;
      const first = Math.max(0, Math.floor(body.scrollTop / RH) - 4);
      const last = Math.min(rows, Math.ceil((body.scrollTop + body.clientHeight) / RH) + 4);
      let html = '';
      for (let r = first; r < last; r++) {
        let cells = `<div class="r">${r}</div>`;
        for (let k = 0; k < n; k++) {
          const v = (r >>> (n - 1 - k)) & 1;
          cells += `<div class="i${v}${k === n - 1 ? ' sep' : ''}">${v}</div>`;
        }
        for (const o of outputs) { const v = bit(table.cols.get(o), r); cells += `<div class="o${v}">${v}</div>`; }
        html += `<div class="tt-row${r === selected ? ' sel' : ''}" data-row="${r}" style="top:${r * RH}px;grid-template-columns:${tmpl}">${cells}<div style="border:0"></div></div>`;
      }
      spacer.innerHTML = html;
    }
    body.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(draw); });
    body.addEventListener('click', (e) => {
      const row = e.target.closest('.tt-row');
      if (row && opts.onRow) opts.onRow(+row.dataset.row);
    });
    draw();
    return {
      select(r, scroll) {
        selected = r;
        if (scroll && r >= 0) {
          const top = r * RH;
          if (top < body.scrollTop || top > body.scrollTop + body.clientHeight - RH) body.scrollTop = Math.max(0, top - body.clientHeight / 2);
        }
        draw();
      },
    };
  }

  GL.ui = GL.ui || {};
  GL.ui.renderTable = renderTable;
})(window.GateLang = window.GateLang || {});
