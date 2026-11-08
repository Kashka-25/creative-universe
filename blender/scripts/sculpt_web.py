"""Make a web-sized copy of Cassidy's sculpted guide (Meshy GLB in blender/sculpt/).

    blender --background --factory-startup --python blender/scripts/sculpt_web.py -- [TARGET_TRIS]

Decimates the dense scan-like mesh to about TARGET_TRIS triangles (default 80 000),
keeps its painted textures (base colour, normal, roughness/metal), and writes
public/models/sculpt.glb. The source in blender/sculpt/ is never changed.
"""
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
target = int(argv[0]) if argv else 80000
root = os.getcwd()
src = os.path.join(root, "blender", "sculpt", "meshy-cloud-monkey-sage.glb")
out = os.path.join(root, "public", "models", "sculpt.glb")

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
    mod = o.modifiers.new("decimate", "DECIMATE")
    mod.ratio = min(1.0, target / tris)
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"{o.name}: {tris} -> {sum(len(p.vertices) - 2 for p in o.data.polygons)} tris")
    for p in o.data.polygons:
        p.use_smooth = True
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="WEBP", export_apply=True, export_yup=True)
print("wrote", out, round(os.path.getsize(out) / 1e6, 2), "MB")
