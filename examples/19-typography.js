import { Text, Tex, write, fadeIn, lagStart, transformMatchingTex } from '../src/index.js';

export const config = { theme: 'qubibyte', posterTime: 7.5 };

// Text and TeX are both outlines, so letters can travel: an anagram
// rearranges itself, each letter flying to its new place.
export default async function (scene) {
  const title = new Text('Letters are shapes too', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const weights = ['regular', 'medium', 'semibold'].map((w, i) => {
    const t = new Text(`Inter ${w}`, { size: 'label', weight: w, color: i === 2 ? 'ink' : 'muted' });
    t.moveTo([-7.3, 2.2 - i * 0.55], 'left');
    return t;
  });
  const words = [['listen', 'silent'], ['dormitory', 'dirty room'], ['the eyes', 'they see']];
  const make = (w, y) => {
    const t = new Tex(`\\text{${w}}`, { size: 1.1 });
    t.moveTo([0.6, y]);
    return t;
  };
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(lagStart(weights.map((w) => fadeIn(w, { shift: 'right' })), { lag: 0.15 }), { duration: 1 });
  let y = 1.3;
  for (const [a, b] of words) {
    const src = make(a, y);
    const dst = make(b, y);
    await scene.play(write(src), { duration: 1 });
    await scene.wait(0.3);
    await scene.play(transformMatchingTex(src, dst), { duration: 1.6 });
    y -= 1.7;
  }
  const note = new Text('Matching letters move; nothing fades unless it has no partner.', { size: 'label', color: 'muted' });
  note.moveTo([0, -3.8]);
  await scene.play(fadeIn(note, { shift: 'up' }), { duration: 0.6 });
  await scene.wait(1.4);
}
