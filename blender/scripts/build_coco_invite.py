"""Coco's Awakening: Adult Coco's invitation take (the INVITATION page).

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup \
        --python blender/scripts/build_coco_invite.py [-- options]

    --no-optimize       write coco-invite.glb straight from Blender (no meshopt)
    --raw-copy <path>   also keep a copy of the unoptimised export (for checks)
    --no-cloud          build and export his take only (the magic cloud and its keys are left as they are)
    --no-ride           leave the ride cloud (build_ride_cloud.py) as it is

Run from the repository root. Re-runnable: it opens Adult Coco's own working file blender/characters/coco-sage.blend
(made by build_coco_sage.py) and IMMEDIATELY saves it under a new name, so that file is never written. His model,
rig and home clips stay exactly as they are: the take is a new clip on the same rig, exported on its own.

Writes
  blender/characters/invitation.blend          Adult Coco + the take, one scene, 60 fps master timeline (+ the magic
                                                cloud, stage 2)
  public/models/invitation/coco-invite.glb     his skeleton and ONE clip, "invite" (no meshes, no textures: a few
                                                kB). The site plays it on the model it already has,
                                                public/models/characters/coco-sage.glb (the same rig, so the clip
                                                binds by bone name), then hands over to that model's own 'breathe'
                                                loop at its first frame, with 'float' layered on it, as at home.
  public/models/invitation/timeline.json       fps, markers floatIn / arrive / welcome / wake / gaze / eyesClose / bow /
                                                glow and the clip "invite"
                                                (the cloud build adds its own keys)
  + the magic cloud (stage 2, blender/scripts/build_magic_cloud.py): its collection in invitation.blend,
    public/models/invitation/magic-cloud.glb and its keys in timeline.json

The take: he floats down on his swirl cloud (build_ride_cloud.py) from above the top of the window, seated in
meditation with his eyes closed (they are sculpted closed). The cloud's underside shows within a few tenths of a
second (no empty sky), he sinks gently with one slow sway from side to side, leaning softly into it and tipping
back a touch while he sinks, and the descent slows all the way into rest (no overshoot: he never sinks below his
place) and he settles at his place under the heading, then breathes and floats there. A moment after the heading he wakes ('wake'): coco-sage.glb's
own 'awaken' (coco_sage_life.py), layered by the site on his breathing: he slowly opens his eyes, looks at the visitor
('gaze'), closes them again ('eyesClose') and bows his head in honour ('bow'); the glow comes the beat's length later
than it did before.
  - The descent and the sway are smooth functions of time (zero velocity and acceleration at both ends: he
    starts from rest just above the window and comes to rest exactly at his place). The lean follows his sway and
    the small tip back follows his sinking, so both fade out with the motion.
  - It is carried by the root bone (pose_at's root channels, as his 'float' loop is), so everything moves
    as one: his cloud seat, the leg swirls, the held cloud, the sun and bolt, the swirl by his hat, and on the site
    the ride cloud, which follows that bone.
  - He breathes all the way: build_coco_sage.py's own breathe recipe, phased so that the take's last
    frame IS breathe frame 0 (pose and velocity), where the site hands over to the 'breathe' loop.
Keys on every frame (Bezier), force-sampled at 60 fps on export; then scripts/optimize-guide.mjs and
scripts/restore-clip-samples.mjs (the exact samples back, stored as smooth cubic keys).

Axes: Blender -Y faces the visitor (+Z in glTF); at rest he is exactly where coco-sage.glb has him.
"""

import json
import math
import os
import subprocess
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import build_coco_sage as sage      # noqa: E402  (his rig maths and recipes; its main() does not run on import)

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC = os.path.join(ROOT, "blender", "characters", "coco-sage.blend")
OUT_BLEND = os.path.join(ROOT, "blender", "characters", "invitation.blend")
OUT_DIR = os.path.join(ROOT, "public", "models", "invitation")
GLB = os.path.join(OUT_DIR, "coco-invite.glb")
TIMELINE = os.path.join(OUT_DIR, "timeline.json")
RIG = "coco-sage_rig"
FACE = "coco-sage_face"
FPS = 60
CLIP = "invite"

# The take (seconds, metres, degrees). Blender axes: +X his left (the viewer's right), +Z up.
ARRIVE_S = 4.5          # the descent: from rest just above the window to rest at his place
DROP = 3.9              # he starts this far above his place: the bottom of his ride cloud just above the top of
                        # the window on a laptop (1280x800) and a phone (390x844), so it shows within ~0.3 s; on a
                        # taller stage he is further up (a little later), on a squat one the site fades him in
SWAY = 0.10             # one slow sway from side to side as he sinks (sin(2 pi * remaining): the first half while
                        # he comes in, the second, to his left, as he settles), fading out with the descent
RAMP = 0.12             # share of the take spent gathering speed (0.54 s: it starts above the window)
TAIL = 2.0              # the speed fades as (1 - u) ** TAIL: a long, soft slowing into rest (zero velocity and
                        # acceleration at the end: C2 into 'breathe')
LEAN_DEG = 1.5          # lean into the sway at its fastest
TIP_DEG = 1.2           # tip back while he sinks, at his fastest (it fades with his speed)
WELCOME_AFTER = 43      # frames after he arrives: the heading's cue (the same cue as the earlier take)
WAKE_AFTER = 68         # frames after he arrives: his awakening ('awaken' on coco-sage.glb), a moment after the heading
GLOW_AFTER = 157        # frames after he arrives: the magic cloud's glow, unless "Come on in" comes first (before the
                        # awakening was added); the glow now comes this long after he arrives PLUS the beat's length


def log(*a):
    print("[invite]", *a, flush=True)


def s5(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * x * (x * (6 * x - 15) + 10)


# ── the ride, as smooth functions of u = t / ARRIVE_S ────────────────────────────────────────

_U = np.linspace(0.0, 1.0, 400001)
_G = s5(_U / RAMP) * (1 - _U) ** TAIL                         # speed: gathers off screen, fades into rest
_C = np.concatenate([[0.0], np.cumsum((_G[1:] + _G[:-1]) / 2 * np.diff(_U))])
_C /= _C[-1]


def remaining(u):
    """Share of the way still to go: 1 -> 0, zero velocity, acceleration and jerk at both ends, never below 0."""
    return 1.0 - np.interp(np.clip(u, 0.0, 1.0), _U, _C)


def ride_offsets(t):
    """sway (m, > 0: towards his left, the visitor's right) and lift (m) at t seconds (arrays welcome)."""
    r = remaining(np.asarray(t, np.float64) / ARRIVE_S)
    return SWAY * np.sin(2 * math.pi * r), DROP * r


def descent(t):
    """Root offsets (metres, degrees) at t seconds: lift, sway, lean (roll) and tip back (pitch)."""
    h = 1e-3
    sway, lift = ride_offsets(t)
    s1, l1 = ride_offsets(t + h)
    s0, l0 = ride_offsets(t - h)
    vx = (s1 - s0) / (2 * h)                                           # sideways speed (> 0: towards his left)
    vz = (l1 - l0) / (2 * h)                                           # vertical speed (< 0: sinking)
    lean = LEAN_DEG * vx / SWAY_PEAK_SPEED                            # leans into the sway (as 'float' does)
    tip = -TIP_DEG * (-vz) / DROP_PEAK_SPEED                           # tips back a touch while he sinks
    if t <= 0 or t >= ARRIVE_S:
        lean, tip = 0.0, 0.0
    return float(lift), float(sway), float(lean), float(tip)


def _peaks():
    t = np.linspace(0, ARRIVE_S, 6001)
    sw, z = ride_offsets(t)
    return float(np.abs(np.gradient(sw, t)).max()), float(np.abs(np.gradient(z, t)).max())


SWAY_PEAK_SPEED, DROP_PEAK_SPEED = _peaks()


def ride_speed(frames):
    """His sinking speed at master frames (0..1 of his fastest): his ride cloud's curls billow up and its wisp
    streams with it."""
    t = np.asarray(frames, np.float64) / FPS
    h = 1e-3
    v = (ride_offsets(t + h)[1] - ride_offsets(t - h)[1]) / (2 * h)
    return np.clip(np.abs(v) / DROP_PEAK_SPEED, 0.0, 1.0) * ((t > 0) & (t < ARRIVE_S))


def channels(f60, N):
    """Channel values (build_coco_sage.py's names) for take frame f60 (60 fps) of N."""
    f30 = f60 * 30.0 / FPS
    end30 = N * 30.0 / FPS
    out = sage.breathe_channels(np.float64(f30 - end30))         # phased: the last frame IS breathe frame 0
    lift, sway, lean, tip = descent(f60 / FPS)
    out["root.lift"] = lift * 1000.0                              # pose_at's root channels are millimetres
    out["root.sway"] = sway * 1000.0
    out["root.roll"] = lean
    out["root.pitch"] = tip
    return out


# ── build ─────────────────────────────────────────────────────────────────────────────────

def open_source():
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.open_mainfile(filepath=SRC)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)             # from here on every save goes to invitation.blend
    log("opened", SRC, "-> saved as", OUT_BLEND)
    # the home clips stay in coco-sage.blend / coco-sage.glb; this file carries the take only
    for idb in (bpy.data.objects[RIG], bpy.data.objects[FACE].data.shape_keys):
        ad = idb.animation_data
        if ad:
            for tr in list(ad.nla_tracks):
                ad.nla_tracks.remove(tr)
            ad.action = None
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.render.fps_base = 1.0


def beat_marks(N):
    """His awakening on the master timeline (coco-sage.json life.awaken, seconds): it starts WAKE_AFTER frames after
    he arrives; 'gaze' when his eyes are fully open, 'eyesClose' as they start to close, 'bow' as he bows. Returns the
    markers and the beat's length in master frames (the glow and everything after it move later by that much)."""
    A = sage.CFG["life"]["awaken"]
    o = A["open"]
    wake = N + WAKE_AFTER
    at = lambda s: wake + int(round(s * FPS))                                      # noqa: E731
    marks = {"wake": wake, "gaze": at(o["start"] + o["firstS"] + o["dipS"] + o["fullS"]),
             "eyesClose": at(A["closeAt"]), "bow": at(A["bow"][0])}
    return marks, int(round(A["seconds"] * FPS))


def build_take():
    rig = bpy.data.objects[RIG]
    face = bpy.data.objects[FACE]
    N = int(round(ARRIVE_S * FPS))
    P = sage.Poser(rig)
    info = sage.bake_clip(P, rig, face, CLIP, N, lambda f: channels(float(f), N), 0, False)
    for pb in rig.pose.bones:
        pb.matrix_basis = sage.Matrix.Identity(4)
    sc = bpy.context.scene
    beat, beat_len = beat_marks(N)
    marks = {"floatIn": 0, "arrive": N, "welcome": N + WELCOME_AFTER, **beat, "glow": N + GLOW_AFTER + beat_len}
    for m in list(sc.timeline_markers):
        sc.timeline_markers.remove(m)
    for k, v in marks.items():
        sc.timeline_markers.new(k, frame=v)
    sc.frame_start, sc.frame_end = 0, marks["glow"]
    log("take", CLIP, info["frames"], "frames;", "markers", marks)
    return N, marks


def export_take():
    os.makedirs(OUT_DIR, exist_ok=True)
    rig = bpy.data.objects[RIG]
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.context.scene.frame_set(0)
    raw = GLB.replace(".glb", ".raw.glb")
    # the same settings as coco-sage.glb's export (build_coco_sage.export), the rig alone: the clip's values are
    # the same joints' local transforms, so it binds to that model by name
    wanted = dict(filepath=raw, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
                  export_animations=True, export_animation_mode="ACTIONS", export_merge_animation="ACTION",
                  export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True,
                  export_anim_single_armature=True, export_reset_pose_bones=True, export_skins=True,
                  export_def_bones=False, export_morph=False, export_lights=False, export_cameras=False,
                  export_extras=False, export_rest_position_armature=True, export_current_frame=False,
                  export_anim_slide_to_zero=False)
    known = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in wanted.items() if k in known})
    log("exported", raw, round(os.path.getsize(raw) / 1e3, 1), "kB")
    if "--raw-copy" in ARGV:
        import shutil
        shutil.copyfile(raw, ARGV[ARGV.index("--raw-copy") + 1])
    if "--no-optimize" in ARGV:
        os.replace(raw, GLB)
        return
    for cmd in (["node", os.path.join(ROOT, "scripts", "optimize-guide.mjs"), raw, GLB],
                # the exact per-frame samples back (resample() would straighten the slow end of the descent and
                # the breath), stored as smooth cubic keys that pass within 2e-6 of every frame
                ["node", os.path.join(ROOT, "scripts", "restore-clip-samples.mjs"), raw, GLB, "--cubic", "2e-6"],
                # the living-detail bones are held at rest throughout: their channels go (only home's clips move them)
                ["node", os.path.join(ROOT, "scripts", "prune-still-channels.mjs"), GLB, "--nodes", ",".join(sage.life.SCALED)]):
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, shell=(os.name == "nt"))
        log(r.stdout.strip())
        if r.returncode != 0:
            log("not finished:", r.stderr.strip()[-400:], "-> run:", " ".join(cmd))
            return
    os.remove(raw)


def write_timeline(N, marks):
    tl = {
        "$comment": "Coco's Awakening, invitation page. Frames are on one 60 fps master timeline (frame / fps = seconds "
                    "into the take). Adult Coco's take: blender/scripts/build_coco_invite.py (the clip 'invite', played "
                    "on models/characters/coco-sage.glb; from its last frame, 'arrive', he breathes and floats with "
                    "that model's own 'breathe' and 'float'; at 'wake' the site layers that model's 'awaken' on it: he opens "
                    "his eyes, looks at the visitor ('gaze'), closes them ('eyesClose') and bows ('bow')). The magic "
                    "cloud: blender/scripts/build_magic_cloud.py.",
        "fps": FPS,
        "markers": dict(marks),
        "clips": {
            CLIP: {"file": "models/invitation/coco-invite.glb", "startFrame": 0, "endFrame": N,
                   "note": "his descent from above the window (the rig alone; it binds to coco-sage.glb by bone name). It ends on "
                           "breathe frame 0, pose and velocity, where the site hands over to 'breathe' and 'float'."},
        },
    }
    if os.path.exists(TIMELINE):                       # the cloud build's keys stay until it rewrites them
        with open(TIMELINE, encoding="utf-8") as fh:
            old = json.load(fh)
        for k in ("coverFrame", "adultBox", "cloud"):
            if k in old:
                tl[k] = old[k]
        if "transform" in old.get("clips", {}):
            tl["clips"]["transform"] = old["clips"]["transform"]
    with open(TIMELINE, "w", encoding="utf-8") as fh:
        json.dump(tl, fh, indent=2)
    log("wrote", TIMELINE)


def main():
    open_source()
    N, marks = build_take()
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True)
    export_take()
    write_timeline(N, marks)
    if "--no-cloud" not in ARGV:
        import build_magic_cloud
        build_magic_cloud.run_in_scene(OUT_BLEND, True)
    if "--no-ride" not in ARGV:
        import build_ride_cloud
        build_ride_cloud.run_in_scene(OUT_BLEND, marks["arrive"], marks["glow"], ride_speed)


if __name__ == "__main__":
    main()
