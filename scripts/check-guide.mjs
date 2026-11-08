#!/usr/bin/env node
// Checks an exported guide GLB against contract/guide-contract.json.
//
//   npm run check:guide                       checks public/models/guide.glb
//   npm run check:guide -- path/to/file.glb   checks another file
//   npm run check:guide -- --register         on success, switches the site to the GLB
//                                             (writes public/models/manifest.json)
//   npm run check:guide -- --unregister       back to the built-in stand-in

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { validateGuide } from './lib/guide-validate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const contract = JSON.parse(readFileSync(join(ROOT, 'contract/guide-contract.json'), 'utf8'));
const manifestPath = join(ROOT, 'public/models/manifest.json');
const args = process.argv.slice(2);

if (args.includes('--unregister')) {
  writeFileSync(manifestPath, JSON.stringify({ guide: null }, null, 2) + '\n');
  console.log('Site now uses the built-in stand-in guide.');
  process.exit(0);
}

const file = args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'public', contract.asset.publicPath);
if (!existsSync(file)) {
  console.error(`No GLB at ${file}.\nExport one from Blender first (blender/README.md).`);
  process.exit(1);
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
let doc;
try {
  doc = await io.read(file);
} catch (e) {
  const msg = String(e?.message ?? e);
  console.error(`Could not read ${file}: ${msg}`);
  if (/KHR_draco/i.test(msg)) console.error('Draco is not used here: export without Draco and run npm run optimize:guide (meshopt) instead.');
  process.exit(1);
}
const root = doc.getRoot();
const found = {
  nodes: root.listNodes().map((n) => n.getName()),
  animations: root.listAnimations().map((a) => {
    let max = 0;
    for (const s of a.listSamplers()) { const arr = s.getInput()?.getArray(); if (arr?.length) max = Math.max(max, arr[arr.length - 1]); }
    return { name: a.getName(), duration: max };
  }),
  morphs: [...new Set(root.listMeshes().flatMap((m) => m.getExtras()?.targetNames ?? []))],
  materials: root.listMaterials().map((m) => m.getName()),
  bytes: statSync(file).size,
};

const { errors, warnings } = validateGuide(contract, found);
console.log(`Guide: ${relative(ROOT, file)}  ${(found.bytes / 1e6).toFixed(2)} MB`);
console.log(`  clips: ${found.animations.map((a) => `${a.name} (${a.duration.toFixed(2)}s)`).join(', ') || 'none'}`);
console.log(`  shape keys: ${found.morphs.join(', ') || 'none'}`);
for (const w of warnings) console.log(`  warning: ${w}`);
for (const e of errors) console.log(`  ERROR: ${e}`);

if (errors.length) {
  console.log(`\n${errors.length} problem(s). The site keeps using the stand-in until these are fixed.`);
  process.exit(1);
}
console.log('\nGuide matches the contract.');
if (args.includes('--register')) {
  const rel = relative(join(ROOT, 'public'), file).replace(/\\/g, '/');
  const version = createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10);
  writeFileSync(manifestPath, JSON.stringify({ guide: { src: rel, version } }, null, 2) + '\n');
  console.log(`Registered: the site now loads ${rel} (version ${version}).`);
}
