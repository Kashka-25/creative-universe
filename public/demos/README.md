# Built demo copies

Each folder here, `public/demos/<project>/`, holds a **built copy** of a project's demo, so visitors can try it from Creative Universe. This is the one exception to "each project stays independent" (approved by Cassidy, 9 Nov 2026).

- These are built artifacts, refreshed from the project's own repo. **Never edit them here**: change the project, rebuild it, and copy the result over.
- Demos use **example data only** and make **no network requests**.
- A work points to its demo with an action like `{ "kind": "demo", "url": "demos/<project>/" }`. The build checks that the file is here (a url ending in `/` needs its `index.html`). The demo opens in a new tab.

## FreeTheDream

`freethedream/index.html` is `dist/demo.html` from free-the-dream-map, branch `demo-richer-seed`, commit `0120a2c` (its PR #4, copied before that PR was merged).

To refresh it:

1. In free-the-dream-map, run `python build.py`.
2. Copy `dist/demo.html` over `public/demos/freethedream/index.html` here.

What it does:

- It writes only two localStorage keys in the visitor's browser: `freethedream-demo-v2` (the demo map) and `freethedream-demo-tour-seen` (set once the visitor has finished the tour).
- Reset removes both keys and reloads the demo. (Checked in the browser on 9 Nov 2026: after the tour both keys were set, and after Reset localStorage was empty.)
- The people and ideas are made up. "Watch a project space" plays a step-by-step preview with example people; nothing in it is saved.
- It makes no network requests. Its links to YOU and Kronk open only when the visitor clicks them.
- "← Back to Creative Universe" goes to `../../#/`, so the action url keeps its trailing slash: `demos/freethedream/`.

## Kronk

`kronk/index.html` is a self-contained guided tour of Kronk and the Booth, built by the Kronk Booth session (9 Nov 2026) from Cassidy's work on Kronk, with Tal's platform shared by permission (see `projects/kronk-booth/README.md`). It is not a copy of Kronk's code.

- Nine steps: Welcome, Home, Mates and reach, the Hub, the Booth, a set, Live, Wachuneed, Join Kronk. `#N` opens step N.
- All members, sets, posts and listings are made up. Everything lives in memory in the page: no storage, no network requests, no audio.
- Its only outbound link is "Join Kronk" → https://kronk.info/kronk/about (new tab). Kronk is invite-only (registrations off), so nothing on the card or in the tour says "sign up".
