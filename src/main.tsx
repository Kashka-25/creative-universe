import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/figtree';
import './styles/tokens.css';
import './styles/base.css';
import './styles/intro.css';
import './styles/portfolio.css';
import './styles/interest.css';
import { Layout } from './portfolio/Layout';
import { AboutPage, NotFound, RealmPage, WorkPage, WorldPage } from './portfolio/pages';

// Character studio (likeness turnaround), not linked from the site.
const Turnaround = lazy(() => import('./studio/Turnaround'));

// Hash routes so the site works from any static host (GitHub Pages included) with no server rules.
const router = createHashRouter([
  { path: '/studio', element: <Suspense fallback={null}><Turnaround /></Suspense> },
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
