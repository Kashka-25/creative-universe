# Built demo copies

Each folder here, `public/demos/<project>/`, holds a **built copy** of a project's demo, so visitors can try it from Creative Universe. This is the one exception to "each project stays independent" (approved by Cassidy, 9 Nov 2026).

- These are built artifacts, refreshed from the project's own repo. **Never edit them here**: change the project, rebuild it, and copy the result over.
- Demos use **example data only** and make **no network requests**.
- A work points to its demo with an action like `{ "kind": "demo", "url": "demos/<project>/" }`. The build checks that the file is here (a url ending in `/` needs its `index.html`). The demo opens in a new tab.

## FreeTheDream

`freethedream/index.html` is `dist/demo.html` from free-the-dream-map (first copied from its PR #3, before that PR was merged).

To refresh it:

1. In free-the-dream-map, run `python build.py`.
2. Copy `dist/demo.html` over `public/demos/freethedream/index.html` here.

What it does:

- It stores the demo map in the visitor's browser under the localStorage key `freethedream-demo-v1`. It also sets `freethedream-tour-seen` once the visitor has seen the tour.
- Reset clears `freethedream-demo-v1` and reloads the demo.
- The people and ideas are made up.
- It makes no network requests. Its links to YOU and Kronk open only when the visitor clicks them.
- "← Back to Creative Universe" goes to `../../#/`, so the action url keeps its trailing slash: `demos/freethedream/`.
