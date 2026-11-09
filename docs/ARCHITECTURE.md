# Architecture

## The experience ("Coco's Awakening")

Two separate screens.

- **The invitation** (`#/invitation`): Adult Coco's Blender take. He floats gently down into view from above, seated in meditation with his eyes closed, settles under the heading "Welcome to my world", and breathes and floats there (his own 'breathe' and 'float' clips). "Come on in" (or, if the visitor waits, the take itself) makes the magic cloud glow from the cloud in his hands, grow and engulf him, and turn luminous. Then the cloud carries the visitor home: it swells to fill the screen, the home page takes its place underneath, and it clears on Adult Coco meditating in the home hero. He is the same character throughout: nothing is swapped inside the cloud.
- **Home**: Adult Coco only, the closed-eyed sage with the sun and lightning bolt, seated and breathing, with rare tiny idles and small reactions to the visitor. He is the visitor's companion on every page at every window size: in the home hero, and elsewhere in the corner, docked beside the content column on wide windows and otherwise peeking up from the bottom edge, stepping aside below it while the visitor scrolls down to read (the end of every page keeps room for him). In lite mode his still (`coco-sage-poster.webp`, if present) does the same.

First visits land on the invitation once per browser-tab session. Return visits and deep links go straight in. The footer's "Replay the welcome" plays it again. All movement is made in Blender; the site only sequences and plays clips.

## Layers

```
contract/guide-contract.json      ← names shared by Blender, web and checker
blender/                          ← source art + scripts (never served)
public/models/                    ← exported GLBs, the invitation's timeline.json, veil files
content/                          ← portfolio content (starter pack, placement, realms, about, works)
scripts/                          ← content build, GLB check / optimise / test fixture
src/
  content/        content model + generated JSON (built by scripts/build-content.mjs)
  intro/          capability detection (full / lite / off), the generic state machine
  invitation/     the invitation page: entry rules, its machine, the timeline, the 3D take, the illustrated version
  veil/           the cloud veil: controller (veil.ts), curve file (curve.ts), view (CloudVeil.tsx)
  guide/          home: GuideProvider, HomeStage (Adult Coco), docking, idle scheduler, attention
  characters/     ClipPlayer (one AnimationMixer per character) and shared three.js helpers
  living/         Cassidy's living painting (the fallback in the hero)
  scene/          SceneBoundary, the hero stage store, the guide contract (scene/guide)
  portfolio/      layout, pages, cards, ornaments
  styles/         tokens, base, intro (home layer), invitation, portfolio
```

The **animation** (Blender → GLB) and the **content** (starter pack → JSON) are independent. Re-export a model and nothing in the site rebuilds. Change content and the 3D is untouched.

## Where a visit begins

`src/invitation/entry.ts` decides before the router exists. A first visit to `/` (with storage available) is replaced in history by `#/invitation`, so Back never bounces. `?intro=full|lite` forces it, `?intro=off` skips it, and a deep link counts the welcome as seen. The invitation marks itself seen when it starts, so a reload never replays it. If the invitation's code cannot load, the visitor goes straight home.

## The invitation is a state machine

`src/intro/machine.ts` is a small, generic, tested finite state machine with an injectable (and pausable) clock. `src/invitation/invitationMachine.ts` holds the invitation:

```
boot → loading → warming → take → transforming → carrying → done
         │ (8 s, or a load failure)         ("Come on in" jumps the take to the glow)
         └→ illustrated ─"Come on in"→ done
ESCAPE from anywhere → done (home at once, no veil)
```

Beats advance from the animation clock: the stage reports a `MARKER` as the mixer passes each marker in `public/models/invitation/timeline.json`. The `after` timeouts are only a safety net, each the authored length of its beat plus a margin. `done` is final, so it can never run twice. A hidden tab pauses the clock and the timers.

`InvitationStage` (lazy, its own Canvas) loads its four files in parallel: Adult Coco's model (`coco-sage.glb`, the same file home uses), his take (`coco-invite.glb`: his skeleton and the clip 'invite' only, which binds to that model by bone name), his ride cloud (`clouds/ride-cloud.glb`, which follows his root bone: `src/characters/rideCloud.ts`) and the magic cloud (`magic-cloud.glb`). It compiles their shaders and uploads their textures while nothing is drawn, then plays the take on one clock: 'invite' (his ride in from stage left on the ride cloud, whose 'ride' clip plays on the same clock and swells into the magic cloud after the glow), then, from its last frame (which is 'breathe' frame 0, pose and velocity), the model's own 'breathe' loop with 'float' layered on it, and the cloud's 'transform' from the glow. Leaving early aborts the downloads and frees the models. The Blender side is `blender/scripts/build_coco_invite.py` (his take, then the magic cloud via `build_magic_cloud.py` and the ride cloud via `build_ride_cloud.py`); `blender/scripts/check_cloud_cover.py` checks that the cloud hides him fully while the veil covers the screen.

## The cloud veil

`CloudVeil` is mounted above the router, so it survives the change of page. At the `luminous` marker, `veil.cover()` fills the screen (a Blender-rendered arrival matte against an authored curve, or a soft radial bloom), the route changes to home underneath, and `veil.reveal()` clears it once Adult Coco is ready, or after 2.5 s at most. Every phase has a timer, cover and reveal are capped, the page beneath is inert while the cloud blocks it, and under reduced motion there is no veil. The shader and matte are prepared while the invitation warms up, and the WebGL context is released after each trip.

## Home

`GuideProvider` decides 3D or the living painting. `HomeStage` (lazy) loads only `coco-sage.glb` into a fixed transparent layer over the page's content and **under** the header, the menu and the cloud veil, with pointer-events off, so he never blocks a click. `ClipPlayer` plays 'breathe'; arriving from the invitation he plays 'settle' as the cloud clears and joins 'breathe' at its first frame. A seeded scheduler (`idle.ts`) starts drifts only on breath boundaries, a face flutter now and then, and reactions to what the visitor does (`attention.ts`: hover, focus, scroll, a tap on him). Docking uses separate enter and leave thresholds and ignores a phone's URL bar.

## Devices and fallbacks

`capability.ts` picks the mode per device:

| Condition | What plays |
| --- | --- |
| WebGL, normal motion | the 3D invitation, then Adult Coco in 3D |
| `prefers-reduced-motion`, data saver, < 2 GB memory, no WebGL | the illustrated invitation and the living painting |
| A missing or broken model, a lost WebGL context, a model that takes too long | the illustrated invitation / the living painting |

Test with `?intro=full`, `?intro=lite` or `?intro=off`.

## Accessibility

Escape goes home at once. The heading is in the page from the start for screen readers, and each beat is narrated in a live region with only what is on screen. Focus moves to the page after each change of screen. All ornaments are `aria-hidden`. Reduced motion is respected everywhere, including view transitions.
