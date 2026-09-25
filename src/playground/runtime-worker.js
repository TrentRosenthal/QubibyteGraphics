/**
 * Module Web Worker that runs user scene code. The page transfers its
 * preview canvas here (OffscreenCanvas) and sends sources, seeks, and
 * export requests; nothing the user writes ever runs on the main page.
 * @module playground/runtime-worker
 */

import { RuntimeCore } from './runtime-core.js';

const core = new RuntimeCore({ post: (msg, transfer) => self.postMessage(msg, transfer || []) });

self.onmessage = async (e) => {
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
    const transfer = value && value.transfer ? value.transfer : [];
    self.postMessage({ id: m.id, type: 'result', ok: true, value }, transfer);
  } catch (err) {
    self.postMessage({ id: m.id, type: 'result', ok: false, error: core.describeError(err) });
  }
};

self.postMessage({ type: 'ready' });
