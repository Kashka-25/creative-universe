"""Split Cassidy's painting into the layers of the living painting on the homepage.

    blender --background --factory-startup --python blender/scripts/living_layers.py

Writes public/art/living/:
  figure.webp   the chimp with his clouds (everything except the sun and bolt)
  sky.webp      the sun and the bolt, behind him
  mask.webp     red = his cloud swirls (so they can drift on their own)
  layers.json   the crop, and where his head, chest and hands are (0..1, from the top left)

Nothing is repainted: the homepage only warps these layers very slightly
(breathing, a small head tilt, the cloud lifting in his hands), so the
painting stays exactly Cassidy's.
"""

import json
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guide_common import project_root  # noqa: E402

ROOT = project_root()
OUT = os.path.join(ROOT, "public", "art", "living")
WIDTH = 1000  # web width of each layer

# Landmarks on blender/reference/guide-reference.png (2480 x 3508 px, from the top left).
# centre (x, y) and radii (rx, ry) of the parts that move.
LANDMARKS = {
    "thirdEye": [1252, 1022],
    "neck": [1250, 1470],                              # the head tilts about this point
    "head": {"c": [1250, 1060], "r": [560, 470]},      # head, beanie and ears
    "chest": {"c": [1250, 1800], "r": [560, 360]},     # rises and widens as he breathes
    "hands": {"c": [1265, 1985], "r": [340, 300]},     # his hands and the cloud he holds
    "sun": [1456, 824],
}

img = bpy.data.images.load(os.path.join(ROOT, "blender", "reference", "guide-reference.png"))
W, H = img.size
px = np.empty(W * H * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)[::-1].copy()  # row 0 = top
r, g, b, a = px[..., 0], px[..., 1], px[..., 2], px[..., 3]


def shift_or(m, n):
    out = m.copy()
    for _ in range(n):
        o = out.copy()
        o[1:] |= out[:-1]
        o[:-1] |= out[1:]
        o[:, 1:] |= out[:, :-1]
        o[:, :-1] |= out[:, 1:]
        out = o
    return out


def erode(m, n):
    return ~shift_or(~m, n)


def blur(f, n):
    for _ in range(n):
        f = (f + np.roll(f, 1, 0) + np.roll(f, -1, 0) + np.roll(f, 1, 1) + np.roll(f, -1, 1)) / 5
    return f


opaque = a > 0.02
yellow = (r > 0.78) & (g > 0.66) & (b < 0.55) & (r - b > 0.35) & opaque
# Thin gold strokes (ear hoops, the chain) are his jewellery, not the sky: an opening removes them.
sky = shift_or(erode(yellow, 7), 10) & yellow
# The pendant is a solid gold coin on his chest: keep it with him.
ys, xs = np.mgrid[0:H, 0:W]
sky &= ~(((xs - 1252) ** 2 + (ys - 1700) ** 2) < 110 ** 2)
# Anti-aliased edges of the sun and bolt go with the sky too.
sky_soft = np.clip(blur(sky.astype(np.float32), 2) * 1.6, 0, 1) * (yellow | shift_or(sky, 2))

cyan = (b > r + 0.18) & (g > r + 0.12) & opaque
cloud = np.clip(blur(shift_or(cyan, 3).astype(np.float32), 6), 0, 1)

fig = px.copy()
fig[..., 3] = a * (1 - sky_soft)
skyl = px.copy()
skyl[..., 3] = a * sky_soft

# Crop to everything painted, with a little air.
ys_, xs_ = np.nonzero(a > 0.05)
pad = 40
x0, x1 = max(0, xs_.min() - pad), min(W, xs_.max() + pad)
y0, y1 = max(0, ys_.min() - pad), min(H, ys_.max() + pad)
cw, ch = x1 - x0, y1 - y0
out_h = round(WIDTH * ch / cw)
os.makedirs(OUT, exist_ok=True)


def save(arr, name):
    crop = arr[y0:y1, x0:x1][::-1].copy()  # back to Blender's bottom-up rows
    im = bpy.data.images.new(name, cw, ch, alpha=True)
    im.pixels.foreach_set(crop.ravel())
    im.scale(WIDTH, out_h)
    im.filepath_raw = os.path.join(OUT, name)
    im.file_format = "WEBP"
    bpy.context.scene.render.image_settings.quality = 88
    im.save()
    print("wrote", name, WIDTH, out_h)


save(fig, "figure.webp")
save(skyl, "sky.webp")
mask = np.zeros_like(px)
mask[..., 0] = cloud
mask[..., 3] = 1
save(mask, "mask.webp")


def norm(p):
    return [round((p[0] - x0) / cw, 4), round((p[1] - y0) / ch, 4)]


def norm_r(rr):
    return [round(rr[0] / cw, 4), round(rr[1] / ch, 4)]


layout = {
    "$comment": "Made by blender/scripts/living_layers.py from blender/reference/guide-reference.png. Positions are 0..1 from the top left.",
    "size": [WIDTH, out_h],
    "aspect": round(cw / ch, 5),
    "thirdEye": norm(LANDMARKS["thirdEye"]),
    "neck": norm(LANDMARKS["neck"]),
    "sun": norm(LANDMARKS["sun"]),
}
for k in ("head", "chest", "hands"):
    layout[k] = {"c": norm(LANDMARKS[k]["c"]), "r": norm_r(LANDMARKS[k]["r"])}
with open(os.path.join(OUT, "layers.json"), "w", encoding="utf-8") as f:
    json.dump(layout, f, indent=2)
print("crop", x0, y0, x1, y1, json.dumps(layout))
