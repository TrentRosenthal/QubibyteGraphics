import { explainQubi } from '../src/index.js';

export const config = { theme: 'navy-explainer' };

// A Bell pair: one Hadamard, one controlled X, then both qubits measured.
export default explainQubi('H 0\nCX [0,1]\nMEASURE (0,1)', { title: 'Making a Bell pair' });
