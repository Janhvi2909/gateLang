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

  /* ───────────── Phase 2: syntax ───────────── */
  def('E201', 'syntax', 'Missing semicolon',
    'Every statement must end with ;. The parser reached the start of the next statement (or the end of the file) without finding one.',
    'Add ; at the end of the statement.',
    L('input a, b;', 'output x, y;', 'x = a AND b', 'y = a OR b;'));
  def('E202', 'syntax', 'Unclosed parenthesis',
    'An opening ( has no matching ).',
    'Add the missing ) where the group should end.',
    L('input a, b;', 'output y;', 'y = (a AND b;'));
  def('E203', 'syntax', 'Unmatched closing parenthesis',
    'A ) appears without a matching (.',
    'Remove the extra ) or add the missing (.',
    L('input a, b;', 'output y;', 'y = a AND b);'));
  def('E204', 'syntax', 'Missing right operand',
    'A binary operator (or NOT) is not followed by a signal, constant or parenthesised expression.',
    'Add the missing operand, or remove the operator.',
    L('input a;', 'output y;', 'y = a AND ;'));
  def('E205', 'syntax', 'Missing left operand',
    'A binary operator appears at the start of an expression, so it has nothing on its left.',
    'Add the missing operand before the operator.',
    L('input b;', 'output y;', 'y = OR b;'));
  def('E206', 'syntax', 'Missing operator',
    'Two operands are written next to each other with no operator between them.',
    'Insert AND, OR, XOR, NAND, NOR or XNOR between them.',
    L('input a, b;', 'output y;', 'y = a b;'));
  def('E207', 'syntax', 'Empty expression',
    'There is nothing after = (or inside parentheses).',
    'Write an expression, for example y = a AND b;',
    L('input a;', 'output y;', 'y = ;'));
  def('E208', 'syntax', 'Missing =',
    'An assignment must have the form name = expression;. The = sign is missing.',
    'Insert = after the signal name.',
    L('input a, b;', 'output y;', 'y a AND b;'));
  def('E209', 'syntax', 'Invalid assignment target',
    'Only a single declared signal name can appear on the left of =. Constants and expressions cannot be assigned.',
    'Put one output or wire name on the left side.',
    L('input a, b;', 'output y;', 'y = NOT a;', '1 = b;'));
  def('E210', 'syntax', 'Reserved word or constant used as a name',
    'Keywords (input, output, wire, AND, OR, NOT, XOR, NAND, NOR, XNOR) are reserved in any letter case, and constants cannot be names.',
    'Rename the signal, for example and_in instead of and.',
    L('input a, and;', 'output y;', 'y = NOT a;'));
  def('E211', 'syntax', 'Empty declaration',
    'A declaration keyword must be followed by at least one name.',
    'List the names, or delete the line.',
    L('input ;', 'input a;', 'output y;', 'y = NOT a;'));
  def('E212', 'syntax', 'Malformed name list',
    'Names in a declaration must be separated by single commas, with no comma at the end.',
    'Fix the commas, for example input a, b;',
    L('input a, , b;', 'output y;', 'y = a AND b;'));
  def('E213', 'syntax', 'Chained assignment',
    'Only one = is allowed per statement. Writing x = y = a assigns two signals in one statement.',
    'Split it into two statements: y = a; x = y;',
    L('input a;', 'output x, y;', 'x = y = a;'));
  def('E214', 'syntax', 'Unexpected end of file',
    'The file ended in the middle of a statement or expression.',
    'Finish the statement and end it with ;.',
    L('input a, b;', 'output y;', 'y = (a AND'));
  def('E215', 'syntax', 'Invalid statement',
    'A statement must be a declaration (input, output or wire) or an assignment (name = expression;). This also catches misspelt keywords such as outptu.',
    'Start the statement with a declaration keyword or a signal name.',
    L('input a;', 'output y;', 'y = NOT a;', 'AND a;'));
  def('E216', 'syntax', 'Comparison operator ==',
    'GateLang has no comparison operator. Assignment uses a single =.',
    'Use = for assignment, or XNOR to test whether two signals are equal.',
    L('input a;', 'output y;', 'y == NOT a;'));
  def('E217', 'syntax', 'NOT used as a binary operator',
    'NOT takes exactly one operand, written after it. It cannot join two signals.',
    'Write a AND NOT b (or another binary operator) instead of a NOT b.',
    L('input a, b;', 'output y;', 'y = a NOT b;'));
  def('E218', 'syntax', 'Keyword inside an expression',
    'Declaration keywords (input, output, wire) cannot appear inside an expression.',
    'Remove the keyword, or move the declaration to its own statement.',
    L('input a;', 'output y;', 'y = input AND a;'));
  def('E219', 'syntax', 'Expression nested too deeply',
    'Parentheses and NOTs may be nested at most 256 levels deep. The limit protects the recursive-descent parser from stack overflow.',
    'Simplify the expression or split it using wires.',
    L('input a;', 'output y;', 'y = ' + '('.repeat(300) + 'a' + ')'.repeat(300) + ';'));
  def('W201', 'syntax', 'Unclear precedence',
    'AND binds tighter than XOR, which binds tighter than OR. Mixing them without parentheses is legal but easy to misread (like gcc -Wparentheses).',
    'Add parentheses to show the intended grouping.',
    L('input a, b, c;', 'output y;', 'y = a AND b OR c;'));
  def('W202', 'syntax', 'Empty statement',
    'A stray ; with no statement before it is ignored.',
    'Delete the extra semicolon.',
    L('input a;', 'output y;', 'y = NOT a;;'));
  def('W203', 'syntax', 'Non-associative chain',
    'NAND and NOR are not associative: (a NAND b) NAND c differs from a NAND (b NAND c). Chains are parsed left to right.',
    'Add parentheses to make the grouping explicit.',
    L('input a, b, c;', 'output y;', 'y = a NAND b NAND c;'));
  def('W204', 'syntax', 'Redundant parentheses',
    'Parentheses around a single name or constant, or doubled parentheses, have no effect.',
    'Remove them.',
    L('input a;', 'output y;', 'y = NOT ((a));'));

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
