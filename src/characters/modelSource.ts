// A page's own way of loading its Blender models: a GLTF loader with its own manager and its own
// downloads, so the page can stop exactly its loads and free exactly what they made (and never
// anyone else's). Only the 3D chunks import this (it pulls in three and its GLTF loader).
//
// - Loader and meshopt decoder are three's own addons (three is a declared dependency).
// - The file is fetched here, with an AbortController this module owns, then parsed: stopping
//   works on every browser (three's own abort needs AbortSignal.any(), missing before Safari 17.4).
// - A load that finishes after it was stopped (it was already parsing) is freed, never delivered.
// - R3F keeps one loader per class and caches results per class and URL; each source makes its own
//   class, and release() clears that cache too (through `clearCache`, R3F's useLoader.clear), so a
//   later visit loads afresh.

import { LoaderUtils, LoadingManager, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { disposeTree } from './sceneUtils';

export interface ModelSource {
  /** The loader class to hand to R3F's useLoader. */
  readonly Loader: new () => GLTFLoader;
  /** Stops every download in flight; a parse already under way is freed when it ends. */
  abort(): void;
  /** Stops, and frees everything this source loaded (GPU side and R3F's cache): nothing stays in memory. */
  release(urls: string | string[]): void;
}

const aborted = () => new DOMException('The model load was stopped', 'AbortError');

/** Forgets cached results for these URLs (R3F's useLoader.clear). */
export type ClearCache = (Loader: new () => GLTFLoader, urls: string[]) => void;

export interface ModelSourceOptions {
  /**
   * While this is true, bytes that have arrived wait (one animation frame at a time) before they
   * are parsed: parsing (meshopt decode, building the scene) is main-thread work that must not land
   * in the middle of something on screen.
   */
  hold?: () => boolean;
}

const nextFrame = () => new Promise<void>((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 16);
});

export function createModelSource(clearCache: ClearCache = () => undefined, opts: ModelSourceOptions = {}): ModelSource {
  const manager = new LoadingManager();
  let controller = new AbortController();
  const loaded = new Set<Object3D>();

  class Loader extends GLTFLoader {
    constructor() {
      super(manager);
      this.setMeshoptDecoder(MeshoptDecoder);
    }

    override load(url: string, onLoad: (gltf: GLTF) => void, _onProgress?: (event: ProgressEvent) => void, onError?: (err: unknown) => void) {
      const signal = controller.signal;
      const resolved = manager.resolveURL(url);
      manager.itemStart(resolved);
      const fail = (e: unknown) => {
        if (onError) onError(e); else console.error(e);
        manager.itemError(resolved);
        manager.itemEnd(resolved);
      };
      fetch(resolved, { signal, credentials: this.withCredentials ? 'include' : 'same-origin' })
        .then((res) => {
          if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
          return res.arrayBuffer();
        })
        .then(async (buffer) => {
          while (!signal.aborted && opts.hold?.()) await nextFrame();
          if (signal.aborted) throw aborted();
          this.parse(buffer, LoaderUtils.extractUrlBase(resolved), (gltf) => {
            if (signal.aborted) { disposeTree(gltf.scene); fail(aborted()); return; }
            loaded.add(gltf.scene);
            onLoad(gltf);
            manager.itemEnd(resolved);
          }, fail);
        })
        .catch(fail);
    }
  }

  const abort = () => {
    controller.abort();
    manager.abort();                       // the textures inside a GLB, where the browser can stop them
    controller = new AbortController();    // the next load starts afresh
  };

  return {
    Loader,
    abort,
    release(urls) {
      abort();
      for (const root of loaded) disposeTree(root);
      loaded.clear();
      clearCache(Loader, Array.isArray(urls) ? urls : [urls]);
    },
  };
}
