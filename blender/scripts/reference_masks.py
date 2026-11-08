"""Separate the chimp from the clouds, sun and bolt in Cassidy's painting.

    blender --background --factory-startup --python blender/scripts/reference_masks.py

Writes blender/reference/guide-reference-chimp.png: the painting with only the
chimp opaque (clouds, sun, bolt and background transparent, edges feathered).
The paint step projects this onto the model, so nothing but the chimp lands on him.
Also prints landmark boxes used to line the model up with the painting.
"""

import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guide_common import project_root  # noqa: E402

ROOT = project_root()
src = os.path.join(ROOT, "blender", "reference", "guide-reference.png")
img = bpy.data.images.load(src)
W, H = img.size
px = np.empty(W * H * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)  # row 0 = bottom
r, g, b, a = px[..., 0], px[..., 1], px[..., 2], px[..., 3]

# The painting's palettes (sRGB 0..1). Cloud: pale cyan fill, saturated cyan line.
cyan = (b > r + 0.18) & (g > r + 0.12)
# Sun, bolt (and the gold jewellery, which the model has as geometry).
yellow = (r > 0.78) & (g > 0.72) & (b < 0.5) & (r - b > 0.4)
chimp = (a > 0.6) & ~cyan & ~yellow


def dilate(m, n):
    out = m.copy()
    for _ in range(n):
        o = out.copy()
        o[1:, :] |= out[:-1, :]
        o[:-1, :] |= out[1:, :]
        o[:, 1:] |= out[:, :-1]
        o[:, :-1] |= out[:, 1:]
        out = o
    return out


def blur(m, n):
    f = m.astype(np.float32)
    for _ in range(n):
        f = (f + np.roll(f, 1, 0) + np.roll(f, -1, 0) + np.roll(f, 1, 1) + np.roll(f, -1, 1)) / 5
    return f


# Keep well clear of cloud and sun edges (their antialiased fringes are tinted).
bad = dilate(cyan | yellow, 6) | ~dilate(a > 0.6, 0)
keep = chimp & ~bad
alpha = np.minimum(blur(keep, 4), keep.astype(np.float32))

out = px.copy()
out[..., 3] = alpha
res = bpy.data.images.new("chimp_only", W, H, alpha=True)
res.pixels.foreach_set(out.ravel())
res.filepath_raw = os.path.join(ROOT, "blender", "reference", "guide-reference-chimp.png")
res.file_format = "PNG"
res.save()


def box(m, name):
    ys, xs = np.nonzero(m)
    if not len(xs):
        print(name, "none")
        return
    # report in top-down pixel rows, like an image viewer
    print(f"{name}: x {xs.min()}..{xs.max()}  y {H - 1 - ys.max()}..{H - 1 - ys.min()}  ({len(xs)} px)")


box(chimp, "chimp")
peach = chimp & (r > 0.85) & (g > 0.48) & (g < 0.78) & (b > 0.28) & (b < 0.62)
box(peach, "peach (face, ears, hands, feet)")
orange = chimp & (r > 0.7) & (g < 0.42) & (b < 0.2)
box(orange, "orange (beanie, dungarees)")
print("saved", res.filepath_raw, W, H)
