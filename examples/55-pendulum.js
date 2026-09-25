import { Axes, Line, Dot, Circle, Tex, Text, ValueTracker, create, fadeIn } from '../src/index.js';

export const config = { theme: 'clean-light', posterTime: 9 };

// A damped pendulum swings on the left while its angle is traced against
// time on the right. The motion comes from an RK4 solution of the ODE.
const G = 9.81;
const LEN = 1.0;
const DAMP = 0.35;
const T_END = 9;
const DT = 1 / 240;

function solve(theta0) {
  const out = [[0, theta0]];
  let th = theta0;
  let om = 0;
  const acc = (a, w) => -(G / LEN) * Math.sin(a) - DAMP * w;
  for (let t = 0; t < T_END; t += DT) {
    const k1a = om;
    const k1w = acc(th, om);
    const k2a = om + (DT / 2) * k1w;
    const k2w = acc(th + (DT / 2) * k1a, om + (DT / 2) * k1w);
    const k3a = om + (DT / 2) * k2w;
    const k3w = acc(th + (DT / 2) * k2a, om + (DT / 2) * k2w);
    const k4a = om + DT * k3w;
    const k4w = acc(th + DT * k3a, om + DT * k3w);
    th += (DT / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
    om += (DT / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
    out.push([t + DT, th]);
  }
  return out;
}

export default async function (scene) {
  const title = new Text('A damped pendulum', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const eq = new Tex("\\theta'' = -\\tfrac{g}{L}\\sin\\theta - 0.35\\,\\theta'", { size: 0.46 });
  eq.nextTo(title, 'down', 0.3, 'left');
  const sol = solve(1.2);
  const thetaAt = (t) => {
    const i = Math.min(sol.length - 2, Math.max(0, Math.floor(t / DT)));
    const u = (t - sol[i][0]) / DT;
    return sol[i][1] + (sol[i + 1][1] - sol[i][1]) * u;
  };
  const pivot = [-4.6, 1.3];
  const rod = 3.2;
  const clock = scene.add(new ValueTracker(0));
  const arm = new Line(pivot, [pivot[0], pivot[1] - rod], { stroke: 'ink', strokeWidth: 3 });
  const bob = new Dot({ radius: 0.24, x: pivot[0], y: pivot[1] - rod, fill: 'accent' });
  const hub = new Circle({ radius: 0.07, x: pivot[0], y: pivot[1], fill: 'ink', stroke: null });
  const ax = new Axes({ x: [0, T_END], y: [-1.3, 1.3], width: 8, height: 4.2, style: 'cross', xTitle: 't', yTitle: '\\theta', tips: true });
  ax.moveTo([2.9, -0.8]);
  const trace = ax.plot(thetaAt, { range: [0, T_END], color: 'accent', strokeWidth: 4 });
  trace.set('xEnd', 0);
  const pen = ax.dot(0, thetaAt(0), { radius: 0.09, color: 'accent' });
  const place = () => {
    const th = thetaAt(clock.value);
    const end = [pivot[0] + rod * Math.sin(th), pivot[1] - rod * Math.cos(th)];
    arm.putStartAndEnd(pivot, end);
    bob.moveTo(end);
  };
  place();
  await scene.play(fadeIn(title), fadeIn(eq), { duration: 0.8 });
  await scene.play(create(arm), fadeIn(bob), fadeIn(hub), create(ax), fadeIn(pen), { duration: 1.2 });
  scene.always(() => {
    place();
    pen.set('dataX', clock.value);
    pen.set('dataY', thetaAt(clock.value));
  });
  await scene.play(clock.to(T_END), trace.animate.set('xEnd', T_END), { duration: T_END, ease: 'linear' });
  await scene.wait(1);
}
