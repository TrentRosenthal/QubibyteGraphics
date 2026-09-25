# Qubi standard library

Every standard library call expands into native Qubi gates. The expanded ops share a `group` (name, call text, wires) so a circuit diagram can show one labeled box or open it up. The expansions live in `src/qubi/stdlib.js`; their correctness is checked against an independent statevector in `tests/parser/stdlib.test.js`.

## Conventions

- Qubit 0 is the least significant bit. A register given as wires `w` holds the integer sum of bit(`w[k]`) times 2^k, so its first wire is the LSB. `0b110` has qubit 0 = 0, qubit 1 = 1, qubit 2 = 1.
- Multi-controlled gates stay single ops: the oracle in `Grover(0b110)` uses `CZ [0,1,2]`, one op with controls (0,1). Nothing is decomposed.
- Rotations with controls (in `StatePreparation` and `W`) are `RY` ops with a `controls` list.
- Arguments in brackets below are optional. Wire arguments accept a number, a range, a parallel list, or a bracket register.
- Angles use CodeAngleUnit, like every other angle in Qubi.

## Calls

| Call | Default wires | What it builds |
| --- | --- | --- |
| `Bell([wires])` | (0,1) | `H a` then `CX [a,b]`: (&#124;00> + &#124;11>)/sqrt(2). |
| `GHZ([wires])` | (0,1,2) | `H` on the first wire, then a chain of CX: (&#124;0...0> + &#124;1...1>)/sqrt(2). `GHZ(0..3)`. |
| `W([wires])` | (0,1,2) | One excitation spread evenly: X on the first wire, then for each next wire a controlled RY with cos(theta/2) = sqrt(1/(n-k+1)) and a CX back. `W(0..2)` gives 1/3 on each of 001, 010, 100. |
| `Superdense(message, [wires])` | (0,1) | A 2-bit message (0b00 to 0b11) sent through a Bell pair. Bit 1 applies X, bit 0 applies Z on the first wire; the decoding leaves the wires in the message, bit 0 on the first wire. |
| `Teleport([wires])` | (0,1,2) | Moves the state of the first wire to the third. The corrections are `CX [alice,bob]` and `CZ [source,bob]` (deferred measurement), so the result needs no classical feed-forward. |
| `Deutsch([oracle], [wires])` | (x, y) = (0,1) | Oracle `"constant0"`, `"constant1"`, `"balanced"` (f(x) = x, the default) or `"balanced-inverted"` (f(x) = not x). The x wire ends in 1 for a balanced oracle and 0 for a constant one. |
| `BV(secret, [wires])` | 0..width-1 | Bernstein-Vazirani with a phase oracle (Z on each secret bit between two H layers). The wires end in the secret: `BV(0b1011)` reads 1011. |
| `Grover(marked, [iterations], [wires])` | 0..width-1 | The argument is the marked state; the qubit count is its bit width. H on all wires, then each iteration applies the phase oracle (X on the zero bits, multi-controlled Z, X back) and the diffusion (H, X, multi-controlled Z, X, H). Iterations default to round(pi/(4 asin(sqrt(M/N))) - 1/2), which equals round(pi/4 sqrt(N/M)) for large N. A list of marked states, all the same width, is accepted. There is never an X preparation of the marked state. `Grover(0b110)` finds 110 with probability 0.945. |
| `QFT(wires)` | none | Quantum Fourier transform with the first wire as LSB: basis state x goes to the sum over k of e^(2 pi i x k / 2^n) &#124;k> / sqrt(2^n). Built from H and CP, starting at the most significant wire, with SWAPs at the end. `QFT(0..4)`. |
| `IQFT(wires)` | none | The exact inverse of `QFT` on the same wires (reversed order, negated angles). `IQFT(0..2)`. |
| `Shor([N], [a], [counting], [wires])` | 0..counting+3 | Order finding for N = 15 (the only supported modulus), a in {2, 4, 7, 8, 11, 13, 14} (default 7), counting qubits default 3. Wires hold the counting register, then a 4-qubit work register set to 1. Each counting qubit k controls multiplication by a^(2^k) mod 15, built as controlled SWAP rotations (multiplying by 2, 4, 8) plus controlled X on every work wire for the negative residues (7 = -8, 11 = -4, 13 = -2, 14 = -1). An IQFT on the counting register finishes. For a = 7 the counting register reads 0, 2, 4, 6 with probability 1/4 each. |
| `PhaseKickback(kind, [wires])` | (control, target) = (0,1) | `kind` is `"CX"` or `"CZ"`; anything else is an error. The target is prepared in the eigenstate with eigenvalue -1 (&#124;-> for CX, &#124;1> for CZ), so the control, between two H gates, ends in &#124;1>. |
| `PhaseOracle(marked, [wires])` | 0..width-1 | Flips the sign of the marked basis state (or each state in a list) and leaves the rest unchanged. |
| `SwapTest(["similar"], [wires])` | (0,1,2) | An ancilla and two registers of equal size (3, 5, 7, ... wires). H, a controlled SWAP per pair, H; P(ancilla = 0) = (1 + &#124;<a&#124;b>&#124;^2)/2. `"similar"` first prepares the two registers in close states (RY(0.4 pi) and RY(0.5 pi) per qubit), giving P(0) of about 0.988. |
| `StatePreparation(states, [probabilities], [wires])` | 0..width-1 | Basis states (a bitstring or a list such as `(0b101..0b111)`) with their probabilities; whatever is left of 1 goes to &#124;0...0>. Without probabilities the states share 1 evenly. One state with probability 1 becomes X gates; anything else is a uniformly controlled RY cascade (most significant wire first, X on controls that must read 0). `StatePreparation(0b101, 0.4)` gives 0.4 on 101 and 0.6 on 000. The optional wire list must be at least as long as the widest state: `StatePreparation(0b101, 0.5, 1..3)`. |
| `StatePreparation(name, [wires])` | bell (0,1), ghz and superposition (0,1,2) | `"bell"`, `"ghz"`, or `"superposition"` (H on every wire). |
| `QubitPreparation(probabilities, [wires])` | 0..count-1 | RY(2 asin(sqrt(p))) on each wire, so P(&#124;1>) = p per qubit. `QubitPreparation((0.2, 0.5, 0.8))` or `QubitPreparation((0.2.0.1.0.5))`. |
| `BitFlip([error], [wires])` | (data, a1, a2) = (0,1,2) | The 3-qubit bit-flip code: encode with two CX, apply X on code qubit `error` (0, 1, or 2; -1 or omitted for none), decode with two CX, and correct with `CX [a1,a2,data]`. The data qubit returns to its input state and (a1, a2) hold the syndrome. |
| `QPE(angle, [counting], [wires])` | 0..counting | Phase estimation of P(angle) with `counting` qubits (default 3) and the target on the last wire, prepared in &#124;1>. The counting register reads angle/(2 pi) times 2^counting: `QPE(0.5)` (a quarter turn in piradians) reads 2. |
| `Stego(secret, ["hide" or "reveal"], [wires])` | 0..width-1 | Hides a bitstring in the phases of a uniform superposition (H on every wire, Z on the secret bits): every outcome is equally likely. `"reveal"` adds the decoding H layer, after which the wires read the secret. The default is `"hide"`. |
