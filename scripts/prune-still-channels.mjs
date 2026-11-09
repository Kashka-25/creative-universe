#!/usr/bin/env node
// Drops animation channels that hold a joint still at its rest pose, where nothing needs them.
//
//   node scripts/prune-still-channels.mjs <file.glb> [out.glb] --clips a,b,c --nodes x,y,z
//
// Blender's exporter writes every joint's translation, rotation and scale (and the face's shape-key weights) into
// every clip, held still where the clip does not move them. In the clips named by --clips (additive layers: a
// channel held at rest adds nothing) every such channel goes; in every clip, so do the channels of the joints named
// by --nodes (Adult Coco's living-detail bones: only their own clips move them, and a joint no clip touches stays
// at rest). Nothing that moves is touched, nor any other joint's channels in the older clips. Each channel is one
// sampler and two accessors in the file's JSON, so a few hundred still ones are a sizeable part of it.
import { statSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const args = process.argv.slice(2);
const take = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 2)[1].split(',').filter(Boolean) : []; };
const clips = new Set(take('--clips'));
const nodes = new Set(take('--nodes'));
const [inPath, outPath = inPath] = args;
if (!inPath) {
  console.error('usage: node scripts/prune-still-channels.mjs <file.glb> [out.glb] --clips a,b --nodes x,y');
  process.exit(1);
}
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(inPath);

const TOL = 1e-6;
/** The channel holds one value throughout, and that value is the node's rest (zero weights for shape keys). */
function stillAtRest(ch) {
  const s = ch.getSampler();
  const out = s.getOutput();
  const n = out.getElementSize();
  const cubic = s.getInterpolation() === 'CUBICSPLINE';
  const v = out.getArray();
  const count = out.getCount();
  const node = ch.getTargetNode();
  const path = ch.getTargetPath();
  let rest;
  if (path === 'weights') rest = new Array(n).fill(0);
  else if (path === 'translation') rest = node.getTranslation();
  else if (path === 'rotation') rest = node.getRotation();
  else if (path === 'scale') rest = node.getScale();
  else return false;
  for (let k = 0; k < count; k++) {
    if (cubic && k % 3 !== 1) {                          // tangents: a still curve has none
      for (let c = 0; c < n; c++) if (Math.abs(v[k * n + c]) > TOL) return false;
      continue;
    }
    let same = true, flipped = path === 'rotation';
    for (let c = 0; c < n; c++) {
      if (Math.abs(v[k * n + c] - rest[c]) > TOL) same = false;
      if (Math.abs(v[k * n + c] + rest[c]) > TOL) flipped = false;   // -q is the same rotation
    }
    if (!same && !flipped) return false;
  }
  return true;
}

let dropped = 0;
for (const a of doc.getRoot().listAnimations()) {
  const all = clips.has(a.getName());
  for (const ch of a.listChannels()) {
    const name = ch.getTargetNode()?.getName() ?? '';
    if ((all || nodes.has(name)) && stillAtRest(ch)) {
      const s = ch.getSampler();
      ch.dispose();
      if (!a.listChannels().some((c) => c.getSampler() === s)) s.dispose();
      dropped++;
    }
  }
}
await doc.transform(prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }));
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(outPath, doc);
console.log(`Dropped ${dropped} still channels: ${outPath} ${(statSync(outPath).size / 1e6).toFixed(2)} MB`);
