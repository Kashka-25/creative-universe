"""Build Adult Coco, the closed-eyed sage with the sun and lightning, for the Home page.

    blender --background --factory-startup --python blender/scripts/build_coco_sage.py -- coco-sage [options]

    It builds coco-sage only: any other name is refused (the output paths come from the name, and coco and
    little-coco belong to other builds).

    options
      --rebuild-web       redo stage 1 (import, split, simplify) even when its cache exists
      --stage web|all     stop after stage 1, or run everything (default)
      --raw <file.glb>    where to keep the unoptimised export (default: a temporary file)
      --no-optimize       skip node scripts/optimize-guide.mjs

Run it from the project folder (character_prep.py, whose face helpers it reuses, reads
blender/characters/coco-sage.json relative to the working folder).

Reads blender/characters/coco-sage.json and blender/sculpt/meshy-cloud-monkey-sage.glb (never changed).
Writes:
  blender/characters/coco-sage-web.blend    stage 1 cache: the sculpt split and simplified for the web
  blender/characters/coco-sage.blend        rigged, with face shapes and every clip, to keep working on by hand
  public/models/characters/coco-sage.glb    the web copy, optimised with meshopt (clips kept exact)

What it does, in order:
  1. Web copy (stage 1). Imports Cassidy's sculpt (3.18M triangles), welds its UV seams and splits it
     by loose parts into him (with the held cloud and the leg swirls fused on), the sun and lightning
     bolt, and the swirl beside his hat. He is simplified to about 150k triangles region by region, each
     region to its own budget and by shape alone inside it: his face, his gold jewellery, the clouds, his
     skin (hands, feet, ears) and the rest, mostly the sculpted fur, which gets what is left, so its tufts
     survive on HiDPI screens. The sun goes to 6k triangles and the swirl
     to 4k. Nothing is re-modelled: the geometry and the textures are the sculpt's own.
  2. Skin weights. A hand-built rig of limb-aligned bones (contract names, plus shoulder_L/R, belly,
     cloud and swirl_head). Weights are inverse-distance to the bone segments, smoothed, and region
     aware: the legs, feet and the swirls fused to them stay rigid on root; the held cloud is rigid on
     'cloud' (with any rim vertex the smoothing gave mostly to 'cloud'); his hands are rigid on
     hand_L/R (and those stay put on the cloud); small cloud pieces on his arm and chest ride with the
     fur they touch; ears and earrings follow the head; the beard follows the chin; the cyan third eye
     is part of his face, never a cloud.
  3. Face. His face is cut out (character_prep's face ellipse) and given shape keys: the standard
     shapes that make sense with closed eyes, plus closed-eye life shapes (lidSqueeze, browSoft,
     microSmile, nostril) sized so each moves its feature 1.5-3 px when he is 400 px tall. Every shape
     fades to nothing before the cut, so the seam never opens, and moves the third eye as one piece.
     The third eye has its own material, 'third_eye' (same texture, a small emission the site can raise).
  4. Clips at 30 fps, each its own glTF animation: breathe (5 s loop), settle (into breathe frame 0,
     pose and velocity matched), and additive drift_a/b/c, flutter, react_left/right/smile (zero at
     both ends; the site layers them on breathe), and float (an additive 7 s loop:
     his whole self, sun, bolt and swirls included, rises and settles a few cm with a slight sway about a
     pivot in his middle; it moves the root bone, and the sun and bolt are skinned rigidly to the root). Curves come from smooth (C2) functions of the
     settings below, keyed on every frame with Bezier keys, so loops and joins are seamless. The arms
     are solved every frame so his hands never leave the cloud; the swirl beside his hat follows his
     head so the two never touch.
  4b. Living details (coco_sage_life.py, 9 Nov 2026): the sun and bolt come to life on a 'sun' bone and their own
     materials ('radiance', a 40 s loop), the third eye blinks on a 'third_eye' bone ('thirdeye', a 32 s loop), and
     for the welcome his open eyes are two cards made from Cassidy's open-eyed sculpt (prep_coco_eyes.py), revealed
     as his lids part ('awaken'). Glow and the eyes' opening travel as the X scale of control bones ctl_sun,
     ctl_bolt, ctl_eye and ctl_eyes (value = scale.x - 1), which the site turns into material settings.
  5. Export (skins, shape keys, every action), optimise with scripts/optimize-guide.mjs, then put the
     exact per-frame samples back with scripts/restore-clip-samples.mjs: the optimiser's resample()
     straightens slow curves (a 4 mm breath became a triangle wave with a kink at every kept key) and
     its lossy filters add sub-millimetre frame-to-frame noise.

Bones point along the limbs and each roll puts the main bend on local X: spine chain and head (bow =
+X), shoulders (shrug up = +X on both sides), arms and legs (elbow/knee hinge). Directions in the
clips are his own: react_left turns his head to HIS left (the viewer's right, +X).
"""

import functools
import builtins
import json
import math
import os
import subprocess
import sys
import tempfile
import time

import bpy
import bmesh
import numpy as np
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coco_sage_life as life  # noqa: E402  (the sun and bolt, the third eye, the open eyes, their clips)

print = functools.partial(builtins.print, flush=True)  # noqa: A001  (progress shows up while Blender works)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
# This script builds Adult Coco only. Every output path comes from NAME, so any other name could land on
# another character's files (coco, little-coco): refuse it rather than overwrite them.
NAME = "coco-sage"
if ARGS and not ARGS[0].startswith("--") and ARGS[0] != NAME:
    raise SystemExit(f"build_coco_sage.py builds '{NAME}' only (asked for '{ARGS[0]}'); nothing was written")


def _opt(flag, default=None):
    return ARGS[ARGS.index(flag) + 1] if flag in ARGS else default


with open(os.path.join(ROOT, "blender", "characters", f"{NAME}.json"), encoding="utf-8") as fh:
    CFG = json.load(fh)
SCULPT = os.path.join(ROOT, "blender", "sculpt", CFG["source"])
WEB_BLEND = os.path.join(ROOT, "blender", "characters", f"{NAME}-web.blend")
OUT_BLEND = os.path.join(ROOT, "blender", "characters", f"{NAME}.blend")
OUT_GLB = os.path.join(ROOT, "public", "models", "characters", f"{NAME}.glb")
FPS = CFG.get("fps", 30)
T0 = time.time()


def log(*a):
    print(f"[{NAME} {time.time() - T0:6.1f}s]", *a)


# ── small maths helpers (numpy) ──────────────────────────────────────────

def s5(x):
    """Smootherstep: 0..1 with zero velocity and acceleration at both ends (C2)."""
    x = np.clip(x, 0.0, 1.0)
    return x * x * x * (x * (6 * x - 15) + 10)


def sstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mesh_arrays(me):
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    ls = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(len(me.polygons), np.int32)
    me.polygons.foreach_get("loop_total", lt)
    assert (lt == 3).all(), "expected a triangulated mesh"
    return co.reshape(-1, 3), lv.reshape(-1, 3)


def base_image(me):
    bsdf = next(n for n in me.materials[0].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    return bsdf.inputs["Base Color"].links[0].from_node.image


def face_colours(me):
    """Base colour at each triangle's UV centre."""
    img = base_image(me)
    W, H = img.size
    px = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)[:, :, :3]
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    u = uv.reshape(-1, 3, 2).mean(1)
    return px[((u[:, 1] % 1) * (H - 1)).astype(np.int32), ((u[:, 0] % 1) * (W - 1)).astype(np.int32)]


def hsv(rgb):
    """Hue (degrees), saturation and value of an (N, 3) colour array."""
    mx, mn = rgb.max(1), rgb.min(1)
    s = (mx - mn) / np.maximum(mx, 1e-6)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = rgb.T
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, s, mx


def cloud_mask(rgb):
    """Cloud colours: turquoise, or near-white with a cool tint."""
    h, s, v = hsv(rgb)
    return ((h >= 160) & (h <= 215) & (s > 0.18) & (v > 0.35)) | ((s < 0.18) & (v > 0.75) & (rgb[:, 2] >= rgb[:, 0] - 0.02))


def skin_mask(rgb):
    """His peach skin (face, ears, hands, feet)."""
    h, s, v = hsv(rgb)
    return (h >= 15) & (h <= 40) & (s < 0.62) & (v >= 0.55)


def gold_mask(rgb):
    """His gold jewellery: the ear hoops and the pendant (the sun is a separate part by then)."""
    h, s, v = hsv(rgb)
    return (h > 40) & (h <= 62) & (s > 0.45) & (v > 0.45)


def in_face(p):
    F = CFG["face"]
    return (np.hypot((p[:, 0] - F["cx"]) / F["rx"], (p[:, 2] - F["cz"]) / F["rz"]) < 1.0) & (p[:, 1] < F["front"])


def save_blend(path):
    bpy.context.preferences.filepaths.save_version = 0      # the build is re-runnable: no .blend1 backups
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)


def select_only(obj):
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)


# ── 1. web copy ──────────────────────────────────────────────────────────

def decimate(obj, target, keep=None):
    n = len(obj.data.polygons)
    if keep is not None:
        g = obj.vertex_groups.new(name="keep")
        nz = np.nonzero(keep > 0)[0]
        for wv in np.unique(np.round(keep[nz], 2)):
            g.add(nz[np.round(keep[nz], 2) == wv].tolist(), float(wv), "REPLACE")
    mod = obj.modifiers.new("decimate", "DECIMATE")
    mod.ratio = min(1.0, target / n)
    mod.use_collapse_triangulate = True
    if keep is not None:
        mod.vertex_group = "keep"
        mod.invert_vertex_group = True
        mod.vertex_group_factor = CFG["web"]["protect"]["factor"]
    select_only(obj)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if "keep" in obj.vertex_groups:
        obj.vertex_groups.remove(obj.vertex_groups["keep"])
    log("simplified", obj.name, n, "->", len(obj.data.polygons), "tris")


def import_split():
    """The sculpt imported, welded and split into him, the sun and bolt, and the swirl beside his hat."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SCULPT)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    O = meshes[0]
    log("imported", len(O.data.vertices), "verts", len(O.data.polygons), "tris")
    bm = bmesh.new()
    bm.from_mesh(O.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=5e-5)      # the sculpt's UV seams split every vertex
    bm.to_mesh(O.data)
    bm.free()
    log("welded", len(O.data.vertices), "verts")
    select_only(O)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = sorted([o for o in bpy.context.scene.objects if o.type == "MESH"], key=lambda o: -len(o.data.polygons))
    assert len(parts) == 3, f"expected 3 loose parts (him, sun+bolt, head swirl), got {len(parts)}"
    body, rest = parts[0], parts[1:]

    def ymin(o):
        return min(v.co.y for v in o.data.vertices)
    sun = max(rest, key=ymin)                       # the sun and bolt stand behind him (y > 0.3)
    swirl = next(o for o in rest if o is not sun)
    body.name, sun.name, swirl.name = f"{NAME}_body", "sun_bolt", "swirl_head_mesh"
    for o in (body, sun, swirl):
        o.data.name = o.name
    log("parts", [(o.name, len(o.data.polygons)) for o in (body, sun, swirl)])
    return body, sun, swirl


REGIONS = ("rest", "face", "gold", "clouds", "skin", "gem")


def web_regions(me):
    """Per vertex, which simplification budget it belongs to (an index into REGIONS): his face (the face cut
    plus a margin, so the seam's surroundings match it), his gold jewellery, the clouds (held cloud and leg
    swirls), his skin (hands, feet, ears: smooth, so coarse triangles would show as facets), the third eye
    (never simplified: it is a small UV island, and collapsing across its outline tears its painted corner)
    and the rest of him (the fur, robe and hat)."""
    co, tv = mesh_arrays(me)
    rgb = face_colours(me)
    F, R = CFG["face"], CFG["web"]["faceRegion"]
    budget = CFG["web"]["budget"]
    reg = np.zeros(len(co), np.int8)
    if budget.get("skin"):                           # without a budget, the skin stays part of the rest
        reg[tv[skin_mask(rgb)].ravel()] = REGIONS.index("skin")
    reg[tv[cloud_mask(rgb)].ravel()] = REGIONS.index("clouds")
    reg[tv[gold_mask(rgb)].ravel()] = REGIONS.index("gold")
    dd = np.hypot((co[:, 0] - F["cx"]) / (F["rx"] * R["scale"]), (co[:, 2] - F["cz"]) / (F["rz"] * R["scale"]))
    reg[(dd < 1.0) & (co[:, 1] < F["front"] + R["depth"])] = REGIONS.index("face")
    gm = CFG["gem"]
    gd = np.hypot((co[:, 0] - gm["centre"][0]) / gm["rx"], (co[:, 2] - gm["centre"][1]) / gm["rz"])
    reg[(gd < CFG["web"]["keepGem"]) & (co[:, 1] < F["front"])] = REGIONS.index("gem")     # no budget: kept whole
    return reg, tv


def simplify_by_budget(obj):
    """Simplify him region by region, each to its own triangle budget (CFG web.budget; the rest of him gets
    whatever is left of web.tris). Inside a region the simplifier is guided by shape alone (quadric error);
    every other region is locked meanwhile. A single pass with protection weights would not do this: the
    protection term (edge length x weight) dwarfs the shape error, so protected areas were only touched
    once the rest was exhausted, and the fur, three quarters of the sculpt, was left 18k of 90k triangles.
    Triangles that straddle two regions ('borders' in the log) trace the region outlines and count towards no
    budget; they come out of what is left for the rest."""
    budget = CFG["web"]["budget"]
    for name in [r for r in REGIONS if budget.get(r)]:
        reg, tv = web_regions(obj.data)
        i = REGIONS.index(name)
        n_in, n = int((reg[tv] == i).all(1).sum()), len(tv)
        if n_in > budget[name]:
            decimate(obj, n - (n_in - budget[name]), np.where(reg == i, 0.0, 1.0))
        log(f"  {name}: {n_in} -> {min(n_in, budget[name])} tris")
    reg, tv = web_regions(obj.data)
    decimate(obj, CFG["web"]["tris"], np.where(reg == REGIONS.index("rest"), 0.0, 1.0))
    reg, tv = web_regions(obj.data)
    per = {r: int((reg[tv] == i).all(1).sum()) for i, r in enumerate(REGIONS)}
    per["borders"] = len(tv) - sum(per.values())
    log("  per region:", per)


def loop_uvs(me):
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    return uv.reshape(-1, 3, 2)


def sculpt_reference(me):
    """What the sculpt looks like where: its triangles, their UVs and colours, and a KD tree of their centres."""
    from mathutils.kdtree import KDTree
    co, tv = mesh_arrays(me)
    cen = co[tv].mean(1)
    kd = KDTree(len(cen))
    for i, p in enumerate(cen):
        kd.insert(p, i)
    kd.balance()
    return {"co": co, "tv": tv, "uv": loop_uvs(me), "rgb": face_colours(me), "kd": kd}


def texture_mismatch(me, uv, ref, tris, px):
    """For each triangle: how far the texture under its UVs (centre and halfway to each corner) is from the
    sculpt's own colours on the same spot (its 24 nearest triangles). 0 = a colour the sculpt has there."""
    H, W = px.shape[:2]
    co, tv = mesh_arrays(me)
    u = uv[tris]
    m = u.mean(1)
    samples = [m] + [(m + u[:, k]) / 2 for k in range(3)]
    cols = np.stack([px[((s[:, 1] % 1) * (H - 1)).astype(np.int32), ((s[:, 0] % 1) * (W - 1)).astype(np.int32)] for s in samples], 1)
    cen = co[tv[tris]].mean(1)
    out = np.zeros(len(tris))
    for k in range(len(tris)):
        near = ref["rgb"][[j for (_, j, _) in ref["kd"].find_n(cen[k], 24)]]
        out[k] = np.linalg.norm(cols[k][:, None, :] - near[None], axis=2).min(1).max()
    return out


def sculpt_uv_at(ref, p):
    """The sculpt's UV at the surface point nearest to p (among the triangles round it)."""
    from mathutils import geometry
    best, uv = 1e9, None
    for _, j, _ in ref["kd"].find_n(p, 12):
        a, b, c = (Vector(ref["co"][v]) for v in ref["tv"][j])
        q = geometry.closest_point_on_tri(Vector(p), a, b, c)
        d = (q - Vector(p)).length
        if d < best:
            ua, ub, uc = (Vector((x, y, 0.0)) for x, y in ref["uv"][j])
            best, uv = d, geometry.barycentric_transform(q, a, b, c, ua, ub, uc).xy
    return np.array(uv, np.float32)


def retexture_strays(obj, ref):
    """Simplifying moves vertices across the sculpt's UV seams (its fur has thousands of UV islands), so now
    and then a triangle's UVs reach into a neighbouring island and it shows the wrong paint (a yellow fleck
    in his beard, a notch in the third eye). Such triangles take their UVs from the sculpt again: each
    corner from the nearest point of the sculpt's surface or, when the corners land on different islands,
    the whole triangle from the paint under its middle, whichever matches the sculpt's colours there best."""
    me = obj.data
    co, tv = mesh_arrays(me)
    uv = loop_uvs(me)
    img = base_image(me)
    W, H = img.size
    px = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(H, W, 4)[:, :, :3]
    thr = CFG["web"]["strayPaint"]
    every = np.arange(len(tv))
    m0 = texture_mismatch(me, uv, ref, every, px)
    bad = every[m0 > thr]
    P = co[tv[bad]]
    cen = P.mean(1)
    corner = np.stack([[sculpt_uv_at(ref, cen[k] + 0.8 * (P[k, i] - cen[k])) for i in range(3)] for k in range(len(bad))]) if len(bad) else np.zeros((0, 3, 2), np.float32)
    middle = np.stack([sculpt_uv_at(ref, c) for c in cen]) if len(bad) else np.zeros((0, 2), np.float32)
    flat = np.repeat(middle[:, None, :], 3, 1)
    uvA, uvB = uv.copy(), uv.copy()
    uvA[bad], uvB[bad] = corner, flat
    mA = texture_mismatch(me, uvA, ref, bad, px)
    mB = texture_mismatch(me, uvB, ref, bad, px)
    choice = np.where(mA <= thr, 1, np.where(mB < np.minimum(m0[bad], mA), 2, np.where(mA < m0[bad], 1, 0)))
    uv[bad[choice == 1]] = corner[choice == 1]
    uv[bad[choice == 2]] = flat[choice == 2]
    me.uv_layers.active.data.foreach_set("uv", uv.ravel())
    after = np.maximum(np.where(choice == 1, mA, np.where(choice == 2, mB, m0[bad])), 0)
    A = 0.5 * np.linalg.norm(np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]), axis=1)
    log(f"stray paint: {len(bad)} triangles ({A.sum() * 1e4:.0f} cm2) off the sculpt's colours; {int((choice == 1).sum())} re-mapped "
        f"corner by corner, {int((choice == 2).sum())} from the paint under their middle; still off: {int((after > thr).sum())} "
        f"({A[after > thr].sum() * 1e4:.1f} cm2)")


def build_web():
    body, sun, swirl = import_split()
    ref = sculpt_reference(body.data)
    simplify_by_budget(body)
    body.data.validate()
    retexture_strays(body, ref)
    del ref
    decimate(sun, CFG["web"]["sunTris"])
    decimate(swirl, CFG["web"]["swirlTris"])
    for o in (body, sun, swirl):
        o.data.validate()                            # simplifying can leave a duplicate triangle
        o.data.polygons.foreach_set("use_smooth", [True] * len(o.data.polygons))
    size = CFG["web"]["texture"]
    for img in bpy.data.images:
        if img.size[0] > size:
            img.scale(size, size)
        if img.size[0] > 0 and not img.packed_file:
            img.pack()
    save_blend(WEB_BLEND)
    log("saved", WEB_BLEND)


# ── 2. regions and skin weights ──────────────────────────────────────────

def components(tv, mask, nv):
    """Connected pieces of the triangles in mask (sharing vertices). Returns per-triangle label (-1 outside)."""
    t = tv[mask]
    e = np.concatenate([t[:, [0, 1]], t[:, [1, 2]]])
    lab = np.arange(nv)
    for _ in range(2000):
        m = np.minimum(lab[e[:, 0]], lab[e[:, 1]])
        new = lab.copy()
        np.minimum.at(new, e[:, 0], m)
        np.minimum.at(new, e[:, 1], m)
        for _ in range(4):
            new = new[new]
        if (new == lab).all():
            break
        lab = new
    out = np.full(len(tv), -1, np.int64)
    out[mask] = lab[tv[mask, 0]]
    return out


def seg_dist(P, a, b):
    a, b = np.asarray(a, np.float64), np.asarray(b, np.float64)
    ab = b - a
    t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


def classify(me):
    """Per vertex: 0 his body, 1 held cloud, 2 swirls fused to legs/feet (static), 3 small attached cloud pieces.

    Also returns the piece label for category-3 vertices (to give each piece one rigid set of weights)."""
    co, tv = mesh_arrays(me)
    cent = co[tv].mean(1)
    cm = cloud_mask(face_colours(me))
    gm = CFG["gem"]
    gem = np.hypot((cent[:, 0] - gm["centre"][0]) / (gm["rx"] * 1.6), (cent[:, 2] - gm["centre"][1]) / (gm["rz"] * 1.8)) < 1.0
    cm &= ~(in_face(cent) | gem)                     # the third eye is cyan but it is his face
    lab = components(tv, cm, len(co))
    R = CFG["regions"]
    lo, hi = np.array(R["heldBox"][0]), np.array(R["heldBox"][1])
    fcat = np.zeros(len(tv), np.int8)
    piece = np.full(len(tv), -1, np.int64)
    ul, cnt = np.unique(lab[cm], return_counts=True)
    inbox = ((cent >= lo) & (cent <= hi)).all(1)
    # the held cloud: the biggest piece with most of its triangles inside heldBox
    held = max(ul, key=lambda k: ((lab == k) & inbox).sum())
    for k, n in zip(ul, cnt):
        m = lab == k
        if k == held:
            fcat[m] = 1
        elif cent[m, 2].mean() < R["staticBelowZ"]:
            fcat[m] = 2
        else:
            fcat[m] = 3
            piece[m] = k
    vcat = np.zeros(len(co), np.int8)
    vpiece = np.full(len(co), -1, np.int64)
    m3 = fcat == 3
    vpiece[tv[m3].ravel()] = np.repeat(piece[m3], 3)
    for c in (3, 2, 1):                              # a vertex shared by two kinds goes to the more rigid one
        vcat[tv[fcat == c].ravel()] = c
    log("regions (tris): body", int((fcat == 0).sum()), "held cloud", int((fcat == 1).sum()),
        "leg swirls", int((fcat == 2).sum()), "small pieces", int((fcat == 3).sum()), f"({len(set(piece[fcat == 3].tolist()))})")
    return co, tv, vcat, vpiece


def bone_table():
    """name -> (head, tail, parent) in Blender metres, with swirl_head measured from its mesh."""
    out = {}
    for n, v in CFG["bones"].items():
        if n.startswith("$"):
            continue
        out[n] = v
    sw = bpy.data.objects["swirl_head_mesh"].data
    p, _ = mesh_arrays(sw)
    zl, zh = np.percentile(p[:, 2], 4), np.percentile(p[:, 2], 96)
    base = p[p[:, 2] <= zl].mean(0)
    top = p[p[:, 2] >= zh].mean(0)
    out["swirl_head"] = [base.round(4).tolist(), top.round(4).tolist(), out["swirl_head"][2]]
    return out


def compute_weights(me, bones):
    co, tv, vcat, vpiece = classify(me)
    P = co.astype(np.float64)
    names = list(bones.keys())
    ix = {n: i for i, n in enumerate(names)}
    W = np.zeros((len(P), len(names)), np.float64)
    R = CFG["regions"]
    # Region shares. Each limb claims what lies within its own radius of its bones (his forearms rest right in
    # front of his belly, so plain inverse distance would hand belly fur to the arms); his hands also claim
    # every skin-coloured vertex round the cloud (the raised thumbs). The legs (thigh and shin segments) go to
    # root. The torso gets the rest.
    rad = R["limbRadius"]

    def membership(segs):
        m = np.zeros(len(P))
        for n, kind in segs:
            m = np.maximum(m, 1 - sstep(rad[kind][0], rad[kind][1], seg_dist(P, bones[n][0], bones[n][1])))
        return m

    hb = np.array(R["handBox"])
    hand_skin = np.zeros(len(P), bool)
    hand_skin[tv[skin_mask(face_colours(me))].ravel()] = True
    hand_skin &= ((P >= hb[0]) & (P <= hb[1])).all(1)
    arm = {}
    for s in ("L", "R"):
        arm[s] = membership([(f"upperarm_{s}", "upperarm"), (f"forearm_{s}", "forearm"), (f"hand_{s}", "hand")])
    dl = seg_dist(P, bones["hand_L"][0], bones["hand_L"][1])
    dr = seg_dist(P, bones["hand_R"][0], bones["hand_R"][1])
    arm["L"] = np.where(hand_skin & (dl <= dr), 1.0, arm["L"])
    arm["R"] = np.where(hand_skin & (dr < dl), 1.0, arm["R"])
    leg = membership([("thigh_L", "thigh"), ("shin_L", "shin"), ("thigh_R", "thigh"), ("shin_R", "shin")])
    torso = (1 - arm["L"]) * (1 - arm["R"]) * (1 - leg)
    tot = arm["L"] + arm["R"] + leg + torso

    def idw(group):
        sc = np.stack([1.0 / (seg_dist(P, bones[n][0], bones[n][1]) ** 6 + 1e-9) for n in group], 1)
        top = np.argsort(-sc, 1)[:, :3]
        rows = np.arange(len(P))[:, None]
        tvv = sc[rows, top]
        tvv = tvv / tvv.sum(1, keepdims=True)
        tvv[tvv < 0.02] = 0
        out = np.zeros_like(sc)
        out[rows, top] = tvv
        return out / np.maximum(out.sum(1, keepdims=True), 1e-9)

    for s in ("L", "R"):
        grp = [f"upperarm_{s}", f"forearm_{s}", f"hand_{s}"]
        W[:, [ix[n] for n in grp]] += (arm[s] / tot)[:, None] * idw(grp)
    W[:, ix["root"]] += leg / tot
    # torso: bands up his spine (hips, spine, chest, neck), the outer top of the chest to the shoulders
    tb = R["torsoBands"]
    z, ax = P[:, 2], P[:, 0] - bones["spine"][0][0]
    h_sp = sstep(*tb["hipsToSpine"], z)
    sp_ch = sstep(*tb["spineToChest"], z)
    ch_nk = sstep(*tb["chestToNeck"], z)
    band = {"hips": 1 - h_sp, "spine": h_sp * (1 - sp_ch), "chest": sp_ch * (1 - ch_nk), "neck": sp_ch * ch_nk}
    sh = sstep(*tb["shoulderX"], np.abs(ax)) * sstep(*tb["shoulderZ"], z)
    for s, side in (("L", ax > 0), ("R", ax <= 0)):
        band[f"shoulder_{s}"] = np.where(side, sh * (band["chest"] + band["neck"]), 0.0)
    band["chest"] = band["chest"] * (1 - sh)
    band["neck"] = band["neck"] * (1 - sh)
    for n, w in band.items():
        W[:, ix[n]] += torso / tot * w
    # head: above a plane that dips at the front, so the beard goes with his chin
    hp = R["headPlane"]
    zb = hp["z0"] + hp["slope"] * (P[:, 1] + 0.35)
    k = sstep(zb - hp["band"], zb + hp["band"], P[:, 2])
    ez = R["earZone"]
    ear = (np.abs(P[:, 0] - bones["head"][0][0]) > ez["minAbsX"]) & (P[:, 1] > ez["y"][0]) & (P[:, 1] < ez["y"][1])
    k = np.where(ear, np.maximum(k, sstep(ez["z"][0], ez["z"][1], P[:, 2])), k)
    W *= (1 - k)[:, None]
    W[:, ix["head"]] += k
    # below baseZ: legs, feet and the seat stay on root
    base = sstep(CFG["baseZ"] + 0.03, CFG["baseZ"] - 0.03, P[:, 2])
    W *= (1 - base)[:, None]
    W[:, ix["root"]] += base
    # belly: only the front of the abdomen breathes forward
    b = R["belly"]
    front = sstep(b["frontY"][0], b["frontY"][1], P[:, 1]) * sstep(b["z"][0], b["z"][1], P[:, 2]) * (1 - sstep(b["z"][2], b["z"][3], P[:, 2]))         * (1 - sstep(b["halfWidth"][0], b["halfWidth"][1], np.abs(P[:, 0] - bones["belly"][0][0])))
    mv = (W[:, ix["spine"]] + W[:, ix["hips"]] + W[:, ix["chest"]]) * front
    W[:, ix["spine"]] *= (1 - front)
    W[:, ix["hips"]] *= (1 - front)
    W[:, ix["chest"]] *= (1 - front)
    W[:, ix["belly"]] += mv
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    # rigid regions
    for c, bone in ((2, "root"), (1, "cloud")):
        W[vcat == c] = 0
        W[vcat == c, ix[bone]] = 1
    e = np.concatenate([tv[:, [0, 1]], tv[:, [1, 2]], tv[:, [2, 0]]])
    e = np.unique(np.sort(e, 1), axis=0)
    # small cloud pieces (on his right upper arm, the shoulder wisp, the turquoise bits by the pendant): start
    # with one set of weights per piece, the mean of the fur it touches, so each rides with that fur ...
    m3 = vcat == 3
    if m3.any():
        body_v = vcat == 0
        for pc in np.unique(vpiece[m3]):
            vm = vpiece == pc
            touch = np.zeros(len(P), bool)
            ee = e[vm[e[:, 0]] ^ vm[e[:, 1]]]
            touch[ee.ravel()] = True
            touch &= body_v
            if not touch.any():
                touch = body_v & (np.linalg.norm(P - P[vm].mean(0), axis=1) < 0.06)
            wv = W[touch].mean(0)
            W[vm] = wv / wv.sum()
    # ... then smooth everything but the held cloud, the leg swirls, the seat and the inside of the head, so no
    # seam between bones (or between a piece and its fur) shows
    deg = np.bincount(e.ravel(), minlength=len(P)).astype(np.float64)
    fixed = (vcat == 1) | (vcat == 2) | (P[:, 2] < CFG["baseZ"] - 0.05) | (k > 0.999)
    for _ in range(R["smoothIterations"]):
        acc = np.zeros_like(W)
        np.add.at(acc, e[:, 0], W[e[:, 1]])
        np.add.at(acc, e[:, 1], W[e[:, 0]])
        new = 0.5 * W + 0.5 * acc / np.maximum(deg, 1)[:, None]
        W[~fixed] = new[~fixed]
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    # at most four influences (what glTF carries), so Blender shows exactly what the web gets
    cut = np.argsort(-W, 1)[:, 4:]
    W[np.arange(len(W))[:, None], cut] = 0
    W[W < 1e-3] = 0
    W /= np.maximum(W.sum(1, keepdims=True), 1e-9)
    # the held cloud is one rigid piece: a vertex on its rim that the smoothing gave mostly to 'cloud' (its
    # colour sample missed the cloud) goes wholly to it, so the rim never dents when his forearm moves
    rim = (np.argmax(W, 1) == ix["cloud"]) & (vcat != 1)
    W[rim] = 0
    W[rim, ix["cloud"]] = 1
    log("held cloud rim made rigid:", int(rim.sum()), "verts")
    return names, W, vcat


def apply_weights(obj, names, W):
    obj.vertex_groups.clear()
    for j, n in enumerate(names):
        g = obj.vertex_groups.new(name=n)
        nz = np.nonzero(W[:, j] > 0)[0]
        for wv in np.unique(np.round(W[nz, j], 3)):
            g.add(nz[np.round(W[nz, j], 3) == wv].tolist(), float(wv), "REPLACE")


# ── 3. face ──────────────────────────────────────────────────────────────

def cut_face(body):
    """character_prep's face cut (triangles inside the face ellipse and in front of 'front') as its own
    object, after the body's smooth normals are stored on both sides so the seam stays invisible."""
    me = body.data
    me.normals_split_custom_set_from_vertices([tuple(n.vector) for n in me.vertex_normals])
    cen = np.empty(len(me.polygons) * 3, np.float32)
    me.polygons.foreach_get("center", cen)
    sel = in_face(cen.reshape(-1, 3))
    co, tv = mesh_arrays(me)
    vs = np.zeros(len(co), bool)
    vs[tv[sel].ravel()] = True
    me.polygons.foreach_set("select", sel)
    me.vertices.foreach_set("select", vs)
    me.edges.foreach_set("select", [False] * len(me.edges))
    select_only(body)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    face = next(o for o in bpy.context.selected_objects if o is not body)
    face.name = face.data.name = f"{NAME}_face"
    face.data.materials[0] = face.data.materials[0].copy()
    face.data.materials[0].name = f"{NAME}_face"
    log(f"face: {len(face.data.vertices)} verts; body: {len(body.data.vertices)} verts")
    return face


def third_eye_material(face):
    """The cyan third eye gets its own material, 'third_eye' (the guide contract's optional one): the same
    texture, with a small emission so the site can raise its glow as he wakes. Its triangles are the
    cyan ones inside the gem; the face shapes already move the gem as one piece."""
    me = face.data
    co, tv = mesh_arrays(me)
    cen = co[tv].mean(1)
    gm, te = CFG["gem"], CFG["thirdEye"]
    gd = np.hypot((cen[:, 0] - gm["centre"][0]) / gm["rx"], (cen[:, 2] - gm["centre"][1]) / gm["rz"])
    sel = (gd < te["reach"]) & cloud_mask(face_colours(me))
    mat = me.materials[0].copy()
    mat.name = "third_eye"
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nt.links.new(bsdf.inputs["Base Color"].links[0].from_node.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = te["emission"]
    me.materials.append(mat)
    me.polygons.foreach_set("material_index", sel.astype(np.int32))
    log("third eye:", int(sel.sum()), "tris on its own material, emission", te["emission"])


def life_displacement(cp, name, p):
    """The closed-eye life shapes (metres on his face; across = A to B, up = up his face)."""
    LM, R, U = cp.LM, cp.R, cp.U
    g = cp.g
    across = up = 0.0
    for side, out in (("A", -1.0), ("B", 1.0)):
        eye = LM["eye" + side]
        if name == "lidSqueeze":
            upper = g(p, eye + U * 0.02 * cp.K, 0.055, 0.017)       # the closed lid's dome
            lower = g(p, eye - U * 0.022 * cp.K, 0.055, 0.019)      # under the lid line, top of the cheek
            corner = g(p, eye + R * out * 0.065 * cp.K, 0.03, 0.03)  # crow's feet bunch in
            brow = g(p, LM["brow" + side], 0.06, 0.025)
            up += -0.0095 * upper + 0.0105 * lower - 0.004 * brow
            across += -out * 0.0035 * corner
        elif name == "browSoft":
            brow = g(p, LM["brow" + side], 0.07, 0.035)
            inner = g(p, LM["brow" + side] - R * out * 0.035 * cp.K, 0.045, 0.03)
            up += 0.0085 * brow + 0.0055 * inner
            across += out * 0.0025 * inner
        elif name == "microSmile":
            corner = g(p, LM["corner" + side], 0.032, 0.026)
            cheek = g(p, LM["cheek" + side], 0.05, 0.04)
            up += 0.0115 * corner + 0.0045 * cheek
            across += out * 0.0035 * corner
        elif name == "nostril":
            wing = g(p, LM["nose"] + R * out * 0.034 * cp.K, 0.022, 0.02)
            across += out * 0.0075 * wing
            up += 0.0015 * wing
    if name == "browSoft":
        up += 0.003 * g(p, (LM["browA"] + LM["browB"]) / 2, 0.05, 0.04)
    return R * across + U * up


def add_face_shapes(cp, face):
    """Basis, the kept standard shapes and the life shapes. Each fades to zero before the cut edge and moves
    the third eye as one piece."""
    me = face.data
    co, tv = mesh_arrays(me)
    # distance to the cut edge (boundary vertices)
    e = np.concatenate([tv[:, [0, 1]], tv[:, [1, 2]], tv[:, [2, 0]]])
    es = np.sort(e, 1)
    u, cnt = np.unique(es, axis=0, return_counts=True)
    bnd = np.unique(u[cnt == 1].ravel())
    from mathutils.kdtree import KDTree
    kd = KDTree(len(bnd))
    for i, j in enumerate(bnd):
        kd.insert(co[j], i)
    kd.balance()
    dist = np.array([kd.find(c)[2] for c in co])
    fade = sstep(0.004, CFG["shapes"]["boundaryFade"], dist)
    gm = CFG["gem"]
    gd = np.hypot((co[:, 0] - gm["centre"][0]) / gm["rx"], (co[:, 2] - gm["centre"][1]) / gm["rz"])
    gem_w = 1 - sstep(1.0, 1.45, gd)                 # 1 on the gem, fading out round it
    gem_at = Vector((gm["centre"][0], 0.0, gm["centre"][1]))
    # Features slide along his face, never in or out of it. The slide uses a smoothed normal field: with each
    # vertex's own normal, the two walls of a sculpted crease (lip corners, nostrils, lid lines) would slide
    # differently and the crease would pinch.
    normals = np.array([tuple(v.normal) for v in me.vertices])
    ue = np.unique(es, axis=0)
    deg = np.bincount(ue.ravel(), minlength=len(co)).astype(np.float64)
    for _ in range(CFG["shapes"].get("normalSmoothing", 40)):
        acc = np.zeros_like(normals)
        np.add.at(acc, ue[:, 0], normals[ue[:, 1]])
        np.add.at(acc, ue[:, 1], normals[ue[:, 0]])
        normals = 0.5 * normals + 0.5 * acc / np.maximum(deg, 1)[:, None]
        normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)
    face.shape_key_add(name="Basis", from_mix=False)
    keys = CFG["shapes"]["keep"] + CFG["shapes"]["life"]
    report = {}
    for name in keys:
        std = name in CFG["shapes"]["keep"]

        def disp(p):
            return cp.displacement(name, p) * cp.X_GAIN if std else life_displacement(cp, name, p)
        dg = disp(gem_at)
        d = np.zeros_like(co)
        for i in range(len(co)):
            if fade[i] <= 1e-4:
                continue
            p = Vector(co[i])
            v = disp(p) * (1 - gem_w[i]) + dg * gem_w[i]
            d[i] = (v.x, v.y, v.z)
        d -= normals * (d * normals).sum(1, keepdims=True)     # slide along his face: features move, nothing bulges
        d *= fade[:, None]
        sk = face.shape_key_add(name=name, from_mix=False)
        sk.data.foreach_set("co", (co + d).astype(np.float32).ravel())
        mag = np.linalg.norm(d[:, [0, 2]], axis=1)            # what a front camera sees (x and z)
        report[name] = {"max_screen_mm": round(float(mag.max()) * 1000, 2), "max_screen_px_at_400": round(float(mag.max()) * 1000 / 4.75, 2)}
    log("face shapes", report)
    return report


# ── 4. rig ───────────────────────────────────────────────────────────────

ORDER = ["root", "hips", "spine", "chest", "neck", "head", "belly",
         "shoulder_L", "upperarm_L", "forearm_L", "hand_L", "shoulder_R", "upperarm_R", "forearm_R", "hand_R",
         "thigh_L", "shin_L", "foot_L", "thigh_R", "shin_R", "foot_R", "cloud", "swirl_head"]


def bend_axis(bones, n):
    """The axis each bone should bend about (its local X)."""
    h, t = Vector(bones[n][0]), Vector(bones[n][1])
    y = (t - h).normalized()
    if n in ("shoulder_L",):
        return Vector((0, -1, 0))                    # +X shrugs the left shoulder up
    if n in ("shoulder_R",):
        return Vector((0, 1, 0))                     # ... and the right one
    for side in ("L", "R"):
        if n in (f"upperarm_{side}", f"forearm_{side}", f"hand_{side}"):
            a = Vector(bones[f"upperarm_{side}"][1]) - Vector(bones[f"upperarm_{side}"][0])
            b = Vector(bones[f"forearm_{side}"][1]) - Vector(bones[f"forearm_{side}"][0])
            return a.cross(b).normalized()           # elbow hinge
        if n in (f"thigh_{side}", f"shin_{side}", f"foot_{side}"):
            a = Vector(bones[f"thigh_{side}"][1]) - Vector(bones[f"thigh_{side}"][0])
            b = Vector(bones[f"shin_{side}"][1]) - Vector(bones[f"shin_{side}"][0])
            return a.cross(b).normalized()           # knee hinge
    return Vector((1, 0, 0))                         # spine chain, head, belly, cloud, swirl: bow / pitch


def build_rig(bones):
    arm = bpy.data.armatures.new(f"{NAME}_rig")
    rig = bpy.data.objects.new(f"{NAME}_rig", arm)
    bpy.context.scene.collection.objects.link(rig)
    select_only(rig)
    bpy.ops.object.mode_set(mode="EDIT")
    for n in ORDER:
        h, t, _ = bones[n]
        eb = arm.edit_bones.new(n)
        eb.head, eb.tail = Vector(h), Vector(t)
        y = (eb.tail - eb.head).normalized()
        x = bend_axis(bones, n)
        x = (x - y * x.dot(y)).normalized()
        eb.align_roll(x.cross(y))                    # Z = X x Y, so local X lands on the bend axis
        eb.use_deform = True
    for n in ORDER:
        par = bones[n][2]
        if par:
            arm.edit_bones[n].parent = arm.edit_bones[par]
            arm.edit_bones[n].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return rig


def skin_to(obj, rig):
    obj.parent = rig
    obj.matrix_parent_inverse = Matrix.Identity(4)
    m = obj.modifiers.new("Armature", "ARMATURE")
    m.object = rig


# ── 5. clips ─────────────────────────────────────────────────────────────

class Poser:
    """Forward kinematics on the rest matrices, plus the per-frame arm solve and the swirl follow."""

    def __init__(self, rig):
        self.rig = rig
        self.rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in rig.data.bones}
        self.order = [b.name for b in rig.data.bones]          # parents come first
        self.order.sort(key=lambda n: self.depth(n))

    def depth(self, n):
        d = 0
        while self.parent[n]:
            n = self.parent[n]
            d += 1
        return d

    def world(self, basis):
        W = {}
        for n in self.order:
            p = self.parent[n]
            B = basis.get(n, Matrix.Identity(4))
            if p is None:
                W[n] = self.rest[n] @ B
            else:
                W[n] = W[p] @ self.rest[p].inverted() @ self.rest[n] @ B
        return W

    def basis_for_world(self, basis, n, target, W=None):
        """The basis that puts bone n at world matrix target, given its parent's pose."""
        W = W or self.world(basis)
        p = self.parent[n]
        par = W[p] @ self.rest[p].inverted() @ self.rest[n] if p else self.rest[n]
        return par.inverted() @ target


def rot(pitch=0.0, yaw=0.0, roll=0.0):
    """A small rotation in a spine-chain bone's own axes, in degrees: pitch > 0 bows forward,
    yaw > 0 turns to his left, roll > 0 tilts the top towards his left."""
    return Euler((math.radians(pitch), math.radians(yaw), -math.radians(roll)), "XYZ").to_matrix().to_4x4()


def env(f, a, b, c, d):
    """C2 envelope: 0 before a, rises to 1 by b, holds to c, falls to 0 by d."""
    f = np.asarray(f, np.float64)
    up = s5((f - a) / max(b - a, 1e-9))
    down = 1 - s5((f - c) / max(d - c, 1e-9))
    return np.where(f < c, up, down) * (f >= a) * (f <= d)


def bump4(f, a, b):
    """C2 bump: sin^4 between a and b."""
    x = np.clip((np.asarray(f, np.float64) - a) / (b - a), 0, 1)
    return np.sin(np.pi * x) ** 4


def breath_wave(f, lag=0.0):
    """Breathing (0 rest .. 1 full inhale), periodic over the loop. C2 everywhere."""
    B = CFG["breath"]
    phi = ((np.asarray(f, np.float64) - lag) / B["frames"]) % 1.0
    i, e = B["inhale"], B["exhale"]
    x_in = phi / i
    x_ex = (phi - i) / e
    w = x_ex + 0.35 * x_ex * (1 - x_ex)                      # the exhale drops a little sooner, then trails off
    return np.where(phi < i, s5(x_in), np.where(phi < i + e, 1 - s5(w), 0.0))


def swirl_float(f):
    """The swirl's own slow float, periodic over the loop: zero (and still) at frame 0."""
    B = CFG["breath"]
    phi = ((np.asarray(f, np.float64) - B["swirlFloat"]["lag"]) / B["frames"])
    phi0 = (-B["swirlFloat"]["lag"] / B["frames"])
    return (np.cos(2 * np.pi * phi0) - np.cos(2 * np.pi * phi)) / 2


# Clip recipes: each returns, for frame f, a dict of channel values. Channels:
#   <bone>.pitch/.yaw/.roll (deg, spine chain and head), shoulder_<s>.raise (deg),
#   belly.fwd (mm), swirl.mm / swirl.deg (own float), swirl.follow (0..1 of the head's motion),
#   swirl.lag (frames), and shape key names (0..1).

def breathe_channels(f):
    B = CFG["breath"]
    L = B["lag"]
    out = {
        "belly.fwd": B["bellyMM"] * breath_wave(f, L["belly"]),
        "spine.pitch": B["spineDeg"] * breath_wave(f, L["spine"]),
        "chest.pitch": B["chestDeg"] * breath_wave(f, L["chest"]),
        "neck.pitch": B["neckDeg"] * breath_wave(f, L["neck"]),
        "head.pitch": B["headDeg"] * breath_wave(f, L["head"]),
        "shoulder_L.raise": B["shoulderDeg"] * breath_wave(f, L["shoulder"]),
        "shoulder_R.raise": B["shoulderDeg"] * breath_wave(f, L["shoulder"]),
        "nostril": B["nostril"] * breath_wave(f, L["nostril"]),
        "swirl.mm": B["swirlFloat"]["mm"] * swirl_float(f),
        "swirl.deg": B["swirlFloat"]["deg"] * swirl_float(f),
    }
    return out


def float_channels(f):
    """float: an additive loop (CFG float). His whole self rises and settles, sways and tips back a touch; every
    channel is 0 with zero velocity at frame 0 and periodic, so it layers over breathe (or any clip) seamlessly."""
    F = CFG["float"]
    phi = 2 * np.pi * np.asarray(f, np.float64) / F["frames"]
    up = (1 - np.cos(phi)) / 2                                # 0 -> 1 -> 0, at rest at both ends
    side = np.sin(phi) * up / (np.sqrt(27.0) / 8)              # leads the rise; peaks at +-1 (phi = 120 / 240 deg)
    return {
        "root.lift": F["liftMM"] * up,
        "root.sway": F["swayMM"] * side,
        "root.roll": F["rollDeg"] * side,
        "root.pitch": -F["pitchDeg"] * up,
    }


SETTLE_FROM = {"spine.pitch": (1.5, 0), "chest.pitch": (2.0, 2), "shoulder_L.raise": (-1.5, 3), "shoulder_R.raise": (-1.5, 3),
               "neck.pitch": (2.5, 5), "head.pitch": (3.0, 8), "belly.fwd": (-2.0, 1)}


def clip_settle(N):
    """From a slightly lowered, softly bowed pose into breathe frame 0: breathe's own curve (run up to its
    loop end) plus an offset that eases to nothing with zero velocity and acceleration at the join."""
    def ch(f):
        out = breathe_channels(f - N + CFG["breath"]["frames"])
        for k, (amp, lag) in SETTLE_FROM.items():
            out[k] = out.get(k, 0.0) + amp * (1 - s5((f - lag) / (N - lag)))
        return out
    return ch


DRIFTS = {
    # chest leads, neck and head follow a few frames later; the head turns at most 2 degrees in all
    "drift_a": {"env": (10, 55, 85, 135), "ch": {"chest.roll": (0.5, 0), "neck.roll": (0.5, 4), "head.roll": (0.8, 8), "head.yaw": (0.4, 8)}},
    "drift_b": {"env": (15, 65, 88, 136), "ch": {"spine.pitch": (0.3, 0), "chest.pitch": (0.4, 3), "neck.pitch": (0.4, 6),
                                                 "head.pitch": (0.7, 9), "shoulder_L.raise": (-0.5, 5), "shoulder_R.raise": (-0.5, 5)}},
    "drift_c": {"env": (10, 60, 80, 136), "ch": {"spine.roll": (-0.2, 0), "chest.roll": (-0.3, 3), "neck.roll": (-0.4, 6),
                                                 "head.roll": (-0.6, 9), "head.yaw": (-0.6, 9), "shoulder_L.raise": (0.3, 5)}},
}


def clip_drift(name):
    spec = DRIFTS[name]
    a, b, c, d = spec["env"]

    def ch(f):
        return {k: amp * env(f - lag, a, b, c, d) for k, (amp, lag) in spec["ch"].items()}
    return ch


def clip_flutter(f):
    """A closed-lid squeeze with a softer second pulse: 0.6 s."""
    return {"lidSqueeze": 0.6 * bump4(f, 0, 10) + 0.38 * bump4(f, 7, 18)}


def clip_react(side):
    s = 1.0 if side == "left" else -1.0

    def ch(f):
        return {
            "browSoft": 0.45 * env(f, 0, 10, 22, 40),
            "microSmile": 0.35 * env(f, 4, 16, 26, 42),
            "chest.yaw": s * 0.4 * env(f, 2, 14, 24, 39),
            "neck.yaw": s * 0.8 * env(f, 4, 16, 26, 41),
            "head.yaw": s * 1.3 * env(f, 6, 18, 27, 42),
            "head.roll": s * 0.6 * env(f, 6, 18, 27, 42),
            "head.pitch": -0.4 * env(f, 6, 18, 27, 42),
        }
    return ch


def clip_react_smile(f):
    return {
        "microSmile": 0.75 * env(f, 2, 16, 26, 42),
        "cheekRaise": 0.2 * env(f, 4, 18, 26, 42),
        "lidSqueeze": 0.2 * env(f, 4, 18, 26, 42),
        "browSoft": 0.3 * env(f, 0, 12, 24, 41),
        "chest.pitch": -0.3 * env(f, 0, 14, 24, 39),
        "neck.pitch": -0.4 * env(f, 2, 16, 26, 41),
        "head.pitch": -1.0 * env(f, 4, 18, 26, 42),
        "shoulder_L.raise": 0.4 * env(f, 2, 14, 24, 39),
        "shoulder_R.raise": 0.4 * env(f, 2, 14, 24, 39),
    }


CLIPS = [
    # name, frames (last frame index), channel function, swirl lag (frames), loop
    ("breathe", 150, breathe_channels, 0, True),
    ("settle", 30, clip_settle(30), 0, False),
    ("drift_a", 150, clip_drift("drift_a"), 3, False),
    ("drift_b", 150, clip_drift("drift_b"), 3, False),
    ("drift_c", 150, clip_drift("drift_c"), 3, False),
    ("flutter", 18, clip_flutter, 0, False),
    ("react_left", 45, clip_react("left"), 2, False),
    ("react_right", 45, clip_react("right"), 2, False),
    ("react_smile", 45, clip_react_smile, 2, False),
    ("float", CFG["float"]["frames"], float_channels, 0, True),
]


def life_clips():
    """The living details' clips (coco_sage_life.py): the sun and bolt, the third eye's blinks, the welcome's beat."""
    out = []
    for name, maker, lag, loop in (("radiance", life.radiance_channels, 0, True), ("thirdeye", life.thirdeye_channels, 0, True),
                                   ("awaken", life.awaken_channels, 2, False)):
        N, fn = maker(CFG)
        out.append((name, N, fn, lag, loop))
    return out


def pose_at(P, chans):
    """Pose bases for one frame from channel values (arms solved so the hands stay on the cloud)."""
    def c(k):
        return float(chans.get(k, 0.0))
    basis = {}
    if any(k.startswith("root.") for k in chans):
        # the float: his whole self moves about a pivot in his middle (world axes: +X his left, -Y towards you, +Z up)
        piv = Vector(CFG["float"]["pivot"])
        R = Euler((math.radians(c("root.pitch")), math.radians(c("root.roll")), 0.0), "XYZ").to_matrix().to_4x4()
        M = Matrix.Translation((c("root.sway") / 1000.0, 0, c("root.lift") / 1000.0)) @ Matrix.Translation(piv) @ R             @ Matrix.Translation(-piv)
        basis["root"] = P.rest["root"].inverted() @ M @ P.rest["root"]
    for n in ("spine", "chest", "neck", "head"):
        basis[n] = rot(c(f"{n}.pitch"), c(f"{n}.yaw"), c(f"{n}.roll"))
    for s in ("L", "R"):
        basis[f"shoulder_{s}"] = Euler((math.radians(c(f"shoulder_{s}.raise")), 0, 0), "XYZ").to_matrix().to_4x4()
    basis["belly"] = Matrix.Translation((0, c("belly.fwd") / 1000.0, 0))
    life.extra_basis(P, chans, basis)               # the sun, the third eye's blink and the control bones
    W = P.world(basis)
    for s in ("L", "R"):
        solve_arm(P, basis, W, s)
        W = P.world(basis)
    return basis, W


def solve_arm(P, basis, W, s):
    """Two-bone solve: the wrist stays where it rests on the cloud and the hand keeps its rest orientation;
    the elbow stays in the plane it rests in."""
    ua, fa, hd = f"upperarm_{s}", f"forearm_{s}", f"hand_{s}"
    rest = P.rest
    C = W["cloud"] @ rest["cloud"].inverted()          # where the held cloud has gone (it moves only with the float)
    S = W[ua].to_translation()
    T = (C @ rest[hd]).to_translation()
    L1 = (rest[fa].to_translation() - rest[ua].to_translation()).length
    L2 = (rest[hd].to_translation() - rest[fa].to_translation()).length
    E_rest = (C @ rest[fa]).to_translation()           # the elbow stays as close to where it rests as it can
    d = max(min((T - S).length, L1 + L2 - 1e-6), abs(L1 - L2) + 1e-6)
    u = (T - S).normalized()
    a = (L1 * L1 - L2 * L2 + d * d) / (2 * d)
    h = math.sqrt(max(L1 * L1 - a * a, 0.0))
    v = (E_rest - S) - u * (E_rest - S).dot(u)
    v.normalize()
    E = S + u * a + v * h
    # upper arm: turn its axis onto S->E (minimal turn, no twist)
    y0 = (W[ua].to_3x3() @ Vector((0, 1, 0))).normalized()
    q = y0.rotation_difference((E - S).normalized())
    tgt = Matrix.Translation(S) @ q.to_matrix().to_4x4() @ Matrix.Translation(-S) @ W[ua]
    basis[ua] = rot_only(P.basis_for_world(basis, ua, tgt, W))
    W = P.world(basis)
    y0 = (W[fa].to_3x3() @ Vector((0, 1, 0))).normalized()
    Ep = W[fa].to_translation()
    q = y0.rotation_difference((T - Ep).normalized())
    tgt = Matrix.Translation(Ep) @ q.to_matrix().to_4x4() @ Matrix.Translation(-Ep) @ W[fa]
    basis[fa] = rot_only(P.basis_for_world(basis, fa, tgt, W))
    W = P.world(basis)
    # the hand keeps its rest orientation on the cloud (the solve has put the wrist back where it rests)
    basis[hd] = rot_only(P.basis_for_world(basis, hd, C @ rest[hd], W))


def rot_only(M):
    """Joints turn, they don't slide: drop the solver's floating-point translation."""
    return M.to_quaternion().to_matrix().to_4x4()


def swirl_basis(P, W_now, chans):
    """The swirl follows the head's motion (as if carried with it) plus its own small float."""
    rest = P.rest
    # the head's motion relative to the root (the swirl hangs from the root, so it already rides any root motion)
    D = (W_now["root"] @ rest["root"].inverted()).inverted() @ W_now["head"] @ rest["head"].inverted()
    lift = float(chans.get("swirl.mm", 0.0)) / 1000.0
    sway = math.radians(float(chans.get("swirl.deg", 0.0)))
    own = Matrix.Translation((0, lift, 0)) @ Matrix.Rotation(sway, 4, "X")   # in its own axes: up its length, lean
    return rest["swirl_head"].inverted() @ D @ rest["swirl_head"] @ own


def bake_clip(P, rig, face, name, N, fn, swirl_lag, loop):
    frames = np.arange(N + 1)
    chans = [fn(np.float64(f)) for f in frames]
    chans = [{k: float(v) for k, v in c.items()} for c in chans]
    poses, worlds = [], []
    for c in chans:
        b, W = pose_at(P, c)
        poses.append(b)
        worlds.append(W)
    for i, c in enumerate(chans):
        j = i - swirl_lag
        if loop:
            j %= N
        j = max(j, 0)
        Wh = worlds[j] if not loop else (worlds[j])
        poses[i]["swirl_head"] = swirl_basis(P, Wh, c)
    # write: one action, two slots (the rig's bones, the face's shape keys), every frame keyed (Bezier)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    act.use_frame_range = True
    act.frame_start, act.frame_end = 0, N
    act.use_cyclic = bool(loop)
    s_ob = act.slots.new(id_type="OBJECT", name=rig.name)
    s_key = act.slots.new(id_type="KEY", name=face.data.shape_keys.name)
    strip = act.layers.new("clip").strips.new(type="KEYFRAME")
    cb = strip.channelbag(s_ob, ensure=True)
    animated = sorted({n for p in poses for n in p})
    for n in [b.name for b in rig.data.bones]:
        qs, ls = [], []
        prev = None
        for p in poses:
            loc, q, _ = p.get(n, Matrix.Identity(4)).decompose()
            if prev is not None and prev.dot(q) < 0:
                q = -q
            prev = q
            qs.append(q)
            ls.append(loc)
        path = f'pose.bones["{n}"]'
        for idx in range(4):
            put_curve(cb, f"{path}.rotation_quaternion", idx, n, [q[idx] for q in qs])
        if n in ("belly", "swirl_head") or (n == "root" and any(k.startswith("root.") for k in chans[0])):
            for idx in range(3):
                put_curve(cb, f"{path}.location", idx, n, [l[idx] for l in ls])
        scs = [p.get(n, Matrix.Identity(4)).to_scale() for p in poses]
        if n in life.SCALED and any(abs(v - 1.0) > 1e-6 for sc_ in scs for v in sc_):   # sun breath, blink, control values
            for idx in range(3):
                put_curve(cb, f"{path}.scale", idx, n, [sc_[idx] for sc_ in scs])
    cb2 = strip.channelbag(s_key, ensure=True)
    for kb in face.data.shape_keys.key_blocks[1:]:
        vals = [c.get(kb.name, 0.0) for c in chans]
        put_curve(cb2, f'key_blocks["{kb.name}"].value', 0, None, vals)
    for idb, slot in ((rig, s_ob), (face.data.shape_keys, s_key)):
        ad = idb.animation_data or idb.animation_data_create()
        tr = ad.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 0, act)
        st.action_slot = slot
        tr.mute = False
    return {"frames": N + 1, "seconds": round(N / FPS, 3), "channels": sorted(chans[0].keys()), "loop": loop,
            "bones_animated": animated}


def put_curve(cb, path, index, group, values):
    fc = cb.fcurves.new(path, index=index, group_name=group) if group else cb.fcurves.new(path, index=index)
    kp = fc.keyframe_points
    kp.add(len(values))
    co = np.empty(len(values) * 2, np.float32)
    co[0::2] = np.arange(len(values))
    co[1::2] = values
    kp.foreach_set("co", co)
    kp.foreach_set("interpolation", [bpy.types.Keyframe.bl_rna.properties["interpolation"].enum_items["BEZIER"].value] * len(values))
    for k in kp:
        k.handle_left_type = k.handle_right_type = "AUTO_CLAMPED"
    fc.update()


# ── main ─────────────────────────────────────────────────────────────────

def main():
    stage = _opt("--stage", "all")
    if "--rebuild-web" in ARGS or not os.path.exists(WEB_BLEND):
        build_web()
    if stage == "web":
        return
    bpy.ops.wm.open_mainfile(filepath=WEB_BLEND)
    save_blend(OUT_BLEND)   # never change the cache: work in the new file
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 0, 150
    os.chdir(ROOT)
    if "--" not in sys.argv:
        sys.argv.append("--")
    i = sys.argv.index("--")                         # character_prep reads its character's name right after "--"
    if sys.argv[i + 1:i + 2] != [NAME]:
        sys.argv.insert(i + 1, NAME)
    sys.path.insert(0, HERE)
    import character_prep as cp                     # face helpers (reads blender/characters/<NAME>.json)
    body = bpy.data.objects[f"{NAME}_body"]
    sun = bpy.data.objects["sun_bolt"]
    swirl = bpy.data.objects["swirl_head_mesh"]
    for o in (body, sun, swirl):
        o.data.validate()
    bones = bone_table()
    names, W, vcat = compute_weights(body.data, bones)
    apply_weights(body, names, W)
    log("weights on", len(W), "verts; per bone:", {n: int((W[:, j] > 0.5).sum()) for j, n in enumerate(names) if (W[:, j] > 0.5).any()})
    face = cut_face(body)
    third_eye_material(face)
    shapes = add_face_shapes(cp, face)
    rig = build_rig(bones)
    lay = life.add_bones(rig, CFG, sun, face)
    skin_to(body, rig)
    skin_to(face, rig)
    life_report = {"third_eye_verts": life.weight_third_eye(face, lay)}
    swirl.vertex_groups.clear()
    swirl.vertex_groups.new(name="swirl_head").add(list(range(len(swirl.data.vertices))), 1.0, "REPLACE")
    skin_to(swirl, rig)
    # the sun and bolt: a softly glowing material of their own (same image, so nothing extra to download)
    mat = sun.data.materials[0].copy()
    mat.name = "sun_bolt"
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    nt.links.new(bsdf.inputs["Base Color"].links[0].from_node.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = CFG["sun"]["emission"]
    sun.data.materials[0] = mat
    # they ride the root, so they float with him and never part from him; the sun (disc and rays) on its own bone,
    # which turns and breathes it ('radiance'); the sun and the bolt on their own copies of that material
    life_report.update(life.weight_sun(sun, lay))
    skin_to(sun, rig)
    cards = life.build_eye_cards(CFG, face, rig)
    if cards:
        life_report["eyes"] = cards[1]
    log("life", life_report)
    body.data.materials[0].name = f"{NAME}_body"
    P = Poser(rig)
    clips = {}
    for name, N, fn, lag, loop in CLIPS + life_clips():
        clips[name] = bake_clip(P, rig, face, name, N, fn, lag, loop)
        log("clip", name, clips[name]["frames"], "frames")
    for pb in rig.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    for kb in face.data.shape_keys.key_blocks[1:]:
        kb.value = 0.0
    # the .blend opens on breathe: every other clip waits on its own (muted) NLA track; the exporter takes them all
    for idb in (rig, face.data.shape_keys):
        for tr in idb.animation_data.nla_tracks:
            tr.mute = tr.name != "breathe"
    rig["clips"] = json.dumps({k: {kk: v[kk] for kk in ("frames", "seconds", "loop")} for k, v in clips.items()})
    save_blend(OUT_BLEND)
    log("saved", OUT_BLEND)
    raw = _opt("--raw") or os.path.join(tempfile.gettempdir(), f"{NAME}-raw.glb")
    export(raw)
    if "--no-optimize" not in ARGS:
        os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
        r = subprocess.run(["node", os.path.join(ROOT, "scripts", "optimize-guide.mjs"), raw, OUT_GLB], cwd=ROOT,
                           capture_output=True, text=True, shell=(os.name == "nt"))
        print(r.stdout, r.stderr)
        # optimize-guide's resample() straightens slow curves (a breath) into a few segments, and its lossy
        # filters round the samples: put the exact per-frame samples back (scripts/restore-clip-samples.mjs)
        r = subprocess.run(["node", os.path.join(ROOT, "scripts", "restore-clip-samples.mjs"), raw, OUT_GLB], cwd=ROOT,
                           capture_output=True, text=True, shell=(os.name == "nt"))
        print(r.stdout, r.stderr)
        # the living details' long loops and the beat: smooth cubic keys instead of one per frame (their rest is at
        # frame 0, so they stay exact as additive clips); the older clips are left exactly as they were
        for name, *_ in life_clips():
            r = subprocess.run(["node", os.path.join(ROOT, "scripts", "restore-clip-samples.mjs"), raw, OUT_GLB, "--only", name,
                                "--cubic", str(CFG["life"]["cubic"])], cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
            print(r.stdout, r.stderr)
        # every clip carries every joint, held still where it does not move it: those of the living-detail bones (only
        # their own clips move them) and every still one in the new additive clips go (scripts/prune-still-channels.mjs)
        r = subprocess.run(["node", os.path.join(ROOT, "scripts", "prune-still-channels.mjs"), OUT_GLB,
                            "--clips", ",".join(n for n, *_ in life_clips()), "--nodes", ",".join(life.SCALED)],
                           cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
        print(r.stdout, r.stderr)
        log("web copy", OUT_GLB, round(os.path.getsize(OUT_GLB) / 1e6, 2), "MB")
    json.dump({"clips": clips, "shapes": shapes}, open(os.path.join(tempfile.gettempdir(), f"{NAME}-build.json"), "w"), indent=1)


def export(path):
    bpy.ops.object.select_all(action="SELECT")
    wanted = dict(filepath=path, export_format="GLB", use_selection=False, export_apply=False, export_yup=True,
                  export_image_format="WEBP", export_animations=True, export_animation_mode="ACTIONS",
                  export_merge_animation="ACTION", export_force_sampling=True, export_frame_step=1,
                  export_optimize_animation_size=True, export_anim_single_armature=True, export_reset_pose_bones=True,
                  export_skins=True, export_def_bones=False, export_all_influences=False, export_influence_nb=4,
                  export_morph=True, export_morph_normal=False, export_morph_animation=True, export_morph_reset_sk_data=True,
                  export_try_sparse_sk=True, export_lights=False, export_cameras=False, export_extras=False,
                  export_rest_position_armature=True, export_current_frame=False)
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in known})
    log("exported", path, round(os.path.getsize(path) / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
