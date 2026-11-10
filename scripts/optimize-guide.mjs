#!/usr/bin/env node
// Shrinks an exported guide GLB for the web: removes unused data, merges
// duplicates, resamples animation curves and applies meshopt compression
// (which three.js decodes natively, no extra download).
//
//   npm run optimize:guide                         public/models/guide.glb in place
//   npm run optimize:guide -- in.glb out.glb

import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, resample, weld, reorder, quantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [input = join(ROOT, 'public/models/guide.glb'), output = input] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const before = statSync(input).size;
const doc = await io.read(input);
await doc.transform(
  dedup(),
  prune({ keepLeaves: true, keepAttributes: false, keepExtras: true }), // keepLeaves: never drop contract bones (eyes, fingers) that carry no mesh
  weld(),
  resample({ tolerance: 1e-4 }),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizeTexcoord: 14 }), // painted textures: keep UVs precise
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
await io.write(output, doc);
const after = statSync(output).size;
console.log(`Optimised ${input}\n  ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`);
console.log('Next: npm run check:guide -- --register');
