import { explainQubi } from '../src/index.js';

export const config = { theme: 'qubibyte' };

// Narrated quantum Fourier transform of the basis state 22 on five qubits.
export default explainQubi('X (1,2,4)\nQFT(0..4)');
