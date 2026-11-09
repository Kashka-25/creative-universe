"""Adult Coco's living details, built into coco-sage.blend / coco-sage.glb by build_coco_sage.py (imported there).

  - The sun and lightning bolt behind him come to life: a 'sun' bone (the disc and its rays turn a little and
    breathe in scale about the sun's middle; the bolt's arms blend from it to the root just outside the disc), the
    sun and the bolt on their own materials ('sun', 'bolt': the same image), and two control bones whose X scale
    carries their glow (ctl_sun, ctl_bolt: value = scale.x - 1, read by the site, which sets the emission).
  - His third eye is a painted eye (an almond with an iris, as on Cassidy's Emblem Evolutions sheet), so it blinks
    like one: a 'third_eye' bone on his forehead closes the almond onto its lid line along the forehead's surface
    (a squash, as lids meet), then it opens again with a soft glow (ctl_eye).
  - His open eyes for the welcome's awakening: two cards on his face carrying Cassidy's open-eyed Coco's own eyes
    (blender/characters/coco-sage-eyes.png, made by prep_coco_eyes.py). The card's alpha is the order in which
    the eye is revealed as his lids part; the site sets alphaTest from ctl_eyes (0 closed: the cards are not drawn,
    so he is exactly today's sage; 1 open).
  - Clips (30 fps, additive: zero at frame 0, the site layers them): 'radiance' (the sun and bolt, a seamless
    40 s loop), 'thirdeye' (four blinks at irregular moments in a seamless 32 s loop) and 'awaken' (the welcome's
    beat: he wakes, looks at the visitor, closes his eyes again and bows his head in honour; 6 s, one shot).

Every curve is a smooth (C2) function of the frame, keyed on every frame like his other clips.
"""

import json
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
EYES_PNG = os.path.join(ROOT, "blender", "characters", "coco-sage-eyes.png")
EYES_JSON = os.path.join(ROOT, "blender", "characters", "coco-sage-eyes.json")

CTLS = ("ctl_sun", "ctl_bolt", "ctl_eye", "ctl_eyes")
# bones whose clips scale them (build_coco_sage.bake_clip keys their scale)
SCALED = ("sun", "third_eye") + CTLS


def s5(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * x * (x * (6 * x - 15) + 10)


def env(t, a, b, c, d):
    """C2 envelope in seconds: 0 before a, 1 from b to c, 0 after d."""
    t = np.asarray(t, np.float64)
    return np.where(t < c, s5((t - a) / max(b - a, 1e-9)), 1 - s5((t - c) / max(d - c, 1e-9))) * (t >= a) * (t <= d)


# ── geometry ────────────────────────────────────────────────────────────

def _arrays(me):
    co = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", co)
    tv = np.empty(len(me.polygons) * 3, np.int64)
    me.polygons.foreach_get("vertices", tv)
    return co.reshape(-1, 3), tv.reshape(-1, 3)


def sun_layout(cfg, sun):
    """The sun's middle (refined from the disc's own vertices) and the sun share of every vertex: 1 on the disc and
    its rays, falling to 0 along the bolt's arms just outside the disc."""
    S = cfg["life"]["sun"]
    co, tv = _arrays(sun.data)
    c = np.array(S["centre"], np.float64)
    for _ in range(3):
        r = np.hypot(co[:, 0] - c[0], co[:, 2] - c[1])
        disc = r < S["disc"] * 0.9
        c = np.array([co[disc, 0].mean(), co[disc, 2].mean()])
    r = np.hypot(co[:, 0] - c[0], co[:, 2] - c[1])
    y = float(co[r < S["disc"], 1].mean())
    # the rest of the mesh, without the disc, in connected pieces: a piece that stays within the rays' reach is a ray
    out = r >= S["disc"]
    keep = out[tv].all(1)
    n = len(co)
    parent = np.arange(n)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for a, b, d in tv[keep]:
        for u, v in ((a, b), (b, d)):
            ru, rv = find(u), find(v)
            if ru != rv:
                parent[ru] = rv
    roots = np.array([find(i) for i in range(n)])
    w = np.where(r < S["disc"], 1.0, 1.0 - s5((r - S["disc"]) / S["blend"]))
    rays = 0
    for root in np.unique(roots[out]):
        piece = (roots == root) & out
        if r[piece].max() <= S["rays"]:
            w[piece] = 1.0
            rays += 1
    return Vector((c[0], y, c[1])), w, rays


def third_eye_layout(cfg, face):
    """The third eye's pivot (on its lid line), the forehead's up direction along its surface there, and each face
    vertex's share in the blink."""
    T = cfg["life"]["thirdEye"]
    gm = cfg["gem"]
    co, _ = _arrays(face.data)
    gx, gz = gm["centre"]
    d = np.hypot((co[:, 0] - gx) / gm["rx"], (co[:, 2] - gz) / gm["rz"])
    gem = d < 1.0
    nrm = np.array([v.normal[:] for v in face.data.vertices])
    n = Vector(nrm[gem].mean(0)).normalized()
    up = (Vector((0, 0, 1)) - n * n.z).normalized()             # up the forehead, along its surface
    centre = Vector(co[gem].mean(0))
    pivot = centre - up * (T["pivotDown"] * gm["rz"])          # the lids meet a little below the middle
    w = 1.0 - s5((d - T["inner"]) / (T["outer"] - T["inner"]))
    # above it the fur of his brow comes right down to the eye: the blink fades out much sooner there, so the
    # fur never follows the lid down
    # (blended in over the upper half of the eye, so no crease forms at its sides)
    above = s5((co[:, 2] - gz) / gm["rz"])
    w_up = 1.0 - s5((d - T["innerUp"]) / (T["outerUp"] - T["innerUp"]))
    w = w * (1 - above) + np.minimum(w, w_up) * above
    return pivot, up, n, w


# ── bones ───────────────────────────────────────────────────────────────

def add_bones(rig, cfg, sun, face):
    """The life bones on his rig (edit mode inside). Returns their layout for the weights."""
    sun_c, sun_w, rays = sun_layout(cfg, sun)
    eye_p, eye_up, eye_n, eye_w = third_eye_layout(cfg, face)
    root_head = Vector(cfg["bones"]["root"][0])
    arm = rig.data
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    b = eb.new("sun")                       # local Y points at the visitor: turning about Y turns the sun in its plane
    b.head, b.tail = sun_c, sun_c + Vector((0, -0.1, 0))
    b.align_roll(Vector((0, 0, 1)))
    b.parent = eb["root"]
    b = eb.new("third_eye")                 # local Y runs up the forehead: scaling Y closes the eye onto its lid line
    b.head, b.tail = eye_p, eye_p + eye_up * 0.05
    b.align_roll(-eye_n)
    b.parent = eb["head"]
    for i, name in enumerate(CTLS):         # control bones: no vertices, their X scale carries a value to the site
        c = eb.new(name)
        c.head = root_head + Vector((0.04 * i, 0, -0.05))
        c.tail = c.head + Vector((0, 0, 0.03))
        c.parent = eb["root"]
    for n in ("sun", "third_eye") + CTLS:
        eb[n].use_deform = True
        eb[n].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return {"sun_centre": sun_c, "sun_w": sun_w, "rays": rays, "eye_w": eye_w, "eye_pivot": eye_p, "eye_up": eye_up}


def weight_sun(sun, lay):
    """The sun and its rays on 'sun', the bolt on the root (blended just outside the disc); its own two materials."""
    w = lay["sun_w"]
    sun.vertex_groups.clear()
    g_sun = sun.vertex_groups.new(name="sun")
    g_root = sun.vertex_groups.new(name="root")
    for i, v in enumerate(w):
        if v > 1e-4:
            g_sun.add([i], float(v), "REPLACE")
        if v < 1 - 1e-4:
            g_root.add([i], float(1 - v), "REPLACE")
    me = sun.data
    base = me.materials[0]
    m_sun = base.copy()
    m_sun.name = "sun"
    m_bolt = base.copy()
    m_bolt.name = "bolt"
    # (a hair less emission, so the optimiser's dedup keeps the two materials apart: the site glows them separately)
    bb = next(n for n in m_bolt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bb.inputs["Emission Strength"].default_value *= 0.995
    me.materials.clear()
    me.materials.append(m_sun)
    me.materials.append(m_bolt)
    tv = np.empty(len(me.polygons) * 3, np.int64)
    me.polygons.foreach_get("vertices", tv)
    tri = w[tv.reshape(-1, 3)].mean(1)
    me.polygons.foreach_set("material_index", (tri < 0.5).astype(np.int32))
    return {"sun_tris": int((tri >= 0.5).sum()), "bolt_tris": int((tri < 0.5).sum()), "rays": lay["rays"]}


def weight_third_eye(face, lay):
    """The third eye's share moves to 'third_eye'; what it had stays with its bones, scaled down."""
    w = lay["eye_w"]
    idx = np.nonzero(w > 1e-4)[0]
    groups = {g.index: g for g in face.vertex_groups}
    g_eye = face.vertex_groups.new(name="third_eye")
    for i in idx:
        v = face.data.vertices[int(i)]
        for ge in list(v.groups):
            groups[ge.group].add([int(i)], ge.weight * (1 - w[i]), "REPLACE")
        g_eye.add([int(i)], float(w[i]), "REPLACE")
    return int(len(idx))


# ── the open-eye cards ──────────────────────────────────────────────────

def build_eye_cards(cfg, face, rig):
    """Two cards on his face (a grid that follows its surface, OFFSET in front of it), textured with
    coco-sage-eyes.png; skinned as the face under them is. Returns the object, or None if prep_coco_eyes.py has not
    been run."""
    if not (os.path.exists(EYES_PNG) and os.path.exists(EYES_JSON)):
        print("[life] no coco-sage-eyes.png: run blender/scripts/prep_coco_eyes.py first; no open eyes built")
        return None
    meta = json.load(open(EYES_JSON, encoding="utf-8"))
    E = cfg["life"]["eyes"]
    deps = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(face, deps)
    img = bpy.data.images.load(EYES_PNG)
    img.name = "coco-sage-eyes"
    img.alpha_mode = "STRAIGHT"
    verts, faces_, uvs = [], [], []
    alpha = np.array(img.pixels[:], np.float32).reshape(img.size[1], img.size[0], 4)[..., 3]   # row 0 = bottom
    AW, AH = img.size
    nx, nz = E["grid"]
    for card in meta["cards"]:
        base = len(verts)
        ok = np.zeros((nz + 1, nx + 1), bool)
        for j in range(nz + 1):
            for i in range(nx + 1):
                x = card["x0"] + (card["x1"] - card["x0"]) * i / nx
                z = card["z0"] + (card["z1"] - card["z0"]) * j / nz
                # the frontmost point of his face round this vertex (out to most of a cell each way), so the card's
                # flat triangles never dip behind a sculpted fold between vertices (his closed lids' ridge)
                dx, dz = (card["x1"] - card["x0"]) / nx, (card["z1"] - card["z0"]) / nz
                front = None
                for a_ in (-0.75, -0.375, 0.0, 0.375, 0.75):
                    for b_ in (-0.75, -0.375, 0.0, 0.375, 0.75):
                        hit, _, _, _ = bvh.ray_cast(Vector((x + a_ * dx, -2.0, z + b_ * dz)), Vector((0, 1, 0)))
                        if hit is not None and (front is None or hit.y < front):
                            front = hit.y
                ok[j, i] = front is not None
                verts.append((x, (front if front is not None else -0.35) - E["offset"], z))
                u = card["u0"] + (card["u1"] - card["u0"]) * i / nx
                v = card["v0"] + (card["v1"] - card["v0"]) * j / nz
                uvs.append((u, v))
        # keep only cells near the eye (alpha > 0 anywhere in the cell or its neighbours)
        cell = np.zeros((nz, nx), bool)
        for j in range(nz):
            for i in range(nx):
                u0 = card["u0"] + (card["u1"] - card["u0"]) * (i - 1) / nx
                u1 = card["u0"] + (card["u1"] - card["u0"]) * (i + 2) / nx
                v0 = card["v0"] + (card["v1"] - card["v0"]) * (j - 1) / nz
                v1 = card["v0"] + (card["v1"] - card["v0"]) * (j + 2) / nz
                c0, c1 = max(0, int(u0 * AW)), min(AW, int(math.ceil(u1 * AW)))
                r0, r1 = max(0, int(v0 * AH)), min(AH, int(math.ceil(v1 * AH)))
                cell[j, i] = c1 > c0 and r1 > r0 and alpha[r0:r1, c0:c1].max() > 0
        for j in range(nz):
            for i in range(nx):
                if cell[j, i] and ok[j:j + 2, i:i + 2].all():
                    a = base + j * (nx + 1) + i
                    faces_.append((a, a + 1, a + nx + 2, a + nx + 1))
    me = bpy.data.meshes.new("coco-sage_eyes")
    me.from_pydata(verts, [], faces_)
    me.update()
    uvl = me.uv_layers.new(name="UVMap")
    for loop in me.loops:
        uvl.data[loop.index].uv = uvs[loop.vertex_index]
    # drop vertices no face uses
    obj = bpy.data.objects.new("coco-sage_eyes", me)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.delete_loose()
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode="OBJECT")
    for p in me.polygons:
        p.use_smooth = True
    # the material: the eyes' own colours; alpha clip (1 - (alpha < cutoff)), so glTF says MASK. At rest the cutoff
    # is above every texel: nothing shows. The site sets it from ctl_eyes.
    mat = bpy.data.materials.new("coco_eyes")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    lt = nt.nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    lt.name = "eyes_cutoff"
    lt.inputs[1].default_value = E["restCutoff"]
    sub = nt.nodes.new("ShaderNodeMath")
    sub.operation = "SUBTRACT"
    sub.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs["Alpha"], lt.inputs[0])
    nt.links.new(lt.outputs[0], sub.inputs[1])
    nt.links.new(sub.outputs[0], bsdf.inputs["Alpha"])
    fb = next(n for n in face.data.materials[0].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    for k in ("Roughness", "Metallic"):
        bsdf.inputs[k].default_value = fb.inputs[k].default_value
    try:
        mat.surface_render_method = "DITHERED"
    except AttributeError:
        pass
    me.materials.append(mat)
    # skinned as the face under each vertex is: its weights interpolated at the nearest point of his face (so the
    # card bends exactly as the skin under it does when he lowers and bows his head)
    fme = face.data
    fbvh = BVHTree.FromPolygons([v.co[:] for v in fme.vertices], [p_.vertices[:] for p_ in fme.polygons])
    names = {g.index: g.name for g in face.vertex_groups}
    vw = [{names[ge.group]: ge.weight for ge in v.groups if names[ge.group] != "third_eye"} for v in fme.vertices]
    groups = {}
    for v in me.vertices:
        loc, _, fi, _ = fbvh.find_nearest(v.co)
        tri = fme.polygons[fi].vertices
        a_, b_, c_ = (fme.vertices[i].co for i in tri)
        # barycentric coordinates of loc in the triangle
        v0, v1, v2 = b_ - a_, c_ - a_, loc - a_
        d00, d01, d11, d20, d21 = v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1)
        den = d00 * d11 - d01 * d01 or 1e-12
        wb = (d11 * d20 - d01 * d21) / den
        wc = (d00 * d21 - d01 * d20) / den
        bary = (max(0.0, 1 - wb - wc), max(0.0, wb), max(0.0, wc))
        acc = {}
        for k, i in enumerate(tri):
            for n, w in vw[i].items():
                acc[n] = acc.get(n, 0.0) + w * bary[k]
        tot = sum(acc.values()) or 1.0
        for n, w in acc.items():
            if w / tot <= 1e-4:
                continue
            g = groups.get(n) or obj.vertex_groups.new(name=n)
            groups[n] = g
            g.add([v.index], w / tot, "REPLACE")
    obj.visible_shadow = False              # (Blender's renders only: the site draws no shadows)
    obj.parent = rig
    obj.matrix_parent_inverse = Matrix.Identity(4)
    m = obj.modifiers.new("Armature", "ARMATURE")
    m.object = rig
    return obj, {"tris": len(me.polygons), "verts": len(me.vertices), "atlas": list(img.size)}


# ── clips ───────────────────────────────────────────────────────────────

def radiance_channels(cfg):
    R = cfg["life"]["radiance"]
    N = R["frames"]

    def ch(f):
        t = np.float64(f) / cfg["fps"]
        T = N / cfg["fps"]
        ph = 2 * np.pi * t / T
        turn = R["turnDeg"] * np.sin(ph * R["turnPeriods"])
        breathe = R["breathe"] * (1 - np.cos(ph * R["breathePeriods"])) / 2
        glow = R["glow"] * (1 - np.cos(ph * R["glowPeriods"])) / 2
        shimmer = 0.0
        for at, count in R["shimmers"]:
            for k in range(int(count)):
                a = at + k * R["shimmerGap"]
                # soft rise, softer fall; periodic (also counted one loop earlier, for the seam)
                peak = R["shimmerPeak"] * (1.0 if k == 0 else R["secondPeak"])
                for off in (0.0, -T, T):
                    shimmer += peak * float(env(t + off, a - R["shimmerRise"], a, a, a + R["shimmerFall"]))
        return {"sun.turn": turn, "sun.scale": breathe, "ctl_sun": glow, "ctl_bolt": shimmer}
    return N, ch


def thirdeye_channels(cfg):
    T3 = cfg["life"]["thirdEye"]
    N = T3["frames"]

    def ch(f):
        t = np.float64(f) / cfg["fps"]
        T = N / cfg["fps"]
        close = glow = dim = 0.0
        for at in T3["blinks"]:
            for off in (0.0, -T, T):
                tt = t + off
                a, b = at, at + T3["closeS"]
                c, d = b + T3["holdS"], b + T3["holdS"] + T3["openS"]
                e = float(env(tt, a, b, c, d))
                close += e
                dim += e
                g0 = d - 0.05
                glow += float(env(tt, g0, g0 + T3["glowS"] * 0.35, g0 + T3["glowS"] * 0.45, g0 + T3["glowS"]))
        return {"third_eye.close": T3["squash"] * min(close, 1.0), "ctl_eye": T3["dim"] * dim + T3["glow"] * glow}
    return N, ch


def awaken_channels(cfg):
    """The welcome's beat (seconds in cfg life.awaken): he wakes (an inhale, his head levels towards the visitor,
    his eyes open slowly with a small flutter, his brows lift softly), looks at the visitor (a warm micro smile, a
    small tilt), closes his eyes again, bows his head in honour, and rises back to rest. Additive over 'breathe'."""
    A = cfg["life"]["awaken"]
    N = int(round(A["seconds"] * cfg["fps"]))
    o = A["open"]

    def ch(f):
        t = np.float64(f) / cfg["fps"]
        # eyes: open part-way, a small dip (the flutter), fully open, held, closed again
        eyes = (o["first"] * s5((t - o["start"]) / o["firstS"])
                - (o["first"] - o["dipTo"]) * s5((t - o["start"] - o["firstS"]) / o["dipS"])
                + (1 - o["dipTo"]) * s5((t - o["start"] - o["firstS"] - o["dipS"]) / o["fullS"])
                - s5((t - A["closeAt"]) / A["closeS"]))
        look = env(t, *A["look"])
        bow = env(t, *A["bow"])
        breath = env(t, *A["inhale"])
        tilt = env(t, *A["tilt"])
        L, B = A["lookDeg"], A["bowDeg"]
        return {
            "ctl_eyes": float(np.clip(eyes, 0.0, 1.0)),
            "head.pitch": L["head"] * look + B["head"] * bow,
            "neck.pitch": L["neck"] * look + B["neck"] * bow,
            "chest.pitch": L["chest"] * look + B["chest"] * bow - A["inhaleDeg"] * breath,
            "spine.pitch": B["spine"] * bow,
            "head.roll": A["tiltDeg"] * tilt,
            "shoulder_L.raise": A["shoulderDeg"] * breath - A["shoulderBow"] * bow,
            "shoulder_R.raise": A["shoulderDeg"] * breath - A["shoulderBow"] * bow,
            "browSoft": A["browSoft"] * env(t, *A["brows"]),
            "microSmile": A["microSmile"] * env(t, *A["smile"]),
        }
    return N, ch


def extra_basis(P, chans, basis):
    """Pose bases for the life channels (called by build_coco_sage.pose_at)."""
    def c(k):
        return float(chans.get(k, 0.0))
    if "sun" in P.rest:
        s = 1.0 + c("sun.scale")
        basis["sun"] = Matrix.Rotation(math.radians(c("sun.turn")), 4, "Y") @ Matrix.Diagonal((s, 1.0, s, 1.0))
    if "third_eye" in P.rest:
        basis["third_eye"] = Matrix.Diagonal((1.0, max(1.0 - c("third_eye.close"), 0.02), 1.0, 1.0))
    for n in CTLS:
        if n in P.rest:
            basis[n] = Matrix.Diagonal((1.0 + c(n), 1.0, 1.0, 1.0))
    return basis
