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

export interface Work {
  slug: string;
  title: string;
  realm: RealmId;
  /** The section heading it had in the starter pack, e.g. "Client Work". */
  collection?: string;
  source: string;
  category?: string;
  colour?: Colour | string;
  status?: 'idea' | 'building' | 'complete' | string;
  description?: string;
  portfolioDescription?: string;
  link?: string;
  cover?: Cover;
  /** Change notes from YOUrigin's export, newest first, in Cassidy's words. */
  changes?: ChangeNote[];
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
export interface About { portrait: string | null; portraitAlt: string; contact: ContactLink[] }

const content = data as unknown as { owner: Owner; about: About; realms: Realm[]; works: Work[] };

export const owner = content.owner;
export const about = content.about;
export const realms = content.realms;
export const works = content.works;

export const realmById = (id: string) => realms.find((r) => r.id === id);
export const worksIn = (id: RealmId) => works.filter((w) => w.realm === id);
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
