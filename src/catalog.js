/*
 * GateLang — diagnostic catalog
 *
 * Single source of truth for every error (E), warning (W) and info note (I)
 * the compiler can produce. The CLI (--explain), the UI's Catalog tab, the
 * self-test suite and docs/ERROR_CATALOG.md are all generated from this table.
 * Every entry with an `example` is a complete program that triggers that code,
 * which makes the catalog double as a regression test suite.
 */
(function (GL) {
  'use strict';

  const L = (...lines) => lines.join('\n');
  const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  const names = (n) => range(n, (i) => 'x' + i);

  const PHASES = {
    lexical: 'Lexical analysis',
    syntax: 'Syntax analysis',
    semantic: 'Semantic analysis',
    optimization: 'Optimization',
    codegen: 'Code generation',
    internal: 'Limits & internal checks',
  };

  const C = {};
  function def(code, phase, title, explain, fix, example, opts) {
    C[code] = { code, phase, title, explain, fix, example: example || null, opts: opts || null };
  }

  /* ───────────── Phase 1: lexical ───────────── */
  def('E101', 'lexical', 'Illegal character',
    'The character is not part of GateLang. Only letters, digits, _, whitespace and the symbols = ; , ( ) & | ^ ! ~ / are allowed.',
    'Remove the character. If you meant an operator, use AND (&), OR (|), XOR (^) or NOT (!).',
    L('input a, b;', 'output y;', 'y = a @ b;'));
  def('E102', 'lexical', 'Invalid constant',
    'GateLang works with single bits, so the only constants are 0 and 1. Numbers such as 2 or 10 have no meaning.',
    'Replace the number with 0 or 1.',
    L('input a;', 'output y;', 'y = a AND 2;'));
  def('E103', 'lexical', 'Malformed identifier',
    'Signal names must start with a letter or an underscore. A digit is only allowed after the first character.',
    'Move the digits to the end of the name, for example b2 instead of 2b.',
    L('input a;', 'output y;', 'y = a OR 2b;'));
  def('E104', 'lexical', 'Unterminated block comment',
    'A block comment started with /* was never closed with */, so the rest of the file is treated as a comment.',
    'Add */ where the comment should end.',
    L('input a;', 'output y;', 'y = NOT a; /* remember to add the carry'));
  def('E105', 'lexical', 'Unsupported Unicode character',
    'The file contains a non-ASCII character, often a logic symbol from a textbook (∧ ∨ ¬ ⊕) or a curly quote or non-breaking space pasted from a word processor.',
    'Type the GateLang keyword or symbol instead: ∧ → AND, ∨ → OR, ¬ → NOT, ⊕ → XOR.',
    L('input a, b;', 'output y;', 'y = a ∧ b;'));
  def('E106', 'lexical', 'Lone slash',
    'A single / is not an operator. Slashes are only used to start comments (// or /*).',
    'Use // for a comment, or remove the slash.',
    L('input a, b;', 'output y;', 'y = a / b;'));
  def('E107', 'lexical', 'Identifier too long',
    'Signal names are limited to 64 characters to keep netlists, Verilog output and diagrams readable.',
    'Choose a shorter name.',
    L('input this_signal_name_is_much_too_long_to_be_reasonable_in_a_netlist_x;', 'output y;', 'y = NOT this_signal_name_is_much_too_long_to_be_reasonable_in_a_netlist_x;'));
  def('W101', 'lexical', 'C-style operator',
    'The C operators && and || are accepted as AND and OR, but they are not part of the official syntax.',
    'Use AND / & or OR / | instead.',
    L('input a, b;', 'output y;', 'y = a && b;'));

  /* ───────────── limits & internal ───────────── */
  def('E901', 'internal', 'Too many errors',
    'After 50 errors the compiler stops reporting more, because later errors are usually consequences of earlier ones.',
    'Fix the first errors and compile again.',
    L('input a;', 'output y;', 'y = NOT a;', range(60, () => '@').join(' ')));
  def('W900', 'internal', 'Verification fallback',
    'Self-check: the optimized or generated circuit did not match the unoptimized program on every input, so the compiler fell back to the -O0 circuit. This protects you from optimizer bugs; it should never appear in normal use.',
    'Please report the program that caused it.',
    null);

  function severityOf(code) {
    return code[0] === 'E' ? 'error' : code[0] === 'W' ? 'warning' : 'info';
  }

  GL.catalog = { entries: C, PHASES, severityOf, list: () => Object.values(C) };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
