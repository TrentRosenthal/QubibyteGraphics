#!/usr/bin/env node
/**
 * Regenerate examples/assets/domain.png, the sample image the image
 * examples load: a domain coloring of (z^3 - 1) / (z^2 + 1/4), softened so
 * it sits well next to a restrained theme.
 *
 *   node tools/make-sample-image.js
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { domainColor, Complex } from '../src/math/index.js';

const W = 1200;
const H = 800;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const img = ctx.createImageData(W, H);
const f = (z) => z.mul(z).mul(z).sub(Complex.from(1)).div(z.mul(z).add(Complex.from(0.25)));
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) {
    const z = new Complex(((i + 0.5) / W - 0.5) * 4.2, (0.5 - (j + 0.5) / H) * 2.8);
    const [r, g, b] = domainColor(f(z));
    // Pull toward gray: 60 percent saturation keeps the phase legible without neon.
    const y = 0.3 * r + 0.59 * g + 0.11 * b;
    const k = (i + j * W) * 4;
    img.data[k] = y + (r - y) * 0.6;
    img.data[k + 1] = y + (g - y) * 0.6;
    img.data[k + 2] = y + (b - y) * 0.6;
    img.data[k + 3] = 255;
  }
}
ctx.putImageData(img, 0, 0);
mkdirSync('examples/assets', { recursive: true });
writeFileSync('examples/assets/domain.png', await canvas.encode('png'));
console.log('wrote examples/assets/domain.png');
