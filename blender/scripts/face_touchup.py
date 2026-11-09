"""Touch-ups for face pictures before they're painted onto a character (numpy only, plus Blender's image I/O).

A face picture is his own face rendered face-on (open- or closed-eyed), lined up with his face by
character_prep.picture_mapping. Two touch-ups make painted moods clean:

  erase_lines   takes his painted-on smile line out of the mouth area (filled smoothly from the
                skin around it), so a different mouth can go there without the old one showing.
  paste_mouth   cuts the mouth itself out of one of Cassidy's sheets (just the mouth: lips, teeth,
                tongue, along an outline traced round the lips), scales and turns it to his face,
                colour-matches it to his skin and lays it on. Nothing around the mouth comes along,
                so a sheet drawn at three-quarters doesn't skew his face.
"""

import numpy as np

import bpy


# ── image I/O (rows top-down, RGBA floats as stored) ─────────────────────

def load(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()
    bpy.data.images.remove(img)
    return a


def save(a, path):
    h, w = a.shape[:2]
    img = bpy.data.images.new("touchup", w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(a[::-1]).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


# ── small image tools ───────────────────────────────────────────────────

def box_blur(a, r):
    """Mean over a (2r+1)² box, edges clamped."""
    pad = [(r + 1, r), (r + 1, r)] + [(0, 0)] * (a.ndim - 2)
    c = np.pad(a, pad, mode="edge").cumsum(0).cumsum(1)
    n = 2 * r + 1
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)


def grow(m, steps):
    m = m.copy()
    for _ in range(steps):
        g = m.copy()
        g[1:] |= m[:-1]
        g[:-1] |= m[1:]
        g[:, 1:] |= m[:, :-1]
        g[:, :-1] |= m[:, 1:]
        m = g
    return m


def inpaint(rgb, hole, r_guess, iters=500):
    """Fill the hole smoothly from the skin around it."""
    ys, xs = np.nonzero(hole)
    if not len(ys):
        return rgb
    y0, y1 = max(ys.min() - 4, 0), min(ys.max() + 5, rgb.shape[0])
    x0, x1 = max(xs.min() - 4, 0), min(xs.max() + 5, rgb.shape[1])
    sub = rgb[y0:y1, x0:x1].copy()
    h = hole[y0:y1, x0:x1]
    keep = (~h).astype(np.float32)[..., None]
    guess = box_blur(sub * keep, r_guess) / np.maximum(box_blur(keep, r_guess), 1e-4)
    sub[h] = guess[h]
    for _ in range(iters):
        avg = (np.roll(sub, 1, 0) + np.roll(sub, -1, 0) + np.roll(sub, 1, 1) + np.roll(sub, -1, 1)) * 0.25
        sub[h] = avg[h]
    out = rgb.copy()
    out[y0:y1, x0:x1] = sub
    return out


def bilinear(img, x, y):
    """Sample img (h, w, c) at float pixel positions (x right, y down); outside → edge."""
    h, w = img.shape[:2]
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    a, b = img[y0, x0], img[y0, x0 + 1]
    c, d = img[y0 + 1, x0], img[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def lum(rgb):
    return rgb[..., :3] @ np.array([0.3, 0.59, 0.11], dtype=np.float32)


# ── the touch-ups ───────────────────────────────────────────────────────

def erase_lines(pic, region, ppm, contrast=0.04):
    """Take thin dark painted lines (his smile line, its crease shadow) out of `region` (0..1 per pixel)."""
    rgb = pic[..., :3]
    l = lum(rgb)
    local = box_blur(l, max(3, int(0.014 * ppm)))
    dark = (local - l) > contrast
    hole = grow(dark & (region > 0.5), max(2, int(0.004 * ppm)))
    hole &= region > 0.05
    out = pic.copy()
    out[..., :3] = inpaint(rgb, hole, max(4, int(0.01 * ppm)))
    return out, hole


def inside_polygon(x, y, pts):
    """Even-odd test: is each (x, y) inside the polygon?"""
    inside = np.zeros(np.shape(x), dtype=bool)
    n = len(pts)
    for i in range(n):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % n]
        crosses = (y1 > y) != (y2 > y)
        at = x1 + (y - y1) * (x2 - x1) / ((y2 - y1) or 1e-9)
        inside ^= crosses & (x < at)
    return inside


def cut_mouth(sheet, outline, margin=6, ss=4):
    """The mouth in a sheet, cut along its outline (sheet pixels, traced round the outside of the lips).

    Returns its colours, a soft mask, the sheet's skin colour just around it, its centre and height."""
    pts = np.array(outline, dtype=np.float32)
    x0, y0 = np.floor(pts.min(0)).astype(int) - margin
    x1, y1 = np.ceil(pts.max(0)).astype(int) + margin
    patch = sheet[y0:y1, x0:x1, :3].copy()
    h, w = patch.shape[:2]
    local = [(x - x0, y - y0) for x, y in pts]
    # anti-aliased coverage: ss × ss samples per pixel
    sy, sx = np.mgrid[0:h * ss, 0:w * ss].astype(np.float32)
    cover = inside_polygon((sx + 0.5) / ss - 0.5, (sy + 0.5) / ss - 0.5, local).astype(np.float32)
    soft = cover.reshape(h, ss, w, ss).mean(axis=(1, 3))
    soft = np.clip(box_blur(soft, 1) * 1.15, 0, 1)            # a pixel of feather round the lips
    near = grow(soft > 0.01, 4) & ~grow(soft > 0.01, 1)        # a thin ring of skin just outside
    skin = np.median(patch[near], axis=0)
    centre = ((pts[:, 0].min() + pts[:, 0].max()) / 2 - x0, (pts[:, 1].min() + pts[:, 1].max()) / 2 - y0)
    height = float(pts[:, 1].max() - pts[:, 1].min())
    return patch, soft, skin, centre, height


def paste_mouth(pic, across, up, cut, metres_high, ring):
    """Lay a cut-out mouth on the picture, centred where (across, up) = (0, 0), `metres_high` tall.

    across/up: each pixel's position in his face's own axes (metres) from the mouth's centre.
    ring: pixels of his skin just around the mouth. Skin-coloured parts of the cut (the lips' edge)
    are shifted to his skin colour; the dark of the mouth, teeth and tongue keep their own colours."""
    patch, soft, skin, (cx, cy), height = cut
    s = height / metres_high                                  # sheet pixels per metre
    sx, sy = cx + across * s, cy - up * s
    inside = (sx >= 0) & (sx <= patch.shape[1] - 1) & (sy >= 0) & (sy <= patch.shape[0] - 1)
    his_skin = np.median(pic[..., :3][ring], axis=0)
    shift = his_skin - skin
    out = pic.copy()
    ys, xs = np.nonzero(inside)
    col = bilinear(patch, sx[ys, xs], sy[ys, xs])
    like_skin = np.exp(-np.sum((col - skin) ** 2, axis=-1, keepdims=True) / (2 * 0.16 ** 2))
    col = np.clip(col + shift * like_skin, 0, 1)
    m = bilinear(soft[..., None], sx[ys, xs], sy[ys, xs])
    out[ys, xs, :3] = out[ys, xs, :3] * (1 - m) + col * m
    return out, shift
