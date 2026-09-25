/**
 * Explainers generated from a Qubi program. Paste a program and get a
 * narrated animation: the code, the circuit being built, execution column
 * by column with the state sweeping along each gate's unitary path, the
 * state in Dirac notation, and the outcome distribution. Grover and QFT
 * programs get their own visual (amplitude amplification geometry and the
 * phase-rotation picture); everything is computed from the program.
 * @module quantum/explainers
 */

import { evaluate } from '../qubi/index.js';
import { StatevectorSimulator } from './statevector.js';
import { blochVectors } from './analysis.js';
import { CircuitDiagram, ExecutionCursor } from './views/circuit.js';
import { AmplitudeBars, PhaseDisks, ApplyGate, diracLatex } from './views/state.js';
import { Text, Tex, DecimalNumber } from '../text/nodes.js';
import { CodeBlock } from '../text/code.js';
import { Group, PathNode, ValueTracker } from '../core/node.js';
import { Arrow, Line, Circle } from '../core/shapes.js';
import { polyPath } from '../core/path.js';
import { create, write, fadeIn, fadeOut, crossFade, lagStart, indicate } from '../core/animations.js';

/**
 * One sentence describing what an op does, for narration.
 * @param {import('../qubi/ir.js').Op} op
 * @returns {string}
 */
export function describeOp(op) {
  const q = (w) => `q${w}`;
  const list = (ws) => (ws.length === 1 ? q(ws[0]) : ws.map(q).join(', '));
  const t = list(op.targets);
  const c = op.controls.length ? list(op.controls) : '';
  switch (op.name) {
    case 'H': return `H on ${t} turns a basis state into an equal superposition.`;
    case 'X': return `X on ${t} flips it between 0 and 1.`;
    case 'Y': return `Y on ${t} flips the bit and adds a phase of i.`;
    case 'Z': return `Z on ${t} flips the sign of the 1 component.`;
    case 'S': return `S on ${t} adds a quarter-turn phase to the 1 component.`;
    case 'T': return `T on ${t} adds an eighth-turn phase to the 1 component.`;
    case 'SDG': return `S dagger on ${t} undoes an S phase.`;
    case 'TDG': return `T dagger on ${t} undoes a T phase.`;
    case 'RX': case 'RY': case 'RZ': return `${op.name} rotates ${t} about the ${op.name[1].toLowerCase()} axis.`;
    case 'P': return `P adds a phase to the 1 component of ${t}.`;
    case 'CX': return `CX flips ${t} when ${c} ${op.controls.length > 1 ? 'are all' : 'is'} 1.`;
    case 'CZ': return `CZ flips the sign when ${c} and ${t} are all 1.`;
    case 'CP': return `CP adds a phase when ${c} and ${t} are all 1.`;
    case 'CY': return `CY applies Y to ${t} when ${c} ${op.controls.length > 1 ? 'are all' : 'is'} 1.`;
    case 'SWAP': return `SWAP exchanges ${t}.`;
    case 'CSWAP': return `CSWAP exchanges ${t} when ${c} is 1.`;
    case 'MEASURE': return `Measuring ${t} collapses the state to one outcome.`;
    default: return `${op.label ?? op.name} acts on ${t}${c ? ` controlled by ${c}` : ''}.`;
  }
}

/**
 * Sentence introducing a standard library call.
 * @param {{name: string, callText: string, wires: number[]}} g
 * @returns {string}
 */
export function describeGroup(g) {
  const n = g.wires.length;
  const map = {
    Bell: 'Bell prepares an entangled pair: two qubits that always agree.',
    GHZ: `GHZ spreads one superposition across ${n} qubits so they all agree.`,
    W: `W shares a single excitation evenly among ${n} qubits.`,
    QFT: `The quantum Fourier transform turns a basis state into phases that rotate at ${n} different speeds.`,
    IQFT: 'The inverse Fourier transform reads rotating phases back into a basis state.',
    Grover: 'Grover search marks one state and amplifies it until it dominates.',
    Deutsch: 'Deutsch decides whether a one-bit function is constant or balanced with one query.',
    BV: 'Bernstein-Vazirani recovers a hidden bitstring with a single query.',
    Teleport: 'Teleportation moves a qubit state using an entangled pair and two classical bits.',
    Superdense: 'Superdense coding sends two classical bits with one qubit of an entangled pair.',
    QPE: 'Phase estimation writes an eigenphase into a register of counting qubits.',
    Shor: 'Order finding: the counting register picks up the period of modular multiplication.',
    SwapTest: 'The swap test estimates how similar two states are.',
    PhaseKickback: 'Phase kickback moves a phase from the target onto the control.',
    PhaseOracle: 'The phase oracle flips the sign of the marked states.',
    StatePreparation: 'State preparation builds the requested amplitudes with controlled rotations.',
    QubitPreparation: 'Qubit preparation sets each qubit to its requested probability of 1.',
    BitFlip: 'The bit-flip code protects one qubit against a single bit flip.',
    Stego: 'Stego hides a message in the phases of a state.',
  };
  return map[g.name] ?? `${g.callText} runs as one step.`;
}

/**
 * Frame layout for explainers (16 x 9 world units). Rows: title and code,
 * circuit across the full width, state views, Dirac notation, narration.
 */
const LAYOUT = {
  title: [-7.3, 3.95],
  code: { right: 7.3, top: 3.95, w: 4.6, h: 1.7 },
  circuit: { x: 0, y: 1.2, w: 14.4, h: 2.45 },
  state: { x: -1.6, y: -1.45, w: 9.2, h: 1.9 },
  side: { x: 5.3, y: -1.45 },
  dirac: { x: 0, y: -3.1, w: 13.6, h: 0.75 },
  narration: { x: 0, y: -3.98, w: 14 },
};

/**
 * TeX for a fraction of a turn with a power-of-two denominator, reduced.
 * @param {number} t turns in [0, 1)
 * @param {number} den
 * @returns {string}
 */
export function turnFraction(t, den) {
  let num = Math.round(t * den) % den;
  let d = den;
  if (num === 0) return '0';
  while (num % 2 === 0 && d > 1) {
    num /= 2;
    d /= 2;
  }
  return `\\tfrac{${num}}{${d}}`;
}

/**
 * Build an explainer scene function for a Qubi program.
 * @param {string} source Qubi program
 * @param {Record<string, any>} [opts] title, seed, maxQubitsForBars (6), perGateDuration (0.7)
 * @returns {(scene: import('../core/scene.js').Scene) => Promise<void>}
 */
export function explainQubi(source, opts = {}) {
  return async (scene) => {
    const circuit = evaluate(source);
    const n = circuit.numQubits;
    const kind = circuit.ops.find((o) => o.group && (o.group.name === 'Grover' || o.group.name === 'QFT'))?.group.name ?? null;
    const title = new Text(opts.title ?? titleFor(circuit, kind), { size: 'heading', weight: 'semibold' });
    title.moveTo(LAYOUT.title, 'top-left');
    const sub = new Text(`${n} qubit${n === 1 ? '' : 's'}, ${circuit.ops.length} operation${circuit.ops.length === 1 ? '' : 's'}`, { size: 'caption', color: 'muted' });
    sub.nextTo(title, 'down', 0.14, 'left');
    const code = new CodeBlock(source.trim(), { size: 0.24 });
    if (code.width > LAYOUT.code.w || code.height > LAYOUT.code.h) code.fitTo(LAYOUT.code.w, LAYOUT.code.h);
    code.moveTo([LAYOUT.code.right, LAYOUT.code.top], 'top-right');
    const diagram = new CircuitDiagram(circuit, { groups: 'outline', scheduling: circuit.settings.Scheduling === 'same_line' ? 'always' : circuit.settings.Scheduling });
    diagram.fitTo(LAYOUT.circuit.w, LAYOUT.circuit.h);
    if (diagram.height > 0 && diagram.width / LAYOUT.circuit.w < 0.55) diagram.scale(Math.min(1.35, (LAYOUT.circuit.w * 0.6) / diagram.width));
    diagram.moveTo([LAYOUT.circuit.x, LAYOUT.circuit.y]);
    const narration = new NarrationLine(scene);

    await scene.play(write(title), fadeIn(sub, { shift: 'up' }), { duration: 1 });
    await scene.play(fadeIn(code, { shift: [0.2, 0] }), { duration: 0.8 });
    await narration.say(introFor(circuit, kind));
    await scene.play(diagram.build());
    await scene.wait(0.4);

    if (kind === 'Grover') await groverStory(scene, circuit, diagram, narration, opts);
    else if (kind === 'QFT') await qftStory(scene, circuit, diagram, narration, opts);
    else await genericStory(scene, circuit, diagram, narration, opts);
    await scene.wait(1.5);
  };
}

function titleFor(circuit, kind) {
  if (kind === 'Grover') return 'Grover search, step by step';
  if (kind === 'QFT') return 'The quantum Fourier transform';
  const g = circuit.ops.find((o) => o.group);
  return g ? `${g.group.name}, step by step` : 'What this circuit does';
}

function introFor(circuit, kind) {
  const g = circuit.ops.find((o) => o.group);
  if (g) return describeGroup(g.group);
  if (kind) return '';
  return `The program runs ${circuit.ops.length} operations on ${circuit.numQubits} qubits, starting from all zeros.`;
}

/**
 * One line of narration at the bottom of the frame, also written as a caption.
 */
class NarrationLine {
  constructor(scene) {
    this.scene = scene;
    this.current = null;
  }

  async say(text, hold = 1.6) {
    if (!text) return;
    let t = new Text(text, { size: 0.3, color: 'muted', maxWidth: LAYOUT.narration.w, align: 'center' });
    if (t.height > 0.5) t = new Text(text, { size: 0.25, color: 'muted', maxWidth: LAYOUT.narration.w, align: 'center' });
    t.moveTo([LAYOUT.narration.x, LAYOUT.narration.y]);
    const words = text.split(/\s+/).length;
    const dur = Math.max(hold, 0.9 + words * 0.24);
    this.scene.caption(text, dur + 0.6);
    if (this.current) await this.scene.play(fadeOut(this.current), { duration: 0.25 });
    await this.scene.play(fadeIn(t, { shift: [0, 0.12] }), { duration: 0.35 });
    this.current = t;
    return dur;
  }
}

function diracNode(sim) {
  const many = sim.re.length > 8;
  const t = new Tex(diracLatex(sim, { perLine: many ? 5 : 4, maxTerms: many ? 4 : 8 }), { size: 0.34 });
  if (t.width > LAYOUT.dirac.w || t.height > LAYOUT.dirac.h) t.fitTo(LAYOUT.dirac.w, LAYOUT.dirac.h);
  t.moveTo([LAYOUT.dirac.x, LAYOUT.dirac.y]);
  return t;
}

/**
 * Run the circuit column by column: the cursor advances, amplitude bars
 * sweep along each gate's path, and the Dirac line updates.
 */
async function executeColumns(scene, circuit, diagram, bars, narration, opts, onColumn) {
  const n = circuit.numQubits;
  const sim = new StatevectorSimulator(n, { seed: opts.seed ?? 7 });
  const cursor = new ExecutionCursor(diagram);
  cursor._init.visible = false;
  cursor.set('visible', false);
  await scene.play(fadeIn(cursor), { duration: 0.3 });
  let dirac = diracNode(sim);
  await scene.play(fadeIn(dirac), { duration: 0.5 });
  const cols = diagram.schedule.columns;
  const told = new Set();
  const perGate = opts.perGateDuration ?? 0.7;
  for (let k = 0; k < cols.length; k++) {
    const ops = cols[k].map((i) => circuit.ops[i]);
    const group = ops.find((o) => o.group)?.group;
    let line = null;
    if (group && !told.has(group.id)) {
      told.add(group.id);
      line = describeGroup(group);
    } else if (!group && ops.length > 1 && ops.every((o) => o.name === 'MEASURE')) {
      const qs = ops.flatMap((o) => o.targets).map((q) => `q${q}`);
      line = `Measuring ${qs.slice(0, -1).join(', ')} and ${qs[qs.length - 1]} collapses the state to one outcome.`;
    } else if (!group) line = describeOp(ops[0]);
    if (line) await narration.say(line, 1);
    const anims = [];
    for (const op of ops) {
      if (op.kind !== 'gate') continue;
      const before = { re: Float64Array.from(sim.re), im: Float64Array.from(sim.im) };
      sim.applyOp(op);
      if (bars) anims.push(new ApplyGate(bars, op, before, { duration: perGate }));
    }
    const colDur = group ? perGate * 0.6 : perGate;
    await scene.play(cursor.to(k, { duration: colDur }), ...anims, { duration: colDur });
    if (onColumn) await onColumn(k, sim, ops);
    if (!group || k === cols.length - 1 || !cols[k + 1].some((i) => circuit.ops[i].group && circuit.ops[i].group.id === group.id)) {
      const next = diracNode(sim);
      await scene.play(crossFade(dirac, next), { duration: 0.4 });
      dirac = next;
    }
  }
  await scene.play(fadeOut(cursor), { duration: 0.3 });
  return { sim, dirac };
}

/**
 * Whether every intermediate state of a circuit has real amplitudes, so a
 * signed bar chart shows it faithfully.
 * @param {import('../qubi/ir.js').Circuit} circuit
 * @returns {boolean}
 */
export function staysReal(circuit) {
  const sim = new StatevectorSimulator(circuit.numQubits, { seed: 1 });
  const real = () => sim.im.every((v) => Math.abs(v) < 1e-9);
  for (const op of circuit.ops) {
    if (op.kind !== 'gate') continue;
    sim.applyOp(op);
    if (!real()) return false;
  }
  return true;
}

/**
 * Whether some intermediate state has a negative real amplitude, which is
 * the only case where signed bars add information over magnitudes.
 * @param {import('../qubi/ir.js').Circuit} circuit
 * @returns {boolean}
 */
export function goesNegative(circuit) {
  const sim = new StatevectorSimulator(circuit.numQubits, { seed: 1 });
  for (const op of circuit.ops) {
    if (op.kind !== 'gate') continue;
    sim.applyOp(op);
    if (sim.re.some((v) => v < -1e-9)) return true;
  }
  return false;
}

async function genericStory(scene, circuit, diagram, narration, opts) {
  const n = circuit.numQubits;
  let bars = null;
  if (n <= (opts.maxQubitsForBars ?? 6)) {
    bars = new AmplitudeBars(n, null, { mode: staysReal(circuit) && goesNegative(circuit) ? 'signed' : 'phase', width: Math.min(LAYOUT.state.w + 3, 1.1 * 2 ** n), height: LAYOUT.state.h });
    bars.moveTo([0, LAYOUT.state.y]);
    await scene.play(fadeIn(bars, { shift: 'up' }), { duration: 0.6 });
  }
  const { sim } = await executeColumns(scene, circuit, diagram, bars, narration, opts);
  const probs = sim.probabilities();
  let best = 0;
  for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
  const top = [];
  for (let i = 0; i < probs.length; i++) if (Math.abs(probs[i] - probs[best]) < 1e-9) top.push(i);
  const bits = (i) => i.toString(2).padStart(n, '0');
  const pct = (p) => `${+(p * 100).toFixed(1)} percent`;
  if (top.length === 1) await narration.say(`The most likely outcome is ${bits(best)}, with probability ${pct(probs[best])}.`);
  else if (top.length <= 4) await narration.say(`Outcomes ${top.slice(0, -1).map(bits).join(', ')} and ${bits(top[top.length - 1])} are equally likely, ${pct(probs[best])} each.`);
  else await narration.say(`${top.length} outcomes are equally likely, ${pct(probs[best])} each.`);
  if (bars) await scene.play(...top.slice(0, 4).map((i) => indicate(bars.bars[i], { scale: 1.08 })));
}

async function groverStory(scene, circuit, diagram, narration, opts) {
  const n = circuit.numQubits;
  const group = circuit.ops.find((o) => o.group && o.group.name === 'Grover').group;
  const marked = parseInt((group.callText.match(/0b([01]+)/) || [0, '0'])[1], 2);
  const N = 2 ** n;
  const bars = new AmplitudeBars(n, null, { mode: 'signed', width: Math.min(LAYOUT.state.w, 1.05 * N), height: LAYOUT.state.h, highlight: [marked] });
  bars.moveTo([LAYOUT.state.x, LAYOUT.state.y]);
  // Geometry panel: the state lives in the plane of |w> (marked) and |s'> (the rest).
  const geo = new Group([], { type: 'groverGeometry' });
  const R = 1.2;
  const axisH = new Line([-0.2, 0], [R + 0.3, 0], { stroke: 'muted', strokeWidth: 2 });
  const axisV = new Line([0, -0.2], [0, R + 0.3], { stroke: 'muted', strokeWidth: 2 });
  const arc = new PathNode(polyPath(Array.from({ length: 33 }, (_, i) => [R * Math.cos((Math.PI / 2) * (i / 32)), R * Math.sin((Math.PI / 2) * (i / 32))])), { stroke: 'grid', strokeWidth: 1.6 });
  const lw = new Tex(`\\lvert ${marked.toString(2).padStart(n, '0')}\\rangle`, { size: 0.28, color: 'accent2' });
  lw.moveTo([0, R + 0.52]);
  const ls = new Tex("\\lvert s'\\rangle", { size: 0.28, color: 'muted' });
  ls.moveTo([R + 0.62, 0]);
  const angle = new ValueTracker(Math.asin(1 / Math.sqrt(N)));
  const vec = new Arrow([0, 0], [R * Math.cos(angle.value), R * Math.sin(angle.value)], { color: 'accent', strokeWidth: 4, headLength: 0.18, headWidth: 0.15 });
  geo.add(axisH, axisV, arc, lw, ls, vec, angle);
  geo.moveTo([LAYOUT.side.x, LAYOUT.side.y + 0.1]);
  scene.always(() => {
    const a = angle.value;
    vec.putStartAndEnd([0, 0], [R * Math.cos(a), R * Math.sin(a)]);
  });
  // Live probability of the marked state, riding on top of its bar.
  const pLabel = new DecimalNumber(1 / N, { decimals: 3, size: 0.26, color: 'accent2', prefix: 'P = ' });
  scene.always(() => {
    const a = bars.amps();
    const re = a[2 * marked];
    const im = a[2 * marked + 1];
    pLabel.set('value', re * re + im * im);
    const top = Math.max(0, re) * (bars.h / 2);
    const m = bars.worldMatrix();
    const x = bars.xOf(marked);
    pLabel.set('x', m[0] * x + m[4]);
    pLabel.set('y', m[3] * (top + 0.28) + m[5]);
  });
  await scene.play(fadeIn(bars, { shift: 'up' }), fadeIn(geo), fadeIn(pLabel), { duration: 0.8 });
  const theta = Math.asin(1 / Math.sqrt(N));
  let iteration = 0;
  await executeColumns(scene, circuit, diagram, bars, narration, { ...opts, perGateDuration: 0.45 }, async (k, sim) => {
    const pm = sim.probabilities()[marked];
    // Each oracle plus diffusion pair turns the state by 2 theta, so an
    // iteration is complete exactly when P(marked) reaches sin^2((2k + 1) theta).
    if (Math.abs(pm - Math.sin((2 * (iteration + 1) + 1) * theta) ** 2) < 1e-6) {
      iteration++;
      const target = (2 * iteration + 1) * theta;
      await scene.play(angle.to(target, { duration: 0.8 }), { duration: 0.8 });
      await narration.say(`Iteration ${iteration}: the oracle flips the marked amplitude, and the diffusion reflects every amplitude about the mean. The marked probability is now ${(pm * 100).toFixed(1)} percent.`, 1.2);
    }
  });
  await narration.say(`After ${iteration} iteration${iteration === 1 ? '' : 's'}, measuring gives ${marked.toString(2).padStart(n, '0')} with probability ${(Math.sin((2 * iteration + 1) * theta) ** 2 * 100).toFixed(1)} percent.`);
  await scene.play(indicate(bars.bars[marked], { scale: 1.1, color: 'accent2' }));
}

async function qftStory(scene, circuit, diagram, narration, opts) {
  const n = circuit.numQubits;
  const disks = new PhaseDisks(n, null, { radius: n > 4 ? 0.2 : 0.3, gap: 0.08, cols: Math.min(16, 2 ** n) });
  disks.fitTo(LAYOUT.state.w, LAYOUT.state.h);
  disks.moveTo([LAYOUT.state.x, LAYOUT.state.y]);
  await scene.play(fadeIn(disks, { shift: 'up' }), { duration: 0.6 });
  const prep = circuit.ops.filter((o) => !o.group);
  const input = prep.reduce((acc, o) => (o.name === 'X' ? acc | o.targets.reduce((a, t) => a | (1 << t), 0) : acc), 0);
  const { sim } = await executeColumns(scene, circuit, diagram, disks, narration, { ...opts, perGateDuration: 0.35 });
  await narration.say(`The input ${input.toString(2).padStart(n, '0')} is ${input}. After the transform every basis state has the same size, and the phase advances by ${input}/${2 ** n} of a turn from one basis state to the next.`, 2);
  // Phase-rotation picture: one wheel per qubit, read from its reduced Bloch vector.
  const vecs = blochVectors(sim);
  const turns = vecs.map((v) => {
    const ph = (Math.atan2(v.y, v.x) + 2 * Math.PI) % (2 * Math.PI);
    return ph / (2 * Math.PI);
  });
  const wheels = new Group([], { type: 'qftWheels' });
  const R = 0.46;
  for (let q = 0; q < n; q++) {
    const phase = 2 * Math.PI * turns[q];
    const cx = (q - (n - 1) / 2) * 1.55;
    wheels.add(new Circle({ radius: R, x: cx, stroke: 'muted', strokeWidth: 2 }));
    wheels.add(new Arrow([cx, 0], [cx + R * Math.cos(phase), R * Math.sin(phase)], { color: 'accent', strokeWidth: 3.5, headLength: 0.13, headWidth: 0.11 }));
    const lbl = new Tex(`q_{${q}}`, { size: 0.26, color: 'muted' });
    lbl.moveTo([cx, -R - 0.28]);
    wheels.add(lbl);
    const frac = turnFraction(turns[q], 2 ** n);
    const val = new Tex(frac, { size: 0.24, color: 'ink' });
    val.moveTo([cx, R + 0.3]);
    wheels.add(val);
  }
  wheels.moveTo([0, LAYOUT.state.y]);
  await scene.play(fadeOut(disks), { duration: 0.5 });
  await scene.play(lagStart(wheels.children.map((c) => (c.type === 'arrow' ? create(c) : fadeIn(c))), { lagRatio: 0.06, duration: 1.8 }));
  await narration.say(`Each qubit ends in an equal superposition turned by a fraction of a full circle, read above each wheel. The fractions double from one qubit to the next, the binary digits of ${input}/${2 ** n}.`, 2.4);
  return sim;
}
