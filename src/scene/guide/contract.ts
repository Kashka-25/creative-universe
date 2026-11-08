// Typed view of contract/guide-contract.json, the agreement between the
// Blender character and the web scene.

import contract from '../../../contract/guide-contract.json';

export type ClipName = 'seated_idle' | 'wake' | 'acknowledge' | 'beckon' | 'rise' | 'fly';

export interface ClipSpec { name: ClipName; loop: boolean; seconds: number; beat: string }

export const guideContract = contract as unknown as {
  version: number;
  asset: { publicPath: string; maxBytes: number; fps: number; seatedHeadHeight: number };
  bones: { required: string[]; optional: string[]; parents: Record<string, string> };
  morphs: { required: string[]; optional: string[] };
  materials: { optional: Record<string, string> };
  clips: ClipSpec[];
};

export const clipSpec = (name: ClipName) => guideContract.clips.find((c) => c.name === name)!;
export const BONES = guideContract.bones;
