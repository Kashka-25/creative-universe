#!/usr/bin/env node
// Prepares a Blender-exported, force-sampled GLB for scripts/optimize-guide.mjs without losing slow motion.
//
//   node blender/scripts/invite_keys.mjs <in.glb> <out.glb>
//
// Why: optimize-guide.mjs runs gltf-transform's resample(), which drops a key whenever THAT key lies within
// 1e-4 of the straight line from the last kept key to the next one. On a 60 fps bake of a slow motion (a
// breath, a gentle sway) every single key passes that local test, so whole stretches collapse into one straight
// line: in the invitation take the breathing on his shoulders and belly came out flat (0.5 deg / 3 mm off).
// This step thins each linear channel first (Douglas-Peucker, a little coarser than resample's tolerance) and
// then runs the very same resample() on the result, adding keys back wherever its output would stray from the
// 60 fps bake by more than the limits below, until the optimiser keeps what we give it. Values are not changed;
// keys are only chosen, so the result is the baked motion within the limits (then meshopt quantises as usual).

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { resample } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node blender/scripts/invite_keys.mjs <in.glb> <out.glb>');
  process.exit(1);
}
const TOL = 1e-4;                                   // resample()'s tolerance in optimize-guide.mjs
const LIMIT = { translation: 2e-4, rotation: 2e-4, scale: 2e-4, weights: 3e-4 };   // allowed drift (per component)

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(input);

function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((x) => -x); d = -d; }
  if (d > 0.9995) { const r = a.map((x, i) => x + (b[i] - x) * t); const n = Math.hypot(...r); return r.map((x) => x / n); }
  const th = Math.acos(d), s = Math.sin(th);
  return a.map((x, i) => (x * Math.sin((1 - t) * th) + b[i] * Math.sin(t * th)) / s);
}
const elem = (arr, i, n) => Array.from(arr.slice(i * n, i * n + n));

/** Max per-component error of the piecewise curve through `keys` (indices into the dense bake), per dense frame. */
function errors(times, vals, n, keys, rot) {
  const err = new Float64Array(times.length);
  for (let s = 0; s + 1 < keys.length; s++) {
    const a = keys[s], b = keys[s + 1];
    const va = elem(vals, a, n), vb = elem(vals, b, n);
    for (let i = a + 1; i < b; i++) {
      const t = (times[i] - times[a]) / (times[b] - times[a]);
      const v = rot ? slerp(va, vb, t) : va.map((x, k) => x + (vb[k] - x) * t);
      const d = elem(vals, i, n);
      let sign = 1;
      if (rot && v[0] * d[0] + v[1] * d[1] + v[2] * d[2] + v[3] * d[3] < 0) sign = -1;
      err[i] = Math.max(...d.map((x, k) => Math.abs(x - sign * v[k])));
    }
  }
  return err;
}

function douglasPeucker(times, vals, n, rot, tol) {
  const keep = new Uint8Array(times.length);
  keep[0] = keep[times.length - 1] = 1;
  const stack = [[0, times.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const e = errors(times, vals, n, [a, b], rot);
    let m = a + 1;
    for (let i = a + 1; i < b; i++) if (e[i] > e[m]) m = i;
    if (e[m] > tol) { keep[m] = 1; stack.push([a, m], [m, b]); }
  }
  return [...keep.keys()].filter((i) => keep[i]);
}

/** What optimize-guide.mjs's resample() keeps of these keys (run on a throwaway document). */
async function survivors(times, vals, n, keys, path) {
  const d = new Document();
  const buf = d.createBuffer();
  const node = d.createNode('x');
  d.createScene().addChild(node);
  const tIn = new Float32Array(keys.map((k) => times[k]));
  const vOut = new Float32Array(keys.length * n);
  keys.forEach((k, j) => vOut.set(vals.slice(k * n, k * n + n), j * n));
  const inp = d.createAccessor().setType('SCALAR').setArray(tIn).setBuffer(buf);
  const out = d.createAccessor().setType(n === 4 ? 'VEC4' : n === 3 ? 'VEC3' : 'SCALAR').setArray(vOut).setBuffer(buf);
  const smp = d.createAnimationSampler().setInput(inp).setOutput(out).setInterpolation('LINEAR');
  const ch = d.createAnimationChannel().setTargetNode(node).setTargetPath(path === 'weights' ? 'weights' : path).setSampler(smp);
  d.createAnimation('a').addSampler(smp).addChannel(ch);
  await d.transform(resample({ tolerance: TOL }));
  const kept = Array.from(ch.getSampler().getInput().getArray());
  const idx = [];
  let j = 0;
  for (const k of keys) { if (j < kept.length && Math.abs(times[k] - kept[j]) < 1e-7) { idx.push(k); j++; } }
  return idx;
}

let report = [];
for (const anim of doc.getRoot().listAnimations()) {
  for (const ch of anim.listChannels()) {
    const smp = ch.getSampler();
    if (smp.getInterpolation() !== 'LINEAR') continue;
    const path = ch.getTargetPath();
    const times = Array.from(smp.getInput().getArray());
    const vals = Float32Array.from(smp.getOutput().getArray());
    const n = vals.length / times.length;
    if (times.length < 3) continue;
    const rot = path === 'rotation';
    const limit = LIMIT[path] ?? 2e-4;
    let keys = douglasPeucker(times, vals, n, rot, 1.5 * TOL);
    let kept = keys, worst = 0, rounds = 0;
    for (; rounds < 40; rounds++) {
      kept = await survivors(times, vals, n, keys, path);
      const e = errors(times, vals, n, kept, rot);
      worst = Math.max(...e);
      if (worst <= limit) break;
      // add the worst frame of every straying segment back in, then try again
      const add = new Set();
      for (let s = 0; s + 1 < kept.length; s++) {
        let m = -1;
        for (let i = kept[s] + 1; i < kept[s + 1]; i++) if (e[i] > limit && (m < 0 || e[i] > e[m])) m = i;
        if (m >= 0) add.add(m);
      }
      keys = [...new Set([...keys, ...add])].sort((a, b) => a - b);
    }
    // write the chosen keys (exactly the baked values at those frames)
    const tIn = new Float32Array(kept.map((k) => times[k]));
    const vOut = new Float32Array(kept.length * n);
    kept.forEach((k, j) => vOut.set(vals.slice(k * n, k * n + n), j * n));
    smp.setInput(smp.getInput().clone().setArray(tIn));
    smp.setOutput(smp.getOutput().clone().setArray(vOut));
    report.push({ anim: anim.getName(), channel: `${ch.getTargetNode().getName()}.${path}`, from: times.length, to: kept.length, worst: +worst.toExponential(2), rounds });
  }
}
// Blender writes each mesh's default morph weights from the shape-key values on the frame it exported from (his
// hover expression). The default is what any viewer shows without the mixer, so it goes back to the sculpt's
// neutral face: all zeros. The clips still carry every weight they animate.
let zeroed = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  const w = mesh.getWeights();
  if (w.length && w.some((x) => x !== 0)) { mesh.setWeights(w.map(() => 0)); zeroed++; }
}
if (zeroed) console.log(`invite_keys: default morph weights of ${zeroed} mesh(es) set to 0`);
await io.write(output, doc);
report.sort((a, b) => b.worst - a.worst);
console.log(`invite_keys: ${report.length} channels; worst remaining drift ${report[0]?.worst} (${report[0]?.channel}); keys ${report.reduce((s, r) => s + r.from, 0)} -> ${report.reduce((s, r) => s + r.to, 0)}`);
