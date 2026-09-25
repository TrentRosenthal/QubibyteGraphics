#!/usr/bin/env node
/**
 * Optional bundle step. Produces dist/qubibyte-graphics.min.js (IIFE with a
 * browser global) and dist/qubibyte-graphics.esm.js. The unbundled source in
 * src/ works in the browser without this step.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { PROJECT } from '../src/config.js';

mkdirSync('dist', { recursive: true });

const common = {
  entryPoints: ['src/index.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ['es2022'],
  legalComments: 'none',
  loader: { '.ttf': 'empty', '.jhf': 'empty' },
  // Node built-ins are only reached through dynamic imports on the Node code
  // path (reading fonts from disk, inflating compressed tables); the browser
  // never runs them, so they stay as imports instead of being bundled.
  external: ['node:*'],
};

await build({
  ...common,
  format: 'iife',
  globalName: PROJECT.globalName,
  outfile: `dist/${PROJECT.packageName}.min.js`,
});

await build({
  ...common,
  format: 'esm',
  outfile: `dist/${PROJECT.packageName}.esm.js`,
});

console.log(`Bundled dist/${PROJECT.packageName}.min.js and dist/${PROJECT.packageName}.esm.js`);
