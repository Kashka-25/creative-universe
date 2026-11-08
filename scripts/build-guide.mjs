#!/usr/bin/env node
// The whole guide pipeline in one go:
//   bake clips -> build the character in Blender -> export GLB -> optimise -> check and register.
//
//   npm run guide:build
//
// Blender is found at BLENDER (env), else the usual Windows / macOS / Linux places.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.env.BLENDER,
  'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.2/blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  '/usr/bin/blender',
].filter(Boolean);
const blender = candidates.find((p) => existsSync(p));
if (!blender) {
  console.error('Blender not found. Set BLENDER to its path, e.g. BLENDER="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe".');
  process.exit(1);
}

const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm' });
run('npm', ['run', 'guide:clips']);
run(blender, ['--background', '--factory-startup', '--python', 'blender/scripts/build_guide.py']);
run(blender, ['blender/guide.blend', '--background', '--python', 'blender/scripts/export_guide.py']);
run('npm', ['run', 'optimize:guide']);
run('npm', ['run', 'check:guide', '--', '--register']);
