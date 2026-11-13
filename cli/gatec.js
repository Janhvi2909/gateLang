#!/usr/bin/env node
/*
 * gatec — the GateLang command-line compiler
 *
 *   node cli/gatec.js FILE.gate [options]
 *
 * Options
 *   -O0 | -O1 | -O2          optimization level (default -O1)
 *   --target=std|nand|nor    target gate library (default std)
 *   --emit=WHAT              tokens | ast | symtab | tac | opt | netlist | verilog | table | all
 *   -o FILE                  write the emitted output to FILE
 *   -Werror                  treat warnings as errors
 *   --no-warn=W301,W201      silence specific warnings
 *   --explain=E309           describe a diagnostic code
 *   --timings                print the time spent in each phase
 *   --no-color               plain output
 */
'use strict';
const fs = require('fs');
const path = require('path');
const GL = require('../src');

const args = process.argv.slice(2);
const opt = { opt: 'O1', target: 'std', emit: 'netlist', noWarn: [], werror: false, timings: false, out: null };
let file = null;
let color = process.stdout.isTTY && !args.includes('--no-color');

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/^-O[012]$/.test(a)) opt.opt = a.slice(1);
  else if (a.startsWith('--target=')) opt.target = a.split('=')[1];
  else if (a.startsWith('--emit=')) opt.emit = a.split('=')[1];
  else if (a === '-o') opt.out = args[++i];
  else if (a === '-Werror') opt.werror = true;
  else if (a.startsWith('--no-warn=')) opt.noWarn = a.split('=')[1].split(',');
  else if (a === '--timings') opt.timings = true;
  else if (a === '--no-color') color = false;
  else if (a.startsWith('--explain=')) { explain(a.split('=')[1]); process.exit(0); }
  else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
  else if (!a.startsWith('-')) file = a;
  else { console.error(`gatec: unknown option ${a}`); process.exit(2); }
}

function usage() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 19).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
}
function explain(code) {
  const e = GL.catalog.entries[(code || '').toUpperCase()];
  if (!e) { console.error(`gatec: no diagnostic ${code}`); process.exit(2); }
  console.log(`${e.code}  ${e.title}  (${GL.catalog.PHASES[e.phase]}, ${GL.catalog.severityOf(e.code)})\n`);
  console.log(e.explain + '\n');
  if (e.fix) console.log('How to fix: ' + e.fix + '\n');
  if (e.example && e.example.length < 400) console.log('Example:\n' + e.example.split('\n').map((l) => '    ' + l).join('\n'));
}

if (!file) { usage(); process.exit(2); }
if (!['std', 'nand', 'nor'].includes(opt.target)) { console.error('gatec: --target must be std, nand or nor'); process.exit(2); }
const source = fs.readFileSync(file, 'utf8');
const r = GL.compile(source, { opt: opt.opt, target: opt.target, filename: path.basename(file), noWarn: opt.noWarn, werror: opt.werror });

// diagnostics → stderr
for (const d of r.diagnostics) console.error(GL.diagnostics.format(d, r.source, file, color) + '\n');

function table() {
  if (!r.table) return '(truth table not available)';
  const t = r.table;
  const head = [...t.inputs, '|', ...t.outputs].join(' ');
  const lines = [head, '-'.repeat(head.length)];
  const limit = Math.min(t.rows, 1024);
  for (let row = 0; row < limit; row++) {
    const ins = t.inputs.map((n, k) => String((row >>> (t.n - 1 - k)) & 1).padStart(n.length));
    const outs = t.outputs.map((o) => String(GL.simulator.bit(t.cols.get(o), row)).padStart(o.length));
    lines.push([...ins, '|', ...outs].join(' '));
  }
  if (t.rows > limit) lines.push(`… ${t.rows - limit} more rows`);
  return lines.join('\n');
}
const emitters = {
  tokens: () => r.tokens.map((t) => `${String(t.line).padStart(4)}:${String(t.col).padEnd(4)} ${t.type.padEnd(10)} ${t.lexeme}`).join('\n'),
  ast: () => JSON.stringify(r.ast, (k, v) => (k === 'span' || k === 'opSpan' || k === 'kwSpan' ? undefined : v), 2),
  symtab: () => r.sem.symtab.all().map((e) => `${e.name.padEnd(12)} ${e.kind.padEnd(7)} declared ${e.declaredAt.line}:${e.declaredAt.col}  driven ${e.drivenAt.length}  read ${e.readAt.length}  level ${e.level ?? '-'}  deps {${[...e.deps].join(', ')}}`).join('\n'),
  tac: () => r.tac ? r.tac.quads.map(GL.icg.quadText).join('\n') : '(not generated)',
  opt: () => r.opt ? r.opt.quads.map(GL.icg.quadText).join('\n') + '\n\n' + r.opt.log.map((l) => `[${l.law}] ${l.before}  →  ${l.after}`).join('\n') : '(not generated)',
  netlist: () => r.gen ? r.gen.netlist : '(not generated)',
  verilog: () => r.gen ? r.gen.verilog : '(not generated)',
  table,
};
emitters.all = () => ['tokens', 'symtab', 'tac', 'opt', 'netlist', 'verilog', 'table'].map((k) => `===== ${k} =====\n${emitters[k]()}`).join('\n\n');
if (!emitters[opt.emit]) { console.error(`gatec: unknown --emit=${opt.emit}`); process.exit(2); }
if (r.ok || ['tokens', 'ast', 'symtab'].includes(opt.emit)) {
  const text = emitters[opt.emit]();
  if (opt.out) fs.writeFileSync(opt.out, text + '\n'); else console.log(text);
}
if (opt.timings) {
  console.error(r.phases.map((p) => `${p.short.padEnd(13)} ${p.ms == null ? 'skipped' : p.ms.toFixed(3) + ' ms'}`).join('\n') + `\n${'Total'.padEnd(13)} ${r.timings.total.toFixed(3)} ms`);
}
const summary = `${r.counts.error} error(s), ${r.counts.warning} warning(s)`;
console.error(r.ok ? `gatec: compiled ${file} — ${summary}` : `gatec: compilation failed — ${summary}`);
process.exit(r.ok ? 0 : 1);
