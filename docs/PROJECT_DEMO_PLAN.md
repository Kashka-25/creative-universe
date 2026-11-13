# Project demo and portfolio-link plan

Each Creative Universe project keeps its own repository and owns its own demo. Creative Universe only links to the demo; it does not become the host for every project's implementation.

## Link rules

- **Demo preview** — the preferred link for an active product or venture. It must be a stable, public, safe-to-share preview deployed from that project's own repository.
- **Live product/site** — use when the real public experience is already the right demonstration. Do not create a duplicate demo merely for consistency.
- **Prototype preview** — use for unfinished projects. The demo must accurately show the current working state and communicate the intended direction. Clearly distinguish working functionality from simulated/planned functionality.
- **External client site** — use the client's existing public site for completed client work; do not create or claim ownership of a duplicate.

## Project register

The facts in this table (repos, demo links, deploys) now live in [`registry/projects.json`](../registry/projects.json) ([REGISTRY.md](REGISTRY.md)). Update the registry first; this table keeps each demo's scope and acceptance notes.

| Project | Repository / owning session | Link type for Creative Universe | Demo scope and acceptance |
|---|---|---|---|
| YOU | `Kashka-25/you-app-build` | Dedicated demo preview | Build a polished, read-only visitor demo using fictional/sample data. Show the core personal-growth journey, values/pillars, pursuits, memory/calendar and avatar progression. No real account, private user data, live writes or exposed secrets. Use the current app as the base; label simulated flows honestly. |
| YOUrigin | `Kashka-25/YOUrigin` | Dedicated demo preview | Use the existing app and its portfolio/visitor-preview capabilities. Create a curated sample creative workspace with fictional/sample content showing capture → organise → Projects → Works, plus a visitor portfolio. No Cassidy's private writing or local data. |
| Wandering | `Kashka-25/Wandering` | Prototype preview | The repository describes Phase 1 foundation as in progress and Phase 2 (My Wandering) as next; it has not yet run on a phone. Build a browser-friendly, clearly labelled prototype using seeded fictional places and people. Demonstrate My Wandering and the separate opt-in Social Wandering map, journey planning, stories and privacy boundaries. Never use real location data or imply live tracking is operational. |
| IntoTheLighthouse (I.T.L; formerly HOPEIUM) | `Kashka-25/IntoTheLighthouse` | Prototype preview | Current repo contains landing, support, booking and request screens. Demonstrate the intended warm, low-friction support journey and both pathways. Booking and request submission must remain clearly demo-only until secure scheduling, backend delivery, notifications, privacy and safeguarding are implemented and tested. Update old HOPEIUM naming in the project presentation where appropriate. |
| Empatherapy | `Kashka-25/empatherapy` | Live website | The public site at https://empatherapy.co is already the strongest demonstration. Audit its current live state and use the live site link; only create a separate preview if there is a distinct new experience not represented there. |
| CommYOUnity | `Kashka-25/CommYOUnity` | Dedicated demo preview | Create a safe visitor demo using fictional community members and sample land data. Show tasks, rosters, shared expenses, calendar, noticeboard and GratitYOUde. Do not expose Terra Sangha member data, real expenses, credentials or live Supabase writes. Clearly mark sample data. |
| Atlantean Gardens | `Kashka-25/Atlantean-Gardens` | Prototype preview | Current repository is a small static site with index/about/shop pages. The intended destination is a botanical world with an interactive Atlas, realms, strain cards, characters and lore. Build a coherent prototype from the existing assets and current site; do not imply commerce, strain availability or unbuilt Atlas features are live. First inspect/fix the Pages build and document the chosen foundation before expanding. |
| FreeTheDream | `Kashka-25/free-the-dream-map` | Demo preview | The repo already contains a standalone map and a Claude-artifact shared build, plus a project-space preview. Audit and polish the existing demonstration rather than rebuilding it. Make the public demo clearly distinguish standalone/local mode from shared mode and simulated project-space interactions. |
| Kronk | `Kashka-25/kronk` | Collaborative project entry linking to the live platform | Include Kronk itself as a collaborative piece, with clear and accurate collaborative credit rather than presenting it as Cassidy's sole creation or implying ownership. Use the public platform at https://kronk.info as the primary destination. The project description should explain the community-owned social platform and the collaborative contribution; only state specific responsibilities or deliverables that can be verified. |\n| Kronk Booth | `Kashka-25/kronk` | Dedicated Booth demo route within Kronk | Booth remains a distinct collaborative contribution/korner within the Kronk platform, not a separate repository. Build a safe, seeded Booth demonstration within the existing repo and its conventions. Show the music-discovery/listening/artist experience that is actually in scope for Booth. Do not duplicate Kronk or expose real member data; mark simulated integrations. Follow the repo's CLAUDE.md and contribution workflow, including its shadow branch/PR conventions. |
| Creation Atlas | `Kashka-25/YOUrigin` (provisional home; no separate repo was found) | Prototype preview | Build a focused prototype from the current concept and its intended direction: a navigable atlas of creative works/ideas and their relationships. First inspect YOUrigin's current Projects/Works model and any existing Creation Atlas work. Keep it a clearly separated feature/demo route or sample view; do not invent finished functionality. If it proves to be a distinct product rather than a YOUrigin feature, stop and report that a dedicated repo decision is needed. |
| Chantilly's Tallow | Existing client site | External client site | Completed client work. Link to https://chantillytallow.com/; no new demo repository required. |
| ReFocus Counselling | Existing client site | External client site | Completed client work. Link to https://www.refocuscounselling.com/; no new demo repository required. |

## Global requirements for every demo

1. Build the demo in the project's own repository. Do not move project implementation into Creative Universe.
2. Add a stable demo entry point and document its URL, deployment method, build/run commands and owner repo in that repo's README or `portfolio.json`.
3. Prefer a public, no-login visitor path. If authentication is essential, provide a dedicated demo account with fictional data and safe permissions.
4. Use only fictional/sample data. Never expose real user, community, customer, financial, health, location or private creative content.
5. No production secrets in client code. Do not allow a public demo to write to production databases.
6. Make the demo responsive and accessible, with a clear reset/restart path where state is interactive.
7. For unfinished projects, present two layers honestly: **Working now** and **Direction / prototype**. Use mocked interactions for unbuilt capabilities and label them as simulated.
8. Add screenshots/cover art only when they represent the actual demo.
9. Run the repository's checks and verify the deployed URL before reporting it as ready.
10. Once a demo is deployed and verified, update the Creative Universe project record to use that exact URL. Until then, keep the existing link and mark the demo as pending.

## Completion report required from each project session

Return:
- repository and branch/PR;
- what the demo shows;
- what is real versus simulated;
- exact deployed URL (or why deployment is blocked);
- build/test results;
- any secrets, privacy or access considerations;
- the exact Creative Universe project link value to use.

## Scope exclusions

Do not create demo tasks for Sweet Vital Nectar, Rhythm Relics, Living YOUlogy, Creative Wellness or Kronk Marketplace. They remain excluded from this Creative Universe active-project split. Kronk itself is now explicitly included as a collaborative project entry, with the live platform as its destination. Kronk Booth remains a separate, more focused project/korner entry within the Kronk repository.


## Project-session task links

Use these GitHub issues as the handoff brief for the Claude Code session opened in each repository:

- YOU: https://github.com/Kashka-25/you-app-build/issues/107
- YOUrigin + Creation Atlas assessment: https://github.com/Kashka-25/YOUrigin/issues/37
- Wandering: https://github.com/Kashka-25/Wandering/issues/3
- IntoTheLighthouse (formerly HOPEIUM): https://github.com/Kashka-25/IntoTheLighthouse/issues/3
- Empatherapy live-site audit: https://github.com/Kashka-25/empatherapy/issues/7
- CommYOUnity: https://github.com/Kashka-25/CommYOUnity/issues/37
- Atlantean Gardens: https://github.com/Kashka-25/Atlantean-Gardens/issues/2
- FreeTheDream: https://github.com/Kashka-25/free-the-dream-map/issues/2
- Kronk Booth: Issues are disabled in the Kronk repository, so use `docs/CREATIVE_UNIVERSE_BOOTH_DEMO.md` in that repo as the session brief.
