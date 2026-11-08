#!/usr/bin/env node
// Writes a crude, contract-complete GLB (boxes on a skeleton) for testing the
// Blender -> web pipeline without Blender: check, optimise, register, load.
// It is a test fixture, not art.
//
//   node scripts/make-test-guide.mjs [out.glb]      default: public/models/test-guide.glb

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(readFileSync(join(ROOT, 'contract/guide-contract.json'), 'utf8'));
const out = process.argv[2] ?? join(ROOT, 'public/models/test-guide.glb');

// Same proportions as the stand-in (src/scene/guide/proceduralGuide.ts), glTF is +Y up like three.js.
const REST = {
  root: [0, 0, 0], hips: [0, 0.56, 0], spine: [0, 0.09, 0], chest: [0, 0.16, 0], neck: [0, 0.15, 0], head: [0, 0.04, 0],
  eye_L: [0.066, 0.2, 0.19], eye_R: [-0.066, 0.2, 0.19], beanie: [0, 0.22, -0.03], jaw: [0, 0.08, 0.12],
  brow_L: [0.066, 0.25, 0.19], brow_R: [-0.066, 0.25, 0.19], ear_L: [0.21, 0.18, 0], ear_R: [-0.21, 0.18, 0],
  upperarm_L: [0.175, 0.1, 0], forearm_L: [0, -0.2, 0], hand_L: [0, -0.19, 0], fingers_L: [0, -0.07, 0], thumb_L: [0, -0.03, 0.035],
  upperarm_R: [-0.175, 0.1, 0], forearm_R: [0, -0.2, 0], hand_R: [0, -0.19, 0], fingers_R: [0, -0.07, 0], thumb_R: [0, -0.03, 0.035],
  thigh_L: [0.1, -0.03, 0], shin_L: [0, -0.2, 0], foot_L: [0, -0.17, 0],
  thigh_R: [-0.1, -0.03, 0], shin_R: [0, -0.2, 0], foot_R: [0, -0.17, 0],
};

const doc = new Document();
const buffer = doc.createBuffer();
const f32 = (type, arr) => doc.createAccessor().setType(type).setArray(new Float32Array(arr)).setBuffer(buffer);

function box(name, material, [sx, sy, sz], morphs = []) {
  const P = [];
  const I = [];
  const faces = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const [a, b, c] of faces) {
    const base = P.length / 3;
    const sign = faces.indexOf([a, b, c]) % 2 ? -1 : 1;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 0, 0];
      p[a] = u; p[b] = v; p[c] = sign;
      P.push(p[0] * sx, p[1] * sy, p[2] * sz);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', f32('VEC3', P))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(I)).setBuffer(buffer))
    .setMaterial(material);
  for (const m of morphs) {
    const delta = P.map((v, i) => (i % 3 === 1 ? -m.squash * v : 0));
    prim.addTarget(doc.createPrimitiveTarget(m.name).setAttribute('POSITION', f32('VEC3', delta)));
  }
  const mesh = doc.createMesh(name).addPrimitive(prim);
  if (morphs.length) mesh.setWeights(morphs.map(() => 0)).setExtras({ targetNames: morphs.map((m) => m.name) });
  return mesh;
}

const mat = (name, rgb, emissive) => {
  const m = doc.createMaterial(name).setBaseColorFactor([...rgb, 1]).setRoughnessFactor(0.9);
  if (emissive) m.setEmissiveFactor(emissive);
  return m;
};
const fur = mat('fur', [0.39, 0.15, 0.13]);
const face = mat('face', [1, 0.64, 0.43]);
const hat = mat('hat', [0.87, 0.27, 0.07]);
const third = mat('third_eye', [0.3, 0.7, 0.65], [0.2, 0.6, 0.55]);
const gold = mat('gold_jewellery', [0.99, 0.84, 0.23]);

const scene = doc.createScene('Scene');
const nodes = {};
const bones = [...contract.bones.required, ...contract.bones.optional];
for (const b of bones) nodes[b] = doc.createNode(b).setTranslation(REST[b] ?? [0, 0, 0]);
for (const b of bones) {
  const p = contract.bones.parents[b];
  if (p) nodes[p].addChild(nodes[b]); else scene.addChild(nodes[b]);
}
const geo = (bone, mesh, t = [0, 0, 0]) => nodes[bone].addChild(doc.createNode(`${bone}_geo`).setMesh(mesh).setTranslation(t));
geo('hips', box('pelvis', fur, [0.15, 0.1, 0.12]));
geo('chest', box('torso', fur, [0.17, 0.14, 0.13]), [0, 0.02, 0]);
geo('head', box('skull', fur, [0.19, 0.19, 0.18]), [0, 0.2, -0.03]);
geo('head', box('face', face, [0.13, 0.11, 0.05], [{ name: 'eyesClosed', squash: 0.6 }, { name: 'smile', squash: -0.2 }]), [0, 0.16, 0.16]);
geo('head', box('third_eye', third, [0.03, 0.015, 0.01]), [0, 0.28, 0.2]);
geo('beanie', box('hat', hat, [0.2, 0.08, 0.19]), [0, 0.1, 0]);
geo('ear_L', box('hoop', gold, [0.01, 0.02, 0.02]));
for (const s of ['L', 'R']) {
  geo(`upperarm_${s}`, box(`upper_${s}`, fur, [0.05, 0.09, 0.05]), [0, -0.1, 0]);
  geo(`forearm_${s}`, box(`fore_${s}`, fur, [0.045, 0.09, 0.045]), [0, -0.1, 0]);
  geo(`hand_${s}`, box(`hand_${s}`, face, [0.035, 0.05, 0.04]), [0, -0.04, 0]);
  geo(`thigh_${s}`, box(`thigh_${s}`, fur, [0.06, 0.1, 0.06]), [0, -0.1, 0]);
  geo(`shin_${s}`, box(`shin_${s}`, fur, [0.05, 0.08, 0.05]), [0, -0.08, 0]);
  geo(`foot_${s}`, box(`foot_${s}`, face, [0.05, 0.03, 0.09]), [0, -0.03, 0.05]);
}

// Minimal animations: a recognisable beat per clip, enough to see the pipeline move.
const q = (x, y, z) => { // small-angle Euler XYZ (radians) -> quaternion
  const [cx, sx] = [Math.cos(x / 2), Math.sin(x / 2)], [cy, sy] = [Math.cos(y / 2), Math.sin(y / 2)], [cz, sz] = [Math.cos(z / 2), Math.sin(z / 2)];
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
};
const seatedHips = [0, 0.255, 0];
const plan = {
  seated_idle: { hips: [[0, seatedHips], [4, seatedHips]], head: [[0, q(0.2, 0, 0)], [2, q(0.15, 0, 0)], [4, q(0.2, 0, 0)]], eyes: [[0, 1], [4, 1]] },
  wake: { hips: [[0, seatedHips], [2.6, seatedHips]], head: [[0, q(0.2, 0, 0)], [2.6, q(-0.05, 0, 0)]], eyes: [[0, 1], [1.9, 0], [2.6, 0]] },
  acknowledge: { hips: [[0, seatedHips], [1.8, seatedHips]], head: [[0, q(0, 0, 0)], [0.9, q(0.18, 0, 0.1)], [1.8, q(0, 0, 0.05)]], eyes: [[0, 0], [1.8, 0]] },
  beckon: { hips: [[0, seatedHips], [2, seatedHips]], upperarm_R: [[0, q(-1.3, 0, -0.6)], [1, q(-1.5, 0, -0.6)], [2, q(-1.3, 0, -0.6)]], eyes: [[0, 0], [2, 0]] },
  rise: { hips: [[0, seatedHips], [1.7, [0, 0.5, 0]]], hipsRot: [[0, q(0, 0, 0)], [1.7, q(1.2, 0, 0)]], eyes: [[0, 0], [1.7, 0]] },
  fly: { hips: [[0, [0, 0.5, 0]], [0.6, [0, 0.53, 0]], [1.2, [0, 0.5, 0]]], hipsRot: [[0, q(1.2, 0, 0)], [1.2, q(1.2, 0, 0)]], eyes: [[0, 0], [1.2, 0]] },
  perch_idle: { hips: [[0, seatedHips], [5, seatedHips]], head: [[0, q(0, 0, 0)], [2.5, q(0, 0.15, 0.05)], [5, q(0, 0, 0)]], eyes: [[0, 0], [5, 0]] },
};
const faceNode = nodes.head.listChildren().find((n) => n.getName() === 'head_geo' && n.getMesh()?.getName() === 'face');
for (const [name, p] of Object.entries(plan)) {
  const anim = doc.createAnimation(name);
  const channel = (node, path, keys, type) => {
    const s = doc.createAnimationSampler()
      .setInput(f32('SCALAR', keys.map(([t]) => t)))
      .setOutput(f32(type, keys.flatMap(([, v]) => (Array.isArray(v) ? v : [v]))))
      .setInterpolation('LINEAR');
    anim.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(s));
  };
  if (p.hips) channel(nodes.hips, 'translation', p.hips, 'VEC3');
  if (p.hipsRot) channel(nodes.hips, 'rotation', p.hipsRot, 'VEC4');
  if (p.head) channel(nodes.head, 'rotation', p.head, 'VEC4');
  if (p.upperarm_R) channel(nodes.upperarm_R, 'rotation', p.upperarm_R, 'VEC4');
  if (p.eyes && faceNode) channel(faceNode, 'weights', p.eyes.map(([t, v]) => [t, [v, 0]]), 'SCALAR');
}

await new NodeIO().write(out, doc);
console.log(`Wrote test guide: ${out}`);
