// A work's one primary action ("Visit", "Try the demo", "See the vision") and
// its optional preview gallery. Both come only from content data: no link, no button.

import { actionHref, actionLabel, isSiteDemo, previewAsset, type Preview, type Work, type WorkAction } from '../content';

/** True when the url goes to another site (always, when rendered outside a browser). */
export function leavesSite(url: string) {
  try {
    return typeof window === 'undefined' || new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

/**
 * The action button. On a page a "Visit" reads "Visit <title>", as it always has;
 * elsewhere the title is spoken to screen readers only.
 */
export function ActionButton({ work, action, variant }: { work: Work; action?: WorkAction; variant: 'card' | 'page' }) {
  if (!action) return null;
  // A site-hosted demo is a separate app, so it opens in a new tab too.
  const away = isSiteDemo(action.url) || leavesSite(action.url);
  const longVisit = variant === 'page' && action.kind === 'visit';
  return (
    <a
      className={`button ${variant === 'page' ? 'button--primary' : 'button--ghost button--small'}`}
      href={actionHref(action.url)}
      data-action={action.kind}
      {...(away ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {longVisit ? `Visit ${work.title}` : actionLabel[action.kind]}
      {!longVisit && <span className="visually-hidden">{action.kind === 'visit' ? ` ${work.title}` : ` of ${work.title}`}</span>}
      {away && <> <span aria-hidden>↗</span><span className="visually-hidden"> (opens in a new tab)</span></>}
    </a>
  );
}

/** "tall" for portrait files (phone screenshots), so they keep a fixed height instead of shrinking into a wide box. */
const shape = (s: { width?: number; height?: number }) => (s.width && s.height && s.height > s.width ? 'tall' : 'wide');

/** Screenshots in a calm sideways strip (scrollable by keyboard once focused), and an optional clip. */
export function PreviewGallery({ work, preview }: { work: Work; preview?: Preview }) {
  if (!preview || (preview.images.length === 0 && !preview.clip)) return null;
  const id = `preview-${work.slug}`;
  return (
    <section className="preview" aria-labelledby={id}>
      <h2 id={id} className="work-page__label">Preview</h2>
      {preview.clip && (
        <video
          className="preview__clip"
          controls
          muted
          playsInline
          preload="none"
          poster={previewAsset(preview.clip.poster)}
          src={previewAsset(preview.clip.src)}
          width={preview.clip.width}
          height={preview.clip.height}
          data-shape={shape(preview.clip)}
          aria-label={`${work.title}: preview clip`}
        />
      )}
      {preview.images.length > 0 && (
        <div className="preview__strip" tabIndex={0} role="region" aria-label={`${work.title}: preview images. Scroll sideways to see more.`}>
          <ul>
            {preview.images.map((img) => (
              <li key={img.src} className="preview__item" data-shape={shape(img)}>
                <img
                  src={previewAsset(img.src)}
                  alt={img.alt}
                  width={img.width}
                  height={img.height}
                  style={shape(img) === 'tall' ? { aspectRatio: `${img.width} / ${img.height}` } : undefined}
                  loading="lazy"
                  decoding="async"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
