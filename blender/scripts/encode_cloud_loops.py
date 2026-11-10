"""The section clouds' spinning loops: from the frames render_section_clouds.py renders (--loops) to animated AVIFs.

    python blender/scripts/encode_cloud_loops.py <frames dir> <out dir> [--fps 12] [--only 1,3] [--long 360]
        [--quality 50]

Run from the repository root with the system's Python (it needs Pillow 11.3 or newer, with AVIF; Blender's own
Python has no Pillow). render_section_clouds.py runs it for you after rendering the frames.

Why AVIF: every frame of a turning curl is new, and an animated WebP stores each frame whole (about 5 KB each here,
over 1 MB a loop), while an AVIF sequence is AV1 video, which carries what stays from frame to frame (about 40 KB
for 20 s). Browsers without AVIF show the still.

<frames dir>/cloud-N/f0000.png .. fNNNN.png: the loop's frames, the last one the same moment as frame 0 (one full
turn later), used only to check the seam. Each loop is cropped as its still is (render_section_clouds.py
crop_and_save: its visible pixels plus a small margin), over every frame, then widened to the still's own shape so
that it fills exactly the still's box, scaled to --long px on its long side and written as
<out dir>/cloud-N-spin.avif (with alpha, looping forever). Its entry in <out dir>/clouds.json gets
anim: {file, width, height, fps, frames}.

The seam check, printed for each loop: frame 0 against the frame one turn later (the same picture: render noise
only), and the step from the last frame back to frame 0 against the loop's other steps (no bigger), both on the
frames as written and as decoded back from the file; and the file's first frame against the still.
"""

import json
import os
import sys

import numpy as np
from PIL import Image, ImageSequence

ARGV = sys.argv[1:]
if len(ARGV) < 2:
    raise SystemExit(__doc__)
FRAMES, OUT = ARGV[0], ARGV[1]


def opt(name, default, cast=str):
    return cast(ARGV[ARGV.index(name) + 1]) if name in ARGV else default


FPS = opt("--fps", 12, int)
LONG = opt("--long", 360, int)              # px, the loop's long side (the clouds are drawn at most 230 px wide)
QUALITY = opt("--quality", 50, int)
SPEED = opt("--speed", 4, int)              # the AV1 encoder's effort: lower is slower and smaller
ONLY = [int(x) for x in opt("--only", "").split(",") if x]


def log(*a):
    print("[loops]", *a, flush=True)


def load(folder):
    names = sorted(f for f in os.listdir(folder) if f.endswith(".png"))
    return [np.asarray(Image.open(os.path.join(folder, f)).convert("RGBA")) for f in names]


def crop_box(frames, ratio):
    """As the still is cropped (from the same moment, frame 0): its visible pixels plus the still's margin, widened
    (about its centre) to the still's shape `ratio` (height / width), so the loop lies exactly over the still. May
    reach past the render: it is padded with clear pixels. Grown to take in any frame that would reach past it."""
    H, W = frames[0].shape[:2]
    ys, xs = np.nonzero(frames[0][..., 3] > 2)
    m = int(0.025 * max(W, H))
    # kept inside the render, as the still's crop is
    x0, x1, y0, y1 = max(xs.min() - m, 0), min(xs.max() + m + 1, W), max(ys.min() - m, 0), min(ys.max() + m + 1, H)
    cw, ch = x1 - x0, y1 - y0

    def widen(a0, a1, to, limit):
        a0 -= (to - (a1 - a0)) // 2
        a0 = min(max(a0, 0), max(limit - to, 0)) if to <= limit else a0
        return a0, a0 + to

    if ch / cw < ratio:
        y0, y1 = widen(y0, y1, round(cw * ratio), H)
    else:
        x0, x1 = widen(x0, x1, round(ch / ratio), W)
    seen = np.zeros((H, W), bool)
    for f in frames:
        seen |= f[..., 3] > 2
    ys, xs = np.nonzero(seen)
    out = max(x0 - xs.min(), xs.max() + 1 - x1, y0 - ys.min(), ys.max() + 1 - y1, 0)
    if out:
        log(f"  a frame reaches {out} px past the still's crop: the loop's box grows to take it in")
        x0, y0, x1, y1 = x0 - out, y0 - round(out * ratio), x1 + out, y1 + round(out * ratio)
    return x0, y0, x1, y1


def cut(frame, box, size):
    """One frame cropped to `box` (clear past the render's edges) and scaled to `size`, with premultiplied alpha
    while scaling so the soft edges keep their colour."""
    x0, y0, x1, y1 = box
    H, W = frame.shape[:2]
    canvas = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
    sx0, sy0, sx1, sy1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
    canvas[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = frame[sy0:sy1, sx0:sx1]
    return Image.fromarray(canvas, "RGBA").convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")


def premul(im):
    a = np.asarray(im.convert("RGBA"), np.float32) / 255
    return np.concatenate([a[..., :3] * a[..., 3:], a[..., 3:]], -1)


def step(a, b):
    """How different two frames look: the mean absolute difference, premultiplied, on a 0..255 scale."""
    return float(np.abs(a - b).mean() * 255)


def seam(P):
    steps = [step(P[i], P[i + 1]) for i in range(len(P) - 1)]
    return step(P[-1], P[0]), min(steps), float(np.median(steps)), max(steps)


def durations(n):
    """Per-frame durations (ms, whole numbers) adding up to exactly n / FPS seconds."""
    edges = np.round(np.arange(n + 1) * 1000 / FPS).astype(int)
    return [int(d) for d in np.diff(edges)]


def main():
    listed = os.path.join(OUT, "clouds.json")
    with open(listed, encoding="utf-8") as fh:
        clouds = json.load(fh)
    by_file = {c["file"]: c for c in clouds}
    done = 0
    for folder in sorted(os.listdir(FRAMES)):
        if not folder.startswith("cloud-"):
            continue
        if ONLY and int(folder.split("-")[1]) not in ONLY:
            continue
        still = by_file.get(f"{folder}.webp")
        if not still:
            log(folder, "has no still in clouds.json: skipped")
            continue
        frames = load(os.path.join(FRAMES, folder))
        if len(frames) < 3:
            log(folder, "has too few frames: skipped")
            continue
        loop, check = frames[:-1], frames[-1]
        box = crop_box(frames, still["height"] / still["width"])
        bw, bh = box[2] - box[0], box[3] - box[1]
        k = LONG / max(bw, bh)
        size = (max(1, round(bw * k)), max(1, round(bh * k)))
        ims = [cut(f, box, size) for f in loop]
        P = [premul(im) for im in ims]
        turn = step(premul(cut(check, box, size)), P[0])
        s_in = seam(P)
        name = f"{folder}-spin.avif"
        path = os.path.join(OUT, name)
        ims[0].save(path, "AVIF", save_all=True, append_images=ims[1:], duration=durations(len(ims)), loop=0,
                    quality=QUALITY, speed=SPEED, subsampling="4:2:0")
        kb = os.path.getsize(path) / 1024
        with Image.open(path) as av:
            D = [premul(f.copy()) for f in ImageSequence.Iterator(av)]
        s_out = seam(D)
        with Image.open(os.path.join(OUT, still["file"])) as st:
            poster = step(premul(st.convert("RGBa").resize(size, Image.LANCZOS)), D[0])
        log(f"{name}: {size[0]}x{size[1]}, {len(D)} frames at {FPS} fps ({len(D) / FPS:g} s), {kb:.1f} KB")
        log(f"  seam: frame 0 vs one turn later {turn:.3f}; last -> first step {s_in[0]:.3f} "
            f"(other steps {s_in[1]:.3f} .. {s_in[3]:.3f}, median {s_in[2]:.3f}); "
            f"decoded: last -> first {s_out[0]:.3f} (other steps {s_out[1]:.3f} .. {s_out[3]:.3f}, "
            f"median {s_out[2]:.3f}); first frame vs the still {poster:.3f}")
        still["anim"] = {"file": name, "width": size[0], "height": size[1], "fps": FPS, "frames": len(D)}
        done += 1
    with open(listed, "w", encoding="utf-8") as fh:
        json.dump(clouds, fh, indent=2)
    log(f"{done} loops written; updated {listed}")


if __name__ == "__main__":
    main()
