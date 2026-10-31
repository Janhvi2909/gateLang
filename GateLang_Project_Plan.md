# GateLang — Logic Gates Compiler
## End-to-End Project Plan

---

## 1. Overview

We are building **GateLang**, a small language for describing combinational logic circuits, and a complete six-phase compiler for it. A user writes:

```
input a, b, cin;
output sum, cout;
sum  = a XOR b XOR cin;
cout = (a AND b) OR (cin AND (a XOR b));
```

The compiler produces a truth table, a circuit diagram, an interactive simulator (toggle inputs, watch signals propagate), a gate-level netlist and synthesizable Verilog. Every intermediate result (tokens, parse tree, symbol table, three-address code, optimized code) is visible in the UI, so each phase can be demonstrated on its own.

Three goals drive every decision. **Correctness:** every phase does real work, and the optimizer proves that it preserves the circuit's behaviour. **Robustness:** 60+ coded diagnostics; every error is reported with its location and a fix hint, and all errors in a file are reported in a single run. **Presentability:** a one-page web app, a live demo, and measured efficiency numbers.

### What makes it stand out

| Area | Typical submission | GateLang |
|---|---|---|
| Errors | Stops at the first error, generic message | Reports all errors in one run. Each has a code, line:column, a caret under the source and a fix hint ("did you mean 'carry'?") |
| Operators | AND, OR, NOT | AND, OR, NOT, XOR, NAND, NOR, XNOR, plus symbol forms `&` `\|` `^` `!` `~` |
| Semantic checks | Undefined variable, double assignment | 11 semantic errors and 6 warnings, including combinational-loop detection that prints the cycle path, undriven outputs and multiple drivers |
| Optimization | None, or constant folding only | Three levels (-O0/-O1/-O2): algebraic laws, CSE, dead-code elimination and Quine–McCluskey, with an automatic equivalence proof |
| Code generation | Prints a truth table | Target gate libraries (Standard / NAND-only / NOR-only), netlist, Verilog, circuit diagram and live simulator |
| Efficiency | Not measured | Per-phase timing, gate and depth reduction stats, bit-parallel truth table (32 rows per CPU operation) |
| Testing | A few manual examples | ~130 automated tests plus a fuzzer that compares -O0 against -O2 on thousands of random circuits |

---

## 2. Language Design

### 2.1 Program structure

A program is a sequence of declarations and assignments, each ending in `;`. Assignments may appear in any order, as in real hardware, where all wires exist at the same time; the compiler works out the evaluation order. Declarations may also appear anywhere, because the semantic phase collects them in a separate first pass.

| Keyword | Meaning | Can be read? | Can be assigned? |
|---|---|---|---|
| `input` | External input pin | Yes | No |
| `output` | External output pin | Yes (it can feed other logic) | Exactly once |
| `wire` | Internal named signal | Yes | Exactly once |

The lexical rules are as follows. **Constants** are `0` and `1` only. **Comments** are `// to end of line` and `/* block */`. **Identifiers** start with a letter or `_`, followed by letters, digits or `_`. They are case-sensitive and limited to 64 characters. **Keywords** are case-insensitive (`AND` = `and` = `And`) and reserved.

### 2.2 Operators and precedence

| Precedence | Keyword operators | Symbol forms | Associativity |
|---|---|---|---|
| 1 (highest) | `NOT` | `!` `~` | Right (prefix unary) |
| 2 | `AND`, `NAND` | `&` | Left |
| 3 | `XOR`, `XNOR` | `^` | Left |
| 4 (lowest) | `OR`, `NOR` | `\|` | Left |

Parentheses override precedence. The ordering matches C's `&` > `^` > `|`, which makes it easy to justify. `&&` and `||` are accepted as aliases, with a warning.

### 2.3 Grammar (EBNF)

```
program      ::= { statement } EOF
statement    ::= declaration | assignment
declaration  ::= ( "input" | "output" | "wire" ) id_list ";"
id_list      ::= IDENT { "," IDENT }
assignment   ::= IDENT "=" expr ";"
expr         ::= or_expr
or_expr      ::= xor_expr { ( "OR" | "NOR" | "|" ) xor_expr }
xor_expr     ::= and_expr { ( "XOR" | "XNOR" | "^" ) and_expr }
and_expr     ::= unary    { ( "AND" | "NAND" | "&" ) unary }
unary        ::= ( "NOT" | "!" | "~" ) unary | primary
primary      ::= IDENT | CONST | "(" expr ")"
```

The grammar is **LL(1)**: every choice can be made by looking at one token. Ambiguity is removed by layering one rule per precedence level, and left recursion is replaced by repetition `{ }`. This lets a recursive-descent parser with one function per rule work without backtracking.

### 2.4 Built-in example programs

The UI ships with these examples: half adder, full adder, 2:1 mux, 4:1 mux, 2-to-4 decoder, 2-bit comparator, even-parity generator, 4-bit ripple-carry adder (which uses wires and outputs feeding outputs), an optimization demo and an error demo.

```
// 2-to-1 multiplexer
input a, b, sel;
output y;
y = (a AND NOT sel) OR (b AND sel);
```

---

## 3. Architecture

```
 source.gate
     │
     ▼
 ┌──────────┐ tokens ┌──────────┐  AST  ┌────────────┐ annotated AST ┌──────────┐
 │ 1. Lexer │──────► │ 2. Parser│─────► │ 3. Semantic│─────────────► │ 4. ICG   │
 └──────────┘        └──────────┘       └────────────┘ + eval order  └────┬─────┘
                                                                         │ TAC
                                         ┌──────────────┐ optimized TAC ┌▼──────────┐
   truth table · circuit · simulator ◄───│ 6. Code Gen  │◄──────────────│5. Optimize│
   netlist · Verilog                     └──────────────┘               └───────────┘

   Cross-cutting:  [ Symbol Table Manager ]   [ Error Handler / Diagnostics ]
                   (read/written by all phases) (every phase reports here)
```

This follows the textbook model: six phases plus two components that every phase talks to, the **symbol table manager** and the **error handler**.

**Phase gating:** The lexer and parser always run to the end so that every error is collected. The semantic phase runs on whatever AST was built and skips broken statements. If any error exists after phase 3, phases 4–6 are skipped and the UI shows where compilation stopped. Warnings never block compilation.

### 3.1 Tech stack

The compiler is written in **JavaScript (ES modules)**. It runs in the browser with nothing to install, and the same modules run under **Node.js** for the CLI and the test suite. The UI uses plain HTML, CSS and JS, with SVG for the parse tree and the circuit, and CodeMirror for the editor (line numbers, highlighting, error underlines). There is no backend. The compiler core has no UI dependencies, so it can be explained module by module. If the course requires Python, C or Java, phases 1–6 port one-to-one and only the UI changes.

### 3.2 Folder structure

```
gatelang/
├── src/                      # compiler core — no UI code
│   ├── tokens.js             # token types, keyword table
│   ├── lexer.js              # Phase 1
│   ├── ast.js                # AST node definitions
│   ├── parser.js             # Phase 2
│   ├── symtab.js             # symbol table manager
│   ├── semantic.js           # Phase 3 (+ dependency graph, topo sort)
│   ├── icg.js                # Phase 4 (TAC / quadruples)
│   ├── optimizer.js          # Phase 5, -O1 passes
│   ├── qm.js                 # Phase 5, -O2 Quine–McCluskey
│   ├── verify.js             # equivalence checker
│   ├── codegen.js            # Phase 6 (tech mapping, netlist, Verilog)
│   ├── simulator.js          # bit-parallel truth table + live evaluation
│   ├── diagnostics.js        # error handler, codes, formatting
│   └── compiler.js           # pipeline driver, per-phase timing
├── ui/
│   ├── index.html  app.js  styles.css
│   └── render/               # tokens, tree, symtab, tac, circuit, truthtable
├── cli/gatec.js
├── tests/
│   ├── valid/  errors/  warnings/  optimizer/  robustness/
│   ├── run-tests.js
│   └── fuzz.js
├── examples/
└── docs/                     # report, slides, grammar, error catalog
```

### 3.3 CLI (like a real compiler)

```
node cli/gatec.js adder.gate -O2 --target=nand --emit=verilog
```

| Flag | Meaning |
|---|---|
| `-O0` / `-O1` / `-O2` | Optimization level |
| `--target=std\|nand\|nor` | Target gate library |
| `--emit=tokens\|ast\|symtab\|tac\|netlist\|verilog\|table` | Which phase's output to print |
| `-Werror` | Treat warnings as errors |
| `--no-warn=W301` | Silence a specific warning |
| `--explain=E309` | Print the catalog entry for a diagnostic code |

---

## 4. Phase 1 — Lexical Analysis

The lexer reads characters, groups them into tokens, discards whitespace and comments, and records the line and column of every token.

| Token | Pattern | Example |
|---|---|---|
| `KW_INPUT`, `KW_OUTPUT`, `KW_WIRE` | Case-insensitive keyword | `input` |
| `OP_NOT` | `NOT` `!` `~` | `!` |
| `OP_AND`, `OP_NAND` | `AND` `&` `&&`, `NAND` | `&` |
| `OP_XOR`, `OP_XNOR` | `XOR` `^`, `XNOR` | `^` |
| `OP_OR`, `OP_NOR` | `OR` `\|` `\|\|`, `NOR` | `\|` |
| `ASSIGN` | `=` | `=` |
| `SEMI` `COMMA` `LPAREN` `RPAREN` | `;` `,` `(` `)` | |
| `CONST` | a single `0` or `1` not followed by a letter or digit | `1` |
| `IDENT` | `[A-Za-z_][A-Za-z0-9_]*`, not a keyword | `carry_out` |
| `ERROR` | A malformed lexeme (lets the parser continue) | `1a` |
| `EOF` | End of input | |

**Implementation:** a hand-written DFA scanner (a switch on the current character, using maximal munch). We chose this over a regex or a lex tool because it gives full control over error messages and recovery, and it is easy to explain state by state. The DFA diagram in the report has these states: start, in_ident, in_number, saw_slash, in_line_comment, in_block_comment, saw_amp, saw_pipe and saw_eq. After an identifier is read, a keyword hash map (O(1) lookup) decides between `IDENT` and a keyword.

**Edge handling:** `\r\n` and `\r` are normalised to `\n`, a UTF-8 BOM is skipped, and a tab counts as one column (documented). Maximal munch makes `ANDx` an identifier and makes `1a` a single malformed lexeme rather than `1` followed by `a`.

**Error recovery:** An illegal character is reported, skipped, and scanning continues (panic mode at the character level). A malformed number or identifier is consumed whole and emitted as an `ERROR` token, which the parser treats as an operand. As a result, one typo produces one error rather than a cascade.

**UI output:** a token table with columns #, type, lexeme and line:col. Hovering over a token highlights it in the editor.

**Diagnostics owned:** E101–E107, W101.

---

## 5. Phase 2 — Syntax Analysis

**Recursive descent** uses one function per grammar rule: `parseProgram`, `parseStatement`, `parseDeclaration`, `parseAssignment`, `parseOr`, `parseXor`, `parseAnd`, `parseUnary` and `parsePrimary`. Each binary-level function parses a higher-precedence operand, then loops: while the next token is one of its operators, it consumes the operator, parses another operand, and builds a left-associative node.

**AST node types:** `Program`, `Declaration(kind, names[])`, `Assignment(target, expr)`, `Binary(op, left, right)`, `Unary(op, operand)`, `Identifier(name)`, `Constant(value)` and `ErrorNode`. Every node carries its source span (line, column, end column), so later phases can underline the exact text.

### 5.1 Error recovery (textbook strategies)

| Strategy | How we use it | Example |
|---|---|---|
| Panic mode | On an unexpected token, skip to the next `;` or to a statement-start token, then resume | `out = a AND OR b; y = c;` gives one error, and `y = c;` is still parsed |
| Phrase-level | A missing `;` before a new statement (an identifier followed by `=` on the next line) is reported, then parsing continues as if the `;` were there | `x = a` ⏎ `y = b;` |
| Error productions | Common mistakes are recognised deliberately and given a specific message | `a NOT b`, `x = y = z`, `==`, `out a AND b;` |

The statement-start sync set is { `IDENT`, `input`, `output`, `wire`, `EOF` }. Expression nesting is limited to 256 levels, which prevents a stack overflow on input like 10,000 nested parentheses (E219).

**Lint warnings raised here:** W201 for AND and OR mixed without parentheses (like gcc's `-Wparentheses`), W202 for an empty statement, W203 for a chained NAND/NOR and W204 for redundant parentheses.

**UI output:** the parse tree drawn as a collapsible SVG, with a toggle between the **concrete parse tree** and the **AST**. The parser records rule entries as it goes, so this costs little. Showing the difference is a good viva talking point.

---

## 6. Phase 3 — Semantic Analysis

This phase makes three passes over the AST:

| Pass | Work |
|---|---|
| 1. Declarations | Insert every declared name into the symbol table; detect duplicates and conflicts |
| 2. Uses and assignments | Resolve every identifier, check assignment targets, record drivers and readers, and build the dependency graph |
| 3. Graph analysis | Topological sort (Kahn's algorithm), cycle detection (three-colour DFS, which gives the cycle path), the logic level of each signal, and unused or undriven signals |

### 6.1 Symbol table

| Field | Example |
|---|---|
| `name` | `cout` |
| `kind` | `output` |
| `declaredAt` | `2:8` |
| `drivenAt` | `[4:1]` (a list, so multiple drivers can be detected) |
| `readAt` | `[]` |
| `dependsOn` | `{a, b, cin}` |
| `level` | `2` |
| `constValue` | `null` (filled in by the optimizer) |

The table is a hash map from name to entry, with O(1) lookup. GateLang has a single global scope, because flat netlists have no need for nested scopes.

### 6.2 Key techniques

When an identifier is undeclared, the compiler computes the Levenshtein distance to every declared name and suggests the closest one if the distance is 2 or less. A case-only mismatch (`Carry` vs `carry`) gets the hint "names are case-sensitive."

Topological sort is required because assignments can be written in any order, so the compiler must derive the evaluation order itself. A cycle means a combinational loop. Such a loop is invalid in combinational logic, because it would behave as a latch or an oscillator.

**UI output:** the symbol table, a dependency graph (inputs on the left, outputs on the right) and the evaluation order.

**Diagnostics owned:** E301–E311, W301–W306, I301.

---

## 7. Phase 4 — Intermediate Code Generation

The ICG phase produces **three-address code (TAC)**, in which each instruction has at most one operator, for example `t3 = t1 OR t2` or `t4 = NOT c`. The code is generated by a post-order traversal of each assignment's AST, following the evaluation order from Phase 3. Constants may appear as operands.

TAC is stored as **quadruples** (op, arg1, arg2, result), and the UI shows both the quadruple table and the TAC listing:

| # | op | arg1 | arg2 | result |
|---|---|---|---|---|
| 1 | AND | a | b | t1 |
| 2 | NOT | c | | t2 |
| 3 | OR | t1 | t2 | t3 |
| 4 | COPY | t3 | | out |

We use TAC for three reasons. It is machine-independent. It has a simple, uniform shape that makes pattern rules and CSE straightforward. And each instruction is exactly one gate, so the gate count equals the instruction count. Temporaries are fresh (`t1`, `t2`, …), and each named signal gets a final `COPY`, which copy propagation later removes.

**Stats recorded:** instruction count, number of temporaries and an operator histogram.

---

## 8. Phase 5 — Code Optimization

### 8.1 Optimization levels

| Level | Passes | Purpose |
|---|---|---|
| `-O0` | None | Baseline: the raw translation |
| `-O1` | Constant folding, constant propagation, algebraic simplification, CSE, copy propagation and dead-code elimination, repeated until nothing changes | Fast, local, and explainable rule by rule |
| `-O2` | `-O1`, then Quine–McCluskey minimisation for each output (up to 10 inputs), then `-O1` again | Globally minimal sum-of-products |

### 8.2 Algebraic rules (each fires with its law name in the log)

| Law | Rewrites |
|---|---|
| Identity | `x AND 1 → x`, `x OR 0 → x`, `x XOR 0 → x`, `x XNOR 1 → x` |
| Annihilator | `x AND 0 → 0`, `x OR 1 → 1`, `x NAND 0 → 1`, `x NOR 1 → 0` |
| Idempotent | `x AND x → x`, `x OR x → x` |
| Complement | `x AND NOT x → 0`, `x OR NOT x → 1`, `x XOR x → 0`, `x XOR NOT x → 1` |
| Involution | `NOT NOT x → x` |
| Inversion via XOR | `x XOR 1 → NOT x`, `x XNOR 0 → NOT x` |
| Absorption | `x OR (x AND y) → x`, `x AND (x OR y) → x` |
| Negation fusing | `NOT (x AND y) → x NAND y`, `NOT (x OR y) → x NOR y`, `NOT (x XOR y) → x XNOR y` (each saves a gate) |
| Constant folding | `1 AND 0 → 0`, `NOT 0 → 1`, and so on for every operator |

### 8.3 Other passes

**Common subexpression elimination** uses local value numbering. A hash map is keyed by `op|arg1|arg2`, and the operands of commutative operators (all six binary operators are commutative) are sorted first, so `a AND b` and `b AND a` get the same number. A duplicate becomes a copy. The same mechanism detects two outputs that compute the same function (W504).

**Copy propagation** replaces uses of `x` after `x = y` with `y`.

**Dead-code elimination** marks backwards from the outputs (liveness) and removes every unmarked instruction.

**Fixpoint loop:** the passes repeat until none of them changes anything, with a safety cap of 20 iterations.

### 8.4 -O2: Quine–McCluskey

For each output, the minterm list is built from the bit-parallel truth table. Terms that differ in one bit are combined to find the prime implicants. Essential primes are selected first, and the remaining minterms are covered greedily. Because QM is exponential in the worst case, it runs only for up to 10 inputs (otherwise W505). The minimal SOP is converted back to TAC, and the `-O2` result is **kept only if it has fewer gates than `-O1`**. SOP is not always smaller: XOR-heavy circuits such as adders and parity checkers blow up in SOP form, which is a good viva point.

### 8.5 Self-verification

After optimization, the compiler compares the truth tables of the `-O0` code and the optimized code. The comparison is bit-parallel and exhaustive for up to 20 inputs, and the UI shows **"✔ Verified equivalent over 2ⁿ input combinations."** If they ever differ (a bug in our optimizer), the compiler reports W900 and falls back to the `-O0` output, so it never emits a wrong circuit.

### 8.6 What the UI shows

The **optimization log** lists every rewrite with its rule and source line, for example "Line 3: NOT NOT c → c (Involution)". A **before/after panel** compares gate count (total and by type), logic depth (the longest input-to-output path, i.e. the propagation delay in gate delays), TAC instruction count and an estimated CMOS transistor count (NOT = 2, NAND/NOR = 4, AND/OR = 6, XOR/XNOR = 12).

**Diagnostics owned:** W501–W505, I501, I502, W900.

---

## 9. Phase 6 — Code Generation

The target "machine" is a **gate library**, just as a C compiler targets x86 or ARM. Code generation has five steps.

### 9.1 Instruction selection (technology mapping)

Each TAC operation is mapped to gates in the chosen library. The table gives the number of target gates needed for each operation:

| Op | Standard | NAND-only | NOR-only |
|---|---|---|---|
| NOT | 1 NOT | 1 (`x NAND x`) | 1 (`x NOR x`) |
| AND | 1 AND | 2 | 3 |
| OR | 1 OR | 3 | 2 |
| NAND | 1 NAND | 1 | 4 |
| NOR | 1 NOR | 4 | 1 |
| XOR | 1 XOR | 4 | 5 |
| XNOR | 1 XNOR | 5 | 4 |

A **peephole pass** then removes the double inversions that mapping creates. For example, `f = (a AND b) OR c` maps naively to 5 NANDs, and the peephole pass reduces it to 3. This is the classic code-generation-level optimization.

### 9.2 Netlist emission

```
G1  AND  (a, b)   -> n1
G2  OR   (n1, c)  -> f
```

### 9.3 Verilog emission

The Standard target produces `assign` statements. The NAND-only and NOR-only targets produce gate primitives such as `nand g1(n1, a, b);`. The output can be pasted into any Verilog simulator (Icarus, EDA Playground), which shows real-world interoperability.

### 9.4 Circuit layout and drawing

Gates are placed in columns by logic level, and the gates within each column are ordered by one barycenter pass to reduce wire crossings. Gates are drawn with the standard ANSI symbols in SVG, connected by orthogonal wires.

### 9.5 Execution: truth table and simulator

**Bit-parallel truth table:** for n inputs, each signal holds 2ⁿ bits packed into a `Uint32Array`. Input k's column is a fixed pattern (alternating blocks of 2ᵏ zeros and ones), and each gate is a single bitwise operation (`&` `|` `^` `~`) per word. All rows are therefore computed at once, at a cost of gates × 2ⁿ ⁄ 32 word operations. For 16 inputs (65,536 rows) and 100 gates, that is about 205,000 word operations, versus about 6.5 million node visits for naive per-row evaluation.

**Display:** the table uses virtual scrolling (only visible rows are rendered), highlights rows where an output is 1, lists minterms `Σm(…)` and the canonical SOP/POS for each output, offers a K-map view for up to 4 inputs and supports CSV export.

**Interactive simulator:** clicking an input pin toggles it between 0 and 1, wires carrying 1 glow, and output LEDs light up. The simulator runs the same generated netlist, which proves that the generated code works. A step mode animates signal propagation level by level, which visualises logic depth.

**Diagnostics owned:** W601–W604.

---

## 10. Error & Warning Catalog

**Severities:** an **Error** blocks the later phases; a **Warning** still compiles but points to a likely mistake; an **Info** message is a note, such as an optimization that was applied. **Codes:** 1xx lexical, 2xx syntax, 3xx semantic, 5xx optimization, 6xx code generation, 9xx limits and internal checks.

### 10.1 Lexical (Phase 1)

| Code | Trigger | Example | Message / hint |
|---|---|---|---|
| E101 | Illegal character | `out = a @ b;` | illegal character '@' |
| E102 | Invalid constant | `out = a AND 2;` / `x = 10;` | '2' is not a valid constant; only single bits 0 and 1 are allowed |
| E103 | Malformed identifier | `1a = b;` | identifiers can't start with a digit; try 'a1' |
| E104 | Unterminated block comment | `/* note` | comment opened at 1:1 is never closed |
| E105 | Unicode logic symbol / non-ASCII | `out = a ∧ b;` | '∧' isn't supported; use AND or & |
| E106 | Lone `/` | `a / b` | unexpected '/'; comments start with // |
| E107 | Identifier too long | 65+ characters | identifier exceeds 64 characters |
| W101 | C-style operator | `a && b` | '&&' accepted as AND; prefer AND or & |

### 10.2 Syntax (Phase 2)

| Code | Trigger | Example | Message / hint |
|---|---|---|---|
| E201 | Missing semicolon | `x = a AND b` ⏎ `y = c;` | expected ';' after 'b' |
| E202 | Unclosed parenthesis | `out = (a AND b;` | '(' opened at 1:7 is never closed |
| E203 | Unmatched `)` | `out = a AND b);` | unmatched ')' |
| E204 | Missing right operand | `out = a AND ;` | 'AND' is missing its right-hand operand |
| E205 | Missing left operand | `out = OR b;` | 'OR' is missing its left-hand operand |
| E206 | Missing operator | `out = a b;` | expected an operator between 'a' and 'b' |
| E207 | Empty expression | `out = ;` | assignment to 'out' has no expression |
| E208 | Missing `=` | `out a AND b;` | expected '=' after 'out' |
| E209 | Invalid assignment target | `1 = a;` / `a AND b = c;` | the left side of '=' must be a single signal name |
| E210 | Reserved word as a name | `input and;` | 'and' is a reserved keyword and can't be a signal name |
| E211 | Empty declaration | `input ;` | 'input' declaration lists no names |
| E212 | Misplaced comma | `input a, , b;` / `input a,;` | expected a name after ',' |
| E213 | Chained assignment | `x = y = a;` | only one '=' is allowed per statement |
| E214 | Unexpected end of file | `out = (a AND` | the file ended in the middle of an expression |
| E215 | Invalid statement start | `AND a;` | a statement must start with input, output, wire or a signal name |
| E216 | `==` used | `out == a;` | GateLang uses '=' for assignment; there is no comparison operator |
| E217 | NOT used as a binary operator | `a NOT b` | NOT takes one operand; did you mean 'a AND NOT b'? |
| E218 | Keyword inside an expression | `out = input AND a;` | 'input' can't appear inside an expression |
| E219 | Nesting too deep | 300 nested `(` | the expression nests deeper than 256 levels |
| W201 | Unclear precedence | `a AND b OR c` | AND binds tighter than OR; add parentheses to show intent |
| W202 | Empty statement | `;;` | empty statement ignored |
| W203 | Non-associative chain | `a NAND b NAND c` | parsed as (a NAND b) NAND c; NAND isn't associative, so add parentheses |
| W204 | Redundant parentheses | `((a))` | redundant parentheses |

### 10.3 Semantic (Phase 3)

| Code | Trigger | Example | Message / hint |
|---|---|---|---|
| E301 | Undeclared identifier | `out = a AND d;` | 'd' is not declared; did you mean 'b'? |
| E302 | Duplicate declaration | `input a; input a;` | 'a' is already declared at 1:7 |
| E303 | Conflicting kinds | `input x; output x;` | 'x' is declared as input (1:7) and as output (2:8) |
| E304 | Assignment to an input | `a = b;` | 'a' is an input and can't be assigned |
| E305 | Assignment to an undeclared signal | `z = a;` | 'z' is not declared; declare it as output or wire |
| E306 | Multiple drivers | `out` assigned on lines 3 and 5 | 'out' is assigned more than once (3:1, 5:1); a signal can have only one driver |
| E307 | Undriven output | `output y;` never assigned | output 'y' is never assigned |
| E308 | Undriven wire is read | `wire t;` read, never assigned | wire 't' is used at 4:9 but never assigned |
| E309 | Combinational loop | `x = a AND y; y = x OR b;` | combinational loop: x → y → x |
| E310 | Self-dependency | `x = x AND a;` | 'x' depends on itself |
| E311 | No outputs | Only inputs declared, or an empty file | the program declares no outputs, so there is nothing to compute |
| W301 | Unused input | `c` declared, never read | input 'c' is declared but never used |
| W302 | Unused wire | `t` assigned, never read | wire 't' is assigned but never used |
| W303 | Wire never used at all | `wire t;` only | wire 't' is declared but never assigned or used |
| W304 | Output is a plain buffer | `y = a;` | output 'y' just copies input 'a' |
| W305 | Output assigned a constant | `y = 1;` | output 'y' is the constant 1 |
| W306 | Names differ only by case | `carry` and `Carry` declared | 'Carry' and 'carry' differ only by case, which is easy to mix up |
| I301 | Output also used internally | `c2 = cout AND x;` | output 'cout' also feeds other logic (allowed) |

### 10.4 Optimization (Phase 5)

| Code | Trigger | Example | Message / hint |
|---|---|---|---|
| W501 | Tautology | `y = a OR NOT a;` | output 'y' is 1 for every input |
| W502 | Contradiction | `y = a AND NOT a;` | output 'y' is 0 for every input |
| W503 | Input has no effect | `y = a OR (a AND b);` | input 'b' has no effect on any output |
| W504 | Equivalent outputs | `f = a AND b; g = b AND a;` | outputs 'f' and 'g' compute the same function |
| W505 | -O2 skipped | 14 inputs | Quine–McCluskey skipped for 'y' (14 inputs > 10); the -O1 result is used |
| I501 | Rule applied | | line 3: NOT NOT c → c (Involution) |
| I502 | Summary | | 9 gates → 2 gates (−78%), depth 3 → 2, verified over 8 combinations |

### 10.5 Code generation (Phase 6)

| Code | Trigger | Message / hint |
|---|---|---|
| W601 | More than 16 inputs | the truth table has 262,144 rows; showing the first 1,000 (CSV export available); the table is not computed above 20 inputs |
| W602 | More than 80 gates | the circuit diagram is simplified; use zoom or the netlist view |
| W603 | High fan-out (> 8) | 'sel' drives 12 gates; real hardware would need a buffer |
| W604 | Deep logic path (> 10) | the path a → … → cout is 14 gates deep (propagation delay) |

### 10.6 Limits & internal checks

| Code | Trigger | Message |
|---|---|---|
| E901 | More than 50 errors | too many errors; stopping after 50 |
| W900 | Optimizer verification fails | internal check failed: the optimized circuit differs from the original; falling back to -O0 output |

**Total: 62 diagnostics** (38 errors, 21 warnings, 3 info notes).

---

## 11. Diagnostics Design

### 11.1 Message format (in the style of Clang/Rust)

```
error[E202]: '(' is never closed
  --> fulladder.gate:3:8
   |
 3 | cout = (a AND b OR (cin AND (a XOR b));
   |        ^ unclosed '('
   = hint: add ')' before ';'
```

Each diagnostic is an object: `{ code, severity, phase, message, line, col, endCol, hint, related: [{ line, col, label }] }`. The `related` field carries secondary locations, such as "first declared here" for E302 or both driver lines for E306.

### 11.2 Policies

| Policy | Detail |
|---|---|
| All errors in one run | Every phase recovers and continues |
| No cascades | `ERROR` tokens and error AST nodes are "poisoned," so the semantic phase skips them. An undeclared name is reported once, listing all the lines it is used on, rather than once per use |
| Ordering | Sorted by line, then by severity |
| Cap | Stops after 50 errors (E901) |
| Configurable | `-Werror`, `--no-warn=CODE`, and matching toggles in the UI |
| Self-explaining | Every code links to its catalog entry ("Explain E309"), like `rustc --explain`. The catalog is a JSON file shared by the CLI and the UI |

### 11.3 Robustness: inputs that must never crash

| Input | Expected behaviour |
|---|---|
| Empty file, whitespace only, or comments only | E311, with a clean message |
| Windows line endings, tabs, UTF-8 BOM | Correct line:col in every message |
| A 10,000-line program | Compiles, and the timing is shown |
| 10,000 nested parentheses | E219, with no stack overflow |
| A 1,000-character identifier | E107 |
| A file with 200 errors | The first 50, then E901 |
| Pasted binary or random garbage | Capped lexer errors, no crash |
| Every output optimizes to a constant | A valid netlist with constant drivers, plus W501/W502 |
| Zero inputs (`output y; y = 1 AND 0;`) | Valid, with a 1-row truth table |
| An output assigned directly from an input | Valid, with 0 gates and W304 |

---

## 12. Efficiency

| Component | Technique | Time complexity |
|---|---|---|
| Lexer | Single-pass DFA, O(1) keyword hash lookup | O(n) characters |
| Parser | LL(1) recursive descent, no backtracking | O(t) tokens |
| Symbol table | Hash map | O(1) per lookup |
| Dependency analysis | Kahn's topological sort, DFS cycle detection | O(V + E) |
| ICG | One post-order traversal | O(AST nodes) |
| -O1 passes | Each pass is linear; CSE uses hashing | O(k · m), k ≤ 20 iterations (usually 2–3) |
| -O2 (QM) | Exponential worst case, capped at 10 inputs | Bounded |
| Truth table and verification | Bit-parallel, 32 rows per word operation | O(g · 2ⁿ ⁄ 32) |
| Circuit layout | Level assignment plus one barycenter pass | O(g log g) |
| Truth table UI | Virtual scrolling | Renders only visible rows |

A **live timing panel** shows each phase chip in the UI with its time in milliseconds.

**Benchmark slide:** the numbers are filled in after we measure them, and we claim nothing in advance. The slide will cover per-phase time for the full adder, the 4-bit and 8-bit adders, a generated 1,000-statement program and a 16-input truth table; the gate and depth reduction across the optimization demo suite; and naive versus bit-parallel truth table time.

---

## 13. Worked Example Through All Six Phases

This is the optimization demo file, the one used live in the presentation:

```
input a, b, c;
output f, g;
f = (a AND b) OR (b AND a) OR NOT NOT c;
g = (a OR 0) AND (a OR b);
```

**Phase 1, Lexical analysis:** 44 tokens plus EOF, with no diagnostics. Line 3 tokenizes as `IDENT(f) ASSIGN LPAREN IDENT(a) OP_AND IDENT(b) RPAREN OP_OR LPAREN IDENT(b) OP_AND IDENT(a) RPAREN OP_OR OP_NOT OP_NOT IDENT(c) SEMI`.

**Phase 2, Syntax analysis:** the AST for `f`:

```
            OR
          /    \
        OR      NOT
       /  \       \
     AND   AND     NOT
     / \   / \       \
    a   b b   a       c
```

**Phase 3, Semantic analysis:** a, b and c are inputs; f and g are outputs; all names resolve. f and g are independent, so the evaluation order is f, g. There are no errors.

**Phase 4, Intermediate code:** 11 TAC instructions, 9 of which are gates:

```
t1 = a AND b        t7 = a OR 0
t2 = b AND a        t8 = a OR b
t3 = t1 OR t2       t9 = t7 AND t8
t4 = NOT c          g  = t9
t5 = NOT t4
t6 = t3 OR t5
f  = t6
```

**Phase 5, Optimization (-O1):**

| Step | Rule | Effect |
|---|---|---|
| 1 | CSE (commutative) | `t2 = b AND a` ≡ `t1`, so `t3 = t1 OR t1` |
| 2 | Idempotent | `t1 OR t1 → t1` |
| 3 | Involution | `NOT NOT c → c` |
| 4 | Identity | `a OR 0 → a` |
| 5 | Absorption | `a AND (a OR b) → a` |
| 6 | Copy propagation and dead-code elimination | Unused temporaries removed |

```
t1 = a AND b
f  = t1 OR c
g  = a
```

The result is 9 gates → 2 gates (−78%) and logic depth 3 → 2, ✔ verified equivalent over 8 combinations. The compiler also notes that output `g` simplifies to input `a`.

**Phase 6, Code generation:**

```
Standard netlist          NAND-only netlist (after peephole: 5 → 3 gates)
G1 AND (a, b)  -> n1      G1 NAND (a, b)   -> n1
G2 OR  (n1, c) -> f       G2 NAND (c, c)   -> n2
   BUF (a)     -> g       G3 NAND (n1, n2) -> f
                             BUF  (a)      -> g
```

```verilog
module example(input a, b, c, output f, g);
  assign f = (a & b) | c;
  assign g = a;
endmodule
```

| a | b | c | f | g |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 |
| 0 | 0 | 1 | 1 | 0 |
| 0 | 1 | 0 | 0 | 0 |
| 0 | 1 | 1 | 1 | 0 |
| 1 | 0 | 0 | 0 | 1 |
| 1 | 0 | 1 | 1 | 1 |
| 1 | 1 | 0 | 1 | 1 |
| 1 | 1 | 1 | 1 | 1 |

---

## 14. Testing Strategy

| Category | Target count | What is checked |
|---|---|---|
| Valid circuits | 23 | Half/full adder, muxes, decoders, comparators, parity, 4- and 8-bit adders: zero errors, and the truth table matches a hand-written expected table |
| One test per diagnostic | 62 | The file produces exactly that code at the exact line:col |
| Multi-error files | 10 | Several errors in one file are all reported, with no cascades |
| Optimizer rules | 25 | Each algebraic law fires, and the gate count and depth match the expected values |
| Robustness | 10 | Every input in the §11.3 table compiles without crashing |
| **Total** | **130** | |

**Golden-file format:** each test file declares its expected diagnostics in a comment on the first line, for example `// expect: E202@3:8, W301@1:13`. The runner parses this line and compares it with the actual output. The format is simple, and anyone can read it.

**Fuzzing** has two parts. The *equivalence fuzzer* generates random circuits (random operators, constants and depth) and checks that -O0, -O1, -O2 and all three target libraries produce identical truth tables, over 10,000 circuits. The *crash fuzzer* takes valid programs, randomly deletes, inserts or swaps a token, and checks that the compiler always returns diagnostics and never throws. Together they support the claim "every phase survives 10,000 randomly corrupted programs" once the runs pass.

Tests run with `node tests/run-tests.js`. The UI has a **Run test suite** button that shows the pass count live during the presentation.

---

## 15. UI & Presentation

### 15.1 Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ GateLang   [Examples ▾]  [-O1 ▾]  [Target: Standard ▾]        [▶ Compile] │
│ ①Lex 0.2ms ✔ ─ ②Parse 0.3ms ✔ ─ ③Sema 0.1ms ✔ ─ ④ICG ✔ ─ ⑤Opt ✔ ─ ⑥Gen ✔ │
├───────────────────────────┬──────────────────────────────────────────────┤
│ Code editor               │ Tokens | Parse Tree | Symbols & Graph |      │
│ line numbers, colours,    │ TAC | Optimization | Output                  │
│ red/yellow squiggles      │                                              │
│                           │       (output of the selected phase)         │
├───────────────────────────┴──────────────────────────────────────────────┤
│ Diagnostics:  ✖ 2 errors   ⚠ 1 warning     (click a row → jump to line)  │
└──────────────────────────────────────────────────────────────────────────┘
```

The **Output** tab has five sub-views: Circuit (with the live simulator), Truth Table, Netlist, Verilog and Stats (before/after bars). Other features: compile-as-you-type (debounced 300 ms, so errors appear live as in an IDE), an "Explain this error" panel, light and dark themes, and export to SVG (circuit), CSV (truth table) and `.v` (Verilog).

### 15.2 Demo script (10 minutes)

| Time | What we show | Point made |
|---|---|---|
| 0:00–1:00 | The problem, and GateLang on one slide | The language is small but real |
| 1:00–2:00 | Architecture slide: six phases, symbol table, error handler | Textbook structure |
| 2:00–5:00 | Live: the full adder, clicking through the tabs phase by phase | Every phase does real work |
| 5:00–6:30 | The optimization demo: 9 → 2 gates, rule log, ✔ verified | Efficiency and correctness |
| 6:30–8:00 | The error demo: about 10 errors in one file, all with hints, fixed live | Robustness |
| 8:00–8:45 | Switch the target to NAND-only; toggle inputs in the simulator | Real code generation |
| 8:45–9:30 | Run the test suite; show the benchmark slide | Proof and numbers |
| 9:30–10:00 | Summary of differentiators | Why ours stands out |

**Safety net:** bundle CodeMirror locally so the demo works offline, and keep a screen recording of the full demo as a backup.

### 15.3 Report outline

1. Abstract
2. Introduction and motivation
3. Language specification: lexical rules, grammar, semantic rules
4. Design of each phase, with diagrams (DFA, parse tree vs AST, symbol table, dependency graph, TAC, optimization rules, technology mapping)
5. Error handling and the diagnostic catalog
6. Implementation details
7. Testing and results: benchmarks, fuzzing, screenshots
8. Conclusion and future work: sequential logic (flip-flops, clock), buses (`a[3:0]`), modules, BDD-based optimization
9. References

The slides (~12) follow the same order as the demo script.

---

## 16. Build Timeline & Team Split

This assumes a team of 4 and about 3 weeks; adjust both to fit your group.

| Member | Owns |
|---|---|
| A | Lexer, parser, AST/CST views, syntax diagnostics |
| B | Symbol table, semantic analysis, dependency graph, diagnostics module and catalog |
| C | ICG, optimizer, QM, verifier, code generation (mapping, peephole, netlist, Verilog) |
| D | UI, circuit rendering, truth table, simulator, test runner, slides |

Everyone writes the tests for their own phase.

| Milestone | Days | Deliverable |
|---|---|---|
| M0 Spec freeze | 1 | Grammar, token list and error catalog agreed (this document) |
| M1 Front end | 2–5 | Lexer, parser and AST with all E1xx/E2xx; token and tree views |
| M2 Middle end | 6–9 | Semantic analysis and ICG, all E3xx/W3xx; symbol table and TAC views |
| M3 Back end | 10–13 | -O1 optimizer, verifier, code generation (all 3 targets), truth table, circuit |
| M4 Polish | 14–17 | -O2 (QM), simulator, fuzzers, benchmarks, all tests green |
| M5 Present | 18–21 | Report, slides, recorded demo, viva rehearsal |

**If time runs short, cut from the bottom of this list:**

| Tier | Features |
|---|---|
| Must | All six phases; every E1xx–E3xx check; -O1; truth table; circuit diagram; diagnostic format |
| Should | NAND/NOR targets, verifier, simulator, Verilog, test suite in the UI |
| Could | -O2 (QM), K-map view, CST view, fuzzers, "Explain this error" panel |

---

## 17. Viva Preparation

| Likely question | Answer |
|---|---|
| Token vs lexeme vs pattern? | A pattern is the rule (`[A-Za-z_]\w*`), a lexeme is the actual text (`carry`) and a token is the category with attributes (`IDENT, "carry", 3:5`). |
| Why recursive descent and not LR/yacc? | The grammar is LL(1) once left recursion is removed and precedence is layered. Recursive descent is linear, needs no generator tool, maps one function to each rule and gives precise error messages. |
| How are precedence and associativity handled? | There is one grammar level per precedence level, and each level's loop builds left-associative trees. |
| What error recovery do you use? | Panic mode (syncing on `;` and statement starters), phrase-level recovery (inserting a missing `;`) and error productions (`a NOT b`, `==`). |
| What's in the symbol table? | Name, kind, declaration location, drivers, readers, dependencies, logic level and constant value. |
| How do you detect combinational loops? | DFS with white/grey/black colouring over the dependency graph. An edge to a grey node is a back edge, meaning a cycle, and we print its path. |
| Why do you need a topological sort? | Assignments can be written in any order, as in hardware, so the evaluation order has to come from the dependencies. |
| Why three-address code? | It is machine-independent, and one operation per instruction means one gate per instruction, which makes optimization simple. |
| How does CSE know that `a AND b` equals `b AND a`? | Operands of commutative operators are sorted before hashing. |
| How do you know the optimizer didn't break the circuit? | An exhaustive bit-parallel equivalence check of -O0 against the optimized code, with a fallback to -O0 if they differ. |
| Isn't code generation the same as ICG here? | No. ICG is target-independent. Code generation does instruction selection for a gate library (XOR takes 4 gates in NAND-only), peephole cleanup, layout and netlist/Verilog emission. |
| Why isn't -O2 always better? | SOP form explodes for XOR-heavy functions (n-input parity needs 2ⁿ⁻¹ product terms), so we keep whichever result is smaller. |
| What is the complexity of truth-table generation? | O(g · 2ⁿ ⁄ 32) with bit-parallel evaluation. Exponential growth in n is unavoidable because the table has 2ⁿ rows. |
| Is GateLang Turing-complete? | No. It describes combinational logic only, with no loops and no state. That is intentional, and it is why every program terminates and can be fully verified. |
| What would you add next? | Sequential logic (flip-flops and a clock), buses (`a[3:0]`), modules and instantiation, and BDD-based optimization. |
