import { explainQubi } from '../src/index.js';

export const config = { theme: 'clean-light' };

// Three-qubit GHZ state: the Bell construction extended down a ladder.
export default explainQubi('H 0\nCX [0,1]\nCX [1,2]', { title: 'Three qubits, one coin flip' });
