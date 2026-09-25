/**
 * Worker thread for parallel chunk rendering. Each worker rebuilds the scene
 * (building is deterministic) and encodes the chunks it is handed.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { loadSceneModule, buildFromModule, encodeChunk } from './render.js';

const { sceneFile, overrides, transparent, ffmpeg } = workerData;

try {
  const mod = await loadSceneModule(sceneFile);
  const scene = await buildFromModule(mod, overrides);
  parentPort.on('message', async ({ chunk }) => {
    try {
      await encodeChunk(scene, chunk.start, chunk.end, chunk.file, { ffmpeg, transparent, onFrame: () => parentPort.postMessage({ type: 'frame' }) });
      parentPort.postMessage({ type: 'chunk-done', i: chunk.i });
    } catch (e) {
      parentPort.postMessage({ type: 'error', message: e.message });
    }
  });
  parentPort.postMessage({ type: 'ready' });
} catch (e) {
  parentPort.postMessage({ type: 'error', message: e.message });
}
