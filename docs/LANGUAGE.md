# GateLang language reference

GateLang describes **combinational logic circuits**: circuits whose outputs depend only on their current inputs. A program declares signals and then defines each output (and, optionally, internal wires) with a Boolean expression.

## A complete example

```
// 2-bit magnitude comparator: A = a1 a0, B = b1 b0
input a1, a0, b1, b0;
output gt, eq, lt;
wire e1, e0;

e1 = a1 XNOR b1;          // high bits equal
e0 = a0 XNOR b0;          // low bits equal
eq = e1 AND e0;
gt = (a1 AND NOT b1) OR (e1 AND a0 AND NOT b0);
lt = (NOT a1 AND b1) OR (e1 AND NOT a0 AND b0);
```

## Lexical rules

| Element | Rule |
|---|---|
| Identifier | Starts with a letter or `_`, followed by letters, digits or `_`. Case-sensitive. At most 64 characters. |
| Keyword | `input output wire NOT AND NAND OR NOR XOR XNOR`: reserved and **case-insensitive** (`and` = `AND`) |
| Constant | `0` or `1` only |
| Symbols | `=` `;` `,` `(` `)` `&` `\|` `^` `!` `~` (`&&` and `\|\|` are accepted with warning W101) |
| Comments | `// to end of line` and `/* block */` (block comments do not nest) |
| Whitespace | Spaces, tabs and newlines; `\r\n` line endings and a UTF-8 BOM are handled |
| Character set | ASCII. Unicode logic symbols such as `∧ ∨ ¬ ⊕` give E105 with a hint naming the right keyword. |

## Signals

| Kind | Meaning | May be read | May be assigned |
|---|---|---|---|
| `input` | external input pin | yes | never (E304) |
| `output` | external output pin | yes, so it can feed other logic (I301) | exactly once (E306, E307) |
| `wire` | internal named signal | yes | exactly once (E306, E308) |

## Operators

| Precedence | Operators | Symbols | Associativity | Meaning |
|---|---|---|---|---|
| 1 (tightest) | `NOT` | `!` `~` | right (prefix) | negation |
| 2 | `AND`, `NAND` | `&` | left | conjunction |
| 3 | `XOR`, `XNOR` | `^` | left | exclusive or, equivalence |
| 4 (loosest) | `OR`, `NOR` | `\|` | left | disjunction |

`a AND b OR c` means `(a AND b) OR c`, and is legal but gives warning W201. NAND and NOR are not associative, so `a NAND b NAND c` is parsed as `(a NAND b) NAND c` with warning W203.

## Grammar (EBNF)

```
program      ::= { statement } EOF
statement    ::= declaration | assignment
declaration  ::= ( "input" | "output" | "wire" ) id_list ";"
id_list      ::= IDENT { "," IDENT }
assignment   ::= IDENT "=" expr ";"
expr         ::= or_expr
or_expr      ::= xor_expr { ( OR | NOR | "|" ) xor_expr }
xor_expr     ::= and_expr { ( XOR | XNOR | "^" ) and_expr }
and_expr     ::= unary { ( AND | NAND | "&" ) unary }
unary        ::= ( NOT | "!" | "~" ) unary | primary
primary      ::= IDENT | CONST | "(" expr ")"
```

The grammar is **LL(1)**. Each precedence level has its own rule, so it is unambiguous, and repetition `{ }` replaces left recursion. At every choice point the FIRST sets of the alternatives are disjoint:

| Choice | Alternatives and their FIRST sets |
|---|---|
| `statement` | declaration: {input, output, wire} · assignment: {IDENT} |
| `unary` | NOT-branch: {NOT, !, ~} · primary: {IDENT, CONST, (} |
| `primary` | {IDENT} · {CONST} · {(} |
| loop in `or_expr` | continue on {OR, NOR, \|}, stop on FOLLOW = {;, )} |

## Semantic rules

1. Every name is declared exactly once (E302, E303). Declarations may appear anywhere in the file.
2. Every name used in an expression is declared (E301, with a "did you mean" hint).
3. Only outputs and wires can be assigned (E304, E305).
4. Each output and wire has exactly one driver (E306). Every output is driven (E307), and every wire that is read is driven (E308).
5. The signals must not form a loop (E309, E310). Assignments may appear in any order; the compiler finds a valid evaluation order by topological sort.
6. At least one output is declared (E311).

The compiler also warns about legal but suspicious code: unused inputs and wires (W301–W303), trivial outputs (W304, W305), names that differ only by case (W306), tautologies and contradictions (W501, W502), inputs that have no effect (W503) and outputs that compute the same function (W504).

All 62 diagnostics are listed in [ERROR_CATALOG.md](ERROR_CATALOG.md).
