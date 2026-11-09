"""Prepare a Creative Universe character (Little Coco, Coco) from Cassidy's sculpt.

    blender --background --factory-startup --python blender/scripts/character_prep.py -- <name>

Reads blender/characters/<name>.json and the sculpts in blender/sculpt/ (kept locally; large).
Writes:
  public/models/characters/<name>.glb          rigged, with a face of sculpted shape keys
  public/models/characters/<name>/<mood>.webp   his face painted for moods the sculpt can't show
  public/models/characters/<name>.json          moods, as the site reads them
  blender/characters/<name>.blend               to keep working on by hand

Every character gets the same skeleton names (root, hips, spine, chest, neck, head,
upperarm/forearm/hand _L/_R; every bone points up with roll 0, so bone axes are his
own) and the same face shapes (smile, grin, jawOpen, mouthO, cheekRaise, squint,
browsUp, browsFurrow, browsSad, noseWrinkle). That shared language is what lets Coco
keep Little Coco's mannerisms: the site drives both with the same code.

Moods are recipes of face shapes plus, where sculpting can't show it, his face painted on
from a picture with those shapes applied, lined up on his third eye, eyes and mouth and
colour-matched to his skin. A picture can be one of Cassidy's sheets, or his own
closed-eyed sculpt rendered face-on (so "eyes closed" moods use his real sculpted eyes).

A mood can also start from his own face (open-eyed in that mood's pose, or closed-eyed)
and touch it up (face_touchup.py): his painted smile line erased around the mouth, and just
the mouth from a sheet laid on, cut along an outline traced round its lips. That keeps a
sheet drawn at three-quarters from skewing his face:
    "paint": {"base": "own" | "closed", "erase": {"top", "bottom", "side"},
              "mouth": {"image", "outline", "at", "height"}, "eyes": "closed"}
"eyes": "closed" lays just the eyes of his closed-eyed sculpt over his own face (for a sculpt
whose closed-eyed version differs elsewhere, as Coco's older sage sculpt does).
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # face_touchup.py sits alongside
ROOT = os.getcwd()
NAME = sys.argv[sys.argv.index("--") + 1]
with open(os.path.join(ROOT, "blender", "characters", f"{NAME}.json"), encoding="utf-8") as f:
    CFG = json.load(f)
SCULPT = os.path.join(ROOT, "blender", "sculpt")
WEB = os.path.join(SCULPT, f"{NAME}-web.glb")
OUT_DIR = os.path.join(ROOT, "public", "models", "characters")
MOOD_DIR = os.path.join(OUT_DIR, NAME)
SHAPES = ["smile", "grin", "jawOpen", "mouthO", "cheekRaise", "squint", "browsUp", "browsFurrow", "browsSad", "noseWrinkle"]

F = CFG["face"]          # cx, cz, rx, rz, front: the area cut out as his face (an ellipse in x/z)
X_GAIN = CFG.get("expressiveness", 1.0)   # how big his expressions are


def _landmarks():
    """His face's landmarks (x, z in Blender metres; A = the side on the viewer's left, B = the right).

    Faces are rarely square to the camera (Little Coco's head is tilted about 9 degrees), so every
    feature has its own measured position, and expressions move along his face's own axes."""
    lm = CFG.get("landmarks")
    if lm:
        return {k: Vector((v[0], 0.0, v[1])) for k, v in lm.items()}
    # older, level settings (eyes centre and half-spacing, heights): derive the same landmarks
    e, mz = CFG["eyes"], CFG["mouthZ"]
    k = e["dx"] / 0.115
    pts = {
        "eyeA": (e["x"] - e["dx"], e["z"]), "eyeB": (e["x"] + e["dx"], e["z"]),
        "third": (e["x"], CFG["thirdZ"]), "mouth": (e["x"], mz),
        "cornerA": (e["x"] - 0.15 * k, mz), "cornerB": (e["x"] + 0.15 * k, mz),
        "browA": (e["x"] - 0.1 * k, CFG["browZ"]), "browB": (e["x"] + 0.1 * k, CFG["browZ"]),
        "cheekA": (e["x"] - 0.11 * k, CFG["cheekZ"]), "cheekB": (e["x"] + 0.11 * k, CFG["cheekZ"]),
        "nose": (e["x"], (e["z"] + mz) / 2 - 0.01 * k), "mouthBottom": (e["x"], mz - 0.012 * k),
    }
    return {k2: Vector((v[0], 0.0, v[1])) for k2, v in pts.items()}


LM = _landmarks()
CENTRE = (LM["eyeA"] + LM["eyeB"]) / 2
_r = LM["eyeB"] - LM["eyeA"]
R = Vector((_r.x, 0, _r.z)).normalized()        # across his face, A to B
U = Vector((-R.z, 0, R.x))                       # up his face (perpendicular, in the x/z plane)
K = _r.length / 0.23                             # expression sizes were tuned on a face with eyes 0.23 m apart


def frame(p, at):
    """(across, up) of point p relative to a landmark, in his face's own axes."""
    d = Vector((p.x - at.x, 0, p.z - at.z))
    return d.dot(R), d.dot(U)


def g(p, at, rr, ru):
    a, u = frame(p, at)
    return math.exp(-(a / (rr * K)) ** 2 - (u / (ru * K)) ** 2)


def smoothstep(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def face_d(p):
    return math.hypot((p.x - F["cx"]) / F["rx"], (p.z - F["cz"]) / F["rz"])


def face_falloff(p):
    return (1 - smoothstep(0.55, 0.95, face_d(p))) * smoothstep(F["front"] + 0.04, F["front"] - 0.06, p.y)


def displacement(name, p):
    """How far a face vertex moves for a shape (Blender axes), before sliding it onto his face's surface."""
    across = up = 0.0
    below = 1.0 if frame(p, LM["mouth"])[1] < 0 else 0.15
    for side, out in (("A", -1.0), ("B", 1.0)):
        corner = g(p, LM["corner" + side], 0.035, 0.028)
        cheek = g(p, LM["cheek" + side], 0.055, 0.045)
        eye = LM["eye" + side]
        lid_low = g(p, eye - U * 0.028 * K, 0.05, 0.018)
        lid_up = g(p, eye + U * 0.022 * K, 0.05, 0.016)
        brow = g(p, LM["brow" + side], 0.07, 0.03)
        brow_in_at = LM["brow" + side] - R * out * 0.045 * K
        brow_in = g(p, brow_in_at, 0.04, 0.025)
        brow_out = g(p, LM["brow" + side] + R * out * 0.04 * K, 0.045, 0.03)
        if name == "smile":
            up += 0.012 * corner + 0.006 * cheek
            across += out * 0.004 * corner
        elif name == "grin":
            up += 0.016 * corner + 0.011 * cheek
            across += out * 0.008 * corner
        elif name == "cheekRaise":
            up += 0.014 * cheek + 0.004 * lid_low
        elif name == "squint":
            up += 0.008 * lid_low - 0.004 * lid_up
        elif name == "browsUp":
            up += 0.014 * brow
        elif name == "browsFurrow":
            up -= 0.009 * brow_in
            across -= out * 0.005 * brow_in
        elif name == "browsSad":
            up += 0.01 * brow_in - 0.007 * brow_out
        elif name == "mouthO":
            across -= out * 0.009 * corner
    if name == "grin":
        up -= 0.015 * g(p, LM["mouthBottom"], 0.09, 0.04)
    elif name == "jawOpen":
        up -= 0.045 * g(p, LM["mouthBottom"] - U * 0.03 * K, 0.12, 0.06) * below
    elif name == "mouthO":
        up -= 0.025 * g(p, LM["mouthBottom"] - U * 0.02 * K, 0.08, 0.05) * below
    elif name == "noseWrinkle":
        up += 0.006 * g(p, LM["nose"], 0.035, 0.03)
    return (R * across + U * up) * K


# ── 1. web copy: simplified, his face protected ──────────────────────────

def make_web_copy():
    if os.path.exists(WEB):
        return
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SCULPT, CFG["source"]))
    o = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    remove_backdrop(o)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.00005)
    bpy.ops.object.mode_set(mode="OBJECT")
    keep = o.vertex_groups.new(name="keep_face")
    mw = o.matrix_world
    for v in o.data.vertices:
        p = mw @ v.co
        d = face_d(p)
        if d < 1.15 and p.y < F["front"] + 0.04:
            keep.add([v.index], 1.0 - 0.6 * max(0.0, d - 0.7) / 0.45, "REPLACE")
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    mod = o.modifiers.new("decimate", "DECIMATE")
    mod.ratio = min(1.0, CFG["tris"] / tris)
    mod.use_collapse_triangulate = True
    mod.vertex_group = "keep_face"
    mod.invert_vertex_group = True
    mod.vertex_group_factor = 8.0
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # textures: 2048 px is plenty on the web
    for img in bpy.data.images:
        if img.size[0] > 2048:
            img.scale(2048, 2048)
    bpy.ops.export_scene.gltf(filepath=WEB, export_format="GLB", export_image_format="JPEG", export_apply=True)
    print(f"web copy: {tris} -> {sum(len(p.vertices) - 2 for p in o.data.polygons)} tris")


def remove_backdrop(o):
    """Some sculpts arrive with the sun and lightning fused on behind him: delete those faces (yellow, behind his back)."""
    spec = CFG.get("removeBackdrop")
    if not spec:
        return
    me = o.data
    img = base_image(o)
    W, H = img.size
    px = img.pixels[:]
    uv = me.uv_layers.active.data
    for v in me.vertices:
        v.select = False
    for e in me.edges:
        e.select = False
    gone = 0
    for p in me.polygons:
        p.select = False
        if p.center.y < spec["minY"]:
            continue
        u, v = uv[p.loop_start].uv
        i = (int((v % 1) * (H - 1)) * W + int((u % 1) * (W - 1))) * 4
        r, g, b = px[i], px[i + 1], px[i + 2]
        if r > 0.7 and g > 0.55 and b < 0.6 and r - b > 0.25:
            p.select = True
            for vi in p.vertices:
                me.vertices[vi].select = True
            gone += 1
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="FACE")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.delete_loose()
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"backdrop removed: {gone} faces (sun and lightning)")


# ── 2. pictures to paint moods from ──────────────────────────────────────

def render_closed_face():
    """His closed-eyed sculpt, rendered face-on (flat, albedo), with where its landmarks land in the image."""
    spec = CFG.get("closed")
    if not spec:
        return None
    path = os.path.join(SCULPT, f"{NAME}-closed-face.png")
    size, span = 1600, spec["span"]          # pixels, metres across
    if "landmarks" in spec:
        lm = spec["landmarks"]
    else:                                     # older, level settings
        e = spec["eyes"]
        lm = {"eyeA": [e["x"] - e["dx"], e["z"]], "eyeB": [e["x"] + e["dx"], e["z"]],
              "third": [e["x"], spec["thirdZ"]], "mouth": [e["x"], spec["mouthZ"]]}
    cx = (lm["eyeA"][0] + lm["eyeB"][0]) / 2
    cz = ((lm["eyeA"][1] + lm["eyeB"][1]) / 2 + lm["mouth"][1]) / 2
    px_per_m = size / span
    to_px = lambda q: [size / 2 + (q[0] - cx) * px_per_m, size / 2 - (q[1] - cz) * px_per_m]  # noqa: E731
    info = {"image": path, **{k: to_px(lm[k]) for k in ("eyeA", "eyeB", "third", "mouth")}}
    if not os.path.exists(path):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=os.path.join(SCULPT, spec["source"]))
        sc = bpy.context.scene
        sc.render.engine = "BLENDER_WORKBENCH"
        sc.display.shading.light = "FLAT"
        sc.display.shading.color_type = "TEXTURE"
        sc.view_settings.view_transform = "Standard"
        sc.render.resolution_x = sc.render.resolution_y = size
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
        sc.camera = cam
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = span
        cam.location = (cx, -5, cz)
        cam.rotation_euler = (math.pi / 2, 0, 0)
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
    return info


# ── 3. the character ─────────────────────────────────────────────────────

def import_web():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=WEB)
    body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    body.name = f"{NAME}_body"
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return body


def base_image(obj):
    bsdf = next(n for n in obj.data.materials[0].node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    return bsdf.inputs["Base Color"].links[0].from_node.image


def skin_colour(body):
    img = base_image(body)
    W, H = img.size
    px = img.pixels[:]
    uv = body.data.uv_layers.active.data
    picks = []
    forehead = (CENTRE + LM["third"]) / 2
    targets = [(LM["cheekA"].x, LM["cheekA"].z), (LM["cheekB"].x, LM["cheekB"].z), (forehead.x, forehead.z)]
    for poly in body.data.polygons:
        c = poly.center
        if c.y > F["front"]:
            continue
        for tx, tz in targets:
            if abs(c.x - tx) < 0.02 * K and abs(c.z - tz) < 0.02 * K:
                u, v = uv[poly.loop_start].uv
                i = (int(v * (H - 1)) * W + int(u * (W - 1))) * 4
                picks.append(px[i:i + 3])
    if not picks:
        raise RuntimeError(f"No skin found on {NAME}'s cheeks: check the face landmarks in {NAME}.json")
    return [sum(p[i] for p in picks) / len(picks) for i in range(3)]


def cut_face(body):
    me = body.data
    for v in me.vertices:
        v.select = False
    for e in me.edges:
        e.select = False
    for p in me.polygons:
        c = p.center
        p.select = face_d(c) < 1.0 and c.y < F["front"]
        if p.select:
            for vi in p.vertices:
                me.vertices[vi].select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    face = next(o for o in bpy.context.scene.objects if o.type == "MESH" and o is not body)
    face.name = f"{NAME}_face"
    face.data.materials[0] = face.data.materials[0].copy()
    face.data.materials[0].name = f"{NAME}_face"
    body.data.materials[0].name = f"{NAME}_body"
    print(f"face: {len(face.data.vertices)} verts; body: {len(body.data.vertices)} verts")
    return face


def add_shape_keys(face):
    face.shape_key_add(name="Basis", from_mix=False)
    for name in SHAPES:
        sk = face.shape_key_add(name=name, from_mix=False)
        for i, v in enumerate(face.data.vertices):
            f = face_falloff(v.co)
            if f > 1e-4:
                d = displacement(name, v.co)
                n = v.normal
                d = d - n * d.dot(n)          # slide along his face's surface: features move, nothing dents or bulges
                sk.data[i].co = v.co + d * f * X_GAIN



J = CFG["joints"]
PARENT = {"hips": "root", "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck",
          "upperarm_L": "chest", "forearm_L": "upperarm_L", "hand_L": "forearm_L",
          "upperarm_R": "chest", "forearm_R": "upperarm_R", "hand_R": "forearm_R"}


def seg_end(name):
    nxt = {"root": None, "hips": "spine", "spine": "chest", "chest": "neck", "neck": "head",
           "upperarm_L": "forearm_L", "forearm_L": "hand_L", "upperarm_R": "forearm_R", "forearm_R": "hand_R"}
    if name == "root":
        return Vector(J["root"]) + Vector((0, 0, 0.5 * (J["hips"][2] - J["root"][2])))
    if name in ("hand_L", "hand_R"):
        return Vector(J[name]) + Vector((-0.06 if name.endswith("L") else 0.06, -0.05, -0.04)) * K
    return Vector(J[nxt[name]])


def build_rig():
    arm = bpy.data.armatures.new(f"{NAME}_rig")
    rig = bpy.data.objects.new(f"{NAME}_rig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, p in J.items():
        b = arm.edit_bones.new(name)
        b.head = Vector(p)
        b.tail = Vector(p) + Vector((0, 0, 0.08))
        b.roll = 0
    for name, parent in PARENT.items():
        arm.edit_bones[name].parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def weights_for(p):
    hz, nz = CFG["headZ"], J["neck"][2]
    if p.z > hz:
        k = smoothstep(hz - 0.04 * K, hz + 0.04 * K, p.z)
        return {"head": k, "neck": 1 - k} if k < 1 else {"head": 1.0}
    if p.z < CFG["baseZ"]:
        return {"root": 1.0}
    scores = {}
    for name in J:
        if name == "head":
            continue
        d = seg_dist(p, Vector(J[name]), seg_end(name))
        scores[name] = 1.0 / (d ** 6 + 1e-7)
    top = sorted(scores.items(), key=lambda kv: -kv[1])[:3]
    tot = sum(v for _, v in top)
    return {k: v / tot for k, v in top if v / tot > 0.02}


def skin(obj, rig):
    groups = {}
    for i, v in enumerate(obj.data.vertices):
        for bone, w in weights_for(v.co).items():
            grp = groups.get(bone) or obj.vertex_groups.new(name=bone)
            groups[bone] = grp
            grp.add([i], w, "REPLACE")
    obj.parent = rig
    obj.modifiers.new("Armature", "ARMATURE").object = rig


def picture_landmarks(src):
    """A picture's eyes, third eye and mouth in pixels (x right, y down). Older settings give the eyes' centre and spacing."""
    if "eyeA" in src:
        return [Vector((src[k][0], src[k][1], 0)) for k in ("eyeA", "eyeB", "third", "mouth")]
    cx, cy, sp = src["eyes"][0], src["eyes"][1], src["spacing"]
    return [Vector((cx - sp / 2, cy, 0)), Vector((cx + sp / 2, cy, 0)), Vector((cx, src["third"], 0)), Vector((cx, src["mouth"], 0))]


def picture_mapping(src):
    """Coefficients (a, b, k) so that pixel x = a*X + b*Z + k (and the same for y): his face onto the picture's face.

    Both faces are put in their own frame (across the eyes, and up), so a tilted head on either side lines up."""
    ea, eb, third, mouth = picture_landmarks(src)
    c = (ea + eb) / 2
    r_s = (eb - ea).normalized()
    u_s = Vector((r_s.y, -r_s.x, 0))                       # "up" in the picture (y points down)
    s_r = (eb - ea).length / (LM["eyeB"] - LM["eyeA"]).length
    s_u = (third - mouth).dot(u_s) / (LM["third"] - LM["mouth"]).dot(U)
    out = []
    for axis in (0, 1):
        a = r_s[axis] * s_r * R.x + u_s[axis] * s_u * U.x
        b = r_s[axis] * s_r * R.z + u_s[axis] * s_u * U.z
        k = c[axis] - a * CENTRE.x - b * CENTRE.z
        out.append((a, b, k))
    return out


def layer_mask(face, name, inner, outer, around):
    """A per-vertex mask: 1 in the middle of his face (or round his mouth, or across his eyes), fading out between inner and outer."""
    attr = face.data.attributes.get(name) or face.data.attributes.new(name, "FLOAT", "POINT")
    if around == "mouth":
        mouth = LM["mouth"] - U * 0.02 * K
        half = (LM["cornerB"] - LM["cornerA"]).length / 2

        def d(v):
            a, u = frame(v.co, mouth)
            return math.hypot(a / (half * 1.25), u / (half * 0.62))
    elif around == "eyes":
        sp = (LM["eyeB"] - LM["eyeA"]).length

        def d(v):
            a, u = frame(v.co, CENTRE)
            return math.hypot(a / sp, u / (sp * 0.36))
    else:
        def d(v):
            return face_d(v.co)
    attr.data.foreach_set("value", [0.97 * (1 - smoothstep(inner, outer, d(v))) for v in face.data.vertices])


def paint_mood(face, mood, spec, layers, base_img):
    """layers: [(picture, colour gain, (inner, outer), "face" | "mouth")], painted in order over his own face."""
    for kb in face.data.shape_keys.key_blocks[1:]:
        kb.value = spec["keys"].get(kb.name, 0.0)
    mat = face.data.materials[0]
    nt = mat.node_tree
    n, l = nt.nodes, nt.links
    bsdf = next(nd for nd in n if nd.type == "BSDF_PRINCIPLED")
    base_tex = bsdf.inputs["Base Color"].links[0].from_node
    out = next(nd for nd in n if nd.type == "OUTPUT_MATERIAL")
    keep = set(n)
    geo = n.new("ShaderNodeNewGeometry")
    sep = n.new("ShaderNodeSeparateXYZ")
    l.new(geo.outputs["Position"], sep.inputs[0])
    s = lambda coll, ident: next(x for x in coll if x.identifier == ident)  # noqa: E731

    def affine(sock, mul, add):
        m = n.new("ShaderNodeMath")
        m.operation = "MULTIPLY_ADD"
        l.new(sock, m.inputs[0])
        m.inputs[1].default_value, m.inputs[2].default_value = mul, add
        return m.outputs[0]

    def affine2(sock, mul, add_sock):
        m = n.new("ShaderNodeMath")
        m.operation = "MULTIPLY_ADD"
        l.new(sock, m.inputs[0])
        m.inputs[1].default_value = mul
        l.new(add_sock, m.inputs[2])
        return m.outputs[0]

    colour = base_tex.outputs["Color"]
    for li, (src, gain, (inner, outer), around) in enumerate(layers):
        img_src = bpy.data.images.load(src["image"], check_existing=True)
        W, H = img_src.size
        (ax, bx, kx), (ay, by, ky) = picture_mapping(src)
        # uv = (px / W, 1 - py / H), with px and py linear in his x and z
        u = affine(sep.outputs["X"], ax / W, kx / W)
        u = affine2(sep.outputs["Z"], bx / W, u)
        v = affine(sep.outputs["X"], -ay / H, 1 - ky / H)
        v = affine2(sep.outputs["Z"], -by / H, v)
        comb = n.new("ShaderNodeCombineXYZ")
        l.new(u, comb.inputs[0])
        l.new(v, comb.inputs[1])
        tex = n.new("ShaderNodeTexImage")
        tex.image = img_src
        tex.extension = "EXTEND"
        tex.interpolation = "Cubic"
        l.new(comb.outputs[0], tex.inputs["Vector"])
        gm = n.new("ShaderNodeMix")
        gm.data_type = "RGBA"
        gm.blend_type = "MULTIPLY"
        s(gm.inputs, "Factor_Float").default_value = 1.0
        l.new(tex.outputs["Color"], s(gm.inputs, "A_Color"))
        s(gm.inputs, "B_Color").default_value = (*gain, 1.0)
        mname = f"mood_mask_{li}"
        layer_mask(face, mname, inner, outer, around)
        mask = n.new("ShaderNodeAttribute")
        mask.attribute_name = mname
        mix = n.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        l.new(mask.outputs["Fac"], s(mix.inputs, "Factor_Float"))
        l.new(colour, s(mix.inputs, "A_Color"))
        l.new(s(gm.outputs, "Result_Color"), s(mix.inputs, "B_Color"))
        colour = s(mix.outputs, "Result_Color")
    emit = n.new("ShaderNodeEmission")
    l.new(colour, emit.inputs["Color"])
    l.new(emit.outputs["Emission"], out.inputs["Surface"])
    img = bpy.data.images.new(f"{NAME}_{mood}", base_img.size[0], base_img.size[1], alpha=False)
    img.pixels.foreach_set(list(base_img.pixels))
    tgt = n.new("ShaderNodeTexImage")
    tgt.image = img
    n.active = tgt
    bpy.ops.object.select_all(action="DESELECT")
    face.select_set(True)
    bpy.context.view_layer.objects.active = face
    bpy.ops.object.bake(type="EMIT", margin=8, use_clear=False)
    img.filepath_raw = os.path.join(MOOD_DIR, f"{mood}.webp")
    img.file_format = "WEBP"
    bpy.context.scene.render.image_settings.quality = 86
    img.save()
    print("mood painted:", mood, f"({len(layers)} layer{'s' if len(layers) > 1 else ''})")
    for nd in list(n):
        if nd not in keep:
            n.remove(nd)
    l.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    for kb in face.data.shape_keys.key_blocks[1:]:
        kb.value = 0.0


def render_own_face(face, keys, path, size=1600):
    """His own face in a mood's pose, rendered face-on (flat, albedo), and where his landmarks land in it."""
    span = 3.2 * (LM["eyeB"] - LM["eyeA"]).length
    cx, cz = CENTRE.x, (CENTRE.z + LM["mouth"].z) / 2
    ppm = size / span
    for kb in face.data.shape_keys.key_blocks[1:]:
        kb.value = keys.get(kb.name, 0.0)
    sc = bpy.context.scene
    engine = sc.render.engine
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "FLAT"
    sc.display.shading.color_type = "TEXTURE"
    sc.view_settings.view_transform = "Standard"
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    cam = bpy.data.objects.get("face_cam")
    if not cam:
        cam = bpy.data.objects.new("face_cam", bpy.data.cameras.new("face_cam"))
        sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = span
    cam.location = (cx, -5, cz)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    sc.camera = cam
    sc.render.filepath = path
    sc.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    sc.render.engine = engine
    for kb in face.data.shape_keys.key_blocks[1:]:
        kb.value = 0.0
    to_px = lambda q: [size / 2 + (q.x - cx) * ppm, size / 2 - (q.z - cz) * ppm]  # noqa: E731
    return {"image": path, **{k: to_px(LM[k]) for k in ("eyeA", "eyeB", "third", "mouth")}}


def picture_frame(src, shape, at):
    """For every pixel of a picture: its (across, up) on his face from landmark-point `at`, and pixels per metre."""
    import numpy as np
    (ax, bx, kx), (ay, by, ky) = picture_mapping(src)
    m = np.array([[ax, bx], [ay, by]])
    mi = np.linalg.inv(m)
    py, px = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
    dx, dy = px - kx, py - ky
    x = mi[0, 0] * dx + mi[0, 1] * dy - at.x
    z = mi[1, 0] * dx + mi[1, 1] * dy - at.z
    return x * R.x + z * R.z, x * U.x + z * U.z, math.sqrt(abs(np.linalg.det(m)))


def touch_up(src, paint, out_path):
    """His face picture with the smile line erased around the mouth and, optionally, a mouth from a sheet laid on.

    paint["erase"]: the area to clear, in metres on his face from his mouth landmark (top, bottom: up;
    side: past his mouth corners). paint["mouth"]: {image, outline (sheet px, round the lips),
    at (across, up from his mouth landmark), height (metres)}."""
    import numpy as np
    import face_touchup as ft

    def ss(e0, e1, x):
        t = np.clip((x - e0) / (e1 - e0), 0, 1)
        return t * t * (3 - 2 * t)

    pic = ft.load(src["image"])
    a, u, ppm = picture_frame(src, pic.shape[:2], LM["mouth"])
    half = (LM["cornerB"] - LM["cornerA"]).length / 2
    mb_u = frame(LM["mouthBottom"], LM["mouth"])[1]
    e = paint.get("erase") or {}
    top, side = e.get("top", 0.015) * K, e.get("side", 0.04) * K
    bottom = e.get("bottom", mb_u / K - 0.035) * K
    region = (1 - ss(half + side * 0.5, half + side, np.abs(a))) \
        * ss(bottom, bottom + 0.0175 * K, u) * (1 - ss(top - 0.0075 * K, top, u))
    pic, hole = ft.erase_lines(pic, region, ppm)
    m = paint.get("mouth")
    if m:
        sheet = ft.load(os.path.join(ROOT, "blender", "reference", m["image"]))
        cut = ft.cut_mouth(sheet, m["outline"])
        centre = LM["mouth"] + R * m["at"][0] * K + U * m["at"][1] * K
        ta, tu, _ = picture_frame(src, pic.shape[:2], centre)
        pts = np.array(m["outline"])
        hh = m["height"] * K / 2
        hw = hh * np.ptp(pts[:, 0]) / np.ptp(pts[:, 1])
        d = np.hypot(ta / hw, tu / hh)
        ring = (d > 1.15) & (d < 1.5) & (tu < 0) & (hole == 0)
        pic, shift = ft.paste_mouth(pic, ta, tu, cut, m["height"] * K, ring)
        print("  mouth from", m["image"], "skin shift", np.round(shift, 3))
    ft.save(pic, out_path)
    return dict(src, image=out_path)


def closed_eyes_only(src):
    """His closed-eyed picture with what sits just below the eyes (the older sculpt's nostrils, which
    don't line up with his nose) cleared away, for laying only its eyes over his own face."""
    import numpy as np
    import face_touchup as ft
    out_path = os.path.join(SCULPT, f"{NAME}-closed-eyes.png")
    pic = ft.load(src["image"])
    a, u, ppm = picture_frame(src, pic.shape[:2], CENTRE)
    sp = (LM["eyeB"] - LM["eyeA"]).length
    region = ((np.abs(a) < 0.38 * sp) & (u < -0.1 * sp) & (u > -0.5 * sp)).astype(np.float32)
    pic, _ = ft.erase_lines(pic, region, ppm)
    ft.save(pic, out_path)
    return dict(src, image=out_path)


def sample_image(path, points, r=4):
    img = bpy.data.images.load(path, check_existing=True)
    W, H = img.size
    px = img.pixels[:]
    acc, nn = [0.0, 0.0, 0.0], 0
    for x, y in points:
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                i = ((H - 1 - int(y + dy)) * W + int(x + dx)) * 4
                for c in range(3):
                    acc[c] += px[i + c]
                nn += 1
    return [a / nn for a in acc]


def main():
    make_web_copy()
    closed = render_closed_face()
    body = import_web()
    skin_rgb = skin_colour(body)
    base_img = base_image(body)
    face = cut_face(body)
    add_shape_keys(face)
    rig = build_rig()
    skin(body, rig)
    skin(face, rig)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 4
    scene.cycles.device = "CPU"
    os.makedirs(MOOD_DIR, exist_ok=True)
    def gain_for(src):
        # colour-match his skin in the picture (cheeks and forehead) to his skin on the model
        ea, eb, third, mouth = picture_landmarks(src)
        c = (ea + eb) / 2
        down = (mouth - c) * 0.35
        across = (eb - ea) * 0.48
        cheeks = [tuple(c - across + down)[:2], tuple(c + across + down)[:2], tuple((c + third) / 2)[:2]]
        pic = sample_image(src["image"], cheeks)
        return tuple(max(0.6, min(1.6, a / max(1e-3, b))) for a, b in zip(skin_rgb, pic))

    for mood, spec in CFG["moods"].items():
        paint = spec.get("paint")
        if not paint:
            continue
        layers = []
        if isinstance(paint, dict) and ("base" in paint or "eyes" in paint):
            if "mouth" in paint or "erase" in paint:
                # his own face (open-eyed in this mood's pose, or his closed-eyed sculpt), touched up:
                # the smile line erased, and a mouth from a sheet laid on
                own = paint.get("base", "own") == "own"
                base = render_own_face(face, spec["keys"], os.path.join(SCULPT, f"{NAME}-{mood}-own.png")) if own else closed
                pic = touch_up(base, paint, os.path.join(SCULPT, f"{NAME}-{mood}-face.png"))
                layers.append((pic, (1.0, 1.0, 1.0) if own else gain_for(closed), tuple(spec.get("mask", [0.78, 0.95])), "face"))
            if paint.get("eyes") == "closed":
                # just the closed eyes (and lids) from his closed-eyed sculpt, over his own face
                eyes = closed_eyes_only(closed)
                layers.append((eyes, gain_for(closed), tuple(paint.get("eyesMask", [0.75, 1.0])), "eyes"))
            paint_mood(face, mood, spec, layers, base_img)
            continue
        if paint == "closed" or spec.get("eyes") == "closed":
            # his own sculpted closed eyes, wide enough to cover his big open ones completely
            layers.append((closed, gain_for(closed), (0.78, 0.95), "face"))
        if paint != "closed":
            src = dict(paint)
            src["image"] = os.path.join(ROOT, "blender", "reference", paint["image"])
            if spec.get("eyes") == "closed":
                layers.append((src, gain_for(src), tuple(spec.get("mask", [0.5, 0.9])), "mouth"))   # just the mouth from the sheet
            else:
                layers.append((src, gain_for(src), tuple(spec.get("mask", [0.62, 0.86])), "face"))
        paint_mood(face, mood, spec, layers, base_img)
    cam = bpy.data.objects.get("face_cam")
    if cam:
        bpy.data.objects.remove(cam)
    for a in [a.name for a in face.data.attributes if a.name.startswith("mood_mask")]:
        face.data.attributes.remove(face.data.attributes[a])
    with open(os.path.join(OUT_DIR, f"{NAME}.json"), "w", encoding="utf-8") as fh:
        json.dump({"$comment": f"Made by blender/scripts/character_prep.py from blender/characters/{NAME}.json.",
                   "name": NAME, "moods": {m: {"keys": s["keys"], "paint": bool(s.get("paint"))} for m, s in CFG["moods"].items()},
                   "height": CFG.get("height", 1.9)}, fh, indent=2)
    os.makedirs(os.path.join(ROOT, "blender", "characters"), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "characters", f"{NAME}.blend"), compress=True)
    bpy.ops.object.select_all(action="SELECT")
    out = os.path.join(OUT_DIR, f"{NAME}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="WEBP", export_skins=True,
                              export_morph=True, export_morph_normal=False, export_animations=False, export_yup=True)
    print("wrote", out, round(os.path.getsize(out) / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
