#!/usr/bin/env node
/**
 * Copies everything the GitHub Pages site needs into out/pages.
 * The editor is index.html at the root; docs live under docs/site.
 */
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';

const out = 'out/pages';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entries = ['index.html', 'src', 'styles', 'vendor', 'examples', 'dist', 'docs/site'];
for (const e of entries) {
  if (!existsSync(e)) continue;
  // Skip local render caches and other dot folders; they are never part of the site.
  cpSync(e, `${out}/${e}`, { recursive: true, filter: (src) => !/(^|\/)\.qgfx-cache(\/|$)/.test(src) });
}
cpSync('src/embed/qubibyte-scene.js', `${out}/qubibyte-scene.js`);
writeFileSync(`${out}/.nojekyll`, '');
console.log('Staged ' + out);
