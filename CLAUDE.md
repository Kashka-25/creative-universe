# Creative Universe — notes for Claude

This is **the central project** of Cassidy's ecosystem: a character-led portfolio where the 3D chimp guide (the Atlantean Gardens emblem chimp) hosts visitors and leads them into every venture. It is a front door, **never a management dashboard**: no task lists, metrics or admin views on the public site.

## Ground rules

- **Preserve, don't reinvent.** Keep the intro story, fallbacks, guide contract, companion state machine and tests working. Add new routes next to existing ones.
- **Never invent project facts.** Words about projects come from the YOUrigin starter pack (copied verbatim), the registry, or Cassidy. If something is unknown, leave it out and ask.
- **The guide is a companion, not decoration.** He goes where the visitor goes and says one short line per place, once per visit. He never blocks a click or covers content. Every animated beat has a timeout. Reduced motion, low memory or no WebGL get the illustrated guide.
- **Each project stays independent.** Never copy another project's code into this repo. The portfolio reads project information at build time and links out to the live project.
  - **Exception: built demo copies** in `public/demos/<project>/` (approved by Cassidy, 9 Nov 2026). They are built artifacts refreshed from the project's own repo (FreeTheDream from free-the-dream-map), never edited here, with example data only and no network. See [public/demos/README.md](public/demos/README.md).
- **Changes go on a branch with a PR**, and `npm test` plus `npm run build` must pass first.

## Decisions (8 Nov 2026)

The full proposal is at https://claude.ai/artifact/Bz16tnjtbRq71HYoFKsvVc (sections 8 and 9).

- **Realms:** Digital Homes, with the sub-categories Healing (IntoTheLighthouse, Empatherapy) and Worlds & Stories (Atlantean Gardens), alongside YOUrigin, YOU, CommYOUnity, Wandering and FreeTheDream · Music & Sound (Cassidy's personal music portfolio) · Books & Poetry · Art · About. Contact and Creative Journey are pages of their own.
- **Kronk** is shown as a collaboration with Tal (Cassidy has helped build it), in both Digital Homes and Music & Sound, covering its **Booth** and its **Marketplace (Wachuneed)**. Wachuneed gets a card only. Cassidy confirmed sharing permission on 9 Nov 2026.
- **Sweet Vital Nectar** stays as a card labelled Discontinued. Client work (Chantilly's Tallow, ReFocus Counselling) stays.
- **HOPEIUM is renamed IntoTheLighthouse (I.T.L).** It keeps its own project space and stays ready to join the Empatherapy ecosystem.
- **next.empatherapy leads Empatherapy.** Its destination shows a clearly labelled "vision in progress".
- **YOUrigin is the source of updates.** A planned YOUrigin feature links a Project to its destination here, keeps change notes on it, and publishes a snapshot this site reads at build time.
- **Open demos (decided 9 Nov 2026):** demos of YOU and YOUrigin are open to anyone, with no entry key. They use example data in the visitor's browser and never touch real user data.
- **Hosting:** GitHub Pages for now. Netlify once Cassidy has a domain.
- **Contact:** yourownuniverse.life@gmail.com · Instagram @_FreeTheDream_ (instagram.com/_freethedream_, confirmed by Cassidy 10 Nov 2026).

## The other projects (all in `C:\Users\cassi\Projects`)

| Folder | Repo |
| --- | --- |
| YOUrigin | Kashka-25/YOUrigin |
| YOU | Kashka-25/you-app-build |
| Wandering | Kashka-25/Wandering (private) |
| IntoTheLighthouse | Kashka-25/IntoTheLighthouse (renamed from HOPEIUM) |
| Empatherapy/next.empatherapy (leads) | Kashka-25/next.empatherapy |
| Empatherapy/empatherapy | Kashka-25/empatherapy |
| CommYOUnity | Kashka-25/CommYOUnity (private) |
| Atlantean-Gardens/site | Kashka-25/Atlantean-Gardens |
| FreeTheDream | Kashka-25/free-the-dream-map (private) |
| Kronk-Booth | Kashka-25/kronk, a fork of Kronkverse/kronk (Tal's repo) |
| TheArtOfFreeFlow | Kashka-25/the-art-of-free-flow (a free freestyle video course; shown in Music & Sound) |

Kronk Booth's notes live in [projects/kronk-booth/](projects/kronk-booth/README.md), because the code is in someone else's repo. `_Archive` holds old copies; never build from it.

## Commands

- `npm run dev` runs on port 5288.
- `npm test` runs the tests.
- `npm run build` builds the site.
- `npm run content:import` re-reads `../YOUrigin/starters/cassidy-ventures.json`.
- Blender work starts from [blender/README.md](blender/README.md).
