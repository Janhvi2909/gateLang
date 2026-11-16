#!/usr/bin/env node
/*
 * GateLang benchmarks:  node tests/bench.js
 * Measures per-phase compile time and compares bit-parallel truth-table
 * generation with a naive row-by-row interpreter.
 */
'use strict';
const GL = require('../src');
const now = () => performance.now();

function median(fn, runs) {
  const t = [];
  for (let i = 0; i < runs; i++) { const s = now(); fn(); t.push(now() - s); }
  t.sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
}
function rippleAdder(bits) {
  const L = [];
  const ins = [];
  for (let i = 0; i < bits; i++) ins.push('a' + i, 'b' + i);
  L.push(`input ${ins.join(', ')}, cin;`);
  L.push(`output ${Array.from({ length: bits }, (_, i) => 's' + i).join(', ')}, cout;`);
  if (bits > 1) L.push(`wire ${Array.from({ length: bits - 1 }, (_, i) => 'c' + (i + 1)).join(', ')};`);
  for (let i = 0; i < bits; i++) {
    const c = i === 0 ? 'cin' : 'c' + i;
    const co = i === bits - 1 ? 'cout' : 'c' + (i + 1);
    L.push(`s${i} = a${i} XOR b${i} XOR ${c};`);
    L.push(`${co} = (a${i} AND b${i}) OR (${c} AND (a${i} XOR b${i}));`);
  }
  return L.join('\n');
}
function bigProgram(stmts) {
  const L = ['input a, b, c, d;', `output ${Array.from({ length: stmts }, (_, i) => 'y' + i).join(', ')};`];
  const ops = ['AND', 'OR', 'XOR', 'NAND'];
  for (let i = 0; i < stmts; i++) L.push(`y${i} = (a ${ops[i % 4]} b) OR (NOT c ${ops[(i + 1) % 4]} d);`);
  return L.join('\n');
}

const programs = [
  ['Full adder', GL.examples.get('full-adder').source],
  ['4-bit adder', rippleAdder(4)],
  ['8-bit adder (17 inputs)', rippleAdder(8)],
  ['7-segment decoder', GL.examples.get('seven-seg').source],
  ['1,000 statements', bigProgram(1000)],
];

console.log('Per-phase compile time (median of 20 runs, ms)\n');
const cols = ['Lexical', 'Syntax', 'Semantic', 'Intermediate', 'Optimize', 'Codegen', 'Total'];
console.log('Program'.padEnd(26) + cols.map((c) => c.padStart(13)).join(''));
const rows = [];
for (const [name, src] of programs) {
  const times = {};
  const runs = 20;
  const samples = [];
  for (let i = 0; i < runs; i++) samples.push(GL.compile(src, { opt: 'O1' }));
  const ids = ['lexical', 'syntax', 'semantic', 'icg', 'optimization', 'codegen'];
  for (const id of ids) { const v = samples.map((s) => s.timings[id] || 0).sort((a, b) => a - b); times[id] = v[Math.floor(runs / 2)]; }
  const tot = samples.map((s) => s.timings.total).sort((a, b) => a - b)[Math.floor(runs / 2)];
  const last = samples[0];
  rows.push({ name, ...times, total: tot, gates0: last.opt ? last.opt.before.gates : 0, gates1: last.opt ? last.opt.after.gates : 0, n: last.io ? last.io.inputs.length : 0 });
  console.log(name.padEnd(26) + [...ids.map((id) => times[id]), tot].map((v) => v.toFixed(3).padStart(13)).join(''));
}

console.log('\nTruth-table generation: naive row-by-row vs bit-parallel (ms)\n');
console.log('Circuit'.padEnd(26) + 'Rows'.padStart(12) + 'Naive'.padStart(12) + 'Bit-parallel'.padStart(14) + 'Speed-up'.padStart(10));
for (const bits of [4, 6, 8]) {
  const r = GL.compile(rippleAdder(bits), { opt: 'O1' });
  const ops = r.gen.ops, ins = r.io.inputs, outs = r.io.outputs, n = ins.length, rows = 2 ** n;
  const naive = median(() => {
    for (let row = 0; row < rows; row++) {
      const vals = {};
      ins.forEach((x, k) => { vals[x] = (row >>> (n - 1 - k)) & 1; });
      GL.simulator.evalOnce(ops, vals);
    }
  }, 5);
  const fast = median(() => GL.simulator.run(ops, ins, GL.simulator.systematicInputs(n), outs), 5);
  console.log(`${bits}-bit adder (${n} inputs)`.padEnd(26) + rows.toLocaleString('en-US').padStart(12) + naive.toFixed(2).padStart(12) + fast.toFixed(2).padStart(14) + (naive / fast).toFixed(0).padStart(9) + '×');
}

console.log('\nOptimization results (-O0 → -O1 → -O2 gate count)\n');
for (const id of ['opt-demo', 'qm-demo', 'full-adder', 'rca4', 'mux4', 'decoder', 'seven-seg', 'alu']) {
  const g = ['O0', 'O1', 'O2'].map((o) => GL.compile(GL.examples.get(id).source, { opt: o }).opt.after);
  const pct = Math.round((1 - g[2].gates / g[0].gates) * 100);
  console.log(`${GL.examples.get(id).title.padEnd(28)} ${String(g[0].gates).padStart(4)} → ${String(g[1].gates).padStart(4)} → ${String(g[2].gates).padStart(4)}   (−${pct}%)   depth ${g[0].depth} → ${g[2].depth}`);
}
console.log('\nTechnology mapping (gates after -O1: standard / NAND-only / NOR-only, with peephole savings)\n');
for (const id of ['opt-demo', 'full-adder', 'mux2', 'majority', 'rca4']) {
  const s = GL.compile(GL.examples.get(id).source).gen.stats;
  const a = GL.compile(GL.examples.get(id).source, { target: 'nand' }).gen.stats;
  const o = GL.compile(GL.examples.get(id).source, { target: 'nor' }).gen.stats;
  console.log(`${GL.examples.get(id).title.padEnd(28)} ${String(s.gates).padStart(4)} / ${String(a.gates).padStart(3)} (mapped ${a.mapped}) / ${String(o.gates).padStart(3)} (mapped ${o.mapped})`);
}
