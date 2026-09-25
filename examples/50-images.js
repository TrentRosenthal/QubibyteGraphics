import { Text, ImageNode, Rect, imageBackground, loadImage, fadeIn, lagStart } from '../src/index.js';
import { Scene3D, ImagePlane3D, rotate3D } from '../src/three/index.js';

export const config = { theme: 'qubibyte', posterTime: 9 };

// One picture used three ways: as an object that moves and scales, as a
// texture on a plane in 3D, and as a dimmed background for the whole frame.
export default async function (scene) {
  const img = await loadImage(new URL('./assets/domain.png', import.meta.url).href);
  const title = new Text('One image, three ways', { size: 'heading', weight: 'semibold' });
  title.toEdge('top-left', 0.7);
  const photo = new ImageNode(img, { width: 5.2, naturalWidth: img.width, naturalHeight: img.height, x: -3.9, y: -0.3 });
  const frame = new Rect({ width: photo.get('width') + 0.16, height: photo.get('height') + 0.16, radius: 0.06, x: -3.9, y: -0.3, stroke: 'faint', strokeWidth: 2, fill: null });
  const cap1 = new Text('As an object', { size: 'label', color: 'muted' });
  cap1.moveTo([-3.9, -2.6]);
  const view = new Scene3D({ width: 8, height: 7, camera: { theta: -Math.PI / 2 + 0.3, phi: 1.3, distance: 12, fov: 30 } });
  view.moveTo([3.9, -0.3]);
  const plane = new ImagePlane3D(img, { width: 4.2, divisions: 12 });
  plane.set('rotX', Math.PI / 2);
  const cap2 = new Text('As a texture in 3D', { size: 'label', color: 'muted' });
  cap2.moveTo([3.9, -2.6]);
  await scene.play(fadeIn(title), { duration: 0.6 });
  scene.add(frame);
  await scene.play(fadeIn(photo, { scale: 0.9 }), fadeIn(frame), fadeIn(cap1, { shift: 'up' }), { duration: 1 });
  await scene.play(photo.animate.scale(1.06), frame.animate.scale(1.06), { duration: 0.8, ease: 'easeInOutSine' });
  await scene.play(photo.animate.scale(1 / 1.06), frame.animate.scale(1 / 1.06), { duration: 0.8, ease: 'easeInOutSine' });
  scene.add(view);
  view.add(plane);
  await scene.play(fadeIn(view), fadeIn(cap2, { shift: 'up' }), { duration: 1 });
  await scene.play(rotate3D(plane, [0, 0, 1], 0.55, { ease: 'easeInOutSine' }), { duration: 2.2 });
  await scene.play(rotate3D(plane, [1, 0, 0], -0.35, { ease: 'easeInOutSine' }), { duration: 1.6 });
  const bg = imageBackground(img, { dim: 0.78 });
  const cap3 = new Text('And behind everything, dimmed so the rest stays readable.', { size: 'label', color: 'ink' });
  cap3.moveTo([0, -3.6]);
  await scene.play(lagStart([fadeIn(bg), fadeIn(cap3, { shift: 'up' })], { lag: 0.3 }), { duration: 1.6 });
  await scene.wait(1.5);
}
