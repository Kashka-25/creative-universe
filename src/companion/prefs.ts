// The visitor decides how present the guide is:
//   on     he follows you, gestures, and sometimes says a word
//   quiet  he follows you and gestures, but no speech bubbles or hints
//   off    he stays put as the painting in the hero; no 3D after the intro

import { useSyncExternalStore } from 'react';

export type GuidePref = 'on' | 'quiet' | 'off';
const KEY = 'ccu:guide';

function read(): GuidePref {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'quiet' || v === 'off' ? v : 'on';
  } catch {
    return 'on';
  }
}

let current: GuidePref = typeof window === 'undefined' ? 'on' : read();
const listeners = new Set<() => void>();

export const prefs = {
  get: () => current,
  set(v: GuidePref) {
    current = v;
    try { window.localStorage.setItem(KEY, v); } catch { /* private mode: lasts this visit */ }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};

export const useGuidePref = () => useSyncExternalStore(prefs.subscribe, prefs.get, () => 'on' as GuidePref);
