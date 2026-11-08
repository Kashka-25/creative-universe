# Architecture

## The experience

The little guide wakes on his cloud, looks at you and beckons. When you follow him he goes through a **metamorphosis**: light gathers round him in turquoise and gold curls, weaves into a glowing cocoon that pulses twice like a heartbeat, and unfurls like the painting's cloud scrolls. His **true form**, Cassidy's painting, emerges in his place and glides into the homepage hero. That's his home.

In the hero he is the **living painting** (`src/living/`): the painting itself, very gently warped in a shader. He breathes, his head moves a little, his third eye glows, the sun breathes, the clouds drift, and now and then (or when you hover over him or tap him) he lifts the cloud in his hands towards you. Nothing is repainted, so it stays exactly Cassidy's painting. His eyes stay closed, as painted. Reduced motion, no WebGL or a load failure show the same painting, still.

The 3D layer only lives for the welcome. Returning visitors never load it: they go straight to the living painting.

## Layers

```
contract/guide-contract.json      ← names shared by Blender, web and checker
blender/                          ← source art + scripts (never served)
public/models/                    ← exported GLB + manifest.json (which model to load)
content/                          ← portfolio content (starter pack, placement, realms, about, works)
scripts/                          ← content build, GLB check / optimise / test fixture
src/
  content/        content model + generated JSON (built by scripts/build-content.mjs)
  intro/          state machine, capability detection, IntroProvider, illustrated fallback
  scene/          the 3D layer: GuideStage (canvas), Director (camera), Actor, Scenery
    guide/        GuideAnimator, contract types, the stand-in model and its clips
  portfolio/      layout, pages, cards, ornaments
  styles/         tokens, base, intro, portfolio
```

The **animation** (Blender → GLB) and the **content** (starter pack → JSON) are fully independent. Re-export the guide and nothing in the site rebuilds. Change content and the 3D is untouched.

## The story is a state machine

`src/intro/machine.ts` is a small, generic, tested finite state machine: events, guards, global transitions, timed transitions, and an injectable clock. `src/intro/introMachine.ts` holds the story:

```
boot → loading → seated → awakening → acknowledging → beckoning → gathering → chrysalis → opening → emerging → revealing → done
        │                                                  (waits for "Follow him", or 9 s)
        └→ lite (illustrated welcome) → liteFlight → revealing → done
boot → done                  returning visitor / deep link: straight to the living painting
SKIP from anywhere → revealing
```

Every clip-driven beat has a timeout, so a missing or broken clip can never trap a visitor. `beats` maps each state to its clip, camera shot, look-at strength, third-eye glow and the narration read to screen readers.

The **scene reports back** to the machine: `READY` (model drawn), `CLIP_DONE` (wake / acknowledge / rise finished), `PASSED` (he flew past the camera), `LANDED` (settled in the hero). The machine never knows about three.js. The scene never decides what comes next.

## The 3D layer

- **`GuideStage`** is a lazily loaded chunk (three.js and R3F stay out of the main bundle). It's mounted once and kept for the whole visit. After the intro it drops behind the page and only renders while the hero is on screen.
- **`Director`** frames each beat (establish, approach, portrait, lift, flyby, perch) and widens shots on portrait phones. After the intro it projects the hero's `HeroStage` element into the world, so he stays glued to the page as it scrolls.
- **`Actor`** loads the Blender GLB if `public/models/manifest.json` names one, otherwise the stand-in. It plays clips per beat, flies the flight path, and runs the landing.
- **`GuideAnimator`** wraps three's `AnimationMixer` with cross-fades and layers live behaviour on top of authored clips: look-at (head + eyes), blinking over `eyesClosed`, third-eye glow. Overlays are removed before the next frame so they never accumulate.
- **`Scenery`** paints the artwork's motifs: cloud scrolls with cyan line and spiral curls, the sun and bolt, the cloud seat, the cloud in his hands, gold motes and a spark trail.

### The stand-in is the real pipeline

`proceduralGuide.ts` builds the chimp from primitives, **to the same contract**: named bones, `eyesClosed`/`smile` morph targets, a `third_eye` material. `proceduralClips.ts` authors the blocking pass as key poses and bakes ordinary `AnimationClip`s. Everything downstream is identical for the Blender GLB, and this was verified by loading a contract-complete test GLB (`npm run test:guide-pipeline`).

## Devices and fallbacks

`capability.ts` picks the intro per device:

| Condition | Intro |
| --- | --- |
| WebGL, normal motion | full 3D |
| `prefers-reduced-motion`, data saver, < 2 GB memory, no WebGL | illustrated welcome with the original painting |
| 3D chunk fails to load, or the WebGL context is lost | falls back to the illustrated welcome (or skips, if mid-story) |

Test any of them with `?intro=full`, `?intro=lite` or `?intro=off`, and add `&debug=1` for a state panel. Phones get a lower pixel ratio. A performance monitor drops resolution if frames suffer. The intro plays once per browser session ("Replay the welcome" in the footer plays it again).

## Accessibility

Skip button and Escape at every moment. The page under the intro is `inert`. Narration goes to a live region. Focus moves into the page when the intro ends. All ornaments are `aria-hidden`. Real alt text for the painting and covers. Reduced motion is respected everywhere, including view transitions.
