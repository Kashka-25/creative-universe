// Home's Adult Coco, fetched into the HTTP cache while the invitation plays, so he is there at once
// when the cloud clears. It can be stopped: if home gives up on him (too slow, a lost context, an
// error), the download stops too and no longer competes with the painting that stands in. No
// three.js here (the invitation page imports it before any 3D code has loaded).

import { asset } from '../content';
import { ADULT_URL } from './paths';

let running: AbortController | null = null;

/** Starts the download (once at a time). The whole body is read: an unread body is not cached in full. */
export function prefetchAdult() {
  if (running) return;
  const ctl = new AbortController();
  running = ctl;
  fetch(asset(ADULT_URL), { signal: ctl.signal })
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => undefined)
    .finally(() => { if (running === ctl) running = null; });
}

/** Stops the download if it is still running. */
export function cancelAdultPrefetch() {
  running?.abort();
  running = null;
}
