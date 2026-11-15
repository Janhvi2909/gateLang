#!/usr/bin/env node
/*
 * GateLang test runner
 *
 *   node tests/run-tests.js          golden files + self-tests + quick fuzz
 *   node tests/run-tests.js --full   same, with 10,000-program fuzzing
 *
 * Golden-file directives (comments at the top of each .gate file):
 *   // expect: E202@3:5 W201@3:6   exact diagnostics (I502 ignored), or "none"
 *   // opts: O2 nand               optimization level and target
 *   // gates: 3                    gate count after optimization
 *   // laws: Involution, CSE       laws that must appear in the optimization log
 *   // minterms f: 1,3,5           rows where output f is 1 (hand-written)
 *   // check: adder4 | mux4        compare every row with an arithmetic model
 */
'use strict';
const fs = require('fs');
const path = require('path');
const GL = require('../src');

const full = process.argv.includes('--full');
const casesDir = path.join(__dirname, 'cases');
const color = process.stdout.isTTY;
const green = (s) => (color ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s) => (color ? `\x1b[31m${s}\x1b[0m` : s);
const dim = (s) => (color ? `\x1b[2m${s}\x1b[0m` : s);

function directives(src) {
  const d = { minterms: {} };
  for (const line of src.split('\n')) {
    const m = line.match(/^\/\/\s*(expect|opts|gates|laws|minterms|check)(?:\s+(\w+))?:\s*(.*)$/);
    if (!m) continue;
    if (m[1] === 'minterms') d.minterms[m[2]] = m[3].split(',').map((x) => +x.trim()).filter((x) => !isNaN(x));
    else d[m[1]] = m[3].trim();
  }
  return d;
}

function rowsWhere(r, out) {
  const t = r.table, list = [];
  for (let row = 0; row < t.rows; row++) if (GL.simulator.bit(t.cols.get(out), row)) list.push(row);
  return list;
}
function val(r, name, row) {
  const k = r.table.inputs.indexOf(name), n = r.table.inputs.length;
  if (k >= 0) return (row >>> (n - 1 - k)) & 1;
  return GL.simulator.bit(r.table.cols.get(name), row);
}
const MODELS = {
  adder4(r) {
    for (let row = 0; row < r.table.rows; row++) {
      const v = (nm) => val(r, nm, row);
      const A = v('a0') + 2 * v('a1') + 4 * v('a2') + 8 * v('a3');
      const B = v('b0') + 2 * v('b1') + 4 * v('b2') + 8 * v('b3');
      const S = v('s0') + 2 * v('s1') + 4 * v('s2') + 8 * v('s3') + 16 * v('cout');
      if (S !== A + B + v('cin')) return `row ${row}: ${A}+${B}+${v('cin')} gave ${S}`;
    }
    return null;
  },
  mult2(r) {
    for (let row = 0; row < r.table.rows; row++) {
      const v = (nm) => val(r, nm, row);
      const A = 2 * v('a1') + v('a0'), B = 2 * v('b1') + v('b0');
      const P = 8 * v('p3') + 4 * v('p2') + 2 * v('p1') + v('p0');
      if (P !== A * B) return `row ${row}: ${A}×${B} gave ${P}`;
    }
    return null;
  },
  sevenseg(r) {
    const SEG = { a: [0, 2, 3, 5, 6, 7, 8, 9], b: [0, 1, 2, 3, 4, 7, 8, 9], c: [0, 1, 3, 4, 5, 6, 7, 8, 9], d: [0, 2, 3, 5, 6, 8, 9], e: [0, 2, 6, 8], f: [0, 4, 5, 6, 8, 9], g: [2, 3, 4, 5, 6, 8, 9] };
    for (let row = 0; row < 16; row++) {
      for (const [s, on] of Object.entries(SEG)) {
        if (val(r, 'seg_' + s, row) !== (on.includes(row) ? 1 : 0)) return `digit ${row}, segment ${s} is wrong`;
      }
    }
    return null;
  },
  alu1(r) {
    for (let row = 0; row < r.table.rows; row++) {
      const v = (nm) => val(r, nm, row);
      const a = v('a'), b = v('b'), c = v('cin'), op = 2 * v('s1') + v('s0');
      const want = [a & b, a | b, a ^ b, a ^ b ^ c][op];
      const carry = op === 3 ? (a & b) | (c & (a ^ b)) : 0;
      if (v('result') !== want || v('cout') !== carry) return `row ${row}: op ${op} wrong`;
    }
    return null;
  },
  mux4(r) {
    for (let row = 0; row < r.table.rows; row++) {
      const v = (nm) => val(r, nm, row);
      const sel = 2 * v('s1') + v('s0');
      if (v('y') !== v('d' + sel)) return `row ${row}: y should equal d${sel}`;
    }
    return null;
  },
};

function runGolden(file) {
  const src = fs.readFileSync(file, 'utf8');
  const d = directives(src);
  const opts = {};
  if (d.opts) for (const w of d.opts.split(/\s+/)) { if (/^O[012]$/.test(w)) opts.opt = w; else if (w) opts.target = w; }
  const r = GL.compile(src, opts);
  const problems = [];
  if (d.expect !== undefined) {
    const got = r.diagnostics.filter((x) => x.code !== 'I502').map((x) => (x.line ? `${x.code}@${x.line}:${x.col}` : x.code));
    const want = d.expect === 'none' ? [] : d.expect.split(/\s+/);
    const a = got.slice().sort().join(' '), b = want.slice().sort().join(' ');
    if (a !== b) problems.push(`expected [${want.join(' ')}] got [${got.join(' ')}]`);
  }
  if (d.gates !== undefined && (!r.opt || r.opt.after.gates !== +d.gates)) problems.push(`expected ${d.gates} gates, got ${r.opt ? r.opt.after.gates : 'n/a'}`);
  if (d.laws) {
    const fired = new Set((r.opt ? r.opt.log : []).map((l) => l.law));
    for (const law of d.laws.split(',').map((s) => s.trim())) if (!fired.has(law)) problems.push(`law '${law}' did not fire`);
  }
  for (const [out, mts] of Object.entries(d.minterms)) {
    if (!r.table) { problems.push('no truth table'); break; }
    const got = rowsWhere(r, out).join(',');
    if (got !== mts.join(',')) problems.push(`${out}: expected Σm(${mts.join(',')}) got Σm(${got})`);
  }
  if (d.check) { const msg = r.table ? MODELS[d.check](r) : 'no truth table'; if (msg) problems.push(msg); }
  if (r.opt && !r.opt.verify.ok) problems.push('optimizer verification failed');
  if (r.gen && !r.gen.verify.ok) problems.push('codegen verification failed');
  return problems;
}

const t0 = Date.now();
const sections = [];
let passed = 0, failed = 0;
for (const dir of ['valid', 'errors', 'warnings', 'multi', 'optimizer']) {
  const files = fs.readdirSync(path.join(casesDir, dir)).filter((f) => f.endsWith('.gate')).sort();
  let ok = 0;
  const fails = [];
  for (const f of files) {
    const p = runGolden(path.join(casesDir, dir, f));
    if (p.length) fails.push(`${dir}/${f}: ${p.join('; ')}`); else ok++;
  }
  sections.push({ name: `golden/${dir}`, ok, total: files.length, fails });
  passed += ok; failed += files.length - ok;
}
const S = GL.selftest;
const groups = [
  ['catalog examples', S.catalogTests()],
  ['example circuits', S.exampleTests()],
  ['robustness', S.robustnessTests()],
  ['safety net', S.faultTests()],
  ['equivalence fuzz', S.fuzzEquivalence(full ? 10000 : 1000, 4242)],
  ['crash fuzz', S.fuzzCrash(full ? 10000 : 2000, 777)],
];
for (const [name, res] of groups) {
  const ok = res.filter((x) => x.ok).length;
  sections.push({ name, ok, total: res.length, fails: res.filter((x) => !x.ok).map((x) => `${x.name}: ${x.detail}`), detail: res.length === 1 ? res[0].detail : '' });
  passed += ok; failed += res.length - ok;
}

console.log('\nGateLang test suite' + (full ? ' (full)' : ''));
console.log('─'.repeat(60));
for (const s of sections) {
  const mark = s.ok === s.total ? green('✔') : red('✘');
  console.log(`${mark} ${s.name.padEnd(22)} ${String(s.ok).padStart(4)}/${String(s.total).padEnd(4)} ${dim(s.detail || '')}`);
  for (const f of s.fails) console.log('    ' + red(f));
}
console.log('─'.repeat(60));
console.log(`${failed ? red('FAILED') : green('PASSED')}  ${passed}/${passed + failed} checks in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failed ? 1 : 0);
