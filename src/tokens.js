/*
 * GateLang — token definitions (used by Phase 1 and Phase 2)
 *
 * Every module in src/ attaches itself to one global namespace object,
 * `GateLang`. This works the same way in the browser (plain <script> tags,
 * so index.html opens straight from disk) and in Node.js (see src/index.js).
 */
(function (GL) {
  'use strict';

  /** Token types produced by the lexer. */
  const T = Object.freeze({
    KW_INPUT: 'KW_INPUT',
    KW_OUTPUT: 'KW_OUTPUT',
    KW_WIRE: 'KW_WIRE',
    OP_NOT: 'OP_NOT',
    OP_AND: 'OP_AND',
    OP_NAND: 'OP_NAND',
    OP_OR: 'OP_OR',
    OP_NOR: 'OP_NOR',
    OP_XOR: 'OP_XOR',
    OP_XNOR: 'OP_XNOR',
    ASSIGN: 'ASSIGN',     // =
    EQEQ: 'EQEQ',         // ==   (not part of the language; lets the parser explain E216)
    SEMI: 'SEMI',         // ;
    COMMA: 'COMMA',       // ,
    LPAREN: 'LPAREN',     // (
    RPAREN: 'RPAREN',     // )
    CONST: 'CONST',       // 0 or 1
    IDENT: 'IDENT',       // signal name
    ERROR: 'ERROR',       // malformed operand, e.g. 1a or 2 (already reported by the lexer)
    BAD: 'BAD',           // illegal character(s), e.g. @ or ∧ (already reported by the lexer)
    EOF: 'EOF',
  });

  /** Reserved words. Keywords are case-insensitive, so lookup uses UPPERCASE. */
  const KEYWORDS = Object.freeze({
    INPUT: T.KW_INPUT,
    OUTPUT: T.KW_OUTPUT,
    WIRE: T.KW_WIRE,
    NOT: T.OP_NOT,
    AND: T.OP_AND,
    NAND: T.OP_NAND,
    OR: T.OP_OR,
    NOR: T.OP_NOR,
    XOR: T.OP_XOR,
    XNOR: T.OP_XNOR,
  });

  /** Canonical operator name for each operator token type. */
  const OP_NAME = Object.freeze({
    OP_NOT: 'NOT', OP_AND: 'AND', OP_NAND: 'NAND', OP_OR: 'OR',
    OP_NOR: 'NOR', OP_XOR: 'XOR', OP_XNOR: 'XNOR',
  });

  /**
   * Binary precedence levels (lower number = binds more loosely).
   *   1: OR NOR |      2: XOR XNOR ^      3: AND NAND &      (NOT binds tightest)
   */
  const LEVEL_OF_TYPE = Object.freeze({
    OP_OR: 1, OP_NOR: 1, OP_XOR: 2, OP_XNOR: 2, OP_AND: 3, OP_NAND: 3,
  });
  const LEVEL_OF_OP = Object.freeze({ OR: 1, NOR: 1, XOR: 2, XNOR: 2, AND: 3, NAND: 3 });

  const DECL_TYPES = new Set([T.KW_INPUT, T.KW_OUTPUT, T.KW_WIRE]);
  const BINARY_TYPES = new Set(Object.keys(LEVEL_OF_TYPE));
  const OPERAND_START = new Set([T.IDENT, T.CONST, T.LPAREN, T.OP_NOT, T.ERROR]);

  /** Human-readable category, used by the token table in the UI. */
  function category(type) {
    if (DECL_TYPES.has(type)) return 'keyword';
    if (type.startsWith('OP_')) return 'operator';
    if (type === T.IDENT) return 'identifier';
    if (type === T.CONST) return 'constant';
    if (type === T.ERROR || type === T.BAD) return 'error';
    if (type === T.EOF) return 'eof';
    return 'punctuation';
  }

  /** True for tokens written as a word (AND, input…), as opposed to a symbol (&). */
  function isWord(tok) {
    return /^[A-Za-z]/.test(tok.lexeme || '');
  }

  GL.tokens = { T, KEYWORDS, OP_NAME, LEVEL_OF_TYPE, LEVEL_OF_OP, DECL_TYPES, BINARY_TYPES, OPERAND_START, category, isWord };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
