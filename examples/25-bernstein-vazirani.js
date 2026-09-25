import { explainQubi } from '../src/index.js';

export const config = { theme: 'clean-dark' };

// Bernstein-Vazirani reads a hidden bitstring with a single query.
export default explainQubi('BV(0b1011)', { title: 'One query finds the secret' });
