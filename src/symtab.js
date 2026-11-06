/*
 * GateLang — Symbol Table Manager (cross-cutting component)
 *
 * A hash map from signal name to its entry, giving O(1) insert and lookup.
 * GateLang has one global scope (a flat netlist), so no scope stack is needed.
 * The semantic phase fills it in; later phases read it (ICG for temporaries,
 * the optimizer for constant values, code generation for pin lists).
 */
(function (GL) {
  'use strict';

  class SymbolTable {
    constructor() { this.map = new Map(); this.order = []; }

    /** Insert a new symbol; returns the entry. */
    insert(name, kind, span) {
      const entry = {
        name, kind, declaredAt: span,
        drivenAt: [],        // every assignment span (more than one = multiple drivers)
        readAt: [],          // every use inside an expression
        deps: new Set(),     // names this signal's expression reads
        level: kind === 'input' ? 0 : null,
        constValue: null,
        index: this.order.length,
      };
      this.map.set(name, entry);
      this.order.push(name);
      return entry;
    }

    lookup(name) { return this.map.get(name) || null; }
    has(name) { return this.map.has(name); }
    all() { return this.order.map((n) => this.map.get(n)); }
    ofKind(kind) { return this.all().filter((e) => e.kind === kind); }
    names(kind) { return this.ofKind(kind).map((e) => e.name); }
    get size() { return this.map.size; }
  }

  GL.symtab = { SymbolTable };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
