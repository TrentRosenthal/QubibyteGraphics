import { Text, Rect, Circle, Group, Axes, fadeIn, create, lagStart, themeFrom } from '../src/index.js';

export const config = { theme: 'clean-dark', posterTime: 6 };

// A theme from a few words: the palette helper picks a background, ink,
// and two accents from a hue and a mood. Each panel is drawn with the
// tokens of its own generated theme.
const DESCRIPTIONS = ['calm ocean blue, dark', 'warm terracotta paper', 'forest green, muted, dark', 'playful violet, pastel'];

export default async function (scene) {
  const title = new Text('Themes from a description', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const themes = DESCRIPTIONS.map((d, i) => themeFrom(`described-${i}`, d));
  const W = 7.2;
  const H = 3.2;
  const panels = themes.map((t, i) => {
    const x = (i % 2 === 0 ? -1 : 1) * (W / 2 + 0.15);
    const y = i < 2 ? 0.95 : -2.55;
    const c = t.colors;
    const bg = new Rect({ width: W, height: H, x, y, radius: 0.12, fill: c.background, stroke: c.grid, strokeWidth: 1.5, meta: { solidFill: true } });
    const ax = new Axes({ x: [0, 6.3], y: [-1.2, 1.2], width: 4, height: 1.9, style: 'cross', xLabels: false, yLabels: false, tips: false, axisColor: c.muted });
    ax.moveTo([x - 1.1, y - 0.3]);
    const g1 = ax.plot(Math.sin, { color: c.accent, strokeWidth: 4 });
    const g2 = ax.plot((v) => Math.cos(v) * 0.8, { color: c.accent2, strokeWidth: 4 });
    const swatches = ['ink', 'muted', 'accent', 'accent2'].map((k, j) => new Circle({ radius: 0.17, x: x + 1.9 + (j % 2) * 0.5, y: y + 0.35 - Math.floor(j / 2) * 0.5, fill: c[k], stroke: null, meta: { solidFill: true } }));
    const label = new Text(`"${DESCRIPTIONS[i]}"`, { size: 'caption', color: c.ink });
    label.moveTo([x - W / 2 + 0.3, y + H / 2 - 0.35], 'left');
    return { all: new Group([bg, ax, ...swatches, label]), plots: [g1, g2], bg, ax, swatches, label };
  });
  await scene.play(fadeIn(title), { duration: 0.6 });
  await scene.play(lagStart(panels.map((p) => fadeIn(p.bg, { scale: 0.96 })), { lag: 0.15 }), { duration: 1.2 });
  await scene.play(lagStart(panels.map((p) => fadeIn(p.label)), { lag: 0.1 }), ...panels.map((p) => create(p.ax)), { duration: 1 });
  await scene.play(...panels.flatMap((p) => p.plots.map((g) => create(g))), ...panels.flatMap((p) => p.swatches.map((s) => fadeIn(s, { scale: 0.5 }))), { duration: 1.6 });
  await scene.wait(1.6);
}
