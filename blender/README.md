# The guide in Blender

This folder holds the **source** of the 3D guide. Nothing here is served to visitors. The website only ever loads the exported file in `public/models/`.

```
blender/
  guide.blend               ← you create this (step 1). Keep it here.
  reference/
    guide-reference.png     Cassidy's painting, transparent, 2480×3508 (the source of truth)
    guide-reference-wordmark.png   the same with the Atlantean Garden wordmark
  scripts/
    setup_guide_scene.py    builds the rig + empty clips to the contract (safe to re-run)
    export_guide.py         exports public/models/guide.glb with the right settings
    guide_common.py         shared: finds the project, reads the contract
```

Every name that matters (bones, shape keys, materials, clips) comes from **`contract/guide-contract.json`**. The scripts, the website and the checker all read that file, so names can't drift apart.

## 1. Set up (5 minutes)

1. Install **Blender 4.2 LTS or newer**.
2. File › New › General. Delete the default cube. **Save As `blender/guide.blend`.**
3. Scripting tab › Open › `blender/scripts/setup_guide_scene.py` › Run Script.

You now have:

- **Reference** collection: the painting standing behind the origin, visible in Front view (numpad 1).
- **Guide** collection: `GuideRig`, an armature whose deform bones carry the contract names (`hips`, `head`, `eye_L`, `fingers_R`…). It has the same proportions as the website's stand-in (seated head ≈ 0.9 m), so the website's camera framing fits without changes.
- **Actions** `seated_idle`, `wake`, `acknowledge`, `beckon`, `rise`, `fly` (plus optional `perch_idle`, `land`). Each has its planned length, and its beat is noted in the action's custom properties and in the `GUIDE_NOTES` text block.

Blender is +Z up and **the character faces −Y** (towards you in Front view). The exporter converts this to what the web expects.

## 2. Model him: keep the painting, don't redesign him

Work in the **Guide** collection, over the reference. What makes him *him*:

| Feature | Notes |
| --- | --- |
| Shaggy maroon fur `#642521` | Lighter strands `#8a3529`, darker roots `#4a1a17`. Sculpt fur as clumps in the mesh, with a painted texture and normal map. Hair particles and curves **don't export to glTF**. |
| Peach face, ears, hands, feet `#ffa36d` | Shadow tone `#c67348`. A heart-shaped chimp face, broad muzzle, flat nose, soft brow ridge, deep smile lines. |
| Orange-red beanie `#df4612` | Slouchy, worn tipped back and to his right, ribbed cuff. |
| Dungarees, same red-orange | A bib with two straps over bare fur. |
| Turquoise third eye | An almond shape on the forehead, just under the beanie cuff. Material **`third_eye`** with Emission strength > 0 (the website pulses it as he wakes). |
| Gold hoops and pendant | Several hoops in each ear, a coin pendant on a fine chain. Material **`gold_jewellery`**. |
| Cross-legged, cradling a cloud | Big expressive feet with toes. |

**Not part of the model:** the cloud seat, the cloud he holds, the sun and the lightning bolt. The website paints those in the artwork's style, so the scenery stays editable without re-exporting him.

**Budget for phones:** about 30–40k triangles, textures 2048 px or less, total GLB under 6 MB (the checker enforces this). Use Principled BSDF with Base Color, Roughness, Normal and Emission only. Complex node trees don't survive export.

## 3. Face controls (shape keys)

On the face mesh, create these shape keys with **exactly** these names:

| Shape key | Required | From the Emblem Evolutions sheet |
| --- | --- | --- |
| `eyesClosed` | **yes** | Zen Mode (peaceful closed eyes) |
| `smile` | optional | Chill Vibes |
| `grin` | optional | Happy High (big open smile) |
| `squint` | optional | Happy High, Focused Flow |
| `mouthOpen` | optional | Sleepy Cloud (yawn) |
| `browsUp` | optional | surprise or welcome |

Don't animate blinks: the website adds natural blinking on top of `eyesClosed`. Eye direction is the `eye_L` / `eye_R` bones. The website also turns his head and eyes towards the visitor's pointer, on top of your animation.

## 4. Rig

1. Select the mesh(es), then GuideRig › Ctrl+P › **With Automatic Weights**. Fix weights around the fingers, beanie and dungaree straps.
2. Add any controls you like (IK legs, a hand IK for the beckon, a look target). Name them `CTRL_*` / `MCH_*` and **untick Deform**: only deform bones export, so the contract bones stay clean.
3. Don't rename contract bones. Blender's mirror tools like `.L`, but **three.js strips dots**, so keep `_L` / `_R`. (The checker catches this.)

## 5. Animate the story

Each action is one beat. Clips play **in place**: the website flies him along his path and lands him in the portfolio, so don't move `root` across the scene.

| Action | Length | Loop | The beat |
| --- | --- | --- | --- |
| `seated_idle` | 4.0 s | ✓ | On his cloud, eyes closed, slow breath. Cradling the cloud. |
| `wake` | 2.6 s | | Eyelids flutter and open, head lifts, shoulders settle. A hint of a smile. |
| `acknowledge` | 1.8 s | | He *sees you*: small head tilt, warm nod, smile grows. |
| `beckon` | 2.0 s | ✓ | Right hand rises, palm up, fingers curl "follow me". First and last frame identical. |
| `rise` | 1.7 s | | Anticipation (lean in, hands push down) → spring → lift into flight pose. |
| `fly` | 1.2 s | ✓ | Body horizontal heading towards +Z (towards camera), right arm leading, legs trailing, gentle bob. |
| `perch_idle` | 5.0 s | ✓ | *Optional.* Awake on his cloud in the portfolio hero, content, small weight shifts. |
| `land` | 1.6 s | | *Optional.* Flight pose → settling back into seated. (If absent, `rise` plays backwards.) |

To feel fluid rather than robotic: anticipation before big moves, overlap (head and hands trail the body by a few frames), arcs not straight lines, and hold the emotional moments (the first look at the camera) a beat longer. The camera timing assumes the lengths above. Longer is fine, but check it in the browser.

To work on an action: Dope Sheet › Action Editor › pick it from the list.

## 6. Export → check → see it on the site

In Blender, run `blender/scripts/export_guide.py` (Scripting tab), or headless:

```bash
blender blender/guide.blend --background --python blender/scripts/export_guide.py
```

Then in the project folder:

```bash
npm run optimize:guide
```

```bash
npm run check:guide -- --register
```

`optimize:guide` compresses the file (meshopt, which three.js decodes natively). `check:guide` compares it with the contract and lists any problems. With `--register` it switches the site from the stand-in to your model. Reload the site and he's there. To go back to the stand-in: `npm run check:guide -- --unregister`.

> **Pipeline self-test without Blender:** `npm run test:guide-pipeline` builds a crude contract-complete GLB, optimises it and checks it. It was used to verify this whole path end to end.

## Coco's Awakening: the invitation take

The invitation page (`#/invitation`) is hosted by **Adult Coco** (`coco-sage`). Run these from the project folder, after `build_coco_sage.py` has made `blender/characters/coco-sage.blend`:

```bash
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python blender/scripts/build_coco_invite.py
"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b blender/characters/invitation.blend --python blender/scripts/check_cloud_cover.py
```

- `build_coco_invite.py` copies `coco-sage.blend` to `invitation.blend` (the original is never written), keys his ride in from stage left (the visitor's left) as the clip `invite` on his own rig (60 fps; it ends on `breathe` frame 0, pose and velocity), and exports only his skeleton and that clip to `public/models/invitation/coco-invite.glb`. The site plays it on `coco-sage.glb` and then hands over to that model's own `breathe` and `float`. It writes the markers `floatIn`, `arrive`, `welcome` (the heading) and `glow` to `timeline.json`, then builds the magic cloud with `build_magic_cloud.py` (`magic-cloud.glb`, the markers after the glow, `coverFrame` and the `cloud` block) and the ride cloud with `build_ride_cloud.py` (`public/models/clouds/ride-cloud.glb`, `clips.ride` in `timeline.json`).
- `build_ride_cloud.py` builds the swirl cloud he rides on from the magic cloud's own curls, wisp and colours. Its clips: `ride` (the welcome, on the master timeline: it trails and streams while he travels, idles, then from `glow` swells into the base of the magic cloud and thins away inside it before he is hidden), `rest` (a seamless 20 s idle loop under him on pages) and `flyin` (2 s: the path of his flight to a new space on a page, as `ctl_progress` / `ctl_lift` / `ctl_bank`, and a soft shimmer as he lands; its last frame is `rest` frame 0). The site makes it follow his root bone, so his own motion carries it.
- `check_cloud_cover.py` renders coverage masks with the site's camera and prints the frames on which no pixel of him shows. `HIDDEN` in `build_magic_cloud.py` records that span.
