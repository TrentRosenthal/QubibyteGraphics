# 3D scenes

A `Scene3D` is a viewport inside a normal scene. Its projector sorts faces exactly, so intersecting and interlocking objects draw correctly without a depth buffer, and the output stays vector.

```js
import { Scene3D, Mesh3D, polyhedron, rotate3D, orbitCamera } from 'qubibyte-graphics/three';

export default async function (scene) {
  const view = scene.add(new Scene3D({ width: 16, height: 9, shadow: true }));
  const d = new Mesh3D(polyhedron('dodecahedron', 1.4), { color: 'accent' });
  view.add(d);
  await scene.play(rotate3D(d, [0, 0, 1], Math.PI), orbitCamera(view.camera, { dTheta: 0.8 }), { duration: 4 });
}
```

`Axes3D` plots surfaces and curves; `ImagePlane3D` puts a picture on a plane in perspective; `circuitMesh` turns a Qubi circuit into a printable model you can export as STL or 3MF.
