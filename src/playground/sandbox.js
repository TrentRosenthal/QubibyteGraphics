/**
 * Sandboxed iframe runtime, used when the browser cannot transfer a canvas
 * to a worker. The iframe is created with `sandbox="allow-scripts"`, so its
 * origin is opaque: user code here cannot reach the page, its storage, or
 * its cookies. Frames go back to the page as ImageBitmaps.
 * @module playground/sandbox
 */

/* global parent */

import { RuntimeCore } from './runtime-core.js';

const post = (msg, transfer) => parent.postMessage(msg, '*', transfer || []);
const core = new RuntimeCore({ bitmap: true, post });

self.addEventListener('message', async (e) => {
  if (e.source !== parent) return;
  const m = e.data;
  if (m.type === 'seek') {
    core.requestFrame({ t: m.t, layout: !!m.layout });
    return;
  }
  if (m.type === 'cancelExport') {
    core.cancelled = true;
    return;
  }
  try {
    const value = await core.handle(m);
    post({ id: m.id, type: 'result', ok: true, value });
  } catch (err) {
    post({ id: m.id, type: 'result', ok: false, error: core.describeError(err) });
  }
});

post({ type: 'ready' });
