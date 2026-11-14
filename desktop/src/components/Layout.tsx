import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import { submitBatch, getCurrentScore, registerDevice } from '../api/client'
import { getOrCreateDeviceId, getDeviceName, isMonitorPaused } from '../api/deviceId'
import { loadForecast } from '../lib/loadForecast'
import s from './Layout.module.css'
import {
  LayoutDashboard, TrendingUp, History, Activity,
  Settings, ShieldCheck, WifiOff, Wifi,
} from 'lucide-react'

const NAV = [
  { id: 'dashboard', label: 'Dashboard',     Icon: LayoutDashboard },
  { id: 'insights',  label: 'Insights',       Icon: Activity },
  { id: 'forecast',  label: 'Forecast',       Icon: TrendingUp },
  { id: 'history',   label: 'History',        Icon: History },
  { id: 'settings',  label: 'Settings',       Icon: Settings },
]

// Guard so React StrictMode's double-mount doesn't attach the IPC listener twice.
let liveBound = false
let batchBound = false

export default function Layout({ children }: { children: React.ReactNode }) {
  const {
    page, setPage, user,
    currentScore, setScore, addTrend,
    monitorRunning, setMonitorRunning,
    interventionType,
  } = useAppStore()

  // Register this machine as a device once per app launch, so it shows up
  // on the multi-device dashboard alongside phones.
  useEffect(() => {
    const deviceId = getOrCreateDeviceId()
    registerDevice({ device_id: deviceId, platform: 'desktop', display_name: getDeviceName() }).catch(() => {})
  }, [])

  // Start behavioral monitor (unless the user paused it in Settings)
  useEffect(() => {
    const start = async () => {
      if (!window.stressTwin?.startMonitor) return

      // Listeners are bound once per app run (the preload bridge can't unsubscribe, and React
      // StrictMode mounts twice — without this guard every batch would be uploaded twice).
      if (!liveBound && window.stressTwin.onLiveStats) {
        liveBound = true
        // Local 5-second aggregates (counts/timings only) → live charts on Insights.
        window.stressTwin.onLiveStats((s: any) => useAppStore.getState().addSignal(s))
      }
      if (!batchBound) {
        batchBound = true
        window.stressTwin.onBatch(async (batch: any) => {
          if (batch?.simulated) return // never upload simulated numbers
          const st = useAppStore.getState()
          try {
            const res = await submitBatch({ ...batch, device_id: getOrCreateDeviceId() })
            st.setScore(res.deviation_score, res.threshold_crossed, res.intervention_type, res.model_ready)
            st.addTrend({ score: res.deviation_score, at: new Date().toISOString() })
            window.stressTwin?.updateTrayScore?.(Math.round(res.deviation_score))
            if (res.intervention_type) {
              window.stressTwin?.notify?.('StressTwin', getInterventionMessage(res.intervention_type))
            }
          } catch {}
        })
      }

      if (isMonitorPaused()) { setMonitorRunning(false); return }
      await window.stressTwin.startMonitor()
      setMonitorRunning(true)
    }
    start()
    return () => { window.stressTwin?.stopMonitor?.() }
  }, [])

  // Poll current score every 30s (fallback when no batch arrives)
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getCurrentScore()
        if (data.current) {
          setScore(data.current.deviation_score, data.current.threshold_crossed, null, true)
          data.trend?.forEach((t: any) => addTrend({ score: t.score, at: t.at }))
        }
      } catch {}
    }
    poll()
    const iv = setInterval(poll, 30000)
    return () => clearInterval(iv)
  }, [])

  // Load forecast
  useEffect(() => {
    loadForecast()
    const iv = setInterval(loadForecast, 6 * 60 * 60 * 1000) // 6h
    return () => clearInterval(iv)
  }, [])

  const scoreColor = currentScore < 50
    ? 'var(--accent)'
    : currentScore < 75
    ? 'var(--amber)'
    : 'var(--red)'

  return (
    <div className={s.shell}>
      {/* Sidebar */}
      <aside className={s.sidebar}>
        <div className={s.sbTop}>
          <div className={s.brand}>
            <img className={s.brandMark} src={`${import.meta.env.BASE_URL}logo.png`} alt="StressTwin" />
            <div>
              <div className={s.brandName}>StressTwin</div>
              <div className={s.brandSub}>Neural Monitor</div>
            </div>
          </div>

          {/* Live score mini */}
          <div className={s.scoreMini}>
            <div className={s.scoreMiniLabel}>Live Index</div>
            <div className={s.scoreMiniVal} style={{ color: scoreColor }}>
              {Math.round(currentScore)}<span className={s.scoreMiniDen}>/100</span>
            </div>
            <div className={s.scoreMiniBar}>
              <div
                className={s.scoreMiniFill}
                style={{ width: `${currentScore}%`, background: scoreColor }}
              />
            </div>
          </div>

          <nav className={s.nav}>
            <div className={s.navSection}>MONITOR</div>
            {NAV.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`${s.navItem} ${page === id ? s.active : ''}`}
                onClick={() => setPage(id)}
              >
                <Icon size={16} />
                {label}
                {id === 'settings' && interventionType && (
                  <span className={s.navBadge}>!</span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className={s.sbBottom}>
          <div className={s.monitorStatus}>
            {monitorRunning
              ? <><Wifi size={12} color="var(--accent)" /> <span style={{color:'var(--accent)'}}>Monitoring active</span></>
              : <><WifiOff size={12} color="var(--hint)" /> <span style={{color:'var(--hint)'}}>Monitor off</span></>
            }
          </div>
          <div className={s.userRow}>
            <div className={s.userAvatar}>
              {(user?.full_name?.[0] ?? user?.email?.[0] ?? 'U').toUpperCase()}
            </div>
            <div className={s.userInfo}>
              <div className={s.userName}>{user?.full_name ?? 'User'}</div>
              <div className={s.userEmail}>{user?.email}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className={s.main}>
        {children}
      </main>
    </div>
  )
}

function getInterventionMessage(type: string): string {
  const msgs: Record<string, string> = {
    breathing: 'Your stress index spiked. Try the 4-7-8 breathing exercise.',
    focus: 'Elevated focus disruption detected. Focus mode activated.',
    step_away: 'You\'ve been elevated for a while. Time for a short break.',
    prevention: 'High-stress day ahead. Consider adjusting your schedule.',
  }
  return msgs[type] ?? 'Stress elevated — take a moment.'
}
