import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

function pwaServiceWorker(): Plugin {
  return {
    name: 'live-timetable-service-worker',
    apply: 'build' as const,
    generateBundle(_options, bundle) {
      const template = readFileSync(new URL('./src/pwa/service-worker.js', import.meta.url), 'utf8')
      const initialAssets = new Set<string>()
      const visitChunk = (fileName: string) => {
        if (initialAssets.has(fileName)) return
        const output = bundle[fileName]
        if (!output || output.type !== 'chunk') return
        initialAssets.add(fileName)
        output.imports.forEach(visitChunk)
        // PublicPamphletRoot, collaboration, QR generation and the export
        // tools are lazy chunks. If they are not cached during install, an
        // already-open PWA can request yesterday's chunk after a deployment,
        // receive GitHub Pages' 404 HTML instead of JavaScript and fall into
        // the root ErrorBoundary. Cache the complete reachable chunk graph so
        // every installed build remains internally consistent.
        output.dynamicImports.forEach(visitChunk)
      }
      Object.values(bundle).forEach((output) => {
        if (output.type === 'chunk' && output.isEntry) visitChunk(output.fileName)
        if (output.type === 'asset' && output.fileName.endsWith('.css')) {
          initialAssets.add(output.fileName)
        }
      })
      const source = template
        .replace('__BUILD_VERSION__', new Date().toISOString())
        .replace('__PRECACHE_ASSETS__', JSON.stringify([...initialAssets]))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this as a project site at /live-timetable/, but
  // local dev should stay at the site root so `npm run dev` URLs don't change.
  base: command === 'build' ? '/live-timetable/' : '/',
  plugins: [react(), tailwindcss(), pwaServiceWorker()],
}))
