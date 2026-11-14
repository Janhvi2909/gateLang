/*
 * GateLang UI — code editor
 *
 * A transparent <textarea> sits on top of a <pre> that shows the same text
 * with syntax colours and error squiggles. The colouring comes from the
 * compiler's own lexer (Phase 1), so the editor and the compiler always agree.
 */
(function (GL) {
  'use strict';

  const esc = (s) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
  const CAT = { keyword: 1, operator: 2, constant: 3, punctuation: 4, error: 5, comment: 6, identifier: 0, eof: 0 };
  const CLS = ['', 'tk-keyword', 'tk-operator', 'tk-constant', 'tk-punctuation', 'tk-error', 'tk-comment'];

  class Editor {
    constructor(root, opts) {
      this.root = root;
      this.opts = opts || {};
      root.innerHTML = '<div class="gutter" aria-hidden="true"></div><div class="code"><pre aria-hidden="true"></pre>' +
        '<textarea spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" wrap="off" aria-label="GateLang source code"></textarea></div>';
      this.gutter = root.querySelector('.gutter');
      this.pre = root.querySelector('pre');
      this.ta = root.querySelector('textarea');
      this.diags = [];
      this.ta.addEventListener('input', () => { this.render(); this.opts.onChange && this.opts.onChange(this.value); });
      this.ta.addEventListener('scroll', () => this.syncScroll());
      this.ta.addEventListener('keydown', (e) => this.onKey(e));
      ['keyup', 'click', 'select'].forEach((ev) => this.ta.addEventListener(ev, () => this.cursorMoved()));
    }

    get value() { return this.ta.value; }
    set value(v) { this.ta.value = v; this.render(); }

    syncScroll() {
      this.pre.scrollTop = this.ta.scrollTop;
      this.pre.scrollLeft = this.ta.scrollLeft;
      this.gutter.scrollTop = this.ta.scrollTop;
    }

    onKey(e) {
      const ta = this.ta;
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        this.insert('  ');
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const before = ta.value.slice(0, ta.selectionStart);
        const indent = (before.split('\n').pop().match(/^\s*/) || [''])[0];
        if (indent) { e.preventDefault(); this.insert('\n' + indent); }
      } else if (e.key === '/' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.toggleComment();
      }
    }

    insert(text) {
      const ta = this.ta;
      const s = ta.selectionStart, en = ta.selectionEnd;
      // execCommand keeps the browser's undo stack working
      if (!document.execCommand || !document.execCommand('insertText', false, text)) {
        ta.value = ta.value.slice(0, s) + text + ta.value.slice(en);
        ta.selectionStart = ta.selectionEnd = s + text.length;
        ta.dispatchEvent(new Event('input'));
      }
    }

    toggleComment() {
      const ta = this.ta, v = ta.value;
      const s = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
      let e = v.indexOf('\n', ta.selectionEnd); if (e < 0) e = v.length;
      const lines = v.slice(s, e).split('\n');
      const all = lines.every((l) => /^\s*\/\//.test(l) || !l.trim());
      const out = lines.map((l) => (all ? l.replace(/^(\s*)\/\/ ?/, '$1') : (l.trim() ? '// ' + l : l))).join('\n');
      ta.setSelectionRange(s, e);
      this.insert(out);
    }

    cursorMoved() {
      const pos = this.ta.selectionStart;
      const before = this.ta.value.slice(0, pos);
      const line = before.split('\n').length;
      const col = pos - before.lastIndexOf('\n');
      if (line !== this.curLine) { this.curLine = line; this.renderGutter(); }
      this.opts.onCursor && this.opts.onCursor(line, col);
    }

    setDiagnostics(diags) { this.diags = diags || []; this.render(); }

    lineStarts(text) {
      const starts = [0];
      for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
      return starts;
    }

    render() {
      const text = this.ta.value.replace(/\r\n?/g, '\n');
      const n = text.length;
      const cat = new Uint8Array(n);
      const sq = new Uint8Array(n);
      // token colours from the real lexer
      const silent = new GL.diagnostics.Diagnostics({ maxErrors: 1e9 });
      const { tokens, comments } = GL.lexer.tokenize(text.replace(/^\uFEFF/, ''), silent, { keepComments: true });
      for (const t of tokens) {
        const c = CAT[GL.tokens.category(t.type)] || 0;
        if (!c) continue;
        cat.fill(c, t.offset, Math.min(n, t.offset + t.lexeme.length));
      }
      for (const c of comments) cat.fill(6, c.offset, Math.min(n, c.offset + c.length));
      // squiggles from the last compile
      const starts = this.lineStarts(text);
      const points = new Map();
      for (const d of this.diags) {
        if (!d.line || d.severity === 'info') continue;
        const v = d.severity === 'error' ? 2 : 1;
        const a = (starts[d.line - 1] ?? n) + d.col - 1;
        const lineEnd = d.line < starts.length ? starts[d.line] - 1 : n;
        let b = d.endLine === d.line ? (starts[d.line - 1] ?? n) + d.endCol - 1 : lineEnd;
        b = Math.min(b, lineEnd);
        if (a >= lineEnd || a >= n) { points.set(Math.min(a, lineEnd), Math.max(points.get(a) || 0, v)); continue; }
        for (let i = a; i < Math.max(b, a + 1) && i < n; i++) if (text[i] !== '\n') sq[i] = Math.max(sq[i], v);
      }
      // build HTML from runs of equal (colour, squiggle)
      let html = '';
      let i = 0;
      while (i < n) {
        if (points.has(i)) html += `<span class="sq-point"></span>`;
        let j = i + 1;
        while (j < n && cat[j] === cat[i] && sq[j] === sq[i] && !points.has(j)) j++;
        const cls = [CLS[cat[i]], sq[i] === 2 ? 'sq-e' : sq[i] === 1 ? 'sq-w' : ''].filter(Boolean).join(' ');
        const chunk = esc(text.slice(i, j));
        html += cls ? `<span class="${cls}">${chunk}</span>` : chunk;
        i = j;
      }
      if (points.has(n)) html += `<span class="sq-point"></span>`;
      this.pre.innerHTML = html + '\n\n';
      this.lineCount = starts.length;
      this.renderGutter();
      this.syncScroll();
    }

    renderGutter() {
      const marks = new Map();
      const titles = new Map();
      for (const d of this.diags) {
        if (!d.line || d.severity === 'info') continue;
        const m = d.severity === 'error' ? 'e' : 'w';
        if (marks.get(d.line) !== 'e') marks.set(d.line, m);
        titles.set(d.line, (titles.get(d.line) ? titles.get(d.line) + '\n' : '') + `${d.code}: ${d.message}`);
      }
      let html = '';
      for (let l = 1; l <= (this.lineCount || 1); l++) {
        const cls = [marks.get(l) || '', l === this.curLine ? 'cur' : ''].filter(Boolean).join(' ');
        const t = titles.get(l);
        html += `<div${cls ? ` class="${cls}"` : ''}${t ? ` title="${t.replace(/"/g, '&quot;')}"` : ''}>${l}</div>`;
      }
      this.gutter.innerHTML = html + '<div></div><div></div>';
      this.gutter.scrollTop = this.ta.scrollTop;
    }

    /** Select a range by line/column and scroll it into view. */
    select(line, col, endLine, endCol) {
      const text = this.ta.value;
      const starts = this.lineStarts(text);
      const a = Math.min(text.length, (starts[line - 1] ?? 0) + Math.max(0, col - 1));
      let b = endLine === line && endCol ? (starts[line - 1] ?? 0) + endCol - 1 : a + 1;
      b = Math.min(Math.max(b, a), text.length);
      this.ta.focus();
      this.ta.setSelectionRange(a, b);
      const lh = parseFloat(getComputedStyle(this.ta).lineHeight) || 22;
      const target = (line - 1) * lh;
      if (target < this.ta.scrollTop || target > this.ta.scrollTop + this.ta.clientHeight - lh * 2) {
        this.ta.scrollTop = Math.max(0, target - this.ta.clientHeight / 3);
      }
      this.syncScroll();
      this.cursorMoved();
    }
  }

  GL.ui = GL.ui || {};
  GL.ui.Editor = Editor;
})(window.GateLang = window.GateLang || {});
