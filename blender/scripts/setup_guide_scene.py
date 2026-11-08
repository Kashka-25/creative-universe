"""Prepare blender/guide.blend for modelling, rigging and animating the guide.

Run once in a new file (Scripting tab > Open > this file > Run Script), or:
    blender blender/guide.blend --background --python blender/scripts/setup_guide_scene.py

It is safe to run again: it only adds what is missing and never overwrites
your modelling, weights or animation.

What it sets up
  - Scene: metres, 30 fps (from the contract), a "Guide" collection.
  - Reference: Cassidy's painting as an image empty in the front view.
  - GuideRig: an armature whose deform bones carry the contract's names, in
    the same proportions as the web stand-in (seated head about 0.9 m), so
    the website's camera framing fits without changes.
  - Actions: one per clip (seated_idle, wake, acknowledge, beckon, rise, fly,
    plus optional perch_idle and land), with the planned length, a rest key at
    the first and last frame, and a note of the beat.

Blender is +Z up and the character faces -Y (front view). The glTF exporter
turns that into +Y up, facing +Z, which is what the website expects.
"""

import os
import sys

import bpy
from mathutils import Vector

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
FPS = int(C["asset"]["fps"])

# Rest positions relative to the parent bone, in the web's axes (x right-of-viewer is his left, y up, z towards camera).
# Mirrors src/scene/guide/proceduralGuide.ts REST so proportions match the stand-in.
REST = {
    "root": (0, 0, 0), "hips": (0, 0.56, 0), "spine": (0, 0.09, 0), "chest": (0, 0.16, 0), "neck": (0, 0.15, 0), "head": (0, 0.04, 0),
    "eye_L": (0.066, 0.2, 0.19), "eye_R": (-0.066, 0.2, 0.19), "beanie": (0, 0.22, -0.03), "jaw": (0, 0.08, 0.12),
    "brow_L": (0.066, 0.25, 0.19), "brow_R": (-0.066, 0.25, 0.19), "ear_L": (0.21, 0.18, 0), "ear_R": (-0.21, 0.18, 0),
    "upperarm_L": (0.175, 0.1, 0), "forearm_L": (0, -0.2, 0), "hand_L": (0, -0.19, 0), "fingers_L": (0, -0.07, 0), "thumb_L": (0, -0.03, 0.035),
    "upperarm_R": (-0.175, 0.1, 0), "forearm_R": (0, -0.2, 0), "hand_R": (0, -0.19, 0), "fingers_R": (0, -0.07, 0), "thumb_R": (0, -0.03, 0.035),
    "thigh_L": (0.1, -0.03, 0), "shin_L": (0, -0.2, 0), "foot_L": (0, -0.17, 0),
    "thigh_R": (-0.1, -0.03, 0), "shin_R": (0, -0.2, 0), "foot_R": (0, -0.17, 0),
}

# Where each bone's tail points: towards a child, or a short stub in a direction (web axes).
TAIL_TO = {
    "root": "hips", "hips": "spine", "spine": "chest", "chest": "neck", "neck": "head",
    "upperarm_L": "forearm_L", "forearm_L": "hand_L", "hand_L": "fingers_L",
    "upperarm_R": "forearm_R", "forearm_R": "hand_R", "hand_R": "fingers_R",
    "thigh_L": "shin_L", "shin_L": "foot_L", "thigh_R": "shin_R", "shin_R": "foot_R",
}
TAIL_STUB = {
    "head": (0, 0.3, 0), "eye_L": (0, 0, 0.04), "eye_R": (0, 0, 0.04), "beanie": (0, 0.15, 0), "jaw": (0, -0.03, 0.06),
    "brow_L": (0, 0.03, 0.02), "brow_R": (0, 0.03, 0.02), "ear_L": (0.06, 0, 0), "ear_R": (-0.06, 0, 0),
    "fingers_L": (0, -0.06, 0), "fingers_R": (0, -0.06, 0), "thumb_L": (0, -0.03, 0.03), "thumb_R": (0, -0.03, 0.03),
    "foot_L": (0, -0.03, 0.12), "foot_R": (0, -0.03, 0.12),
}


def web_to_blender(v):
    x, y, z = v
    return Vector((x, -z, y))


def ensure_collection(name):
    coll = bpy.data.collections.get(name)
    if not coll:
        coll = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(coll)
    return coll


def setup_scene():
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps = FPS
    scene.render.fps_base = 1.0


def add_reference(coll):
    path = os.path.join(project_root(), "blender", "reference", "guide-reference.png")
    if bpy.data.objects.get("REF_painting") or not os.path.isfile(path):
        return
    img = bpy.data.images.load(path, check_existing=True)
    ref = bpy.data.objects.new("REF_painting", None)
    ref.empty_display_type = "IMAGE"
    ref.data = img
    ref.empty_display_size = 1.9  # the painting's height in metres, roughly the emblem composition
    ref.empty_image_offset = (-0.5, -0.5)
    ref.location = (0, 0.6, 0.78)  # behind the figure, centred on the composition
    ref.rotation_euler = (1.5708, 0, 0)  # stand it up to face the front view
    ref.empty_image_side = "FRONT"
    ref.show_in_front = False
    ref.use_empty_image_alpha = True
    ref.color[3] = 0.5
    ref.hide_render = True
    ref.hide_select = True
    coll.objects.link(ref)


def world_positions():
    parents = C["bones"]["parents"]
    bones = list(C["bones"]["required"]) + list(C["bones"]["optional"])
    pos = {}

    def resolve(b):
        if b in pos:
            return pos[b]
        local = Vector(REST.get(b, (0, 0, 0)))
        p = parents.get(b)
        pos[b] = (resolve(p) if p else Vector((0, 0, 0))) + local
        return pos[b]

    for b in bones:
        resolve(b)
    return bones, parents, pos


def build_rig(coll):
    rig = bpy.data.objects.get("GuideRig")
    if rig:
        print("GuideRig already exists: leaving bones untouched.")
        return rig
    arm = bpy.data.armatures.new("GuideRig")
    arm.display_type = "OCTAHEDRAL"
    rig = bpy.data.objects.new("GuideRig", arm)
    coll.objects.link(rig)
    rig.show_in_front = True

    bones, parents, pos = world_positions()
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    for b in bones:
        bone = eb.new(b)
        bone.head = web_to_blender(pos[b])
        if b in TAIL_TO and TAIL_TO[b] in pos:
            tail = pos[TAIL_TO[b]]
        else:
            tail = pos[b] + Vector(TAIL_STUB.get(b, (0, 0.05, 0)))
        if (tail - pos[b]).length < 0.01:
            tail = pos[b] + Vector((0, 0.05, 0))
        bone.tail = web_to_blender(tail)
        bone.use_deform = b != "root"
    for b in bones:
        p = parents.get(b)
        if p:
            eb[b].parent = eb[p]
            eb[b].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    print(f"Built GuideRig with {len(bones)} contract bones.")
    return rig


def build_actions(rig):
    rig.animation_data_create()
    created = []
    for clip in all_clips(C):
        name = clip["name"]
        if bpy.data.actions.get(name):
            continue  # never touch an action that already exists: it may hold animation
        frames = max(2, round(clip["seconds"] * FPS))
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        rig.animation_data.action = act
        for pb in rig.pose.bones:
            for f in (1, frames + 1):
                pb.keyframe_insert("rotation_quaternion", frame=f, group=pb.name)
                pb.keyframe_insert("location", frame=f, group=pb.name)
        try:
            act.use_frame_range = True
            act.frame_start = 1
            act.frame_end = frames + 1
        except AttributeError:
            pass
        act["guide_loop"] = bool(clip["loop"])
        act["guide_beat"] = clip["beat"]
        created.append(f"{name} ({frames} frames)")
    first = bpy.data.actions.get("seated_idle")
    if first:
        rig.animation_data.action = first
    print("Actions created: " + (", ".join(created) if created else "none (all exist)"))


def add_notes():
    text = bpy.data.texts.get("GUIDE_NOTES") or bpy.data.texts.new("GUIDE_NOTES")
    if text.as_string().strip():
        return
    lines = ["Guide contract (from contract/guide-contract.json)", ""]
    lines.append("Clips, in story order:")
    for c in all_clips(C):
        lines.append(f"  {c['name']:<12} {c['seconds']}s {'loop' if c['loop'] else 'once'}  {c['beat']}")
    lines += ["", "Shape keys: " + ", ".join(C["morphs"]["required"] + C["morphs"]["optional"]),
              "Materials: " + ", ".join(C["materials"]["optional"].keys()),
              "", "Export: run blender/scripts/export_guide.py, then npm run check:guide -- --register"]
    text.write("\n".join(lines))


def main():
    setup_scene()
    coll = ensure_collection("Guide")
    add_reference(ensure_collection("Reference"))  # kept out of the export
    rig = build_rig(coll)
    build_actions(rig)
    add_notes()
    print("Guide scene ready. Model in the 'Guide' collection, parent the mesh to GuideRig (With Automatic Weights).")


main()
