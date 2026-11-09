"""Close-up renders of a character's face in every mood, plus a full view, to judge them.

    blender blender/characters/<name>.blend --background --python blender/scripts/render_character_moods.py -- <name> OUT_DIR
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

name, out = sys.argv[sys.argv.index("--") + 1:sys.argv.index("--") + 3]
os.makedirs(out, exist_ok=True)
root = os.getcwd()
cfg = json.load(open(os.path.join(root, "blender", "characters", f"{name}.json")))
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.view_settings.view_transform = "Standard"
w = sc.world or bpy.data.worlds.new("w")
sc.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.95, 0.9, 0.82, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.2
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sc.collection.objects.link(sun)
sun.data.energy = 2.2
sun.rotation_euler = (math.radians(55), 0, math.radians(20))
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
face = bpy.data.objects[f"{name}_face"]
mat = face.data.materials[0]
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
tex = bsdf.inputs["Base Color"].links[0].from_node
base = tex.image


def shoot(path, target, dist, lens, size=(700, 700)):
    sc.render.resolution_x, sc.render.resolution_y = size
    cam.data.lens = lens
    cam.location = target + Vector((0, -dist, 0.04))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


F = cfg["face"]
target = Vector((F["cx"], F["front"] - 0.1, F["cz"]))
for mood, spec in cfg["moods"].items():
    for kb in face.data.shape_keys.key_blocks[1:]:
        kb.value = spec["keys"].get(kb.name, 0.0)
    if spec.get("paint"):
        img = bpy.data.images.load(os.path.join(root, "public", "models", "characters", name, f"{mood}.webp"), check_existing=False)
        img.reload()
        tex.image = img
    else:
        tex.image = base
    shoot(os.path.join(out, f"{name}-{mood}.png"), target, 1.5, 85)
    print("rendered", mood)
for kb in face.data.shape_keys.key_blocks[1:]:
    kb.value = 0.0
tex.image = base
shoot(os.path.join(out, f"{name}-full.png"), Vector((0, 0, 0)), 6.0, 60, (700, 900))
