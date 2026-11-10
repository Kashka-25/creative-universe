#!/usr/bin/env node
// Puts a character's exact per-frame animation samples back after optimize-guide.mjs.
//
//   node scripts/restore-clip-samples.mjs <raw.glb> <optimised.glb> [out.glb] [--only <animation>]
//
// --only restores that animation's channels and leaves every other one exactly as the optimiser made it.
// --cubic <tolerance> stores the restored channels as glTF CUBICSPLINE keys instead of one key per frame: each
// key carries the curve's own slope (from the per-frame samples), and keys are left out only where the cubic
// between their neighbours still passes within <tolerance> of every frame's sample. The curve stays smooth (C1,
// no kinks at kept keys, unlike resample()'s straight segments) and a slow, long loop stays small.
//
// optimize-guide.mjs runs resample({ tolerance: 1e-4 }), which drops a key whenever it lies on the line
// between its neighbours. That test is local, so on slow, subtle motion (a breath that moves 4 mm over
// two seconds) almost every key passes it and the curve collapses to a few straight segments: a smooth
// breath turns into a triangle wave with a kink at every kept key. This script keeps everything else the
// optimiser did (meshopt geometry, quantised attributes, WebP textures) and copies each animation
// channel's sampler from the raw Blender export (sampled on every frame), matched by animation name,
// target node name and path, then re-encodes with meshopt's lossless mode.
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? args.splice(onlyAt, 2)[1] : null;
const cubicAt = args.indexOf('--cubic');
const cubicTol = cubicAt >= 0 ? Number(args.splice(cubicAt, 2)[1]) : null;

/** Per-frame samples -> sparse CUBICSPLINE keys (see the top). Returns null if it would not be smaller. */
function toCubic(t, samples, nc, tol, isRotation) {
  const n = t.length;
  if (n < 4) return null;
  const y = Float64Array.from(samples);
  // a rotation's samples may change sign from one frame to the next (the same rotation; Blender's exporter does
  // this and slerp does not mind), but a cubic through them would swing through zero: keep them on one side
  if (isRotation) for (let k = 1; k < n; k++) {
    let dot = 0;
    for (let c = 0; c < nc; c++) dot += y[k * nc + c] * y[(k - 1) * nc + c];
    if (dot < 0) for (let c = 0; c < nc; c++) y[k * nc + c] = -y[k * nc + c];
  }
  const d = new Float64Array(n * nc);
  for (let k = 0; k < n; k++) for (let c = 0; c < nc; c++) {
    const v = (i) => y[i * nc + c];
    let s;
    if (k === 0) s = (-3 * v(0) + 4 * v(1) - v(2)) / (t[2] - t[0]);
    else if (k === n - 1) s = (3 * v(n - 1) - 4 * v(n - 2) + v(n - 3)) / (t[n - 1] - t[n - 3]);
    else s = (v(k + 1) - v(k - 1)) / (t[k + 1] - t[k - 1]);
    d[k * nc + c] = s;
  }
  // a loop (its last sample is its first): the slope at both ends is the one across the seam
  let gap = 0, flip = 0;
  for (let c = 0; c < nc; c++) { gap = Math.max(gap, Math.abs(y[(n - 1) * nc + c] - y[c])); flip = Math.max(flip, Math.abs(y[(n - 1) * nc + c] + y[c])); }
  const sign = gap <= 1e-6 ? 1 : isRotation && flip <= 1e-6 ? -1 : 0;
  if (sign) for (let c = 0; c < nc; c++) {
    const s = (y[nc + c] - sign * y[(n - 2) * nc + c]) / (t[1] - t[0] + t[n - 1] - t[n - 2]);
    d[c] = s;
    d[(n - 1) * nc + c] = sign * s;
  }
  const fits = (i, j) => {
    const h = t[j] - t[i];
    for (let m = i + 1; m < j; m++) {
      const u = (t[m] - t[i]) / h, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      for (let c = 0; c < nc; c++) {
        const p = h00 * y[i * nc + c] + h10 * h * d[i * nc + c] + h01 * y[j * nc + c] + h11 * h * d[j * nc + c];
        if (Math.abs(p - y[m * nc + c]) > tol) return false;
      }
    }
    return true;
  };
  const keep = [0];
  let i = 0;
  while (i < n - 1) {
    let j = i + 1;
    while (j + 1 < n && fits(i, j + 1)) j++;
    keep.push(j);
    i = j;
  }
  if (keep.length * 3 >= n) return null;
  const input = new Float32Array(keep.map((k) => t[k]));
  const output = new Float32Array(keep.length * 3 * nc);
  keep.forEach((k, q) => {
    for (let c = 0; c < nc; c++) {
      output[(q * 3) * nc + c] = d[k * nc + c];
      output[(q * 3 + 1) * nc + c] = y[k * nc + c];
      output[(q * 3 + 2) * nc + c] = d[k * nc + c];
    }
  });
  return { input, output };
}
const [rawPath, optPath, outPath = optPath] = args;
if (!rawPath || !optPath) {
  console.error('usage: node scripts/restore-clip-samples.mjs <raw.glb> <optimised.glb> [out.glb] [--only <animation>] [--cubic <tolerance>]');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const raw = await io.read(rawPath);
const doc = await io.read(optPath);
const buffer = doc.getRoot().listBuffers()[0];
const key = (anim, ch) => `${anim.getName()}|${ch.getTargetNode()?.getName()}|${ch.getTargetPath()}`;
const source = new Map();
for (const a of raw.getRoot().listAnimations()) for (const ch of a.listChannels()) source.set(key(a, ch), ch.getSampler());

let restored = 0, missing = 0;
for (const a of doc.getRoot().listAnimations()) {
  if (only && a.getName() !== only) continue;
  for (const ch of a.listChannels()) {
    const src = source.get(key(a, ch));
    const s = ch.getSampler();
    if (!src) { missing++; continue; }
    // every channel, constant ones too: the optimiser's lossy filters also nudge constant values
    const out = src.getOutput();
    const cubic = cubicTol !== null && src.getInterpolation() === 'LINEAR'
      ? toCubic(src.getInput().getArray(), out.getArray(), out.getElementSize(), cubicTol, ch.getTargetPath() === 'rotation') : null;
    const input = doc.createAccessor().setType('SCALAR').setArray(cubic ? cubic.input : new Float32Array(src.getInput().getArray())).setBuffer(buffer);
    const output = doc.createAccessor().setType(out.getType()).setArray(cubic ? cubic.output : new Float32Array(out.getArray())).setBuffer(buffer);
    s.setInput(input).setOutput(output).setInterpolation(cubic ? 'CUBICSPLINE' : src.getInterpolation());
    restored++;
  }
}
await doc.transform(prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }));
// QUANTIZE, not FILTER: the geometry is already quantised by optimize-guide.mjs (so nothing more is lost),
// and FILTER's exponential filter would round the animation samples again (sub-millimetre frame-to-frame noise).
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(outPath, doc);
console.log(`Restored the exact samples of ${restored} channels${missing ? ` (${missing} not in the raw file, left as they were)` : ''}: ${outPath} ${(statSync(outPath).size / 1e6).toFixed(2)} MB`);
