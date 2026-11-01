/*
 * GateLang — error handler (cross-cutting component used by every phase)
 *
 * Collects diagnostics from all phases, applies the reporting policies
 * (warning filters, -Werror, 50-error cap) and formats messages in a
 * Clang/Rust style with the source line and a caret underline.
 */
(function (GL) {
  'use strict';

  const MAX_ERRORS_DEFAULT = 50;

  /** Make a span from a token. Columns are 1-based; endCol is exclusive. */
  function spanOf(tok) {
    if (!tok) return null;
    return { line: tok.line, col: tok.col, endLine: tok.line, endCol: tok.endCol };
  }

  /** Smallest span covering both a and b. */
  function merge(a, b) {
    if (!a) return b; if (!b) return a;
    const startFirst = a.line < b.line || (a.line === b.line && a.col <= b.col);
    const s = startFirst ? a : b;
    const endA = [a.endLine, a.endCol], endB = [b.endLine, b.endCol];
    const e = endA[0] > endB[0] || (endA[0] === endB[0] && endA[1] >= endB[1]) ? a : b;
    return { line: s.line, col: s.col, endLine: e.endLine, endCol: e.endCol };
  }

  class Diagnostics {
    constructor(opts) {
      opts = opts || {};
      this.items = [];
      this.errorCount = 0;
      this.capped = false;
      this.maxErrors = opts.maxErrors || MAX_ERRORS_DEFAULT;
      this.noWarn = new Set(opts.noWarn || []);
      this.werror = !!opts.werror;
      this.phaseErrors = {};
    }

    /**
     * Report a diagnostic.
     * @param {string} code   catalog code, e.g. 'E202'
     * @param {string} message
     * @param {object|null} span  {line, col, endLine, endCol}
     * @param {object} [extra] {hint, related: [{span, label}]}
     */
    add(code, message, span, extra) {
      const entry = GL.catalog.entries[code];
      if (!entry) throw new Error('Unknown diagnostic code ' + code);
      let severity = GL.catalog.severityOf(code);
      if (severity === 'warning' && this.noWarn.has(code)) return null;
      let promoted = false;
      if (severity === 'warning' && this.werror) { severity = 'error'; promoted = true; }
      if (severity === 'error') {
        if (this.capped) return null;
        if (this.errorCount >= this.maxErrors) {
          this.capped = true;
          this._push('E901', 'error', `too many errors; stopping after ${this.maxErrors}`, span, {
            hint: 'fix the first errors and compile again',
          }, entry.phase);
          return null;
        }
        this.errorCount++;
        this.phaseErrors[entry.phase] = (this.phaseErrors[entry.phase] || 0) + 1;
      }
      return this._push(code, severity, message, span, extra || {}, entry.phase, promoted);
    }

    _push(code, severity, message, span, extra, phase, promoted) {
      const entry = GL.catalog.entries[code];
      const d = {
        code, severity, phase: code === 'E901' ? 'internal' : phase, title: entry.title, message,
        line: span ? span.line : 0, col: span ? span.col : 0,
        endLine: span ? span.endLine : 0, endCol: span ? span.endCol : 0,
        hint: extra.hint || null,
        related: (extra.related || []).filter((r) => r && r.span),
        promoted: !!promoted,
        seq: this.items.length,
      };
      this.items.push(d);
      return d;
    }

    hasErrors() { return this.errorCount > 0 || this.capped; }
    errorsIn(phase) { return this.phaseErrors[phase] || 0; }
    count(severity) { return this.items.filter((d) => d.severity === severity).length; }

    /** Diagnostics sorted by position, then severity, then report order. */
    sorted() {
      const rank = { error: 0, warning: 1, info: 2 };
      return this.items.slice().sort((a, b) => {
        const la = a.line || 1e9, lb = b.line || 1e9;
        return la - lb || a.col - b.col || rank[a.severity] - rank[b.severity] || a.seq - b.seq;
      });
    }
  }

  /** Format one diagnostic as text, Rust/Clang style. */
  function format(d, source, filename, color) {
    const paint = (s, c) => (color ? `\x1b[${c}m${s}\x1b[0m` : s);
    const sevColor = d.severity === 'error' ? '31;1' : d.severity === 'warning' ? '33;1' : '36;1';
    const out = [];
    out.push(`${paint(d.severity + '[' + d.code + ']', sevColor)}: ${paint(d.message, '1')}`);
    if (d.line) {
      const lines = source.split('\n');
      const width = String(d.line).length;
      const pad = ' '.repeat(width);
      out.push(`${pad}${paint('-->', '34;1')} ${filename || 'main.gate'}:${d.line}:${d.col}`);
      const text = lines[d.line - 1];
      if (text !== undefined) {
        const shown = text.length > 140 ? text.slice(0, 140) + ' …' : text;
        out.push(`${pad} ${paint('|', '34;1')}`);
        out.push(`${paint(String(d.line), '34;1')} ${paint('|', '34;1')} ${shown}`);
        const len = d.endLine === d.line ? Math.max(1, d.endCol - d.col) : Math.max(1, text.length - d.col + 1);
        const caretCol = Math.min(d.col - 1, shown.length);
        out.push(`${pad} ${paint('|', '34;1')} ${' '.repeat(caretCol)}${paint('^'.repeat(Math.min(len, 80)), sevColor)}`);
      }
      for (const r of d.related) {
        out.push(`${pad} ${paint('=', '34;1')} note: ${r.label} (${r.span.line}:${r.span.col})`);
      }
    }
    if (d.hint) out.push(`${' '.repeat(String(d.line || 0).length)} ${paint('=', '34;1')} hint: ${d.hint}`);
    return out.join('\n');
  }

  GL.diagnostics = { Diagnostics, format, spanOf, merge };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
