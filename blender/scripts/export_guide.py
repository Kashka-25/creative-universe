"""Export the guide to public/models/guide.glb with the settings the website expects.

In Blender: Scripting tab > Open > this file > Run Script.
Headless:
    blender blender/guide.blend --background --python blender/scripts/export_guide.py

Then, in the project folder:
    npm run optimize:guide
    npm run check:guide -- --register

Exports the "Guide" collection: GuideRig plus every mesh parented to it.
Each action becomes a separate glTF animation, named exactly like the action.
Only deform bones are exported, so add your IK and control bones freely
(name them CTRL_* or MCH_* and untick Deform).
"""

import os
import sys

import bpy

def _scripts_dir():
    """This folder, however Blender ran the script (file, Text editor or --python)."""
    cands = []
    if "__file__" in globals():
        cands.append(os.path.dirname(os.path.abspath(__file__)))
    for t in bpy.data.texts:
        if t.filepath:
            cands.append(os.path.dirname(bpy.path.abspath(t.filepath)))
    if bpy.data.filepath:
        cands.append(os.path.join(os.path.dirname(bpy.data.filepath), "scripts"))
    for c in cands:
        if os.path.isfile(os.path.join(c, "guide_common.py")):
            return c
    raise RuntimeError("Keep guide_common.py next to this script (blender/scripts/).")


sys.path.insert(0, _scripts_dir())
from guide_common import all_clips, load_contract, project_root  # noqa: E402

C = load_contract()


def preflight():
    problems = []
    rig = bpy.data.objects.get("GuideRig")
    if not rig:
        problems.append("No GuideRig armature. Run setup_guide_scene.py first.")
        return problems, None
    names = {b.name for b in rig.data.bones}
    for b in C["bones"]["required"]:
        if b not in names:
            dotted = b[:-2] + "." + b[-1] if b.endswith(("_L", "_R")) else None
            problems.append(f"Bone '{b}' missing" + (f" (found '{dotted}': rename it, three.js drops the dot)" if dotted in names else "."))
    for c in C["clips"]:
        if not bpy.data.actions.get(c["name"]):
            problems.append(f"Action '{c['name']}' missing.")
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == rig]
    if not meshes:
        problems.append("No mesh is parented to GuideRig.")
    keys = set()
    for m in meshes:
        if m.data.shape_keys:
            keys |= {k.name for k in m.data.shape_keys.key_blocks}
    for k in C["morphs"]["required"]:
        if k not in keys:
            problems.append(f"Shape key '{k}' missing on the guide's meshes.")
    return problems, rig


def export():
    problems, rig = preflight()
    if problems:
        print("Export stopped:\n  - " + "\n  - ".join(problems))
        return False

    # Each action must be usable by the rig: make sure all are kept, then export them all.
    for c in all_clips(C):
        act = bpy.data.actions.get(c["name"])
        if act:
            act.use_fake_user = True

    out = os.path.join(project_root(), "public", C["asset"]["publicPath"].replace("/", os.sep))
    os.makedirs(os.path.dirname(out), exist_ok=True)

    wanted = dict(
        filepath=out,
        export_format="GLB",
        use_selection=False,
        use_active_collection=True,
        use_visible=False,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="WEBP",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=True,
        export_anim_single_armature=True,
        export_reset_pose_bones=True,
        export_skins=True,
        export_def_bones=True,
        export_all_influences=False,
        export_morph=True,
        export_morph_normal=True,
        export_morph_animation=True,
        export_extras=True,
        export_lights=False,
        export_cameras=False,
        export_draco_mesh_compression_enable=False,
    )
    # Different Blender versions know different options: pass only the ones this one has.
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    kwargs = {k: v for k, v in wanted.items() if k in known}
    skipped = sorted(set(wanted) - set(kwargs))
    if skipped:
        print("Not available in this Blender, skipped: " + ", ".join(skipped))

    # Export only the "Guide" collection (the reference painting lives in "Reference").
    layer = bpy.context.view_layer.layer_collection.children.get("Guide")
    if layer:
        bpy.context.view_layer.active_layer_collection = layer
        kwargs["use_active_collection"] = "use_active_collection" in known

    bpy.ops.export_scene.gltf(**kwargs)
    size = os.path.getsize(out) / 1e6
    print(f"Exported {out} ({size:.2f} MB)")
    print("Next, in the project folder:\n  npm run optimize:guide\n  npm run check:guide -- --register")
    return True


export()
