# Roadmap

Creative Universe is the central portfolio. Every project stays its own world, and this site connects them. Full proposal and decisions: https://claude.ai/artifact/Bz16tnjtbRq71HYoFKsvVc

## Phase 1 — Audit ✅ (8 Nov 2026)

The ecosystem audit and architecture proposal are done.

## Phase 2 — Make Creative Universe the hub ✅ (8 Nov 2026)

- [x] Moved out of the temporary session folder into `Projects\CreativeUniverse`, with a first commit and the private repo `Kashka-25/creative-universe`
- [x] `CLAUDE.md`, this roadmap, and Kronk Booth's notes
- [x] The content import reads `../YOUrigin` (works from the Projects folder)
- [x] Contact links (email, Instagram)

## Phase 3 — Independent project environments ✅ (8 Nov 2026; PRs waiting for review)

- [x] All projects gathered in `C:\Users\cassi\Projects`, with a Desktop shortcut
- [x] Old copies moved to `_Archive`; worktrees removed; merged branches pruned; broken package links from the move repaired (Wandering, Kronk-Booth)
- [x] Example-Empatherapy archived on GitHub; stale Empatherapy PRs #2 and #3 closed
- [x] A `CLAUDE.md` and roadmap for every project, each in a PR: YOUrigin #25, YOU #105 (to `staging`), Wandering #1, IntoTheLighthouse #1, next.empatherapy #1, empatherapy #6, CommYOUnity #31, FreeTheDream #1, Atlantean-Gardens #1
- [x] HOPEIUM renamed **IntoTheLighthouse**: the repo is now Kashka-25/IntoTheLighthouse and the new site is kashka-25.github.io/IntoTheLighthouse (the old /HOPEIUM link now gives 404); the site text and wordmark change is in PR #1
- [x] Atlantean Gardens: the "failed" site build was a stale record from January; the fix is in PR #1
- [x] Wandering: PR #1 opened for Phases 0–2
- [x] YOUrigin starter pack: YOU now links to yourownuniverse.life, and HOPEIUM is renamed IntoTheLighthouse (local file only; starters are gitignored)
- [ ] **Your review:** merge the nine PRs above
- [ ] Decisions waiting for you: a new IntoTheLighthouse tagline (the old acronym line was removed); which Atlantean Gardens prototype to build from; whether to close CommYOUnity issue #2 (all its phases have merged)
- [ ] `portfolio.json` manifests come in Phase 4, once the registry schema exists
- [ ] Wandering: restart local Supabase once from the new folder (start Docker first)

## Phase 4 — Registry and connections

- [ ] `registry/projects.json` with a schema covering name, description, cover, logo, URL, repo, status, category or realm, relationships, featured, and guide line
- [ ] Build-time reading of the registry, project manifests and YOUrigin's published snapshot, keeping the last good copy if a fetch fails
- [ ] Content model changes: the new realms (Digital Homes with Healing and Worlds & Stories sub-categories, Music & Sound, Books & Poetry, Art, About); a "discontinued" status; a "helped build" collection (Kronk Booth, Kronk Marketplace); a work able to sit in two realms (Kronk Booth)
- [ ] YOUrigin: link a Project to its Creative Universe destination, with change notes and a publish step (a PR in YOUrigin)

## Phase 5 — The guide experience

- [ ] Routes: `/explore` (map of the universe), `/world/:id` (project destination with an "Enter" link), `/journey` (creative timeline), `/contact`
- [ ] Companion behaviours: travel between spots, realm gestures, one line per place, click reactions
- [ ] Blender: install it, sculpt the guide from `blender/README.md`, export, then `npm run check:guide -- --register`
- [ ] Open demos of YOU and YOUrigin, with no entry key (decided 9 Nov 2026): example data in the visitor's browser, never real user data. Add each one's "Try the demo" action once its demo is live.

## Phase 6 — Testing

- [ ] Unit tests for the registry and manifests; a link check on every "Enter" URL
- [ ] Browser tests of Home → Explore → realm → destination → back, at full 3D, lite, and phone sizes
- [ ] Confirm each project's own CI and deploy still run on their own
- [ ] GitHub Pages deploy (Netlify later, once there's a domain)
