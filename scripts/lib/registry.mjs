// The project registry (registry/projects.json): which project owns each card on the site,
// and which projects stay off it. Shared by the content build and the tests.

export const STAGES = ['live', 'beta', 'in-development', 'prototype', 'unconfirmed'];
export const INTEGRATIONS = ['demo-linked', 'demo-hosted-here', 'site-linked', 'card-only'];
export const OTHER_KINDS = ['unsorted', 'client', 'dormant'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isUrl = (s) => typeof s === 'string' && /^https:\/\/\S+$/.test(s);
const isLink = (s) => isUrl(s) || (typeof s === 'string' && /^demos\/[a-z0-9-]+\/(#\d+)?$/.test(s));

/** Checks the registry's shape. Returns a list of problems (empty when it is sound). */
export function checkRegistry(reg) {
  const problems = [];
  if (!isObj(reg)) return ['registry/projects.json is not an object.'];
  if (!Array.isArray(reg.projects)) problems.push('"projects" must be a list.');
  if (!isObj(reg.otherProjects) || !Array.isArray(reg.otherProjects.entries)) problems.push('"otherProjects.entries" must be a list.');
  if (problems.length) return problems;

  const ids = new Set();
  const claimed = new Map();
  const claim = (entry, where) => {
    const works = entry.portfolio?.works;
    if (!Array.isArray(works)) { problems.push(`${where}: "portfolio.works" must be a list of card slugs.`); return; }
    for (const slug of works) {
      if (claimed.has(slug)) problems.push(`The card "${slug}" is claimed by both "${claimed.get(slug)}" and "${entry.id}".`);
      claimed.set(slug, entry.id);
    }
  };
  const checkId = (entry, where) => {
    if (typeof entry.id !== 'string' || !/^[a-z0-9-]+$/.test(entry.id)) problems.push(`${where}: "id" must be lowercase-words.`);
    else if (ids.has(entry.id)) problems.push(`Two registry entries share the id "${entry.id}".`);
    ids.add(entry.id);
    if (!entry.name) problems.push(`${where}: missing "name".`);
  };

  reg.projects.forEach((p, i) => {
    const where = `projects[${i}] (${p.id ?? '?'})`;
    checkId(p, where);
    if (!isUrl(p.repo?.url)) problems.push(`${where}: "repo.url" must be an https:// address.`);
    if (!p.repo?.branch) problems.push(`${where}: missing "repo.branch".`);
    if (!STAGES.includes(p.stage)) problems.push(`${where}: "stage" must be one of ${STAGES.join(', ')}.`);
    if (p.demo != null && !isLink(p.demo)) problems.push(`${where}: "demo" must be https:// or demos/<project>/.`);
    if (p.production != null && !isUrl(p.production)) problems.push(`${where}: "production" must be an https:// address.`);
    if (!INTEGRATIONS.includes(p.portfolio?.integration)) problems.push(`${where}: "portfolio.integration" must be one of ${INTEGRATIONS.join(', ')}.`);
    if (p.portfolio?.show === false) problems.push(`${where}: core projects are always shown; move it to otherProjects to hide it.`);
    claim(p, where);
  });
  reg.otherProjects.entries.forEach((o, i) => {
    const where = `otherProjects[${i}] (${o.id ?? '?'})`;
    checkId(o, where);
    if (!OTHER_KINDS.includes(o.kind)) problems.push(`${where}: "kind" must be one of ${OTHER_KINDS.join(', ')}.`);
    if (typeof o.portfolio?.show !== 'boolean') problems.push(`${where}: "portfolio.show" must be true or false.`);
    claim(o, where);
  });
  return problems;
}

/**
 * Matches built works to the registry. Each work gets `project` (its registry id).
 * Works owned by an entry with portfolio.show false are removed.
 * A work no entry claims is a problem, so nothing reaches the site unregistered.
 */
export function applyRegistry(works, reg) {
  const owner = new Map();
  for (const p of reg.projects) for (const slug of p.portfolio.works) owner.set(slug, { id: p.id, show: true });
  for (const o of reg.otherProjects.entries) for (const slug of o.portfolio.works) owner.set(slug, { id: o.id, show: o.portfolio.show });

  const problems = [];
  const hidden = [];
  const kept = [];
  for (const w of works) {
    const o = owner.get(w.slug);
    if (!o) { problems.push(`"${w.title}" (${w.slug}) is not in registry/projects.json. Add its slug to a project's portfolio.works.`); continue; }
    if (!o.show) { hidden.push(w); continue; }
    kept.push({ ...w, project: o.id });
  }
  const present = new Set(works.map((w) => w.slug));
  const missing = [...owner.keys()].filter((slug) => !present.has(slug));
  return { works: kept, hidden, problems, missing };
}
