"""Adult Coco's open eyes, taken from Cassidy's own open-eyed sculpt, for the welcome's awakening beat.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup \
        --python blender/scripts/prep_coco_eyes.py

Run from the project folder, before build_coco_sage.py (which reads what this writes). Nothing is drawn or repainted:
the open eyes are the texture of blender/sculpt/coco-open.glb (Cassidy's open-eyed Adult Coco, never written), seen
straight from the front, cut out along their own outline and laid onto the sage at his own closed lid lines.

  1. Two orthographic front views, flat texture colour (no lighting), the same scale per pixel: the sage's eyes
     (blender/characters/coco-sage-web.blend, the stage-1 cache of meshy-cloud-monkey-sage.glb) and coco-open's.
  2. coco-open's eyes are cut out along their own outline (lash line, white, iris and the wet lower lid: everything
     that is not skin, grown from the pupil). The sage's closed lid lines are found as his painted lash lines.
  3. coco-open's eyes are scaled (one factor: the ratio of the distances between the two eyes' centres) and moved
     so each sits over the sage's own lid line, its middle EYES_UP above it: a closed lid meets low in the eye.
  4. Each eye becomes one card texture (RGBA, in an atlas of two): colour is coco-open's own; alpha is the order
     in which the eye is revealed as his lids part: ALPHA_MAX on his closed lid line, falling to ALPHA_MIN at the
     eye's outline (above the line towards the upper lid, below it towards the lower lid, column by column), 0
     outside it. The site shows the card with alphaTest = ALPHA_MAX - (ALPHA_MAX - ALPHA_MIN) * open (and not at
     all while open is 0, so he is exactly today's sage); as open grows the eye appears from his lid line
     outwards, like lids parting.

Writes
  blender/characters/coco-sage-eyes.png    the atlas (two cards side by side)
  blender/characters/coco-sage-eyes.json   where each card sits on his face (Blender metres, x and z), the scale,
                                           and the checks below
  <tempdir>/coco-eyes-*.png                the two front views and a flat preview of the open eyes on his face
"""

import json
import os
import sys
import tempfile
from collections import deque

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CHAR = os.path.join(ROOT, "blender", "characters")
SAGE_BLEND = os.path.join(CHAR, "coco-sage-web.blend")
OPEN_GLB = os.path.join(ROOT, "blender", "sculpt", "coco-open.glb")
OUT_PNG = os.path.join(CHAR, "coco-sage-eyes.png")
OUT_JSON = os.path.join(CHAR, "coco-sage-eyes.json")
TMP = tempfile.gettempdir()

with open(os.path.join(CHAR, "coco-sage.json"), encoding="utf-8") as fh:
    CFG = json.load(fh)
LM = CFG["landmarks"]

PX = 0.0002                  # metres per pixel in both front views
SAGE_BOX = (-0.036, 0.40, 0.18)       # centre x, centre z, half size (m)
OPEN_BOX = (-0.0135, 0.40, 0.17)
EYES_UP = 0.0095             # the open eye's middle sits this far above his closed lid line (m)
CARD_PX = 0.00032            # metres per texel on the cards (an eye is ~0.11 m wide: ~340 texels)
MARGIN = 0.004               # card border round the eye (m)
SKIN_DIST = 0.25             # RGB distance from skin that counts as eye (lash, white, iris)
ALPHA_MAX = 0.98             # the alpha on his lid line (the first to show); below the rest cutoff (0.99): at rest
                             # nothing of the cards shows, in any viewer
ALPHA_MIN = 0.05             # the alpha at the eye's outline (the last to show as it opens)
SMOOTH = 3                   # the reveal order is smoothed across this many texels each side (no column steps)


def log(*a):
    print("[eyes]", *a, flush=True)


def render_front(box, out):
    cx, cz, half = box
    sc = bpy.context.scene
    lo = min((o.matrix_world @ Vector(c)).y for o in sc.objects if o.type == "MESH" for c in o.bound_box)
    cam_d = bpy.data.cameras.new("eyes_cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 2 * half
    cam_d.clip_end = 100
    cam = bpy.data.objects.new("eyes_cam", cam_d)
    sc.collection.objects.link(cam)
    cam.location = (cx, lo - 2.0, cz)
    cam.rotation_euler = (np.pi / 2, 0, 0)
    sc.camera = cam
    res = int(round(2 * half / PX))
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "FLAT"
    sh.color_type = "TEXTURE"
    sh.show_shadows = sh.show_cavity = sh.show_object_outline = sh.show_specular_highlight = False
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(out)
    px = np.array(img.pixels[:], np.float32).reshape(res, res, 4)[::-1]   # row 0 at the top
    bpy.data.images.remove(img)
    log("rendered", out, res, "px")
    return px


def to_metres(box, res, col, row):
    cx, cz, half = box
    return cx - half + (np.asarray(col) + 0.5) * PX, cz + half - (np.asarray(row) + 0.5) * PX


def to_pixels(box, x, z):
    cx, cz, half = box
    return (np.asarray(x) - (cx - half)) / PX - 0.5, ((cz + half) - np.asarray(z)) / PX - 0.5


def bilinear(img, col, row):
    H, W = img.shape[:2]
    c0 = np.clip(np.floor(col).astype(int), 0, W - 2)
    r0 = np.clip(np.floor(row).astype(int), 0, H - 2)
    fc = np.clip(col - c0, 0, 1)[..., None]
    fr = np.clip(row - r0, 0, 1)[..., None]
    a = img[r0, c0] * (1 - fc) + img[r0, c0 + 1] * fc
    b = img[r0 + 1, c0] * (1 - fc) + img[r0 + 1, c0 + 1] * fc
    return a * (1 - fr) + b * fr


def flood(ok, seed):
    H, W = ok.shape
    out = np.zeros_like(ok)
    q = deque([seed])
    out[seed] = True
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and ok[yy, xx] and not out[yy, xx]:
                out[yy, xx] = True
                q.append((yy, xx))
    return out


def fill_holes(m):
    """Everything not reachable from the border through 'not m' is inside: holes closed (the highlights)."""
    outside = flood(~m, (0, 0)) | flood(~m, (m.shape[0] - 1, m.shape[1] - 1))
    return ~outside


def close(m, r):
    """Morphological closing with a square of radius r (dilate then erode), numpy only."""
    def shift_or(a, rr):
        o = a.copy()
        for dy in range(-rr, rr + 1):
            for dx in range(-rr, rr + 1):
                o |= np.roll(np.roll(a, dy, 0), dx, 1)
        return o
    d = shift_or(m, r)
    return ~shift_or(~d, r)


def open_eyes(px):
    """coco-open's two eyes: masks (everything that is not skin, grown from each pupil), holes filled."""
    rgb, a = px[..., :3], px[..., 3]
    H, W = a.shape
    skin = np.median(rgb[int(H * 0.82):int(H * 0.88), int(W * 0.42):int(W * 0.58)].reshape(-1, 3), 0)
    d = np.linalg.norm(rgb - skin, axis=2)
    ok = (d > SKIN_DIST) & (a > 0.5)
    eyes = []
    for side in (0, 1):
        # the pupil: the darkest blob in this half, round eye height
        band = np.zeros_like(ok)
        r0, r1 = int(H * 0.3), int(H * 0.75)
        c0, c1 = (0, W // 2) if side == 0 else (W // 2, W)
        band[r0:r1, c0:c1] = True
        lum = rgb.sum(2) + (~band) * 9
        seed = np.unravel_index(np.argmin(lum), lum.shape)
        m = flood(ok & band, seed)
        m = fill_holes(close(m, 3))
        eyes.append(m)
        log("open eye", side, "pixels", int(m.sum()), "skin", skin.round(3).tolist())
    return eyes, skin


def sage_lash(px, side_x):
    """The sage's closed lid line near x = side_x: his dark painted lash pixels, fitted with a quadratic z(x)."""
    rgb, a = px[..., :3], px[..., 3]
    H, W = a.shape
    cols, rows = np.meshgrid(np.arange(W), np.arange(H))
    x, z = to_metres(SAGE_BOX, W, cols, rows)
    lum = rgb.mean(2)
    dark = (lum < 0.33) & (rgb[..., 0] > rgb[..., 2]) & (a > 0.5)
    near = (np.abs(x - side_x) < 0.075) & (np.abs(z - 0.40) < 0.03)
    sel = dark & near
    xs, zs = x[sel], z[sel]
    c = np.polyfit(xs, zs, 2)
    res = zs - np.polyval(c, xs)
    keep = np.abs(res) < 0.004
    c = np.polyfit(xs[keep], zs[keep], 2)
    lo, hi = np.percentile(xs[keep], 1), np.percentile(xs[keep], 99)
    log("lash", round(side_x, 3), "span", round(lo, 4), round(hi, 4), "pixels", int(keep.sum()))
    return c, float(lo), float(hi)


def main():
    # 1. the two front views
    bpy.ops.wm.open_mainfile(filepath=SAGE_BLEND)
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name not in ("coco-sage_body",):
            o.hide_render = True
    sage = render_front(SAGE_BOX, os.path.join(TMP, "coco-eyes-sage.png"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=OPEN_GLB)
    opn = render_front(OPEN_BOX, os.path.join(TMP, "coco-eyes-open.png"))

    # 2. masks and lash lines
    masks, skin = open_eyes(opn)
    Ho, Wo = masks[0].shape
    cols, rows = np.meshgrid(np.arange(Wo), np.arange(Ho))
    ox, oz = to_metres(OPEN_BOX, Wo, cols, rows)
    cent = [(float(ox[m].mean()), float(oz[m].mean())) for m in masks]
    lashes = [sage_lash(sage, LM["eyeA"][0]), sage_lash(sage, LM["eyeB"][0])]
    lid_mid = [((lo + hi) / 2, float(np.polyval(c, (lo + hi) / 2))) for c, lo, hi in lashes]

    # 3. one scale for both eyes, from the distance between their middles
    k = (lid_mid[1][0] - lid_mid[0][0]) / (cent[1][0] - cent[0][0])
    log("open eye middles", np.round(cent, 4).tolist(), "sage lid middles", np.round(lid_mid, 4).tolist(), "scale", round(k, 4))

    cards, atlas_parts = [], []
    for i, (m, (c, lo, hi)) in enumerate(zip(masks, lashes)):
        tx, tz = lid_mid[i][0], lid_mid[i][1] + EYES_UP
        # the eye's outline on his face (metres)
        ex = tx + k * (ox[m] - cent[i][0])
        ez = tz + k * (oz[m] - cent[i][1])
        x0, x1 = ex.min() - MARGIN, ex.max() + MARGIN
        z0, z1 = ez.min() - MARGIN, ez.max() + MARGIN
        w, h = int(np.ceil((x1 - x0) / CARD_PX)), int(np.ceil((z1 - z0) / CARD_PX))
        x1, z1 = x0 + w * CARD_PX, z0 + h * CARD_PX
        cc, rr = np.meshgrid(np.arange(w), np.arange(h))
        X = x0 + (cc + 0.5) * CARD_PX                    # texel centres on his face (row 0 at the top)
        Z = z1 - (rr + 0.5) * CARD_PX
        # back to coco-open's own view (inverse of the placement), sampled
        oxs = cent[i][0] + (X - tx) / k
        ozs = cent[i][1] + (Z - tz) / k
        pc, pr = to_pixels(OPEN_BOX, oxs, ozs)
        rgb = bilinear(opn[..., :3], pc, pr)
        inside = bilinear(m.astype(np.float32)[..., None], pc, pr)[..., 0] > 0.5
        # reveal order: per column, from the lid line to the eye's outline above and below it
        lidz = np.polyval(c, X[0])                      # his lid line at each column (metres)
        tmap = np.full((h, w), np.nan, np.float64)
        for j in range(w):
            col = inside[:, j]
            if not col.any():
                continue
            rows_in = np.nonzero(col)[0]
            ztop, zbot = Z[rows_in[0], j], Z[rows_in[-1], j]
            zc = float(np.clip(lidz[j], zbot + CARD_PX, ztop - CARD_PX)) if ztop - zbot > 2 * CARD_PX else (ztop + zbot) / 2
            zz = Z[:, j]
            t = np.where(zz >= zc, (zz - zc) / max(ztop - zc, 1e-6), (zc - zz) / max(zc - zbot, 1e-6))
            tmap[:, j] = np.where(col, np.clip(t, 0, 1), np.nan)
        # smoothed across columns (inside the eye only): the reveal's edge has no steps
        acc = np.zeros((h, w))
        cnt = np.zeros((h, w))
        for dx in range(-SMOOTH, SMOOTH + 1):
            sh = np.roll(tmap, dx, 1)
            okk = ~np.isnan(sh)
            acc += np.where(okk, sh, 0)
            cnt += okk
        t_s = np.where(inside, acc / np.maximum(cnt, 1), 0)
        alpha = np.where(inside, ALPHA_MAX - (ALPHA_MAX - ALPHA_MIN) * t_s, 0.0).astype(np.float32)
        # colour outside the outline: the nearest inside colour (no dark fringe when the texture is filtered)
        filled = rgb.copy()
        known = inside.copy()
        for _ in range(12):
            acc = np.zeros_like(filled)
            cnt = np.zeros(known.shape, np.float32)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                sk = np.roll(np.roll(known, dy, 0), dx, 1)
                acc += np.roll(np.roll(filled, dy, 0), dx, 1) * sk[..., None]
                cnt += sk
            grow = (~known) & (cnt > 0)
            filled[grow] = acc[grow] / cnt[grow][:, None]
            known |= grow
        filled[~known] = skin
        atlas_parts.append(np.dstack([filled, alpha]))
        cards.append({"side": "A" if i == 0 else "B", "x0": round(x0, 6), "x1": round(x1, 6), "z0": round(z0, 6),
                      "z1": round(z1, 6), "w": w, "h": h, "lidLine": [round(float(v), 6) for v in c],
                      "lidSpan": [round(lo, 5), round(hi, 5)], "eyeWidth": round(float(ex.max() - ex.min()), 4),
                      "lidWidth": round(hi - lo, 4)})
        log("card", cards[-1])

    # 4. the atlas: two cards side by side, 2 texels apart
    H = max(p.shape[0] for p in atlas_parts)
    W = sum(p.shape[1] for p in atlas_parts) + 2
    atlas = np.zeros((H, W, 4), np.float32)
    atlas[..., :3] = skin
    u = 0
    for card, p in zip(cards, atlas_parts):
        atlas[:p.shape[0], u:u + p.shape[1]] = p
        card["u0"], card["u1"] = u / W, (u + p.shape[1]) / W
        card["v0"], card["v1"] = 1.0 - p.shape[0] / H, 1.0              # glTF/Blender v: 1 at the top row
        u += p.shape[1] + 2
    img = bpy.data.images.new("coco-sage-eyes", W, H, alpha=True)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(atlas[::-1].ravel())
    img.filepath_raw = OUT_PNG
    img.file_format = "PNG"
    img.save()
    meta = {"$comment": "Made by blender/scripts/prep_coco_eyes.py from blender/sculpt/coco-open.glb (Cassidy's open-eyed "
                        "Adult Coco). Cards in Blender metres on his face (x across, z up); atlas uv of each card; "
                        "lidLine: his closed lid line z(x) as a quadratic (numpy polyval order).",
            "scale": round(k, 5), "eyesUp": EYES_UP, "alphaMax": ALPHA_MAX, "alphaMin": ALPHA_MIN, "atlas": [W, H], "cards": cards}
    with open(OUT_JSON, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    log("wrote", OUT_PNG, W, "x", H, "and", OUT_JSON)

    # a flat preview: the open eyes laid on his face (fully open), for looking at
    prev = sage.copy()
    Hs, Ws = prev.shape[:2]
    for card, p in zip(cards, atlas_parts):
        cs, rs = np.meshgrid(np.arange(Ws), np.arange(Hs))
        X, Z = to_metres(SAGE_BOX, Ws, cs, rs)
        inside = (X >= card["x0"]) & (X < card["x1"]) & (Z >= card["z0"]) & (Z < card["z1"])
        cc = (X[inside] - card["x0"]) / CARD_PX - 0.5
        rr = (card["z1"] - Z[inside]) / CARD_PX - 0.5
        s = bilinear(p, cc, rr)
        show = s[:, 3] > 0.02
        idx = np.nonzero(inside)
        prev[idx[0][show], idx[1][show], :3] = s[show, :3]
    out = bpy.data.images.new("prev", Ws, Hs, alpha=True)
    out.pixels.foreach_set(prev[::-1].ravel())
    out.filepath_raw = os.path.join(TMP, "coco-eyes-preview.png")
    out.file_format = "PNG"
    out.save()
    log("preview", out.filepath_raw)


if __name__ == "__main__":
    main()
