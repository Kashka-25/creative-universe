"""Coco's Awakening: Young Coco's invitation take (the INVITATION page).

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup \
        --python blender/scripts/build_invitation.py [-- options]

    --until geometry|rig|anim|export|cloud   stop after that stage (default: cloud, the whole scene)
    --from rig|anim|export|cloud             skip the earlier stages and continue from the saved invitation.blend
    --no-optimize                      write the GLB straight from Blender (no key prep, no meshopt)
    --raw-copy <path>                  also keep a copy of the unoptimised export (for checks)
    --smooth <n>                       passes of weight smoothing (default 24)

Run from the repository root. Re-runnable: every full run starts again from Cassidy's rigged web copy
blender/characters/little-coco.blend, which is opened and IMMEDIATELY saved under a new name, so the
original is never written. Nothing else in the project is touched.

Writes
  blender/characters/invitation.blend            young Coco + his held cloud, one scene, 60 fps master timeline
  public/models/invitation/little-coco-invite.glb clips "invite" (the whole take, root motion included)
                                                  and "hover" (a 2 s floating-idle loop = invite frame 0)
  public/models/invitation/timeline.json         fps, markers, clips (swapFrame / adultBox are left to the
                                                  magic-cloud build, which adds its own keys to this file)
  + the magic cloud (stage 5, blender/scripts/build_magic_cloud.py): its collection in invitation.blend,
    public/models/invitation/magic-cloud.glb and its keys in timeline.json

What it does, in order
  1. geometry  The cloud he holds (the connected cloud-coloured piece in his hands plus its ribbon tail up his
               left side) is cut out of his body into its own object, little-coco_cloud_held. Its texels that
               were fur or skin are repainted with its own cloud colours; the cyan texels left on his fingers and
               bib edge are repainted from the neighbouring skin, fur and overall colours. The hole the cloud
               leaves in his belly (it was fused there, and the shell is hollow) is closed with a smooth patch
               that joins the bib, forearms, hands and lap, textured by cloning his own overalls fabric from the
               back panel of his overalls (no new artwork), into an unused corner of his texture atlas. Where
               the held cloud hides it, the patch sits just behind the cloud's front surface (BEHIND), so it
               cannot peep through between his fingers and the cloud; the thin strip of it that can still be
               glimpsed between his nail tips and the cloud takes the colour of the cloud beside it (as the sculpt).
  2. rig       The stub armature is replaced by a hand-placed, limb-aligned skeleton with the contract names
               (contract/guide-contract.json) plus shoulder_L/R, belly and cloud. Rolls put the main bend on
               local X. Weights are region-aware (legs never follow the arms), smoothed over the welded surface,
               and the face mesh (10 shape keys) blends into the neck exactly like the body around it. Vertices
               that sit on top of each other (the face's UV-seam copies) get identical weights, so nothing opens.
               The held cloud takes his hands' own weights where his fingers wrap it (so it moves exactly with
               them there) and blends to its own bone further in; the belly patch behind it follows the cloud.
               Then everything (meshes and skeleton) is scaled uniformly to HEIGHT, like every other character
               (the likeness does not change).
  3. anim      One continuous take on a 60 fps timeline, built from smooth curves (eased transitions that
               overlap, and gentle oscillations with eased envelopes) and keyed as Bezier keys: float in on his
               riding cloud from well off screen-right at a three-quarter angle (a quick start while still off
               screen, then a steady glide), slow to a stop, turn to the visitor (head leads, body follows; his
               head stays a little to his right so his painted eyes meet the visitor's, see GAZE), curious head
               tilt, a warm smile, OFFER the cloud with both
               hands (the forearms lift it about the line through both elbows, so hands and cloud move as one;
               he leans in and floats a little nearer; the middle of the cloud trails his hands by two frames),
               look down at it as ctl_glow rises, then hold still and breathe. "hover" is a seamless loop whose
               pose and velocity equal invite frame 0.
               Root motion lives on the root bone (path, turn) and the hips (bob): the root keeps the travel on
               straight segments between knots that meshopt stores exactly; the hips carry the fine remainder.
               His position is root + hips (timeline.json says so too).
  4. export    GLB with skins, morph-weight animation and root motion, force-sampled at 60 fps; then
               blender/scripts/invite_keys.mjs (picks keys the optimiser keeps, so breaths are not flattened) and
               scripts/optimize-guide.mjs (meshopt). Needs node on the PATH.

Glow travels as the X scale of the empty "ctl_glow" (three r187 cannot play material animation).
Axes: Blender -Y faces the visitor (+Z in glTF); he stays centred near the origin, 1.9 m tall (HEIGHT).
"""

import json
import math
import os
import subprocess
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector, bvhtree, geometry, kdtree

ROOT = os.getcwd()
SRC = os.path.join(ROOT, "blender", "characters", "little-coco.blend")
OUT_BLEND = os.path.join(ROOT, "blender", "characters", "invitation.blend")
OUT_DIR = os.path.join(ROOT, "public", "models", "invitation")
GLB = os.path.join(OUT_DIR, "little-coco-invite.glb")
TIMELINE = os.path.join(OUT_DIR, "timeline.json")
NAME = "little-coco"
FPS = 60
HEIGHT = 1.9           # metres, rest pose including his riding ring (the contract size of every character)

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
UNTIL = ARGV[ARGV.index("--until") + 1] if "--until" in ARGV else "cloud"
STAGES = ["geometry", "rig", "anim", "export", "cloud"]


def log(*a):
    print("[invite]", *a, flush=True)


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ───────────────────────────── 0. open (and immediately save as the new file) ─────────────────────────────

def open_source():
    bpy.context.preferences.filepaths.save_version = 0          # no .blend1 clutter next to the new file
    bpy.ops.wm.open_mainfile(filepath=SRC)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)             # from here on every save goes to invitation.blend
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.render.fps_base = 1.0
    log("opened", SRC, "-> saved as", OUT_BLEND)


def mesh_np(me):
    co = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    nf = len(me.polygons)
    ls = np.empty(nf, np.int64); me.polygons.foreach_get("loop_start", ls)
    lt = np.empty(nf, np.int64); me.polygons.foreach_get("loop_total", lt)
    lv = np.empty(len(me.loops), np.int64); me.loops.foreach_get("vertex_index", lv)
    uv = np.empty(len(me.loops) * 2, np.float64); me.uv_layers.active.data.foreach_get("uv", uv)
    return co, ls, lt, lv, uv.reshape(-1, 2)


def strip_old_rig():
    """Any armature (the stub one from little-coco.blend, or ours from an earlier run) goes, with its weights."""
    for o in [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(NAME)]:
        for md in list(o.modifiers):
            if md.type == "ARMATURE":
                o.modifiers.remove(md)
        o.vertex_groups.clear()
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    for old in [o for o in bpy.data.objects if o.type == "ARMATURE"]:
        arm = old.data
        bpy.data.objects.remove(old)
        if arm.users == 0:
            bpy.data.armatures.remove(arm)


def weld(obj):
    """Merge the UV-seam duplicates the glTF import made (UVs live on face corners, so nothing visible changes)."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    log(f"welded {obj.name}: {n0} -> {len(obj.data.vertices)} verts")


# ───────────────────────────── 1. geometry: the held cloud, texture clean-up, the belly patch ─────────────

def base_image(mat):
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    return bsdf.inputs["Base Color"].links[0].from_node.image


def tex_nodes(mat):
    """(base colour, metal/rough, normal) image nodes of a glTF-imported material."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    base = bsdf.inputs["Base Color"].links[0].from_node
    mr = next(n for n in nt.nodes if n.type == "TEX_IMAGE" and n is not base and n.image.colorspace_settings.name == "Non-Color"
              and any(l.to_node.type == "SEPARATE_COLOR" for l in n.outputs[0].links))
    nm = next(n for n in nt.nodes if n.type == "TEX_IMAGE" and any(l.to_node.type == "NORMAL_MAP" for l in n.outputs[0].links))
    return base, mr, nm


def img_np(img):
    W, H = img.size
    a = np.empty(W * H * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(H, W, 4)


def hsv(c):
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    mx = c[..., :3].max(-1); mn = c[..., :3].min(-1); d = mx - mn + 1e-9
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    return h, (mx - mn) / (mx + 1e-9), mx


def is_cloud_colour(c):
    """Turquoise-to-white of his clouds (hue 165-215, or near-white). sRGB-encoded 0..1 input."""
    h, s, v = hsv(c)
    return ((h > 165) & (h < 215) & (s > 0.10) & (v > 0.45)) | ((s < 0.13) & (v > 0.80))


def face_classes(co, ls, lv, uv, px, rng_seed=1):
    """Per face: median colour of 9 texture samples -> class 0 cloud, 1 skin, 2 overall, 3 fur, 4 other."""
    H, W = px.shape[:2]
    nf = len(ls)
    L = ls[:, None] + np.arange(3)[None]
    rng = np.random.default_rng(rng_seed)
    b = rng.dirichlet((1, 1, 1), size=(nf, 9))
    p = np.einsum("fsk,fkd->fsd", b, uv[L])
    x = np.clip((p[..., 0] % 1) * W, 0, W - 1).astype(int)
    y = np.clip((p[..., 1] % 1) * H, 0, H - 1).astype(int)
    fc = np.median(px[y, x, :3], 1)
    h, s, v = hsv(fc)
    cloud = is_cloud_colour(fc)
    skin = ~cloud & (h < 40) & (s > 0.2) & (s < 0.62) & (v > 0.7)
    overall = ~cloud & ~skin & (h < 30) & (s >= 0.62) & (v > 0.55)
    fur = ~cloud & ~skin & ~overall & (v <= 0.55)
    return np.select([cloud, skin, overall, fur], [0, 1, 2, 3], 4), fc


def cloud_clusters(co, tri, cand, radius=0.012):
    """Union-find over cloud-coloured faces: shared vertices or vertices closer than `radius`."""
    cv = np.unique(tri[cand].ravel())
    parent = {int(q): int(q) for q in cv}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    def union(a, c):
        ra, rc = find(a), find(c)
        if ra != rc:
            parent[ra] = rc

    for t in tri[cand]:
        union(int(t[0]), int(t[1])); union(int(t[1]), int(t[2]))
    kd = kdtree.KDTree(len(cv))
    for q in cv:
        kd.insert(co[q], int(q))
    kd.balance()
    for q in cv:
        for (_, j, _) in kd.find_range(co[q], radius):
            union(int(q), j)
    lab = -np.ones(len(tri), np.int64)
    for fi in np.nonzero(cand)[0]:
        lab[fi] = find(int(tri[fi, 0]))
    return lab


def raster(tri_px, pad=0.6):
    """Texel (rows, cols) whose centres lie inside a UV triangle given in pixel units (x right, y up = row)."""
    a, b, c = tri_px
    x0, y0 = np.floor(tri_px.min(0) - pad).astype(int)
    x1, y1 = np.ceil(tri_px.max(0) + pad).astype(int)
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(den) < 1e-12:
        return np.zeros(0, int), np.zeros(0, int)
    l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
    l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
    l3 = 1 - l1 - l2
    # pad in barycentric units ~ pad pixels / triangle size
    size = max(1.0, float(np.linalg.norm(tri_px.max(0) - tri_px.min(0))))
    e = pad / size
    m = (l1 >= -e) & (l2 >= -e) & (l3 >= -e)
    return (ys[m] - 0.5).astype(int), (xs[m] - 0.5).astype(int)


def inpaint(px, rows, cols, bad, iters=80):
    """Fill texels flagged `bad` (among rows/cols) from their good neighbours inside the same texel set."""
    if not bad.any():
        return
    r0, c0 = rows.min() - 1, cols.min() - 1
    h, w = rows.max() - r0 + 2, cols.max() - c0 + 2
    known = np.zeros((h, w), bool)
    todo = np.zeros((h, w), bool)
    val = np.zeros((h, w, 3), np.float32)
    rr, cc = rows - r0, cols - c0
    val[rr, cc] = px[rows, cols, :3]
    known[rr[~bad], cc[~bad]] = True
    todo[rr[bad], cc[bad]] = True
    for _ in range(iters):
        if not todo.any():
            break
        acc = np.zeros((h, w, 3), np.float32); n = np.zeros((h, w), np.float32)
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            k = np.roll(np.roll(known, dr, 0), dc, 1)
            v = np.roll(np.roll(val, dr, 0), dc, 1)
            acc += v * k[..., None]; n += k
        grow = todo & (n > 0)
        val[grow] = acc[grow] / n[grow, None]
        known |= grow
        todo &= ~grow
    ok = known[rr, cc]
    px[rows[ok], cols[ok], :3] = val[rr[ok], cc[ok]]
    return int((~ok).sum())


def owner_map(parts, W, H):
    """owner[row, col] of every atlas texel: 0 nobody (gutter), 1 body, 2 face, 3 held cloud."""
    own = np.zeros((H, W), np.uint8)
    for code, uv_tris in parts:
        for t in uv_tris:
            r, c = raster(t * np.array([W, H]), pad=0.3)
            ok = (r >= 0) & (r < H) & (c >= 0) & (c < W)
            own[r[ok], c[ok]] = code
    return own


def clean_texture(co, ls, lv, uv, held, own, body_px, cloud_px):
    """Repaint the seam between his hands/bib and the cloud he holds, on two copies of the atlas:

    body_px  - his own atlas: cyan texels on the faces round the cloud are repainted from the neighbouring skin,
               fur and overall texels, and the texels just outside those faces (the cloud's old texels and the
               gutters, which texture filtering reaches) are filled with his colours too, so no cyan can bleed in.
    cloud_px - only the bake source for the cloud's own texture: fur/skin texels on the cloud are repainted with
               its own cloud colours, and its colours are grown a few texels past its faces in the same way."""
    H, W = body_px.shape[:2]
    L = ls[:, None] + np.arange(3)[None]
    tri = lv[L]
    cen = co[tri].mean(1)
    hv = np.unique(tri[held].ravel())
    kd = kdtree.KDTree(len(hv))
    for i, v in enumerate(hv):
        kd.insert(co[v], i)
    kd.balance()
    near = np.array([kd.find(Vector(c))[2] < 0.07 for c in cen]) & ~held
    kdc = kdtree.KDTree(len(cen))
    for i, c in enumerate(cen):
        kdc.insert(c, i)
    kdc.balance()
    stats = dict(body_faces_checked=int(near.sum()), body_repainted_full=0, body_inpainted=0, body_texels_fixed=0,
                 cloud_repainted_full=0, cloud_inpainted=0, cloud_texels_fixed=0, seam_texels_body=0, seam_texels_cloud=0)
    texels = {}
    for fi in np.nonzero(near | held)[0]:
        t = uv[L[fi]] * np.array([W, H])
        r, c = raster(t)
        ok = (r >= 0) & (r < H) & (c >= 0) & (c < W)
        texels[fi] = (r[ok], c[ok])
    orig = body_px.copy()

    def neighbour_colour(fi, want_cloud):
        """Mean texel colour of 3D-neighbouring faces of the wanted kind (within 2.5 cm)."""
        cols = []
        for (_, j, d) in kdc.find_range(Vector(cen[fi]), 0.025):
            if j == fi or (held[j] != want_cloud) or j not in texels:
                continue
            rr, cc = texels[j]
            if len(rr) == 0:
                continue
            c = orig[rr, cc, :3]
            m = is_cloud_colour(c) == want_cloud
            if not want_cloud:
                m &= ~((c[:, 2] > 0.8 * c[:, 0]) & (c[:, 1] > 0.85 * c[:, 0]) & (c.max(1) > 0.3))
            if m.mean() > 0.6:
                cols.append(c[m].mean(0))
        if cols:
            return np.mean(cols, 0)
        # isolated slivers: the nearest faces of the wanted kind, further out
        for (_, j, d) in sorted(kdc.find_range(Vector(cen[fi]), 0.06), key=lambda t: t[2]):
            if j == fi or held[j] != want_cloud or j not in texels or len(texels[j][0]) == 0:
                continue
            c = orig[texels[j][0], texels[j][1], :3]
            m = is_cloud_colour(c) == want_cloud
            if m.mean() > 0.8:
                return c[m].mean(0)
        return None

    for fi, (r, c) in texels.items():
        if len(r) == 0:
            continue
        t3 = orig[r, c, :3]
        cl = is_cloud_colour(t3)
        # texels blended half-way between cloud and skin/fur/overall (grey-green, pale teal) count as cloud on his
        # body: his own colours are all warm (red > green > blue), so cool texels there are contamination
        cool = (t3[:, 2] > 0.8 * t3[:, 0]) & (t3[:, 1] > 0.85 * t3[:, 0]) & (t3.max(1) > 0.3)
        if held[fi]:
            bad, key, px = ~cl, "cloud", cloud_px      # fur/skin texels on the cloud
        else:
            bad, key, px = cl | cool, "body", body_px  # cyan/white texels on his fingers, bib edge, forearms
        if not bad.any():
            continue
        if bad.mean() > 0.55:
            col = neighbour_colour(fi, want_cloud=held[fi])
            if col is None:
                continue
            px[r, c, :3] = col
            stats[f"{key}_repainted_full"] += 1
        else:
            inpaint(px, r, c, bad)
            stats[f"{key}_inpainted"] += 1
        stats[f"{key}_texels_fixed"] += int(bad.sum())

    # seams: grow each side's colours 4 texels past its own faces (into gutters and the other side's texels)
    for fi, (r, c) in texels.items():
        if len(r) == 0:
            continue
        r0, r1 = max(r.min() - 5, 0), min(r.max() + 6, H)
        c0, c1 = max(c.min() - 5, 0), min(c.max() + 6, W)
        rr, cc = np.mgrid[r0:r1, c0:c1]
        rr, cc = rr.ravel(), cc.ravel()
        o = own[rr, cc]
        if held[fi]:
            bad = o != 3
            if bad.any() and (~bad).any():
                inpaint(cloud_px, rr, cc, bad, iters=4)
                stats["seam_texels_cloud"] += int(bad.sum())
        else:
            bad = (o == 0) | (o == 3)
            if bad.any() and (~bad).any():
                inpaint(body_px, rr, cc, bad, iters=4)
                stats["seam_texels_body"] += int(bad.sum())
    return stats


def bake_cloud_texture(cloud, src_px, size=512):
    """The held cloud gets its own small base-colour texture: new UVs (smart project), filled from src_px through
    its original UVs. Its normal and metal/rough maps keep reading the shared atlas through the original UVs."""
    me = cloud.data
    orig_name = me.uv_layers[0].name
    new = me.uv_layers.new(name="cloud_uv")
    me.uv_layers.active = new
    bpy.ops.object.select_all(action="DESELECT")
    cloud.select_set(True)
    bpy.context.view_layer.objects.active = cloud
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.03, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    H, W = src_px.shape[:2]
    nl = len(me.loops)
    uv_old = np.empty(nl * 2, np.float64); me.uv_layers[orig_name].data.foreach_get("uv", uv_old); uv_old = uv_old.reshape(-1, 2)
    uv_new = np.empty(nl * 2, np.float64); me.uv_layers["cloud_uv"].data.foreach_get("uv", uv_new); uv_new = uv_new.reshape(-1, 2)
    ls = np.empty(len(me.polygons), np.int64); me.polygons.foreach_get("loop_start", ls)
    out = np.zeros((size, size, 4), np.float32)
    out[..., 3] = 1
    filled = np.zeros((size, size), bool)
    for f0 in ls:
        tn = uv_new[f0:f0 + 3] * size
        to = uv_old[f0:f0 + 3]
        r, c = raster(tn, pad=0.8)
        ok = (r >= 0) & (r < size) & (c >= 0) & (c < size)
        r, c = r[ok], c[ok]
        if len(r) == 0:
            continue
        a, b, cc = tn
        den = (b[1] - cc[1]) * (a[0] - cc[0]) + (cc[0] - b[0]) * (a[1] - cc[1])
        if abs(den) < 1e-12:
            continue
        xs, ys = c + 0.5, r + 0.5
        l1 = ((b[1] - cc[1]) * (xs - cc[0]) + (cc[0] - b[0]) * (ys - cc[1])) / den
        l2 = ((cc[1] - a[1]) * (xs - cc[0]) + (a[0] - cc[0]) * (ys - cc[1])) / den
        l3 = 1 - l1 - l2
        bary = np.clip(np.stack([l1, l2, l3], 1), 0, 1)
        bary /= bary.sum(1, keepdims=True)
        uvp = bary @ to
        x = (uvp[:, 0] % 1) * W - 0.5
        y = (uvp[:, 1] % 1) * H - 0.5
        x0 = np.clip(np.floor(x).astype(int), 0, W - 2); y0 = np.clip(np.floor(y).astype(int), 0, H - 2)
        fx, fy = (x - x0)[:, None], (y - y0)[:, None]
        col = (src_px[y0, x0, :3] * (1 - fx) * (1 - fy) + src_px[y0, x0 + 1, :3] * fx * (1 - fy)
               + src_px[y0 + 1, x0, :3] * (1 - fx) * fy + src_px[y0 + 1, x0 + 1, :3] * fx * fy)
        out[r, c, :3] = col
        filled[r, c] = True
    rr, cc = np.nonzero(np.ones((size, size), bool))
    inpaint(out, rr, cc, ~filled[rr, cc], iters=10)     # gutters
    img = bpy.data.images.new(f"{NAME}_cloud_held_base", size, size, alpha=False)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(out.ravel())
    img.update()
    img.pack()
    return img, orig_name


def cloud_material(cloud, body_mat, img, orig_uv):
    """Its own material (so the site can light it on its own): own base colour, his atlas normal + metal/rough."""
    m = body_mat.copy()
    m.name = f"{NAME}_cloud_held"
    cloud.data.materials[0] = m
    nt = m.node_tree
    base_n, mr_n, nm_n = tex_nodes(m)
    base_n.image = img
    uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "cloud_uv"
    nt.links.new(uvn.outputs["UV"], base_n.inputs["Vector"])
    uvo = nt.nodes.new("ShaderNodeUVMap"); uvo.uv_map = orig_uv
    nt.links.new(uvo.outputs["UV"], mr_n.inputs["Vector"])
    nt.links.new(uvo.outputs["UV"], nm_n.inputs["Vector"])
    nmap = next(n for n in nt.nodes if n.type == "NORMAL_MAP")
    nmap.uv_map = orig_uv
    return m


def free_square(objs, N=512):
    """Largest unused square of the shared atlas (UV coverage of every given mesh rasterised at N x N)."""
    cov = np.zeros((N, N), bool)
    for me in objs:
        co, ls, lt, lv, uv = mesh_np(me)
        t = uv[ls[:, None] + np.arange(3)[None]] * N
        for tri in t:
            r, c = raster(tri, pad=1.5)
            ok = (r >= 0) & (r < N) & (c >= 0) & (c < N)
            cov[r[ok], c[ok]] = True
    free = ~cov
    dp = np.zeros((N + 1, N + 1), np.int32)
    for i in range(N):
        row = free[i]
        for j in range(N):
            if row[j]:
                dp[i + 1, j + 1] = 1 + min(dp[i, j + 1], dp[i + 1, j], dp[i, j])
    k = int(dp.max())
    i, j = np.unravel_index(int(dp.argmax()), dp.shape)
    r0, c0 = i - k, j - k                       # top-left in the N grid (row = v)
    return (c0 / N, r0 / N, k / N), float(cov.mean())


def find_rim(bm, box_lo, box_hi):
    """The closed boundary loop (welded mesh) whose vertices all lie inside the box: the hole the cloud left."""
    lo, hi = np.array(box_lo), np.array(box_hi)
    inside = lambda v: bool(((np.array(v.co[:]) > lo) & (np.array(v.co[:]) < hi)).all())  # noqa: E731
    bnd = [e for e in bm.edges if e.is_boundary and inside(e.verts[0]) and inside(e.verts[1])]
    adj = {}
    for e in bnd:
        for v in e.verts:
            adj.setdefault(v.index, []).append(e)
    # largest loop
    seen, loops = set(), []
    for e0 in bnd:
        if e0.index in seen:
            continue
        order = [e0.verts[0]]
        prev, cur = e0, e0.verts[1]
        seen.add(e0.index)
        ok = True
        while cur != order[0]:
            order.append(cur)
            nxt = [e for e in adj[cur.index] if e is not prev and e.index not in seen]
            if not nxt:
                ok = False
                break
            prev = nxt[0]
            seen.add(prev.index)
            cur = prev.other_vert(cur)
        if ok:
            loops.append(order)
    loops.sort(key=lambda o: -sum((o[i].co - o[i - 1].co).length for i in range(len(o))))
    return loops[0] if loops else None


def point_in_poly(p, poly):
    x, y = p
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def seg_dist2d(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(1e-12, ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + ab * t))


def harmonic(n, edges, fixed_idx, fixed_val, iters=600):
    """Solve a graph Laplace equation (uniform weights) for n nodes with Dirichlet values on fixed nodes."""
    fixed_val = np.asarray(fixed_val, np.float64)
    dim = fixed_val.shape[1] if fixed_val.ndim > 1 else 1
    fv = fixed_val.reshape(len(fixed_idx), dim)
    x = np.zeros((n, dim))
    free = np.ones(n, bool); free[fixed_idx] = False
    x[free] = fv.mean(0)
    x[fixed_idx] = fv
    e = np.asarray(edges, np.int64)
    deg = np.maximum(np.bincount(e.ravel(), minlength=n).astype(np.float64), 1)
    for _ in range(iters):
        for k in range(dim):
            acc = np.bincount(e[:, 0], weights=x[e[:, 1], k], minlength=n) + np.bincount(e[:, 1], weights=x[e[:, 0], k], minlength=n)
            x[free, k] = (acc / deg)[free]
    return x if dim > 1 else x[:, 0]


BEHIND = 0.008     # metres (sculpt size): the belly patch keeps at least this far behind the held cloud's front surface


def behind_cloud(P, movable, nbrs, cloud):
    """How far (along +Y, away from the visitor) each movable point must go to sit BEHIND distance behind the held
    cloud's front surface, wherever the cloud hides it from the front; the push is spread smoothly to the points
    around (never to the fixed ones), so the patch dents gently out of sight instead of folding."""
    cme = cloud.data
    cv = [Vector(v.co) for v in cme.vertices]
    bvh = bvhtree.BVHTree.FromPolygons(cv, [list(p.vertices) for p in cme.polygons])
    push = np.zeros(len(P))
    for k in np.nonzero(movable)[0]:
        x, y, z = P[k]
        hit = bvh.ray_cast(Vector((x, y - 1.0, z)), Vector((0, 1, 0)), 1.0 + 0.05)
        if hit[0] is not None:
            push[k] = max(0.0, hit[0].y + BEHIND - y)
    p0 = push.copy()
    for _ in range(12):                               # spread the dent (max with the neighbours' mean, decaying)
        avg = np.array([np.mean(push[nb]) if len(nb) else 0.0 for nb in nbrs])
        push = np.where(movable, np.maximum(p0, 0.85 * avg), 0.0)
    return push


def fill_belly(body, sq, base_px, mr_px, nm_px, cls_body, cloud, cloud_img=None, cloud_orig_uv=None):
    """Close the hole the held cloud leaves (bib, forearms, hands, lap all end there) with a smooth patch.

    The patch joins the rim vertices themselves (watertight), sits a little proud like a tummy, gets UVs in the
    free atlas square `sq` and his own overalls fabric cloned from the back panel of his overalls."""
    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    rim = find_rim(bm, (-0.21, -0.40, -0.53), (0.23, -0.19, -0.19))
    if rim is None:
        raise RuntimeError("no hole rim found where the held cloud was")
    # The bib's lower edge was cut into a zig-zag where the cloud was fused to it: relax the upper rim (bib and
    # upper forearms, all hidden behind the held cloud) along the loop so the patch meets a calm line.
    nr0 = len(rim)
    upper = [i for i, v in enumerate(rim) if v.co.z > -0.31]
    for _ in range(10):
        new = {i: (rim[i - 1].co + rim[(i + 1) % nr0].co) * 0.5 for i in upper}
        for i, p in new.items():
            rim[i].co = rim[i].co.lerp(p, 0.5)
    P = np.array([v.co[:] for v in rim])
    perim = float(np.linalg.norm(P - np.roll(P, 1, 0), axis=1).sum())
    c = P.mean(0)
    _, _, vt = np.linalg.svd(P - c)
    n = vt[2]
    if n[1] > 0:
        n = -n                                   # outward = towards the visitor (-Y)
    e1 = np.array([1.0, 0, 0]) - n * n[0]        # his right-to-left axis, in the rim's plane
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(n, e1)                         # ~ up
    q = np.stack([(P - c) @ e1, (P - c) @ e2], 1)
    h_rim = (P - c) @ n
    # The rim folds a little in depth round the hands, so its flat projection can cross itself. The patch is laid
    # out on an untangled copy of that projection (a few smoothing passes until it is a simple polygon); the 3D
    # surface itself is the harmonic membrane spanning the real rim, so it still meets every rim vertex exactly.
    nr = len(q)

    def crossings(d):
        bad = []
        for i in range(nr):
            for j in range(i + 2, nr):
                if i == 0 and j == nr - 1:
                    continue
                if geometry.intersect_line_line_2d(Vector(d[i]), Vector(d[(i + 1) % nr]), Vector(d[j]), Vector(d[(j + 1) % nr])):
                    bad.append((i, j))
        return bad

    d = q.copy()
    passes = 0
    while crossings(d) and passes < 60:
        d = d + 0.5 * ((np.roll(d, 1, 0) + np.roll(d, -1, 0)) / 2 - d)
        passes += 1
    if crossings(d):
        raise RuntimeError("could not untangle the hole rim")
    log(f"rim untangled in {passes} smoothing passes")
    q = d
    area = 0.5 * np.sum(q[:, 0] * np.roll(q[:, 1], -1) - np.roll(q[:, 0], -1) * q[:, 1])
    ring = list(range(nr)) if area > 0 else list(range(nr))[::-1]
    # interior points: a jittered-free grid, kept away from the rim
    hstep = 0.02
    mn, mx = q.min(0), q.max(0)
    pts = []
    for gx in np.arange(mn[0] + hstep / 2, mx[0], hstep):
        for gy in np.arange(mn[1] + hstep / 2, mx[1], hstep):
            p = np.array([gx, gy])
            if point_in_poly(p, q) and min(seg_dist2d(p, q[i], q[(i + 1) % nr]) for i in range(nr)) > 0.55 * hstep:
                pts.append(p)
    pts = np.array(pts)
    allp = [Vector(v) for v in q] + [Vector(v) for v in pts]
    out = geometry.delaunay_2d_cdt(allp, [(i, (i + 1) % nr) for i in range(nr)], [ring], 1, 1e-7, True)
    vco, _, faces, orig_v = out[0], out[1], out[2], out[3]
    # map output verts to inputs
    vmap = []
    for i, ov in enumerate(orig_v):
        if not ov:
            raise RuntimeError("CDT created a new vertex (rim intersection?)")
        vmap.append(ov[0])
    # depth for interior points: harmonic from the rim depth, plus a gentle tummy bulge
    nall = len(allp)
    edges = set()
    for f in faces:
        for k in range(len(f)):
            a, b = vmap[f[k]], vmap[f[(k + 1) % len(f)]]
            edges.add((min(a, b), max(a, b)))
    edges = list(edges)
    pos3 = harmonic(nall, edges, list(range(nr)), P)            # minimal-ish membrane through the real rim
    # Poisson dome: solve L phi = -1 with phi = 0 on the rim (Jacobi)
    phi = np.zeros(nall)
    e = np.asarray(edges)
    deg = np.bincount(e.ravel(), minlength=nall).astype(np.float64)
    for _ in range(800):
        acc = np.zeros(nall)
        np.add.at(acc, e[:, 0], phi[e[:, 1]]); np.add.at(acc, e[:, 1], phi[e[:, 0]])
        nphi = (acc + 1.0) / np.maximum(deg, 1)
        nphi[:nr] = 0
        phi = nphi
    phi /= max(phi.max(), 1e-9)
    BULGE = 0.008                                                # a gentle tummy, flat where it meets the rim
    new3d = pos3 + np.outer(BULGE * phi ** 2, n)
    # where the held cloud hides it, the patch sits a little behind the cloud's front surface (the membrane spans the
    # finger rims at the front and the bib at the back, so it would otherwise peep through between hands and cloud)
    nbrs = [[] for _ in range(nall)]
    for a_, b_ in edges:
        nbrs[a_].append(b_); nbrs[b_].append(a_)
    movable = np.arange(nall) >= nr
    push = behind_cloud(new3d, movable, nbrs, cloud)
    new3d[:, 1] += push
    log(f"belly patch: {int((push > 1e-6).sum())} of {nall - nr} inner verts moved behind the held cloud, "
        f"max {push.max() * 1000:.1f} mm")
    # build faces (rim vertices are his own; the inside ones are new)
    rim_idx = [v.index for v in rim]
    patch_layer = bm.faces.layers.int.get("invite_patch") or bm.faces.layers.int.new("invite_patch")
    bm.verts.ensure_lookup_table()
    rim = [bm.verts[i] for i in rim_idx]
    vlist = list(rim) + [bm.verts.new(Vector(p)) for p in new3d[nr:]]
    bm.verts.index_update()
    k_of = {v.index: k for k, v in enumerate(vlist)}
    uv_layer = bm.loops.layers.uv.active
    u0, v0, size = sq
    margin = size * 0.04
    span = max(mx[0] - mn[0], mx[1] - mn[1])
    scale = (size - 2 * margin) / span

    def uv_of(k):
        p2 = allp[k]
        return (u0 + margin + (p2.x - mn[0]) * scale, v0 + margin + (p2.y - mn[1]) * scale)

    new_faces = []
    for f in faces:
        vs = [vlist[vmap[k]] for k in f]
        if len(set(v.index for v in vs)) < 3:
            continue
        try:
            nf = bm.faces.new(vs)
        except ValueError:
            continue
        nf.normal_update()
        if Vector(n) @ nf.normal < 0:
            nf.normal_flip()
        nf.smooth = True
        nf.material_index = 0
        nf[patch_layer] = 1
        for loop in nf.loops:
            loop[uv_layer].uv = uv_of(k_of[loop.vert.index])
        new_faces.append(nf)
    bm.to_mesh(me)
    bm.free()
    me.update()
    smooth_seam_normals(me, rim_idx)
    log(f"belly patch: rim {nr} verts (perimeter {perim:.2f} m), {len(pts)} new verts, {len(new_faces)} faces")

    # ── clone texture: his overalls' back panel, projected straight through ──
    co, ls, lt, lv, uvs = mesh_np(me)
    patch_mask = np.zeros(len(ls), bool)
    attr = me.attributes["invite_patch"].data
    pm = np.empty(len(ls), np.int32); attr.foreach_get("value", pm)
    patch_mask = pm == 1
    src_faces = np.nonzero(~patch_mask)[0]
    tri = lv[ls[:, None] + np.arange(3)[None]]
    bvh = bvhtree.BVHTree.FromPolygons([Vector(v) for v in co], [list(t) for t in tri[src_faces]], all_triangles=True)
    cen = co[tri].mean(1)
    # the back panel: overall-coloured faces on his back (y > 0.05) between z -0.5 and -0.08
    cls_src = cls_body
    back = (cls_src == 2) & (cen[: len(cls_src), 1] > 0.05) & (cen[: len(cls_src), 2] > -0.5) & (cen[: len(cls_src), 2] < -0.08)
    bp = cen[: len(cls_src)][back]
    bx0, bx1 = np.percentile(bp[:, 0], [8, 92]); bz0, bz1 = np.percentile(bp[:, 2], [8, 80])
    H, W = base_px.shape[:2]
    pu0, pv0 = int(round(u0 * W)), int(round(v0 * H))
    psz = int(round(size * W))
    Hs, Ws = mr_px.shape[:2]
    # map patch plane coords -> back panel x, z (keep scale, centre it in the panel)
    pw, ph = mx[0] - mn[0], mx[1] - mn[1]
    sx = min(1.0, (bx1 - bx0) / pw); sz = min(1.0, (bz1 - bz0) / ph)
    s_ = min(sx, sz)
    filled = np.zeros((psz, psz), bool)
    got = []
    for rr in range(psz):
        for cc in range(psz):
            uu = (pu0 + cc + 0.5) / W; vv = (pv0 + rr + 0.5) / H
            p2 = np.array([(uu - u0 - margin) / scale + mn[0], (vv - v0 - margin) / scale + mn[1]])
            px3 = c + p2[0] * e1 + p2[1] * e2
            sxp = (bx0 + bx1) / 2 + (px3[0] - (c[0])) * s_
            szp = (bz0 + bz1) / 2 + (px3[2] - c[2]) * s_
            hit = bvh.ray_cast(Vector((sxp, 1.0, szp)), Vector((0, -1, 0)))
            if hit[0] is None:
                continue
            fi = src_faces[hit[2]]
            t3 = co[tri[fi]]
            bary = geometry.intersect_point_tri(hit[0], Vector(t3[0]), Vector(t3[1]), Vector(t3[2]))
            # barycentric weights by area
            a0, a1, a2 = (Vector(t3[1]) - hit[0]).cross(Vector(t3[2]) - hit[0]).length, \
                         (Vector(t3[2]) - hit[0]).cross(Vector(t3[0]) - hit[0]).length, \
                         (Vector(t3[0]) - hit[0]).cross(Vector(t3[1]) - hit[0]).length
            ssum = a0 + a1 + a2
            uvp = (uvs[ls[fi]] * a0 + uvs[ls[fi] + 1] * a1 + uvs[ls[fi] + 2] * a2) / max(ssum, 1e-12)
            xs, ys = (uvp[0] % 1) * W - 0.5, (uvp[1] % 1) * H - 0.5
            x0, y0 = int(np.floor(xs)), int(np.floor(ys)); fx, fy = xs - x0, ys - y0
            x0, y0 = np.clip(x0, 0, W - 2), np.clip(y0, 0, H - 2)
            def bil(img):
                return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
                        + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)
            col = bil(base_px)
            if fi < len(cls_src) and cls_src[fi] != 2:
                continue
            base_px[pv0 + rr, pu0 + cc] = col
            mr_px[pv0 + rr, pu0 + cc] = bil(mr_px)
            filled[rr, cc] = True
            got.append(col[:3])
    # flat normal for the patch (cloned tangent-space normals would point the wrong way)
    nm_px[pv0:pv0 + psz, pu0:pu0 + psz] = (0.5, 0.5, 1.0, 1.0)
    rows, cols = np.nonzero(np.ones((psz, psz), bool))
    bad = ~filled[rows, cols]
    left = inpaint(base_px, rows + pv0, cols + pu0, bad, iters=200)
    inpaint(mr_px, rows + pv0, cols + pu0, bad, iters=200)
    # match the front bib's tone (the back panel's baked shading differs a little)
    front = (cls_src == 2) & (cen[: len(cls_src), 1] < -0.15) & (cen[: len(cls_src), 2] > -0.30) & (cen[: len(cls_src), 2] < -0.14) \
        & (np.abs(cen[: len(cls_src), 0] - 0.02) < 0.2)
    fcols = []
    for fi in np.nonzero(front)[0]:
        t = uvs[ls[fi] + np.arange(3)] * np.array([W, H])
        r_, c_ = raster(t)
        ok = (r_ >= 0) & (r_ < H) & (c_ >= 0) & (c_ < W)
        if ok.any():
            fcols.append(base_px[r_[ok], c_[ok], :3].mean(0))
    gain = np.ones(3)
    if fcols and got:
        gain = np.clip(np.median(fcols, 0) / np.maximum(np.median(got, 0), 1e-3), 0.85, 1.15)
        blk = base_px[pv0:pv0 + psz, pu0:pu0 + psz, :3]
        base_px[pv0:pv0 + psz, pu0:pu0 + psz, :3] = np.clip(blk * gain, 0, 1)
    log(f"patch texture: {psz}px square at uv ({u0:.3f}, {v0:.3f}), cloned {filled.mean() * 100:.0f}% from the back panel "
        f"(x {bx0:.2f}..{bx1:.2f}, z {bz0:.2f}..{bz1:.2f}, scale {s_:.2f}), tone gain {np.round(gain, 3).tolist()}, unfilled {left}")
    tint = tint_fingertips(me, rim_idx, base_px, mr_px, cloud, cloud_img, cloud_orig_uv) if cloud_img is not None else {}
    log("patch fingertip tint:", tint)
    return dict(rim_verts=nr, perimeter_m=round(perim, 3), new_verts=int(len(pts)), faces=len(new_faces),
                uv_square=[round(u0, 4), round(v0, 4), round(size, 4)], tone_gain=np.round(gain, 3).tolist(),
                cloned_fraction=round(float(filled.mean()), 3), fingertip_tint=tint)


FINGER_Y = -0.315                    # metres (sculpt): rim vertices further forward than this are his fingers and nails
TINT_NEAR, TINT_FAR = 0.006, 0.018   # metres from those rims: all cloud colour inside, the cloned fabric beyond


def tint_fingertips(me, rim_idx, base_px, mr_px, cloud, cloud_img, cloud_orig_uv):
    """Where his fingers held the cloud, the patch's first strip (from their cut rims back to behind the cloud) can be
    glimpsed between his nail tips and the cloud, where the sculpt shows cloud. Those texels take the colour of the
    cloud surface nearest to them (its own base colour, and the atlas's metal/rough through its original UVs),
    fading back to the cloned overalls fabric a little further from the rim. The bib and lap rims keep the fabric."""
    co, ls, lt, lv, uvs = mesh_np(me)
    pm = np.empty(len(ls), np.int32)
    me.attributes["invite_patch"].data.foreach_get("value", pm)
    H, W = base_px.shape[:2]
    R = co[rim_idx]
    hand = (R[:, 1] < FINGER_Y).astype(np.float64)
    A, B, ha, hb = R, np.roll(R, -1, 0), hand, np.roll(hand, -1)
    keep = (ha + hb) > 0                                   # rim segments that touch a finger
    A, B, ha, hb = A[keep], B[keep], ha[keep], hb[keep]
    AB = B - A
    ab2 = np.maximum((AB * AB).sum(-1), 1e-12)
    cme = cloud.data
    cbvh = bvhtree.BVHTree.FromPolygons([Vector(v.co) for v in cme.vertices], [list(p.vertices) for p in cme.polygons])
    cls_ = np.empty(len(cme.polygons), np.int64); cme.polygons.foreach_get("loop_start", cls_)
    clv = np.empty(len(cme.loops), np.int64); cme.loops.foreach_get("vertex_index", clv)
    ccv = np.empty(len(cme.vertices) * 3); cme.vertices.foreach_get("co", ccv); ccv = ccv.reshape(-1, 3)
    uvc = np.empty(len(cme.loops) * 2); cme.uv_layers["cloud_uv"].data.foreach_get("uv", uvc); uvc = uvc.reshape(-1, 2)
    uvo = np.empty(len(cme.loops) * 2); cme.uv_layers[cloud_orig_uv].data.foreach_get("uv", uvo); uvo = uvo.reshape(-1, 2)
    cimg = img_np(cloud_img)

    def bil(img, uv):
        h, w = img.shape[:2]
        x, y = (uv[0] % 1) * w - 0.5, (uv[1] % 1) * h - 0.5
        x0, y0 = int(np.clip(np.floor(x), 0, w - 2)), int(np.clip(np.floor(y), 0, h - 2))
        fx, fy = x - x0, y - y0
        return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
                + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)

    done = set()
    full = 0
    for fi in np.nonzero(pm == 1)[0]:
        L = ls[fi] + np.arange(3)
        P3 = co[lv[L]]
        t = uvs[L] * np.array([W, H])
        r, c = raster(t, pad=0.8)
        ok = (r >= 0) & (r < H) & (c >= 0) & (c < W)
        r, c = r[ok], c[ok]
        if not len(r):
            continue
        a_, b_, c_ = t
        den = (b_[1] - c_[1]) * (a_[0] - c_[0]) + (c_[0] - b_[0]) * (a_[1] - c_[1])
        if abs(den) < 1e-12:
            continue
        xs, ys = c + 0.5, r + 0.5
        l1 = ((b_[1] - c_[1]) * (xs - c_[0]) + (c_[0] - b_[0]) * (ys - c_[1])) / den
        l2 = ((c_[1] - a_[1]) * (xs - c_[0]) + (a_[0] - c_[0]) * (ys - c_[1])) / den
        bary = np.clip(np.stack([l1, l2, 1 - l1 - l2], 1), 0, 1)
        bary /= bary.sum(1, keepdims=True)
        p = bary @ P3
        tt = np.clip(((p[:, None, :] - A[None]) * AB[None]).sum(-1) / ab2[None], 0, 1)
        d = np.linalg.norm(p[:, None, :] - (A[None] + tt[..., None] * AB[None]), axis=-1)
        w = ((ha[None] + (hb - ha)[None] * tt) * (1 - smoothstep(TINT_NEAR, TINT_FAR, d))).max(1)
        for k in np.nonzero(w > 1e-3)[0]:
            key = (int(r[k]), int(c[k]))
            if key in done:
                continue
            done.add(key)
            loc, _, ci, _ = cbvh.find_nearest(Vector(p[k]))
            cl = cls_[ci] + np.arange(3)
            T3 = ccv[clv[cl]]
            ar = np.array([np.linalg.norm(np.cross(T3[(j + 1) % 3] - np.array(loc), T3[(j + 2) % 3] - np.array(loc)))
                           for j in range(3)])
            bw = ar / max(ar.sum(), 1e-12)
            col = bil(cimg, bw @ uvc[cl])
            mr = bil(mr_px, bw @ uvo[cl])
            base_px[key[0], key[1], :3] = (1 - w[k]) * base_px[key[0], key[1], :3] + w[k] * col[:3]
            mr_px[key[0], key[1], :3] = (1 - w[k]) * mr_px[key[0], key[1], :3] + w[k] * mr[:3]
            full += int(w[k] > 0.999)
    return dict(finger_rim_verts=int(hand.sum()), texels=len(done), texels_full=full)


def smooth_seam_normals(me, rim_idx):
    """Shade smoothly across the patch seam: every corner at a rim vertex gets the same (averaged) normal."""
    nl = len(me.loops)
    cn = np.empty(nl * 3, np.float32)
    me.corner_normals.foreach_get("vector", cn)
    cn = cn.reshape(-1, 3)
    lv = np.empty(nl, np.int64); me.loops.foreach_get("vertex_index", lv)
    rim = np.zeros(len(me.vertices), bool); rim[rim_idx] = True
    at = np.nonzero(rim[lv])[0]
    acc = np.zeros((len(me.vertices), 3)); np.add.at(acc, lv[at], cn[at])
    nrm = acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-9)
    cn[at] = nrm[lv[at]]
    me.normals_split_custom_set([tuple(v) for v in cn])


def separate(obj, face_mask, name):
    me = obj.data
    for p in me.polygons:
        p.select = bool(face_mask[p.index])
    for v in me.vertices:
        v.select = False
    for e in me.edges:
        e.select = False
    for p in me.polygons:
        if p.select:
            for vi in p.vertices:
                me.vertices[vi].select = True
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    before = set(bpy.data.objects)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.object.mode_set(mode="OBJECT")
    for p in me.polygons:
        p.select = bool(face_mask[p.index])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    new = next(o for o in bpy.data.objects if o not in before)
    new.name = name
    new.data.name = name
    return new


def make_images(body_mat):
    """Copies of his three atlas images that this build may edit (the originals stay as they were)."""
    base_n, mr_n, nm_n = tex_nodes(body_mat)
    out = {}
    for key, node, cs in (("base", base_n, "sRGB"), ("mr", mr_n, "Non-Color"), ("nm", nm_n, "Non-Color")):
        src = node.image
        W, H = src.size
        img = bpy.data.images.new(f"{NAME}_invite_{key}", W, H, alpha=False)
        img.colorspace_settings.name = cs
        a = img_np(src)
        out[key] = (img, a)
    return out


def write_images(images, mats):
    for key, (img, a) in images.items():
        img.pixels.foreach_set(np.ascontiguousarray(a).ravel())
        img.update()
        img.pack()
    for m in mats:
        base_n, mr_n, nm_n = tex_nodes(m)
        base_n.image = images["base"][0]
        mr_n.image = images["mr"][0]
        nm_n.image = images["nm"][0]


def stage_geometry():
    body = bpy.data.objects[f"{NAME}_body"]
    face = bpy.data.objects[f"{NAME}_face"]
    strip_old_rig()
    weld(body)
    me = body.data
    images = make_images(me.materials[0])
    base_px = images["base"][1]
    co, ls, lt, lv, uv = mesh_np(me)
    assert (lt == 3).all(), "expected a triangulated body"
    tri = lv[ls[:, None] + np.arange(3)[None]]
    cen = co[tri].mean(1)
    area = np.array([p.area for p in me.polygons])
    cls, _ = face_classes(co, ls, lv, uv, base_px)
    lab = cloud_clusters(co, tri, cls == 0)
    # the held cloud: the cloud-coloured cluster in front of his belly, between the hands (with its ribbon tail)
    best, best_area = None, 0
    for r in np.unique(lab[lab >= 0]):
        m = lab == r
        a = area[m].sum()
        cc = (cen[m] * area[m, None]).sum(0) / a
        pts = co[np.unique(tri[m].ravel())]
        if -0.3 < cc[0] < 0.5 and cc[1] < -0.1 and -0.5 < cc[2] < 0.06 and pts[:, 2].min() > -0.62 and a > best_area:
            best, best_area = r, a
    held = lab == best
    hp = co[np.unique(tri[held].ravel())]
    log(f"held cloud: {int(held.sum())} faces, bbox {np.round(hp.min(0), 3).tolist()} .. {np.round(hp.max(0), 3).tolist()}")
    face_me = face.data
    fco, fls, flt, flv, fuv = mesh_np(face_me)
    Ht, Wt = base_px.shape[:2]
    own = owner_map([(1, uv[ls[~held][:, None] + np.arange(3)[None]]), (2, fuv[fls[:, None] + np.arange(3)[None]]),
                     (3, uv[ls[held][:, None] + np.arange(3)[None]])], Wt, Ht)
    cloud_px = base_px.copy()
    stats = clean_texture(co, ls, lv, uv, held, own, base_px, cloud_px)
    log("texture clean-up:", stats)
    # 2. separate it into its own object, with its own material and small texture
    cloud = separate(body, held, f"{NAME}_cloud_held")
    cloud_img, orig_uv = bake_cloud_texture(cloud, cloud_px)
    del cloud_px
    cls_body = cls[~held]
    # 3. close the belly
    sq, cov = free_square([body.data, face.data])
    log(f"atlas coverage {cov * 100:.0f}%, free square uv ({sq[0]:.3f}, {sq[1]:.3f}) size {sq[2]:.3f}")
    patch = fill_belly(body, sq, base_px, images["mr"][1], images["nm"][1], cls_body, cloud, cloud_img, orig_uv)
    write_images(images, [me.materials[0], face.data.materials[0], cloud.data.materials[0]])
    cm = cloud_material(cloud, me.materials[0], cloud_img, orig_uv)
    for img in [i for i in bpy.data.images if i.users == 0]:
        bpy.data.images.remove(img)
    report = dict(held_faces=int(held.sum()), held_bbox=[np.round(hp.min(0), 3).tolist(), np.round(hp.max(0), 3).tolist()],
                  texture=stats, patch=patch)
    bpy.context.scene["invite_geometry"] = json.dumps(report)
    return report


# ───────────────────────────── 2. rig: a limb-aligned skeleton and clean weights ─────────────────────────────

# Joints placed on his sculpt (Blender metres; +X his left, -Y towards the visitor, +Z up). The spine runs up his
# middle (x 0.07). Shoulders, elbows and wrists come from blender/characters/little-coco.json and his skin areas
# (hands lie across his lap, fingers pointing inwards); hips, knees and feet from the cross-legged fur masses and his
# soles. X hints: "x" = world +X (spine bends forward/back on local X), a vector, or ("hinge", upper, lower) = the
# knee/elbow hinge of that limb, so every limb bends on its local X.
BONES = {
    "root": ((0.07, 0.02, -0.60), (0.07, 0.02, -0.45), None, False, "x"),     # at his seat (see coarse_path)
    "hips": ((0.07, 0.02, -0.60), (0.07, 0.0, -0.40), "root", False, "x"),
    "belly": ((0.07, -0.10, -0.36), (0.07, -0.26, -0.36), "hips", False, "x"),
    "spine": ((0.07, 0.0, -0.40), (0.07, -0.02, -0.22), "hips", True, "x"),
    "chest": ((0.07, -0.02, -0.22), (0.07, -0.03, -0.06), "spine", True, "x"),
    "neck": ((0.07, -0.03, -0.06), (0.07, -0.03, 0.05), "chest", True, "x"),
    "head": ((0.07, -0.03, 0.05), (0.07, -0.03, 0.42), "neck", True, "x"),
    "shoulder_L": ((0.14, -0.04, -0.08), (0.32, -0.04, -0.08), "chest", False, (0, -1, 0)),
    "upperarm_L": ((0.32, -0.04, -0.08), (0.40, -0.18, -0.38), "shoulder_L", True, ("hinge", "upperarm_L", "forearm_L")),
    "forearm_L": ((0.40, -0.18, -0.38), (0.28, -0.34, -0.42), "upperarm_L", True, ("hinge", "upperarm_L", "forearm_L")),
    "hand_L": ((0.28, -0.34, -0.42), (0.10, -0.41, -0.46), "forearm_L", True, ("hinge", "upperarm_L", "forearm_L")),
    "shoulder_R": ((0.00, -0.04, -0.08), (-0.22, -0.04, -0.08), "chest", False, (0, 1, 0)),
    "upperarm_R": ((-0.22, -0.04, -0.08), (-0.32, -0.18, -0.38), "shoulder_R", True, ("hinge", "upperarm_R", "forearm_R")),
    "forearm_R": ((-0.32, -0.18, -0.38), (-0.16, -0.36, -0.43), "upperarm_R", True, ("hinge", "upperarm_R", "forearm_R")),
    "hand_R": ((-0.16, -0.36, -0.43), (0.01, -0.41, -0.46), "forearm_R", True, ("hinge", "upperarm_R", "forearm_R")),
    "thigh_L": ((0.22, -0.02, -0.62), (0.47, -0.17, -0.62), "hips", False, ("hinge", "thigh_L", "shin_L")),
    "shin_L": ((0.47, -0.17, -0.62), (0.15, -0.33, -0.70), "thigh_L", True, ("hinge", "thigh_L", "shin_L")),
    "foot_L": ((0.15, -0.33, -0.70), (0.19, -0.42, -0.60), "shin_L", True, ("hinge", "thigh_L", "shin_L")),
    "thigh_R": ((-0.08, -0.02, -0.62), (-0.40, -0.17, -0.62), "hips", False, ("hinge", "thigh_R", "shin_R")),
    "shin_R": ((-0.40, -0.17, -0.62), (-0.13, -0.33, -0.70), "thigh_R", True, ("hinge", "thigh_R", "shin_R")),
    "foot_R": ((-0.13, -0.33, -0.70), (-0.17, -0.42, -0.60), "shin_R", True, ("hinge", "thigh_R", "shin_R")),
    "cloud": ((0.148, -0.304, -0.31), (0.148, -0.304, -0.16), "chest", False, "x"),
}
# capsule radii (metres) for the weighting, and where each bone may take vertices from
SMOOTH_ITERS = int(ARGV[ARGV.index("--smooth") + 1]) if "--smooth" in ARGV else 24   # passes of weight smoothing
RADII = {"hips": 0.17, "spine": 0.16, "chest": 0.15, "neck": 0.09, "shoulder_L": 0.06, "shoulder_R": 0.06,
         "upperarm_L": 0.085, "upperarm_R": 0.085, "forearm_L": 0.075, "forearm_R": 0.075, "hand_L": 0.05, "hand_R": 0.05,
         "thigh_L": 0.10, "thigh_R": 0.10, "shin_L": 0.09, "shin_R": 0.09, "foot_L": 0.06, "foot_R": 0.06}


def gate(name, p, skin):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    r_neck = np.hypot(x - 0.07, y + 0.03)
    if name.startswith("hand"):
        return skin & (y < -0.25) & (z > -0.53) & (z < -0.28)
    if name.startswith("foot"):
        return skin & (z < -0.55)
    if name.startswith("shin"):
        return z < -0.5
    if name.startswith("thigh"):
        return z < -0.45
    if name == "neck":
        return (r_neck < 0.17) & (z > -0.14)
    if name.startswith("shoulder"):
        return z > -0.22
    if name.startswith("upperarm"):
        return z > -0.5
    if name.startswith("forearm"):
        return (z > -0.56) & (y < -0.02) & (~skin | (z > -0.3))
    if name == "hips":
        return z < -0.33
    if name == "spine":
        return (z > -0.52) & (z < -0.1)
    if name == "chest":
        return (z > -0.36) & (z < 0.1)
    return np.ones(len(p), bool)


COINCIDENT = 1e-4      # metres: vertices this close are one point of the surface (UV-seam copies)


def coincident_groups(P, tol=COINCIDENT):
    """Label per point; points closer than `tol` (transitively) share a label (the smallest index)."""
    n = len(P)
    kd = kdtree.KDTree(n)
    for i, p in enumerate(P):
        kd.insert(Vector(p), i)
    kd.balance()
    parent = np.arange(n)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for i, p in enumerate(P):
        for (_, j, _) in kd.find_range(Vector(p), tol):
            ra, rb = find(i), find(j)
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)
    return np.array([find(i) for i in range(n)])


def same_weights_on_coincident(W, groups):
    """Every set of coincident vertices gets the same (averaged) weights: a seam can then never open."""
    W = W.copy()
    multi = np.bincount(groups, minlength=len(groups)) > 1
    for g in np.nonzero(multi)[0]:
        m = groups == g
        W[m] = W[m].mean(0)
    return W, int(multi.sum())


def head_neck_fields(cb, eb, cf, ef, head_fixed_b):
    """How much each vertex follows the head (h) and, of the rest, the neck (n).

    h is a harmonic blend over the surface of body + face (joined at their seam, so both sides get identical
    values there): 1 on the head, hat and face above the jaw, 0 on the chest and shoulders, and a smooth band
    over the throat and under the chin in between. n is the neck's share of what is left, along the neck.
    The face mesh is not welded (its UV-seam copies keep their own shape-key data), so its coincident copies
    are joined here into one graph node: the blend then flows across those seams and both copies get the
    very same value (otherwise each seam is a wall, and the two sides pull apart when the head turns)."""
    nb = len(cb)
    kd = kdtree.KDTree(nb)
    for i, p in enumerate(cb):
        kd.insert(p, i)
    kd.balance()
    fg = coincident_groups(cf)
    node_f = -np.ones(len(cf), np.int64)
    for i, p in enumerate(cf):
        _, j, d = kd.find(Vector(p))
        if d < 1e-5:
            node_f[fg[i]] = j if node_f[fg[i]] < 0 else node_f[fg[i]]
    nxt = nb
    for i in range(len(cf)):
        g = fg[i]
        if node_f[g] < 0:
            node_f[g] = nxt
            nxt += 1
        node_f[i] = node_f[g]
    P = np.zeros((nxt, 3)); P[:nb] = cb; P[node_f] = cf
    is_face = np.zeros(nxt, bool); is_face[node_f[node_f >= nb]] = True
    E = np.concatenate([eb, node_f[ef]])
    E = E[E[:, 0] != E[:, 1]]
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    lat = np.abs(x - 0.07)
    one = (z > 0.10) | (is_face & (z > 0.06))
    one[:nb] |= head_fixed_b
    zero = (z < -0.09) | ((lat > 0.21) & (z < -0.05))          # shoulders (leaving room to blend under the ears)
    zero &= ~one
    fixed = np.nonzero(one | zero)[0]
    h = harmonic(nxt, E, fixed, one[fixed].astype(np.float64), iters=900)
    h = np.clip(h, 0, 1)
    n = smoothstep(-0.17, -0.05, z) * (1 - smoothstep(0.17, 0.25, lat))
    return h[:nb], h[node_f], n[:nb], n[node_f]


def seg_dist(p, a, b):
    a, b = np.asarray(a), np.asarray(b)
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def build_armature():
    arm = bpy.data.armatures.new(f"{NAME}_rig")
    rig = bpy.data.objects.new(f"{NAME}_rig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    for name, (h, t, parent, conn, xh) in BONES.items():
        b = eb.new(name)
        b.head, b.tail = Vector(h), Vector(t)
    for name, (h, t, parent, conn, xh) in BONES.items():
        b = eb[name]
        if parent:
            b.parent = eb[parent]
            b.use_connect = conn
        if xh == "x":
            xa = Vector((1, 0, 0))
        elif isinstance(xh, tuple) and xh and xh[0] == "hinge":
            u = Vector(BONES[xh[1]][1]) - Vector(BONES[xh[1]][0])
            f = Vector(BONES[xh[2]][1]) - Vector(BONES[xh[2]][0])
            xa = u.cross(f).normalized()
        else:
            xa = Vector(xh)
        ydir = (b.tail - b.head).normalized()
        xa = (xa - ydir * xa.dot(ydir)).normalized()
        b.align_roll(xa.cross(ydir))           # Z = X x Y, so local X ends up on the hint
        b.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "ZXY" if pb.name in ("root", "spine", "chest", "neck", "head") else "XYZ"
    # report the achieved local X axes
    axes = {b.name: [round(v, 3) for v in b.matrix_local.col[0][:3]] for b in arm.bones}
    return rig, axes


def loose_parts(nv, tri):
    parent = np.arange(nv)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for t in tri:
        ra, rb, rc = find(t[0]), find(t[1]), find(t[2])
        parent[rb] = ra
        parent[find(rc)] = ra
    return np.array([find(i) for i in range(nv)])


def skin_weights(rig, body, face, cloud):
    """Region-aware weights. Every bone is a capsule; a vertex goes to the nearest allowed capsules (normalised
    distance, soft-min), then the weights are smoothed over the welded surface. Rigid parts: the riding swirl ring
    (root), the hat swirl (head), the leftover back swirl (chest), the held cloud (cloud). Hands and feet only
    take skin, so his lap never follows his hands; legs never take arm weights. The belly patch inherits the
    weights of its rim (harmonic), and the face mesh blends into the neck exactly like the body around it."""
    me = body.data
    co, ls, lt, lv, uv = mesh_np(me)
    nv = len(co)
    tri = lv[ls[:, None] + np.arange(3)[None]]
    base_img = base_image(me.materials[0])
    px = img_np(base_img)
    cls, _ = face_classes(co, ls, lv, uv, px)
    pm = np.zeros(len(ls), np.int32)
    me.attributes["invite_patch"].data.foreach_get("value", pm)
    patch_f = pm == 1
    cls[patch_f] = 2
    # per-vertex: skin if most of its faces are skin
    skin_cnt = np.zeros(nv); tot = np.zeros(nv)
    np.add.at(skin_cnt, tri.ravel(), np.repeat(cls == 1, 3))
    np.add.at(tot, tri.ravel(), 1)
    skin = skin_cnt / np.maximum(tot, 1) >= 0.5
    on_patch = np.zeros(nv, bool); on_patch[tri[patch_f].ravel()] = True
    on_other = np.zeros(nv, bool); on_other[tri[~patch_f].ravel()] = True
    patch_inner = on_patch & ~on_other
    # rigid parts
    comp = loose_parts(nv, tri)
    sizes = np.bincount(comp, minlength=nv)
    main = np.argmax(sizes)
    rigid = {}
    for cid in np.unique(comp):
        if cid == main:
            continue
        vs = np.nonzero(comp == cid)[0]
        c = co[vs].mean(0)
        if sizes[cid] > 50 and c[2] > -0.15 and c[0] < -0.15 and c[1] < 0.2:
            rigid.update({int(v): "head" for v in vs})          # the swirl beside his hat
        elif c[1] > 0.3:
            rigid.update({int(v): "chest" for v in vs})         # what is left of the backdrop behind his back
    lab = cloud_clusters(co, tri, cls == 0)
    area = np.array([p.area for p in me.polygons])
    best, best_a = None, 0
    for r in np.unique(lab[lab >= 0]):
        m = lab == r
        cz = co[tri[m]].mean((0, 1))[2]
        if cz < -0.45 and area[m].sum() > best_a:
            best, best_a = r, area[m].sum()
    ring_v = np.unique(tri[lab == best].ravel())
    rigid.update({int(v): "hips" for v in ring_v})          # his riding ring goes wherever he goes
    names = [n for n in RADII]
    S = np.full((nv, len(names)), np.inf)
    for j, n in enumerate(names):
        h, t = BONES[n][0], BONES[n][1]
        d = seg_dist(co, h, t) / RADII[n]
        g = gate(n, co, skin)
        S[g, j] = d[g]
    smin = S.min(1, keepdims=True)
    Wn = np.exp(-(S - smin) / 0.12)
    Wn[~np.isfinite(S)] = 0
    Wn /= np.maximum(Wn.sum(1, keepdims=True), 1e-12)
    # smooth over the welded surface (rigid and patch-inner vertices hold still)
    ev = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get("vertices", ev); ev = ev.reshape(-1, 2)
    pinned = np.zeros(nv, bool); pinned[list(rigid.keys())] = True; pinned |= patch_inner
    deg = np.bincount(ev.ravel(), minlength=nv).astype(np.float64)
    for _ in range(SMOOTH_ITERS):
        acc = np.zeros_like(Wn)
        np.add.at(acc, ev[:, 0], Wn[ev[:, 1]]); np.add.at(acc, ev[:, 1], Wn[ev[:, 0]])
        avg = acc / np.maximum(deg, 1)[:, None]
        upd = ~pinned & (deg > 0)
        Wn[upd] = 0.5 * Wn[upd] + 0.5 * avg[upd]
    # head and neck on top (harmonic over body + face, identical at their seam)
    allnames = ["root", "head", "belly", "cloud", "neck"] + [n for n in names if n != "neck"]
    fme = face.data
    fco = np.empty(len(fme.vertices) * 3); fme.vertices.foreach_get("co", fco); fco = fco.reshape(-1, 3)
    fev = np.empty(len(fme.edges) * 2, np.int64); fme.edges.foreach_get("vertices", fev); fev = fev.reshape(-1, 2)
    head_fixed = np.zeros(nv, bool); head_fixed[[v for v, nm in rigid.items() if nm == "head"]] = True
    head_fixed |= skin & (np.abs(co[:, 0] - 0.07) > 0.2) & (co[:, 2] > 0.03)         # his ears
    hb, hfc, nbk, nfc = head_neck_fields(co, ev, fco, fev, head_fixed)
    Wo = Wn[:, [i for i, n in enumerate(names) if n != "neck"]]
    Wo /= np.maximum(Wo.sum(1, keepdims=True), 1e-12)
    W = np.zeros((nv, len(allnames)))
    W[:, 1] = hb
    W[:, 4] = (1 - hb) * nbk
    W[:, 5:] = Wo * ((1 - hb) * (1 - nbk))[:, None]
    for v, n in rigid.items():
        W[v] = 0
        W[v, allnames.index(n)] = 1
    # belly patch: harmonic from its rim
    pv = np.nonzero(on_patch)[0]
    loc = {int(v): i for i, v in enumerate(pv)}
    pe = [(loc[a], loc[b]) for a, b in ev if a in loc and b in loc]
    fixed = [loc[int(v)] for v in pv if not patch_inner[v]]
    W[pv] = harmonic(len(pv), pe, fixed, W[pv][fixed], iters=800)
    # belly bone: the front of his tummy (patch and lower bib), for breathing
    b = 0.5 * np.exp(-((co[:, 0] - 0.04) / 0.13) ** 2 - ((co[:, 2] + 0.37) / 0.10) ** 2) * (co[:, 1] < -0.18)
    b[skin] = 0
    b[list(rigid.keys())] = 0
    # not on his hands and wrists either (their cut rims next to the held cloud are not skin-coloured): a breath must
    # not pull his fingers back off the cloud, nor hold them back when his forearms lift it
    armw = W[:, [allnames.index(n) for n in ("forearm_L", "forearm_R", "hand_L", "hand_R")]].sum(1)
    b *= 1 - smoothstep(0.05, 0.3, armw)
    W *= (1 - b)[:, None]
    W[:, 2] += b
    # tidy: at most 4 influences, none below 1 %
    W[W < 0.01] = 0
    order = np.argsort(-W, axis=1)
    keep = np.zeros_like(W, bool)
    np.put_along_axis(keep, order[:, :4], True, axis=1)
    W[~keep] = 0
    W /= np.maximum(W.sum(1, keepdims=True), 1e-12)
    # held cloud first (it copies his hands), then the belly patch hidden behind it follows the cloud
    Wc, cloud_rep = cloud_weights(cloud, co, W, allnames)
    W, patch_rep = patch_follows_cloud(W, co, ev, on_patch, patch_inner, cloud, Wc)
    assign(body, allnames, W)
    # face mesh: head/neck from the shared fields, the rest copied from the body vertex next to it
    kd = kdtree.KDTree(nv)
    for i, p in enumerate(co):
        kd.insert(p, i)
    kd.balance()
    near = np.array([kd.find(Vector(p))[1] for p in fco])
    rest = W[near].copy(); rest[:, 1] = 0; rest[:, 4] = 0
    rest /= np.maximum(rest.sum(1, keepdims=True), 1e-12)
    Wf = rest * ((1 - hfc) * (1 - nfc))[:, None]
    Wf[:, 1] = hfc
    Wf[:, 4] = (1 - hfc) * nfc
    Wf[Wf < 0.01] = 0
    Wf /= np.maximum(Wf.sum(1, keepdims=True), 1e-12)
    # the face's UV-seam copies (and any other coincident vertices) move as one
    Wf, n_seam_groups = same_weights_on_coincident(Wf, coincident_groups(fco))
    Wf = top4(Wf)
    assign(face, allnames, Wf)
    # held cloud: where his fingers wrap it, it takes his hands' own weights (so the cut finger rims stay seated
    # on it whatever the arms do); further in it blends to its own bone, which follows both hands a little late
    assign(cloud, allnames, Wc)
    for o in (body, face, cloud):
        o.parent = rig
        o.matrix_parent_inverse = rig.matrix_world.inverted()
        md = o.modifiers.new("Armature", "ARMATURE")
        md.object = rig
    dom = {}
    for j, n in enumerate(allnames):
        dom[n] = int((W.argmax(1) == j).sum())
    return dict(rigid_verts={n: sum(1 for v in rigid.values() if v == n) for n in ("root", "head", "chest")},
                dominant_body_verts=dom, patch_inner_verts=int(patch_inner.sum()), face_seam_groups=n_seam_groups,
                held_cloud=cloud_rep, patch=patch_rep)


def top4(W):
    """At most 4 influences (glTF), none below 1 %, normalised. Identical rows stay identical."""
    W = W.copy()
    W[W < 0.01] = 0
    order = np.argsort(-W, axis=1, kind="stable")
    keep = np.zeros_like(W, bool)
    np.put_along_axis(keep, order[:, :4], True, axis=1)
    W[~keep] = 0
    return W / np.maximum(W.sum(1, keepdims=True), 1e-12)


GRIP_IN, GRIP_OUT = 0.012, 0.05     # metres from his hands: fully on the hands inside, fully on the cloud bone outside


def cloud_weights(cloud, cb, Wb, names):
    """Skin weights of the held cloud. Cloud vertices next to his hands (where the fingers wrap it) copy the
    weights of the hand and wrist surface beside them (whatever bones it follows), so cloud and fingers deform as
    one there: the 40-odd cloud vertices that were cut free of his hands and wrists sit exactly on hand vertices
    and copy their weights exactly, so that cut can never open. Further from the hands the weights blend smoothly
    into the 'cloud' bone. Only his arms count: where the cloud was cut from his bib and belly (hidden behind it)
    it does not follow the chest, or the hands would stretch it as they lift."""
    me = cloud.data
    cc = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", cc); cc = cc.reshape(-1, 3)
    arm = [names.index(n) for n in ("hand_L", "hand_R", "forearm_L", "forearm_R", "upperarm_L", "upperarm_R")]
    x, y, z = cb[:, 0], cb[:, 1], cb[:, 2]
    hand = np.nonzero((y < -0.2) & (z > -0.56) & (z < -0.25) & (Wb[:, arm].sum(1) > 0.5))[0]
    kd = kdtree.KDTree(len(hand))
    for k, v in enumerate(hand):
        kd.insert(Vector(cb[v]), k)
    kd.balance()
    n = len(cc)
    Wh = np.zeros((n, len(names)))
    dmin = np.zeros(n)
    for i, p in enumerate(cc):
        near = kd.find_n(Vector(p), 8)
        d = np.array([x[2] for x in near]); idx = hand[[x[1] for x in near]]
        dmin[i] = d[0]
        if d[0] < COINCIDENT:
            Wh[i] = Wb[idx[0]]
            continue
        g = np.exp(-((d - d[0]) / 0.006) ** 2)
        Wh[i] = (Wb[idx] * g[:, None]).sum(0) / g.sum()
    a = 1.0 - smoothstep(GRIP_IN, GRIP_OUT, dmin)
    one = np.zeros(len(names)); one[names.index("cloud")] = 1
    Wc = a[:, None] * Wh + (1 - a)[:, None] * one
    # a few smoothing passes over the cloud's own edges (the grip itself, within GRIP_IN, holds still)
    ev = np.empty(len(me.edges) * 2, np.int64); me.edges.foreach_get("vertices", ev); ev = ev.reshape(-1, 2)
    deg = np.bincount(ev.ravel(), minlength=n).astype(np.float64)
    free = (dmin > GRIP_IN) & (deg > 0)
    for _ in range(6):
        acc = np.zeros_like(Wc)
        np.add.at(acc, ev[:, 0], Wc[ev[:, 1]]); np.add.at(acc, ev[:, 1], Wc[ev[:, 0]])
        avg = acc / np.maximum(deg, 1)[:, None]
        Wc[free] = 0.5 * Wc[free] + 0.5 * avg[free]
    Wc = top4(Wc)
    rep = dict(verts=n, exact_copies_of_hand_vertices=int((dmin < COINCIDENT).sum()), on_hands_fully=int((a > 0.999).sum()), blended=int(((a > 0.001) & (a <= 0.999)).sum()),
               on_cloud_bone_only=int((a <= 0.001).sum()), cloud_bone_share_mean=round(float(Wc[:, names.index("cloud")].mean()), 3))
    log("held cloud weights:", rep)
    return Wc, rep


def patch_follows_cloud(W, co, ev, on_patch, patch_inner, cloud, Wc):
    """Where the held cloud hides the belly patch (seen from the front), each patch vertex takes the weights of the
    cloud surface straight in front of it, so patch and cloud move as one there and the patch cannot come through
    between his hands and the cloud whatever the arms do; between there and the patch's rim (bib, lap, hands) the
    weights blend harmonically."""
    cme = cloud.data
    cv = np.array([v.co[:] for v in cme.vertices])
    polys = [list(p.vertices) for p in cme.polygons]
    bvh = bvhtree.BVHTree.FromPolygons([Vector(v) for v in cv], polys)
    pv = np.nonzero(on_patch)[0]
    loc = {int(v): i for i, v in enumerate(pv)}
    vals = W[pv].copy()
    fixed = []
    covered = 0
    for i, v in enumerate(pv):
        if not patch_inner[v]:
            fixed.append(i)                                 # rim: his own vertices keep their weights
            continue
        x, y, z = co[v]
        hit = bvh.ray_cast(Vector((x, y - 1.0, z)), Vector((0, 1, 0)), 1.0)
        if hit[0] is None:
            continue
        tri = cv[polys[hit[2]][:3]]
        # barycentric coordinates of the hit point
        T = np.array([tri[0], tri[1], tri[2]]).T
        lam = np.linalg.lstsq(np.vstack([T, np.ones(3)]), np.r_[np.array(hit[0][:]), 1.0], rcond=None)[0]
        lam = np.clip(lam, 0, None); lam /= max(lam.sum(), 1e-12)
        vals[i] = lam @ Wc[polys[hit[2]][:3]]
        fixed.append(i)
        covered += 1
    pe = [(loc[a], loc[b]) for a, b in ev if a in loc and b in loc]
    W = W.copy()
    W[pv] = harmonic(len(pv), pe, fixed, vals[fixed], iters=800)
    W[pv] = top4(np.clip(W[pv], 0, None))
    rep = dict(patch_verts=len(pv), inner_hidden_by_cloud=covered, inner=int(patch_inner.sum()))
    log("belly patch weights:", rep)
    return W, rep


def scale_character(s):
    """Uniform scale about the origin of his meshes (shape keys too) and skeleton: the likeness is unchanged."""
    M = Matrix.Scale(s, 4)
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name.startswith(NAME):
            o.data.transform(M, shape_keys=o.data.shape_keys is not None)
            o.data.update()
    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            o.data.transform(M)
    sc = bpy.context.scene
    sc["invite_scale"] = float(sc.get("invite_scale", 1.0)) * s


def rest_height():
    zs = []
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name.startswith(NAME):
            co = np.empty(len(o.data.vertices) * 3); o.data.vertices.foreach_get("co", co)
            zs.append(co.reshape(-1, 3)[:, 2])
    z = np.concatenate(zs)
    return float(z.max() - z.min())


def assign(obj, names, W):
    obj.vertex_groups.clear()
    groups = {n: obj.vertex_groups.new(name=n) for n in names}
    for j, n in enumerate(names):
        idx = np.nonzero(W[:, j] > 0)[0]
        g = groups[n]
        for i in idx:
            g.add([int(i)], float(W[i, j]), "REPLACE")


def stage_rig():
    body = bpy.data.objects[f"{NAME}_body"]
    face = bpy.data.objects[f"{NAME}_face"]
    cloud = bpy.data.objects[f"{NAME}_cloud_held"]
    strip_old_rig()
    sc = bpy.context.scene
    old = float(sc.get("invite_scale", 1.0))
    if abs(old - 1.0) > 1e-9:                    # re-run on a saved, already scaled file: back to the sculpt's size
        scale_character(1.0 / old)
        sc["invite_scale"] = 1.0
    rig, axes = build_armature()                 # (the joints and weighting regions are in the sculpt's metres)
    rep = skin_weights(rig, body, face, cloud)
    rep["bone_x_axes"] = axes
    h0 = rest_height()
    s = HEIGHT / h0
    scale_character(s)
    rep["scale"] = dict(sculpt_height_m=round(h0, 4), factor=round(s, 5), height_m=round(rest_height(), 4))
    log("rig:", {k: v for k, v in rep.items() if k != "bone_x_axes"})
    return rep


# ───────────────────────────── 3. the take: one continuous, eased performance ─────────────────────────────
#
# Every channel is a smooth function of time (seconds): quintic eases S(t, a, b) that overlap, and gentle
# oscillations (bob, breath, sway) whose envelopes are eased too. "hover" is the periodic part alone (2.0 s loop);
# "invite" starts as exactly that hover motion and blends into the performance, so hover -> invite is seamless in
# pose, velocity and acceleration. Curves are keyed every KEY_STEP frames as Bezier keys whose handles carry the
# curve's own slope (cubic Hermite), so the keyed motion follows the designed one closely and stays smooth.

SHIFT = 1.5                # seconds: the performance (everything but the travel) runs this much later than in the
                           # first cut, so he can float in from well off screen without hurrying
INVITE_END = 10.0 + SHIFT  # seconds; the cloud can cover him at any swap between ~8.5 and 11.5 s
HOVER_LEN = 2.0
KEY_STEP = 4               # frames between keys (at 60 fps)
T_ARR = 2.9 + SHIFT        # the travel ends: he comes to rest
ROOT_KNOT, ROOT_KNOT_END = 12, 264   # the root's path knots (frames) while he travels (>= T_ARR); still after that
CLOUD_LAG = 2 / FPS        # the middle of the held cloud trails his hands by two frames (where they grip it, it doesn't)
SCALE = 1.0                # sculpt metres -> his size on the timeline (set from the scene by stage_anim)
# The travel, per axis (start, cruise from, landing from), seconds: the speed rises (quintic) while he is still off
# screen, cruises, and falls (quintic) to rest at T_ARR: a long, soft landing with no jolt at either end.
TRAVEL = {"x": (0.0, 0.9, 2.2), "y": (1.0, 2.0, 2.5), "z": (0.8, 1.7, 2.4)}
# A quick start, sideways only: while he is still off screen his speed gets an extra eased bump (up to BOOST[0] times
# his cruise speed more, at BOOST[1] s, gone by BOOST[2] s), so he can start further out (by as far as he cruises in
# BOOST_S seconds) without the visitor waiting longer for him. The bump fades out slowly, overlapping the landing, so
# once on screen he only ever slows down (one long glide to rest, never slow-coast-slow); phones see the old speed.
BOOST_S = 0.5
BOOST = (2 * BOOST_S / 2.6, 0.7, 2.6)
# Where he waits (hover) and the take starts, in the sculpt's metres (scaled with him): a little back and up, so his
# path arcs in and down, and far enough to the right that he starts fully off screen in the site's real stage box
# (the middle row of the page, between heading and button): on 16:9, 16:10, 21:9 and phones, and also in real
# browser windows (a screen less the browser's bars and the taskbar: 1366x768 laptops, 1080p, 21:9, 3440x1440).
# Against the first cut (4.0 m) he cruises 0.5 s longer and gets the quick start, at the same cruise speed.
_trip = lambda T, a, b, c: T - b + (b - a) / 2 - (T - c) / 2      # noqa: E731  area under a travel speed profile
CRUISE = 4.0 / _trip(3.9, 0.0, 0.9, 1.7)                           # sculpt m/s, his sideways cruise (as in the first cut)
START = (CRUISE * (_trip(T_ARR, *TRAVEL["x"]) + BOOST[0] * BOOST[2] / 2), 0.45, 0.18)
GLOW_FLOOR = 2.0 ** -10    # ctl_glow's resting scale.x: never 0 (a singular matrix), and exact after meshopt's 12-bit filter
# His painted eyes look up and to his left, and his sculpted face is turned a little that way too, so with his head
# square to the visitor he looks past them. While he smiles and offers the cloud he keeps his head turned a little
# to his right and down, so his eyes meet the visitor's (the pose of his eyes mid-turn, where they do). Posing only;
# all zeros brings back the square head. "hello" is how far the head lifts as he leans in with the offer (degrees).
GAZE = {"yaw": -13.0, "pitch": 4.5, "hello": 8.0}
# Beats (seconds on the master timeline, rounded to frames), in the order the site expects. "arrive" is measured
# from the travel (its speed falls below 5 % of its peak); "turn" is the middle of the body's turn.
MARKERS = {"floatIn": 0.0, "arrive": None, "turn": 2.55 + SHIFT, "smile": 3.2 + SHIFT, "offer": 3.5 + SHIFT,
           "lookDown": 4.95 + SHIFT, "glow": 5.1 + SHIFT}

# The offer at its peak (degrees, metres). His sculpted forearms lie along his knees (fused to them) and his hands
# are fused round the cloud, so the arms can only do a little: the upper arms stay where they are (a 14 deg swing
# tore his knees in tests) and both forearms turn up 14 deg about the one line through both elbows (world X), so
# his hands and the cloud rise together as one piece and nothing pulls apart (24 deg stretched the knee fur 5x).
# The rest is his whole body, which bends nothing: he leans in on his riding cloud, rises on it (7 cm) and
# floats nearer the visitor, holding the cloud out to them, with a small extra lean in the spine and chest; his
# head lifts to keep looking at them. The arm lift and the lean cancel each other's tilt, so the cloud is carried
# up and towards the visitor nearly level (tilting it up shows its cut underside).
OFFER = {"forearm": 14.0, "hand": -9.0, "shoulder": 1.0, "chest": 2.0, "spine": 1.0, "lean": 4.0, "nearer": 0.06,
         "rise": 0.07}
SETTLE = 0.08              # after lowering, the arms sink this share past rest and come back (they settle, not stop)
PRESENT = {"up": 0.0, "forward": 0.0, "tilt": 0.0}   # the cloud stays seated in his hands (no float out of them)


def S(t, a, b):
    """Quintic ease from 0 (t <= a) to 1 (t >= b): zero velocity and acceleration at both ends."""
    u = np.clip((np.asarray(t, np.float64) - a) / (b - a), 0.0, 1.0)
    return u * u * u * (u * (u * 6 - 15) + 10)


def bump(t, a, b, c, d):
    return S(t, a, b) - S(t, c, d)


def wave(t, period, phase=0.0):
    return np.cos(2 * np.pi * np.asarray(t, np.float64) / period + phase)


_TRAVEL = {}


def travel_profile(start, cruise, land, T, boost=None):
    """(times, share travelled, speed) of a trip whose speed rises from `start` to `cruise`, holds, and falls from
    `land` to T (quintic eases), plus an optional early bump (height, peak, end) on top: smooth in position,
    velocity and acceleration everywhere."""
    key = (start, cruise, land, T, boost)
    if key not in _TRAVEL:
        u = np.linspace(0.0, T, 16001)
        v = S(u, start, cruise) - S(u, land, T)
        if boost:
            v = v + boost[0] * (S(u, 0.0, boost[1]) - S(u, boost[1], boost[2]))
        c = np.concatenate([[0.0], np.cumsum((v[1:] + v[:-1]) / 2)])
        c *= u[1]
        _TRAVEL[key] = (u, c / c[-1], v / c[-1])
    return _TRAVEL[key]


def travel(t, axis):
    u, c, _ = travel_profile(*TRAVEL[axis], T_ARR, BOOST if axis == "x" else None)
    return np.interp(np.clip(np.asarray(t, np.float64), 0.0, T_ARR), u, c)


def arrive_time(share=0.05):
    """When his sideways travel speed falls below `share` of his cruise speed."""
    u, _, v = travel_profile(*TRAVEL["x"], T_ARR, BOOST)
    i = int(np.searchsorted(u, TRAVEL["x"][2]))          # the landing starts (cruise speed)
    return float(u[i + np.argmax(v[i:] < share * v[i])])


def offer_env(t, lead):
    """Rise, hold (so the visitor sees it), lower: later parts of the arm start a little later (overlapping action)."""
    return S(t, 3.5 + lead, 4.2 + lead) - S(t, 4.45 + lead, 5.1 + lead)


def settle(t, lead):
    """After lowering, the arms sink a touch past rest and come back (they settle, not stop)."""
    return -SETTLE * bump(t, 5.0 + lead, 5.35 + lead, 5.4 + lead, 5.95 + lead)


def motion_core(t, hover=False):
    """Every channel except the travel, on the performance's own clock (it starts at 0 s; before that he hovers).
    Angles in degrees; root_x/y/z are offsets on top of the travel and belly a translation (sculpt metres)."""
    t = np.asarray(t, np.float64)
    z0 = np.zeros_like(t)
    m = {}
    # periodic parts (also the whole of "hover")
    bob = 0.022 * wave(t, 1.0)
    rock = 0.6 * wave(t, 1.0, -0.9)               # the cloud rocks a little after each bob
    sway = 1.5 * wave(t, 2.0)
    yaw_sway = 2.0 * wave(t, 2.0)
    breath2 = wave(t, 2.0, 0.3)                   # his quick, floating breath
    look_h = 10 + 7 * wave(t, 2.0)                # head looks about while he hovers
    nod_h = -2 + 1.5 * wave(t, 1.0, -0.75)         # the head nods just after each bob
    tilt_h = -3 * wave(t, 2.0)
    if hover:
        m["root_x"], m["root_y"], m["root_z"] = z0, z0, bob
        m["root_yaw"] = -48 + yaw_sway
        m["root_pitch"] = rock
        m["root_roll"] = sway
        m["spine_pitch"] = -0.3 * breath2
        m["chest_pitch"] = -0.5 * breath2
        m["chest_yaw"] = 0.06 * look_h
        m["chest_roll"] = -0.6 * sway
        m["neck_yaw"] = 0.33 * look_h
        m["head_yaw"] = 0.61 * look_h
        m["neck_pitch"] = 0.3 * nod_h
        m["head_pitch"] = 0.7 * nod_h
        m["head_roll"] = tilt_h
        m["shoulder"] = 0.6 * (0.5 - 0.5 * breath2)
        m["belly"] = 0.002 * (0.5 - 0.5 * breath2)
        for k in ("forearm", "hand", "present"):
            m[k] = z0
        m["browsUp"] = 0.2 + 0.05 * wave(t, 2.0)
        m["smile"] = 0.08 + z0
        m["cheekRaise"] = 0.05 + z0
        m["glow"] = z0 + GLOW_FLOOR
        return m
    # ── invite ──
    fade_bob = 1 - S(t, 1.5, 3.0)
    fade_early = 1 - S(t, 0.25, 0.85)
    slow_bob = 0.007 * wave(t - 2.6, 2.6) * S(t, 2.3, 3.3) * (1 - S(t, 5.7, 7.3))
    lean = offer_env(t, -0.05)                     # he leans in a moment before his hands rise
    m["root_x"] = z0
    m["root_y"] = -OFFER["nearer"] * lean          # -Y: towards the visitor
    m["root_z"] = bob * fade_bob + slow_bob + OFFER["rise"] * lean
    m["root_yaw"] = -48 + yaw_sway * (1 - S(t, 0.5, 1.5)) + 48 * S(t, 2.05, 3.05)
    m["root_pitch"] = rock * fade_bob - 1.5 * bump(t, 0.2, 0.8, 1.5, 2.2) + 2.0 * bump(t, 2.15, 2.5, 2.6, 3.2) \
        + OFFER["lean"] * lean
    m["root_roll"] = sway * (1 - S(t, 0.8, 2.2)) - 2.0 * bump(t, 0.5, 1.1, 1.5, 2.3)
    # breathing: quick while floating, slower and deeper once he is still
    br = (-0.5 * breath2) * (1 - S(t, 2.0, 3.2))
    br2 = -0.7 * wave(t - 3.0, 2.5) * S(t, 2.6, 3.6)
    m["spine_pitch"] = 0.6 * br + 0.4 * br2 + 1.5 * bump(t, 2.25, 2.6, 2.7, 3.35) + OFFER["spine"] * offer_env(t, -0.04) \
        + 1.0 * S(t, 4.95, 5.6)
    m["chest_pitch"] = br + br2 - 1.5 * bump(t, 0.2, 0.8, 1.6, 2.3) + 2.5 * bump(t, 2.3, 2.65, 2.75, 3.4) \
        + OFFER["chest"] * offer_env(t, -0.02) + 2.5 * S(t, 4.95, 5.6)
    m["chest_roll"] = -0.6 * sway * (1 - S(t, 0.8, 2.2))
    # head: looks about, leads the turn, nods on the stop, tilts with curiosity, lifts for "hello" (keeping his eyes
    # on the visitor while he leans in), looks down
    look = look_h * fade_early - 10 * S(t, 0.25, 0.8) + 30 * S(t, 0.9, 1.45) - 14 * S(t, 1.5, 1.95) - 6 * S(t, 1.85, 2.6)
    lead = 48 * (S(t, 1.8, 2.75) - S(t, 1.93, 2.93))
    drift_y = 1.2 * np.sin(2 * np.pi * (t - 5.7) / 4.3) * S(t, 5.7, 6.9)
    # eyes on the visitor: his head stops a little short of square as his body finishes the turn, holds through the
    # smile and the offer, and lets go into the look-down
    gaze = S(t, 2.2, 2.9) - S(t, 4.85, 5.5)
    yrel = look + lead + drift_y + GAZE["yaw"] * gaze
    m["chest_yaw"] = 0.06 * yrel                    # the turn of his head spreads down the spine
    m["neck_yaw"] = 0.33 * yrel
    m["head_yaw"] = 0.61 * yrel
    hello = bump(t, 3.45, 4.1, 4.4, 5.0)
    pgen = (nod_h + 2) * fade_bob - 2 * fade_early - 5 * S(t, 0.25, 0.7) + 6 * S(t, 0.9, 1.45) - 4 * S(t, 1.5, 1.95) \
        + 3 * S(t, 1.85, 2.4) + 4 * bump(t, 2.35, 2.7, 2.8, 3.45) + 4 * S(t, 2.6, 3.1) \
        - GAZE["hello"] * hello + GAZE["pitch"] * gaze + 0.8 * np.sin(2 * np.pi * (t - 5.7) / 3.7) * S(t, 5.7, 6.9)
    m["neck_pitch"] = 0.3 * pgen + 6 * S(t, 4.9, 5.55)
    m["head_pitch"] = 0.7 * pgen + 20 * S(t, 4.95, 5.6)
    m["head_roll"] = tilt_h * (1 - S(t, 0.3, 0.9)) + 7 * bump(t, 0.9, 1.4, 1.5, 2.0) + 11 * S(t, 2.55, 3.0) \
        - 7 * S(t, 3.3, 3.8) - 4 * S(t, 3.6, 4.0) + 5 * S(t, 5.0, 5.6)
    # arms: the offer (shoulders lead, then forearms, then hands), then they settle
    inhale2 = (0.5 - 0.5 * breath2) * (1 - S(t, 2.0, 3.2)) + (0.5 - 0.5 * wave(t - 3.0, 2.5)) * S(t, 2.6, 3.6)
    m["shoulder"] = 0.6 * inhale2 + OFFER["shoulder"] * offer_env(t, 0.0)
    m["forearm"] = OFFER["forearm"] * (offer_env(t, 0.06) + settle(t, 0.06))
    m["hand"] = OFFER["hand"] * (offer_env(t, 0.10) + settle(t, 0.10))
    m["present"] = offer_env(t, 0.06)
    m["belly"] = 0.002 * inhale2 + 0.002 * S(t, 2.6, 3.6) * (0.5 - 0.5 * wave(t - 3.0, 2.5))
    # face (shape keys only; the "welcoming" recipe at the smile: smile 0.5, cheekRaise 0.6, browsUp 0.25)
    m["browsUp"] = (0.2 + 0.05 * wave(t, 2.0)) * (1 - S(t, 0.3, 0.9)) + 0.2 * S(t, 0.3, 0.9) \
        + 0.15 * bump(t, 0.95, 1.3, 1.5, 1.9) + 0.4 * S(t, 2.5, 3.0) - 0.35 * S(t, 3.2, 3.55) \
        + 0.1 * hello + 0.15 * S(t, 4.95, 5.5) - 0.05 * S(t, 6.0, 7.0)
    m["smile"] = 0.08 + 0.12 * bump(t, 0.95, 1.3, 1.6, 2.0) + 0.42 * S(t, 3.2, 3.55) + 0.08 * hello \
        - 0.08 * S(t, 4.95, 5.5)
    m["cheekRaise"] = 0.05 + 0.55 * S(t, 3.22, 3.6) + 0.05 * hello - 0.1 * S(t, 4.95, 5.5)
    m["glow"] = GLOW_FLOOR + (1 - GLOW_FLOOR) * S(t, 5.1, 7.3)   # never exactly 0 (see GLOW_FLOOR)
    return m


def motion(t, hover=False):
    """All channels at times t (seconds on the master timeline). The performance is motion_core, SHIFT seconds
    late; the travel from START is added on top (in hover he stays at START); metres are scaled to his size."""
    t = np.asarray(t, np.float64)
    m = motion_core(t - SHIFT, hover)
    if hover:
        ex = ey = ez = np.zeros_like(t)
    else:
        ex, ey, ez = travel(t, "x"), travel(t, "y"), travel(t, "z")
    m["travel_x"], m["travel_y"], m["travel_z"] = START[0] * (1 - ex), START[1] * (1 - ey), START[2] * (1 - ez)
    m["root_x"] = m["travel_x"] + m["root_x"]
    m["root_y"] = m["travel_y"] + m["root_y"]
    m["root_z"] = m["travel_z"] + m["root_z"]
    for k in ("root_x", "root_y", "root_z", "travel_x", "travel_y", "travel_z", "belly"):
        m[k] = np.asarray(m[k]) * SCALE
    return m


def axis_eulers(rig, bone, axis, deg):
    """Local XYZ Eulers (radians, one row per value of `deg`) of exact rotations by `deg` about an armature-space
    axis, for a bone at rest."""
    R = rig.data.bones[bone].matrix_local.to_3x3()
    ax = (R.inverted() @ Vector(axis)).normalized()
    return np.array([Quaternion(ax, math.radians(float(d))).to_euler("XYZ")[:] for d in np.atleast_1d(deg)])


def root_grid(rig, d):
    """Snap a root offset (world axes) so the root joint's glTF translation is exactly representable by meshopt's
    exponential filter (12-bit mantissa, one exponent per vector): it then decodes to the very same numbers."""
    H = rig.data.bones["root"].head_local
    v = Vector(d) + H
    g = np.array([v.x, v.z, -v.y])                       # glTF axes
    e = math.frexp(float(np.abs(g).max()))[1]
    step = 2.0 ** (e + 1 - 12)
    g = np.round(g / step) * step
    return np.array([g[0], -g[2], g[1]]) - np.array(H)


def coarse_path(rig, m_fn, hover):
    """The root's share of the path: straight segments between snapped knots every ROOT_KNOT frames. The
    knots decode exactly after the project's meshopt compression, and three.js interpolates straight segments
    exactly, so the root's travel arrives undamaged; the hips carry the remainder (small numbers, precise)."""
    if hover:
        mm = m_fn(np.zeros(1))
        c = root_grid(rig, [mm[k][0] for k in ("travel_x", "travel_y", "travel_z")])
        return lambda t: np.tile(c, (len(np.atleast_1d(t)), 1))
    kf = np.arange(0, ROOT_KNOT_END + 1, ROOT_KNOT, dtype=np.float64)
    mm = m_fn(kf / FPS)
    knots = np.array([root_grid(rig, [mm["travel_x"][i], mm["travel_y"][i], mm["travel_z"][i]]) for i in range(len(kf))])

    def fn(t):
        f = np.atleast_1d(np.asarray(t, np.float64)) * FPS
        return np.stack([np.interp(f, kf, knots[:, k]) for k in range(3)], 1)
    fn.knots = (kf, knots)
    return fn


def channel_table(rig, m, coarse=None):
    """Turn motion() output into {(datablock, data_path, index): values}."""
    rb = rig.data.bones["root"].matrix_local.to_3x3().inverted()
    out = {}
    n = len(m["root_x"])
    rad = np.radians
    if coarse is not None:
        # The root carries the travel on keys that survive meshopt's 12-bit translation filter exactly (see
        # coarse_path); everything finer (the bob, the curve between those keys) rides on the hips, whose
        # translation stays small and therefore precise. Their sum is the designed path, frame for frame.
        loc = np.array([rb @ Vector(c) for c in coarse])
        for k in range(3):
            out[("rig", 'pose.bones["root"].location', k)] = loc[:, k]
        R_rr = rig.data.bones["root"].matrix_local.to_3x3()
        R_hr = rig.data.bones["hips"].matrix_local.to_3x3()
        hl = []
        for i in range(n):
            res = Vector((m["root_x"][i], m["root_y"][i], m["root_z"][i])) - Vector(coarse[i])
            Rb = Euler((rad(m["root_pitch"][i]), rad(m["root_yaw"][i]), rad(m["root_roll"][i])), "ZXY").to_matrix()
            hl.append(R_hr.inverted() @ R_rr @ Rb.inverted() @ R_rr.inverted() @ res)
        hl = np.array(hl)
        for k in range(3):
            out[("rig", 'pose.bones["hips"].location', k)] = hl[:, k]
    # ZXY Euler: X pitch (forward +), Y yaw (towards his left +), Z roll
    for b, p, y, r in (("root", "root_pitch", "root_yaw", "root_roll"), ("spine", "spine_pitch", None, None),
                       ("chest", "chest_pitch", "chest_yaw", "chest_roll"), ("neck", "neck_pitch", "neck_yaw", None),
                       ("head", "head_pitch", "head_yaw", "head_roll")):
        out[("rig", f'pose.bones["{b}"].rotation_euler', 0)] = rad(m[p])
        if y:
            out[("rig", f'pose.bones["{b}"].rotation_euler', 1)] = rad(m[y])
        if r:
            out[("rig", f'pose.bones["{b}"].rotation_euler', 2)] = rad(m[r])
    # shoulders raise on local X (+ = up on both sides)
    for side in "LR":
        out[("rig", f'pose.bones["shoulder_{side}"].rotation_euler', 0)] = rad(m["shoulder"])
    # arms: forearms and hands turn about world X (+ lifts what is in front of the joint). Both elbows lie on one
    # line along X (and both wrists nearly so), so both hands, and the cloud they hold, move as one piece.
    for part in ("forearm", "hand"):
        for side in "LR":
            e = axis_eulers(rig, f"{part}_{side}", (-1, 0, 0), m[part])
            for k in range(3):
                out[("rig", f'pose.bones["{part}_{side}"].rotation_euler', k)] = e[:, k]
    out[("rig", 'pose.bones["belly"].location', 1)] = np.asarray(m["belly"])
    for sk in ("browsUp", "smile", "cheekRaise"):
        out[("key", f'key_blocks["{sk}"].value', 0)] = np.asarray(m[sk])
    out[("glow", "scale", 0)] = np.asarray(m["glow"])
    return out


def fk_pose(rig, chans, i):
    """Armature-space pose matrix of every bone for row i of a channel table (the same maths Blender uses: parent
    pose @ rest offset @ translation @ rotation in the bone's own rotation mode). Channels not in the table rest."""
    out = {}
    for b in sorted(rig.data.bones, key=lambda b: len(b.parent_recursive)):     # parents before their children
        pb = rig.pose.bones[b.name]
        rk = ("rig", f'pose.bones["{b.name}"].rotation_euler')
        lk = ("rig", f'pose.bones["{b.name}"].location')
        e = Euler([float(chans[rk + (k,)][i]) if rk + (k,) in chans else 0.0 for k in range(3)], pb.rotation_mode)
        t = Vector([float(chans[lk + (k,)][i]) if lk + (k,) in chans else 0.0 for k in range(3)])
        local = Matrix.Translation(t) @ e.to_matrix().to_4x4()
        if b.parent:
            out[b.name] = out[b.parent.name] @ (b.parent.matrix_local.inverted() @ b.matrix_local) @ local
        else:
            out[b.name] = b.matrix_local @ local
    return out


def cloud_anchors(rig):
    """The held cloud's vertices that are fully bound to his hands (no share on its own bone): rest positions and
    their weights {bone: w}."""
    cloud = bpy.data.objects[f"{NAME}_cloud_held"]
    names = {g.index: g.name for g in cloud.vertex_groups}
    pts, ws = [], []
    for v in cloud.data.vertices:
        w = {names[g.group]: g.weight for g in v.groups if g.weight > 0}
        if w and "cloud" not in w:
            pts.append(v.co.copy()); ws.append(w)
    return pts, ws


def cloud_follow(rig, times, motion_fn, period=None):
    """Pose of the held cloud's own bone (in its parent, the chest): the rigid motion that best fits the cloud's
    vertices bound to his hands (they move exactly as his fingers do), CLOUD_LAG seconds late, so the middle of the
    cloud trails his hands a touch while its grip never slips. (invite before 0 s is the hover motion, so the lag
    reads into it; the hover loop wraps.)"""
    rest_c = rig.data.bones["cloud"].matrix_local
    rest_chest = rig.data.bones["chest"].matrix_local
    tl = np.asarray(times, np.float64) - CLOUD_LAG
    if period:
        tl = np.mod(tl, period)
    ch = channel_table(rig, motion_fn(tl))
    pres = np.asarray(motion_fn(tl)["present"])
    pts, ws = cloud_anchors(rig)
    rest_pts = np.array([p[:] for p in pts])
    inv_rest = {b.name: b.matrix_local.inverted() for b in rig.data.bones}
    locs, rots = [], []
    for i, pe in enumerate(pres):
        P_ = fk_pose(rig, ch, i)
        K = {n: P_[n] @ inv_rest[n] for n in P_}            # skinning matrices (armature space)
        to_chest = (P_["chest"] @ inv_rest["chest"]).inverted()
        posed = np.array([(to_chest @ sum((K[n] * w for n, w in wv.items()), Matrix(((0,) * 4,) * 4)) @ p)[:]
                          for p, wv in zip(pts, ws)])
        D = kabsch(rest_pts, posed)          # the rigid motion that best follows his grip (chest-relative)
        c = D @ rest_c.to_translation()
        off = Vector((0, -PRESENT["forward"], PRESENT["up"])) * float(pe)
        Pm = Matrix.Translation(c + off) @ Matrix.Rotation(math.radians(-PRESENT["tilt"] * float(pe)), 4, "X") @ Matrix.Translation(-c)
        B = rest_c.inverted() @ Pm @ D @ rest_c
        locs.append(B.to_translation()[:])
        rots.append(B.to_euler("XYZ")[:])
    return np.array(locs), np.array(rots)


def kabsch(A, B):
    """Rigid transform (4x4) that best maps points A onto B (least squares)."""
    ca, cb = A.mean(0), B.mean(0)
    H = (A - ca).T @ (B - cb)
    U, _, Vt = np.linalg.svd(H)
    dd = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, dd]) @ U.T
    M = Matrix.Identity(4)
    for i in range(3):
        for j in range(3):
            M[i][j] = R[i, j]
        M[i][3] = cb[i] - (R @ ca)[i]
    return M


def hermite_keys(fc, frames, vals, ders, step):
    """Bezier keys whose handles carry the curve's own slope (left and right may differ), per frame."""
    dl, dr = ders if isinstance(ders, tuple) else (ders, ders)
    kp = fc.keyframe_points
    kp.add(len(frames))
    co = np.stack([frames, vals], 1).astype(np.float64)
    kp.foreach_set("co", co.ravel())
    h = step / 3.0
    kp.foreach_set("handle_left", np.stack([frames - h, vals - dl * h], 1).ravel())
    kp.foreach_set("handle_right", np.stack([frames + h, vals + dr * h], 1).ravel())
    for k in kp:
        k.interpolation = "BEZIER"
        k.handle_left_type = "FREE"
        k.handle_right_type = "FREE"
    fc.update()


def build_action(name, rig, face, glow, duration, hover):
    act = bpy.data.actions.get(name) or bpy.data.actions.new(name)
    targets = {"rig": rig, "key": face.data.shape_keys, "glow": glow}
    for idb in targets.values():
        if idb.animation_data is None:
            idb.animation_data_create()
        idb.animation_data.action = act
    nfr = int(round(duration * FPS))
    frames = np.arange(0, nfr + 1, KEY_STEP, dtype=np.float64)
    t = frames / FPS
    eps = 0.5 / FPS
    fn = (lambda tt: motion(tt, hover=True)) if hover else (lambda tt: motion(tt))
    cfn = coarse_path(rig, fn, hover)
    c0 = channel_table(rig, fn(t), cfn(t))
    cm = channel_table(rig, fn(t - eps), cfn(t - eps))
    cp = channel_table(rig, fn(t + eps), cfn(t + eps))
    for (tgt, path, idx), v in c0.items():
        group = path.split('"')[1] if '"' in path else tgt
        fc = act.fcurve_ensure_for_datablock(targets[tgt], path, index=idx, group_name=group)
        fc.keyframe_points.clear()
        if path == 'pose.bones["root"].location':
            continue                                   # keyed below, on its knots
        dl = (c0[(tgt, path, idx)] - cm[(tgt, path, idx)]) / (eps * FPS)          # per frame, left and right slopes
        dr = (cp[(tgt, path, idx)] - c0[(tgt, path, idx)]) / (eps * FPS)          # (they differ at the root knots)
        hermite_keys(fc, frames, v, (dl, dr), KEY_STEP)
    # the root's straight segments: LINEAR keys on the knots (deliberate: see coarse_path)
    if hover:
        kf, kv = np.array([0.0, float(nfr)]), np.tile(cfn(np.zeros(1))[0], (2, 1))
    else:
        kf, kv = cfn.knots
        kf, kv = np.r_[kf, nfr], np.vstack([kv, kv[-1]])
    rbi = rig.data.bones["root"].matrix_local.to_3x3().inverted()
    kl = np.array([rbi @ Vector(c) for c in kv])
    for k in range(3):
        fc = act.fcurve_ensure_for_datablock(rig, 'pose.bones["root"].location', index=k, group_name="root")
        fc.keyframe_points.clear()
        kp = fc.keyframe_points
        kp.add(len(kf))
        kp.foreach_set("co", np.stack([kf, kl[:, k]], 1).ravel())
        for q in kp:
            q.interpolation = "LINEAR"
        fc.update()
    # the held cloud follows his hands
    per = HOVER_LEN if hover else None
    lc, rc = cloud_follow(rig, t, fn, per)
    lm, rm = cloud_follow(rig, t - eps, fn, per)
    lp, rp = cloud_follow(rig, t + eps, fn, per)
    for k in range(3):
        for path, arr, am, ap in (('pose.bones["cloud"].location', lc, lm, lp), ('pose.bones["cloud"].rotation_euler', rc, rm, rp)):
            fc = act.fcurve_ensure_for_datablock(rig, path, index=k, group_name="cloud")
            fc.keyframe_points.clear()
            hermite_keys(fc, frames, arr[:, k], (ap[:, k] - am[:, k]) / (2 * eps * FPS), KEY_STEP)
    act.use_frame_range = True
    act.frame_start, act.frame_end = 0, nfr
    act.use_cyclic = bool(hover)
    return act


def marker_frames():
    """Marker frames, checked to rise in the order the site's timeline parser expects."""
    sec = dict(MARKERS)
    sec["arrive"] = arrive_time()
    fr = {k: int(round(v * FPS)) for k, v in sec.items()}
    order = ["floatIn", "arrive", "turn", "smile", "offer", "lookDown", "glow"]
    for a, b in zip(order, order[1:]):
        if fr[a] > fr[b]:
            raise RuntimeError(f"markers out of order: {a} {fr[a]} > {b} {fr[b]}")
    return {k: fr[k] for k in order}


def stage_anim():
    global SCALE
    rig = bpy.data.objects[f"{NAME}_rig"]
    face = bpy.data.objects[f"{NAME}_face"]
    sc = bpy.context.scene
    SCALE = float(sc.get("invite_scale", 1.0))     # the rig stage scaled him to HEIGHT; metres in the take follow
    log(f"scale {SCALE:.5f} (sculpt metres -> his {HEIGHT} m size)")
    glow = bpy.data.objects.get("ctl_glow")
    if glow is None:
        glow = bpy.data.objects.new("ctl_glow", None)
        bpy.context.scene.collection.objects.link(glow)
    glow.empty_display_type = "SPHERE"
    glow.empty_display_size = 0.05
    glow.location = Vector((0.148, -0.5, -0.31)) * SCALE   # by the held cloud; only its X scale means anything (0..1)
    glow["$comment"] = "Glow of the held cloud, 0..1, carried as scale.x (three.js cannot play material animation)"
    sc.render.fps = FPS
    hover = build_action("hover", rig, face, glow, HOVER_LEN, hover=True)
    invite = build_action("invite", rig, face, glow, INVITE_END, hover=False)
    # invite is the active action everywhere; hover rides along on an NLA track so it is kept and exported
    for idb in (rig, face.data.shape_keys, glow):
        ad = idb.animation_data
        ad.action = invite
        for tr in list(ad.nla_tracks):
            ad.nla_tracks.remove(tr)
        tr = ad.nla_tracks.new()
        tr.name = "hover"
        st = tr.strips.new("hover", 0, hover)
        tr.mute = True
    sc.frame_start, sc.frame_end = 0, int(INVITE_END * FPS)
    mf = marker_frames()
    for name, frame in mf.items():
        mk = sc.timeline_markers.get(name) or sc.timeline_markers.new(name, frame=0)
        mk.frame = frame
    sc.frame_set(0)
    return dict(invite_frames=[0, int(INVITE_END * FPS)], hover_frames=[0, int(HOVER_LEN * FPS)],
                markers=mf, offer_peak=OFFER, scale=SCALE)


# ───────────────────────────── 4. export ─────────────────────────────

def stage_export():
    """GLB with skins, shape-key (morph) animation and root motion, both clips force-sampled at 60 fps; then the
    project's meshopt optimiser (it keeps the animations). timeline.json keeps whatever the cloud build added."""
    global SCALE
    os.makedirs(OUT_DIR, exist_ok=True)
    sc = bpy.context.scene
    SCALE = float(sc.get("invite_scale", 1.0))
    sc.render.fps = FPS
    sc.frame_set(0)
    keep = [f"{NAME}_rig", f"{NAME}_body", f"{NAME}_face", f"{NAME}_cloud_held", "ctl_glow"]
    bpy.ops.object.select_all(action="DESELECT")
    for n in keep:
        bpy.data.objects[n].select_set(True)
    bpy.context.view_layer.objects.active = bpy.data.objects[f"{NAME}_rig"]
    raw = GLB.replace(".glb", ".raw.glb")
    bpy.ops.export_scene.gltf(
        filepath=raw, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
        export_image_format="WEBP", export_image_quality=88, export_extras=True,
        export_skins=True, export_influence_nb=4, export_morph=True, export_morph_normal=False,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_step=1,
        export_morph_animation=True, export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=True,
        export_reset_pose_bones=True, export_anim_slide_to_zero=False, export_def_bones=False, export_leaf_bone=False)
    log("exported", raw, round(os.path.getsize(raw) / 1e6, 2), "MB")
    if "--raw-copy" in ARGV:                       # keep the unoptimised export somewhere for checks
        import shutil
        shutil.copyfile(raw, ARGV[ARGV.index("--raw-copy") + 1])
    if "--no-optimize" in ARGV:
        os.replace(raw, GLB)
    else:
        # 1) choose keys so the optimiser's resample() cannot flatten slow motion (blender/scripts/invite_keys.mjs)
        # 2) the project's optimiser (meshopt; keeps the animations)
        thin = GLB.replace(".glb", ".keys.glb")
        try:
            for cmd in (["node", os.path.join(ROOT, "blender", "scripts", "invite_keys.mjs"), raw, thin],
                        ["node", os.path.join(ROOT, "scripts", "optimize-guide.mjs"), thin, GLB]):
                r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
                log(r.stdout.strip())
                if r.returncode != 0:
                    raise RuntimeError(r.stderr.strip()[-400:])
            os.remove(raw)
            os.remove(thin)
        except Exception as ex:          # keep the unoptimised file, say how to finish
            log("optimiser not run:", ex, "-> run: node blender/scripts/invite_keys.mjs", raw, thin,
                "&& node scripts/optimize-guide.mjs", thin, GLB)
    # timeline: fps, markers and clips; swapFrame / adultBox belong to the magic-cloud build and are kept
    tl = {}
    if os.path.exists(TIMELINE):
        with open(TIMELINE, encoding="utf-8") as fh:
            tl = json.load(fh)
    rel = os.path.relpath(GLB, os.path.join(ROOT, "public")).replace(os.sep, "/")
    tl["$comment"] = tl.get("$comment") or ("Coco's Awakening, invitation page. Frames are on one 60 fps master timeline "
                                            "(frame / fps = seconds into the invite clip). Young Coco: blender/scripts/build_invitation.py.")
    tl["fps"] = FPS
    mine = marker_frames()                       # the young take's beats, in the site's order
    others = {k: v for k, v in tl.get("markers", {}).items() if k not in mine}   # the magic-cloud build's beats
    late = {k: v for k, v in others.items() if isinstance(v, (int, float)) and v < mine["glow"]}
    if late:
        log("WARNING: magic-cloud markers before the glow", mine["glow"], late, "- the cloud build must re-time them")
    tl["markers"] = {**mine, **others}
    clips = tl.setdefault("clips", {})
    clips["invite"] = {"file": rel, "startFrame": 0, "endFrame": int(round(INVITE_END * FPS))}
    clips["hover"] = {"file": rel, "startFrame": 0, "endFrame": int(round(HOVER_LEN * FPS)), "loop": True,
                      "note": "floating idle before the take (off screen to the right); its pose and velocity equal "
                              "invite frame 0"}
    tl.setdefault("swapFrame", None)
    tl.setdefault("adultBox", None)
    # facts the magic-cloud build and the site may need (glTF axes, metres; the parser ignores this block)
    rig = bpy.data.objects[f"{NAME}_rig"]
    gl = lambda v: [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]          # noqa: E731  Blender -> glTF axes
    cb = rig.matrix_world @ rig.data.bones["cloud"].head_local
    tl["young"] = {
        "$comment": "Young Coco (blender/scripts/build_invitation.py). His position on any frame is the root joint "
                    "PLUS the hips joint: the root carries the travel on straight segments between knots every "
                    f"{ROOT_KNOT} frames (kept exact by meshopt's compression), the hips the fine remainder (the "
                    "curve between knots and the bob). The sum is smooth; the root alone is not, so never attach "
                    "anything to the root joint (follow 'hips', 'chest', 'cloud' or another bone instead). No vertex "
                    "is weighted to the root.",
        "height": HEIGHT, "scale": round(SCALE, 5),
        "heldCloudAtRest": gl(cb),
        "startOffset": gl(Vector(START) * SCALE),        # frame 0 and hover: this far from his spot (before the bob)
        "restFrom": int(round(T_ARR * FPS)),
    }
    with open(TIMELINE, "w", encoding="utf-8") as fh:
        json.dump(tl, fh, indent=2)
    log("wrote", TIMELINE)
    return dict(glb=GLB, bytes=os.path.getsize(GLB) if os.path.exists(GLB) else None, timeline=tl)


# ───────────────────────────── 5. the magic cloud ─────────────────────────────

def stage_cloud():
    """The magic cloud's transformation, in this same scene on the same master timeline: built, saved into
    invitation.blend and exported (magic-cloud.glb + its keys in timeline.json) by build_magic_cloud.py."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import build_magic_cloud
    return build_magic_cloud.run_in_scene(OUT_BLEND, True)


# ───────────────────────────── main ─────────────────────────────

def main():
    """Stages run in order up to --until. --from <stage> skips the earlier stages and continues from the
    invitation.blend a previous run saved (quicker when only the take or the export changes)."""
    first = ARGV[ARGV.index("--from") + 1] if "--from" in ARGV else "geometry"
    if first == "geometry":
        open_source()
    else:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.open_mainfile(filepath=OUT_BLEND)
        log("continuing from", OUT_BLEND)
    rep = {}
    runs = {"geometry": stage_geometry, "rig": stage_rig, "anim": stage_anim, "export": stage_export,
            "cloud": stage_cloud}
    for st in STAGES[STAGES.index(first):STAGES.index(UNTIL) + 1]:
        rep[st] = runs[st]()
        if st not in ("export", "cloud"):
            bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True)
            log(f"{st} done, saved", OUT_BLEND)
    return rep


if __name__ == "__main__":
    main()
