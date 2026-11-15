#!/usr/bin/env node
/*
 * Generates the golden-file test suite in tests/cases/.
 * Error/warning expectations (code@line:col) are snapshotted from the compiler
 * and were reviewed by hand; truth tables of valid circuits are hand-written
 * or checked against arithmetic models, so they are independent of the compiler.
 *   node tools/gen-tests.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const GL = require('../src');
const root = path.join(__dirname, '..', 'tests', 'cases');
for (const d of ['errors', 'warnings', 'valid', 'multi', 'optimizer']) {
  fs.rmSync(path.join(root, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, d), { recursive: true });
}

function snapshot(src, opts) {
  const r = GL.compile(src, opts || {});
  return r.diagnostics.filter((d) => d.code !== 'I502').map((d) => (d.line ? `${d.code}@${d.line}:${d.col}` : d.code)).join(' ') || 'none';
}
function write(dir, name, header, body, opts, snap) {
  const head = header.slice();
  if (opts) head.push('// opts: ' + [opts.opt, opts.target].filter(Boolean).join(' '));
  let text = head.join('\n') + '\n' + body + '\n';
  if (snap) text = '// expect: ' + snapshot('// expect: …\n' + text, opts) + '\n' + text;
  fs.writeFileSync(path.join(root, dir, name + '.gate'), text);
}

let n = 0;
// 1. one file per catalog code
for (const e of GL.catalog.list()) {
  if (!e.example) continue;
  write(e.code[0] === 'E' ? 'errors' : 'warnings', e.code, [`// test: ${e.code} ${e.title}`], e.example, e.opts, true);
  n++;
}

// 2. valid circuits: hand-written truth tables and arithmetic models
const valid = [
  ['half-adder', ['sum: 1,2', 'carry: 3']],
  ['full-adder', ['sum: 1,2,4,7', 'cout: 3,5,6,7']],
  ['mux2', ['y: 3,4,6,7']],
  ['majority', ['y: 3,5,6,7']],
  ['parity', ['p: 1,2,4,7,8,11,13,14']],
  ['decoder', ['y0: 4', 'y1: 5', 'y2: 6', 'y3: 7']],
  ['comparator', ['eq: 0,5,10,15', 'gt: 4,8,9,12,13,14', 'lt: 1,2,3,6,7,11']],
  ['subtractor', ['diff: 1,2,4,7', 'bout: 1,2,3,7']],
  ['qm-demo', ['f: 5,6,7']],
  ['opt-demo', ['f: 1,3,5,6,7', 'g: 4,5,6,7']],
];
for (const [id, mts] of valid) {
  const ex = GL.examples.get(id);
  write('valid', id, [`// test: ${ex.title} (hand-written truth table)`, '// expect: none', ...mts.map((m) => '// minterms ' + m)], ex.source);
  n++;
}
for (const [id, model] of [['rca4', 'adder4'], ['mux4', 'mux4'], ['multiplier', 'mult2'], ['seven-seg', 'sevenseg'], ['alu', 'alu1']]) {
  const ex = GL.examples.get(id);
  write('valid', id, [`// test: ${ex.title}, every row checked against a reference model`, `// expect: ${id === 'seven-seg' ? 'W604' : 'none'}`, `// check: ${model}`], ex.source);
  n++;
}
for (const t of ['nand', 'nor']) {
  write('valid', 'full-adder-' + t, [`// test: full adder mapped to ${t.toUpperCase()}-only gates`, '// expect: none', '// minterms sum: 1,2,4,7', '// minterms cout: 3,5,6,7'],
    GL.examples.get('full-adder').source, { opt: 'O1', target: t });
  n++;
}
write('valid', 'seven-seg-O2', ['// test: 7-segment decoder at -O2 (Quine–McCluskey), still matches the model', '// expect: W604', '// check: sevenseg'], GL.examples.get('seven-seg').source, { opt: 'O2' });
n++;

// 3. several errors in one file
const multi = {
  'error-demo': GL.examples.get('error-demo').source,
  'lex-and-syntax': 'input a, b;\noutput y, z;\ny = a ∧ b\nz = a @@ b;',
  'single-typo-no-cascade': 'input alpha, beta;\noutput y;\ny = alpah AND beta;',
  'loop-and-floating-wire': 'input a, b;\noutput x, y, z;\nwire w;\nx = a AND y;\ny = x OR b;\nz = w;',
  'declaration-forms': 'input a, , b;\noutput y,;\nwire ;\ny = a AND b;',
  'statement-forms': 'input a, b;\noutput y, z;\ny a AND b;\nz == a;\n1 = a;',
  'expression-forms': 'input a, b, c;\noutput p, q, r, s;\np = a AND OR b;\nq = (a OR b;\nr = a NOT b;\ns = OR c;',
  'keyword-misuse': 'input a, wire;\noutput y;\ny = output AND a;\nnot = a;',
  'case-sensitivity': 'input carry, sum_in;\noutput Result;\nresult = carry AND sum_in;\nResult = Carry;',
  'drivers': 'input a, b;\noutput y, z;\ny = a;\ny = b;\ny = a AND b;\na = b;',
  'ten-mistakes': fs.readFileSync(path.join(__dirname, '..', 'examples', 'error_showcase.gate'), 'utf8').trimEnd(),
};
for (const [name, src] of Object.entries(multi)) { write('multi', name, [`// test: several errors in one file (${name})`], src, null, true); n++; }

// 4. optimizer laws (expected gate counts worked out by hand)
const O = (body, inputs) => `input ${inputs || 'a'};\noutput y;\n${body}`;
const opt = [
  ['constant-folding', O('y = a AND (1 XOR 0);'), 0, 'Constant folding, Identity'],
  ['identity-and', O('y = a AND 1;'), 0, 'Identity'],
  ['identity-or', O('y = a OR 0;'), 0, 'Identity'],
  ['identity-xor', O('y = a XOR 0;'), 0, 'Identity'],
  ['identity-xnor', O('y = a XNOR 1;'), 0, 'Identity'],
  ['annihilator-and', O('y = a AND 0;'), 0, 'Annihilator'],
  ['annihilator-or', O('y = a OR 1;'), 0, 'Annihilator'],
  ['annihilator-nand', O('y = a NAND 0;'), 0, 'Annihilator'],
  ['annihilator-nor', O('y = a NOR 1;'), 0, 'Annihilator'],
  ['idempotent-and', O('y = a AND a;'), 0, 'Idempotent'],
  ['idempotent-or', O('y = a OR a;'), 0, 'Idempotent'],
  ['idempotent-nand', O('y = a NAND a;'), 1, 'Idempotent'],
  ['self-inverse-xor', O('y = a XOR a;'), 0, 'Self-inverse'],
  ['complement-and', O('y = a AND NOT a;'), 0, 'Complement'],
  ['complement-or', O('y = a OR NOT a;'), 0, 'Complement'],
  ['involution', O('y = NOT NOT a;'), 0, 'Involution'],
  ['involution-chain', O('y = NOT NOT NOT NOT a;'), 0, 'Involution'],
  ['inversion-xor', O('y = a XOR 1;'), 1, 'Inversion'],
  ['inversion-nor', O('y = a NOR 0;'), 1, 'Inversion'],
  ['absorption-or', O('y = a OR (a AND b);', 'a, b'), 0, 'Absorption'],
  ['absorption-and', O('y = a AND (a OR b);', 'a, b'), 0, 'Absorption'],
  ['negation-fusing-nand', O('y = NOT (a AND b);', 'a, b'), 1, 'Negation fusing'],
  ['negation-fusing-nor', O('y = NOT (a OR b);', 'a, b'), 1, 'Negation fusing'],
  ['negation-fusing-xnor', O('y = NOT (a XOR b);', 'a, b'), 1, 'Negation fusing'],
  ['cse-commutative', O('y = (a AND b) XOR (b AND a) XOR c;', 'a, b, c'), 0, 'CSE, Self-inverse, Identity'],
  ['dead-code', 'input a, b;\noutput y;\nwire t;\nt = a AND b;\ny = NOT a;', 1, 'Dead code'],
  ['o0-baseline', GL.examples.get('opt-demo').source, 9, '', { opt: 'O0' }],
  ['o1-demo', GL.examples.get('opt-demo').source, 2, 'CSE, Idempotent, Involution, Identity, Absorption, Dead code'],
  ['o2-quine-mccluskey', GL.examples.get('qm-demo').source, 3, 'Quine–McCluskey', { opt: 'O2' }],
];
for (const [name, src, gates, laws, o] of opt) {
  write('optimizer', name, [`// test: optimizer, ${name.replace(/-/g, ' ')}`, `// gates: ${gates}`].concat(laws ? [`// laws: ${laws}`] : []), src, o || { opt: 'O1' });
  n++;
}
console.log(`wrote ${n} test files to tests/cases/`);
