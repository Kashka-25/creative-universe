// Is the visitor using the header? The invitation's trip home never throws its full-screen cloud
// over a menu someone is using (see the 'waiting' beat in invitationMachine.ts). Pure enough to
// test in node: it reads only what a document-like object (or an event target) gives it.

import { WAIT_IDLE_MS } from './invitationMachine';

/** The parts of a document this needs (a real `document` fits). */
export interface HeaderDoc {
  querySelector(selector: string): unknown;
  readonly activeElement: { closest?(selector: string): unknown; matches?(selector: string): boolean } | null;
}

/**
 * True while the mobile menu is open, or keyboard focus is inside the header (tabbing through the
 * realms). Focus left on the menu button by a tap or a click does not count: that is not someone
 * reading the menu, and it would otherwise hold the trip until the cap.
 */
export function usingHeader(doc: HeaderDoc): boolean {
  if (doc.querySelector('.site-nav.is-open')) return true;
  const active = doc.activeElement;
  if (!active?.closest?.('.site-header')) return false;
  try {
    return active.matches?.(':focus-visible') ?? true;
  } catch {
    return true;                       // a browser without :focus-visible: any focus in the header counts
  }
}

/** How long the header must stay quiet (menu closed, focus elsewhere) before the trip carries on. */
export const HEADER_QUIET_MS = 450;

/**
 * Hysteresis for "finished with the header": busy at once, free only after `quietMs` of continuous
 * quiet. Focus hopping between two header links, or a menu closed and opened again, never lets the
 * trip start in between. Returns a function fed (busy, now) that says when the visitor is done.
 */
export function createQuietWatch(quietMs = HEADER_QUIET_MS) {
  let quietSince: number | null = null;
  return (busy: boolean, now: number): boolean => {
    if (busy) { quietSince = null; return false; }
    if (quietSince === null) quietSince = now;
    return now - quietSince >= quietMs;
  };
}

/** A mouse in the header counts as using it for this long after it last moved or pressed there. */
export const POINTER_RECENT_MS = 1500;

/** What a header watch needs: somewhere to listen (a real `document` fits). */
export interface HeaderWatchOptions {
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /** Whether an event happened inside the header (its menu included). */
  inHeader: (e: Event) => boolean;
  /** A device with a fine pointer that can hover (a mouse or trackpad). */
  canHover: () => boolean;
  now?: () => number;
  recentMs?: number;
}

/**
 * Watches the visitor in the header, from the moment the invitation opens:
 *  - pointerBusy(): a mouse is in the header and moved or pressed there within POINTER_RECENT_MS.
 *    On a desktop the realms are always on show, so choosing one with a mouse opens no menu and
 *    gives no :focus-visible; this is how the trip knows. A cursor merely parked there stops
 *    counting; touch never counts (its :hover sticks, and an open menu already says it all).
 *  - lastActivity(): when they last did anything in the header (a key, focus, a press, a mouse
 *    move), for the wait's inactivity cap.
 */
export function createHeaderWatch(o: HeaderWatchOptions) {
  const now = o.now ?? (() => performance.now());
  const recent = o.recentMs ?? POINTER_RECENT_MS;
  let pointerAt = -Infinity;
  let pointerIn = false;
  let activityAt = -Infinity;
  const onPointer = (e: Event) => {
    const touch = (e as { pointerType?: string }).pointerType === 'touch';
    const inside = o.inHeader(e);
    if (!touch) {
      pointerIn = inside;
      if (inside) pointerAt = now();
    }
    if (inside) activityAt = now();
  };
  const onKey = (e: Event) => { if (o.inHeader(e)) activityAt = now(); };
  const pointerEvents = ['pointermove', 'pointerdown'] as const;
  const keyEvents = ['keydown', 'focusin'] as const;
  for (const t of pointerEvents) o.target.addEventListener(t, onPointer, { capture: true, passive: true });
  for (const t of keyEvents) o.target.addEventListener(t, onKey, { capture: true });
  return {
    pointerBusy: () => pointerIn && o.canHover() && now() - pointerAt < recent,
    lastActivity: () => activityAt,
    stop() {
      for (const t of pointerEvents) o.target.removeEventListener(t, onPointer, { capture: true });
      for (const t of keyEvents) o.target.removeEventListener(t, onKey, { capture: true });
    },
  };
}

export type WaitVerdict = 'free' | 'give-up' | null;

/**
 * The wait, read every moment while the trip home waits for the visitor:
 *  - 'free'    they have finished with the header and it has stayed quiet for a moment (hysteresis)
 *  - 'give-up' the header is still in use but nobody has touched it for `idleMs` of visible time
 *              (a menu left open): the trip goes on. Each touch starts that time again, so a
 *              header someone is actually using is never covered.
 * A hidden tab holds both: they get their quiet moment, and their idle time, on return.
 */
export function createWaitWatch(quietMs = HEADER_QUIET_MS, idleMs = WAIT_IDLE_MS) {
  const quiet = createQuietWatch(quietMs);
  let last: number | null = null;
  let seen: number | null = null;
  let untouched = 0;
  return (r: { now: number; hidden: boolean; busy: boolean; activityAt: number }): WaitVerdict => {
    const elapsed = last === null ? 0 : Math.min(250, Math.max(0, r.now - last));
    last = r.now;
    if (r.hidden) { quiet(true, r.now); return null; }
    if (r.activityAt !== seen) { seen = r.activityAt; untouched = 0; } else untouched += elapsed;
    if (quiet(r.busy, r.now)) return 'free';
    return untouched >= idleMs ? 'give-up' : null;
  };
}
