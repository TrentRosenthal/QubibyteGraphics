#!/usr/bin/env node
/**
 * Copies everything the GitHub Pages site needs into out/pages.
 * The playground is index.html at the root; docs live under docs/site.
 */
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';

const out = 'out/pages';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entries = ['index.html', 'src', 'styles', 'vendor', 'examples', 'dist', 'docs/site', 'docs/renders'];
for (const e of entries) {
  if (!existsSync(e)) continue;
  cpSync(e, `${out}/${e}`, { recursive: true });
}
cpSync('src/embed/qubibyte-scene.js', `${out}/qubibyte-scene.js`);
mkdirSync(`${out}/.nojekyll`, { recursive: false });
console.log('Staged ' + out);
