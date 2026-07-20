import { StrictMode, lazy, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AppEntry } from './components/AppEntry.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { registerServiceWorker } from './pwa/registerServiceWorker.ts'
import { PwaStatus } from './components/PwaStatus.tsx'

registerServiceWorker()

// The one and only route split in this app: a public, read-only pamphlet
// at /:circleId/public (circleId is the same id as an editor's ?room=<id>
// — the pamphlet is just a curated public view of one room's published
// data, not a separate multi-tenant concept). No router library — this is
// the only route that will ever exist beyond the editor's existing
// ?room=<id> query-param convention, so hand-parsing one path pattern is
// simpler than a dependency. See index.html's inline script (decodes
// GitHub Pages' 404.html redirect back into a clean path before this
// runs) and public/404.html (the redirect itself — GH Pages has no
// server-side rewrites, so a fresh load of a path like this needs that
// static-hosting workaround).
const PublicPamphletRoot = lazy(() =>
  import('./pamphlet/PublicPamphletRoot.tsx').then((m) => ({ default: m.PublicPamphletRoot })),
)
const PaViewerRoot = lazy(() =>
  import('./pa/PaViewerRoot.tsx').then((m) => ({ default: m.PaViewerRoot })),
)

function readPublicCircleId(): string | null {
  const base = import.meta.env.BASE_URL
  const pathname = window.location.pathname
  const relative = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '')
  const match = /^([^/]+)\/public\/?$/.exec(relative)
  return match ? decodeURIComponent(match[1]) : null
}

function RootRoute() {
  const [, setLocationVersion] = useState(0)
  useEffect(() => {
    const update = () => setLocationVersion((version) => version + 1)
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])

  const publicCircleId = readPublicCircleId()
  const relativePath = window.location.pathname.startsWith(import.meta.env.BASE_URL)
    ? window.location.pathname.slice(import.meta.env.BASE_URL.length)
    : window.location.pathname.replace(/^\//, '')
  const isPaViewer = /^pa-viewer\/?$/.test(relativePath)
  const searchParams = new URLSearchParams(window.location.search)
  const bypassLanding = searchParams.has('room') || searchParams.get('mode') === 'screen'

  useEffect(() => {
    document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.setAttribute(
      'href',
      isPaViewer ? `${import.meta.env.BASE_URL}pa-viewer.webmanifest` : `${import.meta.env.BASE_URL}app.webmanifest`,
    )
  }, [isPaViewer])

  const returnToEntry = () => {
    window.history.pushState(null, '', import.meta.env.BASE_URL)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return isPaViewer ? (
    <Suspense fallback={null}>
      <PaViewerRoot onReturnToEntry={returnToEntry} />
    </Suspense>
  ) : publicCircleId ? (
    <Suspense fallback={null}>
      <PublicPamphletRoot circleId={publicCircleId} />
    </Suspense>
  ) : (
    <AppEntry bypassLanding={bypassLanding} />
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary title="アプリケーションエラー">
      <RootRoute />
    </ErrorBoundary>
    <PwaStatus />
  </StrictMode>,
)
