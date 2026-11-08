"""Build the guide character in Blender from Cassidy's painting.

    blender --background --python blender/scripts/build_guide.py
    (or open blender/guide.blend, Scripting tab > Open > this file > Run Script)

What it makes, all in the "Guide" collection of blender/guide.blend:

  GuideRig     the contract's bones, in the same rest pose as the website's
               stand-in (src/scene/guide/rest.ts). Every bone's axes are the
               character's own (+X his left, +Y up, +Z towards you), so the
               site's look-at and gestures work on him unchanged.
  guide_head   face, skull, ears, eyelids, mouth and teeth, with the shape keys
               eyesClosed, smile, grin, squint, mouthOpen and browsUp.
  guide_body   torso, dungarees, arms, hands, legs, feet, beanie, jewellery, eyes.
  guide_fur    shaggy fur clumps over the head and body.
  Actions      every clip in blender/clips.json (baked from the site's
               authored animation by `npm run guide:clips`), each with the
               face shape keys in the same action.

It rebuilds the character from scratch each time it runs. Anything added by
hand to these objects is replaced, so hand-sculpt on a copy or after the
build, not before re-running it.
"""

import json
import math
import os
import random
import sys

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector


def _scripts_dir():
    cands = []
    if "__file__" in globals():
        cands.append(os.path.dirname(os.path.abspath(__file__)))
    for t in bpy.data.texts:
        if t.filepath:
            cands.append(os.path.dirname(bpy.path.abspath(t.filepath)))
    cands.append(os.path.join(os.getcwd(), "blender", "scripts"))
    for c in cands:
        if os.path.isfile(os.path.join(c, "guide_common.py")):
            return c
    raise RuntimeError("Keep guide_common.py next to this script (blender/scripts/).")


sys.path.insert(0, _scripts_dir())
from guide_common import load_contract, project_root  # noqa: E402

ROOT = project_root()
C = load_contract()
FPS = int(C["asset"]["fps"])
with open(os.path.join(ROOT, "blender", "clips.json"), encoding="utf-8") as f:
    CLIPS = json.load(f)
REST = CLIPS["rest"]
BONES = list(C["bones"]["required"]) + [b for b in C["bones"]["optional"] if b in ("beanie",)]
PARENTS = C["bones"]["parents"]
rng = random.Random(7)

# ── maths helpers (web axes: +X his left, +Y up, +Z towards camera) ──────────
V = Vector


def to_blender(p):
    return V((p[0], -p[2], p[1]))


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def bump(x, y, cx, cy, sx, sy):
    return math.exp(-((x - cx) ** 2) / sx - ((y - cy) ** 2) / sy)


def lerp(a, b, t):
    return a + (b - a) * t


def world(bone):
    p = V((0, 0, 0))
    b = bone
    while b:
        p += V(REST.get(b, (0, 0, 0)))
        b = PARENTS.get(b)
    return p


def euler(x, y, z):
    """three.js Euler XYZ (radians) as a rotation matrix."""
    return (Matrix.Rotation(x, 3, "X") @ Matrix.Rotation(y, 3, "Y") @ Matrix.Rotation(z, 3, "Z"))


def hexcol(h, a=1.0):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [a]


def srgb_to_linear(c):
    return [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c[:3]] + [c[3]]


PALETTE = {
    "fur": "#5c211d", "furLight": "#7a2f27", "furDark": "#3f1613", "furStreak": "#94402f",
    "face": "#ffa36d", "faceShade": "#c67348", "faceEdge": "#e2885a", "mouth": "#6e3020", "lash": "#5a2418",
    "hat": "#e04a12", "hatShade": "#b8330f", "cuff": "#ef5f1c", "overalls": "#e0561c", "overallsLine": "#b23d0e",
    "gold": "#fdd63a", "eyeWhite": "#fff4e4", "iris": "#3b1d12", "thirdEye": "#bdf3ee", "thirdIris": "#5ec7b7",
}

# ── mesh builder ────────────────────────────────────────────────────────────


class Builder:
    """Collects vertices (web axes), faces, per-corner UVs, materials, bone weights and shape-key offsets."""

    def __init__(self, name):
        self.name = name
        self.verts = []
        self.faces = []
        self.face_uvs = []
        self.face_mat = []
        self.weights = []
        self.keys = {}
        self.mats = []

    def mat(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def add(self, verts, faces, uvs, mat, weight, keys=None):
        """weight: dict or callable(p) -> dict. keys: {name: [positions aligned with verts]}."""
        base = len(self.verts)
        per_face = [self.mat(m) for m in mat] if isinstance(mat, list) else [self.mat(mat)] * len(faces)
        for p in verts:
            self.verts.append(V(p))
            w = weight(p) if callable(weight) else weight
            self.weights.append(w)
        for f, uv, mi in zip(faces, uvs, per_face):
            self.faces.append(tuple(base + i for i in f))
            self.face_uvs.append(uv)
            self.face_mat.append(mi)
        for k, pos in (keys or {}).items():
            d = self.keys.setdefault(k, {})
            for i, p in enumerate(pos):
                if (V(p) - V(verts[i])).length > 1e-7:
                    d[base + i] = V(p)
        return base


def surface(fn, nu, nv, wrap=True, pole0=False, pole1=False):
    """Parametric surface fn(u, v) -> point, u around, v along. Returns verts, faces, per-corner uvs."""
    verts, idx = [], {}
    cols = nu if wrap else nu + 1
    for i in range(nv + 1):
        v = i / nv
        if (i == 0 and pole0) or (i == nv and pole1):
            idx[(i, 0)] = len(verts)
            verts.append(fn(0.5, v))
            continue
        for j in range(cols):
            idx[(i, j)] = len(verts)
            verts.append(fn(j / nu, v))
    faces, uvs = [], []
    for i in range(nv):
        for j in range(nu):
            j1 = (j + 1) % nu if wrap else j + 1
            u0, u1, v0, v1 = j / nu, (j + 1) / nu, i / nv, (i + 1) / nv
            a = idx[(i, 0)] if (i == 0 and pole0) else idx[(i, j)]
            b = idx[(i, 0)] if (i == 0 and pole0) else idx[(i, j1)]
            c = idx[(i + 1, 0)] if (i + 1 == nv and pole1) else idx[(i + 1, j1)]
            d = idx[(i + 1, 0)] if (i + 1 == nv and pole1) else idx[(i + 1, j)]
            if i == 0 and pole0:
                faces.append((a, c, d))
                uvs.append([((u0 + u1) / 2, v0), (u1, v1), (u0, v1)])
            elif i + 1 == nv and pole1:
                faces.append((a, b, c))
                uvs.append([(u0, v0), (u1, v0), ((u0 + u1) / 2, v1)])
            else:
                faces.append((a, b, c, d))
                uvs.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    return verts, faces, uvs


def flip(faces, uvs):
    """Reverse winding (for surfaces whose parameters run the other way round)."""
    return [tuple(reversed(f)) for f in faces], [list(reversed(u)) for u in uvs]


def unit_sphere(u, v):
    """u around (0.5 = front, +Z), v from bottom (0) to top (1)."""
    th = math.pi * (1 - v)
    ph = 2 * math.pi * u - math.pi
    return V((math.sin(th) * math.sin(ph), math.cos(th), math.sin(th) * math.cos(ph)))


def ellipsoid(center, radii, nu=32, nv=20, deform=None, rot=None, v0=0.0, v1=1.0):
    rot = rot or Matrix.Identity(3)
    c = V(center)

    def fn(u, v):
        n = unit_sphere(u, lerp(v0, v1, v))
        d = deform(n) if deform else (0, 0, 0)
        q = V(((n.x + d[0]) * radii[0], (n.y + d[1]) * radii[1], (n.z + d[2]) * radii[2]))
        return c + rot @ q

    return surface(fn, nu, nv, pole0=v0 <= 0.0, pole1=v1 >= 1.0)


def frame_for(t):
    t = t.normalized()
    a = V((0, 0, 1)) if abs(t.z) < 0.9 else V((1, 0, 0))
    n = t.cross(a).normalized()
    b = t.cross(n).normalized()
    return n, b


def tube(points, radii, nu=14, caps=True, squash=1.0, nv=None):
    """A smooth tube through points (Catmull-Rom), radius per point, rounded caps."""
    pts = [V(p) for p in points]
    rs = list(radii)
    nv = nv or max(6, 4 * (len(pts) - 1))

    def cr(i, t):
        p0 = pts[max(0, i - 1)]
        p1, p2 = pts[i], pts[min(len(pts) - 1, i + 1)]
        p3 = pts[min(len(pts) - 1, i + 2)]
        t2, t3 = t * t, t * t * t
        return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)

    samples, rads = [], []
    seg = len(pts) - 1
    for k in range(nv + 1):
        s = k / nv * seg
        i = min(seg - 1, int(s))
        t = s - i
        samples.append(cr(i, t))
        rads.append(lerp(rs[i], rs[i + 1], t))
    tangents = []
    for k in range(len(samples)):
        a = samples[max(0, k - 1)]
        b = samples[min(len(samples) - 1, k + 1)]
        tangents.append((b - a).normalized())
    n, b = frame_for(tangents[0])
    frames = []
    for k, t in enumerate(tangents):
        if k:
            n = (n - t * n.dot(t)).normalized()
            b = t.cross(n)
        frames.append((n, b))
    rows = []
    if caps:
        t0 = tangents[0]
        for f in (0.98, 0.8, 0.45):
            rows.append((samples[0] - t0 * rads[0] * math.sqrt(1 - f * f) * 0.9, rads[0] * f, frames[0]))
    for k in range(len(samples)):
        rows.append((samples[k], rads[k], frames[k]))
    if caps:
        t1 = tangents[-1]
        for f in (0.45, 0.8, 0.98):
            rows.append((samples[-1] + t1 * rads[-1] * math.sqrt(1 - f * f) * 0.9, rads[-1] * f, frames[-1]))
    rows_total = len(rows) + (2 if caps else 0) - 1

    def fn(u, v):
        if caps and v <= 0:
            return samples[0] - tangents[0] * rads[0] * 0.92
        if caps and v >= 1:
            return samples[-1] + tangents[-1] * rads[-1] * 0.92
        k = round(v * rows_total) - (1 if caps else 0)
        k = max(0, min(len(rows) - 1, k))
        c, r, (nn, bb) = rows[k]
        a = 2 * math.pi * u
        return c + nn * (math.cos(a) * r) + bb * (math.sin(a) * r * squash)

    return surface(fn, nu, rows_total, pole0=caps, pole1=caps)


def torus(center, R, r, rot, nu=28, nv=8, arc=2 * math.pi):
    c = V(center)

    def fn(u, v):
        a = arc * u
        b = 2 * math.pi * v
        q = V(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
        return c + rot @ q

    vs, fs, uvs = surface(fn, nu if arc < 2 * math.pi else nu, nv, wrap=True)
    return vs, fs, uvs


# ── the character's measurements ────────────────────────────────────────────
H = world("head")
FACE_C = H + V((0, 0.165, 0.07))
FACE_R = (0.24, 0.235, 0.125)
BEANIE = world("beanie")


def face_deform(n):
    f = max(0.0, n.z)
    x, y = n.x, n.y
    dz = f * (
        1.2 * bump(x, y, 0, -0.45, 0.4, 0.12)                # broad chimp muzzle
        + 0.34 * bump(0, y, 0, 0.22, 1, 0.01) * (1 - x * x)   # brow ridge
        - 0.3 * bump(abs(x), y, 0.42, 0.04, 0.025, 0.016)     # eye sockets
        + 0.18 * bump(x, y, 0, -0.14, 0.01, 0.006)            # flat nose
        + 0.55 * bump(x, y, 0, -0.66, 0.24, 0.03)             # big lower lip
        - 0.25 * smoothstep(0.55, 0.95, abs(x))               # sides tuck into the mane
    )
    dx = -x * (0.1 * smoothstep(-0.25, -0.95, y) + 0.12 * smoothstep(0.35, 0.95, y)) + x * 0.08 * bump(0, y, 0, 0.0, 1, 0.08)
    dy = -0.12 * max(0.0, y) ** 2.5
    return (dx, dy, dz)


def on_face(x, y, out=0.0, deform=face_deform):
    n = V((x, y, math.sqrt(max(0.0, 1 - x * x - y * y))))
    d = deform(n)
    p = V(((n.x + d[0]) * FACE_R[0], (n.y + d[1]) * FACE_R[1], (n.z + d[2]) * FACE_R[2])) + FACE_C
    nn = V((x / FACE_R[0], y / FACE_R[1], n.z / FACE_R[2])).normalized()
    return p + nn * out, nn


SKULL = ((0, 0.15, -0.05), (0.3, 0.285, 0.19))
CHEEK_L = ((0.23, 0.04, -0.02), (0.13, 0.14, 0.12))
CHEEK_R = ((-0.23, 0.04, -0.02), (0.13, 0.14, 0.12))
BEARD = ((0, -0.08, 0.02), (0.18, 0.1, 0.11))
EYE = {s: on_face(0.42 * (1 if s == "L" else -1), 0.03, -0.006)[0] for s in ("L", "R")}

# ── weights ─────────────────────────────────────────────────────────────────


def chain_weights(segments, blend=0.05):
    """segments: [(bone, start, end)] along a limb. Smoothly blends across each joint."""
    segs = [(b, V(a), V(c)) for b, a, c in segments]

    def w(p):
        best, bt, bi = None, 0, 0
        for i, (b, a, c) in enumerate(segs):
            ab = c - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            d = (p - (a + ab * t)).length
            if best is None or d < best:
                best, bt, bi = d, t, i
        b, a, c = segs[bi]
        L = (c - a).length
        out = {b: 1.0}
        if bi + 1 < len(segs) and (1 - bt) * L < blend:
            k = 0.5 * (1 - (1 - bt) * L / blend)
            out = {b: 1 - k, segs[bi + 1][0]: k}
        elif bi > 0 and bt * L < blend:
            k = 0.5 * (1 - bt * L / blend)
            out = {b: 1 - k, segs[bi - 1][0]: k}
        return out

    return w


def torso_weight(p):
    y = p.y
    hips_y, spine_y, chest_y, neck_y = world("hips").y, world("spine").y, world("chest").y, world("neck").y
    if y < spine_y - 0.02:
        return {"hips": 1.0}
    if y < spine_y + 0.05:
        k = smoothstep(spine_y - 0.02, spine_y + 0.05, y)
        return {"hips": 1 - k, "spine": k}
    if y < chest_y - 0.03:
        return {"spine": 1.0}
    if y < chest_y + 0.05:
        k = smoothstep(chest_y - 0.03, chest_y + 0.05, y)
        return {"spine": 1 - k, "chest": k}
    if y < neck_y:
        return {"chest": 1.0}
    k = smoothstep(neck_y, neck_y + 0.08, y)
    return {"chest": 1 - k, "neck": k}


def arm_weight(side):
    return chain_weights([
        ("chest", world("chest") + V((0, 0.13, 0)), world(f"upperarm_{side}")),
        (f"upperarm_{side}", world(f"upperarm_{side}"), world(f"forearm_{side}")),
        (f"forearm_{side}", world(f"forearm_{side}"), world(f"hand_{side}")),
        (f"hand_{side}", world(f"hand_{side}"), world(f"fingers_{side}")),
    ], blend=0.06)


def leg_weight(side):
    return chain_weights([
        ("hips", world("hips"), world(f"thigh_{side}")),
        (f"thigh_{side}", world(f"thigh_{side}"), world(f"shin_{side}")),
        (f"shin_{side}", world(f"shin_{side}"), world(f"foot_{side}")),
        (f"foot_{side}", world(f"foot_{side}"), world(f"foot_{side}") + V((0, -0.04, 0.2))),
    ], blend=0.06)


# ── textures (painted with code, in the painting's palette) ─────────────────


def make_image(name, w, h, painter):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, w, h, alpha=False)
    px = [0.0] * (w * h * 4)
    for j in range(h):
        for i in range(w):
            r, g, b = painter(i / (w - 1), j / (h - 1))
            k = (j * w + i) * 4
            px[k], px[k + 1], px[k + 2], px[k + 3] = r, g, b, 1.0
    img.pixels.foreach_set(px)
    img.pack()
    return img


def mix(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


def col(h):
    return hexcol(h)[:3]


def face_painter(u, v):
    """Front-projected face: u, v in 0..1 map to face unit coords x, y in -1..1."""
    x, y = u * 2 - 1, v * 2 - 1
    c = col(PALETTE["face"])
    r = math.hypot(x, y * 0.95)
    c = mix(c, col(PALETTE["faceEdge"]), smoothstep(0.62, 0.98, r) * 0.9)
    # lower lip: the painting's big tan lip under the mouth line
    lip = bump(x, y, 0, -0.62, 0.28, 0.02) * smoothstep(-0.43, -0.5, y)
    c = mix(c, col("#d98a5c"), min(1, lip * 1.6))
    # chin shadow under the lip
    c = mix(c, col(PALETTE["faceShade"]), bump(x, y, 0, -0.82, 0.25, 0.01) * 0.5)
    line = col("#b8603c")
    # brow creases: two soft arches above each eye, and lines over the brow
    for s in (1, -1):
        for k, (yy, amp) in enumerate(((0.2, 0.55), (0.29, 0.4))):
            yc = yy + 0.12 * (1 - ((x - s * 0.36) / 0.32) ** 2)
            d = abs(y - yc)
            on = smoothstep(0.018, 0.004, d) * smoothstep(0.32, 0.18, abs(x - s * 0.36))
            c = mix(c, line, on * amp)
        # under-eye fold
        yc = -0.08 - 0.08 * (1 - ((x - s * 0.42) / 0.2) ** 2)
        on = smoothstep(0.014, 0.003, abs(y - yc)) * smoothstep(0.2, 0.08, abs(x - s * 0.42))
        c = mix(c, line, on * 0.35)
        # cheek folds: from beside the nose, curving down and out round the muzzle
        for off, amp in ((0.0, 0.6), (0.09, 0.35)):
            t = (y + 0.08) / -0.55
            if 0 <= t <= 1:
                xc = s * (0.16 + off + 0.32 * t ** 1.3)
                on = smoothstep(0.016, 0.004, abs(x - xc)) * math.sin(math.pi * t)
                c = mix(c, line, on * amp)
    # nose-bridge wrinkles
    for yy in (0.02, 0.07, 0.12):
        on = smoothstep(0.012, 0.003, abs(y - yy - 0.02 * x * x * 10)) * smoothstep(0.1, 0.05, abs(x))
        c = mix(c, line, on * 0.45)
    # forehead lines under the third eye
    for yy in (0.36, 0.41):
        on = smoothstep(0.01, 0.003, abs(y - yy + 0.08 * x * x)) * smoothstep(0.3, 0.15, abs(x)) * smoothstep(0.06, 0.1, abs(x))
        c = mix(c, line, on * 0.3)
    return c


def fur_painter(u, v):
    """Four tone columns; each runs root (v=0, dark) to tip (v=1, lighter), with strand streaks."""
    tones = [("fur", "furLight"), ("furDark", "fur"), ("furLight", "furStreak"), ("fur", "furStreak")]
    k = min(3, int(u * 4))
    a, b = tones[k]
    t = smoothstep(0.0, 1.0, v)
    c = mix(col(PALETTE["furDark"]), mix(col(PALETTE[a]), col(PALETTE[b]), t * 0.8), smoothstep(0.0, 0.35, v))
    streak = 0.5 + 0.5 * math.sin((u * 4 % 1) * 2 * math.pi * 5 + v * 3)
    return mix(c, col(PALETTE["furStreak"]), streak * 0.18 * v)


def furbase_painter(u, v):
    c = col(PALETTE["fur"])
    s = 0.5 + 0.5 * math.sin(u * 2 * math.pi * 17 + math.sin(v * 11 + u * 30) * 2.5 + math.sin(u * 97) * 1.5)
    s2 = 0.5 + 0.5 * math.sin(u * 2 * math.pi * 7 + v * 5 + math.sin(u * 53))
    c = mix(c, col(PALETTE["furDark"]), (1 - s) * 0.45)
    return mix(c, col(PALETTE["furLight"]), s2 * s * 0.4)


def knit_painter(u, v):
    c = col(PALETTE["hat"])
    row = 0.5 + 0.5 * math.cos(v * 2 * math.pi * 26)
    stitch = 0.5 + 0.5 * math.cos(u * 2 * math.pi * 60 + (math.pi if int(v * 26) % 2 else 0))
    return mix(c, col(PALETTE["hatShade"]), (1 - row) * 0.35 + stitch * 0.08)


def rib_painter(u, v):
    rib = 0.5 + 0.5 * math.cos(u * 2 * math.pi * 64)
    return mix(col(PALETTE["cuff"]), col("#b33a0c"), (1 - rib) ** 2 * 0.75)


def cord_painter(u, v):
    wale = 0.5 + 0.5 * math.cos(u * 2 * math.pi * 48)
    return mix(col(PALETTE["overalls"]), col(PALETTE["overallsLine"]), (1 - wale) ** 3 * 0.8)


# ── materials ───────────────────────────────────────────────────────────────


def material(name, color=None, image=None, rough=0.85, metal=0.0, emission=None, strength=0.0, double=False):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if hasattr(m, "use_nodes") and not m.node_tree:
        m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    elif color:
        bsdf.inputs["Base Color"].default_value = srgb_to_linear(hexcol(color))
    if emission:
        bsdf.inputs["Emission Color"].default_value = srgb_to_linear(hexcol(emission))
        bsdf.inputs["Emission Strength"].default_value = strength
    m.use_backface_culling = not double
    m.diffuse_color = srgb_to_linear(hexcol(color or "#888888"))
    return m


def build_materials():
    imgs = {
        "face": make_image("tex_face", 512, 512, face_painter),
        "fur": make_image("tex_fur_strands", 256, 64, fur_painter),
        "furbase": make_image("tex_fur_base", 256, 128, furbase_painter),
        "knit": make_image("tex_knit", 256, 128, knit_painter),
        "rib": make_image("tex_cuff", 256, 16, rib_painter),
        "cord": make_image("tex_cord", 256, 16, cord_painter),
    }
    return {
        "fur": material("fur", image=imgs["furbase"], rough=0.95),
        "fur_strands": material("fur_strands", image=imgs["fur"], rough=0.9, double=True),
        "face": material("face", image=imgs["face"], rough=0.75),
        "skin": material("skin", PALETTE["face"], rough=0.7),
        "skin_shade": material("skin_shade", PALETTE["faceShade"], rough=0.75),
        "lash": material("lash", PALETTE["lash"], rough=0.8),
        "mouth": material("mouth", "#4a1a12", rough=0.6),
        "teeth": material("teeth", "#fff4e4", rough=0.35),
        "eye_white": material("eye_white", PALETTE["eyeWhite"], rough=0.3),
        "iris": material("iris", PALETTE["iris"], rough=0.2),
        "hat": material("hat", image=imgs["knit"], rough=0.95),
        "hat_cuff": material("hat_cuff", image=imgs["rib"], rough=0.95),
        "dungarees": material("dungarees", image=imgs["cord"], rough=0.9),
        "gold_jewellery": material("gold_jewellery", PALETTE["gold"], rough=0.3, metal=1.0),
        "third_eye": material("third_eye", PALETTE["thirdEye"], rough=0.4, emission=PALETTE["thirdIris"], strength=0.4),
        "third_eye_iris": material("third_eye_iris", PALETTE["thirdIris"], rough=0.3, emission=PALETTE["thirdIris"], strength=0.6),
    }


def front_uv(center, radii):
    def f(p):
        return ((p.x - center[0]) / radii[0] * 0.5 + 0.5, (p.y - center[1]) / radii[1] * 0.5 + 0.5)
    return f


# ── the head ────────────────────────────────────────────────────────────────


def build_head(B):
    head = {"head": 1.0}

    # face mask with shape keys
    nu, nv = 56, 40
    face_keys = {}

    def face_fn(deform):
        def fn(u, v):
            n = unit_sphere(u, v)
            d = deform(n)
            return FACE_C + V(((n.x + d[0]) * FACE_R[0], (n.y + d[1]) * FACE_R[1], (n.z + d[2]) * FACE_R[2]))
        return fn

    def keyed(extra):
        def d(n):
            a = face_deform(n)
            b = extra(n)
            return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
        return d

    f = max
    key_deforms = {
        "smile": lambda n: (0.04 * n.x * bump(abs(n.x), n.y, 0.5, -0.4, 0.05, 0.03), 0.05 * bump(abs(n.x), n.y, 0.45, -0.3, 0.05, 0.03), 0),
        "grin": lambda n: (0.06 * n.x * bump(abs(n.x), n.y, 0.5, -0.4, 0.06, 0.03),
                           0.07 * bump(abs(n.x), n.y, 0.45, -0.25, 0.04, 0.03) - 0.2 * bump(n.x, n.y, 0, -0.75, 0.25, 0.04) * f(0, n.z), 0),
        "mouthOpen": lambda n: (0, -0.26 * bump(n.x, n.y, 0, -0.75, 0.3, 0.05) * f(0, n.z), 0),
        "browsUp": lambda n: (0, 0.06 * bump(abs(n.x), n.y, 0.36, 0.25, 0.08, 0.012) * f(0, n.z), 0),
        "squint": lambda n: (0, 0.05 * bump(abs(n.x), n.y, 0.42, -0.12, 0.03, 0.01) * f(0, n.z), -0.02 * bump(abs(n.x), n.y, 0.42, 0.1, 0.02, 0.01)),
    }
    verts, faces, uvs = surface(face_fn(face_deform), nu, nv, pole0=True, pole1=True)
    for k, extra in key_deforms.items():
        kv, _, _ = surface(face_fn(keyed(extra)), nu, nv, pole0=True, pole1=True)
        face_keys[k] = kv
    fuv = front_uv(FACE_C, FACE_R)
    uvs = [[fuv(verts[i]) for i in fc] for fc in faces]
    B.add(verts, faces, uvs, "face", head, face_keys)

    # skull and mane, cheeks, beard (fur base under the strands)
    for c, r in (SKULL, CHEEK_L, CHEEK_R, BEARD):
        vs, fs, us = ellipsoid(H + V(c), r, 28, 18)
        B.add(vs, fs, us, "fur", head)

    # nose: a soft flat tip and two nostrils
    tip, _ = on_face(0, -0.15, 0.004)
    vs, fs, us = ellipsoid(tip + V((0, -0.006, -0.002)), (0.027, 0.014, 0.01), 20, 12)
    B.add(vs, fs, us, "skin_shade", head)
    for s in (1, -1):
        vs, fs, us = ellipsoid(tip + V((s * 0.013, -0.011, 0.004)), (0.01, 0.006, 0.004), 12, 8)
        B.add(vs, fs, us, "mouth", head)

    # ears: big peach cups with a shaded bowl and gold hoops
    for s in (1, -1):
        rot = euler(0, s * 0.55, s * -0.12)
        ec = H + V((s * 0.315, 0.07, -0.01))
        vs, fs, us = ellipsoid(ec, (0.04, 0.1, 0.082), 24, 16, rot=rot)
        B.add(vs, fs, us, "skin", head)
        vs, fs, us = ellipsoid(ec + rot @ V((s * 0.02, -0.006, 0.006)), (0.022, 0.07, 0.054), 20, 12, rot=rot)
        B.add(vs, fs, us, "skin_shade", head)
        hoops = ([((-0.318, 0.0, 0.03), 0.017), ((-0.322, 0.02, 0.04), 0.016), ((-0.325, 0.04, 0.045), 0.015), ((-0.31, 0.15, 0.045), 0.015)]
                 if s < 0 else [((0.318, -0.01, 0.03), 0.028), ((0.325, 0.04, 0.045), 0.015), ((0.315, 0.145, 0.045), 0.014)])
        for p, r in hoops:
            vs, fs, us = torus(H + V(p), r * 1.3, 0.0055, euler(0, math.pi / 2 + s * 0.3, 0) @ Matrix.Rotation(math.pi / 2, 3, "X"), 24, 6)
            B.add(vs, fs, us, "gold_jewellery", head)

    # eyelids: upper lids rotate closed (eyesClosed); lashes ride with them; lower lids fixed
    LID_R, OPEN, CLOSED = 0.034, -0.95, 0.42
    flat = (1.15, 0.9, 0.62)
    for s in ("L", "R"):
        e = EYE[s]

        def lid(angle, sq=0.0, r=LID_R, top=True):
            def fn(u, v):
                th = (math.pi / 2) * (1 - v) if top else math.pi * 0.64 + (math.pi * 0.36) * v
                ph = 2 * math.pi * u
                p = V((math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph))) * r
                p = Matrix.Rotation(angle, 3, "X") @ p
                return e + V((p.x * flat[0], p.y * flat[1] + sq, p.z * flat[2]))
            return fn

        vs, fs, us = surface(lid(OPEN), 24, 6, pole1=True)
        fs, us = flip(fs, us)
        closed, _, _ = surface(lid(CLOSED), 24, 6, pole1=True)
        squint, _, _ = surface(lid(OPEN + 0.5), 24, 6, pole1=True)
        B.add(vs, fs, us, "skin", head, {"eyesClosed": closed, "squint": squint})
        # lash line along the lid's rim
        def lash(angle):
            pts = []
            for i in range(17):
                ph = math.pi * i / 16
                p = V((math.cos(ph), 0, math.sin(ph))) * (LID_R * 1.02)
                p = Matrix.Rotation(angle, 3, "X") @ p
                pts.append(e + V((p.x * flat[0], p.y * flat[1], p.z * flat[2])))
            return pts
        rad = [0.0042] * 17
        vs, fs, us = tube(lash(OPEN), rad, nu=6, nv=24)
        cl, _, _ = tube(lash(CLOSED), rad, nu=6, nv=24)
        sq, _, _ = tube(lash(OPEN + 0.5), rad, nu=6, nv=24)
        B.add(vs, fs, us, "lash", head, {"eyesClosed": cl, "squint": sq})
        # lower lid, which rises a little for squint
        vs, fs, us = surface(lid(0, r=LID_R * 0.99, top=False), 24, 5, wrap=True, pole1=True)
        up, _, _ = surface(lid(0, sq=0.008, r=LID_R * 0.99, top=False), 24, 5, wrap=True, pole1=True)
        B.add(vs, fs, us, "skin", head, {"squint": up})

    # mouth: a dark lens on the face that is a calm line at rest and opens for grin / mouthOpen
    NS, NT = 28, 6

    def mouth_grid(shape, out):
        verts = []
        for i in range(NT + 1):
            t = i / NT * 2 - 1
            for j in range(NS + 1):
                s = j / NS * 2 - 1
                x, yc, h = shape(s)
                verts.append(on_face(x, yc + h * t, out)[0])
        return verts

    def calm(s):
        x = 0.6 * s
        return x, -0.4 - 0.18 * x * x + 0.1 * x ** 4, 0.012 * math.sqrt(max(0, 1 - s * s)) + 0.003

    def smile(s):
        x = 0.62 * s
        return x, -0.41 + 0.5 * x * x, 0.012 * math.sqrt(max(0, 1 - s * s)) + 0.003

    def grin(s):
        x = 0.62 * s
        top, bot = -0.36 + 0.32 * x * x, -0.37 - 0.3 * (max(0, 1 - s * s)) ** 0.8
        return x, (top + bot) / 2, (top - bot) / 2 + 0.004

    def yawn(s):
        x = 0.3 * s
        h = 0.2 * math.sqrt(max(0, 1 - s * s)) + 0.004
        return x, -0.5, h

    faces, uvs = [], []
    for i in range(NT):
        for j in range(NS):
            a = i * (NS + 1) + j
            faces.append((a, a + 1, a + NS + 2, a + NS + 1))
            uvs.append([(0, 0), (1, 0), (1, 1), (0, 1)])
    keys = {"smile": mouth_grid(smile, 0.004), "grin": mouth_grid(grin, 0.004), "mouthOpen": mouth_grid(yawn, 0.004)}
    B.add(mouth_grid(calm, 0.004), faces, uvs, "mouth", head, keys)

    # teeth: hidden just under the face, shown in the top of the grin
    def teeth_grid(shape, out, frac):
        verts = []
        for i in range(NT + 1):
            t = i / NT
            for j in range(NS + 1):
                s = j / NS * 2 - 1
                x, yc, h = shape(s)
                top = yc + h
                verts.append(on_face(x * 0.92, top - (2 * h * frac) * (1 - t) - 0.002, out)[0])
        return verts

    hidden = teeth_grid(calm, -0.004, 0.2)
    B.add(hidden, faces, uvs, "teeth", head, {"grin": teeth_grid(grin, 0.006, 0.42)})

    # third eye: an almond on the forehead under the cuff, with a turquoise iris
    def almond(rx, ry, out):
        def fn(u, v):
            a = 2 * math.pi * u
            x = rx * math.cos(a) * v
            y = ry * math.sin(a) * v * (1 - 0.35 * abs(math.cos(a)))
            return on_face(x, 0.47 + y, out)[0]
        return fn
    vs, fs, us = surface(almond(0.17, 0.085, 0.006), 24, 3, pole0=True)
    fs, us = flip(fs, us)
    B.add(vs, fs, us, "third_eye", head)
    vs, fs, us = surface(almond(0.06, 0.06, 0.008), 16, 2, pole0=True)
    fs, us = flip(fs, us)
    B.add(vs, fs, us, "third_eye_iris", head)
    rim = [almond(0.17, 0.085, 0.007)(i / 24, 1) for i in range(25)]
    vs, fs, us = tube(rim, [0.0028] * 25, nu=5, caps=False, nv=48)
    B.add(vs, fs, us, "lash", head)


# ── the body ────────────────────────────────────────────────────────────────


def build_body(B):
    # torso: a lathe around Y, fur above, dungarees below, with the bib in front
    prof = [(0.48, 0.1, 0.09), (0.52, 0.18, 0.16), (0.58, 0.21, 0.18), (0.66, 0.225, 0.19), (0.75, 0.23, 0.19),
            (0.84, 0.25, 0.19), (0.92, 0.27, 0.19), (0.99, 0.25, 0.17), (1.04, 0.16, 0.13), (1.09, 0.1, 0.09)]

    def torso(u, v):
        k = v * (len(prof) - 1)
        i = min(len(prof) - 2, int(k))
        t = k - i
        y = lerp(prof[i][0], prof[i + 1][0], t)
        rx = lerp(prof[i][1], prof[i + 1][1], t)
        rz = lerp(prof[i][2], prof[i + 1][2], t)
        a = 2 * math.pi * u - math.pi
        belly = 1 + 0.12 * bump(0, y, 0, 0.7, 1, 0.01) * max(0, math.cos(a))
        return V((rx * math.sin(a), y, rz * math.cos(a) * belly + 0.005))

    vs, fs, us = surface(torso, 40, 26, pole0=True, pole1=True)
    per = []
    for f in fs:
        c = sum((vs[i] for i in f), V()) / len(f)
        bib = c.z > 0.07 and abs(c.x) < 0.13 and 0.6 < c.y < 0.935
        per.append("dungarees" if (c.y < 0.6 or bib) else "fur")
    B.add(vs, fs, us, per, torso_weight)

    # straps, bib buttons, pendant on its chain
    for s in (1, -1):
        pts = [V((s * 0.1, 0.925, 0.205)), V((s * 0.12, 1.0, 0.17)), V((s * 0.15, 1.05, 0.0)), V((s * 0.13, 1.0, -0.17)), V((s * 0.1, 0.86, -0.2))]
        vs, fs, us = tube(pts, [0.016] * 5, nu=8, squash=0.45)
        B.add(vs, fs, us, "dungarees", torso_weight)
        vs, fs, us = ellipsoid(V((s * 0.1, 0.915, 0.21)), (0.012, 0.012, 0.006), 12, 8)
        B.add(vs, fs, us, "gold_jewellery", torso_weight)
    chain = [V((0.09 * math.cos(a), 1.03 - 0.06 * math.sin(a) ** 2, 0.13 + 0.07 * math.sin(a))) for a in [math.pi * i / 12 for i in range(13)]]
    vs, fs, us = tube(chain, [0.0025] * 13, nu=5, caps=False, nv=36)
    B.add(vs, fs, us, "gold_jewellery", {"chest": 1.0})
    vs, fs, us = ellipsoid(V((0, 0.975, 0.215)), (0.022, 0.022, 0.006), 20, 8, rot=euler(0.3, 0, 0))
    B.add(vs, fs, us, "gold_jewellery", {"chest": 1.0})

    # arms: thick and shaggy, long-fingered peach hands (palms face in, thumbs forward)
    for side, s in (("L", 1), ("R", -1)):
        sh, el, wr = world(f"upperarm_{side}"), world(f"forearm_{side}"), world(f"hand_{side}")
        w = arm_weight(side)
        vs, fs, us = tube([sh + V((0, 0.05, 0)), sh, el, wr + V((0, 0.03, 0))], [0.1, 0.105, 0.088, 0.072], nu=14, nv=12)
        B.add(vs, fs, us, "fur", w)
        hand, fing, thumb = world(f"hand_{side}"), world(f"fingers_{side}"), world(f"thumb_{side}")
        palm = hand + V((0, -0.045, 0))
        vs, fs, us = ellipsoid(palm, (0.032, 0.058, 0.052), 20, 14)
        B.add(vs, fs, us, "skin", {f"hand_{side}": 1.0})
        for k, z in enumerate((-0.033, -0.011, 0.011, 0.031)):
            ln = (0.07, 0.078, 0.074, 0.06)[k]
            base = V((palm.x, palm.y - 0.04, palm.z + z))
            pts = [base, base + V((0, -ln * 0.5, 0.0)), base + V((-s * 0.012, -ln, 0.004))]
            vs, fs, us = tube(pts, [0.0135, 0.012, 0.0105], nu=8, nv=8)
            B.add(vs, fs, us, "skin", lambda p, b=base: {f"fingers_{side}": 0.7, f"hand_{side}": 0.3} if p.y > b.y - 0.006 else {f"fingers_{side}": 1.0})
        tb = palm + V((-s * 0.008, -0.01, 0.045))
        pts = [tb, tb + V((-s * 0.01, -0.03, 0.022)), tb + V((-s * 0.018, -0.055, 0.025))]
        vs, fs, us = tube(pts, [0.016, 0.014, 0.012], nu=8, nv=8)
        B.add(vs, fs, us, "skin", {f"thumb_{side}": 1.0})

    # legs: furry, with the dungaree shorts at the top, and big peach feet with toes
    for side, s in (("L", 1), ("R", -1)):
        hip, kn, an = world(f"thigh_{side}"), world(f"shin_{side}"), world(f"foot_{side}")
        w = leg_weight(side)
        vs, fs, us = tube([hip + V((0, 0.03, 0)), hip, kn, an + V((0, 0.02, 0))], [0.12, 0.118, 0.095, 0.074], nu=14, nv=12)
        per = ["dungarees" if (sum((vs[i] for i in f), V()) / len(f)).y > hip.y - 0.05 else "fur" for f in fs]
        B.add(vs, fs, us, per, w)
        foot = an
        fw = {f"foot_{side}": 1.0}
        vs, fs, us = ellipsoid(foot + V((0, -0.035, 0.07)), (0.07, 0.045, 0.135), 24, 14)
        B.add(vs, fs, us, "skin", lambda p: {f"foot_{side}": 1.0} if p.y < foot.y - 0.02 else {f"foot_{side}": 0.6, f"shin_{side}": 0.4})
        vs, fs, us = ellipsoid(foot + V((0, -0.072, 0.06)), (0.058, 0.012, 0.11), 20, 8)
        B.add(vs, fs, us, "skin_shade", fw)
        for k in range(4):
            x = s * (0.034 - k * 0.022)
            base = foot + V((x, -0.045, 0.17 - abs(k - 1.5) * 0.012))
            pts = [base, base + V((0, -0.006, 0.03)), base + V((0, -0.016, 0.05))]
            vs, fs, us = tube(pts, [0.019, 0.017, 0.015], nu=8, nv=6)
            B.add(vs, fs, us, "skin", fw)
        bt = foot + V((-s * 0.06, -0.04, 0.1))
        pts = [bt, bt + V((-s * 0.025, -0.006, 0.03)), bt + V((-s * 0.035, -0.012, 0.055))]
        vs, fs, us = tube(pts, [0.024, 0.021, 0.018], nu=8, nv=6)
        B.add(vs, fs, us, "skin", fw)

    # eyes, on their own bones so the site can turn them towards the visitor
    for side in ("L", "R"):
        e = EYE[side]
        ew = {f"eye_{side}": 1.0}
        vs, fs, us = ellipsoid(e, (0.027, 0.023, 0.017), 20, 14)
        B.add(vs, fs, us, "eye_white", ew)
        vs, fs, us = ellipsoid(e + V((0, 0, 0.0105)), (0.016, 0.016, 0.008), 16, 10)
        B.add(vs, fs, us, "iris", ew)
        vs, fs, us = ellipsoid(e + V((0.005, 0.005, 0.0175)), (0.003, 0.003, 0.0015), 8, 6)
        B.add(vs, fs, us, "teeth", ew)

    build_beanie(B)


def build_beanie(B):
    """Slouchy, worn low on the forehead and tipped to his right; ribbed cuff just above the third eye."""
    hat_w = {"beanie": 1.0}
    third_eye_y = on_face(0, 0.47)[0].y
    cc = V((0, third_eye_y + 0.112, -0.015))     # cuff centre
    rx, rz, half = 0.272, 0.235, 0.056
    rot = euler(0.12, 0, 0.05)                    # back a touch higher; rises to his left

    def at(p):
        return cc + rot @ p

    # ribbed cuff, elliptical to fit the head
    prof = [(-0.012, -half), (0.006, -half + 0.006), (0.012, -0.025), (0.013, 0.025), (0.008, half - 0.006), (-0.01, half)]

    def cuff(u, v):
        k = v * (len(prof) - 1)
        i = min(len(prof) - 2, int(k))
        dr = lerp(prof[i][0], prof[i + 1][0], k - i)
        y = lerp(prof[i][1], prof[i + 1][1], k - i)
        a = 2 * math.pi * u
        dr += 0.0028 * math.cos(a * 72)
        return at(V(((rx + dr) * math.sin(a), y, (rz + dr) * math.cos(a))))

    vs, fs, us = surface(cuff, 144, 6, wrap=True)
    B.add(vs, fs, us, "hat_cuff", hat_w)

    # crown: a tall slouchy dome that leans and folds over to his right
    def crown_def(n):
        up = max(0.0, n.y)
        a = math.atan2(n.x, n.z)
        fold = 0.05 * math.sin(a * 3 + up * 4) * up ** 1.5
        return (-0.6 * up ** 1.6 + fold, 0.05 * up - 0.5 * max(0.0, -n.x) * up ** 2, 0.06 * up + fold * 0.4)

    vs, fs, us = ellipsoid(V((0, half - 0.01, 0)), (rx - 0.004, 0.17, rz - 0.004), 40, 16, deform=crown_def, v0=0.5)
    B.add([at(v) for v in vs], fs, [[(u * 3, v) for u, v in uv] for uv in us], "hat", hat_w)
    # the folded-over tip, flopping down on his right
    vs, fs, us = ellipsoid(V((-0.25, 0.1, -0.02)), (0.09, 0.1, 0.14), 20, 14, rot=euler(0.1, 0, 0.6),
                           deform=lambda n: (0.03 * math.sin(n.z * 5), 0.03 * math.sin(n.x * 4), 0))
    B.add([at(v) for v in vs], fs, us, "hat", hat_w)
    # the slouch hanging behind his right ear
    vs, fs, us = ellipsoid(V((-0.26, -0.11, -0.07)), (0.085, 0.17, 0.12), 20, 14, rot=euler(0.05, 0, 0.18))
    B.add([at(v) for v in vs], fs, us, "hat", hat_w)
    # inside lining so the cuff edge reads as fabric
    vs, fs, us = surface(lambda u, v: at(V(((rx - 0.012) * math.sin(2 * math.pi * u), lerp(-half, half, v), (rz - 0.012) * math.cos(2 * math.pi * u)))), 48, 2)
    B.add(vs, [tuple(reversed(f)) for f in fs], us, "hat_cuff", hat_w)


# ── fur strands ─────────────────────────────────────────────────────────────


def blades(B, parts, seed):
    """parts: list of dicts {surf: (verts, faces), count, length, width, keep, flow, lift, weight}."""
    r = random.Random(seed)
    for part in parts:
        vs, fs = part["surf"]
        tris = []
        for f in fs:
            for k in range(1, len(f) - 1):
                a, b, c = vs[f[0]], vs[f[k]], vs[f[k + 1]]
                area = (b - a).cross(c - a).length / 2
                if area > 0:
                    tris.append((a, b, c, area))
        total = sum(t[3] for t in tris)
        if not total:
            continue
        cum, acc = [], 0
        for t in tris:
            acc += t[3]
            cum.append(acc)
        made = 0
        tries = 0
        while made < part["count"] and tries < part["count"] * 8:
            tries += 1
            x = r.random() * total
            lo, hi = 0, len(cum) - 1
            while lo < hi:
                mid = (lo + hi) // 2
                if cum[mid] < x:
                    lo = mid + 1
                else:
                    hi = mid
            a, b, c, _ = tris[lo]
            u1, u2 = r.random(), r.random()
            if u1 + u2 > 1:
                u1, u2 = 1 - u1, 1 - u2
            p = a + (b - a) * u1 + (c - a) * u2
            n = (b - a).cross(c - a).normalized()
            if part.get("outward") is not None and n.dot(p - part["outward"]) < 0:
                n = -n
            if part.get("keep") and not part["keep"](p, n):
                continue
            flow = part["flow"](p, n) if part.get("flow") else V((0, -1, 0))
            t = flow - n * flow.dot(n)
            if t.length < 1e-4:
                t = V((0, -1, 0)) - n * n.y
            t.normalize()
            lift = part.get("lift", 0.35) * (0.7 + 0.6 * r.random())
            d = (t * math.cos(lift) + n * math.sin(lift)).normalized()
            side = n.cross(d).normalized()
            twist = (r.random() - 0.5) * 0.9
            side = (side * math.cos(twist) + n * math.sin(twist)).normalized()
            L = lerp(part["length"][0], part["length"][1], r.random())
            W = part["width"] * (0.7 + 0.6 * r.random())
            tone = r.choices([0, 1, 2, 3], weights=[0.5, 0.26, 0.17, 0.07])[0]
            u0 = tone * 0.25 + 0.03
            rows = 4
            verts, uvs_v = [], []
            root = p - n * 0.004
            for i in range(rows):
                k = i / (rows - 1)
                c0 = root + d * (L * k) - n * (L * 0.18 * k * k) + side * (0.01 * math.sin(k * 3 + twist * 5) * k)
                w = W * (1 - k) ** 0.75 * 0.5 + 0.0008
                verts += [c0 - side * w, c0 + side * w]
                uvs_v += [(u0, k), (u0 + 0.19, k)]
            faces, uvs = [], []
            for i in range(rows - 1):
                a0 = i * 2
                faces.append((a0, a0 + 1, a0 + 3, a0 + 2))
                uvs.append([uvs_v[a0], uvs_v[a0 + 1], uvs_v[a0 + 3], uvs_v[a0 + 2]])
            wt = part["weight"](p) if callable(part["weight"]) else part["weight"]
            B.add(verts, faces, uvs, "fur_strands", wt)
            made += 1


def build_fur(F):
    head = {"head": 1.0}
    face_zone = lambda p: ((p.x - FACE_C.x) / 0.24) ** 2 + ((p.y - FACE_C.y) / 0.235) ** 2 < 1 and p.z > FACE_C.z - 0.05
    ears = lambda p: abs(abs(p.x) - 0.315) < 0.05 and abs(p.y - (H.y + 0.07)) < 0.1 and p.z > -0.05
    third_eye_y = on_face(0, 0.47)[0].y
    under_hat = lambda p: p.y > third_eye_y + 0.04
    mane_flow = lambda p, n: V((p.x - FACE_C.x, (p.y - FACE_C.y) - 0.12, (p.z - FACE_C.z) * 0.3))
    parts = []
    skull = ellipsoid(H + V(SKULL[0]), SKULL[1], 28, 18)
    parts.append(dict(surf=(skull[0], skull[1]), count=800, length=(0.035, 0.075), width=0.024, lift=0.32, outward=H + V(SKULL[0]),
                      keep=lambda p, n: not face_zone(p) and not under_hat(p) and not ears(p), flow=mane_flow, weight=head))
    for s in (1, -1):
        cc = CHEEK_L if s > 0 else CHEEK_R
        ch = ellipsoid(H + V(cc[0]), cc[1], 24, 16)
        parts.append(dict(surf=(ch[0], ch[1]), count=220, length=(0.04, 0.085), width=0.024, lift=0.4, outward=H + V(cc[0]),
                          keep=lambda p, n: not face_zone(p) and not ears(p), flow=lambda p, n, s=s: V((s * 0.8, -1, 0)), weight=head))
    beard = ellipsoid(H + V(BEARD[0]), BEARD[1], 24, 14)
    parts.append(dict(surf=(beard[0], beard[1]), count=300, length=(0.04, 0.085), width=0.024, lift=0.25, outward=H + V(BEARD[0]),
                      keep=lambda p, n: not face_zone(p), flow=lambda p, n: V((p.x * 0.5, -1, 0.2)), weight=head))
    blades(F, parts, 11)

    # torso fur, skipping the dungarees
    tv, tf, _ = surface(lambda u, v: V((0.26 * math.sin(2 * math.pi * u - math.pi) * (0.85 + 0.15 * v), lerp(0.6, 1.06, v), 0.19 * math.cos(2 * math.pi * u - math.pi))), 32, 12)
    bib = lambda p: p.z > 0.06 and abs(p.x) < 0.145 and 0.6 < p.y < 0.94
    straps = lambda p: abs(abs(p.x) - 0.13) < 0.03 and p.y > 0.94
    blades(F, [dict(surf=(tv, tf), count=760, length=(0.045, 0.09), width=0.026, lift=0.25, outward=V((0, 0.9, 0)),
                    keep=lambda p, n: not bib(p) and not straps(p), flow=lambda p, n: V((p.x * 0.6, -1, 0)), weight=torso_weight)], 21)

    for side, s in (("L", 1), ("R", -1)):
        sh, el, wr = world(f"upperarm_{side}"), world(f"forearm_{side}"), world(f"hand_{side}")
        av, af, _ = tube([sh + V((0, 0.05, 0)), sh, el, wr + V((0, 0.04, 0))], [0.1, 0.105, 0.088, 0.072], nu=16, nv=12)
        blades(F, [dict(surf=(av, af), count=380, length=(0.045, 0.085), width=0.026, lift=0.28, outward=None,
                        flow=lambda p, n, s=s: V((s * 0.25, -1, 0.05)), weight=arm_weight(side))], 31 + s)
        hip, kn, an = world(f"thigh_{side}"), world(f"shin_{side}"), world(f"foot_{side}")
        lv, lf, _ = tube([hip, kn, an + V((0, 0.04, 0))], [0.118, 0.095, 0.076], nu=16, nv=12)
        blades(F, [dict(surf=(lv, lf), count=340, length=(0.045, 0.09), width=0.028, lift=0.28, outward=None,
                        keep=lambda p, n, hip=hip: p.y < hip.y - 0.05, flow=lambda p, n, s=s: V((s * 0.2, -1, 0.05)), weight=leg_weight(side))], 41 + s)


# ── assembling objects, rig and animation ───────────────────────────────────


def finish(B, coll, rig, mats):
    me = bpy.data.meshes.new(B.name)
    me.from_pydata([to_blender(p) for p in B.verts], [], B.faces)
    me.update()
    for m in B.mats:
        me.materials.append(mats[m])
    for poly, mi in zip(me.polygons, B.face_mat):
        poly.material_index = mi
        poly.use_smooth = True
    uv = me.uv_layers.new(name="UVMap")
    li = 0
    for poly, cuv in zip(me.polygons, B.face_uvs):
        for k in range(poly.loop_total):
            uv.data[poly.loop_start + k].uv = cuv[k]
        li += poly.loop_total
    obj = bpy.data.objects.new(B.name, me)
    coll.objects.link(obj)
    groups = {}
    for i, w in enumerate(B.weights):
        tot = sum(w.values()) or 1
        for bone, val in w.items():
            g = groups.get(bone) or obj.vertex_groups.new(name=bone)
            groups[bone] = g
            g.add([i], val / tot, "REPLACE")
    if B.keys:
        obj.shape_key_add(name="Basis", from_mix=False)
        for k in ("eyesClosed", "smile", "grin", "squint", "mouthOpen", "browsUp"):
            if k not in B.keys:
                continue
            sk = obj.shape_key_add(name=k, from_mix=False)
            for i, p in B.keys[k].items():
                sk.data[i].co = to_blender(p)
    obj.parent = rig
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    print(f"{B.name}: {len(me.vertices)} verts, {sum(len(p.vertices) - 2 for p in me.polygons)} tris")
    return obj


def build_rig(coll):
    arm = bpy.data.armatures.new("GuideRig")
    rig = bpy.data.objects.new("GuideRig", arm)
    coll.objects.link(rig)
    rig.show_in_front = True
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for b in BONES:
        eb = arm.edit_bones.new(b)
        p = to_blender(world(b) if not b.startswith("eye_") else EYE[b[-1]])
        eb.head = p
        eb.tail = p + V((0, 0, 0.06))  # pointing up with roll 0: bone axes = the character's own axes
        eb.roll = 0
        eb.use_deform = True  # root too: the exporter only writes deform bones, and the contract needs root
    for b in BONES:
        if arm.edit_bones.get(PARENTS.get(b) or ""):
            arm.edit_bones[b].parent = arm.edit_bones[PARENTS[b]]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return rig


def build_actions(rig, face_obj):
    key = face_obj.data.shape_keys
    names = [kb.name for kb in key.key_blocks]
    rig.animation_data_create()
    key.animation_data_create()
    for clip in CLIPS["clips"]:
        name = clip["name"]
        old = bpy.data.actions.get(name)
        if old:
            bpy.data.actions.remove(old)
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig_slot = act.slots.new(id_type="OBJECT", name="GuideRig")
        key_slot = act.slots.new(id_type="KEY", name="FaceKeys")
        strip = act.layers.new("Layer").strips.new(type="KEYFRAME")
        n = clip["frames"] + 1
        frames = [float(f) for f in range(n)]

        def curve(cb, path, index, values, group):
            fc = cb.fcurves.new(path, index=index, group_name=group)
            fc.keyframe_points.add(n)
            co = []
            for f, v in zip(frames, values):
                co += [f, v]
            fc.keyframe_points.foreach_set("co", co)
            fc.keyframe_points.foreach_set("interpolation", [1] * n)  # LINEAR: every frame is keyed
            fc.update()

        cb = strip.channelbag(rig_slot, ensure=True)
        for bone, rows in clip["rot"].items():
            if bone not in rig.pose.bones:
                continue
            for i in range(4):
                curve(cb, f'pose.bones["{bone}"].rotation_quaternion', i, [r[i] for r in rows], bone)
        for bone, rows in clip["loc"].items():
            if bone not in rig.pose.bones:
                continue
            for i in range(3):
                curve(cb, f'pose.bones["{bone}"].location', i, [r[i] for r in rows], bone)
        kb = strip.channelbag(key_slot, ensure=True)
        for sk, values in clip["shape"].items():
            if sk in names:
                curve(kb, f'key_blocks["{sk}"].value', 0, values, "Face")
        act.use_frame_range = True
        act.frame_start, act.frame_end = 0, n - 1
        spec = next((c for c in C["clips"] + C.get("optionalClips", []) + C.get("gestures", []) if c["name"] == name), None)
        act["guide_loop"] = bool(spec and spec.get("loop"))
        act["guide_beat"] = spec["beat"] if spec else ""
    # The glTF exporter only finds shape-key animation that is attached to the
    # face, so every clip also sits on its own muted NLA track there. Muted
    # tracks don't affect the viewport; the exporter merges them by action name.
    for track in list(key.animation_data.nla_tracks):
        key.animation_data.nla_tracks.remove(track)
    for clip in CLIPS["clips"]:
        act = bpy.data.actions[clip["name"]]
        track = key.animation_data.nla_tracks.new()
        track.name = clip["name"]
        strip = track.strips.new(clip["name"], 0, act)
        strip.action_slot = act.slots["KEFaceKeys"]
        track.mute = True
    first = bpy.data.actions["seated_idle"]
    rig.animation_data.action = first
    rig.animation_data.action_slot = first.slots["OBGuideRig"]
    key.animation_data.action = first
    key.animation_data.action_slot = first.slots["KEFaceKeys"]
    print(f"Actions: {len(CLIPS['clips'])}")


def ensure_collection(name):
    coll = bpy.data.collections.get(name)
    if not coll:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll


def clear_guide():
    coll = bpy.data.collections.get("Guide")
    if coll:
        for o in list(coll.objects):
            data = o.data
            bpy.data.objects.remove(o)
            if data and data.users == 0:
                (bpy.data.meshes if isinstance(data, bpy.types.Mesh) else bpy.data.armatures).remove(data)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)


def main():
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.unit_settings.system = "METRIC"
    for o in list(bpy.data.objects):
        if o.name in ("Cube", "Light", "Camera") and o.users_collection and o.users_collection[0].name == "Collection":
            bpy.data.objects.remove(o)
    clear_guide()
    coll = ensure_collection("Guide")
    mats = build_materials()
    rig = build_rig(coll)
    head = Builder("guide_head")
    build_head(head)
    face_obj = finish(head, coll, rig, mats)
    body = Builder("guide_body")
    build_body(body)
    finish(body, coll, rig, mats)
    fur = Builder("guide_fur")
    build_fur(fur)
    finish(fur, coll, rig, mats)
    build_actions(rig, face_obj)
    scene.frame_start, scene.frame_end = 1, 121
    out = os.path.join(ROOT, "blender", "guide.blend")
    bpy.ops.wm.save_as_mainfile(filepath=out)
    print(f"Saved {out}")


main()
