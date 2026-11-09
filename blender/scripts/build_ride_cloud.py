"""Coco's ride cloud: the fluffy swirl cloud Adult Coco rides on (the welcome screen and every page).

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup \
        --python blender/scripts/build_coco_invite.py

Run through build_coco_invite.py (it calls run_in_scene after his take and the magic cloud, because the ride
follows his take and merges into the magic cloud). Re-runnable: the "ride_cloud" collection and its actions are
removed first; nothing else in invitation.blend is touched.

Writes
  blender/characters/invitation.blend        + collection "ride_cloud" (its root follows his rig's 'root' bone
                                               through a Child Of constraint, so the scene shows him riding it)
  public/models/clouds/ride-cloud.glb        the cloud, at rest under Adult Coco's seat (the same frame as his
                                               model, glTF axes), and three clips:
      ride    the welcome, on the 60 fps master timeline (frame 0 = 'floatIn'): it carries him in from stage left
              (its curls trail a touch and its wisp streams out while he travels, and both ease home as he
              settles), idles while he breathes, then from 'glow' brightens with the magic cloud, swells and
              rises into the base of the magic cloud while it engulfs him, and thins away inside it before he is
              hidden (it becomes part of the magic cloud: no pop)
      rest    a seamless 20 s loop: the cloud idling under him while he rests on a page
      flyin   2.0 s: the path of his flight to a new empty space on a page, as control values the site applies to
              the straight line from where he starts to his space (ctl_progress 0 -> 1, ctl_lift, ctl_bank), and
              a soft shimmer as he lands (ctl_glow). Its last frame IS rest frame 0 (pose and velocity), where the
              site hands over to 'rest'.
  public/models/invitation/timeline.json     + clips.ride

The look is the magic cloud's own (build_magic_cloud.py): its carved curl buns, its wisp and its colour ramp, as
used by the section clouds (render_section_clouds.py). Glow, opacity and the flight's path travel as the X scale of
the control empties (three r187 cannot play material animation), offset by FLOOR so they are never 0.

The cloud follows him by his root bone on the site (the code copies the bone's movement onto the cloud), so his
travel in the welcome is his own take (build_coco_invite.py) and his float on pages is his own 'float': both carry
the cloud. Its own clips only animate the cloud itself: the swirl (each curl turns slowly about its face, half of
them one way and half the other), a gentle bob and breath, and the wisp.
"""

import json
import math
import os
import subprocess
import sys

import bpy
import numpy as np
from mathutils import Euler, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import build_magic_cloud as mc      # noqa: E402  (its meshes, colours, eases and key_track)

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
FPS = 60
COLL = "ride_cloud"
RIG = "coco-sage_rig"
OUT = os.path.join(ROOT, "public", "models", "clouds", "ride-cloud.glb")
TIMELINE = os.path.join(ROOT, "public", "models", "invitation", "timeline.json")
FLOOR = 2.0 ** -10

# Curls (Blender axes, metres, his rest frame: +X his left = the visitor's right, -Y towards the visitor, +Z up):
# x, z, depth y, radius, chirality, roll (deg), yaw (deg), pitch (deg: tipped up so their tops show). A low,
# wide cumulus under his seat: three big curls in front, two crowning curls behind his legs that peek out at his
# sides, two small ones at the ends. His feet sit in front of it (they reach y -0.43).
CURLS = [
    (-0.05, -1.14, -0.10, 0.30, +1, 20, 0, 14),
    (-0.54, -1.09, 0.00, 0.25, -1, 140, -16, 12),
    (0.44, -1.09, 0.00, 0.25, +1, 250, 16, 12),
    (-0.31, -0.95, 0.22, 0.22, +1, 300, -8, 20),
    (0.23, -0.94, 0.24, 0.21, -1, 80, 8, 20),
    (-0.83, -1.14, 0.12, 0.17, +1, 40, -26, 10),
    (0.72, -1.14, 0.12, 0.18, -1, 200, 26, 10),
]
# The wisp tail, trailing to his right (the visitor's left: he rides in towards the visitor's right): its thin end
# tucked behind the left-hand curls, it sweeps out and rolls up into its curl (as on the section clouds).
WISP = dict(start=(-0.80, -1.26), r=0.26, tilt=12, depth=0.16)

LOOP_S = 20.0               # 'rest': one slow turn of every curl per loop
SPIN = 2 * math.pi / LOOP_S  # rad/s
BOB_M = 0.010               # each curl's own bob (m)
BREATH = 0.025              # each curl's own swell (share of its size)
REST_GLOW = 0.20            # the cloud's soft inner light at rest (x 1.6 on the site = 0.32: the section clouds')
TRAIL_M = 0.05              # how far the outer curls trail behind while he travels at his fastest (m)
STREAM = 0.45               # the wisp reaches this much further out at his fastest

FLY_S = 2.0                 # 'flyin'
FLY_RAMP = 0.28             # share of it spent gathering speed
FLY_TAIL = 2.5              # the speed fades as (1 - u) ** FLY_TAIL: a long, soft arrival
FLY_LIFT = 0.03             # he comes in this much (share of his height) above his space and settles onto it
FLY_BANK_DEG = 3.0          # he leans into the flight at its fastest (the site turns it towards his heading)
SHIMMER = 0.32              # the glow's soft swell as he lands (added to REST_GLOW)

# The merge into the magic cloud, in frames after 'glow' (build_magic_cloud.py OFFSETS: expand 28, engulf 66,
# luminous 102; he is fully hidden from luminous - 9).
MERGE = dict(glow_in=(6, 60), swell=(26, 86), thin=(64, 92), shrink=(72, 96), end=110)


def log(*a):
    print("[ride]", *a, flush=True)


def s5(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * x * (x * (6 * x - 15) + 10)


def ease_profile(ramp, tail, n=200001):
    """progress(u) 0 -> 1 on u in [0, 1]: speed s5(u / ramp) * (1 - u) ** tail, normalised. At both ends its
    velocity and acceleration are 0 (and the jerk too, for tail > 2), and it never passes 1."""
    U = np.linspace(0.0, 1.0, n)
    g = s5(U / ramp) * (1 - U) ** tail
    C = np.concatenate([[0.0], np.cumsum((g[1:] + g[:-1]) / 2 * np.diff(U))])
    C /= C[-1]
    return lambda u: np.interp(np.clip(u, 0.0, 1.0), U, C)


FLY = ease_profile(FLY_RAMP, FLY_TAIL)


# ── the curls' own life (periodic over LOOP_S, so 'rest' loops seamlessly) ──────────────────────

def curl_life(i, tau):
    """Offsets of curl i at time tau (s; any real, periodic over LOOP_S): roll (rad), dx, dz (m), swell (share)."""
    rng = np.random.default_rng(100 + i)
    ph = rng.uniform(0, 2 * math.pi, 3)
    w = 2 * math.pi / LOOP_S
    chir = CURLS[i][4]
    roll = chir * SPIN * tau
    dz = BOB_M * np.sin(w * (2 + i % 2) * tau + ph[0])
    dx = 0.5 * BOB_M * np.sin(w * (1 + i % 3) * tau + ph[1])
    sw = BREATH * np.sin(w * 3 * tau + ph[2])
    return roll, dx, dz, sw


def wisp_life(tau):
    w = 2 * math.pi / LOOP_S
    return 0.06 * np.sin(w * 2 * tau + 0.7), 0.04 * np.sin(w * 3 * tau + 2.1)     # sway (rad), reach (share)


def curl_rest_quat(x, z, y, s, chir, roll, yaw, pitch):
    return Euler((math.radians(pitch), 0.0, math.radians(yaw)), "XYZ").to_quaternion() @ Quaternion((0, 1, 0), math.radians(roll))


def tracks(tau, speed, merge=None):
    """Every object's location, rotation and scale for the times tau (array, s), the cloud's travel speed (0..1,
    the share of his fastest) and, for the welcome's end, the merge factors (dict of arrays) or None."""
    n = len(tau)
    out = {}
    for i, (x, z, y, s, chir, roll0, yaw, pitch) in enumerate(CURLS):
        roll, dx, dz, sw = curl_life(i, tau)
        q0 = curl_rest_quat(x, z, y, s, chir, roll0, yaw, pitch)
        # trailing while he travels: the outer curls lag a little behind (towards the visitor's left)
        trail = -TRAIL_M * speed * (0.4 + 0.6 * min(1.0, abs(x - (-0.05)) / 0.8))
        loc = np.stack([x + dx + trail, np.full(n, y), z + dz], 1)
        size = s * (1 + sw)
        extra_spin = np.zeros(n)
        if merge is not None:
            sw_m, th, sh = merge["swell"], merge["thin"], merge["shrink"]
            # it swells and rises into the base of the magic cloud, spreading a little, as the magic cloud's
            # swirl carries it round (it turns faster with it)
            loc[:, 0] = loc[:, 0] + (x - (-0.05)) * 0.22 * sw_m
            loc[:, 2] = loc[:, 2] + 0.16 * sw_m
            loc[:, 1] = loc[:, 1] + 0.05 * sw_m
            size = size * (1 + 0.45 * sw_m) * (1 - 0.7 * sh)
            extra_spin = chir * merge["spin"]
        rot, prev = [], None
        for k in range(n):
            q = q0 @ Quaternion((0, 1, 0), float(roll[k] + extra_spin[k]))
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            prev = q
            rot.append(tuple(q))
        scale = np.stack([size * chir, size, size], 1)
        out[f"ride_curl_{i}"] = (loc, np.array(rot), scale)
    # the wisp
    sway, reach = wisp_life(tau)
    r = WISP["r"] * (1 + reach + STREAM * speed)
    if merge is not None:
        r = r * (1 + 0.3 * merge["swell"]) * (1 - 0.8 * merge["shrink"])
    loc = np.stack([np.full(n, WISP["start"][0]) - 0.06 * speed, np.full(n, WISP["depth"]),
                    WISP["start"][1] + r], 1)
    rot, prev = [], None
    for k in range(n):
        q = (Quaternion((1, 0, 0), math.radians(90 + WISP["tilt"])) @ Quaternion((0, 0, 1), math.radians(90))
             @ Quaternion((0, 0, 1), float(sway[k])))
        if prev is not None and prev.dot(q) < 0:
            q.negate()
        prev = q
        rot.append(tuple(q))
    out["ride_wisp"] = (loc, np.array(rot), np.stack([-r, r, r], 1))
    return out


# ── the three clips ────────────────────────────────────────────────────────────────────────

def clip_ride(arrive, glow, speed_of):
    """Master frames 0 .. glow + MERGE end. speed_of(frames) -> his travel speed, 0..1 of his fastest."""
    f = np.arange(0, glow + MERGE["end"] + 1, dtype=np.float64)
    tau = (f - arrive) / FPS
    speed = speed_of(f)
    g = f - glow
    merge = {
        "swell": s5((g - MERGE["swell"][0]) / (MERGE["swell"][1] - MERGE["swell"][0])),
        "thin": s5((g - MERGE["thin"][0]) / (MERGE["thin"][1] - MERGE["thin"][0])),
        "shrink": s5((g - MERGE["shrink"][0]) / (MERGE["shrink"][1] - MERGE["shrink"][0])),
    }
    # the extra turn as the magic cloud's swirl takes it: eased in, then on (an integral of an eased rate)
    rate = 1.4 * s5((g - MERGE["swell"][0]) / 40.0)
    merge["spin"] = np.concatenate([[0.0], np.cumsum((rate[1:] + rate[:-1]) / 2 / FPS)])
    tr = tracks(tau, speed, merge)
    gi = MERGE["glow_in"]
    glow_v = REST_GLOW + 0.26 * s5((g - gi[0]) / (gi[1] - gi[0]))
    fade_v = 1.0 - merge["thin"]
    return f, tr, glow_v, fade_v, None


def clip_rest():
    n = int(round(LOOP_S * FPS))
    f = np.arange(0, n + 1, dtype=np.float64)
    tau = f / FPS
    tr = tracks(tau, np.zeros_like(tau))
    return f, tr, np.full_like(f, REST_GLOW), np.ones_like(f), None


def clip_flyin():
    n = int(round(FLY_S * FPS))
    f = np.arange(0, n + 1, dtype=np.float64)
    u = f / n
    tau = (f - n) / FPS                      # its last frame is rest frame 0
    p = FLY(u)
    h = 1e-4
    v = (FLY(u + h) - FLY(u - h)) / (2 * h)
    vpk = float(np.max((FLY(np.linspace(0, 1, 20001) + h) - FLY(np.linspace(0, 1, 20001) - h)) / (2 * h)))
    tr = tracks(tau, np.zeros_like(tau))
    lift = FLY_LIFT * (1 - p) ** 1.5         # he comes in a touch high and settles onto his space, never below it
    bank = FLY_BANK_DEG * v / vpk
    bank[0] = bank[-1] = 0.0
    glow_v = REST_GLOW + SHIMMER * mc.hump(0.58, 1.0, u)
    path = {"ctl_progress": p, "ctl_lift": lift, "ctl_bank": bank / 10.0}
    return f, tr, glow_v, np.ones_like(f), path


# ── build ──────────────────────────────────────────────────────────────────────────────────

def ramp_image():
    import tempfile
    old = bpy.data.images.get("ride_cloud_ramp")
    if old is not None:
        bpy.data.images.remove(old)
    tmp = bpy.data.images.new("ride_cloud_ramp_tmp", 256, 4, alpha=False)
    c = mc.ramp_srgb(np.linspace(0, 1, 256))
    px = np.ones((4, 256, 4), np.float32)
    px[:, :, :3] = c[None]
    tmp.pixels.foreach_set(px.ravel())
    path = os.path.join(tempfile.gettempdir(), "ride_cloud_ramp.png")
    tmp.filepath_raw = path
    tmp.file_format = "PNG"
    tmp.save()
    bpy.data.images.remove(tmp)
    img = bpy.data.images.load(path)
    img.name = "ride_cloud_ramp"
    img.colorspace_settings.name = "sRGB"
    img.pack()
    os.remove(path)
    return img


def material():
    """The magic cloud's material (its ramp as base colour and emissive map): the site sets the glow from
    ctl_glow, so at rest it glows as softly as the section clouds."""
    mat = bpy.data.materials.new("ride_cloud")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = ramp_image()
    tex.extension = "EXTEND"
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = REST_GLOW * 1.6
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.0
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def clear_previous():
    coll = bpy.data.collections.get(COLL)
    if coll:
        for ob in list(coll.all_objects):
            bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.collections.remove(coll)
    for name in ("ride", "rest", "flyin"):
        a = bpy.data.actions.get(name)
        if a:
            bpy.data.actions.remove(a)
    for me in [m for m in bpy.data.meshes if m.name.split(".")[0] in ("ride_curl", "ride_wisp")]:
        if me.users == 0:
            bpy.data.meshes.remove(me)
    for mat in [m for m in bpy.data.materials if m.name.startswith("ride_cloud")]:
        if mat.users == 0:
            bpy.data.materials.remove(mat)


CTLS = ("ctl_glow", "ctl_fade", "ctl_progress", "ctl_lift", "ctl_bank")


def build(arrive, glow, speed_of):
    sc = bpy.context.scene
    clear_previous()
    coll = bpy.data.collections.new(COLL)
    sc.collection.children.link(coll)
    mat = material()
    curl = mc.curl_bun("ride_curl", +1)
    wisp = mc.wisp("ride_wisp", thick=0.13, r0=0.25)
    for me in (curl, wisp):
        me.materials.append(mat)
    root = bpy.data.objects.new(COLL, None)
    root.empty_display_type = "PLAIN_AXES"
    coll.objects.link(root)
    obs = {}
    for i in range(len(CURLS)):
        obs[f"ride_curl_{i}"] = bpy.data.objects.new(f"ride_curl_{i}", curl)
    obs["ride_wisp"] = bpy.data.objects.new("ride_wisp", wisp)
    for name in CTLS:
        e = bpy.data.objects.new("ride_" + name, None)
        e.empty_display_type = "SPHERE"
        e.empty_display_size = 0.04
        e.location = (0.0, -0.9, -1.5)
        obs[name] = e
    for ob in obs.values():
        coll.objects.link(ob)
        ob.parent = root
        ob.rotation_mode = "QUATERNION"
        ob.animation_data_create()
    clips = {"ride": clip_ride(arrive, glow, speed_of), "rest": clip_rest(), "flyin": clip_flyin()}
    for name, (f, tr, glow_v, fade_v, path) in clips.items():
        act = bpy.data.actions.new(name)
        ctl = {"ctl_glow": glow_v, "ctl_fade": fade_v}
        ctl.update(path or {})
        for oname, ob in obs.items():
            ad = ob.animation_data
            ad.action = act
            if oname in tr:
                loc, rot, scale = tr[oname]
                mc.key_track(act, ob, f, "location", loc, periodic=(name == "rest"))
                mc.key_track(act, ob, f, "rotation_quaternion", rot, periodic=(name == "rest"))
                mc.key_track(act, ob, f, "scale", scale, periodic=(name == "rest"))
            else:
                # a control: its value (offset by FLOOR, never 0) as scale.x; every clip keys every control, so
                # a clip never inherits another's value
                v = ctl.get(oname)
                if v is None:
                    v = np.zeros_like(f)
                mc.key_track(act, ob, f, "scale", np.stack([FLOOR + v, np.ones_like(f), np.ones_like(f)], 1),
                             periodic=(name == "rest"))
        act.use_frame_range = True
        act.frame_start, act.frame_end = 0, int(f[-1])
        act.use_cyclic = name == "rest"
        log("clip", name, len(f), "frames")
    # 'ride' stays active (the scene shows the welcome); 'rest' and 'flyin' are exported from muted NLA strips
    for ob in obs.values():
        ad = ob.animation_data
        for name in ("rest", "flyin"):
            act = bpy.data.actions[name]
            tr_ = ad.nla_tracks.new()
            tr_.name = name
            st = tr_.strips.new(name, 0, act)
            st.action_slot = next(s for s in act.slots if s.name_display == ob.name)
            tr_.mute = True
        ad.action = bpy.data.actions["ride"]
        ad.action_slot = next(s for s in bpy.data.actions["ride"].slots if s.name_display == ob.name)
    # in the scene he carries it: its root follows his root bone (muted while exporting)
    con = root.constraints.new("CHILD_OF")
    con.target = bpy.data.objects[RIG]
    con.subtarget = "root"
    f0 = sc.frame_current
    sc.frame_set(arrive)                     # he is at rest here
    bpy.context.view_layer.update()
    con.inverse_matrix = (bpy.data.objects[RIG].matrix_world @ bpy.data.objects[RIG].pose.bones["root"].matrix).inverted()
    sc.frame_set(f0)
    return clips


def export():
    sc = bpy.context.scene
    coll = bpy.data.collections[COLL]
    root = bpy.data.objects[COLL]
    con = root.constraints[0]
    renamed = []
    try:
        con.mute = True
        for name in CTLS:                   # exported names: ctl_glow, ctl_fade, ...
            ob = bpy.data.objects["ride_" + name]
            ob.name = name
            renamed.append(ob)
        bpy.ops.object.select_all(action="DESELECT")
        for ob in coll.all_objects:
            ob.select_set(True)
        bpy.context.view_layer.objects.active = root
        sc.frame_set(0)
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        raw = OUT.replace(".glb", ".raw.glb")
        bpy.ops.export_scene.gltf(
            filepath=raw, export_format="GLB", use_selection=True, export_yup=True, export_apply=False,
            export_image_format="AUTO", export_extras=False, export_skins=False, export_morph=False,
            export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
            export_frame_step=1, export_optimize_animation_size=True, export_anim_slide_to_zero=True,
            export_reset_pose_bones=False, export_def_bones=False, export_leaf_bone=False)
    finally:
        for ob in renamed:
            ob.name = "ride_" + ob.name
        con.mute = False
    log("exported", raw, round(os.path.getsize(raw) / 1e3, 1), "KB")
    if "--ride-raw-copy" in ARGV:
        import shutil
        shutil.copyfile(raw, ARGV[ARGV.index("--ride-raw-copy") + 1])
    for cmd in (["node", os.path.join(ROOT, "scripts", "optimize-guide.mjs"), raw, OUT],
                ["node", os.path.join(ROOT, "scripts", "restore-clip-samples.mjs"), raw, OUT, "--cubic", "2e-6"]):
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
        log(r.stdout.strip())
        if r.returncode != 0:
            log("not finished:", r.stderr.strip()[-400:], "-> run:", " ".join(cmd))
            return
    os.remove(raw)


def write_timeline(glow):
    with open(TIMELINE, encoding="utf-8") as fh:
        tl = json.load(fh)
    tl.setdefault("clips", {})["ride"] = {
        "file": "models/clouds/ride-cloud.glb", "startFrame": 0, "endFrame": int(glow + MERGE["end"]),
        "note": "the cloud he rides in on (blender/scripts/build_ride_cloud.py): it follows his root bone, and from "
                "'glow' it swells into the magic cloud and thins away inside it before he is hidden."}
    with open(TIMELINE, "w", encoding="utf-8") as fh:
        json.dump(tl, fh, indent=2)
    log("wrote", TIMELINE)


def run_in_scene(blend, arrive, glow, speed_of, do_export=True):
    build(arrive, glow, speed_of)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    log("saved", blend)
    if do_export:
        export()
        write_timeline(glow)
