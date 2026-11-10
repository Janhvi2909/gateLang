/*
 * Node.js entry point: loads every compiler module (in dependency order)
 * onto the shared GateLang namespace and exports it.
 *
 *   const GateLang = require('./src');
 */
'use strict';
const FILES = ['tokens', 'catalog', 'diagnostics', 'lexer', 'ast', 'parser', 'symtab', 'semantic',
  'icg', 'simulator', 'verify', 'qm'];
for (const f of FILES) require('./' + f + '.js');
module.exports = globalThis.GateLang;
