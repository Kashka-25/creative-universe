// Compares what a guide GLB contains with contract/guide-contract.json.
// Pure: takes plain name lists, so it is shared by the CLI and the tests.

/** three.js strips these characters from node names (PropertyBinding.sanitizeNodeName). */
export const sanitizeName = (n) => String(n).replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');

/**
 * @param {object} contract  parsed guide-contract.json
 * @param {{ nodes: string[], animations: {name:string, duration:number}[], morphs: string[], materials: string[], bytes: number }} found
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateGuide(contract, found) {
  const errors = [];
  const warnings = [];
  const nodes = new Set(found.nodes.map(sanitizeName));
  const rawNodes = new Set(found.nodes);

  for (const bone of contract.bones.required) {
    if (!nodes.has(bone)) {
      const dotted = bone.replace(/_([LR])$/, '.$1');
      errors.push(rawNodes.has(dotted)
        ? `Bone "${dotted}" must be renamed "${bone}" (three.js drops the dot).`
        : `Missing required bone "${bone}".`);
    }
  }
  for (const bone of contract.bones.optional) if (!nodes.has(bone)) warnings.push(`Optional bone "${bone}" not found.`);

  const clips = new Map(found.animations.map((a) => [a.name, a]));
  for (const c of contract.clips) {
    const a = clips.get(c.name);
    if (!a) { errors.push(`Missing animation clip "${c.name}" (${c.beat}).`); continue; }
    const diff = Math.abs(a.duration - c.seconds);
    if (diff > Math.max(0.5, c.seconds * 0.35)) warnings.push(`Clip "${c.name}" is ${a.duration.toFixed(2)}s; the contract plans ${c.seconds}s. Fine if intended, but the camera timing assumes about ${c.seconds}s.`);
  }
  for (const c of contract.optionalClips ?? []) if (!clips.has(c.name)) warnings.push(`Optional clip "${c.name}" not found. ${c.beat}`);
  for (const g of contract.gestures ?? []) if (!clips.has(g.name)) warnings.push(`Optional gesture "${g.name}" not found. ${g.beat}`);
  const known = new Set([...contract.clips, ...(contract.optionalClips ?? []), ...(contract.gestures ?? [])].map((c) => c.name));
  for (const a of found.animations) if (!known.has(a.name)) warnings.push(`Extra clip "${a.name}" is not used by the intro.`);

  const morphs = new Set(found.morphs);
  for (const m of contract.morphs.required) if (!morphs.has(m)) errors.push(`Missing required shape key "${m}".`);
  for (const m of contract.morphs.optional) if (!morphs.has(m)) warnings.push(`Optional shape key "${m}" not found.`);

  const mats = new Set(found.materials);
  for (const m of Object.keys(contract.materials.optional)) if (!mats.has(m)) warnings.push(`Optional material "${m}" not found (${contract.materials.optional[m]})`);

  if (found.bytes > contract.asset.maxBytes) errors.push(`File is ${(found.bytes / 1e6).toFixed(1)} MB; the budget is ${(contract.asset.maxBytes / 1e6).toFixed(1)} MB. Compress it (see docs/ASSET_PIPELINE.md).`);
  return { errors, warnings };
}
