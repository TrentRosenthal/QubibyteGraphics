#!/usr/bin/env node
/**
 * Build the static documentation site into docs/site: an overview, the
 * cookbook (docs/cookbook/*.md), the gallery with open-in-playground links,
 * the API reference generated from JSDoc, the Qubi reference and standard
 * library, the theme sheets, and the quality log. Plain HTML that reads the
 * playground's design tokens; no client script is needed to read it.
 *
 *   node tools/build-docs.js
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { PROJECT } from '../src/config.js';
import { buildIndexes } from './build-api-index.js';
import { encodePermalink } from '../src/playground/permalink.js';

const OUT = 'docs/site';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// Paths from docs/site/<page>.html back to the repository root as staged on Pages.
const ROOT = '../../';

/**
 * Escape text for HTML.
 * @param {string} s
 * @returns {string}
 */
export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s) {
  const codes = [];
  let t = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => `<a href="${href.replace(/\.md(#|$)/, '.html$1')}">${text}</a>`);
  // eslint-disable-next-line no-control-regex
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/**
 * A small Markdown renderer for the project's own docs: headings,
 * paragraphs, fenced code, lists, tables, block quotes, and inline code,
 * emphasis, and links.
 * @param {string} src
 * @returns {{html: string, title: string, headings: Array<{level: number, text: string, id: string}>}}
 */
export function markdown(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = [];
  const headings = [];
  let title = '';
  let i = 0;
  const slug = (t) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slug(text);
      if (level === 1 && !title) title = text;
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|\s*:?-{3,}/.test(lines[i + 1])) {
      const row = (l) => l.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      const head = row(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(row(lines[i++]));
      out.push(`<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||>\s?|\s*([-*]|\d+\.)\s+)/.test(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return { html: out.join('\n'), title, headings };
}

const NAV = [
  ['index.html', 'Overview'],
  ['cookbook.html', 'Cookbook'],
  ['gallery.html', 'Gallery'],
  ['api.html', 'API'],
  ['qubi.html', 'Qubi'],
  ['themes.html', 'Themes'],
  ['quality.html', 'Quality'],
];

function page(file, title, body, opts = {}) {
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === file ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const toc = opts.toc && opts.toc.length ? `<nav class="toc" aria-label="On this page">${opts.toc.map((h) => `<a class="l${h.level}" href="#${h.id}">${esc(h.text)}</a>`).join('')}</nav>` : '';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | ${esc(PROJECT.name)}</title>
<link rel="stylesheet" href="${ROOT}styles/tokens.css">
<link rel="stylesheet" href="docs.css">
</head>
<body>
<header class="top">
  <a class="brand" href="index.html">${esc(PROJECT.name)}</a>
  <nav class="main">${nav}</nav>
  <a class="play" href="${ROOT}index.html">Open the playground</a>
</header>
<div class="layout${toc ? ' with-toc' : ''}">
${toc}
<main>
${body}
</main>
</div>
<footer><span>${esc(PROJECT.name)} ${esc(PROJECT.version)}</span><a href="${esc(PROJECT.repository)}">Source</a></footer>
</body>
</html>
`;
  writeFileSync(join(OUT, file), html);
}

// Overview.
const readme = existsSync('README.md') ? readFileSync('README.md', 'utf8') : `# ${PROJECT.name}`;
const overview = markdown(readme.replace(/^.*docs\/site.*$/gm, ''));
page('index.html', 'Overview', overview.html, { toc: overview.headings.filter((h) => h.level === 2) });

// Cookbook.
const recipes = existsSync('docs/cookbook') ? readdirSync('docs/cookbook').filter((f) => f.endsWith('.md')).sort() : [];
const recipeHtml = recipes.map((f) => {
  const r = markdown(readFileSync(join('docs/cookbook', f), 'utf8').replace(/^# /, '## '));
  return { html: `<section class="recipe">${r.html}</section>`, headings: r.headings };
});
page('cookbook.html', 'Cookbook', `<h1>Cookbook</h1>\n${recipeHtml.map((r) => r.html).join('\n')}`, { toc: recipeHtml.flatMap((r) => r.headings.filter((h) => h.level === 2)) });

// Gallery, with a permalink that opens each example's source in the playground.
const { api, gallery } = buildIndexes();
const cards = [];
for (const ex of gallery.examples) {
  const poster = `docs/renders/gallery/${ex.name}.png`;
  const source = readFileSync(ex.file, 'utf8');
  // The index takes the comment just above the default export; fall back to the first comment block.
  if (!ex.summary) {
    const m = /^((?:\/\/.*\n)+)/m.exec(source.replace(/^import.*\n|^export const config.*\n|^\n/gm, ''));
    if (m) ex.summary = m[1].replace(/^\/\/\s?/gm, '').replace(/\s+/g, ' ').trim();
  }
  const link = `${ROOT}index.html${await encodePermalink('code', source)}`;
  const img = existsSync(poster) ? `<img src="${ROOT}${poster}" alt="${esc(ex.title)}, poster frame" loading="lazy" width="480" height="270">` : '<div class="noposter"></div>';
  cards.push(`<article class="card">${img}<div class="meta"><h2>${esc(ex.title)}</h2><p>${esc(ex.summary)}</p><div class="links"><a href="${link}">Open in playground</a><a href="${ROOT}${ex.file}">Source</a></div></div></article>`);
}
page('gallery.html', 'Gallery', `<h1>Gallery</h1><p class="lede">${gallery.examples.length} scenes, each rendered and graded against the quality rubric. Open any of them in the playground to edit and re-render.</p><div class="grid">${cards.join('')}</div>`);

// API reference, grouped by module.
const byModule = new Map();
for (const e of api.exports) {
  const m = e.module || 'other';
  if (!byModule.has(m)) byModule.set(m, []);
  byModule.get(m).push(e);
}
const moduleName = (m) => m.replace(/^src\//, '').replace(/\.js$/, '');
const modules = [...byModule.keys()].sort();
const apiBody = modules.map((m) => {
  const items = byModule.get(m).map((e) => `<div class="sym" id="${esc(e.name)}"><div class="sig"><span class="kind">${esc(e.kind)}</span> <code>${esc(e.name)}${e.kind === 'function' || e.kind === 'class' ? esc(e.signature || '()') : ''}</code></div>${e.summary ? `<p>${inline(e.summary)}</p>` : ''}</div>`).join('');
  return `<section id="${esc(moduleName(m).replace(/\//g, '-'))}"><h2>${esc(moduleName(m))}</h2>${items}</section>`;
}).join('\n');
const sceneBody = `<section id="scene-members"><h2>Scene</h2>${api.scene.map((s) => `<div class="sym"><div class="sig"><code>scene.${esc(s.name)}${esc(s.signature || '')}</code></div>${s.summary ? `<p>${inline(s.summary)}</p>` : ''}</div>`).join('')}</section>`;
page('api.html', 'API reference', `<h1>API reference</h1><p class="lede">Every name exported from <code>${esc(PROJECT.packageName)}</code>, generated from the JSDoc in the source.</p>${sceneBody}${apiBody}`, {
  toc: [{ level: 2, text: 'Scene', id: 'scene-members' }, ...modules.map((m) => ({ level: 2, text: moduleName(m), id: moduleName(m).replace(/\//g, '-') }))],
});

// Qubi reference and standard library.
const qref = markdown(readFileSync('docs/qubi-reference.md', 'utf8'));
const qstd = existsSync('docs/qubi-stdlib.md') ? markdown(readFileSync('docs/qubi-stdlib.md', 'utf8').replace(/^# /m, '## ')) : { html: '', headings: [] };
page('qubi.html', 'Qubi', `${qref.html}\n${qstd.html}`, { toc: [...qref.headings, ...qstd.headings].filter((h) => h.level === 2) });

// Themes.
const themeSheets = existsSync('docs/renders/themes') ? readdirSync('docs/renders/themes').filter((f) => f.endsWith('.png')).sort() : [];
page('themes.html', 'Themes', `<h1>Themes</h1><p class="lede">Every built-in theme drawing the same five reference scenes. Set one with <code>config.theme</code> or <code>--theme</code>.</p>${themeSheets.map((f) => `<figure class="sheet"><img src="${ROOT}docs/renders/themes/${f}" alt="${esc(basename(f, '.png'))} theme, five reference scenes" loading="lazy"><figcaption>${esc(basename(f, '.png'))}</figcaption></figure>`).join('')}`);

// Quality: the rubric and the log.
const rubric = markdown(readFileSync('docs/QUALITY.md', 'utf8'));
const log = markdown(readFileSync('docs/QUALITY_LOG.md', 'utf8').replace(/^# /m, '## '));
page('quality.html', 'Quality', `${rubric.html}\n${log.html}`, { toc: [...rubric.headings, ...log.headings].filter((h) => h.level === 2) });

writeFileSync(join(OUT, 'docs.css'), readFileSync('tools/docs.css', 'utf8'));
console.log(`Built ${NAV.length} pages into ${OUT}: ${recipes.length} recipes, ${gallery.examples.length} gallery scenes, ${api.exports.length} exports.`);
