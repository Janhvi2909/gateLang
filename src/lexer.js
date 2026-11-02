/*
 * GateLang — Phase 1: Lexical Analysis
 *
 * A hand-written DFA scanner. It reads the source once, character by
 * character (O(n)), using maximal munch, and produces a token list with the
 * line and column of every token. Whitespace and comments are discarded.
 *
 * DFA states (see docs/REPORT): START, IN_IDENT, IN_NUMBER, SAW_SLASH,
 * IN_LINE_COMMENT, IN_BLOCK_COMMENT, SAW_AMP, SAW_PIPE, SAW_EQ.
 *
 * Error recovery: illegal characters are reported, then turned into a BAD
 * token (or skipped, if invisible), and malformed numbers or names become an
 * ERROR token. The parser treats both as already reported, so a single typo
 * never causes a cascade of follow-on errors.
 */
(function (GL) {
  'use strict';

  const MAX_IDENT = 64;

  // Hints for common illegal ASCII characters.
  const ASCII_HINTS = {
    '+': "use OR (or |) for logical OR",
    '*': "use AND (or &) for logical AND",
    '.': "use AND (or &) for logical AND",
    "'": "write NOT a instead of a'",
    '-': "use NOT (or !) for negation",
    ':': "use '=' for assignment",
    '#': "comments start with //",
    '{': "GateLang has no blocks; end each statement with ';'",
    '}': "GateLang has no blocks; end each statement with ';'",
    '[': "GateLang has no buses or arrays; declare each bit as its own signal",
    ']': "GateLang has no buses or arrays; declare each bit as its own signal",
    '<': "GateLang has no comparison operators",
    '>': "GateLang has no comparison operators",
    '"': "GateLang has no strings",
    '\\': "remove the backslash",
  };

  // Hints for Unicode characters often pasted from textbooks or word processors.
  const UNICODE_HINTS = {
    '∧': 'use AND or &', '·': 'use AND or &', '⋅': 'use AND or &', '×': 'use AND or &',
    '∨': 'use OR or |', '¬': 'use NOT or !', '⊕': 'use XOR or ^', '⊻': 'use XOR or ^',
    '⊼': 'use NAND', '↑': 'use NAND', '⊽': 'use NOR', '↓': 'use NOR',
    '⊙': 'use XNOR', '≡': 'use XNOR', '→': 'GateLang has no implication operator; write NOT a OR b',
    '‘': 'curly quote from a word processor; delete it', '’': 'curly quote from a word processor; delete it',
    '“': 'curly quote from a word processor; delete it', '”': 'curly quote from a word processor; delete it',
    '–': 'en dash from a word processor; use NOT for negation', '—': 'em dash from a word processor; use NOT for negation',
  };

  // Invisible characters: reported, but produce no token at all.
  const INVISIBLE = new Set(['\u00A0', '\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF']);

  const isIdentStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
  const isDigit = (c) => c >= '0' && c <= '9';
  const isIdentPart = (c) => isIdentStart(c) || isDigit(c);
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
  const VALID_START = new Set(['/', '&', '|', '^', '!', '~', '=', ';', ',', '(', ')']);
  const isValidStart = (c) => isSpace(c) || isIdentPart(c) || VALID_START.has(c);

  function describe(ch) {
    const cp = ch.codePointAt(0);
    return cp < 33 || INVISIBLE.has(ch) ? 'U+' + cp.toString(16).toUpperCase().padStart(4, '0') : ch;
  }

  /**
   * Tokenize GateLang source.
   * @param {string} src  normalised source (\n line endings, no BOM)
   * @param {Diagnostics} diag
   * @param {object} [opts] {keepComments}
   * @returns {{tokens: object[], comments: object[]}}
   */
  function tokenize(src, diag, opts) {
    const { T, KEYWORDS, OP_NAME } = GL.tokens;
    const tokens = [];
    const comments = [];
    const reportedLong = new Set();
    let i = 0, line = 1, col = 1;
    const n = src.length;

    const adv = () => {
      const c = src[i++];
      if (c === '\n') { line++; col = 1; } else col++;
      return c;
    };
    const span = (sl, sc) => ({ line: sl, col: sc, endLine: sl, endCol: sl === line ? col : sc + 1 });
    const push = (type, start, sl, sc, value) => {
      const tok = { type, lexeme: src.slice(start, i), value, line: sl, col: sc, endCol: sc + (i - start), offset: start };
      tokens.push(tok);
      return tok;
    };

    while (i < n) {
      const c = src[i];
      if (isSpace(c)) { adv(); continue; }
      const s = i, sl = line, sc = col;

      // ── comments and lone slash ──
      if (c === '/') {
        if (src[i + 1] === '/') {
          while (i < n && src[i] !== '\n') adv();
          if (opts && opts.keepComments) comments.push({ offset: s, length: i - s });
          continue;
        }
        if (src[i + 1] === '*') {
          adv(); adv();
          let closed = false;
          while (i < n) {
            if (src[i] === '*' && src[i + 1] === '/') { adv(); adv(); closed = true; break; }
            adv();
          }
          if (opts && opts.keepComments) comments.push({ offset: s, length: i - s });
          if (!closed) {
            diag.add('E104', `comment opened at ${sl}:${sc} is never closed`,
              { line: sl, col: sc, endLine: sl, endCol: sc + 2 }, { hint: 'close it with */' });
          }
          continue;
        }
        adv();
        diag.add('E106', "unexpected '/'; comments start with //", span(sl, sc), { hint: 'use // for a comment, or remove the slash' });
        push(T.BAD, s, sl, sc);
        continue;
      }

      // ── identifiers and keywords (keyword lookup is an O(1) hash-map check) ──
      if (isIdentStart(c)) {
        while (i < n && isIdentPart(src[i])) adv();
        const lex = src.slice(s, i);
        const kw = KEYWORDS[lex.toUpperCase()];
        if (kw) {
          push(kw, s, sl, sc, OP_NAME[kw] || lex.toLowerCase());
        } else {
          if (lex.length > MAX_IDENT && !reportedLong.has(lex)) {
            reportedLong.add(lex);
            diag.add('E107', `identifier '${lex.slice(0, 20)}…' is ${lex.length} characters long; the limit is ${MAX_IDENT}`,
              span(sl, sc), { hint: 'choose a shorter name' });
          }
          push(T.IDENT, s, sl, sc, lex);
        }
        continue;
      }

      // ── constants (maximal munch catches 2, 10, 1a …) ──
      if (isDigit(c)) {
        while (i < n && isIdentPart(src[i])) adv();
        const lex = src.slice(s, i);
        if (lex === '0' || lex === '1') {
          push(T.CONST, s, sl, sc, lex === '1' ? 1 : 0);
        } else if (/^\d+$/.test(lex)) {
          const hint = /^[01]+$/.test(lex)
            ? 'GateLang has no multi-bit numbers; use a separate signal for each bit'
            : 'use 0 or 1';
          diag.add('E102', `'${lex}' is not a valid constant; only single bits 0 and 1 are allowed`, span(sl, sc), { hint });
          push(T.ERROR, s, sl, sc);
        } else {
          const m = lex.match(/^(\d+)(.*)$/);
          diag.add('E103', `'${lex}' is not a valid name: identifiers can't start with a digit`, span(sl, sc),
            { hint: `try '${m[2]}${m[1]}'` });
          push(T.ERROR, s, sl, sc);
        }
        continue;
      }

      // ── operators and punctuation ──
      switch (c) {
        case '&':
          adv();
          if (src[i] === '&') { adv(); diag.add('W101', "'&&' accepted as AND; prefer AND or &", span(sl, sc), { hint: 'write a AND b or a & b' }); }
          push(T.OP_AND, s, sl, sc, 'AND');
          continue;
        case '|':
          adv();
          if (src[i] === '|') { adv(); diag.add('W101', "'||' accepted as OR; prefer OR or |", span(sl, sc), { hint: 'write a OR b or a | b' }); }
          push(T.OP_OR, s, sl, sc, 'OR');
          continue;
        case '^': adv(); push(T.OP_XOR, s, sl, sc, 'XOR'); continue;
        case '!': case '~': adv(); push(T.OP_NOT, s, sl, sc, 'NOT'); continue;
        case '=':
          adv();
          if (src[i] === '=') { adv(); push(T.EQEQ, s, sl, sc); } else push(T.ASSIGN, s, sl, sc);
          continue;
        case ';': adv(); push(T.SEMI, s, sl, sc); continue;
        case ',': adv(); push(T.COMMA, s, sl, sc); continue;
        case '(': adv(); push(T.LPAREN, s, sl, sc); continue;
        case ')': adv(); push(T.RPAREN, s, sl, sc); continue;
        default: break;
      }

      // ── illegal characters ──
      const ch = String.fromCodePoint(src.codePointAt(i));
      if (INVISIBLE.has(ch)) {
        for (let k = 0; k < ch.length; k++) adv();
        diag.add('E105', `invisible character ${describe(ch)} (often pasted from a word processor)`, span(sl, sc),
          { hint: 'replace it with a normal space' });
        continue;
      }
      if (ch.codePointAt(0) > 127) {
        for (let k = 0; k < ch.length; k++) adv();
        diag.add('E105', `'${describe(ch)}' is not a valid character`, span(sl, sc),
          { hint: UNICODE_HINTS[ch] || 'GateLang source must be plain ASCII' });
        push(T.BAD, s, sl, sc);
        continue;
      }
      // merge a run of illegal ASCII characters into one diagnostic
      adv();
      while (i < n && !isValidStart(src[i]) && src.charCodeAt(i) <= 127) adv();
      const run = src.slice(s, i);
      const shown = [...run].map(describe).join('');
      diag.add('E101', run.length === 1 ? `illegal character '${shown}'` : `illegal characters '${shown}'`,
        span(sl, sc), { hint: ASCII_HINTS[run[0]] || 'remove it' });
      push(T.BAD, s, sl, sc);
    }

    tokens.push({ type: T.EOF, lexeme: '', line, col, endCol: col + 1, offset: n });
    return { tokens, comments };
  }

  GL.lexer = { tokenize, MAX_IDENT };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
