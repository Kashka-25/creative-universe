# Project registry

`registry/projects.json` is the one list of every project in the Creative Universe: where its code lives, how it is built and deployed, where its demo is, and which cards on this site it owns. When a fact about a project changes (a new demo link, a repo moving, a stage changing), change it here.

Card words, covers and buttons still come from the YOUrigin starter pack and `content/works/` (see [CONTENT.md](CONTENT.md)). The registry decides **which** cards reach the site.

## How the build uses it

`npm run content` (and so `npm run build`) reads the registry after gathering the cards:

- Every card must be claimed by exactly one registry entry, by slug, in `portfolio.works`. A card nobody claims **stops the build**, so nothing reaches the site unregistered.
- Cards claimed by an `otherProjects` entry with `"show": false` are left off the site. The build prints their titles. Their source files stay in `content/` so they can come back by switching `show` to `true`.
- Slugs listed but with no card yet (for example Quinta da Libélula while its PR waits) are reported, not errors.
- Each card in `src/content/generated/content.json` gets `project`: the id of its registry entry.
- Tests (`tests/registry.test.ts`) check the registry's shape, that excluded projects stay off the site, and that each registry demo link matches the card's button.

## Core projects (`projects`)

| Field | Meaning |
| --- | --- |
| `id` | lowercase-words, unique |
| `name`, `formerly` | the project's name, and an old name if it was renamed |
| `role` | one line on what it is |
| `repo` | `{ url, branch, private, owner? }`: the repository that leads the project and its main branch |
| `otherRepos` | further repositories that belong to it |
| `localFolder` | where it lives on Cassidy's computer, under the home folder |
| `stack` | main technologies |
| `stage` | `live`, `beta`, `in-development`, `prototype` or `unconfirmed` |
| `demo` | the demo address: `https://...`, or `demos/<project>/` when its built copy is hosted here |
| `production` | the live site or app, or `null` |
| `deploy` | how it is deployed |
| `dependencies` | services and other projects it relies on |
| `demoBrief` | the issue or document that briefs its demo work |
| `portfolio` | `{ works: [card slugs], integration }`, where integration is `demo-linked`, `demo-hosted-here`, `site-linked` or `card-only` |

Core projects are always shown. To take one off the site, move it to `otherProjects`.

## Other projects (`otherProjects.entries`)

Projects outside the core list. Each has `kind`: `unsorted` for now, later `client` or `dormant`. `portfolio.show` says whether its cards appear on the site. Client sites and The Art of Free Flow are shown; Sweet Vital Nectar, Kronk Marketplace (Wachuneed), Living YOUlogy, Rhythm Relics and Creative Wellness are not (13 Nov 2026).
