import { explainQubi } from '../src/index.js';

export const config = { theme: 'qubibyte' };

// Phase estimation of P(3 pi / 4) with three counting qubits.
export default explainQubi('QPE(0.75, 3)', { title: 'Reading a phase into bits' });
