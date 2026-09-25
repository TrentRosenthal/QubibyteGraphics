/**
 * `#settings KEY VALUE` keys, value parsing, and defaults.
 *
 * Defaults, used when a program does not set the key:
 *
 * | Key | Default | Values |
 * | --- | --- | --- |
 * | Scheduling | `same_line` | `never`, `same_line`, `same_gate_continuous`, `same_gate` (alias `sameType`), `always`, `compressed` |
 * | MaxQubits | `null` (inferred: highest wire + 1, at least 8 when `max`, `all`, `visible` or `visiblemax` is used) | integer 1 to 1024 |
 * | VisibleQubits | `null` (equals the resolved MaxQubits) | integer 1 to 1024 |
 * | Zoom | `1` | positive number |
 * | AutoAdjustVisibleQubits | `false` | boolean; when true the displayed visible count grows to cover every used wire |
 * | DecimalPlaces | `3` | integer 0 to 15 |
 * | AutoRun | `true` | boolean |
 * | UseOptimizedGates | `true` | boolean |
 * | UseOptimizedSweep | `true` | boolean |
 * | StepByStep | `false` | boolean |
 * | ShowGateParams | `true` | boolean |
 * | ShowConditionalBranches | `true` | boolean |
 * | ShowEvaluatedLabels | `true` | boolean |
 * | GateParamAngleUnit | `piradians` | `degrees`, `radians`, `piradians` (aliases `deg`, `rad`, `pirad`) |
 * | CodeAngleUnit | `piradians` | same as GateParamAngleUnit |
 * | SymbolicNotation | `false` | boolean |
 * | HideNegligibles | `true` | boolean |
 * | SortBy | `state` | `state`, `probability`, `amplitude`, `phase` |
 * | SortOrder | `ascending` | `ascending`, `descending` (aliases `asc`, `desc`) |
 *
 * Booleans accept `true`, `false`, `on`, `off`, `yes`, `no`, `1`, `0` in any case.
 *
 * @module qubi/settings
 */

/**
 * Every `#settings` key, in the order the language reference lists them.
 * @type {ReadonlyArray<string>}
 */
export const SETTINGS_KEYS = Object.freeze([
  'Scheduling', 'MaxQubits', 'VisibleQubits', 'Zoom', 'AutoAdjustVisibleQubits', 'DecimalPlaces',
  'AutoRun', 'UseOptimizedGates', 'UseOptimizedSweep', 'StepByStep', 'ShowGateParams',
  'ShowConditionalBranches', 'ShowEvaluatedLabels', 'GateParamAngleUnit', 'CodeAngleUnit',
  'SymbolicNotation', 'HideNegligibles', 'SortBy', 'SortOrder',
]);

/**
 * Default value of every setting (see the module table).
 * @type {Readonly<Record<string, string|number|boolean|null>>}
 */
export const SETTING_DEFAULTS = Object.freeze({
  Scheduling: 'same_line',
  MaxQubits: null,
  VisibleQubits: null,
  Zoom: 1,
  AutoAdjustVisibleQubits: false,
  DecimalPlaces: 3,
  AutoRun: true,
  UseOptimizedGates: true,
  UseOptimizedSweep: true,
  StepByStep: false,
  ShowGateParams: true,
  ShowConditionalBranches: true,
  ShowEvaluatedLabels: true,
  GateParamAngleUnit: 'piradians',
  CodeAngleUnit: 'piradians',
  SymbolicNotation: false,
  HideNegligibles: true,
  SortBy: 'state',
  SortOrder: 'ascending',
});

const SCHEDULING = {
  never: 'never', same_line: 'same_line', same_gate_continuous: 'same_gate_continuous',
  same_gate: 'same_gate', sametype: 'same_gate', always: 'always', compressed: 'compressed',
};

const UNITS = {
  degrees: 'degrees', deg: 'degrees', radians: 'radians', rad: 'radians', piradians: 'piradians', pirad: 'piradians',
};

const BOOLS = { true: true, on: true, yes: true, 1: true, false: false, off: false, no: false, 0: false };

const BOOL_KEYS = new Set([
  'AutoAdjustVisibleQubits', 'AutoRun', 'UseOptimizedGates', 'UseOptimizedSweep', 'StepByStep',
  'ShowGateParams', 'ShowConditionalBranches', 'ShowEvaluatedLabels', 'SymbolicNotation', 'HideNegligibles',
]);

/**
 * Normalize an angle unit name.
 * @param {string} text `degrees`, `deg`, `radians`, `rad`, `piradians`, or `pirad` (any case).
 * @returns {'degrees'|'radians'|'piradians'|null} null when the name is not a unit.
 */
export function normalizeUnit(text) {
  return UNITS[String(text).toLowerCase()] ?? null;
}

/**
 * Convert an angle to radians.
 * @param {number} value
 * @param {'degrees'|'radians'|'piradians'} unit
 * @returns {number}
 */
export function angleToRadians(value, unit) {
  if (unit === 'degrees') return (value * Math.PI) / 180;
  if (unit === 'piradians') return value * Math.PI;
  return value;
}

/**
 * Convert radians to an angle unit.
 * @param {number} radians
 * @param {'degrees'|'radians'|'piradians'} unit
 * @returns {number}
 */
export function radiansToUnit(radians, unit) {
  if (unit === 'degrees') return (radians * 180) / Math.PI;
  if (unit === 'piradians') return radians / Math.PI;
  return radians;
}

/**
 * Resolve a settings key written in any case to its canonical spelling.
 * @param {string} key
 * @returns {string|null}
 */
export function canonicalKey(key) {
  const lower = key.toLowerCase();
  return SETTINGS_KEYS.find((k) => k.toLowerCase() === lower) ?? null;
}

function intIn(raw, lo, hi, key) {
  if (!/^\d+$/.test(raw)) return { error: `${key} takes a whole number from ${lo} to ${hi}` };
  const n = Number(raw);
  if (n < lo || n > hi) return { error: `${key} takes a whole number from ${lo} to ${hi}` };
  return { value: n };
}

/**
 * Parse the value text of `#settings KEY VALUE`.
 * @param {string} key Canonical key from {@link SETTINGS_KEYS}.
 * @param {string} raw Value text as written.
 * @returns {{value: string|number|boolean}|{error: string}}
 */
export function parseSettingValue(key, raw) {
  const text = raw.trim();
  if (!text) return { error: `#settings ${key} needs a value` };
  const lower = text.toLowerCase();
  if (BOOL_KEYS.has(key)) {
    if (lower in BOOLS) return { value: BOOLS[lower] };
    return { error: `${key} takes true or false` };
  }
  switch (key) {
    case 'Scheduling':
      if (lower in SCHEDULING) return { value: SCHEDULING[lower] };
      return { error: 'Scheduling takes never, same_line, same_gate_continuous, same_gate, sameType, always, or compressed' };
    case 'MaxQubits':
    case 'VisibleQubits':
      return intIn(text, 1, 1024, key);
    case 'DecimalPlaces':
      return intIn(text, 0, 15, key);
    case 'Zoom': {
      const n = Number(text);
      if (!Number.isFinite(n) || n <= 0) return { error: 'Zoom takes a positive number' };
      return { value: n };
    }
    case 'GateParamAngleUnit':
    case 'CodeAngleUnit': {
      const u = normalizeUnit(text);
      if (!u) return { error: `${key} takes degrees, radians, or piradians` };
      return { value: u };
    }
    case 'SortBy':
      if (['state', 'probability', 'amplitude', 'phase'].includes(lower)) return { value: lower };
      return { error: 'SortBy takes state, probability, amplitude, or phase' };
    case 'SortOrder':
      if (lower === 'ascending' || lower === 'asc') return { value: 'ascending' };
      if (lower === 'descending' || lower === 'desc') return { value: 'descending' };
      return { error: 'SortOrder takes ascending or descending' };
    default:
      return { error: `Unknown setting ${key}` };
  }
}
