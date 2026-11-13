# Content

The portfolio's words and images come from `content/`, built into `src/content/generated/content.json` by `npm run content` (this also runs on every `npm run build`).

## Source of truth: the YOUrigin starter pack

`content/starter/cassidy-ventures.json` is a copy of YOUrigin's `starters/cassidy-ventures.json`. Titles, categories, colours, statuses, both descriptions and links are carried over **verbatim**, and nothing is rewritten or invented. Cover images are pulled out of the pack's data URIs into `public/content/covers/`.

To refresh after editing the pack in YOUrigin:

```bash
npm run content:import
```

### Optional fields from YOUrigin's export

Each project in the pack may also carry these. All are optional; a bad value is skipped with a warning in the build output, and the work shows as if the field were missing.

| Field | Shape | What it does |
| --- | --- | --- |
| `realm` | `"digital"`, `"ventures"`, `"music"`, `"books"` or `"art"` | Places the work, ahead of `content/placement.json`. |
| `slug` | `"lowercase-words"` | The work's address (`/work/<slug>`), if it must differ from the title's. |
| `changes` | `[{ "date": "YYYY-MM-DD", "text": "..." }]` | The "What's new" list on the work's page, newest first. |
| `action` | `{ "kind": "visit" \| "demo" \| "vision" \| "tour" \| "idea", "url": "https://..." }` | The work's one button, on its card and its page: **Visit** (a live site), **Try the demo** (a demo mode inside the real app), **See the vision** (work in progress), **Take the tour** (a guided tour) or **See the idea** (an idea page). The url must be `http://` or `https://`, or a page hosted here, `demos/<project>/` (see [public/demos/README.md](../public/demos/README.md)), whose file must exist in `public/`. It opens in a new tab. |
| `preview` | `{ "images": [{ "src", "alt" }], "clip": { "src", "poster" } }` | A quiet preview gallery on the work's page: screenshots (lazy-loaded, each needs `alt` text) and an optional short clip (needs a `poster`; it is muted, plays inline and never starts by itself). `clip` is optional. |
| `status` | short text, e.g. `"In construction"` | A small, calm tag on the card and page, shown as written (first letter capitalised). At most 32 characters on one line; anything else is skipped with a warning. `idea`, `building` and `complete` keep their colours; other labels use the plain tag. |
| `invite` | `"mailto:YourOwnUniverse.life@gmail.com"` | A line on the work's page: "Want to join the beta, or hear when it's published? Email YourOwnUniverse.life@gmail.com". Only that exact address (Cassidy's public contact) is accepted. Not switched on for any work yet. |

Preview files are either `https://` addresses or paths inside `public/`, written relative to it, e.g. `content/previews/you-home.webp` for `public/content/previews/you-home.webp`. Paths that leave `public/` are refused, and a local file that does not exist is skipped.

Without an `action`, a work's card shows no button, and its page keeps showing the pack's plain `link` as "Visit", as it always has. With neither, there is no button at all. Hand-written works (`content/works/*.json`) may use `action`, `preview`, `status` and `invite` too, and may also list another realm with `"alsoIn": ["music"]`.

```json
{
  "title": "Example App",
  "link": "https://example.com/",
  "action": { "kind": "demo", "url": "https://example.com/?demo=1" },
  "preview": {
    "images": [
      { "src": "content/previews/example-home.webp", "alt": "The home screen, with today's three gentle prompts" }
    ],
    "clip": { "src": "content/previews/example-tour.mp4", "poster": "content/previews/example-tour.webp" }
  }
}
```

## Which cards reach the site

Every card, from the starter pack or `content/works/`, must be claimed by a project in `registry/projects.json`, or the build stops. Cards owned by an "other project" with `"show": false` are left off the site. See [REGISTRY.md](REGISTRY.md).

## Realms

`content/realms.json` defines the six realms (titles, nav labels, short blurbs, emblem, accent colour). Blurbs are site copy, so edit freely. The two works realms' blurbs reuse the starter pack's own intro words.

`content/placement.json` puts starter-pack works into realms, by section or one by one:

| Starter-pack section | Realm |
| --- | --- |
| Human Development & Digital Ecosystems | Digital Creations |
| Client Work | Digital Creations |
| Creative Ventures & Worlds | Ventures & Brands |
| Healing & Wellbeing | Ventures & Brands |

Within a realm, works are grouped under their original section heading. A work with no placement **stops the build** with a clear message, so nothing silently disappears.

Music & Sound, Books & Literature and Art & Experiments are empty until you add works: they show "This part of the world is still being drawn."

## Adding new work (music, books, art…)

Copy `content/works/_template.json` to e.g. `content/works/paper-moon.json`, fill it in, put any images in `content/works/media/`, then run `npm run content`. Required: `title`, `realm`, `description`. Optional: everything in the starter-pack shape plus `year`, `role`, `credits`, `tags`, `body` (extra paragraphs), `media` (audio, video or embed players) and `gallery`.

## About & Contact

`content/about.json`: the portrait (the painting) and contact links. Contact is empty for now. Visitors see nothing there until you add links. In development a dashed note marks the spot.
