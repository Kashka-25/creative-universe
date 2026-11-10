"""Coco's Awakening: checks that the magic cloud fully hides Adult Coco around the peak (invitation page).

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background \
        blender/characters/invitation.blend --python blender/scripts/check_cloud_cover.py [-- options]

    --from <frame> --to <frame>   master frames to check (default: luminous - 12 .. dissipate + 24)
    --out <dir>                   also keep the coverage masks there (PNG, one per view and frame)

Run from the repository root after blender/scripts/build_coco_invite.py (which builds invitation.blend and the
magic cloud). It changes nothing: it renders coverage masks of the open scene and prints the frames on which no
pixel of him shows, for every view, and the span shared by all of them (build_magic_cloud.py HIDDEN is that span,
counted from luminous).

A coverage mask: Workbench, flat, every object one colour (him red: body, face, sun and bolt, the swirl by his
hat; the magic cloud black, opaque as it is on the site from luminous to dissipate; no background). A red pixel
is a pixel of him in front of the cloud. Views: the site's camera (vertical FOV 30 degrees) on his framed centre
from as near as any page puts it (the stage on a short landscape window) and as far (a tall stage), at a desktop
and a phone aspect, from his place and from a stage a little above or below the window's middle; and each with
him at rest and at the top of his 'float' (35 mm up, tipped 0.7 degrees), the most he moves meanwhile.
"""

import math
import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Vector

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
RIG = "coco-sage_rig"
HIM = ("coco-sage_body", "coco-sage_face", "sun_bolt", "swirl_head_mesh", "coco-sage_eyes")
CENTRE = Vector((-0.004, 0.0, 0.0))        # his box's middle (Blender axes), where the site frames him
FOV_DEG = 30.0
VIEWS = [
    # name, resolution, camera distance (m), camera height offset (m)
    ("desktop-near", (640, 400), 6.5, 0.0),
    ("desktop-far", (640, 400), 11.0, 0.0),
    ("desktop-high", (640, 400), 9.0, 1.2),
    ("desktop-low", (640, 400), 9.0, -1.2),
    ("phone-near", (390, 844), 7.5, 0.0),
    ("phone-far", (390, 844), 12.0, 0.0),
]
POSES = [("rest", 0.0, 0.0), ("float-top", 0.035, 0.7)]


def opt(flag, default=None, cast=str):
    return cast(ARGV[ARGV.index(flag) + 1]) if flag in ARGV else default


def setup():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "FLAT"
    sh.color_type = "OBJECT"
    sh.show_shadows = False
    sh.show_cavity = False
    sh.show_object_outline = False
    sh.show_specular_highlight = False
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    for ob in sc.objects:
        if ob.type != "MESH":
            continue
        ob.color = (1, 0, 0, 1) if ob.name in HIM else (0, 0, 0, 1)
        ob.hide_render = not (ob.name in HIM or ob.users_collection[0].name == "magic_cloud")
    cam_data = bpy.data.cameras.new("cover_cam")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle_y = math.radians(FOV_DEG)
    cam_data.clip_start, cam_data.clip_end = 0.1, 100
    cam = bpy.data.objects.new("cover_cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam


def red_pixels(path):
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    bpy.data.images.remove(img)
    return int(((px[:, 0] > 0.5) & (px[:, 1] < 0.3) & (px[:, 3] > 0.5)).sum())


def main():
    sc, cam = setup()
    mk = {m.name: m.frame for m in sc.timeline_markers}
    lum, dis = mk["luminous"], mk["dissipate"]
    f0, f1 = opt("--from", lum - 12, int), opt("--to", dis + 24, int)
    out = opt("--out")
    tmp = out or tempfile.mkdtemp(prefix="cover-")
    os.makedirs(tmp, exist_ok=True)
    rig = bpy.data.objects[RIG]
    base_loc, base_rot = rig.location.copy(), rig.rotation_euler.copy()
    hidden_all = None
    for vname, (w, h), dist, dz in VIEWS:
        sc.render.resolution_x, sc.render.resolution_y = w, h
        sc.render.resolution_percentage = 100
        cam.location = CENTRE + Vector((0, -dist, dz))
        cam.rotation_euler = (math.radians(90), 0, 0)
        for pname, lift, roll in POSES:
            rig.location = base_loc + Vector((0, 0, lift))
            rig.rotation_euler = (base_rot.x, base_rot.y + math.radians(roll), base_rot.z)
            counts = {}
            for f in range(f0, f1 + 1):
                sc.frame_set(f)
                path = os.path.join(tmp, f"{vname}-{pname}-{f:04d}.png")
                sc.render.filepath = path
                bpy.ops.render.render(write_still=True)
                counts[f] = red_pixels(path)
                if not out:
                    os.remove(path)
            hidden = {f for f, c in counts.items() if c == 0}
            hidden_all = hidden if hidden_all is None else hidden_all & hidden
            span = sorted(hidden)
            print(f"[cover] {vname:13s} {pname:9s} hidden on {len(span)} frames"
                  + (f" ({span[0]}..{span[-1]})" if span else "")
                  + "; pixels of him per frame: " + " ".join(f"{f}:{c}" for f, c in counts.items() if f % 4 == 0 or c),
                  flush=True)
    rig.location, rig.rotation_euler = base_loc, base_rot
    span = sorted(hidden_all or [])
    # the contiguous run through the middle of the hidden frames
    run = []
    for f in span:
        if run and f != run[-1] + 1:
            if mk.get("cover", lum) in run:
                break
            run = []
        run.append(f)
    print(f"[cover] luminous {lum}, cover {mk.get('cover')}, dissipate {dis}")
    if run:
        print(f"[cover] fully hidden in every view from {run[0]} to {run[-1]} "
              f"(luminous + {run[0] - lum} .. luminous + {run[-1] - lum})")
    else:
        print("[cover] NOT fully hidden on any frame in every view")


if __name__ == "__main__":
    main()
