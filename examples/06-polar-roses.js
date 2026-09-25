import { PolarPlane, Tex, Text, create, replacementTransform, transformMatchingTex, fadeIn, fadeOut } from '../src/index.js';

export const config = { theme: 'clean-dark', posterTime: 7.5 };

// Roses r = cos(k theta): k petals for odd k, 2k for even k, and a
// fractional k needs more than one turn to close.
export default async function (scene) {
  const title = new Text('Roses in polar coordinates', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const plane = new PolarPlane({ radius: 3.3, rMax: 1, rings: 4, spokes: 12, labels: false, x: 3.2, y: -0.45 });
  const roses = [
    { k: '2', f: (t) => Math.cos(2 * t), range: [0, 2 * Math.PI], note: 'Even k gives 2k petals.' },
    { k: '3', f: (t) => Math.cos(3 * t), range: [0, Math.PI], note: 'Odd k gives k petals, traced in half a turn.' },
    { k: '\\tfrac{5}{2}', f: (t) => Math.cos(2.5 * t), range: [0, 4 * Math.PI], note: 'k = 5/2 closes after two full turns.' },
  ];
  const texFor = (k) => new Tex(`r = \\cos(${k}\\,\\theta)`, { size: 0.7 });
  let eq = texFor(roses[0].k);
  eq.moveTo([-6.9, 1.2], 'left');
  let note = new Text(roses[0].note, { size: 'label', color: 'muted', maxWidth: 5.4 });
  note.nextTo(eq, 'down', 0.45, 'left');
  let curve = plane.plotPolar(roses[0].f, { range: roses[0].range, samples: 900 });
  curve.set('visible', false);
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(create(plane), { duration: 1.2 });
  curve.set('visible', true);
  await scene.play(create(curve), fadeIn(eq), { duration: 2 });
  await scene.play(fadeIn(note, { shift: 'up' }), { duration: 0.6 });
  for (const r of roses.slice(1)) {
    await scene.wait(1);
    const nextEq = texFor(r.k);
    nextEq.moveTo([-6.9, 1.2], 'left');
    const nextNote = new Text(r.note, { size: 'label', color: 'muted', maxWidth: 5.4 });
    nextNote.nextTo(nextEq, 'down', 0.45, 'left');
    const next = plane.plotPolar(r.f, { range: r.range, samples: 1400 });
    next.set('visible', false);
    await scene.play(replacementTransform(curve, next), transformMatchingTex(eq, nextEq), fadeOut(note, { duration: 0.5 }), { duration: 1.8 });
    await scene.play(fadeIn(nextNote, { shift: 'up' }), { duration: 0.5 });
    curve = next;
    eq = nextEq;
    note = nextNote;
  }
  await scene.wait(1.5);
}
