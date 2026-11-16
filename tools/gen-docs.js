#!/usr/bin/env node
/* Generates docs/ERROR_CATALOG.md from src/catalog.js:  node tools/gen-docs.js */
'use strict';
const fs = require('fs');
const path = require('path');
const GL = require('../src');
const all = GL.catalog.list();
const sev = (c) => GL.catalog.severityOf(c);
const n = { error: 0, warning: 0, info: 0 };
all.forEach((e) => n[sev(e.code)]++);
const out = [];
out.push('# GateLang diagnostic catalog', '');
out.push(`GateLang reports **${all.length} distinct diagnostics**: ${n.error} errors, ${n.warning} warnings and ${n.info} informational notes. `
  + 'Errors stop code generation; warnings and notes never do. Every entry with an example is a complete program that triggers exactly that code, '
  + 'and the test suite checks all of them on every run. This file is generated from `src/catalog.js` by `node tools/gen-docs.js`.', '');
out.push('Code ranges: `1xx` lexical, `2xx` syntax, `3xx` semantic, `5xx` optimization, `6xx` code generation, `9xx` limits and internal checks.', '');
out.push('| Code | Severity | Phase | Title |', '|---|---|---|---|');
for (const e of all) out.push(`| [${e.code}](#${e.code.toLowerCase()}) | ${sev(e.code)} | ${GL.catalog.PHASES[e.phase]} | ${e.title} |`);
out.push('');
for (const [pid, pname] of Object.entries(GL.catalog.PHASES)) {
  out.push(`## ${pname}`, '');
  for (const e of all.filter((x) => x.phase === pid)) {
    out.push(`### ${e.code}`, '', `**${e.title}** (${sev(e.code)})`, '', e.explain, '');
    if (e.fix) out.push(`*How to fix:* ${e.fix}`, '');
    if (e.example) {
      const ex = e.example.length > 500 ? e.example.slice(0, 500) + ' …' : e.example;
      const r = GL.compile(e.example, e.opts || {});
      const d = r.diagnostics.find((x) => x.code === e.code);
      out.push('```', ex, '```', '');
      if (d && ex === e.example) out.push('Compiler output:', '', '```', GL.diagnostics.format(d, r.source, e.code + '.gate'), '```', '');
    }
  }
}
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'ERROR_CATALOG.md'), out.join('\n'));
console.log(`docs/ERROR_CATALOG.md: ${all.length} entries`);
