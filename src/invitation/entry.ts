// Where a visit begins. Pure decisions (tested in node), plus one small function that applies
// them before the router exists, so the very first URL is already the right one.
//
//   First visit to '/' in this tab   → '#/invitation' (a history REPLACE: Back never bounces)
//   ?intro=full | lite               → the invitation, even if it has been seen
//   ?intro=off                       → never; counts as seen
//   Deep link (any other route)      → untouched; counts as seen
//   '#/invitation' itself            → the page decides (see invitationStart)
//
// The invitation marks itself seen when it STARTS, so a reload never replays it.

export type EntryAction = 'invite' | 'mark' | 'none';

export interface EntryInput {
  /** window.location.hash, e.g. '', '#', '#/', '#/realm/music' */
  hash: string;
  /** window.location.search, e.g. '?intro=full' */
  search: string;
  /** The welcome has already played in this tab (sessionStorage 'ccu:intro-seen'). */
  seen: boolean;
  /** The seen flag can be stored; without it a redirect would repeat on every reload. */
  storageOk: boolean;
}

export const INVITATION_PATH = '/invitation';

/** The route a hash points at ('' and '#' and '#/' are all home). Query and trailing slashes ignored. */
export function routeOf(hash: string): string {
  const path = hash.replace(/^#/, '').split('?')[0].replace(/\/+$/, '');
  return path === '' ? '/' : path.startsWith('/') ? path : `/${path}`;
}

export function forcedIntro(search: string): 'full' | 'lite' | 'off' | null {
  const v = new URLSearchParams(search).get('intro');
  return v === 'full' || v === 'lite' || v === 'off' ? v : null;
}

export function firstEntry({ hash, search, seen, storageOk }: EntryInput): EntryAction {
  const route = routeOf(hash);
  const forced = forcedIntro(search);
  if (route === INVITATION_PATH) return 'none';
  if (forced === 'off') return seen ? 'none' : 'mark';
  if (route === '/') {
    if (forced === 'full' || forced === 'lite') return 'invite';
    if (!seen && storageOk) return 'invite';
    return 'none';
  }
  // a deep link: they came for something specific, so the welcome counts as seen
  return seen ? 'none' : 'mark';
}

export interface StartInput {
  seen: boolean;
  /** Arrived with router state { replay: true } (the footer's "Replay the welcome"). */
  replay: boolean;
  forced: 'full' | 'lite' | 'off' | null;
}

/** On '#/invitation': play it, or (already seen this session, not a replay) go straight home. */
export function invitationStart({ seen, replay, forced }: StartInput): 'play' | 'home' {
  if (forced === 'off') return 'home';
  if (replay || forced === 'full' || forced === 'lite') return 'play';
  return seen ? 'home' : 'play';
}

/** Runs once per page load, before createHashRouter. */
export function applyFirstEntry(deps: {
  seen: () => boolean;
  storageOk: () => boolean;
  markSeen: () => void;
  location?: Pick<Location, 'hash' | 'search' | 'pathname'>;
  history?: Pick<History, 'replaceState' | 'state'>;
}): EntryAction {
  const loc = deps.location ?? window.location;
  const hist = deps.history ?? window.history;
  const action = firstEntry({ hash: loc.hash, search: loc.search, seen: deps.seen(), storageOk: deps.storageOk() });
  if (action === 'invite') hist.replaceState(hist.state, '', `${loc.pathname}${loc.search}#${INVITATION_PATH}`);
  else if (action === 'mark') deps.markSeen();
  return action;
}
