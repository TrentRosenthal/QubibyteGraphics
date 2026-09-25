# Qubi language reference

This is the language as Qubibyte defines it and the ground truth for this project. If a fuller spec file is added to the repo, that file wins over this one.

## Wires

`N` (single wire) | `all` | `visible` | `max` | `visiblemax` | `A..B` | `A..max` | `A..visiblemax` | `A.S.E` (stepped, step S may be negative or a variable) | `A.S.max` | `A.S.visiblemax` | `(a,b,c)` parallel list | `[a,b]` joint register for controlled gates.

Examples: `H visible`; `X (0..2)`; `H (0.2.max)`; `CX [0,1]`; `H (0, visiblemax, sqrt(4))`. Even wires: `0.2.max` or `0.2.visiblemax`. Odd wires: `1.2.max` or `1.2.visiblemax`. LSB = qubit 0, which is the rightmost bit in `0b...` literals and basis kets.

## Gates

`I H X Y Z S T SDG TDG RX RY RZ P U` | `CX CY CZ CP SWAP CSWAP ISWAP SQRTSWAP SWAPSEQ` | `MEASURE`. Controlled gates take brackets: `CX [c,t]`. Multi-control: `CX [c1,c2,t]`. Never `CX (0,1)`. `MEASURE 0`; `MEASURE (0,1)`; `MEASURE visible`; `MEASURE visiblemax`. MEASURE uses parentheses, never brackets.

## Angles

Bare numbers use `CodeAngleUnit` (default piradians). Suffixes `deg`, `rad`, `pirad`. `pi` and `π` are constants. Both `RX(0.5) q` and `RX q 0.5` are valid. Omitting the angle on RX/RY/RZ/P means π/2. Example: P(|0⟩)=80% from |0⟩ is `RY 0 0.295` (θ = 2·acos(√p) in piradians).

## Scalars

Operators `+ - * / % **`, ternary `?:`, parentheses. Constants `pi`/`π`, `e`, `max`, `visiblemax`. Functions: `sqrt round roundup rounddown sin cos tan asin acos atan` (trig arguments use CodeAngleUnit; asin/acos/atan return radians). Builtins: `len`/`length`, `count`, `tolist`, `typeof`, `listtype`, `error("msg")`. Types and casts: `int`, `float`/`number`, `string`, `bitstring`, `list`, `list-int`, `list-list-int`, `boolean`, `qubit`/`wire`; `(int)x` style casts. `wirelist`/`wires` are lists.

## Bitstrings and lists

Literals `0b...` and `0x...`; operators `& | ^ ~`; lists `(0b1,0b0)`; ranges `0b00..0b11`; stepped `0b00.(0b10).0b11`; index and slice `list[i]`, `list[0..2]`. Classical lists are parenthesized: `(0.2, 0.5, 0.8)` or stepped `(0.2.0.1.0.5)`, with `len()`, indexing `p[1]`, and slices `p[0..1]`.

## Variables and sweeps

`name=expr`; `++` and `--`. `sweepstate` is the conventional (not reserved) bitstring target for a parametric sweep. Sweep brackets: `name=<0..5>`; `g=<H,X,Y>`; `a=<0.(0.5).3>`; inline `<H,X> 0`; `LOOP <0..4> { }`.

## Control flow

`LOOP n { }` and `REPEAT n { }` (REPEAT is a silent alias; n ≥ 0; `max` and `visiblemax` allowed). While-style: `LOOP v<3 { v++ }`. `if cond { } elseif { } else { }` (also `elif` and `else if`; there is no `endif`). Logic: `&& and || or ^^ xor ! not`. Comparison: `> < >= <= == !=`.

## Labels and annotations

`LABEL wires "text"`; `ANNOTATE`/`ANN ... ENDANNOTATE`/`ENDANN "id"`. Strings interpolate `{n}` and `${expr}`.

## Settings, imports, definitions

`#settings KEY VALUE`. Keys: Scheduling, MaxQubits, VisibleQubits, Zoom, AutoAdjustVisibleQubits, DecimalPlaces, AutoRun, UseOptimizedGates, UseOptimizedSweep, StepByStep, ShowGateParams, ShowConditionalBranches, ShowEvaluatedLabels, GateParamAngleUnit, CodeAngleUnit, SymbolicNotation, HideNegligibles, SortBy, SortOrder. Scheduling values: `never`, `same_line`, `same_gate_continuous`, `same_gate` (alias `sameType`), `always`, `compressed`. Angle units: `degrees`, `radians`, `piradians` (aliases `deg`, `rad`, `pirad`).

`#import file.qubi` / `#include file.qubi` (depth ≤ 20).

Gate definition:

```
gate NAME {
	name: Display Name
	label: LBL
	matrix: [1 0; 0 e**(1i*pi/4)]
	desc: ...
	examples: NAME 0
	color: cyan
	category: Single
	qubits: 1
}
```

Gates can also be defined by `sequence:` instead of `matrix:`. Matrices use `e**` (not `exp()`), `1i` for the imaginary unit, `;` between rows. Functions: `function NAME(...) { }` or `fn NAME(...) { }`, with `arg`/`argmax`; `blackbox`/`encapsulate` modifiers.

## Standard library

`Bell GHZ W Superdense Teleport Deutsch BV Grover QFT IQFT Shor PhaseKickback PhaseOracle SwapTest StatePreparation QubitPreparation BitFlip QPE Stego`. Examples: `QFT(0..4)`; `IQFT(0..2)`; `Grover(0b110)` (the argument is the marked state; never X-prep before Grover); `GHZ(0..3)`; `W(0..2)`; `StatePreparation(0b101, 0.4)`; `StatePreparation((0b101..0b111), (0.2,0.3,0.4))`; `StatePreparation("bell"|"ghz"|"superposition")`; optional trailing wire range `StatePreparation(0b101, 0.5, 1..3)`; `QubitPreparation((0.2, 0.5, 0.8))` or `QubitPreparation((0.2.0.1.0.5))` sets per-qubit P(|1⟩). PhaseKickback accepts only `"CX"` or `"CZ"`. SwapTest includes a `"similar"` option.

## Comments

`//` line comments and `/* */` block comments. `//` is not a comment when it appears inside `()` or `[]` on that line.

## Traps

LSB is q0. `CX [c,t]`, never `CX (c,t)`. `MEASURE ()`, never `MEASURE []`. `A.S.E` (stepped) is not `A..B`. `visible`, `visiblemax`, `all`, and `max` are four different things. `typeof` is not `listtype`. `len` is not `count` on lists. `REPEAT` equals `LOOP`. `elseif`/`elif`, no `endif`. PhaseKickback only takes `"CX"` or `"CZ"`. Bare angles use CodeAngleUnit (default piradians). Matrices use `e**`, not `exp()`. `count` and `listtype` are not reserved as variable names but should be avoided.
