# GateLang diagnostic catalog

GateLang reports **62 distinct diagnostics**: 38 errors, 21 warnings and 3 informational notes. Errors stop code generation; warnings and notes never do. Every entry with an example is a complete program that triggers exactly that code, and the test suite checks all of them on every run. This file is generated from `src/catalog.js` by `node tools/gen-docs.js`.

Code ranges: `1xx` lexical, `2xx` syntax, `3xx` semantic, `5xx` optimization, `6xx` code generation, `9xx` limits and internal checks.

| Code | Severity | Phase | Title |
|---|---|---|---|
| [E101](#e101) | error | Lexical analysis | Illegal character |
| [E102](#e102) | error | Lexical analysis | Invalid constant |
| [E103](#e103) | error | Lexical analysis | Malformed identifier |
| [E104](#e104) | error | Lexical analysis | Unterminated block comment |
| [E105](#e105) | error | Lexical analysis | Unsupported Unicode character |
| [E106](#e106) | error | Lexical analysis | Lone slash |
| [E107](#e107) | error | Lexical analysis | Identifier too long |
| [W101](#w101) | warning | Lexical analysis | C-style operator |
| [E201](#e201) | error | Syntax analysis | Missing semicolon |
| [E202](#e202) | error | Syntax analysis | Unclosed parenthesis |
| [E203](#e203) | error | Syntax analysis | Unmatched closing parenthesis |
| [E204](#e204) | error | Syntax analysis | Missing right operand |
| [E205](#e205) | error | Syntax analysis | Missing left operand |
| [E206](#e206) | error | Syntax analysis | Missing operator |
| [E207](#e207) | error | Syntax analysis | Empty expression |
| [E208](#e208) | error | Syntax analysis | Missing = |
| [E209](#e209) | error | Syntax analysis | Invalid assignment target |
| [E210](#e210) | error | Syntax analysis | Reserved word or constant used as a name |
| [E211](#e211) | error | Syntax analysis | Empty declaration |
| [E212](#e212) | error | Syntax analysis | Malformed name list |
| [E213](#e213) | error | Syntax analysis | Chained assignment |
| [E214](#e214) | error | Syntax analysis | Unexpected end of file |
| [E215](#e215) | error | Syntax analysis | Invalid statement |
| [E216](#e216) | error | Syntax analysis | Comparison operator == |
| [E217](#e217) | error | Syntax analysis | NOT used as a binary operator |
| [E218](#e218) | error | Syntax analysis | Keyword inside an expression |
| [E219](#e219) | error | Syntax analysis | Expression nested too deeply |
| [W201](#w201) | warning | Syntax analysis | Unclear precedence |
| [W202](#w202) | warning | Syntax analysis | Empty statement |
| [W203](#w203) | warning | Syntax analysis | Non-associative chain |
| [W204](#w204) | warning | Syntax analysis | Redundant parentheses |
| [E301](#e301) | error | Semantic analysis | Undeclared identifier |
| [E302](#e302) | error | Semantic analysis | Duplicate declaration |
| [E303](#e303) | error | Semantic analysis | Conflicting declarations |
| [E304](#e304) | error | Semantic analysis | Assignment to an input |
| [E305](#e305) | error | Semantic analysis | Assignment to an undeclared signal |
| [E306](#e306) | error | Semantic analysis | Multiple drivers |
| [E307](#e307) | error | Semantic analysis | Undriven output |
| [E308](#e308) | error | Semantic analysis | Undriven wire |
| [E309](#e309) | error | Semantic analysis | Combinational loop |
| [E310](#e310) | error | Semantic analysis | Self-dependency |
| [E311](#e311) | error | Semantic analysis | No outputs |
| [W301](#w301) | warning | Semantic analysis | Unused input |
| [W302](#w302) | warning | Semantic analysis | Unused wire |
| [W303](#w303) | warning | Semantic analysis | Wire never used |
| [W304](#w304) | warning | Semantic analysis | Output copies an input |
| [W305](#w305) | warning | Semantic analysis | Constant output |
| [W306](#w306) | warning | Semantic analysis | Names differ only by case |
| [I301](#i301) | info | Semantic analysis | Output used internally |
| [W501](#w501) | warning | Optimization | Tautology |
| [W502](#w502) | warning | Optimization | Contradiction |
| [W503](#w503) | warning | Optimization | Input has no effect |
| [W504](#w504) | warning | Optimization | Equivalent outputs |
| [W505](#w505) | warning | Optimization | Two-level minimisation skipped |
| [I501](#i501) | info | Optimization | Rewrite applied |
| [I502](#i502) | info | Optimization | Optimization summary |
| [W601](#w601) | warning | Code generation | Truth table too large to display |
| [W602](#w602) | warning | Code generation | Circuit too large to draw clearly |
| [W603](#w603) | warning | Code generation | High fan-out |
| [W604](#w604) | warning | Code generation | Deep logic path |
| [E901](#e901) | error | Limits & internal checks | Too many errors |
| [W900](#w900) | warning | Limits & internal checks | Verification fallback |

## Lexical analysis

### E101

**Illegal character** (error)

The character is not part of GateLang. Only letters, digits, _, whitespace and the symbols = ; , ( ) & | ^ ! ~ / are allowed.

*How to fix:* Remove the character. If you meant an operator, use AND (&), OR (|), XOR (^) or NOT (!).

```
input a, b;
output y;
y = a @ b;
```

Compiler output:

```
error[E101]: illegal character '@'
 --> E101.gate:3:7
  |
3 | y = a @ b;
  |       ^
  = hint: remove it
```

### E102

**Invalid constant** (error)

GateLang works with single bits, so the only constants are 0 and 1. Numbers such as 2 or 10 have no meaning.

*How to fix:* Replace the number with 0 or 1.

```
input a;
output y;
y = a AND 2;
```

Compiler output:

```
error[E102]: '2' is not a valid constant; only single bits 0 and 1 are allowed
 --> E102.gate:3:11
  |
3 | y = a AND 2;
  |           ^
  = hint: use 0 or 1
```

### E103

**Malformed identifier** (error)

Signal names must start with a letter or an underscore. A digit is only allowed after the first character.

*How to fix:* Move the digits to the end of the name, for example b2 instead of 2b.

```
input a;
output y;
y = a OR 2b;
```

Compiler output:

```
error[E103]: '2b' is not a valid name: identifiers can't start with a digit
 --> E103.gate:3:10
  |
3 | y = a OR 2b;
  |          ^^
  = hint: try 'b2'
```

### E104

**Unterminated block comment** (error)

A block comment started with /* was never closed with */, so the rest of the file is treated as a comment.

*How to fix:* Add */ where the comment should end.

```
input a;
output y;
y = NOT a; /* remember to add the carry
```

Compiler output:

```
error[E104]: comment opened at 3:12 is never closed
 --> E104.gate:3:12
  |
3 | y = NOT a; /* remember to add the carry
  |            ^^
  = hint: close it with */
```

### E105

**Unsupported Unicode character** (error)

The file contains a non-ASCII character, often a logic symbol from a textbook (∧ ∨ ¬ ⊕) or a curly quote or non-breaking space pasted from a word processor.

*How to fix:* Type the GateLang keyword or symbol instead: ∧ → AND, ∨ → OR, ¬ → NOT, ⊕ → XOR.

```
input a, b;
output y;
y = a ∧ b;
```

Compiler output:

```
error[E105]: '∧' is not a valid character
 --> E105.gate:3:7
  |
3 | y = a ∧ b;
  |       ^
  = hint: use AND or &
```

### E106

**Lone slash** (error)

A single / is not an operator. Slashes are only used to start comments (// or /*).

*How to fix:* Use // for a comment, or remove the slash.

```
input a, b;
output y;
y = a / b;
```

Compiler output:

```
error[E106]: unexpected '/'; comments start with //
 --> E106.gate:3:7
  |
3 | y = a / b;
  |       ^
  = hint: use // for a comment, or remove the slash
```

### E107

**Identifier too long** (error)

Signal names are limited to 64 characters to keep netlists, Verilog output and diagrams readable.

*How to fix:* Choose a shorter name.

```
input this_signal_name_is_much_too_long_to_be_reasonable_in_a_netlist_x;
output y;
y = NOT this_signal_name_is_much_too_long_to_be_reasonable_in_a_netlist_x;
```

Compiler output:

```
error[E107]: identifier 'this_signal_name_is_…' is 65 characters long; the limit is 64
 --> E107.gate:1:7
  |
1 | input this_signal_name_is_much_too_long_to_be_reasonable_in_a_netlist_x;
  |       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  = hint: choose a shorter name
```

### W101

**C-style operator** (warning)

The C operators && and || are accepted as AND and OR, but they are not part of the official syntax.

*How to fix:* Use AND / & or OR / | instead.

```
input a, b;
output y;
y = a && b;
```

Compiler output:

```
warning[W101]: '&&' accepted as AND; prefer AND or &
 --> W101.gate:3:7
  |
3 | y = a && b;
  |       ^^
  = hint: write a AND b or a & b
```

## Syntax analysis

### E201

**Missing semicolon** (error)

Every statement must end with ;. The parser reached the start of the next statement (or the end of the file) without finding one.

*How to fix:* Add ; at the end of the statement.

```
input a, b;
output x, y;
x = a AND b
y = a OR b;
```

Compiler output:

```
error[E201]: expected ';' after 'b'
 --> E201.gate:3:12
  |
3 | x = a AND b
  |            ^
  = hint: add ; at the end of the statement
```

### E202

**Unclosed parenthesis** (error)

An opening ( has no matching ).

*How to fix:* Add the missing ) where the group should end.

```
input a, b;
output y;
y = (a AND b;
```

Compiler output:

```
error[E202]: '(' opened at 3:5 is never closed
 --> E202.gate:3:5
  |
3 | y = (a AND b;
  |     ^
  = hint: add ')' where the group should end
```

### E203

**Unmatched closing parenthesis** (error)

A ) appears without a matching (.

*How to fix:* Remove the extra ) or add the missing (.

```
input a, b;
output y;
y = a AND b);
```

Compiler output:

```
error[E203]: unmatched ')'
 --> E203.gate:3:12
  |
3 | y = a AND b);
  |            ^
  = hint: remove it or add the missing '('
```

### E204

**Missing right operand** (error)

A binary operator (or NOT) is not followed by a signal, constant or parenthesised expression.

*How to fix:* Add the missing operand, or remove the operator.

```
input a;
output y;
y = a AND ;
```

Compiler output:

```
error[E204]: 'AND' is missing its right-hand operand
 --> E204.gate:3:7
  |
3 | y = a AND ;
  |       ^^^
  = hint: add a signal or constant after it, or remove the operator
```

### E205

**Missing left operand** (error)

A binary operator appears at the start of an expression, so it has nothing on its left.

*How to fix:* Add the missing operand before the operator.

```
input b;
output y;
y = OR b;
```

Compiler output:

```
error[E205]: 'OR' is missing its left-hand operand
 --> E205.gate:3:5
  |
3 | y = OR b;
  |     ^^
  = hint: add a signal before the operator
```

### E206

**Missing operator** (error)

Two operands are written next to each other with no operator between them.

*How to fix:* Insert AND, OR, XOR, NAND, NOR or XNOR between them.

```
input a, b;
output y;
y = a b;
```

Compiler output:

```
error[E206]: expected an operator between 'a' and 'b'
 --> E206.gate:3:7
  |
3 | y = a b;
  |       ^
  = hint: insert AND, OR, XOR, NAND, NOR or XNOR between them
```

### E207

**Empty expression** (error)

There is nothing after = (or inside parentheses).

*How to fix:* Write an expression, for example y = a AND b;

```
input a;
output y;
y = ;
```

Compiler output:

```
error[E207]: assignment to 'y' has no expression
 --> E207.gate:3:5
  |
3 | y = ;
  |     ^
  = hint: write an expression, e.g. y = a AND b;
```

### E208

**Missing =** (error)

An assignment must have the form name = expression;. The = sign is missing.

*How to fix:* Insert = after the signal name.

```
input a, b;
output y;
y a AND b;
```

Compiler output:

```
error[E208]: expected '=' after 'y'
 --> E208.gate:3:2
  |
3 | y a AND b;
  |  ^
  = hint: write 'y = …;'
```

### E209

**Invalid assignment target** (error)

Only a single declared signal name can appear on the left of =. Constants and expressions cannot be assigned.

*How to fix:* Put one output or wire name on the left side.

```
input a, b;
output y;
y = NOT a;
1 = b;
```

Compiler output:

```
error[E209]: the constant '1' can't be assigned; the left side of '=' must be a signal name
 --> E209.gate:4:1
  |
4 | 1 = b;
  | ^
  = hint: put one output or wire name on the left side
```

### E210

**Reserved word or constant used as a name** (error)

Keywords (input, output, wire, AND, OR, NOT, XOR, NAND, NOR, XNOR) are reserved in any letter case, and constants cannot be names.

*How to fix:* Rename the signal, for example and_in instead of and.

```
input a, and;
output y;
y = NOT a;
```

Compiler output:

```
error[E210]: 'and' is a reserved keyword and can't be a signal name
 --> E210.gate:1:10
  |
1 | input a, and;
  |          ^^^
  = hint: rename it, for example and_in
```

### E211

**Empty declaration** (error)

A declaration keyword must be followed by at least one name.

*How to fix:* List the names, or delete the line.

```
input ;
input a;
output y;
y = NOT a;
```

Compiler output:

```
error[E211]: 'input' declaration lists no names
 --> E211.gate:1:1
  |
1 | input ;
  | ^^^^^
  = hint: list the names, or delete the line
```

### E212

**Malformed name list** (error)

Names in a declaration must be separated by single commas, with no comma at the end.

*How to fix:* Fix the commas, for example input a, b;

```
input a, , b;
output y;
y = a AND b;
```

Compiler output:

```
error[E212]: expected a name before ','
 --> E212.gate:1:10
  |
1 | input a, , b;
  |          ^
  = hint: remove the extra comma
```

### E213

**Chained assignment** (error)

Only one = is allowed per statement. Writing x = y = a assigns two signals in one statement.

*How to fix:* Split it into two statements: y = a; x = y;

```
input a;
output x, y;
x = y = a;
```

Compiler output:

```
error[E213]: only one '=' is allowed per statement
 --> E213.gate:3:7
  |
3 | x = y = a;
  |       ^
  = hint: assign each signal in its own statement
```

### E214

**Unexpected end of file** (error)

The file ended in the middle of a statement or expression.

*How to fix:* Finish the statement and end it with ;.

```
input a, b;
output y;
y = (a AND
```

Compiler output:

```
error[E214]: the file ended in the middle of an expression
 --> E214.gate:3:11
  |
3 | y = (a AND
  |           ^
  = hint: finish the expression and end it with ;
```

### E215

**Invalid statement** (error)

A statement must be a declaration (input, output or wire) or an assignment (name = expression;). This also catches misspelt keywords such as outptu.

*How to fix:* Start the statement with a declaration keyword or a signal name.

```
input a;
output y;
y = NOT a;
AND a;
```

Compiler output:

```
error[E215]: a statement can't start with 'AND'
 --> E215.gate:4:1
  |
4 | AND a;
  | ^^^
  = hint: statements start with input, output, wire or a signal name
```

### E216

**Comparison operator ==** (error)

GateLang has no comparison operator. Assignment uses a single =.

*How to fix:* Use = for assignment, or XNOR to test whether two signals are equal.

```
input a;
output y;
y == NOT a;
```

Compiler output:

```
error[E216]: GateLang uses '=' for assignment; '==' is not an operator
 --> E216.gate:3:3
  |
3 | y == NOT a;
  |   ^^
  = hint: use =, or XNOR to test whether two signals are equal
```

### E217

**NOT used as a binary operator** (error)

NOT takes exactly one operand, written after it. It cannot join two signals.

*How to fix:* Write a AND NOT b (or another binary operator) instead of a NOT b.

```
input a, b;
output y;
y = a NOT b;
```

Compiler output:

```
error[E217]: NOT takes one operand; it cannot join two signals
 --> E217.gate:3:7
  |
3 | y = a NOT b;
  |       ^^^
  = hint: did you mean 'a AND NOT b'?
```

### E218

**Keyword inside an expression** (error)

Declaration keywords (input, output, wire) cannot appear inside an expression.

*How to fix:* Remove the keyword, or move the declaration to its own statement.

```
input a;
output y;
y = input AND a;
```

Compiler output:

```
error[E218]: 'input' can't appear inside an expression
 --> E218.gate:3:5
  |
3 | y = input AND a;
  |     ^^^^^
  = hint: declarations go in their own statement, e.g. input a;
```

### E219

**Expression nested too deeply** (error)

Parentheses and NOTs may be nested at most 256 levels deep. The limit protects the recursive-descent parser from stack overflow.

*How to fix:* Simplify the expression or split it using wires.

```
input a;
output y;
y = ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((a)))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))) …
```

### W201

**Unclear precedence** (warning)

AND binds tighter than XOR, which binds tighter than OR. Mixing them without parentheses is legal but easy to misread (like gcc -Wparentheses).

*How to fix:* Add parentheses to show the intended grouping.

```
input a, b, c;
output y;
y = a AND b OR c;
```

Compiler output:

```
warning[W201]: 'AND' binds tighter than 'OR'; add parentheses to make the intent clear
 --> W201.gate:3:5
  |
3 | y = a AND b OR c;
  |     ^^^^^^^
  = hint: write (a AND b) OR … if that is what you mean
```

### W202

**Empty statement** (warning)

A stray ; with no statement before it is ignored.

*How to fix:* Delete the extra semicolon.

```
input a;
output y;
y = NOT a;;
```

Compiler output:

```
warning[W202]: empty statement ignored
 --> W202.gate:3:11
  |
3 | y = NOT a;;
  |           ^
  = hint: delete the extra semicolon
```

### W203

**Non-associative chain** (warning)

NAND and NOR are not associative: (a NAND b) NAND c differs from a NAND (b NAND c). Chains are parsed left to right.

*How to fix:* Add parentheses to make the grouping explicit.

```
input a, b, c;
output y;
y = a NAND b NAND c;
```

Compiler output:

```
warning[W203]: parsed as (a NAND b) NAND c; NAND isn't associative
 --> W203.gate:3:5
  |
3 | y = a NAND b NAND c;
  |     ^^^^^^^^^^^^^^^
  = hint: add parentheses to make the grouping explicit
```

### W204

**Redundant parentheses** (warning)

Parentheses around a single name or constant, or doubled parentheses, have no effect.

*How to fix:* Remove them.

```
input a;
output y;
y = NOT ((a));
```

Compiler output:

```
warning[W204]: redundant parentheses around 'a'
 --> W204.gate:3:10
  |
3 | y = NOT ((a));
  |          ^^^
  = hint: remove them
```

## Semantic analysis

### E301

**Undeclared identifier** (error)

A name is used in an expression but never declared. The compiler suggests the closest declared name when one is similar.

*How to fix:* Declare it (input, output or wire) or fix the spelling.

```
input carry, b;
output y;
y = cary AND b;
```

Compiler output:

```
error[E301]: 'cary' is not declared
 --> E301.gate:3:5
  |
3 | y = cary AND b;
  |     ^^^^
  = hint: did you mean 'carry'?
```

### E302

**Duplicate declaration** (error)

The same name is declared twice with the same kind.

*How to fix:* Remove the second declaration.

```
input a, a;
output y;
y = NOT a;
```

Compiler output:

```
error[E302]: 'a' is already declared at 1:7
 --> E302.gate:1:10
  |
1 | input a, a;
  |          ^
  = note: first declared here (1:7)
  = hint: remove the second declaration
```

### E303

**Conflicting declarations** (error)

The same name is declared with two different kinds (for example both input and output).

*How to fix:* Rename one of the signals.

```
input a, x;
output y, x;
y = a AND x;
```

Compiler output:

```
error[E303]: 'x' is declared as input (1:10) and as output (2:11)
 --> E303.gate:2:11
  |
2 | output y, x;
  |           ^
  = note: declared as input here (1:10)
  = hint: rename one of the signals
```

### E304

**Assignment to an input** (error)

Inputs are driven from outside the circuit, so they cannot be assigned.

*How to fix:* Assign to an output or wire instead.

```
input a, b;
output y;
a = b;
y = NOT a;
```

Compiler output:

```
error[E304]: 'a' is an input and can't be assigned
 --> E304.gate:3:1
  |
3 | a = b;
  | ^
  = note: declared as input here (1:7)
  = hint: inputs are driven from outside; assign to an output or wire
```

### E305

**Assignment to an undeclared signal** (error)

The left side of = names a signal that was never declared.

*How to fix:* Declare it first: output z; or wire z;

```
input a;
output y;
y = NOT a;
z = a;
```

Compiler output:

```
error[E305]: 'z' is not declared
 --> E305.gate:4:1
  |
4 | z = a;
  | ^
  = hint: declare it first: output z; or wire z;
```

### E306

**Multiple drivers** (error)

A signal is assigned more than once. In hardware a wire can have only one driver; two would short-circuit.

*How to fix:* Keep one assignment, or combine the expressions with AND/OR.

```
input a, b;
output y;
y = a AND b;
y = a OR b;
```

Compiler output:

```
error[E306]: 'y' is assigned more than once (3:1 and 4:1); a signal can have only one driver
 --> E306.gate:4:1
  |
4 | y = a OR b;
  | ^
  = note: first assigned here (3:1)
  = hint: keep one assignment, or combine the expressions with AND/OR
```

### E307

**Undriven output** (error)

An output is declared but never assigned, so its value would be undefined.

*How to fix:* Assign it, or remove the declaration.

```
input a;
output y, z;
y = NOT a;
```

Compiler output:

```
error[E307]: output 'z' is never assigned
 --> E307.gate:2:11
  |
2 | output y, z;
  |           ^
  = hint: assign it, e.g. z = …;
```

### E308

**Undriven wire** (error)

A wire is read in an expression but never assigned, so it would float.

*How to fix:* Assign the wire before relying on it.

```
input a;
output y;
wire t;
y = a AND t;
```

Compiler output:

```
error[E308]: wire 't' is used at 4:11 but never assigned
 --> E308.gate:4:11
  |
4 | y = a AND t;
  |           ^
  = note: declared here (3:6)
  = hint: assign it, e.g. t = …;
```

### E309

**Combinational loop** (error)

Signals depend on each other in a cycle. Combinational logic must be acyclic; a loop would latch or oscillate. Found with a depth-first search over the dependency graph.

*How to fix:* Break the cycle so that every signal depends only on inputs and earlier signals.

```
input a, b;
output x, y;
x = a AND y;
y = x OR b;
```

Compiler output:

```
error[E309]: combinational loop: x → y → x
 --> E309.gate:3:1
  |
3 | x = a AND y;
  | ^
  = note: 'y' assigned here (4:1)
  = hint: break the cycle so every signal depends only on inputs and earlier signals
```

### E310

**Self-dependency** (error)

A signal is defined in terms of itself, the shortest possible combinational loop.

*How to fix:* Remove the signal from its own expression.

```
input a;
output x;
x = x AND a;
```

Compiler output:

```
error[E310]: 'x' depends on itself
 --> E310.gate:3:1
  |
3 | x = x AND a;
  | ^
  = hint: remove 'x' from its own expression
```

### E311

**No outputs** (error)

The program declares no outputs, so there is nothing to compute.

*How to fix:* Declare at least one output and assign it.

```
input a, b;
// outputs are missing
```

Compiler output:

```
error[E311]: the program declares no outputs, so there is nothing to compute
 --> E311.gate:1:1
  |
1 | input a, b;
  | ^
  = hint: declare and assign at least one output, e.g. output y; y = a AND b;
```

### W301

**Unused input** (warning)

An input is declared but never read.

*How to fix:* Use it or remove it.

```
input a, b, c;
output y;
y = a AND b;
```

Compiler output:

```
warning[W301]: input 'c' is declared but never used
 --> W301.gate:1:13
  |
1 | input a, b, c;
  |             ^
  = hint: use it or remove it
```

### W302

**Unused wire** (warning)

A wire is assigned but never read, so its logic is dead.

*How to fix:* Use the wire or delete it. The optimizer removes it anyway.

```
input a, b;
output y;
wire t;
t = a OR b;
y = a AND b;
```

Compiler output:

```
warning[W302]: wire 't' is assigned but never used
 --> W302.gate:3:6
  |
3 | wire t;
  |      ^
  = hint: use it or delete it; the optimizer removes it anyway
```

### W303

**Wire never used** (warning)

A wire is declared but neither assigned nor read.

*How to fix:* Delete the declaration.

```
input a;
output y;
wire t;
y = NOT a;
```

Compiler output:

```
warning[W303]: wire 't' is declared but never assigned or used
 --> W303.gate:3:6
  |
3 | wire t;
  |      ^
  = hint: delete the declaration
```

### W304

**Output copies an input** (warning)

An output is assigned directly from an input. It needs no gates and acts as a buffer.

*How to fix:* Check that this is intended.

```
input a;
output y;
y = a;
```

Compiler output:

```
warning[W304]: output 'y' just copies input 'a'
 --> W304.gate:3:1
  |
3 | y = a;
  | ^^^^^
  = hint: it needs no gates; check that this is intended
```

### W305

**Constant output** (warning)

An output is assigned a constant, so it never changes.

*How to fix:* Check that this is intended.

```
input a;
output y, z;
y = NOT a;
z = 1;
```

Compiler output:

```
warning[W305]: output 'z' is the constant 1
 --> W305.gate:4:1
  |
4 | z = 1;
  | ^^^^^
  = hint: it never changes; check that this is intended
```

### W306

**Names differ only by case** (warning)

Two declared names differ only in letter case. Names are case-sensitive, so this is legal but easy to confuse.

*How to fix:* Rename one of them.

```
input carry, Carry;
output y;
y = carry AND Carry;
```

Compiler output:

```
warning[W306]: 'Carry' and 'carry' differ only by case
 --> W306.gate:1:14
  |
1 | input carry, Carry;
  |              ^^^^^
  = note: 'carry' declared here (1:7)
  = hint: rename one of them to avoid confusion
```

### I301

**Output used internally** (info)

An output also feeds other logic. This is allowed, for example when a carry output drives the next stage.

```
input a, b;
output x, y;
x = a AND b;
y = x OR a;
```

Compiler output:

```
info[I301]: output 'x' also feeds other logic (allowed)
 --> I301.gate:4:5
  |
4 | y = x OR a;
  |     ^
```

## Optimization

### W501

**Tautology** (warning)

The output is 1 for every combination of inputs (found by exhaustive bit-parallel evaluation).

*How to fix:* Check the logic; the output could be replaced by the constant 1.

```
input a;
output y;
y = a OR NOT a;
```

Compiler output:

```
warning[W501]: output 'y' is 1 for every input (tautology)
 --> W501.gate:3:1
  |
3 | y = a OR NOT a;
  | ^^^^^^^^^^^^^^
  = hint: check the logic; it could be replaced by 1
```

### W502

**Contradiction** (warning)

The output is 0 for every combination of inputs.

*How to fix:* Check the logic; the output could be replaced by the constant 0.

```
input a;
output y;
y = a AND NOT a;
```

Compiler output:

```
warning[W502]: output 'y' is 0 for every input (contradiction)
 --> W502.gate:3:1
  |
3 | y = a AND NOT a;
  | ^^^^^^^^^^^^^^^
  = hint: check the logic; it could be replaced by 0
```

### W503

**Input has no effect** (warning)

The input is used in an expression, but no output actually depends on it. For example, by absorption a OR (a AND b) = a.

*How to fix:* Simplify the expression or remove the input.

```
input a, b;
output y;
y = a OR (a AND b);
```

Compiler output:

```
warning[W503]: input 'b' has no effect on any output
 --> W503.gate:1:10
  |
1 | input a, b;
  |          ^
  = note: used here (3:17)
  = hint: simplify the expression or remove the input
```

### W504

**Equivalent outputs** (warning)

Two outputs compute exactly the same Boolean function, even if they are written differently.

*How to fix:* Keep one output, or check that they were meant to differ.

```
input a, b;
output f, g;
f = a AND b;
g = NOT (a NAND b);
```

Compiler output:

```
warning[W504]: outputs 'f' and 'g' compute the same function
 --> W504.gate:4:1
  |
4 | g = NOT (a NAND b);
  | ^^^^^^^^^^^^^^^^^^
  = note: 'f' assigned here (3:1)
  = hint: keep one output, or check that they were meant to differ
```

### W505

**Two-level minimisation skipped** (warning)

Quine–McCluskey (-O2) runs only for outputs that depend on at most 10 inputs, because its cost grows exponentially. The -O1 result is used instead.

*How to fix:* No action needed; the -O1 result is still verified.

```
input x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, x10;
output y;
y = x0 XOR x1 XOR x2 XOR x3 XOR x4 XOR x5 XOR x6 XOR x7 XOR x8 XOR x9 XOR x10;
```

Compiler output:

```
warning[W505]: Quine–McCluskey skipped for 'y' (11 inputs > 10); the -O1 result is used
  = hint: the -O1 result is still verified
```

### I501

**Rewrite applied** (info)

One optimization rule fired. Each rewrite is listed in the optimization log with the law used and the source line.

### I502

**Optimization summary** (info)

A summary of gate count, logic depth and the equivalence check after optimization.

```
input a, b;
output y;
y = NOT NOT (a AND b);
```

Compiler output:

```
info[I502]: 3 gates → 1 gates (−67%), depth 3 → 1; verified over all 4 input combinations
```

## Code generation

### W601

**Truth table too large to display** (warning)

Above 16 inputs the truth table is not fully displayed. Above 20 inputs it is not computed, and equivalence is checked with 4,096 random input vectors instead.

*How to fix:* Use the netlist or Verilog output, or split the circuit.

```
input x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11, x12, x13, x14, x15, x16;
output y;
y = x0 XOR x1 XOR x2 XOR x3 XOR x4 XOR x5 XOR x6 XOR x7 XOR x8 XOR x9 XOR x10 XOR x11 XOR x12 XOR x13 XOR x14 XOR x15 XOR x16;
```

Compiler output:

```
warning[W601]: the truth table has 131,072 rows; showing the first 65,536 (CSV export has all rows)
  = hint: use the netlist or Verilog output, or split the circuit
```

### W602

**Circuit too large to draw clearly** (warning)

Circuits with more than 80 gates are still drawn, but they are hard to read. Use zoom, or the netlist view.

*How to fix:* Raise the optimization level or split the design.

```
input a, b;
output y;
y = a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR b XOR a XOR  …
```

### W603

**High fan-out** (warning)

One signal drives more than 8 gate inputs. Real hardware would need a buffer to keep the signal fast and clean.

*How to fix:* Insert buffers (wires) or restructure the logic.

```
input s, x0, x1, x2, x3, x4, x5, x6, x7, x8;
output y0, y1, y2, y3, y4, y5, y6, y7, y8;
y0 = s AND x0;
y1 = s AND x1;
y2 = s AND x2;
y3 = s AND x3;
y4 = s AND x4;
y5 = s AND x5;
y6 = s AND x6;
y7 = s AND x7;
y8 = s AND x8;
```

Compiler output:

```
warning[W603]: 's' drives 9 gates; real hardware would need a buffer
 --> W603.gate:1:7
  |
1 | input s, x0, x1, x2, x3, x4, x5, x6, x7, x8;
  |       ^
  = hint: insert a wire as a buffer or restructure the logic
```

### W604

**Deep logic path** (warning)

The longest path from an input to an output passes through more than 10 gates. Each gate adds propagation delay.

*How to fix:* Balance the expression with parentheses, for example (a XOR b) XOR (c XOR d).

```
input x0, x1, x2, x3, x4, x5, x6, x7, x8, x9, x10, x11;
output y;
y = x0 XOR x1 XOR x2 XOR x3 XOR x4 XOR x5 XOR x6 XOR x7 XOR x8 XOR x9 XOR x10 XOR x11;
```

Compiler output:

```
warning[W604]: the longest input-to-output path is 11 gates deep (propagation delay)
  = hint: balance the expression with parentheses, e.g. (a XOR b) XOR (c XOR d)
```

## Limits & internal checks

### E901

**Too many errors** (error)

After 50 errors the compiler stops reporting more, because later errors are usually consequences of earlier ones.

*How to fix:* Fix the first errors and compile again.

```
input a;
output y;
y = NOT a;
@ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @
```

Compiler output:

```
error[E901]: too many errors; stopping after 50
 --> E901.gate:4:101
  |
4 | @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @ @
  |                                                                                                     ^
  = hint: fix the first errors and compile again
```

### W900

**Verification fallback** (warning)

Self-check: the optimized or generated circuit did not match the unoptimized program on every input, so the compiler fell back to the -O0 circuit. This protects you from optimizer bugs; it should never appear in normal use.

*How to fix:* Please report the program that caused it.
