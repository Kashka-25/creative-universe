# Likeness pass: 3D guide vs the original painting

## Blender model (8 Nov 2026)

`blender-sheet.png` shows the painting beside Blender renders of the scripted model (`npm run guide:build`): seated front, three-quarter and side, then awake, wave, walk and react. On the site he's drawn with the same toon bands and ink outline as the stand-in, so he looks flatter and more painted than in these renders.

**Matches the painting:** the palette; the ribbed beanie worn low on the forehead; the turquoise third eye just under the cuff; calm closed eyes and a long level mouth; gold hoops (a cluster on his right ear, a big hoop on his left); the coin pendant; the bib and straps; shaggy maroon fur; peach hands and feet; the seated pose.

**Still different (worth a hand-sculpt or a second pass):**

1. The face mask is larger, rounder and paler than painted. The painting's face is smaller in the head, wrapped deeper in fur, with darker edge shading.
2. The beanie crown stands taller and tidier. The painted crown slumps further to his right, with a bigger slouch hanging behind that ear.
3. The body is less of a pyramid. The painting has broader, shaggier shoulders and a wider crossed-leg base.
4. The hands hold out open palms. In the painting they clasp the cloud.
5. The fur reads as clumps; the painting's strokes are finer and longer at the silhouette.
6. About 58k triangles (budget guide: 30–40k). The GLB is 0.93 MB, well under the 6 MB limit. Trim the fur first if phones struggle.

## The code stand-in (7 Nov 2026)

Source of truth: `blender/reference/guide-reference.png`. Sheets in this folder are rendered from the live 3D model by the character studio (`npm run dev`, then open `#/studio` and press "Save sheet").

- `sheet-closed.png`: reference · front · three-quarter · side, eyes closed as painted
- `sheet-open.png`: the same, awake
- `front-closed.png`, `three-quarter-closed.png`, `side-closed.png`: single views at full size

## Now matching the painting

- Closed eyes drawn as calm lash lines under arched brow creases, relaxed expression
- Turquoise almond third eye, centred on the forehead under the cuff
- Long, level mouth over a tan lower lip; flat nose with two nostrils; nose-bridge wrinkles and cheek folds
- Dark reddish-brown shaggy fur in layered strands (maroon base, darker roots, red highlights), mane framing the face, beard under the chin
- Burnt-orange knitted beanie: ribbed cuff across the forehead, slouchy crown leaning to his right, slouch hanging behind his right ear
- Big peach ears with gold hoops (a cluster on his right lobe, a large hoop on his left)
- Corduroy dungarees: bib, thin straps over the shoulders; gold coin pendant on a fine chain
- Compact seated posture, hands meeting at the lap, big peach feet with toes, soles towards the viewer
- Palette sampled from the painting

## Remaining differences

1. **Face shape:** the 3D face is rounder and smoother. The painting's face is broader across the cheeks, with stronger edge shading and a heavier muzzle and lower lip.
2. **Face detail:** creases are painted on the face texture, so they soften at small sizes and lack the painting's brush character.
3. **Awake expression:** the brow arches that read serene over closed eyes read slightly stern when open. This needs softer open-eye brows (an expression shape key in the animation pass).
4. **Beanie folds:** the painted crown is crumpled with clear fold creases. Ours is a smoother dome with painted fold strokes, and its right-side slouch is smaller than painted.
5. **Fur silhouette:** strand tips are faceted and a little spiky at the edges. The painting's strokes are finer, longer and wavier.
6. **Base width:** the painting's crossed-leg base is broader and lower, a true pyramid. Ours stands a little taller and more upright.
7. **Lap colour:** slightly more orange shows between the legs than in the painting, where hands and the cloud hide most of it.
8. **Hands:** the painting's hands are long-fingered and clasp the cloud. Ours are simplified mittens.
9. **Colour under light:** toon lighting pushes the face a touch more orange than the painting's peach.

Most of 1, 2, 4, 5 and 8 are limits of building in code. They're exactly what the Blender model should solve: a sculpted face and hands, fur cards, cloth folds. These views give it calibrated proportions to match.
