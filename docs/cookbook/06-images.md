# Using your own images

Load an image and use it as an object, a 3D texture, or the background.

```js
import { ImageNode, imageBackground, loadImage } from 'qubibyte-graphics';
import { ImagePlane3D } from 'qubibyte-graphics/three';

export default async function (scene) {
  const img = await loadImage(new URL('./photo.png', import.meta.url).href);
  scene.add(imageBackground(img, { dim: 0.7 }));
  scene.add(new ImageNode(img, { width: 5, naturalWidth: img.width, naturalHeight: img.height }));
}
```

`treatment: 'duotone'`, `'tint'`, or `'desaturate'` matches a photo to the theme.
