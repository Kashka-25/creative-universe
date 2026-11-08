"""Render likeness views of the guide for comparing with the painting.

    blender blender/guide.blend --background --python blender/scripts/render_turnaround.py -- OUT_DIR [clip] [frame]

Writes front, three-quarter and side PNGs of the guide posed at a frame of a clip
(default: seated_idle, frame 1), on a light background like the likeness sheets.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out_dir = argv[0] if argv else os.path.join(os.path.dirname(bpy.data.filepath), "renders")
clip = argv[1] if len(argv) > 1 else "seated_idle"
frame = int(argv[2]) if len(argv) > 2 else 1
os.makedirs(out_dir, exist_ok=True)

scene = bpy.context.scene
rig = bpy.data.objects["GuideRig"]
face = bpy.data.objects["guide_head"]
act = bpy.data.actions[clip]
rig.animation_data.action = act
rig.animation_data.action_slot = act.slots["OBGuideRig"]
key = face.data.shape_keys
key.animation_data.action = act
key.animation_data.action_slot = act.slots["KEFaceKeys"]
scene.frame_set(frame)

scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = 900, 1100
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"
world = scene.world or bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.92, 0.9, 0.86, 1)
bg.inputs["Strength"].default_value = 1.0

for name, energy, rot in (("key", 3.2, (math.radians(50), 0, math.radians(30))), ("rim", 1.5, (math.radians(60), 0, math.radians(200)))):
    light = bpy.data.objects.get(f"LIGHT_{name}")
    if not light:
        light = bpy.data.objects.new(f"LIGHT_{name}", bpy.data.lights.new(name, "SUN"))
        scene.collection.objects.link(light)
    light.data.energy = energy
    light.rotation_euler = rot

target = Vector((0, 0, 0.55 if "seated" in clip or "perch" in clip or clip in ("wake", "acknowledge", "beckon") else 0.8))
cam = bpy.data.objects.get("CAM_turnaround")
if not cam:
    cam = bpy.data.objects.new("CAM_turnaround", bpy.data.cameras.new("turnaround"))
    scene.collection.objects.link(cam)
scene.camera = cam
cam.data.lens = 70
dist = 3.4 if target.z < 0.7 else 4.4
for view, ang in (("front", 0), ("three-quarter", 35), ("side", 90)):
    a = math.radians(ang)
    cam.location = target + Vector((math.sin(a) * dist, -math.cos(a) * dist, 0.15))
    d = target - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(out_dir, f"{clip}-{frame}-{view}.png")
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath)
