import { explainQubi } from '../src/index.js';

export const config = { theme: 'navy-explainer' };

// Probability that a given wire reads 1, from the full distribution.
const pOne = (probs, wire) => probs.reduce((s, p, i) => s + ((i >> wire) & 1 ? p : 0), 0);

// Teleporting a prepared state from qubit 0 to qubit 2.
export default explainQubi('RY 0 0.3\nTeleport()', {
  title: 'Teleporting one qubit',
  closing: (sim, probs) => `Qubit 2 now reads 1 with probability ${+(pOne(probs, 2) * 100).toFixed(1)} percent, exactly what qubit 0 started with.`,
});
