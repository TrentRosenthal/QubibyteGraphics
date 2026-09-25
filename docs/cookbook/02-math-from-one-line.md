# Math from one line

`explainMath` turns a single expression into a narrated animation. The steps come from the symbolic engine, so every line is a real rewrite with the rule that produced it.

```js
import { explainMath } from 'qubibyte-graphics';

export default explainMath('int_0^1 x e^x dx');
```

Supported forms:

| Input | What you get |
| --- | --- |
| `d/dx x^2 sin(x)` | Differentiation with the product, chain, and power rules named |
| `int x cos(x) dx` | An antiderivative, with integration by parts or substitution |
| `int_0^1 x e^x dx` | A definite integral, evaluated at the limits |
| `solve x^2 - 5x + 6 = 0` | Equation solving |
| `[[1,2],[3,4]] * [[5,6],[7,8]]` | A matrix product walked row by column |
| `eigen [[2,1],[1,2]]` | Eigenvalues and eigenvectors beside a transforming plane |

The math engine is also available directly: `differentiate`, `integrate`, `solve`, `eigen`, and more, from `qubibyte-graphics/math`.
