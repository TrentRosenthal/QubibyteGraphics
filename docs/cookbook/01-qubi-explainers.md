# Quantum explainers from Qubi

Write a Qubi program and get a narrated explainer: the code, the circuit built column by column, amplitude bars that sweep along each gate, and the Dirac form of the state.

```js
import { explainQubi } from 'qubibyte-graphics';

export default explainQubi('Grover(0b110)');
```

Grover programs get a geometry panel and a live probability; `QFT` programs get phase wheels. Anything else gets the general story. Pass `title` or `closing` to set the heading or the final line:

```js
explainQubi('RY 0 0.3\nTeleport()', {
  title: 'Teleporting one qubit',
  closing: (sim, probs) => 'Qubit 2 now carries what qubit 0 held.',
});
```

For custom scenes, the pieces are separate: `quantumViews.CircuitDiagram`, `AmplitudeBars`, `PhaseDisks`, `diracLatex`, and the 3D `BlochSphere` and `qSphere`.
