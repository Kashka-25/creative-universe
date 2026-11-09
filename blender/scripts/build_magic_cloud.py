"""Coco's Awakening: the MAGIC CLOUD transformation (invitation page).

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup \
        --python blender/scripts/build_magic_cloud.py [-- options]

    --blend-out <path>   save the scene there instead of blender/characters/invitation.blend (for trials)
    --no-export          build the cloud in the scene only (no GLB, no timeline.json)
    --no-optimize        write magic-cloud.glb straight from Blender (no meshopt)
    --cloud-raw-copy <path>  also keep a copy of the unoptimised export (for checks)
    --out-dir <dir>      write magic-cloud.glb and timeline.json there instead (for trials; the timeline starts
                         from the project's copy)

Run from the repository root, after blender/scripts/build_invitation.py has made invitation.blend (that script
also calls this one as its last stage, so one run rebuilds the whole scene). Re-runnable: everything this script
made before (the "magic_cloud" collection and the "transform" action) is removed first; Young Coco is never
touched, and nothing outside the files listed below is written.

Writes
  blender/characters/invitation.blend             + collection "magic_cloud" on the same 60 fps master timeline
  public/models/invitation/magic-cloud.glb        clips "transform" (object TRS only + the control empties) and
                                                    "luminous_hold" (a seamless loop at luminous, see build_hold; its
                                                    exact per-frame samples put back by scripts/restore-clip-samples.mjs)
  public/models/invitation/timeline.json          + markers expand, engulf, luminous, dissipate, complete,
                                                    swapFrame, adultBox and the clip "transform"

The look comes from his OWN cloud: the carved spiral curls ("ruyi") of the cloud in his hands, in its colours
(sampled from his texture: deep #1abcda in the grooves, #96ebfb in the body, #efffff on the crests).
  curl                one rounded "curl bun": a domed, pebble-like form (never a flat disc from any side) whose
                      face is carved into a rolled spiral, rounded crests and deep grooves, a pale luminous rim.
                      Shared by every puff (one mesh, many nodes: a small file); half of them are mirrored (a
                      negative X scale) so the spirals turn both ways.
  wisp                a tapered ribbon that ends in a curl, like the tail of his cloud.
  core                a soft, lumpy inner body that glows from within; it also guarantees the swap is hidden.
Colours are a 1-D ramp texture (UV u = lightness) used as base colour AND emissive map, so when the site raises
the glow (ctl_glow) the crests and rims glow most: luminous edges, soft white highlights.

Beats (master frames, from the young take's 'glow' marker; the transform is 4.0 s):
  glow        the held cloud glows (the seed); the magic cloud's own glow rises
  expand      curls bubble out of the cloud in his hands and grow
  engulf      the curls, spiralling around him, close in; the inner glow grows from his hands
  luminous    the cloud at its largest, the swirl easing down, glowing from within (the veil starts here)
  swapFrame   Young Coco and Adult Coco swap, fully hidden (checked with coverage masks)
  dissipate   the curls shrink and thin from the front outwards, the inner glow draws back into his held cloud
  complete    Adult Coco revealed; a few wisps settle around him and fade (ctl_fade)
Every movement is a smooth function of time (C2 eases, no linear segments), keyed as Bezier keys on every frame
with the function's own slopes; the swirl slows smoothly and never stops dead.

Glow and opacity travel as the X scale of the empties ctl_glow and ctl_fade (three r187 cannot play material
animation). Axes: Blender -Y faces the visitor (+Z in glTF), metres, the same origin as Young Coco and Adult Coco.
"""

import json
import math
import os
import subprocess
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = os.getcwd()
BLEND = os.path.join(ROOT, "blender", "characters", "invitation.blend")
OUT_DIR = os.path.join(ROOT, "public", "models", "invitation")
GLB = os.path.join(OUT_DIR, "magic-cloud.glb")
TIMELINE = os.path.join(OUT_DIR, "timeline.json")
ADULT_GLB = os.path.join(ROOT, "public", "models", "characters", "coco-sage.glb")
FPS = 60
COLL = "magic_cloud"
ACTION = "transform"
YOUNG = "little-coco"
FLOOR = 2.0 ** -10          # resting value of the control empties: never 0, exact after meshopt's filter

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if "--out-dir" in ARGV:                               # trials: leave the project's files alone
    _trial = ARGV[ARGV.index("--out-dir") + 1]
    os.makedirs(_trial, exist_ok=True)
    if os.path.exists(TIMELINE) and not os.path.exists(os.path.join(_trial, "timeline.json")):
        import shutil
        shutil.copyfile(TIMELINE, os.path.join(_trial, "timeline.json"))
    GLB, TIMELINE = os.path.join(_trial, "magic-cloud.glb"), os.path.join(_trial, "timeline.json")

# Beats, in frames after the young take's 'glow' marker (60 fps).
OFFSETS = {"glow": 0, "expand": 28, "engulf": 66, "luminous": 102, "swap": 138, "dissipate": 156,
           "complete": 210, "end": 240}

# His cloud's colours (sRGB), sampled from the held cloud's texture (percentiles of lightness): grooves and rims
# are the deep turquoise, the body the pale aqua, crests nearly white.
RAMP = [(0.00, "#1abcda"), (0.20, "#22c2dc"), (0.34, "#2cd4e7"), (0.52, "#96ebfb"), (0.70, "#b6f3fe"),
        (0.85, "#d3feff"), (1.00, "#efffff")]

# The shape of the cloud at its largest (Blender axes, metres). Centre between Young Coco's pose at the swap and
# Adult Coco (whose bounding box, sun and bolt included, is about x -0.69..0.68, y -0.48..0.48, z -0.95..0.95).
CENTRE = Vector((-0.035, -0.06, -0.07))
SHELL = (0.80, 0.78, 1.06)          # half-axes of the surface the curl centres settle on (round in plan)
SHELL_P = 3.4                        # superellipsoid exponent (2 = ellipsoid; higher = fuller shoulders)
CORE = (0.76, 0.74, 1.00)            # half-axes of the inner glow at full size (inside the curls)
CORE_P = 2.8
N_SLOTS = 70                         # Fibonacci points before the far back is thinned out


def log(*a):
    print("[cloud]", *a, flush=True)


# ───────────────────────────── smooth time functions (C2) ─────────────────────────────

def ss(a, b, x):
    """smootherstep: 0 -> 1 between a and b, zero slope and curvature at both ends."""
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * t * (t * (6 * t - 15) + 10)


def hump(a, b, x):
    """0 -> 1 -> 0 between a and b (peak in the middle), zero slope and curvature at both ends."""
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
    return 64.0 * t ** 3 * (1 - t) ** 3


def hexlin(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def ramp_srgb(L):
    xs = [p for p, _ in RAMP]
    cols = np.array([[int(h.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)] for _, h in RAMP])
    return np.stack([np.interp(L, xs, cols[:, k]) for k in range(3)], -1)


# ───────────────────────────── geometry ─────────────────────────────

def mesh_from(name, verts, faces, L, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    u = np.clip(np.asarray(L)[lv], 0.004, 0.996)
    uv.data.foreach_set("uv", np.stack([u, np.full_like(u, 0.5)], 1).ravel().astype(np.float32))
    me.polygons.foreach_set("use_smooth", np.full(len(me.polygons), smooth))
    me.update()
    return me


def grid_faces(n_rings, n_az, first=1):
    """Quads between consecutive rings (ring r starts at first + r * n_az) plus fans to the two poles."""
    faces = []
    last = first + (n_rings - 1) * n_az
    for j in range(n_az):
        faces.append((0, first + (j + 1) % n_az, first + j))
    for r in range(n_rings - 1):
        a, b = first + r * n_az, first + (r + 1) * n_az
        for j in range(n_az):
            j1 = (j + 1) % n_az
            faces.append((a + j, a + j1, b + j1, b + j))
    pole = last + n_az
    for j in range(n_az):
        faces.append((pole, last + j, last + (j + 1) % n_az))
    return faces


def curl_bun(name, chir, n_az=60, n_rings=36, m=2.3, Df=0.74, Db=0.46, P=0.50, A=0.15):
    """One carved curl: a rounded bun (radius 1, its face towards -Y, 1.16 deep), its face carved into a rolled
    spiral (Archimedean in rho^0.75, so the outer turns are broader, like his curls), crests rounded, grooves deep,
    the eye of the curl a small dimple, the rim smooth and pale. chir = +1 / -1 turns the spiral either way."""
    beta = np.linspace(0.0, np.pi, 6001)
    sb, cb = np.sin(beta), np.cos(beta)
    rho_p = np.abs(sb) ** (2.0 / m)
    D = np.where(cb >= 0, Df, Db)
    y_p = -D * np.sign(cb) * np.abs(cb) ** (2.0 / m)
    seg = np.hypot(np.diff(rho_p), np.diff(y_p))
    wt = np.where((cb[1:] > 0.05) & (rho_p[1:] < 0.94), 1.0, 0.45)       # rings dense on the carved face
    s = np.r_[0.0, np.cumsum(seg * wt)]
    rings = np.interp(np.linspace(0, s[-1], n_rings + 2)[1:-1], s, beta)    # without the two poles
    phi = np.arange(n_az) * 2 * np.pi / n_az
    B, PH = np.meshgrid(rings, phi, indexing="ij")
    sbB, cbB = np.sin(B), np.cos(B)
    rho = np.abs(sbB) ** (2.0 / m)
    DD = np.where(cbB >= 0, Df, Db)
    y = -DD * np.sign(cbB) * np.abs(cbB) ** (2.0 / m)
    P3 = np.stack([rho * np.cos(PH), y, rho * np.sin(PH)], -1)
    # normal of the base superellipsoid  rho^m + |y/D|^m = 1
    gr = m * rho ** (m - 1)
    gy = m * np.abs(y / DD) ** (m - 1) * np.sign(y) / DD
    N = np.stack([gr * np.cos(PH), gy, gr * np.sin(PH)], -1)
    N /= np.linalg.norm(N, axis=-1, keepdims=True)
    front = cbB > 0
    # the carving: a rolled tube spiralling in to an eye set off-centre (a curl, not a target), narrow deep grooves
    # between rounded turns, the turns broadening outwards
    ex, ez = 0.16 * chir, 0.10
    qx, qz = P3[..., 0] - ex, P3[..., 2] - ez
    rq = np.hypot(qx, qz)
    pq = np.arctan2(qz, qx)
    u = np.mod(rq ** 0.7 / P - chir * pq / (2 * np.pi) + 0.30, 1.0)
    tube = np.clip(1 - (2 * u - 1) ** 2, 0, 1) ** 0.4                   # 1 on a turn's crest, 0 in the groove
    w = ss(0.03, 0.13, rq) * (1 - ss(0.82, 0.96, rho)) * front
    eye = (1 - ss(0.0, 0.07, rq)) * front
    depth = A * (1 - tube) * w + 0.8 * A * eye
    P3 = P3 - N * depth[..., None]
    # lightness: the groove deep turquoise, the turns pale aqua with a white line along each crest, the uncarved
    # rim pale and luminous (where his curls catch the light), a touch lighter on top
    edge = np.minimum(u, 1 - u)
    Lc = 0.08 + 0.46 * ss(0.02, 0.22, edge) + 0.30 * np.exp(-((u - 0.5) / 0.10) ** 2)
    L = np.where(front, (1 - w) * 0.60 + w * Lc, 0.50)
    L = L * (1 - 0.9 * eye) + 0.06 * eye
    rim = ss(0.30, 0.85, 1 - np.abs(N[..., 1]))
    L = L + 0.22 * rim * (1 - w)
    L = L + 0.06 * N[..., 2]
    L = np.clip(L, 0.0, 1.0)
    pole = P3[0].mean(0)                                                # the front pole sits among its first ring
    pole[1] = min(pole[1], P3[0, :, 1].min())
    v = [pole] + list(P3.reshape(-1, 3)) + [np.array([0.0, Db, 0.0])]
    Lv = np.r_[L[0].mean(), L.ravel(), 0.50]
    return mesh_from(name, np.array(v), grid_faces(n_rings, n_az), Lv)


def wisp(name, n_seg=120, n_sides=10, span=1.45, rise=0.16, r0=0.15, thick=0.060):
    """A ribbon tail on the unit circle (local XY, centred on the origin) that thickens as it sweeps round and rises,
    then rolls up into a curl in the circle's tangent plane: the tail of the cloud in his hands."""
    n_arc = int(n_seg * 0.55)
    n_curl = n_seg - n_arc
    pts, out_dirs, radius = [], [], []
    for i in range(n_arc):
        t = i / (n_arc - 1)
        a = t * span
        pts.append(np.array([math.cos(a), math.sin(a), rise * (3 * t * t - 2 * t ** 3)]))
        out_dirs.append(np.array([math.cos(a), math.sin(a), 0.0]))
        radius.append(thick * (0.12 + 0.88 * t ** 0.75))
    end = pts[-1]
    tang = pts[-1] - pts[-2]
    tang /= np.linalg.norm(tang)
    up = np.array([0.0, 0.0, 1.0])
    up = up - tang * up.dot(tang)
    up /= np.linalg.norm(up)
    outward = np.array([math.cos(span), math.sin(span), 0.0])
    turns = 1.7
    for i in range(1, n_curl + 1):
        tau = i / n_curl * turns * 2 * math.pi
        r = r0 * (1 - 0.80 * tau / (turns * 2 * math.pi))
        sx, hz = r * math.sin(tau), r0 - r * math.cos(tau)
        pts.append(end + tang * sx + up * hz)
        out_dirs.append(outward)
        radius.append(thick * (1.0 - 0.55 * i / n_curl))
    pts = np.array(pts)
    out_dirs = np.array(out_dirs)
    radius = np.array(radius)
    T = np.gradient(pts, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    verts, Ls = [], []
    for k in range(len(pts)):
        n1 = out_dirs[k] - T[k] * out_dirs[k].dot(T[k])
        n1 /= np.linalg.norm(n1)
        n2 = np.cross(T[k], n1)
        for j in range(n_sides):
            a = 2 * math.pi * j / n_sides
            d = n1 * math.cos(a) * 1.0 + n2 * math.sin(a) * 0.75          # a ribbon: wider than it is deep
            dn = n1 * math.cos(a) + n2 * math.sin(a)
            verts.append(pts[k] + d * radius[k])
            crest = math.exp(-((math.cos(a) - 1) / 0.35) ** 2)            # a pale line along its outer face
            Ls.append(np.clip(0.42 + 0.22 * dn.dot(np.array([0, 0, 1.0])) + 0.38 * crest, 0, 1))
    faces = []
    for k in range(len(pts) - 1):
        for j in range(n_sides):
            j1 = (j + 1) % n_sides
            faces.append((k * n_sides + j, k * n_sides + j1, (k + 1) * n_sides + j1, (k + 1) * n_sides + j))
    c0 = len(verts)
    verts.append(pts[0]); Ls.append(0.5)
    c1 = len(verts)
    verts.append(pts[-1]); Ls.append(0.8)
    last = (len(pts) - 1) * n_sides
    for j in range(n_sides):
        faces.append((c0, (j + 1) % n_sides, j))
        faces.append((c1, last + j, last + (j + 1) % n_sides))
    return mesh_from(name, np.array(verts), faces, np.array(Ls))


def core_blob(name, n_az=56, n_el=34, p=CORE_P, seed=7):
    """The inner glow: a unit superellipsoid with soft lobes (scaled to CORE by its object)."""
    rng = np.random.default_rng(seed)
    lobes = rng.normal(size=(18, 3))
    lobes /= np.linalg.norm(lobes, axis=1, keepdims=True)
    th = np.linspace(0, np.pi, n_el + 2)[1:-1]
    ph = np.arange(n_az) * 2 * np.pi / n_az
    TH, PH = np.meshgrid(th, ph, indexing="ij")
    d = np.stack([np.sin(TH) * np.cos(PH), np.sin(TH) * np.sin(PH), np.cos(TH)], -1)

    def shape(dd):
        k = (np.abs(dd) ** p).sum(-1) ** (1 / p)
        bump = np.zeros(dd.shape[:-1])
        for c in lobes:
            bump += np.exp((dd @ c - 1) / 0.035)
        return dd / k[..., None] * (1 + 0.05 * np.tanh(bump))[..., None], bump

    P3, bump = shape(d)
    L = np.clip(0.66 + 0.26 * np.tanh(bump) + 0.06 * d[..., 2], 0, 1)
    top, _ = shape(np.array([0, 0, 1.0]))
    bot, _ = shape(np.array([0, 0, -1.0]))
    v = np.vstack([top[None], P3.reshape(-1, 3), bot[None]])
    return mesh_from(name, v, grid_faces(n_el, n_az), np.r_[0.8, L.ravel(), 0.6])


def ramp_image():
    """The colour ramp as a small PNG packed into the .blend (and exported as the base colour and emissive map)."""
    import tempfile
    old = bpy.data.images.get("magic_cloud_ramp")
    if old is not None:
        bpy.data.images.remove(old)
    tmp = bpy.data.images.new("magic_cloud_ramp_tmp", 256, 4, alpha=False)
    c = ramp_srgb(np.linspace(0, 1, 256))
    px = np.ones((4, 256, 4), np.float32)
    px[:, :, :3] = c[None]
    tmp.pixels.foreach_set(px.ravel())
    path = os.path.join(tempfile.gettempdir(), "magic_cloud_ramp.png")
    tmp.filepath_raw = path
    tmp.file_format = "PNG"
    tmp.save()
    bpy.data.images.remove(tmp)
    img = bpy.data.images.load(path)
    img.name = "magic_cloud_ramp"
    img.colorspace_settings.name = "sRGB"
    img.pack()
    os.remove(path)
    return img


def cloud_material():
    mat = bpy.data.materials.new("magic_cloud")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = ramp_image()
    tex.extension = "EXTEND"
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])     # the site's glow follows the ramp
    bsdf.inputs["Emission Strength"].default_value = 1.0                  # the site sets it from ctl_glow
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


# ───────────────────────────── the layout at its largest ─────────────────────────────

def superellipsoid_scale(d, H, p):
    return 1.0 / ((np.abs(d / np.asarray(H)) ** p).sum(-1) ** (1 / p))


def slots():
    """Where the curls settle: a Fibonacci spread on the shell (a superellipsoid round CENTRE), thinned out at the
    far back. Sizes vary (fuller round the middle and low down, smaller on top, a random spread) and the bigger
    curls stand further out, so the outline is a scalloped cumulus, not a wall of equal curls."""
    n = N_SLOTS
    rng = np.random.default_rng(5)
    k = np.arange(n) + 0.5
    zz = 1 - 2 * k / n
    rr = np.sqrt(1 - zz * zz)
    ph = k * math.pi * (3 - math.sqrt(5)) + 0.4
    d = np.stack([rr * np.cos(ph), rr * np.sin(ph), zz], 1)
    d = d[d[:, 1] < 0.35]
    base = d * superellipsoid_scale(d, SHELL, SHELL_P)[:, None]
    size = 0.31 + 0.08 * (1 - np.abs(d[:, 2])) - 0.06 * np.clip(d[:, 2], 0, 1) + rng.uniform(-0.07, 0.07, len(d))
    size = np.where(d[:, 1] > 0.25, size * 0.85, size)
    normal = base / np.asarray(SHELL) ** 2
    normal /= np.linalg.norm(normal, axis=1, keepdims=True)
    pos = base + normal * (size - 0.30)[:, None] * 0.9 + np.array(CENTRE)
    # full shoulders: six more curls over the top and its corners, so the cloud also hides the corners of his
    # bounding box (sun and bolt)
    extra = np.array([(-0.64, -0.32, 0.90), (0.60, -0.32, 0.90), (-0.60, 0.22, 0.92), (0.58, 0.22, 0.92),
                      (0.14, -0.26, 1.00), (-0.22, 0.12, 1.02)])
    pos = np.vstack([pos, extra])
    size = np.r_[size, [0.36, 0.36, 0.33, 0.33, 0.34, 0.32]]
    dx = extra - np.array(CENTRE)
    d = np.vstack([d, dx / np.linalg.norm(dx, axis=1, keepdims=True)])
    return pos, size, d


# ───────────────────────────── the motion ─────────────────────────────

def frames_all(B):
    return np.arange(B["glow"], B["end"] + 1, dtype=np.float64)


def swirl_angle(B, f):
    """The swirl (rad about the vertical axis through CENTRE): eases in as the curls leave his hands, peaks while
    they wind round him, eases down through luminous to a slow drift, and never stops dead."""
    fine = np.arange(B["glow"] - 2, B["end"] + 3, 0.25)
    peak = 0.95                                                     # rad/s
    w = peak * (ss(B["expand"], B["expand"] + 40, fine)
                - 0.90 * ss(B["luminous"] - 4, B["swap"] - 6, fine)
                - 0.05 * ss(B["dissipate"], B["complete"], fine))
    ang = np.r_[0.0, np.cumsum((w[1:] + w[:-1]) / 2 * 0.25 / FPS)]
    return np.interp(f, fine, ang)


def look_quat(fwd, roll):
    """Rotation that turns a curl's face (-Y) towards fwd, its top (+Z) as near world up as it goes, then rolls it
    by `roll` about its own face axis."""
    fwd = fwd / np.linalg.norm(fwd)
    yax = -fwd
    zax = np.array([0, 0, 1.0]) - yax * yax[2]
    zax /= np.linalg.norm(zax)
    xax = np.cross(yax, zax)
    M = Matrix((xax, yax, zax)).transposed()
    return M.to_quaternion() @ Quaternion((0, 1, 0), roll)


def held_seed(sc):
    """Where the seed is: the middle of the cloud in his hands (its bone), and the clump's spread there."""
    rig = bpy.data.objects[f"{YOUNG}_rig"]
    f0 = sc.frame_current
    sc.frame_set(sc.timeline_markers["glow"].frame + OFFSETS["expand"])
    p = rig.matrix_world @ rig.pose.bones["cloud"].head
    sc.frame_set(f0)
    return Vector(p)


def wrap2pi(x):
    return np.mod(x, 2 * math.pi)


def rot_z(v, ang):
    """Rotates points v (..., 3) about the vertical axis through CENTRE by ang (radians; scalar or per row)."""
    c, s_ = np.cos(ang), np.sin(ang)
    x, y = v[..., 0] - CENTRE.x, v[..., 1] - CENTRE.y
    return np.stack([CENTRE.x + c * x - s_ * y, CENTRE.y + s_ * x + c * y, v[..., 2]], -1)


def curl_tracks(B, seed, f):
    """Location, rotation and scale of every curl on every frame f (master frames).

    The cloud grows out of the cloud in his hands as one swelling mass: its middle drifts from his hands to the
    middle of the cloud while its front swells outwards, and each curl appears on that front, small, on the side
    of its place, then grows as it travels there, winding a little further round than the swirl (D) as it goes.
    The nearest places fill first and the top last, so his head is the last thing hidden. Everything rides the
    swirl (the frame turned by Phi), whose layout is exact at the swap."""
    pos_s, size, dirs = slots()
    n = len(size)
    rng = np.random.default_rng(11)
    Phi = swirl_angle(B, f)
    Phi = Phi - np.interp(B["swap"], f, Phi)
    seed = np.array(seed)
    C = np.array(CENTRE)
    # birth order: the nearest places first, the top last
    dist = np.linalg.norm(pos_s - seed, axis=1)
    key = 0.55 * (dist - dist.min()) / np.ptp(dist) + 0.45 * np.argsort(np.argsort(pos_s[:, 2])) / (n - 1)
    key = key + 0.03 * rng.standard_normal(n)
    rank = np.empty(n)
    rank[np.argsort(key)] = np.arange(n)
    t_b = B["expand"] + 40.0 * rank / (n - 1) + rng.uniform(-1.5, 1.5, n)
    t_s = np.minimum(t_b + rng.uniform(52, 62, n), B["luminous"] + 18)
    # the swelling mass the curls appear on
    grow_m = ss(B["expand"] - 4, B["luminous"], f)
    M = seed[None] + (C - seed)[None] * grow_m[:, None]
    r_front = 0.06 + 0.62 * ss(B["expand"] - 4, B["luminous"] + 6, f)
    # dissipation (after the inner glow has drawn back): the curls in front of his face and body go first, the
    # outer ones last
    front = -dirs[:, 1] * (1 - 0.5 * np.abs(dirs[:, 2]))
    order_d = np.argsort(np.argsort(-front + 0.3 * rng.standard_normal(n)))
    t_d = B["dissipate"] + 6 + 20.0 * order_d / (n - 1)
    d_len = rng.uniform(26, 32, n)
    chir = np.where(rng.random(n) < 0.5, 1, -1)
    roll0 = rng.uniform(0, 2 * math.pi, n)
    spin = rng.uniform(0.45, 0.75, n) * chir
    wind = -rng.uniform(0.35, 0.8, n)                  # each curl's own extra winding, always forwards
    bulge = rng.uniform(0.06, 0.14, n)
    out = []
    for i in range(n):
        tb, ts = t_b[i], t_s[i]
        T = ts - tb
        kb = float(np.interp(tb, f, np.arange(len(f))))
        Mb = np.array([np.interp(tb, f, M[:, k]) for k in range(3)])
        Sb = rot_z(pos_s[i], np.interp(tb, f, Phi))                     # its place, where it is at the birth
        dirb = Sb - Mb
        dirb /= max(np.linalg.norm(dirb), 1e-6)
        b = Mb + dirb * np.interp(tb, f, r_front)
        if np.linalg.norm(b - seed) < 0.02 or tb < B["expand"] + 6:
            b = seed + rng.normal(0, 1, 3) * np.array([0.05, 0.02, 0.03])
        bF = rot_z(b, -np.interp(tb, f, Phi))                           # in the turning frame
        e = ss(tb, ts, f)
        ep = ss(tb, tb + 0.9 * T, f)
        start = rot_z(bF, -wind[i])
        P = start[None] + (pos_s[i] - start)[None] * ep[:, None]
        outward = pos_s[i] - C                         # one direction for the whole trip (its path may cross the middle)
        outward[2] *= 0.4
        outward /= np.linalg.norm(outward)
        P = P + outward[None] * (bulge[i] * hump(tb, ts, f))[:, None]
        P = rot_z(P, wind[i] * (1 - e))
        dd = ss(t_d[i], t_d[i] + d_len[i], f)
        drift = pos_s[i] - C
        drift[2] *= 0.3
        drift /= np.linalg.norm(drift)
        P = P + drift[None] * (0.06 * dd)[:, None] + np.array([0, 0, 0.05])[None] * dd[:, None]
        loc = rot_z(P, Phi)
        # size: grows as it travels, a little swell before it settles; shrinks away without lingering as a speck
        g = ss(tb, tb + 0.85 * T, f) * (1 + 0.06 * hump(tb + 0.55 * T, ts + 10, f))
        g = g * (1 - dd) ** 2
        sc = size[i] * (2e-3 + (1 - 2e-3) * g)
        # orientation: its face turned towards a mix of outwards and the visitor, carried along without twisting
        # (parallel transport, no flips), and rolled about its own face as it swirls
        radial = (loc - C) / 0.45                         # near the middle it simply faces the visitor (smoothly)
        radial *= 1.15 / np.sqrt(1 + (radial ** 2).sum(1, keepdims=True))
        over = radial[:, 1] - 0.3                         # behind him it still faces this way (a soft limit)
        radial[:, 1] -= 0.5 * (over + np.sqrt(over * over + 0.04))
        fwd = radial + 0.75 * np.array([0, -1.0, 0])
        fwd /= np.linalg.norm(fwd, axis=1, keepdims=True)
        qb = look_quat(fwd[0], 0.0)
        Phib = float(np.interp(tb, f, Phi))
        rot, prev = [], None
        for k in range(len(f)):
            if k:
                qb = Vector(fwd[k - 1]).rotation_difference(Vector(fwd[k])) @ qb
            q = qb @ Quaternion((0, 1, 0), roll0[i] + spin[i] * (0.8 * (Phi[k] - Phib) - 1.5 * wind[i] * e[k]))
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            prev = q
            rot.append(tuple(q))
        scale = np.repeat(sc[:, None], 3, 1)
        scale[:, 0] *= chir[i]                         # mirrored: its spiral turns the other way
        out.append(dict(name=f"curl_{i:02d}", mesh="curl", loc=loc, rot=np.array(rot), scale=scale,
                        t_b=float(tb), t_s=float(ts), t_d=float(t_d[i])))
    return out


def core_track(B, seed, held_adult, f):
    """The inner glow swells inside the curls once they surround him (never seen as a blob of its own), and draws
    back into the cloud in Adult Coco's hands before the curls part."""
    grow = ss(B["engulf"] + 10, B["luminous"] + 24, f)
    shrink = ss(B["dissipate"], B["dissipate"] + 22, f)
    loc = np.array(CENTRE)[None] + (np.array(held_adult) - np.array(CENTRE))[None] * shrink[:, None]
    s = (2e-3 + (1 - 2e-3) * grow) * (1 - shrink * (1 - 2e-3))
    scale = np.array(CORE)[None] * s[:, None]
    rot = np.tile([1.0, 0, 0, 0], (len(f), 1))
    return dict(name="core", mesh="core", loc=loc, rot=rot, scale=scale)


WISPS = [
    # While swirling: height z, tilt (deg) about a horizontal axis at azimuth az (deg), radius R. While luminous
    # they tuck into the cloud (Rin). Those that stay settle round Adult Coco, low round his seat or behind his
    # shoulders (never across his face): height zend, tilt tiltend, radius Rend, the arc starting at angle aend
    # (deg from +X, anticlockwise from above; -90 is the front).
    dict(z=-0.55, tilt=10, az=20, R=1.18, stay=True, zend=-0.80, tiltend=4, Rend=1.00, aend=-150),
    dict(z=-0.05, tilt=-20, az=-30, R=1.20, stay=True, zend=-0.58, tiltend=-8, Rend=0.95, aend=10),
    dict(z=0.40, tilt=26, az=60, R=1.08, stay=True, zend=0.02, tiltend=8, Rend=0.95, aend=125),
    dict(z=0.80, tilt=-14, az=100, R=0.95, stay=False),
    dict(z=-0.35, tilt=-32, az=150, R=1.24, stay=False),
]
WISP_SPIN = 1.35            # the wisps ride the swirl a little faster than the curls
WISP_TUCK = 0.62            # their radius while the cloud is luminous (inside the curls)


def wisp_tracks(B, f):
    """Ribbon tails that stream round him with the swirl, tuck into the cloud while it is luminous (so the cloud is
    one clean form then), and come out again as it clears: three settle round Adult Coco and fade."""
    Phi = swirl_angle(B, f)
    Phi_end = Phi[-1]
    out = []
    for i, w in enumerate(WISPS):
        tb = B["expand"] + 14 + 5 * i
        born = ss(tb, tb + 34, f)
        tuck = ss(B["luminous"] - 12, B["luminous"] + 14, f)
        if w["stay"]:
            settle = ss(B["dissipate"] - 2, B["complete"] + 4, f)
            R = w["R"] + (WISP_TUCK - w["R"]) * tuck + (w["Rend"] - WISP_TUCK) * settle
            z = w["z"] + (w["zend"] - w["z"]) * settle
            tilt = w["tilt"] + (w["tiltend"] - w["tilt"]) * settle
            exist = born * (1 - 0.30 * ss(B["complete"] + 4, B["end"], f))
            phase = math.radians(w["aend"] - w["az"]) - WISP_SPIN * Phi_end      # az turns the whole plane
        else:
            R = w["R"] + (WISP_TUCK - w["R"]) * tuck
            z = np.full_like(f, w["z"])
            tilt = np.full_like(f, w["tilt"])
            exist = born * (1 - ss(B["luminous"] - 24, B["luminous"] + 14, f))
            phase = math.radians(70 * i)
        R = R * (0.20 + 0.80 * born)
        loc = np.stack([np.full_like(f, CENTRE.x), np.full_like(f, CENTRE.y), z], 1)
        rot, prev = [], None
        for k in range(len(f)):
            q = (Quaternion((0, 0, 1), math.radians(w["az"])) @ Quaternion((1, 0, 0), math.radians(tilt[k]))
                 @ Quaternion((0, 0, 1), WISP_SPIN * Phi[k] + phase + 0.9 * (1 - born[k])))
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            prev = q
            rot.append(tuple(q))
        s = R * np.maximum(exist, 2e-3)
        out.append(dict(name=f"wisp_{i}", mesh="wisp", loc=loc, rot=np.array(rot), scale=np.stack([s, s, s], 1)))
    return out


def glow_curve(B, f):
    """ctl_glow (0..1): the cloud is born glowing from the seed, glows most (softly) while luminous, less as it
    clears."""
    g = (FLOOR + (0.30 - FLOOR) * ss(B["glow"] + 8, B["expand"] + 6, f)
         + 0.14 * ss(B["expand"] + 6, B["luminous"], f)
         + 0.08 * ss(B["luminous"], B["swap"], f)
         - 0.20 * ss(B["swap"] + 4, B["complete"], f))
    return g


def fade_curve(B, f):
    """ctl_fade (opacity 0..1): in as the first curls leave his hands, out once only the last wisps are left."""
    return FLOOR + (1 - FLOOR) * ss(B["expand"] - 8, B["expand"] + 14, f) * (1 - ss(B["complete"] + 2, B["end"], f))


# ───────────────────────────── the luminous hold (a loop) ─────────────────────────────
# What plays while the trip home waits for the visitor (src/invitation/pace.ts HOLD_CLIP). It is made of the
# transform's OWN states between just before and just after 'luminous', played on a looping time map u(t):
#   rise     authored time runs on from luminous at full speed (pose and velocity equal the transform's there)
#            and eases to rest HOLD_RISE seconds later, once every curl has settled and the wisps have tucked in;
#   drift    it then drifts back very slowly (the swirl barely creeps), a little quicker in the last HOLD_DIVE s;
#   return   and in its last HOLD_RETURN seconds turns and runs forward again, reaching luminous at full speed
#            (it passes a few frames before luminous only for a moment, never lingering there).
# So frame 0 and the last frame equal the transform at luminous in pose and velocity, and every pose in between is
# one the transform itself passes through (Young Coco stays fully hidden; a crossfade back into the transform never
# cuts across the cloud). The wisps, tucked inside the curls, return over a shorter HOLD_RETURN_WISPS so their tails
# never peek out. Glow and opacity stay at their luminous values (both are at rest there).
HOLD = "luminous_hold"
HOLD_SECONDS = 12.0
HOLD_RISE = 0.6
HOLD_RETURN = 0.3
HOLD_RETURN_WISPS = 0.1
HOLD_RAMP = 2.0
HOLD_DIVE = 1.2
HOLD_CREEP = 0.1


def hold_time_map(B, ret, T=HOLD_SECONDS, rise=HOLD_RISE, ramp=HOLD_RAMP):
    """Authored master frame u for each hold frame 0..T*FPS (see above). u' is authored frames per frame."""
    n = int(round(T * FPS))
    fine = np.linspace(0.0, T, n * 16 + 1)
    up = 1 - ss(0, rise, fine)
    # back: a slow creep for most of the loop, a little quicker in its last HOLD_DIVE seconds, then straight into
    # the return (so it spends only a moment before luminous)
    back = (ss(rise, rise + ramp, fine) * (1 - ss(T - ret, T, fine))
            * (HOLD_CREEP + ss(T - ret - HOLD_DIVE, T - ret, fine)))
    fwd = ss(T - ret, T, fine)
    area = lambda v: float(np.sum((v[1:] + v[:-1]) / 2 * np.diff(fine)))
    r = (area(up) + area(fwd)) / area(back)
    v = up - r * back + fwd
    u = np.r_[0.0, np.cumsum((v[1:] + v[:-1]) / 2 * np.diff(fine))] * FPS
    u -= np.linspace(0, u[-1], len(u))                    # closes to rounding error (it is ~1e-12 already)
    return B["luminous"] + u[::16]


def channels_of(act, ob):
    """{(data_path, index): fcurve} of `ob` in a slotted action."""
    slot = next((s for s in act.slots if s.name_display == ob.name), None)
    if slot is None:
        return {}
    cb = act.layers[0].strips[0].channelbag(slot)
    return {(fc.data_path, fc.array_index): fc for fc in cb.fcurves} if cb else {}


def build_hold(B):
    sc = bpy.context.scene
    src = bpy.data.actions[ACTION]
    act = bpy.data.actions.new(HOLD)
    n = int(round(HOLD_SECONDS * FPS))
    f = np.arange(n + 1, dtype=np.float64)
    maps = {"curls": hold_time_map(B, HOLD_RETURN), "wisps": hold_time_map(B, HOLD_RETURN_WISPS)}
    for ob in bpy.data.collections[COLL].all_objects:
        chans = channels_of(src, ob)
        if not chans:
            continue
        u = maps["wisps" if ob.name.startswith("wisp_") else "curls"]
        ad = ob.animation_data
        prev_slot = ad.action_slot
        ad.action = act                                     # (keying needs the action assigned; put back below)
        for path in ("location", "rotation_quaternion", "scale"):
            idx = sorted(i for (p, i) in chans if p == path)
            if not idx:
                continue
            if ob.name.startswith("magic_ctl_"):           # glow and opacity: their luminous values, at rest there
                vals = np.array([[chans[(path, i)].evaluate(B["luminous"])] * len(f) for i in idx]).T
            else:
                vals = np.array([[chans[(path, i)].evaluate(x) for x in u] for i in idx]).T
            key_track(act, ob, f, path, vals, idx, periodic=True)
        ad.action = src
        ad.action_slot = prev_slot
        # exported as its own glTF animation: a muted NLA strip lets the exporter find it, without playing it
        tr = ob.animation_data.nla_tracks.get(HOLD) or ob.animation_data.nla_tracks.new()
        tr.name = HOLD
        for s in list(tr.strips):
            tr.strips.remove(s)
        st = tr.strips.new(HOLD, 0, act)
        st.action_slot = next(s for s in act.slots if s.name_display == ob.name)
        tr.mute = True
    act.use_frame_range = True
    act.frame_start, act.frame_end = 0, n
    act.use_cyclic = True
    log("hold", HOLD, f"{HOLD_SECONDS:g} s; authored frames", round(float(maps["curls"].min()), 2), "..",
        round(float(maps["curls"].max()), 2), "(wisps from", round(float(maps["wisps"].min()), 2), ")")


# ───────────────────────────── build ─────────────────────────────

def clear_previous():
    coll = bpy.data.collections.get(COLL)
    if coll:
        for ob in list(coll.all_objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        for c in list(coll.children_recursive):
            bpy.data.collections.remove(c)
        bpy.data.collections.remove(coll)
    for name in (ACTION, HOLD):
        act = bpy.data.actions.get(name)
        if act:
            bpy.data.actions.remove(act)
    for me in [m for m in bpy.data.meshes if m.name.split(".")[0] in ("curl", "curl_cw", "curl_ccw", "wisp", "core")]:
        if me.users == 0:
            bpy.data.meshes.remove(me)
    for mat in [m for m in bpy.data.materials if m.name.startswith("magic_cloud")]:
        if mat.users == 0:
            bpy.data.materials.remove(mat)


def key_track(act, ob, f, path, vals, indices=None, periodic=False):
    """Bezier keys on every frame whose handles carry the function's own slope (C1 at least, eased). periodic: the
    last frame equals the first (a loop), so their slope is the one across the seam."""
    vals = np.asarray(vals, dtype=np.float64)
    if vals.ndim == 1:
        vals = vals[:, None]
    der = np.gradient(vals, f, axis=0)
    if periodic:
        der[0] = der[-1] = (vals[1] - vals[-2]) / (f[1] - f[0]) / 2
    h = 1.0 / 3.0
    for k in range(vals.shape[1]):
        fc = act.fcurve_ensure_for_datablock(ob, path, index=k if indices is None else indices[k], group_name=ob.name)
        fc.keyframe_points.clear()
        kp = fc.keyframe_points
        kp.add(len(f))
        kp.foreach_set("co", np.stack([f, vals[:, k]], 1).ravel())
        kp.foreach_set("handle_left", np.stack([f - h, vals[:, k] - der[:, k] * h], 1).ravel())
        kp.foreach_set("handle_right", np.stack([f + h, vals[:, k] + der[:, k] * h], 1).ravel())
        for q in kp:
            q.interpolation = "BEZIER"
            q.handle_left_type = "FREE"
            q.handle_right_type = "FREE"
        fc.update()


def adult_box(sc=None):
    """Adult Coco's bounding box at rest (Blender axes), sun and bolt included: the union of the box measured on the
    sculpt (blender/sculpt/meshy-cloud-monkey-sage.glb) and on his web copy's meshes in coco-sage.blend."""
    lo = np.minimum([-0.69, -0.48, -0.95], [-0.689, -0.483, -0.948])
    hi = np.maximum([0.68, 0.48, 0.95], [0.683, 0.483, 0.951])
    return lo, hi


def adult_held_cloud():
    """The middle of the cloud in Adult Coco's hands (its bone in coco-sage.json), where the inner glow draws back to."""
    p = os.path.join(ROOT, "blender", "characters", "coco-sage.json")
    try:
        with open(p, encoding="utf-8") as fh:
            b = json.load(fh)["bones"]["cloud"]
        return (Vector(b[0]) + Vector(b[1])) / 2
    except Exception:
        return Vector((-0.05, -0.38, -0.2))


def beats(sc):
    glow = sc.timeline_markers["glow"].frame
    return {k: glow + v for k, v in OFFSETS.items()}


def build():
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.render.fps_base = 1.0
    clear_previous()
    B = beats(sc)
    if not (420 <= B["swap"] <= 540):
        log("WARNING: swap frame", B["swap"], "outside 420..540")
    seed = held_seed(sc)
    log("beats", B, "seed", tuple(round(x, 3) for x in seed))
    coll = bpy.data.collections.new(COLL)
    sc.collection.children.link(coll)
    mat = cloud_material()
    meshes = {"curl": curl_bun("curl", +1),
              "wisp": wisp("wisp"), "core": core_blob("core")}
    for me in meshes.values():
        me.materials.append(mat)
    root = bpy.data.objects.new(COLL, None)
    root.empty_display_type = "PLAIN_AXES"
    coll.objects.link(root)
    act = bpy.data.actions.new(ACTION)
    f = frames_all(B)
    held_adult = adult_held_cloud()
    tracks = [core_track(B, seed, held_adult, f)] + curl_tracks(B, seed, f) + wisp_tracks(B, f)
    for tr in tracks:
        ob = bpy.data.objects.new(tr["name"], meshes[tr["mesh"]])
        coll.objects.link(ob)
        ob.parent = root
        ob.rotation_mode = "QUATERNION"
        ob.animation_data_create()
        ob.animation_data.action = act
        key_track(act, ob, f, "location", tr["loc"])
        key_track(act, ob, f, "rotation_quaternion", tr["rot"])
        key_track(act, ob, f, "scale", tr["scale"])
    for name, curve, loc in (("magic_ctl_glow", glow_curve(B, f), (0.0, -0.9, 1.4)),
                             ("magic_ctl_fade", fade_curve(B, f), (0.1, -0.9, 1.4))):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "SPHERE"
        e.empty_display_size = 0.05
        e.location = loc
        e["$comment"] = ("Magic cloud " + ("glow" if "glow" in name else "opacity") +
                         ", 0..1, carried as scale.x (three.js cannot play material animation); exported as " +
                         name.replace("magic_", ""))
        coll.objects.link(e)
        e.parent = root
        e.animation_data_create()
        e.animation_data.action = act
        key_track(act, e, f, "scale", np.stack([curve], 1))
    act.use_frame_range = True
    act.frame_start, act.frame_end = B["glow"], B["end"]
    for name in ("expand", "engulf", "luminous", "dissipate", "complete"):
        mk = sc.timeline_markers.get(name) or sc.timeline_markers.new(name, frame=0)
        mk.frame = B[name]
    mk = sc.timeline_markers.get("swap") or sc.timeline_markers.new("swap", frame=0)
    mk.frame = B["swap"]
    sc["magic_cloud_beats"] = json.dumps(B)
    sc.frame_end = max(sc.frame_end, B["end"])
    build_hold(B)
    sc.frame_set(B["glow"])
    log("built", len(tracks), "animated objects;",
        {k: len(v.vertices) for k, v in meshes.items()}, "vertices per mesh")
    return B


# ───────────────────────────── export ─────────────────────────────

def export(B):
    os.makedirs(OUT_DIR, exist_ok=True)
    sc = bpy.context.scene
    coll = bpy.data.collections[COLL]
    young_glow = bpy.data.objects.get("ctl_glow")
    renamed = []
    try:
        if young_glow is not None:                     # the exported names must be ctl_glow / ctl_fade
            young_glow.name = "ctl_glow__young"
            renamed.append(young_glow)
        bpy.data.objects["magic_ctl_glow"].name = "ctl_glow"
        bpy.data.objects["magic_ctl_fade"].name = "ctl_fade"
        bpy.ops.object.select_all(action="DESELECT")
        for ob in coll.all_objects:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = bpy.data.objects[COLL]
        sc.frame_set(B["glow"])
        raw = GLB.replace(".glb", ".raw.glb")
        bpy.ops.export_scene.gltf(
            filepath=raw, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
            export_image_format="AUTO", export_extras=False, export_skins=False, export_morph=False,
            export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
            export_frame_step=1, export_optimize_animation_size=True, export_anim_slide_to_zero=True,
            export_reset_pose_bones=False, export_def_bones=False, export_leaf_bone=False)
    finally:
        bpy.data.objects["ctl_glow"].name = "magic_ctl_glow"
        bpy.data.objects["ctl_fade"].name = "magic_ctl_fade"
        for ob in renamed:
            ob.name = "ctl_glow"
    log("exported", raw, round(os.path.getsize(raw) / 1e3, 1), "KB")
    if "--cloud-raw-copy" in ARGV:
        import shutil
        shutil.copyfile(raw, ARGV[ARGV.index("--cloud-raw-copy") + 1])
    if "--no-optimize" in ARGV:
        os.replace(raw, GLB)
    else:
        cmd = ["node", os.path.join(ROOT, "scripts", "optimize-guide.mjs"), raw, GLB]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
        log(r.stdout.strip())
        if r.returncode != 0:
            log("optimiser not run:", r.stderr.strip()[-400:], "-> run: node scripts/optimize-guide.mjs", raw, GLB)
        else:
            # the hold loop's exact per-frame samples back (the optimiser's resample() would straighten its slow
            # drift into a few segments); the transform is left exactly as the optimiser made it
            cmd = ["node", os.path.join(ROOT, "scripts", "restore-clip-samples.mjs"), raw, GLB, "--only", HOLD,
                   "--cubic", "5e-5"]
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
            log(r.stdout.strip())
            if r.returncode != 0:
                log("samples not restored:", r.stderr.strip()[-400:], "-> run:", " ".join(cmd))
            else:
                os.remove(raw)
    write_timeline(B)


def write_timeline(B):
    tl = {}
    if os.path.exists(TIMELINE):
        with open(TIMELINE, encoding="utf-8") as fh:
            tl = json.load(fh)
    tl["fps"] = FPS
    markers = tl.get("markers", {})
    for k in ("expand", "engulf", "luminous", "dissipate", "complete"):
        markers[k] = int(B[k])
    tl["markers"] = markers
    rel = "models/invitation/magic-cloud.glb"                       # where the site loads it from
    tl.setdefault("clips", {})["transform"] = {
        "file": rel, "startFrame": int(B["glow"]), "endFrame": int(B["end"]),
        "note": "the magic cloud (blender/scripts/build_magic_cloud.py); its own time 0 is master frame startFrame"}
    tl["swapFrame"] = int(B["swap"])
    lo, hi = adult_box(bpy.context.scene)
    # Blender (x, y, z) -> glTF (x, z, -y)
    gmin = [round(float(lo[0]), 4), round(float(lo[2]), 4), round(float(-hi[1]), 4)]
    gmax = [round(float(hi[0]), 4), round(float(hi[2]), 4), round(float(-lo[1]), 4)]
    tl["adultBox"] = [gmin, gmax]
    tl["cloud"] = {
        "$comment": "The magic cloud (blender/scripts/build_magic_cloud.py), in the same frame as Young Coco (glTF "
                    "axes, metres). Young Coco and Adult Coco are fully hidden from swapFrame-8 to swapFrame+6 "
                    "(coverage masks with the site's camera). ctl_glow and ctl_fade carry glow and opacity as "
                    "scale.x. adultBox: Adult Coco seated at the same origin, sun and bolt included.",
        "hiddenFrom": int(B["swap"]) - 8, "hiddenTo": int(B["swap"]) + 6,
        "centre": [round(CENTRE.x, 4), round(CENTRE.z, 4), round(-CENTRE.y, 4)],
    }
    with open(TIMELINE, "w", encoding="utf-8") as fh:
        json.dump(tl, fh, indent=2)
    log("wrote", TIMELINE)


# ───────────────────────────── main ─────────────────────────────

def run_in_scene(save_to=None, do_export=True):
    """Builds the cloud in the open scene (invitation.blend), saves it, exports. build_invitation.py calls this."""
    B = build()
    path = save_to or BLEND
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)
    log("saved", path)
    if do_export:
        export(B)
    return B


def main():
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    out = ARGV[ARGV.index("--blend-out") + 1] if "--blend-out" in ARGV else None
    run_in_scene(out, "--no-export" not in ARGV)


if __name__ == "__main__":
    main()
