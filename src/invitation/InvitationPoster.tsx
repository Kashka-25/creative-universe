// Shown for the moment the invitation's code is loading: its static shell, with no 3D. The header
// (the realms are one click away), the page's main region with its heading (on screen it arrives
// with the page proper) and "Come on in", which already goes home. Escape goes home too, as on the
// page itself; leaving it for another page counts as having met the welcome.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { markIntroSeen } from '../intro/capability';
import { Header, SkipLink } from '../portfolio/Layout';
import { welcomeNavigate } from '../portfolio/transitions';
import { INVITATION_PATH, routeOf } from './entry';
import { ENTER, HEADING } from './words';

/** Which of the poster's controls had keyboard focus when the page proper replaced it (a selector). */
let posterFocus: string | null = null;

/** The control the poster had focused as it went, once (the page proper focuses its own copy). */
export function takePosterFocus(): string | null {
  const f = posterFocus;
  posterFocus = null;
  return f;
}

/** A selector for the same control in the page proper (both render the same shell). */
function describeFocus(el: Element): string | null {
  if (el.matches('.invitation__enter')) return '.invitation__enter';
  if (el.matches('.nav-toggle')) return '.site-header .nav-toggle';
  if (el.matches('.skip-link')) return '.skip-link';
  if (el.matches('#main')) return '#main';
  const href = el.getAttribute('href');
  if (el.closest('.site-header') && href !== null) return `.site-header a[href="${CSS.escape(href)}"]`;
  return null;
}

export function InvitationPoster() {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const comeIn = () => {
    markIntroSeen();   // going in counts as the welcome: a reload never brings it back
    welcomeNavigate(navigate, '/', { replace: true, state: { from: 'invitation' } });
  };
  const comeInRef = useRef(comeIn);
  comeInRef.current = comeIn;

  // Escape: home at once (an open menu closes first)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.site-nav.is-open')) return;
      comeInRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Leaving (a layout cleanup runs before the poster leaves the DOM, while a control still has
  // focus; the router has already changed the address by then). Replaced by the page proper (its
  // code has arrived): remember what had keyboard focus, so the page can put it back on its own copy
  // of that control. Gone to another page (a realm chosen from the header, Back): the visitor has met
  // the welcome (a reload of home never sends them back), and nothing is kept for a later visit.
  useLayoutEffect(() => () => {
    if (routeOf(window.location.hash) === INVITATION_PATH) {
      const active = document.activeElement;
      posterFocus = active && active !== document.body && root.current?.contains(active) ? describeFocus(active) : null;
    } else {
      posterFocus = null;
      markIntroSeen();
    }
  }, []);

  return (
    <div ref={root} className="invitation invitation--poster">
      <SkipLink />
      <Header replace crossfade />
      <main id="main" tabIndex={-1} className="invitation__main">
        <h1 className="invitation__title">{HEADING}</h1>
        <div className="invitation__stage" />
        <div className="invitation__actions">
          <button type="button" className="button button--primary invitation__enter" onClick={comeIn}>
            {ENTER}
          </button>
        </div>
      </main>
    </div>
  );
}
