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
export const EXTRA_FIELDS = ['year', 'role', 'tags', 'media', 'gallery', 'credits', 'body'];

/**
 * Turns a parsed starter pack into a flat list of works, each remembering the
 * section it came from. Values are copied verbatim: nothing is rewritten or invented.
 */
export function worksFromStarter(pack) {
  if (!pack || pack.format !== 'yourigin-starter-portfolio' || !Array.isArray(pack.sections)) {
    throw new Error('Not a YOUrigin starter portfolio (expected format "yourigin-starter-portfolio").');
  }
  const works = [];
  pack.sections.forEach((section, si) => {
    (section.projects || []).forEach((p, pi) => {
      const work = { slug: slugify(p.title), collection: section.heading, source: `starter:${pack.key}`, order: si * 100 + pi };
      for (const f of STARTER_FIELDS) if (p[f] !== undefined && p[f] !== '') work[f] = p[f];
      if (p.cover) work.coverRaw = p.cover;
      works.push(work);
    });
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
