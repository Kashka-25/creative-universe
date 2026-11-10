"""Make a web-sized copy of Cassidy's sculpted guide (Meshy GLB in blender/sculpt/).

    blender --background --factory-startup --python blender/scripts/sculpt_web.py -- [TARGET_TRIS] [SOURCE_IN_blender/sculpt] [OUT_IN_public/models]

Decimates the dense scan-like mesh to about TARGET_TRIS triangles (default 80 000),
keeps its painted textures (base colour, normal, roughness/metal), and writes
blender/sculpt/sculpt-80k.glb (the input of true_form.py). The source in blender/sculpt/ is never changed.
"""
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
target = int(argv[0]) if argv else 80000
root = os.getcwd()
src = os.path.join(root, "blender", "sculpt", argv[1] if len(argv) > 1 else "meshy-cloud-monkey-sage-no-sun.glb")
out = os.path.join(root, "blender", "sculpt", argv[2] if len(argv) > 2 else "sculpt-80k.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    # The GLB arrives split at every texture seam; join those first, or simplifying tears cracks along them.
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.00005)
    bpy.ops.object.mode_set(mode="OBJECT")
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    # Protect his face: it keeps its sculpted detail (creases, lips, nose) for the expressions;
    # the savings come from the fur. Same face area as true_form.py (Blender axes, metres).
    keep = o.vertex_groups.new(name="keep_face")
    for v in o.data.vertices:
        d = math.hypot((v.co.x - 0.045) / 0.25, (v.co.z - 0.60) / 0.23)
        if d < 1.0 and v.co.y < -0.12:
            keep.add([v.index], 1.0 - 0.6 * max(0.0, d - 0.6) / 0.4, "REPLACE")
    mod = o.modifiers.new("decimate", "DECIMATE")
    mod.ratio = min(1.0, target / tris)
    mod.use_collapse_triangulate = True
    mod.vertex_group = "keep_face"
    mod.invert_vertex_group = True    # the group marks what to protect, so invert it: everything else is simplified
    mod.vertex_group_factor = 8.0
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"{o.name}: {tris} -> {sum(len(p.vertices) - 2 for p in o.data.polygons)} tris")
    for p in o.data.polygons:
        p.use_smooth = True
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="WEBP", export_apply=True, export_yup=True)
print("wrote", out, round(os.path.getsize(out) / 1e6, 2), "MB")
