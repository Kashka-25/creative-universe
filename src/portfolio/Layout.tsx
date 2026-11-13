import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { owner, realms } from '../content';
import { ENQUIRE_PATH } from './EnquirePage';
import { GuideProvider, useGuide } from '../guide/GuideProvider';
import { INVITATION_PATH } from '../invitation/entry';
import { veil } from '../veil/veil';
import { realmHref } from './components';
import { LeafDivider, SunEyeMark } from './ornaments';
import { hasNavigated, pageTransitionNames, welcomeClick } from './transitions';

export function Layout() {
  return (
    <GuideProvider>
      <Site />
    </GuideProvider>
  );
}

/** Every change of page starts at the top, however it was reached (link, back button, typed URL). */
function useScrollTopOnRouteChange() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
}

/**
 * A new page takes keyboard focus (its <main>), so a screen reader announces it and Tab carries on
 * from its content instead of from <body>: after every change of page inside the site, and on
 * arriving from outside the site (the welcome's header, Back from the welcome) with focus left on
 * <body>. Never on a first load, and never while the cloud veil is up: the veil focuses the page
 * itself once it has cleared.
 */
function useFocusOnRouteChange(pathname: string, moved: boolean) {
  useEffect(() => {
    if (veil.phase !== 'idle') return;
    if (!moved) {
      const active = document.activeElement;
      if (!hasNavigated() || (active && active !== document.body)) return;
    }
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Site() {
  useScrollTopOnRouteChange();
  const { pathname } = useLocation();
  // A change of page inside the site: the new page's content and footer fade in (base.css
  // .page-enter, opacity only). No view transition here: its snapshot phase holds every frame until
  // the new page has rendered, which would freeze Coco, who stays live over the page. The page
  // the visitor arrived on does not fade (it is already the first thing they see).
  const arrivedOn = useRef(pathname);
  const moved = useRef(false);
  if (pathname !== arrivedOn.current) moved.current = true;
  useFocusOnRouteChange(pathname, moved.current);
  const enter = moved.current ? 'page-enter' : undefined;
  // named per page for the view transitions that remain (to and from the welcome, see base.css)
  const names = pageTransitionNames(pathname);
  return (
    <div className="site">
      <SkipLink />
      <Header />
      <main key={`main:${pathname}`} id="main" tabIndex={-1} className={enter} style={{ viewTransitionName: names.content }}>
        <Outlet />
      </main>
      <Footer key={`foot:${pathname}`} className={enter} transitionName={names.footer} />
    </div>
  );
}

export function SkipLink() {
  return (
    <button type="button" className="skip-link" onClick={() => document.getElementById('main')?.focus()}>
      Skip to content
    </button>
  );
}

/**
 * The wordmark and the realms. Shared with the invitation, so the realms are always one click away.
 * `replace`: its links replace the current history entry (the invitation's way out, so Back never
 * lands on a welcome that has already played). `crossfade`: its links crossfade the whole page
 * (the invitation's way out, see transitions.ts welcomeNavigate); inside the site they do not (see Site).
 */
export function Header({ replace = false, crossfade = false }: { replace?: boolean; crossfade?: boolean }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const self = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const go = (to: string) => (crossfade ? welcomeClick(navigate, to, { replace }) : undefined);
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    // Coco, the companion, tucks himself away below the window while the menu is open
    document.documentElement.setAttribute('data-menu-open', '');
    // Escape closes it and gives focus back to its button (the focused link inside it disappears)
    const close = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      const active = document.activeElement;
      if (!active || active === document.body || self.current?.contains(active)) toggle.current?.focus();
    };
    // a press anywhere outside the header means they are done with the menu: it closes (the
    // press itself still does whatever it does)
    const outside = (e: PointerEvent) => { if (!self.current?.contains(e.target as Node | null)) setOpen(false); };
    window.addEventListener('keydown', close);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      document.documentElement.removeAttribute('data-menu-open');
      window.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open]);

  // keyboard focus moving on out of the header (Tab past its last link) closes the menu too, as a
  // press outside it does: it would otherwise stay open over whatever now has focus
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    const to = e.relatedTarget as Node | null;
    if (open && to && !self.current?.contains(to)) setOpen(false);
  };

  return (
    <header className="site-header" ref={self} onBlur={onBlur}>
      <Link to="/" className="wordmark" replace={replace} onClick={go('/')}>
        <SunEyeMark className="wordmark__mark" />
        <span className="wordmark__name">{owner.name}</span>
      </Link>
      <button
        ref={toggle}
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="site-nav"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="nav-toggle__bars" aria-hidden />
        <span className="visually-hidden">{open ? 'Close menu' : 'Open menu'}</span>
      </button>
      <nav id="site-nav" className={`site-nav ${open ? 'is-open' : ''}`} aria-label="Realms">
        <ul>
          <li><NavLink to="/" end replace={replace} onClick={go('/')}>World</NavLink></li>
          {realms.map((r) => (
            <li key={r.id}><NavLink to={realmHref(r)} replace={replace} onClick={go(realmHref(r))}>{r.nav}</NavLink></li>
          ))}
          <li><NavLink to={ENQUIRE_PATH} replace={replace} onClick={go(ENQUIRE_PATH)}>Enquire</NavLink></li>
        </ul>
      </nav>
    </header>
  );
}

function Footer({ transitionName, className }: { transitionName: string; className?: string }) {
  const { mode } = useGuide();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const year = new Date().getFullYear();
  return (
    <footer className={`site-footer${className ? ` ${className}` : ''}`} style={{ viewTransitionName: transitionName }}>
      <LeafDivider className="divider" />
      <p className="site-footer__title">Cassidy’s Creative Universe</p>
      <p className="site-footer__small">© {year} {owner.name}</p>
      {mode !== 'off' && (
        // From home the welcome takes home's place in history: it ends by going home again, so a
        // pushed entry would leave two home entries (Back from home would seem to do nothing). The
        // price: Back pressed while a welcome replayed from home is playing goes to the page before
        // home (or leaves the site), not to home. From any other page Back returns there.
        // A crossfade here (transitions.ts welcomeNavigate): Coco leaves with the page (no live
        // Coco on the other side).
        <Link
          to={INVITATION_PATH}
          replace={pathname === '/'}
          state={{ replay: true }}
          className="text-button"
          onClick={welcomeClick(navigate, INVITATION_PATH, { replace: pathname === '/', state: { replay: true } })}
        >
          Replay the welcome
        </Link>
      )}
    </footer>
  );
}
