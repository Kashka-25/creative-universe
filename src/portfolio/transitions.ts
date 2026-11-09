// View-transition names for a change of page (see base.css), and the way to and from the welcome.
// Tested in node.
//
// A page's own content and footer get names unique to that page, so on a change of page the old
// one and the new one are separate groups: the old fades out exactly where it was (however far it
// was scrolled) and the new fades in where it lands. Everything that persists (the background, the
// header, Coco's layer, the cloud veil) is never crossfaded with a frozen copy of itself.

/** A CSS <custom-ident> made from a route: letters, digits and hyphens, never starting with a digit. */
export function routeIdent(pathname: string): string {
  const slug = pathname.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'home';
}

export function pageTransitionNames(pathname: string): { content: string; footer: string } {
  const id = routeIdent(pathname);
  return { content: `page-${id}`, footer: `foot-${id}` };
}

// ── the way to and from the welcome ────────────────────────
// Only these changes of page crossfade (the whole page changes). The view transition is started
// here, never through React Router's own option for it: the router remembers every navigation made
// with that option (for the rest of the tab session, reloads included) and plays a view transition
// on its own on any later Back or Forward between those pages. Inside the site that would freeze
// Coco, who is live over the page, for every frame of the transition's update.

/** What a navigate function needs to accept (React Router's fits). */
export interface WelcomeNavOptions { replace?: boolean; state?: unknown; flushSync?: boolean }
export type NavigateLike = (to: string, opts?: WelcomeNavOptions) => void | Promise<void>;

interface TransitionLike { ready?: Promise<unknown>; finished?: Promise<unknown>; updateCallbackDone?: Promise<unknown> }
interface TransitionDoc { startViewTransition?: (update: () => Promise<void> | void) => TransitionLike | void }

/**
 * Navigates inside a view transition (where the browser has them): the router renders the new page
 * synchronously (flushSync) inside the transition's update, so the new snapshot is the new page.
 * Without view transitions it simply navigates. A transition the browser skips (a hidden tab, another
 * one starting) still runs the update, so the page always changes; its rejected promises are expected.
 */
export function welcomeNavigate(navigate: NavigateLike, to: string, opts: WelcomeNavOptions = {}, doc: TransitionDoc | null = typeof document !== 'undefined' ? document : null) {
  if (!doc || typeof doc.startViewTransition !== 'function') { void navigate(to, opts); return; }
  const t = doc.startViewTransition(async () => { await navigate(to, { ...opts, flushSync: true }); });
  const quiet = () => undefined;
  if (t) for (const p of [t.ready, t.finished, t.updateCallbackDone]) p?.catch(quiet);
}

/** A click that a link handles itself (a plain primary click; not one opening a new tab or window). */
export function isPlainClick(e: { button: number; metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; defaultPrevented: boolean }) {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey;
}

/**
 * onClick for a link to or from the welcome: a plain click crossfades there (welcomeNavigate) instead
 * of the link's own navigation; any other click (a new tab) is left to the browser.
 */
export function welcomeClick(navigate: NavigateLike, to: string, opts: WelcomeNavOptions = {}) {
  return (e: { button: number; metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; defaultPrevented: boolean; preventDefault(): void }) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    welcomeNavigate(navigate, to, opts);
  };
}

// ── whether the page has changed since it loaded ──────────
let navigatedYet = false;
/** The router has changed page (main.tsx subscribes this to the router). */
export function noteNavigation() { navigatedYet = true; }
/** Whether the router has changed page at least once since this page loaded (a first load has not). */
export const hasNavigated = () => navigatedYet;
