/**
 * Property widgets for the block inspector, one per field kind: number
 * steppers with drag-to-scrub labels, color pickers with theme swatches,
 * selects, text, Qubi code with live diagnostics, TeX with a live preview,
 * toggles, and asset pickers.
 * @module editor/ui/fields
 */

import { CodeEditor } from '../../playground/editor/code-editor.js';
import { diagnose } from '../../qubi/index.js';
import { icon } from '../../playground/icons.js';
import { esc } from '../../playground/ui.js';

let uid = 0;
const nextId = (p) => `${p}-${++uid}`;

function decimals(step) {
  const s = String(step ?? 0.01);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

function roundTo(v, step) {
  const d = Math.min(6, decimals(step));
  return Number(v.toFixed(d));
}

/**
 * @typedef {Object} FieldContext
 * @property {(value: any, opts?: {commit?: boolean}) => void} change live change; commit records an undo step
 * @property {Record<string, string>} colors theme color tokens (name to hex)
 * @property {Record<string, any>} assets document assets
 * @property {(source: string) => Promise<{svg: string}>} texPreview
 * @property {(lang: string, before: string) => any} [completions]
 */

/**
 * Build the widget for a field.
 * @param {import('../blocks.js').Field} f
 * @param {any} value
 * @param {FieldContext} ctx
 * @returns {HTMLElement}
 */
export function fieldWidget(f, value, ctx) {
  const row = document.createElement('div');
  row.className = `bf bf-kind-${f.kind}`;
  row.dataset.key = f.key;
  const id = nextId('bf');
  switch (f.kind) {
    case 'number':
      numberField(row, f, value, ctx, id);
      break;
    case 'color':
      colorField(row, f, value, ctx, id);
      break;
    case 'select':
      row.innerHTML = `<label class="bf-label" for="${id}">${esc(f.label)}</label><span class="select full"><select id="${id}">${(f.options || []).map((o) => `<option value="${esc(o)}" ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>${icon('chevronDown')}</span>`;
      row.querySelector('select').addEventListener('change', (e) => ctx.change(e.target.value, { commit: true }));
      break;
    case 'bool':
      row.innerHTML = `<label class="bf-check" for="${id}"><input id="${id}" type="checkbox" class="check" ${value ? 'checked' : ''}><span>${esc(f.label)}</span></label>`;
      row.querySelector('input').addEventListener('change', (e) => ctx.change(e.target.checked, { commit: true }));
      break;
    case 'code':
      codeField(row, f, value, ctx);
      break;
    case 'tex':
      texField(row, f, value, ctx, id);
      break;
    case 'asset': {
      const list = Object.entries(ctx.assets || {});
      row.innerHTML = `<label class="bf-label" for="${id}">${esc(f.label)}</label><span class="select full"><select id="${id}"><option value="">None</option>${list.map(([k, a]) => `<option value="${esc(k)}" ${k === value ? 'selected' : ''}>${esc(a.name || k)}</option>`).join('')}</select>${icon('chevronDown')}</span>`;
      row.querySelector('select').addEventListener('change', (e) => ctx.change(e.target.value, { commit: true }));
      break;
    }
    default: {
      const text = Array.isArray(value) ? value.join('\n') : value ?? '';
      const multi = Array.isArray(value) || /\n/.test(String(text)) || f.key === 'functions';
      row.innerHTML = `<label class="bf-label" for="${id}">${esc(f.label)}</label>${multi ? `<textarea id="${id}" class="input mono" rows="3" spellcheck="false">${esc(text)}</textarea>` : `<input id="${id}" class="input" value="${esc(text)}" spellcheck="false">`}`;
      const inp = row.querySelector('input,textarea');
      const read = () => (Array.isArray(value) ? inp.value.split('\n').filter((l) => l.trim()) : inp.value);
      inp.addEventListener('input', () => ctx.change(read(), { commit: false }));
      inp.addEventListener('change', () => ctx.change(read(), { commit: true }));
    }
  }
  return row;
}

function numberField(row, f, value, ctx, id) {
  const step = f.step ?? 0.01;
  const clamp = (v) => Math.max(f.min ?? -Infinity, Math.min(f.max ?? Infinity, v));
  row.innerHTML = `<label class="bf-label bf-scrub" for="${id}" title="Drag to change">${esc(f.label)}</label>
    <span class="bf-number"><input id="${id}" class="input num" inputmode="decimal" value="${esc(fmt(value, step))}" aria-label="${esc(f.label)}">
    <span class="bf-steps"><button type="button" tabindex="-1" data-d="1" aria-label="Increase ${esc(f.label)}">${icon('plus')}</button><button type="button" tabindex="-1" data-d="-1" aria-label="Decrease ${esc(f.label)}">${icon('minus')}</button></span></span>`;
  const inp = row.querySelector('input');
  let cur = Number(value) || 0;
  const set = (v, commit) => {
    cur = clamp(roundTo(v, step));
    inp.value = fmt(cur, step);
    ctx.change(cur, { commit });
  };
  inp.addEventListener('change', () => {
    const v = Number(inp.value);
    if (Number.isFinite(v)) set(v, true);
    else inp.value = fmt(cur, step);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    set(cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1), true);
  });
  row.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => set(cur + Number(b.dataset.d) * step, true)));
  const label = row.querySelector('.bf-scrub');
  label.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = cur;
    label.setPointerCapture(e.pointerId);
    document.body.classList.add('is-scrubbing');
    const move = (ev) => set(v0 + Math.round((ev.clientX - x0) / 3) * step * (ev.shiftKey ? 10 : 1), false);
    const up = () => {
      label.removeEventListener('pointermove', move);
      label.removeEventListener('pointerup', up);
      document.body.classList.remove('is-scrubbing');
      set(cur, true);
    };
    label.addEventListener('pointermove', move);
    label.addEventListener('pointerup', up);
  });
}

function fmt(v, step) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return String(roundTo(n, step));
}

function colorField(row, f, value, ctx, id) {
  const tokens = ctx.colors || {};
  const resolve = (v) => (v == null ? null : tokens[v] ?? v);
  const draw = (v) => {
    const hex = resolve(v);
    row.querySelector('.bf-color-chip').style.background = hex ?? 'transparent';
    row.querySelector('.bf-color-chip').classList.toggle('is-none', !hex);
    row.querySelector('.bf-color-name').textContent = v == null ? 'None' : v;
  };
  row.innerHTML = `<span class="bf-label" id="${id}-l">${esc(f.label)}</span>
    <button type="button" class="bf-color" id="${id}" aria-labelledby="${id}-l ${id}" aria-expanded="false"><span class="bf-color-chip"></span><span class="bf-color-name"></span></button>
    <div class="bf-palette" hidden>
      <div class="bf-swatches" role="listbox" aria-label="Theme colors">
        <button type="button" class="bf-swatch is-none" data-v="" title="None" aria-label="None"></button>
        ${Object.entries(tokens).map(([k, hex]) => `<button type="button" class="bf-swatch" data-v="${esc(k)}" title="${esc(k)}" aria-label="${esc(k)}" style="background:${esc(hex)}"></button>`).join('')}
      </div>
      <div class="bf-custom"><input class="input mono" placeholder="#5b8def" aria-label="Custom hex color" value="${esc(value && !tokens[value] ? value : '')}"><input type="color" aria-label="Pick a custom color" value="${/^#[0-9a-f]{6}$/i.test(resolve(value) || '') ? resolve(value) : '#5b8def'}"></div>
    </div>`;
  draw(value);
  const btn = row.querySelector('.bf-color');
  const pal = row.querySelector('.bf-palette');
  btn.addEventListener('click', () => {
    pal.hidden = !pal.hidden;
    btn.setAttribute('aria-expanded', String(!pal.hidden));
  });
  row.querySelectorAll('.bf-swatch').forEach((s) => s.addEventListener('click', () => {
    const v = s.dataset.v || null;
    draw(v);
    ctx.change(v, { commit: true });
  }));
  const hexIn = row.querySelector('.bf-custom .input');
  hexIn.addEventListener('change', () => {
    const v = hexIn.value.trim();
    if (!/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) return;
    const hex = v.startsWith('#') ? v : `#${v}`;
    draw(hex);
    ctx.change(hex, { commit: true });
  });
  const picker = row.querySelector('input[type=color]');
  picker.addEventListener('input', () => {
    draw(picker.value);
    hexIn.value = picker.value;
    ctx.change(picker.value, { commit: false });
  });
  picker.addEventListener('change', () => ctx.change(picker.value, { commit: true }));
}

function codeField(row, f, value, ctx) {
  const lang = f.language === 'qubi' ? 'qubi' : 'js';
  row.innerHTML = `<span class="bf-label">${esc(f.label)}</span><div class="bf-code"></div><ul class="bf-diags"></ul>`;
  const ed = new CodeEditor(row.querySelector('.bf-code'), { language: lang, value: String(value ?? ''), label: f.label, completions: ctx.completions });
  const diags = row.querySelector('.bf-diags');
  const check = () => {
    if (lang !== 'qubi') return true;
    let list;
    try {
      list = diagnose(ed.value);
    } catch (e) {
      list = [{ severity: 'error', message: e.message }];
    }
    ed.setDiagnostics(list);
    diags.innerHTML = list.slice(0, 4).map((d) => `<li class="${d.severity}"><span class="mono">${d.line ?? ''}${d.line ? ':' : ''}${d.col ?? ''}</span> ${esc(d.message)}</li>`).join('');
    return !list.some((d) => d.severity === 'error');
  };
  check();
  let timer = null;
  ed.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (check()) ctx.change(ed.value, { commit: true });
    }, 350);
  });
  ed.addEventListener('run', () => {
    if (check()) ctx.change(ed.value, { commit: true });
  });
}

function texField(row, f, value, ctx, id) {
  row.innerHTML = `<label class="bf-label" for="${id}">${esc(f.label)}</label><input id="${id}" class="input mono" value="${esc(value ?? '')}" spellcheck="false"><div class="bf-tex" aria-hidden="true"></div>`;
  const inp = row.querySelector('input');
  const out = row.querySelector('.bf-tex');
  let seq = 0;
  const preview = async () => {
    const n = ++seq;
    if (!inp.value.trim()) {
      out.innerHTML = '';
      return;
    }
    try {
      const { svg } = await ctx.texPreview(inp.value);
      if (n !== seq) return;
      out.classList.remove('is-error');
      out.innerHTML = `<img alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
    } catch (e) {
      if (n !== seq) return;
      out.classList.add('is-error');
      out.textContent = e.message;
    }
  };
  preview();
  let timer = null;
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      preview();
      ctx.change(inp.value, { commit: false });
    }, 200);
  });
  inp.addEventListener('change', () => ctx.change(inp.value, { commit: true }));
}
