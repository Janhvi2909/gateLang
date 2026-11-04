/*
 * GateLang — Phase 2: Syntax Analysis
 *
 * LL(1) recursive-descent parser: one method per grammar rule.
 *
 *   program      ::= { statement } EOF
 *   statement    ::= declaration | assignment
 *   declaration  ::= ( "input" | "output" | "wire" ) id_list ";"
 *   id_list      ::= IDENT { "," IDENT }
 *   assignment   ::= IDENT "=" expr ";"
 *   expr         ::= or_expr
 *   or_expr      ::= xor_expr { ( OR | NOR ) xor_expr }
 *   xor_expr     ::= and_expr { ( XOR | XNOR ) and_expr }
 *   and_expr     ::= unary { ( AND | NAND ) unary }
 *   unary        ::= NOT unary | primary
 *   primary      ::= IDENT | CONST | "(" expr ")"
 *
 * Error recovery
 *   • Panic mode   – on an unexpected token, skip to the next ';' or the start
 *                    of the next statement, then continue (SyncError).
 *   • Phrase level – a missing ';' before the next statement is reported, and
 *                    parsing continues as if it were there.
 *   • Error productions – common mistakes (a NOT b, x = y = z, ==, out a AND b,
 *                    misspelt keywords) are recognised and explained.
 */
(function (GL) {
  'use strict';

  const MAX_DEPTH = 256;

  class SyncError extends Error {
    constructor(line) { super('sync'); this.line = line; this.partial = null; }
  }

  /** Edit distance (optimal string alignment: insert, delete, substitute, swap). */
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (Math.abs(m - n) > 3) return 99;
    const d = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        // a swap of two neighbouring letters counts as one edit (sle → sel)
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[m][n];
  }

  class Parser {
    constructor(tokens, diag) {
      this.t = tokens;
      this.pos = 0;
      this.diag = diag;
      this.depth = 0;
      this.stmtFlags = {};
      this.errorsBefore = diag.errorCount;
      const { T } = GL.tokens;
      this.T = T;
    }

    /* ───── token helpers ───── */
    peek(k) { return this.t[Math.min(this.pos + (k || 0), this.t.length - 1)]; }
    prev() { return this.t[Math.max(0, this.pos - 1)]; }
    at(type) { return this.peek().type === type; }
    next() { const tok = this.t[this.pos]; if (tok.type !== this.T.EOF) this.pos++; return tok; }
    span(tok) { return GL.diagnostics.spanOf(tok); }
    afterPrev() { const p = this.prev(); return { line: p.line, col: p.endCol, endLine: p.line, endCol: p.endCol + 1 }; }
    err(code, msg, span, extra) { this.diag.add(code, msg, span, extra); }
    fail() { throw new SyncError(this.peek().line); }

    isBinary(tok) { return GL.tokens.BINARY_TYPES.has(tok.type); }
    isOperandStart(tok) { return GL.tokens.OPERAND_START.has(tok.type); }
    isDecl(tok) { return GL.tokens.DECL_TYPES.has(tok.type); }
    isKeywordWord(tok) { return (this.isDecl(tok) || tok.type.startsWith('OP_')) && GL.tokens.isWord(tok); }

    enter(tok) {
      this.depth++;
      if (this.depth > MAX_DEPTH) {
        this.err('E219', `expression nests deeper than ${MAX_DEPTH} levels`, this.span(tok),
          { hint: 'simplify the expression or split it using wires' });
        this.fail();
      }
    }
    leave() { this.depth--; }

    /* ───── program & statements ───── */
    parseProgram() {
      const T = this.T;
      const statements = [];
      while (!this.at(T.EOF)) {
        const start = this.pos;
        this.stmtFlags = {};
        try {
          const s = this.parseStatement();
          if (Array.isArray(s)) statements.push(...s); else if (s) statements.push(s);
        } catch (e) {
          if (!(e instanceof SyncError)) throw e;
          if (e.partial) statements.push(e.partial);
          this.synchronize(e.line);
        }
        if (this.pos === start && !this.at(T.EOF)) this.next(); // always make progress
      }
      return { kind: 'Program', statements };
    }

    /** Panic-mode recovery: skip to a safe point. */
    synchronize(errLine) {
      const T = this.T;
      this.depth = 0;
      while (!this.at(T.EOF)) {
        const tok = this.peek();
        if (tok.type === T.SEMI) { this.next(); return; }
        if (this.isDecl(tok) && this.peek(1).type !== T.ASSIGN) return;
        if (tok.type === T.IDENT && tok.line > errLine && (this.peek(1).type === T.ASSIGN || this.peek(1).type === T.EQEQ)) return;
        this.next();
      }
    }

    parseStatement() {
      const T = this.T;
      const tok = this.peek(), nxt = this.peek(1);

      if (this.isDecl(tok)) {
        if (nxt.type === T.ASSIGN) {
          this.err('E210', `'${tok.lexeme}' is a reserved keyword and can't be a signal name`, this.span(tok),
            { hint: `rename it, for example ${tok.lexeme.toLowerCase()}_sig` });
          this.next(); const eq = this.next();
          return this.parseAssignmentRHS({ name: null, span: this.span(tok) }, eq, true);
        }
        const kw = this.next();
        return this.parseDeclarationBody(kw.lexeme.toLowerCase(), kw);
      }
      switch (tok.type) {
        case T.IDENT: return this.parseIdentStatement();
        case T.SEMI:
          this.next();
          this.err('W202', 'empty statement ignored', this.span(tok), { hint: 'delete the extra semicolon' });
          return null;
        case T.BAD: this.next(); return null; // already reported by the lexer
        case T.ERROR:
          this.next();
          if (this.at(T.ASSIGN) || this.at(T.EQEQ)) {
            const eq = this.next();
            return this.parseAssignmentRHS({ name: null, span: this.span(tok) }, eq, true);
          }
          this.fail();
          break;
        case T.RPAREN:
          this.next();
          this.err('E203', "unmatched ')'", this.span(tok), { hint: "remove it or add the missing '('" });
          return null;
        default: break;
      }
      if (this.isKeywordWord(tok) && nxt.type === T.ASSIGN) {
        this.err('E210', `'${tok.lexeme}' is a reserved keyword and can't be a signal name`, this.span(tok),
          { hint: `rename it, for example ${tok.lexeme.toLowerCase()}_out` });
        this.next(); const eq = this.next();
        return this.parseAssignmentRHS({ name: null, span: this.span(tok) }, eq, true);
      }
      if (tok.type === T.CONST || tok.type === T.LPAREN || tok.type === T.OP_NOT) {
        const e = this.parseExpr();
        if (this.at(T.ASSIGN) || this.at(T.EQEQ)) {
          const msg = e.kind === 'Constant' && !e.parens
            ? `the constant '${e.value}' can't be assigned; the left side of '=' must be a signal name`
            : 'the left side of \'=\' must be a single signal name';
          this.err('E209', msg, e.span, { hint: 'put one output or wire name on the left side' });
          const eq = this.next();
          return this.parseAssignmentRHS({ name: null, span: e.span }, eq, true);
        }
        this.err('E215', "this expression isn't a statement; expected 'name = expression;'", e.span,
          { hint: 'assign it to an output, e.g. y = …;' });
        this.expectStatementEnd(e);
        return null;
      }
      this.err('E215', `a statement can't start with '${tok.lexeme}'`, this.span(tok),
        { hint: 'statements start with input, output, wire or a signal name' });
      this.next();
      this.fail();
      return null;
    }

    parseIdentStatement() {
      const T = this.T;
      const id = this.next();
      const target = { name: id.lexeme, span: this.span(id) };
      const n = this.peek();

      if (n.type === T.ASSIGN) { this.next(); return this.parseAssignmentRHS(target, n, false); }
      if (n.type === T.EQEQ) {
        this.err('E216', "GateLang uses '=' for assignment; '==' is not an operator", this.span(n),
          { hint: 'use =, or XNOR to test whether two signals are equal' });
        this.next();
        return this.parseAssignmentRHS(target, n, false);
      }
      // misspelt declaration keyword: outptu y;
      if (n.type === T.IDENT || n.type === T.COMMA || n.type === T.SEMI) {
        const low = id.lexeme.toLowerCase();
        const kw = ['input', 'output', 'wire'].find((k) => low.length >= 3 && levenshtein(low, k) <= 2);
        if (kw && (n.type !== T.SEMI)) {
          this.err('E215', `'${id.lexeme}' is not a keyword; did you mean '${kw}'?`, this.span(id),
            { hint: `write '${kw} ${n.type === T.IDENT ? n.lexeme : '…'};'` });
          return this.parseDeclarationBody(kw, id);
        }
      }
      if (this.isBinary(n)) {
        this.pos--; // re-read the identifier as the start of an expression
        const e = this.parseExpr();
        if (this.at(T.ASSIGN) || this.at(T.EQEQ)) {
          this.err('E209', "the left side of '=' must be a single signal name", e.span,
            { hint: 'put one output or wire name on the left side' });
          const eq = this.next();
          return this.parseAssignmentRHS({ name: null, span: e.span }, eq, true);
        }
        this.err('E215', "this expression isn't a statement; expected 'name = expression;'", e.span,
          { hint: 'assign it to an output, e.g. y = …;' });
        this.expectStatementEnd(e);
        return null;
      }
      if (this.isOperandStart(n)) {
        this.err('E208', `expected '=' after '${id.lexeme}'`, this.afterPrev(), { hint: `write '${id.lexeme} = …;'` });
        return this.parseAssignmentRHS(target, null, false);
      }
      this.err('E208', `expected '=' after '${id.lexeme}'`, this.afterPrev(), { hint: `write '${id.lexeme} = …;'` });
      const e = new SyncError(n.line);
      e.partial = { kind: 'Assignment', target, expr: null, broken: true, span: target.span };
      throw e;
    }

    parseAssignmentRHS(target, eqTok, poisoned) {
      const T = this.T;
      const mk = (expr, broken) => ({
        kind: 'Assignment', target: poisoned ? null : target, expr, broken: !!broken, poisoned: !!poisoned,
        span: GL.diagnostics.merge(target.span, expr ? expr.span : target.span),
      });
      if (this.at(T.SEMI)) {
        this.err('E207', `assignment to '${target.name || '?'}' has no expression`, this.span(this.peek()),
          { hint: 'write an expression, e.g. y = a AND b;' });
        this.next();
        return mk(null, true);
      }
      if (this.at(T.EOF)) {
        this.err('E214', 'the file ended in the middle of an assignment', this.afterPrev(), { hint: 'finish the statement and end it with ;' });
        return mk(null, true);
      }
      try {
        const expr = this.parseExpr();
        const extra = this.expectStatementEnd(expr, target);
        const main = mk(expr, false);
        return extra ? [main, extra] : main;
      } catch (e) {
        if (e instanceof SyncError && !e.partial) e.partial = mk(null, true);
        throw e;
      }
    }

    /** Called after a complete expression: requires ';'. Returns an extra statement for x = y = a recovery. */
    expectStatementEnd(expr, target) {
      const T = this.T;
      const tok = this.peek(), prev = this.prev();
      switch (tok.type) {
        case T.SEMI: this.next(); return null;
        case T.ASSIGN: {
          this.err('E213', "only one '=' is allowed per statement", this.span(tok),
            { hint: 'assign each signal in its own statement' });
          if (expr && expr.kind === 'Identifier' && !expr.parens) {
            // recover as two assignments: x = y; y = rhs;
            this.next();
            const rhs = this.parseExpr();
            this.expectStatementEnd(rhs);
            return { kind: 'Assignment', target: { name: expr.name, span: expr.span }, expr: rhs, span: GL.diagnostics.merge(expr.span, rhs.span) };
          }
          this.fail();
          break;
        }
        case T.EQEQ:
          this.err('E216', "GateLang uses '=' for assignment; '==' is not an operator", this.span(tok),
            { hint: 'use XNOR to test whether two signals are equal' });
          this.fail();
          break;
        case T.RPAREN:
          this.err('E203', "unmatched ')'", this.span(tok), { hint: "remove it or add the missing '('" });
          this.next();
          return this.expectStatementEnd(expr, target);
        case T.EOF:
          this.err('E201', "expected ';' at the end of the statement", this.afterPrev(), { hint: 'add ;' });
          return null;
        case T.OP_NOT: {
          const after = this.peek(1);
          const left = prev.lexeme, right = after && this.isOperandStart(after) ? after.lexeme : '…';
          this.err('E217', 'NOT takes one operand; it cannot join two signals', this.span(tok),
            { hint: `did you mean '${left} AND NOT ${right}'?` });
          this.fail();
          break;
        }
        default: break;
      }
      if (this.isDecl(tok)) {
        this.err('E201', `expected ';' after '${prev.lexeme}'`, this.afterPrev(), { hint: 'add ; at the end of the statement' });
        return null;
      }
      if (tok.type === T.IDENT && tok.line > prev.line && (this.peek(1).type === T.ASSIGN || this.peek(1).type === T.EQEQ)) {
        this.err('E201', `expected ';' after '${prev.lexeme}'`, this.afterPrev(), { hint: 'add ; at the end of the statement' });
        return null;
      }
      if (this.isOperandStart(tok)) {
        if (tok.line > prev.line) {
          this.err('E201', `expected ';' after '${prev.lexeme}'`, this.afterPrev(), { hint: 'add ; at the end of the statement' });
          return null;
        }
        this.err('E206', `expected an operator between '${prev.lexeme}' and '${tok.lexeme}'`, this.span(tok),
          { hint: 'insert AND, OR, XOR, NAND, NOR or XNOR between them' });
        this.fail();
      }
      this.err('E201', `expected ';' but found '${tok.lexeme}'`, this.span(tok), { hint: 'end the statement with ;' });
      this.fail();
      return null;
    }

    /* ───── declarations ───── */
    parseDeclarationBody(kind, kwTok) {
      const T = this.T;
      const names = [];
      const decl = () => ({ kind: 'Declaration', declKind: kind, names, kwSpan: this.span(kwTok), span: GL.diagnostics.merge(this.span(kwTok), this.span(this.prev())) });

      if (this.at(T.SEMI)) {
        this.err('E211', `'${kind}' declaration lists no names`, this.span(kwTok), { hint: 'list the names, or delete the line' });
        this.next();
        return decl();
      }
      for (;;) {
        const tok = this.peek();
        if (tok.type === T.IDENT) {
          this.next();
          names.push({ name: tok.lexeme, span: this.span(tok) });
        } else if (tok.type === T.COMMA) {
          this.err('E212', "expected a name before ','", this.span(tok), { hint: 'remove the extra comma' });
          this.next();
          continue;
        } else if (this.isKeywordWord(tok)) {
          this.err('E210', `'${tok.lexeme}' is a reserved keyword and can't be a signal name`, this.span(tok),
            { hint: `rename it, for example ${tok.lexeme.toLowerCase()}_in` });
          this.next();
        } else if (tok.type === T.CONST) {
          this.err('E210', `'${tok.lexeme}' is a constant, not a signal name`, this.span(tok), { hint: 'names start with a letter or _' });
          this.next();
        } else if (tok.type === T.ERROR || tok.type === T.BAD) {
          this.next(); // already reported
        } else if (tok.type === T.SEMI) {
          this.err('E212', "expected a name after ','", this.span(this.prev()), { hint: 'remove the trailing comma' });
          this.next();
          return decl();
        } else if (tok.type === T.EOF) {
          this.err('E214', 'the file ended inside a declaration', this.afterPrev(), { hint: 'finish the declaration with ;' });
          return decl();
        } else {
          this.err('E212', `expected a signal name but found '${tok.lexeme}'`, this.span(tok), { hint: 'declarations look like: input a, b, c;' });
          const e = new SyncError(tok.line); e.partial = decl(); throw e;
        }
        // after a name
        const sep = this.peek();
        if (sep.type === T.COMMA) {
          this.next();
          if (this.at(T.SEMI)) {
            this.err('E212', "expected a name after ','", this.span(sep), { hint: 'remove the trailing comma' });
            this.next();
            return decl();
          }
          continue;
        }
        if (sep.type === T.SEMI) { this.next(); return decl(); }
        if (sep.type === T.IDENT) {
          if (sep.line > this.prev().line) {
            this.err('E201', `expected ';' after '${this.prev().lexeme}'`, this.afterPrev(), { hint: 'add ; at the end of the declaration' });
            return decl();
          }
          this.err('E212', `expected ',' between '${this.prev().lexeme}' and '${sep.lexeme}'`, this.span(sep), { hint: 'separate names with commas' });
          continue;
        }
        if (this.isDecl(sep) || sep.type === T.EOF) {
          this.err('E201', `expected ';' after '${this.prev().lexeme}'`, this.afterPrev(), { hint: 'add ; at the end of the declaration' });
          return decl();
        }
        this.err('E201', `expected ',' or ';' after '${this.prev().lexeme}' but found '${sep.lexeme}'`, this.span(sep),
          { hint: 'declarations look like: input a, b, c;' });
        const e = new SyncError(sep.line); e.partial = decl(); throw e;
      }
    }

    /* ───── expressions ───── */
    parseExpr() { return this.parseLevel(1); }

    parseLevel(level) {
      const T = this.T;
      if (level > 3) return this.parseUnary();
      let left = this.parseLevel(level + 1);
      for (;;) {
        const tok = this.peek();
        if (GL.tokens.LEVEL_OF_TYPE[tok.type] === level) {
          const opTok = this.next();
          const right = this.parseOperandAfter(opTok, level + 1);
          left = this.makeBinary(opTok, left, right);
          continue;
        }
        if (level === 1 && tok.type === T.BAD) {
          // an illegal character used as an operator (a @ b, a ∧ b): already reported
          this.next();
          if (this.isOperandStart(this.peek())) {
            const right = this.parseLevel(2);
            left = { kind: 'Error', children: [left, right], span: GL.diagnostics.merge(left.span, right.span) };
          }
          continue;
        }
        return left;
      }
    }

    /** Parse the right operand of a binary operator, explaining what's missing. */
    parseOperandAfter(opTok, level) {
      const T = this.T;
      const tok = this.peek();
      if (tok.type === T.EOF) {
        this.err('E214', 'the file ended in the middle of an expression', this.afterPrev(), { hint: 'finish the expression and end it with ;' });
        this.fail();
      }
      if (this.isBinary(tok)) {
        this.err('E204', `'${opTok.value}' is missing its right-hand operand (found '${tok.lexeme}')`, this.span(opTok),
          { hint: `remove one of the operators` });
        this.next(); // skip the stray operator and keep going: a AND OR b → a AND b
        return this.parseOperandAfter(opTok, level);
      }
      if (!this.isOperandStart(tok) && tok.type !== T.BAD) {
        this.err('E204', `'${opTok.value}' is missing its right-hand operand`, this.span(opTok),
          { hint: 'add a signal or constant after it, or remove the operator' });
        return { kind: 'Error', children: [], span: this.span(opTok) };
      }
      return this.parseLevel(level);
    }

    makeBinary(opTok, left, right) {
      const { LEVEL_OF_OP } = GL.tokens;
      const op = opTok.value;
      const node = { kind: 'Binary', op, left, right, opSpan: this.span(opTok), span: GL.diagnostics.merge(left.span, right.span) };
      const lv = LEVEL_OF_OP[op];
      // W201: tighter-binding operator inside a looser one without parentheses
      if (!this.stmtFlags.w201) {
        for (const child of [left, right]) {
          if (child.kind === 'Binary' && !child.parens && LEVEL_OF_OP[child.op] > lv) {
            this.stmtFlags.w201 = true;
            const ex = GL.ast.exprToString(child);
            this.err('W201', `'${child.op}' binds tighter than '${op}'; add parentheses to make the intent clear`, child.span,
              { hint: `write (${ex}) ${op} … if that is what you mean` });
            break;
          }
        }
      }
      // W203: chained non-associative operators
      if (left.kind === 'Binary' && !left.parens && LEVEL_OF_OP[left.op] === lv &&
          (op === 'NAND' || op === 'NOR' || left.op === 'NAND' || left.op === 'NOR')) {
        const bad = op === 'NAND' || op === 'NOR' ? op : left.op;
        this.err('W203', `parsed as (${GL.ast.exprToString(left)}) ${op} ${GL.ast.exprToString(right, 9)}; ${bad} isn't associative`, node.span,
          { hint: 'add parentheses to make the grouping explicit' });
      }
      return node;
    }

    parseUnary() {
      const T = this.T;
      if (this.at(T.OP_NOT)) {
        const opTok = this.next();
        this.enter(opTok);
        const tok = this.peek();
        if (tok.type === T.EOF) {
          this.err('E214', 'the file ended in the middle of an expression', this.afterPrev(), { hint: 'finish the expression and end it with ;' });
          this.fail();
        }
        if (this.isBinary(tok)) {
          this.err('E204', `'NOT' is missing its operand (found '${tok.lexeme}')`, this.span(opTok), { hint: 'remove one of the operators' });
          this.next();
        } else if (!this.isOperandStart(tok) && tok.type !== T.BAD) {
          this.err('E204', "'NOT' is missing its operand", this.span(opTok), { hint: 'write NOT followed by a signal, e.g. NOT a' });
          this.leave();
          return { kind: 'Error', children: [], span: this.span(opTok) };
        }
        const operand = this.parseUnary();
        this.leave();
        return { kind: 'Unary', op: 'NOT', operand, opSpan: this.span(opTok), span: GL.diagnostics.merge(this.span(opTok), operand.span) };
      }
      return this.parsePrimary();
    }

    parsePrimary() {
      const T = this.T;
      const tok = this.peek();
      switch (tok.type) {
        case T.IDENT: this.next(); return { kind: 'Identifier', name: tok.lexeme, span: this.span(tok) };
        case T.CONST: this.next(); return { kind: 'Constant', value: tok.value, span: this.span(tok) };
        case T.ERROR: this.next(); return { kind: 'Error', children: [], span: this.span(tok) };
        case T.BAD: this.next(); return this.parsePrimary(); // stray illegal character before an operand
        case T.LPAREN: return this.parseParens();
        case T.EOF:
          this.err('E214', 'the file ended in the middle of an expression', this.afterPrev(), { hint: 'finish the expression and end it with ;' });
          this.fail();
          break;
        case T.SEMI:
          this.err('E207', 'expected an expression before \';\'', this.span(tok), { hint: 'write a signal, constant or (expression)' });
          return { kind: 'Error', children: [], span: this.span(tok) };
        case T.RPAREN:
          this.err('E203', "unmatched ')'", this.span(tok), { hint: "remove it or add the missing '('" });
          this.next();
          return { kind: 'Error', children: [], span: this.span(tok) };
        case T.EQEQ:
          this.err('E216', "GateLang uses '=' for assignment; '==' is not an operator", this.span(tok), { hint: 'use XNOR to compare two signals' });
          this.next();
          return { kind: 'Error', children: [], span: this.span(tok) };
        default: break;
      }
      if (this.isDecl(tok)) {
        this.err('E218', `'${tok.lexeme}' can't appear inside an expression`, this.span(tok),
          { hint: 'declarations go in their own statement, e.g. input a;' });
        this.next();
        return { kind: 'Error', children: [], span: this.span(tok) };
      }
      if (this.isBinary(tok)) {
        this.err('E205', `'${tok.value}' is missing its left-hand operand`, this.span(tok), { hint: 'add a signal before the operator' });
        this.next();
        if (!this.isOperandStart(this.peek())) return { kind: 'Error', children: [], span: this.span(tok) };
        return this.parseUnary();
      }
      this.err('E207', `expected an expression but found '${tok.lexeme}'`, this.span(tok), { hint: 'write a signal, constant or (expression)' });
      this.next();
      return { kind: 'Error', children: [], span: this.span(tok) };
    }

    parseParens() {
      const T = this.T;
      const lp = this.next();
      this.enter(lp);
      if (this.at(T.RPAREN)) {
        const rp = this.next();
        this.leave();
        this.err('E207', "empty parentheses: '()' contains no expression", GL.diagnostics.merge(this.span(lp), this.span(rp)),
          { hint: 'put an expression inside, or remove them' });
        return { kind: 'Error', children: [], span: GL.diagnostics.merge(this.span(lp), this.span(rp)) };
      }
      const e = this.parseExpr();
      if (this.at(T.RPAREN)) {
        const rp = this.next();
        this.leave();
        e.parens = (e.parens || 0) + 1;
        e.span = GL.diagnostics.merge(this.span(lp), this.span(rp));
        if (!e.w204 && (e.kind === 'Identifier' || e.kind === 'Constant')) {
          e.w204 = true;
          this.err('W204', `redundant parentheses around '${e.kind === 'Identifier' ? e.name : e.value}'`, e.span, { hint: 'remove them' });
        } else if (!e.w204 && e.parens >= 2) {
          e.w204 = true;
          this.err('W204', 'redundant double parentheses', e.span, { hint: 'one pair is enough' });
        }
        return e;
      }
      const cur = this.peek(), prev = this.prev();
      if (this.isOperandStart(cur) && cur.type !== T.OP_NOT && cur.line === prev.line) {
        this.err('E206', `expected an operator between '${prev.lexeme}' and '${cur.lexeme}'`, this.span(cur),
          { hint: 'insert AND, OR, XOR, NAND, NOR or XNOR between them' });
        this.fail();
      }
      if (cur.type === T.OP_NOT) {
        const after = this.peek(1);
        this.err('E217', 'NOT takes one operand; it cannot join two signals', this.span(cur),
          { hint: `did you mean '${prev.lexeme} AND NOT ${this.isOperandStart(after) ? after.lexeme : '…'}'?` });
        this.fail();
      }
      this.err('E202', `'(' opened at ${lp.line}:${lp.col} is never closed`, this.span(lp), { hint: "add ')' where the group should end" });
      this.leave();
      if (cur.type === T.EOF) this.fail();
      e.parens = (e.parens || 0) + 1;
      return e;
    }
  }

  function parse(tokens, diag) {
    const p = new Parser(tokens, diag);
    const program = p.parseProgram();
    program.syntaxErrors = diag.errorCount - p.errorsBefore;
    return program;
  }

  GL.parser = { parse, levenshtein, MAX_DEPTH };
})(typeof window !== 'undefined' ? (window.GateLang = window.GateLang || {}) : (globalThis.GateLang = globalThis.GateLang || {}));
