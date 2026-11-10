"""Scattered clouds: six small clouds of Coco's own swirl cloud, for the sections of the site's pages, each a still
and a seamless spinning loop.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup \
        --python blender/scripts/render_section_clouds.py [-- --out <dir>] [--only 1,3] [--loops | --loops-only]
        [--frames <dir>] [--no-encode] [--python-exe <python with Pillow>]

Run from the repository root. Builds nothing in any .blend and opens none: it starts from an empty scene, makes
the magic cloud's own curl and wisp meshes and colour ramp (blender/scripts/build_magic_cloud.py: curl_bun, wisp,
ramp_srgb, the colours sampled from the cloud in Young Coco's hands), arranges them into small clusters and renders
each one, front three-quarter, in light like the site's invitation stage (warm sky, warm key from the upper right,
cool fill from the left, a soft turquoise glow), on a transparent background. The site floats them with CSS.

The loops (--loops: the stills and the loops; --loops-only: the loops alone, the stills left as they are) spin
each curl the way the ride cloud's curls turn in its 'rest' loop (build_ride_cloud.py curl_life): one slow turn
about its own face every LOOP_S seconds, half of them one way and half the other (their chirality), in the same
light and from the same camera as the still, so the loop's first frame is the still. The wisp keeps still. The
frames go to a temporary folder (LOOP_S x LOOP_FPS of them, plus one more, the same as frame 0, for the seam check)
and are handed to encode_cloud_loops.py (run with the system's Python, which needs Pillow), which crops them as the
still is cropped, writes each animated AVIF and adds it to clouds.json.

Writes
  public/models/clouds/cloud-1.webp .. cloud-6.webp            ~440 px on the long side, WebP quality 82, alpha
  public/models/clouds/cloud-1-spin.avif .. cloud-6-spin.avif  the loops (encode_cloud_loops.py)
  public/models/clouds/clouds.json      [{file, width, height, kind, anim?}], kind: cluster | single | wisp,
                                        anim: {file, width, height, fps, frames}
"""

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Euler, Quaternion, Vector

ROOT = os.getcwd()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_magic_cloud as mc                       # noqa: E402  (its curl, wisp and colours; nothing is built)

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGV[ARGV.index("--out") + 1] if "--out" in ARGV else os.path.join(ROOT, "public", "models", "clouds")
ONLY = [int(x) for x in ARGV[ARGV.index("--only") + 1].split(",")] if "--only" in ARGV else None
LOOPS = "--loops" in ARGV or "--loops-only" in ARGV
STILLS = "--loops-only" not in ARGV
FRAMES = ARGV[ARGV.index("--frames") + 1] if "--frames" in ARGV else None       # where the loop frames go
ENCODE = "--no-encode" not in ARGV                                              # leave the frames for later
PYTHON = ARGV[ARGV.index("--python-exe") + 1] if "--python-exe" in ARGV else (shutil.which("python") or "python")
LONG_SIDE = 440                                      # px, the long side of each still
QUALITY = 82
RENDER = 1100                                        # px, the square it is rendered at before cropping and scaling
GLOW = "#96ebfb"                                     # the site's cloud glow colour (src/invitation/cloudLook.ts)
GLOW_STRENGTH = 0.32                                 # a soft inner light, as the magic cloud has while it settles
LOOP_S = 20.0                                        # one turn of every curl per loop (build_ride_cloud.py LOOP_S)
LOOP_FPS = 12                                        # the loops' frame rate: 1.5 deg of turn a frame
LOOP_RENDER = 720                                    # px, the square each loop frame is rendered at
LOOP_SAMPLES = 32

# Each cloud: curls (x, z position in its own plane, size, chirality (spiral turn), roll, yaw/pitch tweak in
# degrees, depth y) and an optional wisp tail: its thin end tucked behind the cluster at 'start', it sweeps out
# along a circle of radius r (sideways, then up; cw: to the left) and rolls up into its curl. Units: a curl of size 1 has
# radius 1. Bigger curls sit lower and in front, like his cumulus, smaller ones crown them.
CLOUDS = [
    dict(kind="cluster", curls=[
        (0.00, 0.00, 1.00, +1, 20, (0, 0), 0.00),
        (1.30, -0.22, 0.74, -1, 140, (8, 0), 0.25),
        (-1.18, -0.30, 0.66, -1, 300, (-8, 0), 0.30),
    ]),
    dict(kind="wisp", curls=[
        (0.00, 0.00, 1.00, -1, 75, (0, 0), 0.00),
        (1.22, 0.30, 0.70, +1, 200, (6, 4), 0.30),
        (-1.20, -0.20, 0.78, +1, 10, (-6, 0), 0.20),
        (0.55, 1.00, 0.60, -1, 250, (4, 8), 0.45),
        (-0.55, 0.92, 0.52, +1, 330, (-4, 8), 0.50),
    ], wisp=dict(start=(1.45, -0.35), r=1.05, cw=False, tilt=14, depth=0.35)),
    dict(kind="single", curls=[
        (0.00, 0.00, 1.00, +1, 300, (0, 0), 0.00),
    ]),
    dict(kind="wisp", curls=[
        (0.00, 0.00, 1.00, -1, 130, (0, 0), 0.00),
    ], wisp=dict(start=(-0.55, -0.55), r=1.1, cw=True, tilt=10, depth=0.35)),
    dict(kind="cluster", curls=[
        (-0.55, 0.00, 1.00, +1, 45, (0, 0), 0.00),
        (0.82, 0.22, 0.80, -1, 230, (8, 2), 0.25),
    ]),
    dict(kind="cluster", curls=[
        (0.00, -0.10, 1.00, +1, 160, (0, 0), 0.00),
        (-1.30, -0.30, 0.78, -1, 20, (-8, 0), 0.20),
        (1.25, -0.35, 0.72, +1, 280, (8, 0), 0.25),
        (0.35, 0.95, 0.62, -1, 100, (2, 8), 0.45),
    ], wisp=dict(start=(-1.55, -0.45), r=0.95, cw=True, tilt=12, depth=0.35)),
]


def log(*a):
    print("[clouds]", *a, flush=True)


def hexlin(h):
    return tuple(mc.hexlin(h)) + (1.0,)


def material():
    """The magic cloud's look: its colour ramp as base colour, and the same ramp tinted with the site's glow
    colour as a soft emission (the crests and rims glow most)."""
    mat = bpy.data.materials.new("section_cloud")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = mc.ramp_image()
    tex.extension = "EXTEND"
    tex.interpolation = "Linear"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mix.inputs["A"])
    mix.inputs["B"].default_value = hexlin(GLOW)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = GLOW_STRENGTH
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def scene_setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = RENDER
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    if hasattr(sc, "eevee") and hasattr(sc.eevee, "taa_render_samples"):
        sc.eevee.taa_render_samples = 64
    # the site's invitation light (src/invitation/InvitationStage.tsx): a warm sky over a warm ground, a warm key
    # from the upper right and in front, a cool fill from the left (glTF (x, y, z) -> Blender (x, -z, y))
    w = bpy.data.worlds.new("sky")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    mapz = nt.nodes.new("ShaderNodeMapRange")
    mapz.inputs["From Min"].default_value = -1.0
    nt.links.new(sep.outputs["Z"], mapz.inputs["Value"])
    nt.links.new(mapz.outputs["Result"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = hexlin("#d9905e")
    ramp.color_ramp.elements[1].color = hexlin("#fff4e2")
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.85
    for name, glpos, energy, col in (("key", (2.5, 3.5, 5.0), 2.6, "#fff0d0"), ("fill", (-3.0, 1.5, 3.0), 0.9, "#d6fbf6")):
        L = bpy.data.lights.new(name, "SUN")
        L.energy = energy
        L.color = hexlin(col)[:3]
        L.angle = math.radians(25)                   # soft shadows
        ob = bpy.data.objects.new(name, L)
        sc.collection.objects.link(ob)
        d = Vector((glpos[0], -glpos[2], glpos[1]))
        ob.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    return sc, cam


def curl_quat(yaw, pitch, roll):
    """A curl facing the visitor (-Y), turned a little outwards and up, rolled `roll` degrees about its own face."""
    return Euler((math.radians(pitch), 0.0, math.radians(yaw)), "XYZ").to_quaternion() @ Quaternion((0, 1, 0), math.radians(roll))


def turn_curls(spec, obs, tau):
    """Every curl's turn at tau seconds, as the ride cloud's 'rest' turns its curls: its chirality x one full turn
    per LOOP_S about its own face (periodic, so the frame at LOOP_S is frame 0 again)."""
    for (x, z, s, chir, roll, (yaw, pitch), depth), ob in zip(spec["curls"], obs):
        ob.rotation_quaternion = curl_quat(yaw, pitch, roll + chir * 360.0 * tau / LOOP_S)


def render_loop(sc, spec, obs, folder):
    """The loop's frames 0 .. LOOP_S x LOOP_FPS as PNGs (the last is frame 0 again, for the seam check only).
    Returns the loop's frame count."""
    os.makedirs(folder, exist_ok=True)
    for f in os.listdir(folder):
        os.remove(os.path.join(folder, f))
    r, ee = sc.render, getattr(sc, "eevee", None)
    keep = (r.resolution_x, getattr(ee, "taa_render_samples", None))
    r.resolution_x = r.resolution_y = LOOP_RENDER
    if keep[1] is not None:
        ee.taa_render_samples = LOOP_SAMPLES
    n = int(round(LOOP_S * LOOP_FPS))
    for k in range(n + 1):
        turn_curls(spec, obs, k / LOOP_FPS)
        r.filepath = os.path.join(folder, f"f{k:04d}.png")
        bpy.ops.render.render(write_still=True)
    turn_curls(spec, obs, 0.0)
    r.resolution_x = r.resolution_y = keep[0]
    if keep[1] is not None:
        ee.taa_render_samples = keep[1]
    return n


def build_cloud(spec, meshes, mat):
    """The curls and the wisp of one cloud, as objects in the scene; returns them."""
    obs = []
    for i, (x, z, s, chir, roll, (yaw, pitch), depth) in enumerate(spec["curls"]):
        ob = bpy.data.objects.new(f"curl_{i}", meshes["curl"])
        bpy.context.scene.collection.objects.link(ob)
        ob.location = (x, depth, z)
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = curl_quat(yaw, pitch, roll)
        ob.scale = (s * chir, s, s)                  # a negative X scale turns its spiral the other way
        obs.append(ob)
    w = spec.get("wisp")
    if w:
        ob = bpy.data.objects.new("wisp", meshes["wisp"])
        bpy.context.scene.collection.objects.link(ob)
        # the ribbon lies on the unit circle in its local XY plane, from angle 0 (thin) round to its curl; stood up
        # facing the visitor (local Y -> up, local Z -> towards the visitor) and turned so it starts at the bottom of
        # its circle, heading out sideways (mirrored for cw)
        r = w["r"]
        spin = 90.0 if w["cw"] else -90.0             # seen from the front the start sits at 270 deg either way
        q = Quaternion((1, 0, 0), math.radians(90 + w["tilt"])) @ Quaternion((0, 0, 1), math.radians(spin))
        ob.rotation_mode = "QUATERNION"
        ob.rotation_quaternion = q
        ob.scale = (-r if w["cw"] else r, r, r)
        ob.location = (w["start"][0], w["depth"], w["start"][1] + r)   # the circle's centre is r above the start
        obs.append(ob)
    for ob in obs:
        if not ob.data.materials:
            ob.data.materials.append(mat)
    return obs


def frame_camera(cam, obs, yaw=-28.0, pitch=12.0):
    """A front three-quarter view (the camera to the visitor's left of centre and a little above) fitted to the
    cloud's bounds, with a margin."""
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for ob in obs:
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        pts.extend([(ob.matrix_world @ v.co)[:] for v in list(me.vertices)[::3]])
        ev.to_mesh_clear()
    P = np.array(pts)
    c = Vector(((P.min(0) + P.max(0)) / 2).tolist())
    rot = Euler((math.radians(90 - pitch), 0.0, math.radians(yaw)), "XYZ")
    cam.rotation_euler = rot
    fwd = rot.to_matrix() @ Vector((0, 0, -1))
    cam.location = c - fwd * 20
    R = np.array(rot.to_matrix())
    loc = (P - np.array(c)) @ R                       # camera axes: x right, y up
    span = max(np.ptp(loc[:, 0]), np.ptp(loc[:, 1]))
    cam.data.ortho_scale = span * 1.12
    cam.data.clip_start, cam.data.clip_end = 1.0, 60.0


def crop_and_save(png, out_path):
    """Crop the render to its visible pixels (plus a small margin), scale the long side to LONG_SIDE and save as
    WebP. Returns (width, height)."""
    img = bpy.data.images.load(png)
    W, H = img.size
    px = np.array(img.pixels[:], np.float32).reshape(H, W, 4)
    ys, xs = np.nonzero(px[..., 3] > 2 / 255)
    m = int(0.025 * max(W, H))
    x0, x1 = max(xs.min() - m, 0), min(xs.max() + m + 1, W)
    y0, y1 = max(ys.min() - m, 0), min(ys.max() + m + 1, H)
    crop = px[y0:y1, x0:x1].copy()
    ch, cw = crop.shape[:2]
    k = LONG_SIDE / max(cw, ch)
    tw, th = max(1, round(cw * k)), max(1, round(ch * k))
    out = bpy.data.images.new("crop", cw, ch, alpha=True)
    out.alpha_mode = "STRAIGHT"
    out.pixels.foreach_set(crop.ravel())
    out.scale(tw, th)
    sc = bpy.context.scene
    st = sc.render.image_settings
    st.file_format = "WEBP"
    st.color_mode = "RGBA"
    st.quality = QUALITY
    out.save_render(out_path, scene=sc)
    st.file_format = "PNG"
    bpy.data.images.remove(out)
    bpy.data.images.remove(img)
    return tw, th


def main():
    os.makedirs(OUT, exist_ok=True)
    sc, cam = scene_setup()
    mat = material()
    meshes = {"curl": mc.curl_bun("curl", +1), "wisp": mc.wisp("wisp", thick=0.13, r0=0.25)}
    tmp = os.path.join(tempfile.gettempdir(), "section_cloud.png")
    frames = FRAMES or os.path.join(tempfile.gettempdir(), "section_cloud_loops")
    listed = os.path.join(OUT, "clouds.json")
    # the loops already listed, kept when only the stills are rendered again
    try:
        with open(listed, encoding="utf-8") as fh:
            anims = {c["file"]: c["anim"] for c in json.load(fh) if c.get("anim")}
    except (OSError, ValueError, KeyError, TypeError):
        anims = {}
    index = []
    looped = []
    for n, spec in enumerate(CLOUDS, 1):
        name = f"cloud-{n}.webp"
        if ONLY and n not in ONLY:
            continue
        for ob in [o for o in sc.objects if o.type == "MESH"]:
            bpy.data.objects.remove(ob)
        obs = build_cloud(spec, meshes, mat)
        frame_camera(cam, obs)
        if STILLS:
            sc.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            w, h = crop_and_save(tmp, os.path.join(OUT, name))
            size = os.path.getsize(os.path.join(OUT, name))
            log(name, spec["kind"], f"{w}x{h}", f"{size / 1024:.1f} KB")
            entry = {"file": name, "width": w, "height": h, "kind": spec["kind"]}
            if name in anims:
                entry["anim"] = anims[name]
            index.append(entry)
        if LOOPS:
            count = render_loop(sc, spec, obs, os.path.join(frames, f"cloud-{n}"))
            log(name, f"loop: {count} frames at {LOOP_FPS} fps rendered")
            looped.append(n)
    if STILLS and not ONLY:
        with open(listed, "w", encoding="utf-8") as fh:
            json.dump(index, fh, indent=2)
        log("wrote", listed)
    if STILLS:
        os.remove(tmp)
    if looped and ENCODE:
        enc = os.path.join(os.path.dirname(os.path.abspath(__file__)), "encode_cloud_loops.py")
        cmd = [PYTHON, enc, frames, OUT, "--fps", str(LOOP_FPS), "--only", ",".join(map(str, looped))]
        log("encoding:", " ".join(cmd))
        if subprocess.run(cmd).returncode != 0:
            raise SystemExit(f"encode_cloud_loops.py failed; the frames are in {frames}")


if __name__ == "__main__":
    main()
