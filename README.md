# GateLang

**A six-phase compiler that turns Boolean logic into verified gate-level circuits.**

You write a circuit as Boolean equations. GateLang runs it through all six classic compiler phases and produces a circuit diagram you can click on, a truth table, a gate-level netlist and synthesizable Verilog. It also proves that the result is correct.

```
input a, b, cin;
output sum, cout;

sum  = a XOR b XOR cin;
cout = (a AND b) OR (cin AND (a XOR b));
```

Compiler Design course project (work in progress): a complete six-phase compiler for GateLang,
written in plain JavaScript so the same code runs in the browser and under Node.js.
