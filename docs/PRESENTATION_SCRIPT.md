# GateLang: presentation script (10 minutes + questions)

Four speakers: **A** (introduction and close), **B** (front end), **C** (back end), **D** (errors and testing). Replace the letters with your names. Lines marked **Say** are spoken; lines marked **Do** are clicks. Times are cumulative.

---

## Before you start (10 minutes before)

1. Open `dist/GateLang.html` in Chrome or Edge. It works offline, so no Wi-Fi is needed. Keep the GitHub Pages link open in a second tab as a backup.
2. Press **F11** for full screen. On a projector, click **Large text** in the top bar.
3. Click **Test suite → Run the test suite** once, so everything is warmed up, then click pad **1**.
4. Choose **Full adder** from the Example menu. Leave **-O1** and **Standard** selected.
5. Keep the screen recording of a full run-through (made during rehearsal) on the desktop in case the laptop misbehaves.

---

## Run sheet

| Time | Speaker | On screen | The point |
|---|---|---|---|
| 0:00 | A | Full adder, pad 1 | What we built and why it matters |
| 1:00 | A | Pipeline pads | Six phases plus symbol table and error handler |
| 2:00 | B | Pads 1, 2, 3 | Tokens, AST and parse tree, semantic checks |
| 4:00 | C | Optimization demo, pads 4, 5, 6 | TAC, 9 gates to 2 with a proof, circuit, NAND mapping |
| 6:30 | D | Error demo, loop demo, catalog | 10 errors in one run, live fix, 62 diagnostics |
| 8:30 | D | Test suite | 94 tests in the browser, 212 checks and 90,000 fuzz compilations from the CLI |
| 9:30 | A | Summary | What makes it different; questions |

---

## 0:00 · Introduction (A)

**Say:** "Good morning, ma'am. Our project is **GateLang**, a complete compiler for logic circuits. You describe a circuit as Boolean equations, like this full adder on the left, and GateLang compiles it through all six phases of a compiler. It produces a working circuit you can click on, its truth table, a gate-level netlist and Verilog. It also proves that the circuit is correct."

**Say:** "We picked logic gates because every phase has real work to do. There is a grammar with operator precedence, semantic rules like 'no loops' and 'one driver per wire', and an optimizer that rests on Boolean algebra."

## 1:00 · Architecture (A)

**Do:** point at the six pads across the top.

**Say:** "These six pads are the six phases, joined like a circuit trace. Copper means the phase passed, and the number underneath is how long it took, a fraction of a millisecond each. Phases 1 to 3 are the front end and phases 4 to 6 the back end. Two components are shared by every phase, as in the textbook model: the **symbol table** and the **error handler**, which knows 62 different diagnostics."

**Say:** "One design decision matters for errors: the front end always runs to the end, so we report *every* error in one run. The back end only runs when the program is valid."

## 2:00 · Front end (B)

**Do:** click pad **1**, then click the row for token 16 (`XOR`).

**Say:** "Phase 1, the lexer, is a hand-written DFA. It reads the file once and turns characters into tokens. Each token keeps its line and column, so clicking one highlights it in the editor. Keywords are found with a hash-map lookup, so recognising a word costs O(1)."

**Do:** click pad **2**. Then click **Parse tree**, and then **Syntax tree (AST)** again.

**Say:** "Phase 2 is an LL(1) recursive-descent parser, with one function per grammar rule. This is the syntax tree for the full adder. The parse tree view shows every grammar rule used. This chain of or_expr, xor_expr and and_expr is how the grammar encodes precedence: NOT binds tightest, then AND, then XOR, then OR."

**Do:** click pad **3**. Hover over `cout` in the dependency graph.

**Say:** "Phase 3 is semantic analysis. It fills the symbol table and runs these seven checks. The dependency graph shows which signal reads which. We run a depth-first search on it to find combinational loops, and a topological sort to get the order in which signals must be evaluated."

## 4:00 · Back end (C)

**Do:** Example menu → **Optimization demo**. Click pad **4**.

**Say:** "This program is deliberately wasteful. Phase 4 turns it into three-address code: one operator per instruction, stored as quadruples. One instruction is one gate, so this starts at 9 gates."

**Do:** click pad **5**. Click **-O0** in the panel, then **-O1**.

**Say:** "At -O0 nothing changes; that is our baseline. At -O1 the optimizer applies Boolean algebra until nothing more changes. The log shows each step: common-subexpression elimination spots that `b AND a` is the same as `a AND b`. Then the idempotent law, the involution law that turns NOT NOT c into c, the identity law and the absorption law. **Nine gates become two**, 78 percent fewer."

**Do:** point at the green bar.

**Say:** "And this is the part we're proudest of: after optimizing, the compiler **proves** that the new circuit behaves exactly like the original, by checking every input combination. It packs 32 truth-table rows into each machine word. If the optimizer ever got something wrong, the compiler would notice and fall back to the safe version."

**Do:** click pad **6**. Click input pins **a** and **b**: output `f` lights up.

**Say:** "Phase 6 is code generation. Here is the final circuit. It is live: wires carrying a 1 glow copper."

**Do:** click **NAND** in the top bar.

**Say:** "Like a C compiler targeting x86 or ARM, ours targets a gate library. With NAND-only gates, the naive mapping needs 5 NANDs. A peephole pass removes the double inversions and leaves 3. We also emit Verilog."

**Do:** click the **Verilog** sub-tab, then **Standard** in the top bar.

*(Only if you are ahead of time: Example → **Minimisation demo (-O2)**, pad 5. "At -O2 we add Quine–McCluskey minimisation: this goes from 9 gates at -O1 to 3.")*

## 6:30 · Errors (D)

**Do:** Example menu → **Error demo (10 errors)**.

**Say:** "Now the part most compilers skip: what happens when the code is wrong. This file has ten different mistakes. Look at the pipeline: the lexer found 2 errors, the parser 3 and semantic analysis 5, all in one run, and the back end was skipped. Every message has a code, the exact line and column, and a hint."

**Do:** in the Diagnostics list, click **E215** (outptu), then **E301** (sle).

**Say:** "A misspelt keyword gets 'did you mean output?', and the parser then recovers as if it were spelled correctly, so there are no follow-on errors. A misspelt signal gets 'did you mean sel?'. We use an edit distance that counts swapped letters as a single mistake."

**Do:** in the editor, change `sle` to `sel` on line 10.

**Say:** "If I fix it, the error count drops to nine immediately, because the compiler runs as you type."

**Do:** Example menu → **Combinational loop**.

**Say:** "Here x depends on z, z on y and y on x. That's a loop, which is illegal in combinational logic, and the compiler prints the whole cycle: x, y, z, back to x."

**Do:** click **Error catalog**. Type `loop` in the search box.

**Say:** "All 62 diagnostics are documented here, and every one has an example program you can load. Our tests check that each example produces exactly its own error and nothing else."

## 8:30 · Proof that it works (D)

**Do:** click **Test suite → Run the test suite**.

**Say:** "This runs in the browser: every catalog example, every example circuit at three optimization levels and three gate libraries, edge cases such as ten thousand nested brackets or binary garbage, a deliberately broken optimizer, and hundreds of random programs. 94 out of 94 pass."

**Say:** "From the command line, the full suite has 212 checks, including 118 golden test files. In the long run, ten thousand random circuits were compiled nine ways each, which is ninety thousand compilations, and every one was proven equivalent. Ten thousand randomly corrupted programs never crashed the compiler. The biggest example, a 7-segment display decoder, goes from 314 gates to 54."

## 9:30 · Close (A)

**Say:** "To sum up: all six phases do real work. We report every error at once with fixes, we have 62 documented diagnostics, the optimizer proves its own correctness, there are three gate libraries, and the results are backed by over a hundred thousand automated test runs. The full code is on GitHub and runs in any browser. Thank you, ma'am. We're happy to take questions."

---

## If something goes wrong

| Problem | What to do |
|---|---|
| Laptop or projector fails | Open the GitHub Pages link on any machine or phone, or play the screen recording |
| You typed something and the panels look odd | Choose the example again from the Example menu: it reloads cleanly |
| A wrong tab is open | Press Alt + 1 to 6 to jump to a phase, Alt + 7 for the catalog, Alt + 8 for tests |
| Text too small | Click **Large text** |
| Asked to show an error live | Delete a `;`, write `2` instead of `1`, or misspell a signal name |

## Quick answers during the demo

- **"Why not use yacc or ANTLR?"** The grammar is LL(1), so a hand-written recursive-descent parser is linear and needs no tools. It also gives us precise error messages, and each function maps to one grammar rule.
- **"How do you know the optimizer is right?"** Every compile checks the optimized circuit and the generated netlist against the unoptimized program on all 2ⁿ input combinations.
- **"Isn't code generation the same as intermediate code here?"** No. Intermediate code doesn't depend on the target. Code generation chooses gates from a specific library (XOR takes 4 NAND gates), applies peephole optimization, and emits a netlist and Verilog.
- **"What would you add next?"** Sequential logic (flip-flops and a clock), multi-bit buses such as `a[3:0]`, and reusable modules.

The full viva preparation (30 questions) is in Appendix D of the project report.
