#!/usr/bin/env node
/**
 * Bundle size budget. Fails when the minified core bundle exceeds the budget.
 */
import { statSync } from 'node:fs';

const BUDGET_KB = 900;
const file = 'dist/qubibyte-graphics.min.js';
const kb = statSync(file).size / 1024;
console.log(`${file}: ${kb.toFixed(1)} KB (budget ${BUDGET_KB} KB)`);
if (kb > BUDGET_KB) {
  console.error('Size budget exceeded.');
  process.exit(1);
}
