# Cassidy's Creative Universe

**The central project:** the front door to everything Cassidy makes. Every venture is its own world with its own repo; this site connects them and lets visitors discover and enter them. Lives at `C:\Users\cassi\Projects\CreativeUniverse`, next to the other projects. Plan: [docs/ROADMAP.md](docs/ROADMAP.md).

An artist portfolio introduced by Cassidy's guide, the meditating chimp from the Atlantean Gardens emblem. On a first visit Adult Coco floats gently down into view, meditating, and welcomes you; the magic cloud glows from the cloud in his hands, wraps around him and carries you home, where he sits meditating and keeps you company as you explore.

Built with Vite, React 19, Three.js (React Three Fiber) and a Blender → glTF pipeline.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5288. Useful switches: `?intro=full`, `?intro=lite`, `?intro=off`.

| Command | What it does |
| --- | --- |
| `npm run build` | content + typecheck + production build into `dist/` (deployable to any static host) |
| `npm test` | invitation, veil, guide, state machine, content pipeline and GLB contract tests |
| `npm run content` | rebuild site content from `content/` |
| `npm run content:import` | re-copy the starter pack from YOUrigin, then rebuild |
| `npm run optimize:guide` | compress an exported guide GLB |
| `npm run check:guide -- --register` | validate the GLB against the contract and switch the site to it |
| `npm run test:guide-pipeline` | self-test of the GLB path without Blender |

## Where things are

- **The guide in Blender:** [blender/README.md](blender/README.md). Modelling, face shape keys, rig, the six story clips, export.
- **How it fits together:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Adding work and editing realms:** [docs/CONTENT.md](docs/CONTENT.md).
- **The contract between Blender and the site:** [contract/guide-contract.json](contract/guide-contract.json).

## Status

- The 3D guide on the site today is a **stand-in** built from primitives in your painting's colours. It's rigged and animated to the same contract as the Blender model, so exporting the real one is a drop-in swap.
- Blender is being installed (8 Nov 2026); the Blender scripts haven't been run yet. The web side of the GLB path has been verified with a generated test model.
- Music & Sound, Books & Literature and Art & Experiments are empty until works are added. Contact: email and Instagram are set in `content/about.json`.
- `npm run content:import` reads the starter pack from the sibling folder `../YOUrigin`.
