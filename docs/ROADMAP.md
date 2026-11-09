# Roadmap

Creative Universe is the central portfolio. Every project stays its own world, and this site connects them. Full proposal and decisions: https://claude.ai/artifact/Bz16tnjtbRq71HYoFKsvVc

## Phase 1 — Audit ✅ (8 Nov 2026)

The ecosystem audit and architecture proposal are done.

## Phase 2 — Make Creative Universe the hub ✅ (8 Nov 2026)

- [x] Moved out of the temporary session folder into `Projects\CreativeUniverse`, with a first commit and the private repo `Kashka-25/creative-universe`
- [x] `CLAUDE.md`, this roadmap, and Kronk Booth's notes
- [x] The content import reads `../YOUrigin` (works from the Projects folder)
- [x] Contact links (email, Instagram)

## Phase 3 — Independent project environments (in progress)

- [x] All projects gathered in `C:\Users\cassi\Projects`, with a Desktop shortcut
- [x] Old copies moved to `_Archive`; worktrees removed; merged branches pruned
- [x] Example-Empatherapy archived on GitHub; stale Empatherapy PRs #2 and #3 closed
- [ ] One small PR per repo adding `CLAUDE.md` and `docs/ROADMAP.md`, plus `portfolio.json` for public repos
- [ ] Rename HOPEIUM to **IntoTheLighthouse (I.T.L)**: site text and wordmark, repo name (the Pages URL changes), Empatherapy draft PR #5, the YOUrigin starter pack
- [ ] Atlantean Gardens: fix the failing Pages build; decide which prototype (`living-atlas-prototype` v4 or `mvp-nextjs`) the site grows from
- [ ] Wandering: open the PR for `feat/phase-1-foundation`; restart local Supabase once from the new folder
- [ ] Fix the YOU starter-pack link, which points to the old vanilla app instead of yourownuniverse.life

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
