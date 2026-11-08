# Content

The portfolio's words and images come from `content/`, built into `src/content/generated/content.json` by `npm run content` (this also runs on every `npm run build`).

## Source of truth: the YOUrigin starter pack

`content/starter/cassidy-ventures.json` is a copy of YOUrigin's `starters/cassidy-ventures.json`. Titles, categories, colours, statuses, both descriptions and links are carried over **verbatim**, and nothing is rewritten or invented. Cover images are pulled out of the pack's data URIs into `public/content/covers/`.

To refresh after editing the pack in YOUrigin:

```bash
npm run content:import
```

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
