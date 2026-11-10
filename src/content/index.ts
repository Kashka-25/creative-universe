// The portfolio's content model. Everything the pages show comes through here,
// from src/content/generated/content.json (built by scripts/build-content.mjs).

import data from './generated/content.json';

export type RealmId = 'digital' | 'ventures' | 'music' | 'books' | 'art' | 'about';
export type Emblem = 'window' | 'seed' | 'wave' | 'book' | 'brush' | 'eye';
export type Colour =
  | 'jade' | 'ochre' | 'olive' | 'sky' | 'moss' | 'rose' | 'lavender' | 'teal' | 'amber';

export interface Realm {
  id: RealmId;
  kind: 'works' | 'page';
  title: string;
  nav: string;
  blurb: string;
  emblem: Emblem;
  accent: Colour;
  /** Gesture the guide makes on arriving in this realm (see contract gestures). */
  guideEmote?: string;
}

export interface Cover { src: string; width: number | null; height: number | null }
export interface Media { kind: 'audio' | 'video' | 'embed'; src: string; title?: string }
export interface GalleryImage { src: string; alt: string }
export interface ChangeNote { date: string; text: string }
/**
 * A work's one primary action. The url is an http(s) address, or a demo hosted
 * on this site ("demos/<project>/"); both are checked at build time.
 */
export interface WorkAction { kind: 'visit' | 'demo' | 'vision' | 'tour' | 'idea'; url: string }
/** Screenshots and an optional short clip. Local files are paths inside public/. */
export interface Preview {
  /** width and height are filled in at build time for local files. */
  images: (GalleryImage & { width?: number; height?: number })[];
  /** The clip's width and height are its poster's. */
  clip?: { src: string; poster: string; width?: number; height?: number };
}

export interface Work {
  slug: string;
  title: string;
  realm: RealmId;
  /** Other realms that also list this work (its page and breadcrumbs stay in `realm`). */
  alsoIn?: RealmId[];
  /** The section heading it had in the starter pack, e.g. "Client Work". */
  collection?: string;
  source: string;
  category?: string;
  colour?: Colour | string;
  /** A short status label, shown as written on the card and page (e.g. "In construction"). */
  status?: 'idea' | 'building' | 'complete' | string;
  description?: string;
  portfolioDescription?: string;
  link?: string;
  cover?: Cover;
  /** Change notes from YOUrigin's export, newest first, in Cassidy's words. */
  changes?: ChangeNote[];
  /** The one button on the card and page ("Visit", "Try the demo", "See the vision"). */
  action?: WorkAction;
  /** Preview gallery shown on the work's page. */
  preview?: Preview;
  /** Optional invite line on the page; only ever "mailto:YourOwnUniverse.life@gmail.com" (checked at build time). */
  invite?: string;
  // Optional fields for hand-written works (content/works/*.json)
  year?: string;
  role?: string;
  tags?: string[];
  media?: Media[];
  gallery?: GalleryImage[];
  credits?: string;
  body?: string[];
}

export interface Owner { name: string; line: string; intro: string; packTitle: string; packKey: string }
export interface ContactLink { label: string; href: string }
/** Credit for the portrait's artist, shown under it (Cassidy, 10 Nov 2026). */
export interface PortraitCredit { lead: string; label: string; href: string }
export interface About { portrait: string | null; portraitAlt: string; portraitCredit: PortraitCredit | null; contact: ContactLink[] }

const content = data as unknown as { owner: Owner; about: About; realms: Realm[]; works: Work[] };

export const owner = content.owner;
export const about = content.about;
export const realms = content.realms;
export const works = content.works;

export const realmById = (id: string) => realms.find((r) => r.id === id);
export const worksIn = (id: RealmId) => works.filter((w) => w.realm === id || w.alsoIn?.includes(id));
export const workBySlug = (slug: string) => works.find((w) => w.slug === slug);

/** Previous and next works in the same realm, for walking through a realm. */
export function neighbours(work: Work) {
  const list = worksIn(work.realm);
  const i = list.findIndex((w) => w.slug === work.slug);
  return { prev: i > 0 ? list[i - 1] : undefined, next: i < list.length - 1 ? list[i + 1] : undefined };
}

/** Starter-pack status words, shown as written but capitalised. */
export const statusLabel = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** Public asset path that respects Vite's base. */
export const asset = (p: string) => `${import.meta.env.BASE_URL}${p.replace(/^\//, '')}`;

/** A preview file: web addresses as they are, public/ paths through asset(). */
export const previewAsset = (src: string) => (/^https?:\/\//i.test(src) ? src : asset(src));

/** True for a demo hosted on this site, under public/demos/ (checked at build time). */
export const isSiteDemo = (url: string) => url.startsWith('demos/');

/** Where an action's button points: site demos resolve against the site's base. */
export const actionHref = (url: string) => (isSiteDemo(url) ? asset(url) : url);

/** Button words for each kind of action. */
export const actionLabel: Record<WorkAction['kind'], string> = {
  visit: 'Visit',
  demo: 'Try the demo',
  vision: 'See the vision',
  tour: 'Take the tour',
  idea: 'See the idea',
};

/**
 * The action a work's page shows: its own action, or else its plain starter-pack
 * link as "Visit" (how pages have always looked). Cards show only work.action.
 */
export const pageAction = (work: Work): WorkAction | undefined =>
  work.action ?? (work.link ? { kind: 'visit', url: work.link } : undefined);
