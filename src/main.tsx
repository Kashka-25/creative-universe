import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/figtree';
import './styles/tokens.css';
import './styles/base.css';
import './styles/intro.css';
import './styles/portfolio.css';
import './styles/invitation.css';
import './styles/interest.css';
import { Layout } from './portfolio/Layout';
import { noteNavigation } from './portfolio/transitions';
import { AboutPage, NotFound, RealmPage, WorkPage, WorldPage } from './portfolio/pages';
import { applyFirstEntry, INVITATION_PATH } from './invitation/entry';
import { InvitationPoster } from './invitation/InvitationPoster';
import { introAlreadySeen, introStorageAvailable, markIntroSeen } from './intro/capability';
import { CloudVeil } from './veil/CloudVeil';

/**
 * Somewhere a page could not load (its code is missing after a new deploy, or the network
 * dropped): the welcome counts as seen, so a reload never sends the visitor back to it, and
 * they go straight in.
 */
function GoHome() {
  markIntroSeen();
  return <Navigate to="/" replace />;
}
const orHome = (what: string) => (e: unknown) => {
  console.warn(`[${what}] could not load; going straight in`, e);
  return { default: GoHome };
};

// Character studio (likeness turnaround), not linked from the site.
const Turnaround = lazy(() => import('./studio/Turnaround').catch(orHome('studio')));
// The welcome: its own page, with its own 3D (three.js loads only there).
const Invitation = lazy(() => import('./invitation/InvitationPage').catch(orHome('invitation')));

// A first visit to '/' in this tab starts at the invitation (a history replace, so Back never
// bounces); deep links go straight in and count the welcome as seen. Runs once, before the router.
applyFirstEntry({ seen: introAlreadySeen, storageOk: introStorageAvailable, markSeen: markIntroSeen });

// React Router keeps (in sessionStorage) a list of the navigations made with its own view-transition
// option, and plays a view transition by itself on any later Back or Forward between those pages.
// The site never uses that option (see portfolio/transitions.ts welcomeNavigate); a list left in
// this tab by an earlier version of the site is dropped, so Back and Forward never freeze Coco.
try { window.sessionStorage.removeItem('remix-router-transitions'); } catch { /* storage blocked */ }

// Hash routes so the site works from any static host (GitHub Pages included) with no server rules.
const router = createHashRouter([
  { path: '/studio', element: <Suspense fallback={null}><Turnaround /></Suspense>, errorElement: <GoHome /> },
  { path: INVITATION_PATH, element: <Suspense fallback={<InvitationPoster />}><Invitation /></Suspense>, errorElement: <GoHome /> },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <WorldPage /> },
      { path: '/realm/:id', element: <RealmPage /> },
      { path: '/work/:slug', element: <WorkPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
// (a page arrived at by a change of page takes focus; the page first loaded does not: Layout.tsx)
router.subscribe(noteNavigation);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* the page (made inert while the cloud veil blocks it) */}
    <div id="page"><RouterProvider router={router} /></div>
    {/* the paper grain over the page (live on top through a change of page, see base.css) */}
    <div className="paper-grain" aria-hidden />
    {/* above the router: the cloud stays on screen while the page changes underneath */}
    <CloudVeil />
  </StrictMode>,
);
