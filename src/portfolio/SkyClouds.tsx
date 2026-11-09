// A few of Coco's swirl clouds drifting behind a section. Purely decorative: hidden from assistive
// technology, never taking a click, drawn behind the section's content, and still under reduced
// motion. Coco treats each cloud as content, over the whole of its drift (negativeSpace.ts cloudRect):
// he never rides over one. No list, or a still that will not load:
// nothing is shown.
//
// They sit only in the section's empty room (its margins, out into the window's side gutters, and
// the gaps between its blocks): once the section is laid out, its content is measured and
// cloudPlacement.ts keeps every cloud clear of it, measured again whenever the section or the window
// changes size. Where there is no room, no cloud.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { asset } from '../content';
import { cloudPath, cloudSizes, placeClouds, readCloudList, type CloudFile, type CloudPlace, type Rect } from './cloudPlacement';

const LIST = 'models/clouds/clouds.json';

/**
 * What a cloud must never sit behind: text, headings, images, media, controls, cards, ornaments,
 * Coco's own space in the hero, and anything else holding text of its own (see ownText).
 */
const CONTENT = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'dt', 'dd', 'blockquote', 'pre', 'table', 'figure',
  'img', 'picture', 'video', 'audio', 'iframe', 'canvas', 'svg', 'a', 'button', 'input', 'select', 'textarea',
  '.work-card', '.realm-card', '.chip', '.medallion', '[data-guide-obstacle]', '[data-guide-space]',
].map((s) => `main ${s}`).join(',');

let list: Promise<CloudFile[]> | null = null;
/** clouds.json, read once per visit (an empty list if it is missing or unreadable). */
function loadList(): Promise<CloudFile[]> {
  list ??= fetch(asset(LIST))
    .then((r) => (r.ok ? r.json() : []))
    .then(readCloudList)
    .catch(() => []);
  return list;
}
let known: CloudFile[] | null = null;

function useCloudList(): CloudFile[] {
  const [files, setFiles] = useState<CloudFile[]>(() => known ?? []);
  useEffect(() => {
    if (known) return;
    let live = true;
    loadList().then((f) => { known = f; if (live) setFiles(f); });
    return () => { live = false; };
  }, []);
  return files;
}

const ownText = (el: Element) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());

/** The layer's room (inside the window's width) and the content in it, in the layer's own px. */
function measure(layer: HTMLElement): { area: Rect; content: Rect[] } {
  const L = layer.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const area = { left: Math.max(0, -L.left), top: 0, right: Math.min(L.width, vw - L.left), bottom: L.height };
  const content: Rect[] = [];
  const main = layer.closest('main') ?? document.body;
  for (const el of main.querySelectorAll('*')) {
    if (el.closest('[data-backdrop], .visually-hidden')) continue;
    if (!el.matches(CONTENT) && !ownText(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4 || r.bottom < L.top || r.top > L.bottom || r.right < L.left || r.left > L.right) continue;
    content.push({ left: r.left - L.left, top: r.top - L.top, right: r.right - L.left, bottom: r.bottom - L.top });
  }
  return { area, content };
}

/** `seed`: the page and section ("home:realms"), so the clouds always sit in the same places. */
export function SkyClouds({ seed, count = 2 }: { seed: string; count?: number }) {
  const files = useCloudList();
  const layer = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<CloudPlace[]>([]);

  useLayoutEffect(() => {
    const el = layer.current;
    const host = el?.parentElement;
    if (!el || !host || !files.length) return;
    let raf = 0;
    let lastKey = '';
    const place = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { area, content } = measure(el);
        // the same layout, the same answer: nothing to redo
        const key = JSON.stringify([area, content]);
        if (key === lastKey) return;
        lastKey = key;
        setPlaces(placeClouds(seed, files, count, area, content, cloudSizes(window.innerWidth)));
      });
    };
    place();
    // the section's size (its content laid out, fonts and images loaded, a filter applied) or the window's
    const ro = new ResizeObserver(place);
    ro.observe(host);
    for (const child of host.children) if (child !== el) ro.observe(child);
    window.addEventListener('resize', place);
    document.fonts?.ready.then(place).catch(() => {});
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('resize', place); };
  }, [files, seed, count]);

  if (!files.length) return null;
  return (
    <div ref={layer} className="sky-clouds" data-backdrop aria-hidden>
      {places.map((p) => (
        <Cloud key={`${p.index}`} file={files[p.index]} style={{
          left: `${p.left}px`,
          top: `${p.top}px`,
          width: `${p.width}px`,
          ['--dur' as string]: `${p.duration}s`,
          ['--delay' as string]: `${p.delay}s`,
          ['--dx' as string]: `${p.dx}px`,
          ['--dy' as string]: `${p.dy}px`,
          ['--tilt' as string]: `${p.tilt}deg`,
          ['--alpha' as string]: p.alpha,
        }} />
      ))}
    </div>
  );
}

function Cloud({ file, style }: { file: CloudFile; style: CSSProperties }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'missing'>('loading');
  if (state === 'missing') return null;
  return (
    <img
      className={`sky-cloud${state === 'loaded' ? ' is-loaded' : ''}`}
      src={asset(cloudPath(file.file))}
      width={file.width}
      height={file.height}
      alt=""
      loading="lazy"
      decoding="async"
      style={style}
      onLoad={() => setState('loaded')}
      onError={() => setState('missing')}
    />
  );
}
