import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findFFmpeg, renderFrameCanvas } from '../../cli/render.js';
import * as Q from '../../src/index.js';

test('a video file plays as a VideoNode from the moment it appears', async () => {
  const ffmpeg = findFFmpeg();
  const dir = mkdtempSync(join(tmpdir(), 'qgfx-video-'));
  const file = join(dir, 'two-colors.mp4');
  // One second of red, then one second of blue, at 10 fps.
  const r = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x36:r=10:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=64x36:r=10:d=1', '-filter_complex', '[0][1]concat=n=2:v=1', '-pix_fmt', 'yuv420p', file]);
  assert.equal(r.status, 0, String(r.stderr));
  const src = await Q.openVideo(file);
  assert.equal(src.width, 64);
  assert.ok(Math.abs(src.duration - 2) < 0.15);
  let node;
  const scene = await Q.buildScene(async (s) => {
    await s.wait(1);
    node = s.add(new Q.VideoNode(src, { width: 16 }));
    await s.wait(2.2);
  }, { width: 160, height: 90, fps: 10 });
  assert.equal(node.naturalWidth, 64, 'the natural size comes from the source');
  const pixel = (t) => {
    const c = renderFrameCanvas(scene, Math.round(t * scene.fps), { theme: Q.getTheme('qubibyte') });
    return c.getContext('2d').getImageData(80, 45, 1, 1).data;
  };
  const early = pixel(1.3);
  assert.ok(early[0] > 180 && early[2] < 80, `video time 0.3 is red: ${early}`);
  const late = pixel(2.5);
  assert.ok(late[2] > 180 && late[0] < 80, `video time 1.5 is blue: ${late}`);
});
