// Pure helpers for the content build. No file system access here, so they
// can be unit-tested (tests/content.test.ts).

/** "Chantilly's Tallow" -> "chantillys-tallow" */
export function slugify(title) {
  return String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const DATA_URI = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i;

/** Splits a data URI into mime type, file extension and bytes. Returns null for non-data URIs. */
export function parseDataUri(uri) {
  if (typeof uri !== 'string') return null;
  const m = DATA_URI.exec(uri);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/avif': 'avif', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[mime];
  if (!ext) return null;
  return { mime, ext, bytes: Buffer.from(m[2], 'base64') };
}

/** Reads pixel size from a WebP, PNG or JPEG buffer so cards can reserve space (no layout shift). */
export function imageSize(buf) {
  if (!buf || buf.length < 30) return null;
  // PNG
  if (buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // WebP
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (chunk === 'VP8 ') {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    return null;
  }
  // JPEG: walk segments to the first SOFn marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Fields carried over from the starter pack exactly as written. */
export const STARTER_FIELDS = ['title', 'category', 'colour', 'status', 'description', 'portfolioDescription', 'link'];

/** Extra optional fields a hand-written work (content/works/*.json) may add. */
// alsoIn: other realms a work is also listed in, e.g. ["music"] (its page still sits in its own realm).
export const EXTRA_FIELDS = ['year', 'role', 'tags', 'media', 'gallery', 'credits', 'body', 'alsoIn'];

/** Realms a starter-pack project may name with its optional "realm" field (YOUrigin's export). */
export const STARTER_REALMS = ['digital', 'ventures', 'music', 'books', 'art'];

/** A slug as slugify() makes it: lowercase letters and digits joined by single hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isRealDay(s) {
  if (typeof s !== 'string' || !DAY.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Keeps only well-formed change notes ({ date: "YYYY-MM-DD", text }), newest first.
 * Text is copied exactly as written. Returns the kept notes and how many were dropped.
 */
export function cleanChanges(changes) {
  if (!Array.isArray(changes)) return { kept: [], dropped: changes === undefined ? 0 : 1 };
  const kept = [];
  for (const c of changes) {
    if (c && isRealDay(c.date) && typeof c.text === 'string' && c.text.trim() !== '') kept.push({ date: c.date, text: c.text });
  }
  // Stable sort, so notes on the same day keep the pack's order.
  kept.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { kept, dropped: changes.length - kept.length };
}

/** The kinds of primary action a work may offer, and the words its button uses. */
export const ACTION_KINDS = ['visit', 'demo', 'vision', 'tour', 'idea'];

/** The longest status label a card shows, e.g. "Not yet released". */
export const STATUS_MAX = 32;

/**
 * Reads a work's status label: short free text on one line ("building",
 * "In construction"). Returns it as written, or undefined (with a warning).
 */
export function readStatus(value, name, warn) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.trim() === '' || value.length > STATUS_MAX || /[\r\n]/.test(value)) {
    warn(`${name}: status ${JSON.stringify(value)} must be short text on one line (at most ${STATUS_MAX} characters); showing none.`);
    return undefined;
  }
  return value;
}

/** The one address an invite may use: Cassidy's public contact. */
export const INVITE_EMAIL = 'YourOwnUniverse.life@gmail.com';

/**
 * Reads a work's optional invite: "mailto:YourOwnUniverse.life@gmail.com".
 * Anything else is refused with a warning. Returns the mailto link or undefined.
 */
export function readInvite(value, name, warn) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.toLowerCase() !== `mailto:${INVITE_EMAIL}`.toLowerCase()) {
    warn(`${name}: invite ${JSON.stringify(value)} is not "mailto:${INVITE_EMAIL}"; showing no invite.`);
    return undefined;
  }
  return `mailto:${INVITE_EMAIL}`;
}

/** True for an absolute http(s) URL with a host. */
export function isWebUrl(s) {
  if (typeof s !== 'string' || !/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * A preview file: either an http(s) URL, or a path inside public/ written
 * relative to it ("content/previews/you-1.webp", a leading "/" is allowed).
 * Returns the cleaned path, or null if it is neither.
 */
export function previewSrc(s) {
  if (typeof s !== 'string' || s.trim() === '') return null;
  if (isWebUrl(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//') || s.includes('\\')) return null;
  const path = s.replace(/^\/+/, '').replace(/^public\//, '');
  if (path === '' || path.split('/').some((part) => part === '' || part === '.' || part === '..')) return null;
  return path;
}

/**
 * A site-hosted demo: a path inside public/demos/<project>/, written relative to
 * the site ("demos/freethedream/" or "demos/freethedream/index.html").
 * Returns the public/ file that must exist for it (a directory means its
 * index.html), or null when the url is not such a path.
 */
export function siteDemoFile(url) {
  if (typeof url !== 'string') return null;
  // An optional #step (letters, digits, - and _) opens the demo at that step, e.g. "demos/kronk/#5".
  const parts = url.split('#');
  if (parts.length > 2 || (parts.length === 2 && !/^[A-Za-z0-9_-]+$/.test(parts[1]))) return null;
  const path = parts[0];
  const m = /^demos\/[a-z0-9][a-z0-9-]*\/((?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*(?:[A-Za-z0-9_-][A-Za-z0-9._-]*)?)$/.exec(path);
  if (!m) return null;
  return path.endsWith('/') ? `${path}index.html` : path;
}

/**
 * Reads a work's primary action: { kind: "visit" | "demo" | "vision", url }.
 * The url is an http(s) address, or a site-hosted demo under demos/ whose file
 * exists in public/ (checked with publicFileExists, given by the build script).
 * Returns the action, or undefined (with a warning) when it is missing or invalid.
 */
export function readAction(value, name, warn, publicFileExists) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    warn(`${name}: action must be an object like { "kind": "visit", "url": "https://..." }; showing no button.`);
    return undefined;
  }
  if (!ACTION_KINDS.includes(value.kind)) {
    warn(`${name}: action kind ${JSON.stringify(value.kind)} is not one of ${ACTION_KINDS.join(', ')}; showing no button.`);
    return undefined;
  }
  const demoFile = siteDemoFile(value.url);
  if (demoFile) {
    if (!publicFileExists || !publicFileExists(demoFile)) {
      warn(`${name}: action url "${value.url}" needs public/${demoFile}, which is not there; showing no button.`);
      return undefined;
    }
  } else if (!isWebUrl(value.url)) {
    warn(`${name}: action url ${JSON.stringify(value.url)} is not an http(s) address or a demo under demos/; showing no button.`);
    return undefined;
  }
  return { kind: value.kind, url: value.url };
}

/**
 * Reads a work's preview gallery: { images: [{ src, alt }], clip?: { src, poster } }.
 * Images need a valid src and alt text. A clip needs both a src and a poster.
 * Invalid parts are dropped with a warning. Returns undefined when nothing is left.
 */
export function readPreview(value, name, warn) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    warn(`${name}: preview must be an object like { "images": [{ "src": "...", "alt": "..." }] }; showing no gallery.`);
    return undefined;
  }
  const images = [];
  const rawImages = value.images === undefined ? [] : value.images;
  if (!Array.isArray(rawImages)) {
    warn(`${name}: preview images must be a list; ignoring them.`);
  } else {
    let dropped = 0;
    for (const img of rawImages) {
      const src = img && previewSrc(img.src);
      if (src && typeof img.alt === 'string' && img.alt.trim() !== '') images.push({ src, alt: img.alt });
      else dropped++;
    }
    if (dropped) warn(`${name}: ignored ${dropped} preview image(s) without an http(s) or public/ src and alt text.`);
  }
  let clip;
  if (value.clip !== undefined) {
    const src = value.clip && previewSrc(value.clip.src);
    const poster = value.clip && previewSrc(value.clip.poster);
    if (src && poster) clip = { src, poster };
    else warn(`${name}: preview clip needs an http(s) or public/ src and poster; ignoring it.`);
  }
  if (!images.length && !clip) return undefined;
  return clip ? { images, clip } : { images };
}

/**
 * Turns a parsed starter pack into a flat list of works, each remembering the
 * section it came from. Values are copied verbatim: nothing is rewritten or invented.
 *
 * Packs exported by YOUrigin may also give each project an optional "realm",
 * "slug", "changes" (change notes), "action" (its one button) and "preview"
 * (screenshots and a short clip). See docs/CONTENT.md. Invalid values are ignored with a warning,
 * so the work falls back to how it would be read without them. The pack's
 * top-level "source" and "exportedAt" are accepted and not used.
 */
export function worksFromStarter(pack, warn = (msg) => console.warn(`  ! ${msg}`), publicFileExists) {
  if (!pack || pack.format !== 'yourigin-starter-portfolio' || !Array.isArray(pack.sections)) {
    throw new Error('Not a YOUrigin starter portfolio (expected format "yourigin-starter-portfolio").');
  }
  const works = [];
  const projects = [];
  pack.sections.forEach((section, si) => {
    (section.projects || []).forEach((p, pi) => {
      const work = { slug: slugify(p.title), collection: section.heading, source: `starter:${pack.key}`, order: si * 100 + pi };
      for (const f of STARTER_FIELDS) if (p[f] !== undefined && p[f] !== '') work[f] = p[f];
      if (p.cover) work.coverRaw = p.cover;
      works.push(work);
      projects.push(p);
    });
  });

  // Optional fields from YOUrigin's export.
  works.forEach((work, i) => {
    const p = projects[i];
    const name = `"${p.title}"`;

    if (p.realm !== undefined) {
      if (STARTER_REALMS.includes(p.realm)) work.realm = p.realm;
      else warn(`${name}: realm ${JSON.stringify(p.realm)} is not one of ${STARTER_REALMS.join(', ')}; placing it by section instead.`);
    }

    if (p.slug !== undefined && p.slug !== work.slug) {
      const takenBy = works.find((other, j) => j !== i && other.slug === p.slug);
      if (typeof p.slug !== 'string' || !SLUG.test(p.slug)) {
        warn(`${name}: slug ${JSON.stringify(p.slug)} is not a valid slug; using "${work.slug}".`);
      } else if (takenBy) {
        warn(`${name}: slug "${p.slug}" is already used by "${takenBy.title}"; using "${work.slug}".`);
      } else {
        work.slug = p.slug;
      }
    }

    if (p.changes !== undefined) {
      const { kept, dropped } = cleanChanges(p.changes);
      if (dropped) warn(`${name}: ignored ${dropped} change note(s) without a YYYY-MM-DD date and text.`);
      if (kept.length) work.changes = kept;
    }

    const action = readAction(p.action, name, warn, publicFileExists);
    if (action) work.action = action;
    const preview = readPreview(p.preview, name, warn);
    if (preview) work.preview = preview;
    const status = readStatus(p.status, name, warn);
    if (status) work.status = status; else delete work.status;
    const invite = readInvite(p.invite, name, warn);
    if (invite) work.invite = invite;
  });
  return works;
}

/** Decides each work's realm from placement rules. Returns the problems instead of guessing. */
export function placeWorks(works, placement, realmIds) {
  const problems = [];
  for (const w of works) {
    const realm = w.realm || placement.byWork?.[w.slug] || placement.bySection?.[w.collection];
    if (!realm) problems.push(`"${w.title}" (section "${w.collection ?? 'none'}") has no realm. Add it to content/placement.json.`);
    else if (!realmIds.includes(realm)) problems.push(`"${w.title}" is placed in unknown realm "${realm}". Known realms: ${realmIds.join(', ')}.`);
    else w.realm = realm;
    if (w.alsoIn !== undefined) {
      const extra = Array.isArray(w.alsoIn) ? w.alsoIn : [w.alsoIn];
      const unknown = extra.filter((r) => !realmIds.includes(r));
      if (unknown.length) problems.push(`"${w.title}" is also listed in unknown realm(s) ${unknown.map((r) => JSON.stringify(r)).join(', ')}. Known realms: ${realmIds.join(', ')}.`);
      else w.alsoIn = [...new Set(extra)].filter((r) => r !== w.realm);
      if (Array.isArray(w.alsoIn) && w.alsoIn.length === 0) delete w.alsoIn;
    }
  }
  const seen = new Map();
  for (const w of works) {
    if (seen.has(w.slug)) problems.push(`Two works share the slug "${w.slug}" ("${seen.get(w.slug)}" and "${w.title}"). Give one a "slug" field.`);
    seen.set(w.slug, w.title);
  }
  return problems;
}

/** Validates a hand-written work file. */
export function checkWork(w, file) {
  const problems = [];
  for (const f of ['title', 'realm', 'description']) if (!w[f]) problems.push(`${file}: missing "${f}".`);
  return problems;
}
