#!/usr/bin/env node
// Builds the portfolio's content from:
//   content/starter/*.json   YOUrigin starter packs (source of truth, copied verbatim)
//   content/works/*.json     works added by hand (music, books, art...), same shape + "realm"
//   content/placement.json   which realm each starter-pack work belongs to
//   content/realms.json      the six realms
//   content/about.json       About & Contact
// and writes:
//   src/content/generated/content.json   what the site reads
//   public/content/covers/<slug>.<ext>   cover images pulled out of data URIs
//
// Usage:
//   node scripts/build-content.mjs                     rebuild from content/
//   node scripts/build-content.mjs --import <file>     copy a fresh starter pack in first

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worksFromStarter, placeWorks, parseDataUri, imageSize, checkWork, readAction, readPreview, isWebUrl, EXTRA_FIELDS, STARTER_FIELDS, slugify } from './lib/content-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const P = (...s) => join(ROOT, ...s);
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const inPublicDir = (rel) => existsSync(P('public', rel));

const args = process.argv.slice(2);
const importIdx = args.indexOf('--import');
if (importIdx !== -1) {
  const src = args[importIdx + 1];
  if (!src || !existsSync(src)) {
    console.error(`Starter pack not found: ${src ?? '(no path given)'}`);
    process.exit(1);
  }
  mkdirSync(P('content/starter'), { recursive: true });
  copyFileSync(src, P('content/starter', basename(src)));
  console.log(`Imported ${basename(src)} into content/starter/`);
}

const realms = readJson(P('content/realms.json')).realms;
const placement = readJson(P('content/placement.json'));
const about = readJson(P('content/about.json'));
const realmIds = realms.filter((r) => r.kind === 'works').map((r) => r.id);

// 1. Starter packs
const starterDir = P('content/starter');
const packs = readdirSync(starterDir).filter((f) => f.endsWith('.json')).sort();
if (packs.length === 0) {
  console.error('No starter pack in content/starter/. Run: npm run content:import');
  process.exit(1);
}
let owner = null;
const works = [];
for (const f of packs) {
  const pack = readJson(join(starterDir, f));
  works.push(...worksFromStarter(pack, undefined, inPublicDir));
  owner ??= { name: pack.ownerName, line: pack.ownerLine, intro: pack.intro, packTitle: pack.title, packKey: pack.key };
}

// 2. Hand-written works
const problems = [];
const worksDir = P('content/works');
if (existsSync(worksDir)) {
  const files = readdirSync(worksDir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  files.forEach((f, i) => {
    const w = readJson(join(worksDir, f));
    problems.push(...checkWork(w, `content/works/${f}`));
    const work = { slug: w.slug || slugify(w.title), realm: w.realm, collection: w.collection, source: `works/${f}`, order: 10000 + (w.order ?? i) };
    for (const k of [...STARTER_FIELDS, ...EXTRA_FIELDS]) if (w[k] !== undefined) work[k] = w[k];
    const warn = (msg) => console.warn(`  ! ${msg}`);
    const action = readAction(w.action, `content/works/${f}`, warn, inPublicDir);
    if (action) work.action = action;
    const preview = readPreview(w.preview, `content/works/${f}`, warn);
    if (preview) work.preview = preview;
    if (w.cover) work.coverRaw = w.cover.startsWith('data:') ? w.cover : { file: join(worksDir, w.cover) };
    works.push(work);
  });
}

problems.push(...placeWorks(works, placement, realmIds));
if (problems.length) {
  console.error('Content build stopped:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}

// Preview files given as public/ paths must exist, or they are left out.
const inPublic = (src) => isWebUrl(src) || inPublicDir(src);
for (const w of works) {
  if (!w.preview) continue;
  const images = w.preview.images.filter((img) => {
    if (inPublic(img.src)) return true;
    console.warn(`  ! ${w.title}: preview image public/${img.src} not found, skipped`);
    return false;
  });
  let clip = w.preview.clip;
  if (clip && !(inPublic(clip.src) && inPublic(clip.poster))) {
    console.warn(`  ! ${w.title}: preview clip or poster not found in public/, skipped`);
    clip = undefined;
  }
  if (images.length || clip) w.preview = clip ? { images, clip } : { images };
  else delete w.preview;
}

// 3. Covers: write image files, keep only paths + sizes in the JSON
const coverDir = P('public/content/covers');
rmSync(coverDir, { recursive: true, force: true });
mkdirSync(coverDir, { recursive: true });
for (const w of works) {
  const raw = w.coverRaw;
  delete w.coverRaw;
  if (!raw) continue;
  let bytes, ext;
  if (typeof raw === 'string') {
    const parsed = parseDataUri(raw);
    if (!parsed) { console.warn(`  ! ${w.title}: cover is not an image data URI, skipped`); continue; }
    ({ bytes, ext } = parsed);
  } else {
    if (!existsSync(raw.file)) { console.warn(`  ! ${w.title}: cover file ${raw.file} not found`); continue; }
    bytes = readFileSync(raw.file);
    ext = extname(raw.file).slice(1).toLowerCase();
  }
  const hash = createHash('sha1').update(bytes).digest('hex').slice(0, 8);
  const name = `${w.slug}.${hash}.${ext}`;
  writeFileSync(join(coverDir, name), bytes);
  const size = imageSize(bytes);
  w.cover = { src: `content/covers/${name}`, width: size?.width ?? null, height: size?.height ?? null };
}

works.sort((a, b) => a.order - b.order);
const out = {
  $generated: 'by scripts/build-content.mjs. Do not edit: change content/ and rebuild.',
  owner,
  about: { portrait: about.portrait ?? null, portraitAlt: about.portraitAlt ?? '', contact: about.contact ?? [] },
  realms,
  works: works.map(({ order, ...w }) => w),
};
mkdirSync(P('src/content/generated'), { recursive: true });
writeFileSync(P('src/content/generated/content.json'), JSON.stringify(out, null, 2) + '\n');

const byRealm = Object.fromEntries(realms.map((r) => [r.id, works.filter((w) => w.realm === r.id || w.alsoIn?.includes(r.id)).length]));
console.log(`Content: ${works.length} works from ${packs.length} starter pack(s)` + (existsSync(worksDir) ? ' + content/works' : ''));
console.log('  ' + realms.filter((r) => r.kind === 'works').map((r) => `${r.title}: ${byRealm[r.id]}`).join(' | '));
