export const PWA_UPDATE_EVENT = 'live-timetable:pwa-update'
let reloadForUpdate = false

export function activateWaitingWorker(worker: ServiceWorker) {
  reloadForUpdate = true
  worker.postMessage({ type: 'SKIP_WAITING' })
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        const announceWaitingWorker = () => {
          if (!registration.waiting || !navigator.serviceWorker.controller) return
          window.dispatchEvent(
            new CustomEvent(PWA_UPDATE_EVENT, { detail: registration.waiting }),
          )
        }

        announceWaitingWorker()
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing
          if (!worker) return
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed') announceWaitingWorker()
          })
        })
      })
      .catch((error) => console.error('[pwa] Service Worker registration failed', error))
  })

  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadForUpdate || refreshing) return
    refreshing = true
    window.location.reload()
  })
}
