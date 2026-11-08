"""Line the guide up with the painting, and show how his outline compares.

    blender blender/guide.blend --background --python blender/scripts/fit_reference.py -- [OUT_PNG]

Poses him as painted (seated_idle, first frame), finds his third eye and mouth,
and fits an orthographic front view so they land on the painting's. Saves that
view to blender/reference/alignment.json (the paint step projects through it)
and, if OUT_PNG is given, an overlay of his outline on the painting.
"""

import json
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guide_common import project_root  # noqa: E402

ROOT = project_root()
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_png = argv[0] if argv else None

# Landmarks measured on blender/reference/guide-reference.png (2480 x 3508, pixels from top-left).
PAINTING = {
    "size": [2480, 3508],
    "third_eye": [1252, 1022],
    "eye_L": [1383, 1143],   # his left = viewer's right
    "eye_R": [1128, 1143],
    "mouth": [1258, 1310],
}


def pose_as_painted():
    rig = bpy.data.objects["GuideRig"]
    act = bpy.data.actions["seated_idle"]
    rig.animation_data.action = act
    rig.animation_data.action_slot = act.slots["OBGuideRig"]
    key = bpy.data.objects["guide_head"].data.shape_keys
    key.animation_data.action = act
    key.animation_data.action_slot = act.slots["KEFaceKeys"]
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()


def centroid(obj_name, material):
    obj = bpy.data.objects[obj_name]
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = ev.to_mesh()
    idx = [i for i, m in enumerate(obj.data.materials) if m and m.name == material][0]
    vs = {v for p in me.polygons if p.material_index == idx for v in p.vertices}
    c = sum((ev.matrix_world @ me.vertices[v].co for v in vs), Vector()) / len(vs)
    ev.to_mesh_clear()
    return c


def bone_head(name):
    rig = bpy.data.objects["GuideRig"]
    return rig.matrix_world @ rig.pose.bones[name].head


def fit():
    pose_as_painted()
    te = centroid("guide_head", "third_eye_iris")
    mouth = centroid("guide_head", "mouth")
    eyes = {s: bone_head(f"eye_{s}") for s in ("L", "R")}
    W, H = PAINTING["size"]
    # Blender: x right (his left), z up. Painting: x right, y down.
    s = (te.z - mouth.z) / (PAINTING["mouth"][1] - PAINTING["third_eye"][1])  # metres per pixel
    cx = te.x - (PAINTING["third_eye"][0] - W / 2) * s
    cz = te.z + (PAINTING["third_eye"][1] - H / 2) * s
    model_eye_px = (eyes["L"].x - eyes["R"].x) / s
    paint_eye_px = PAINTING["eye_L"][0] - PAINTING["eye_R"][0]
    print(f"scale {s * 1000:.4f} mm/px; eye spacing model {model_eye_px:.0f}px vs painting {paint_eye_px}px; "
          f"eye height model {(cz - eyes['L'].z) / s + H / 2:.0f}px vs painting {PAINTING['eye_L'][1]}px")
    align = {"metresPerPixel": s, "centre": [cx, cz], "size": [W, H], "pose": ["seated_idle", 0], "landmarks": PAINTING}
    with open(os.path.join(ROOT, "blender", "reference", "alignment.json"), "w", encoding="utf-8") as f:
        json.dump(align, f, indent=2)
    return align


def render_overlay(align, path):
    scene = bpy.context.scene
    W, H = align["size"]
    cam = bpy.data.objects.get("CAM_painting") or bpy.data.objects.new("CAM_painting", bpy.data.cameras.new("painting"))
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(W, H) * align["metresPerPixel"]
    cam.location = (align["centre"][0], -10, align["centre"][1])
    cam.rotation_euler = (1.5707963, 0, 0)
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "FLAT"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = W // 2, H // 2
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("overlay mask", path)


align = fit()
if out_png:
    render_overlay(align, out_png)
