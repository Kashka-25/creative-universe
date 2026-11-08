import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import { owner, realms } from '../content';
import { IntroProvider, useIntro } from '../intro/IntroProvider';
import { realmHref } from './components';
import { LeafDivider, SunEyeMark } from './ornaments';

export function Layout() {
  return (
    <IntroProvider>
      <Site />
    </IntroProvider>
  );
}

/** Every change of page starts at the top, however it was reached (link, back button, typed URL). */
function useScrollTopOnRouteChange() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo({ top: 0 }); }, [pathname]);
}

function Site() {
  const { covering, state } = useIntro();
  useScrollTopOnRouteChange();
  const entering = state === 'revealing';
  return (
    <div className={`site ${entering ? 'is-entering' : ''}`} inert={covering} aria-hidden={covering || undefined}>
      <button type="button" className="skip-link" onClick={() => document.getElementById('main')?.focus()}>
        Skip to content
      </button>
      <Header />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);

  return (
    <header className="site-header">
      <Link to="/" className="wordmark" viewTransition>
        <SunEyeMark className="wordmark__mark" />
        <span className="wordmark__name">{owner.name}</span>
      </Link>
      <button
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
          <li><NavLink to="/" end viewTransition>World</NavLink></li>
          {realms.map((r) => (
            <li key={r.id}><NavLink to={realmHref(r)} viewTransition>{r.nav}</NavLink></li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

function Footer() {
  const { replay, mode } = useIntro();
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <LeafDivider className="divider" />
      <p className="site-footer__title">Cassidy’s Creative Universe</p>
      <p className="site-footer__small">© {year} {owner.name}</p>
      {mode !== 'off' && (
        <button type="button" className="text-button" onClick={replay}>
          Replay the welcome
        </button>
      )}
    </footer>
  );
}
