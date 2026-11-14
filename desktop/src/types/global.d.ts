// src/types/global.d.ts
export {}

declare global {
  interface Window {
    stressTwin: {
      storeToken:      (token: string) => Promise<{ ok: boolean }>
      loadToken:       () => Promise<string | null>
      clearToken:      () => Promise<{ ok: boolean }>
      startMonitor:    () => Promise<{ ok: boolean; simulated?: boolean }>
      stopMonitor:     () => Promise<{ ok: boolean }>
      onBatch:         (cb: (batch: Record<string, unknown>) => void) => void
      onLiveStats:     (cb: (s: Record<string, unknown>) => void) => void
      updateTrayScore: (score: number) => void
      onDeepLink:      (cb: (url: string) => void) => void
      openExternal:    (url: string) => Promise<{ ok: boolean }>
      notify:          (title: string, body: string) => Promise<{ ok: boolean }>
      platform:        string
    }
  }

  // Vite env typing (import.meta.env.*) — see src/vite-env.d.ts, which
  // references vite/client and covers this plus CSS Modules typing.
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string
    readonly ELECTRON: string
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}
