import { useEffect, useState } from 'react'
import { activateWaitingWorker, PWA_UPDATE_EVENT } from '../pwa/registerServiceWorker'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'live-timetable-pwa-install-dismissed-at'
const RESHOW_AFTER_MS = 30 * 24 * 60 * 60 * 1000

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
  )
}

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function wasRecentlyDismissed() {
  try {
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY))
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < RESHOW_AFTER_MS
  } catch {
    return false
  }
}

export function PwaStatus() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHelp, setShowIosHelp] = useState(false)
  const [installHidden, setInstallHidden] = useState(true)
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    if (!import.meta.env.PROD || isStandalone() || wasRecentlyDismissed()) return

    if (isIos()) setInstallHidden(false)

    function handleInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallEvent(event as BeforeInstallPromptEvent)
      setInstallHidden(false)
    }

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
  }, [])

  useEffect(() => {
    function handleUpdate(event: Event) {
      setWaitingWorker((event as CustomEvent<ServiceWorker>).detail)
    }
    function handleOnline() {
      setOnline(true)
    }
    function handleOffline() {
      setOnline(false)
    }

    window.addEventListener(PWA_UPDATE_EVENT, handleUpdate)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener(PWA_UPDATE_EVENT, handleUpdate)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  async function handleInstall() {
    if (!installEvent) {
      setShowIosHelp(true)
      return
    }
    await installEvent.prompt()
    const choice = await installEvent.userChoice
    if (choice.outcome === 'accepted') setInstallHidden(true)
    setInstallEvent(null)
  }

  function dismissInstall() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      // Storage can be unavailable in private browsing; hiding still works for this session.
    }
    setInstallHidden(true)
  }

  return (
    <>
      {!online && (
        <div className="fixed left-1/2 top-2 z-[110] -translate-x-1/2 rounded-full border border-amber-500 bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-300 shadow-lg" role="status">
          オフラインで使用中
        </div>
      )}

      {waitingWorker && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-1/2 z-[100] flex w-[calc(100%-1.5rem)] max-w-sm -translate-x-1/2 items-center gap-2 rounded-xl border border-blue-500 bg-slate-900 p-3 text-sm text-slate-200 shadow-xl">
          <span className="min-w-0 flex-1">新しいバージョンがあります</span>
          <button type="button" onClick={() => activateWaitingWorker(waitingWorker)} className="min-h-11 shrink-0 rounded-lg bg-blue-700 px-3 font-semibold text-white hover:bg-blue-600">
            更新
          </button>
        </div>
      )}

      {!installHidden && !waitingWorker && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-3 z-[90] w-[calc(100%-5.5rem)] max-w-sm rounded-xl border border-slate-600 bg-slate-900 p-3 text-sm text-slate-200 shadow-xl">
          <div className="flex items-start gap-2">
            <img src={`${import.meta.env.BASE_URL}app-icon.svg`} alt="" className="h-10 w-10 shrink-0 rounded-[10px]" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-100">ホーム画面からすぐ起動</p>
              <p className="mt-0.5 text-xs text-slate-400">アプリとして追加すると全画面で使えます。</p>
            </div>
            <button type="button" onClick={dismissInstall} className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-700" aria-label="追加案内を閉じる">×</button>
          </div>
          {showIosHelp ? (
            <p className="mt-2 rounded-lg bg-slate-800 p-2 text-xs leading-relaxed text-slate-300">
              Safariの共有ボタンを押し、「ホーム画面に追加」→「Webアプリとして開く」を選択してください。
            </p>
          ) : (
            <button type="button" onClick={() => void handleInstall()} className="mt-2 min-h-11 w-full rounded-lg border border-blue-500 bg-blue-950/50 font-semibold text-blue-200 hover:bg-blue-900/60">
              アプリとして追加
            </button>
          )}
        </div>
      )}
    </>
  )
}
