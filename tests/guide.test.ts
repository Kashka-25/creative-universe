import { describe, expect, it } from 'vitest';
import { Group, Quaternion, type Object3D, type QuaternionKeyframeTrack } from 'three';
import { BONES, guideContract } from '../src/scene/guide/contract';
import { REST } from '../src/scene/guide/rest';
import { buildProceduralClips } from '../src/scene/guide/proceduralClips';
import { GuideAnimator } from '../src/scene/guide/GuideAnimator';

function rig() {
  const bones: Record<string, Object3D> = {};
  for (const name of [...BONES.required, ...BONES.optional]) {
    const g = new Group();
    g.name = name;
    g.position.set(...(REST[name] ?? [0, 0, 0]));
    g.userData.rest = g.position.clone();
    bones[name] = g;
  }
  for (const [name, node] of Object.entries(bones)) {
    const parent = BONES.parents[name];
    if (parent) bones[parent].add(node);
  }
  const root = new Group();
  root.add(bones.root);
  return { root, bones };
}

const quatAt = (track: QuaternionKeyframeTrack, i: number) => new Quaternion().fromArray(track.values as unknown as number[], i * 4);

describe('guide clips', () => {
  const { bones } = rig();
  const clips = buildProceduralClips(bones);
  const names = clips.map((c) => c.name);

  it('authors every clip, optional clip and gesture in the contract', () => {
    for (const c of [...guideContract.clips, ...guideContract.optionalClips, ...guideContract.gestures]) {
      if (c.name === 'land') continue; // optional: rise plays in reverse
      expect(names, c.name).toContain(c.name);
    }
  });

  it('starts and ends every gesture on the same pose, so it layers cleanly', () => {
    for (const g of guideContract.gestures) {
      const clip = clips.find((c) => c.name === g.name)!;
      for (const t of clip.tracks.filter((t) => t.name.endsWith('.quaternion')) as QuaternionKeyframeTrack[]) {
        const first = quatAt(t, 0), last = quatAt(t, t.times.length - 1);
        expect(first.angleTo(last), `${g.name} ${t.name}`).toBeLessThan(0.02);
      }
    }
  });

  it('loops looping clips seamlessly', () => {
    for (const c of [...guideContract.clips, ...guideContract.optionalClips].filter((c) => c.loop)) {
      const clip = clips.find((x) => x.name === c.name);
      if (!clip) continue;
      for (const t of clip.tracks.filter((t) => t.name.endsWith('.quaternion')) as QuaternionKeyframeTrack[]) {
        expect(quatAt(t, 0).angleTo(quatAt(t, t.times.length - 1)), `${c.name} ${t.name}`).toBeLessThan(0.02);
      }
    }
  });
});

describe('GuideAnimator gestures', () => {
  it('layers a wave over the idle and hands back to it', () => {
    const { root, bones } = rig();
    const animator = new GuideAnimator(root, buildProceduralClips(bones));
    const ctx = { lookTarget: null, lookWeight: 0, glow: 0 };
    animator.play('stand_idle', { fade: 0 });
    animator.update(0.01, ctx);
    const legBefore = bones.thigh_L.quaternion.clone();
    expect(animator.gesture('wave')).toBe(true);
    expect(animator.gesture('not-a-gesture')).toBe(false);

    const idleOnly = (() => {
      const r = rig();
      const a = new GuideAnimator(r.root, buildProceduralClips(r.bones));
      a.play('stand_idle', { fade: 0 });
      a.update(0.01, ctx);
      a.update(0.6, ctx);
      return r.bones.upperarm_R.quaternion.clone();
    })();
    animator.update(0.6, ctx);
    // mid-wave the right arm is raised well away from where the idle holds it
    expect(bones.upperarm_R.quaternion.angleTo(idleOnly)).toBeGreaterThan(0.8);
    // gestures never move the legs
    expect(bones.thigh_L.quaternion.angleTo(legBefore)).toBeLessThan(0.05);

    for (let i = 0; i < 30; i++) animator.update(0.1, ctx);
    // after the gesture he is back to the idle pose
    const r = rig();
    const ref = new GuideAnimator(r.root, buildProceduralClips(r.bones));
    ref.play('stand_idle', { fade: 0 });
    ref.update(0.01, ctx);
    for (let i = 0; i < 6; i++) ref.update(0.1, ctx);
    for (let i = 0; i < 30; i++) ref.update(0.1, ctx);
    expect(bones.upperarm_R.quaternion.angleTo(r.bones.upperarm_R.quaternion)).toBeLessThan(0.05);
  });

  it('loops the standing and walking clips', () => {
    const { root, bones } = rig();
    const animator = new GuideAnimator(root, buildProceduralClips(bones));
    let finished = false;
    animator.onFinished(() => { finished = true; });
    animator.play('walk', { fade: 0 });
    for (let i = 0; i < 40; i++) animator.update(0.1, { lookTarget: null, lookWeight: 0, glow: 0 });
    expect(finished).toBe(false);
    expect(animator.playing).toBe('walk');
  });
});
