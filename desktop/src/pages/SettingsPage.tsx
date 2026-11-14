import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import {
  updateProfile, deleteAllData, authLogout,
  getCalendarAuthUrl, syncCalendar, disconnectCalendar, getProfile, renameDevice,
} from '../api/client'
import { getDeviceName, setDeviceName, getOrCreateDeviceId, isMonitorPaused, setMonitorPaused } from '../api/deviceId'
import s from './Page.module.css'

// The preload bridge can't remove listeners, so bind the deep-link handler exactly once.
let deepLinkBound = false
let onCalendarLinked: ((provider: string) => void) | null = null

export default function SettingsPage() {
  const { user, setUser, setToken, monitorRunning, setMonitorRunning } = useAppStore()
  const [devName, setDevName] = useState(getDeviceName())
  const [paused, setPaused] = useState(isMonitorPaused())
  const [threshold, setThreshold] = useState(user?.if_threshold ?? 70)
  const [fullName, setFullName]   = useState(user?.full_name ?? '')
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState('')
  const [calLoading, setCalLoading] = useState<string | null>(null)
  const [delConfirm, setDelConfirm] = useState(false)

  const timer = useRef<ReturnType<typeof setTimeout>>()
  const flash = (m: string) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(''), 3500) }

  useEffect(() => {
    onCalendarLinked = (provider) => flash(`✅ ${provider === 'google' ? 'Google' : 'Outlook'} Calendar connected`)
    if (!deepLinkBound && window.stressTwin?.onDeepLink) {
      deepLinkBound = true
      window.stressTwin.onDeepLink(async (url: string) => {
        if (!url.includes('status=connected')) return
        try { useAppStore.getState().setUser(await getProfile()) } catch {}
        const provider = url.includes('provider=outlook') ? 'outlook' : 'google'
        onCalendarLinked?.(provider)
      })
    }
    return () => { onCalendarLinked = null; clearTimeout(timer.current) }
  }, [])

  const saveDevice = async () => {
    const name = devName.trim()
    if (!name) return flash('❌ Device name can’t be empty')
    try {
      await renameDevice(getOrCreateDeviceId(), name)
      setDeviceName(name)
      flash('✅ Device name saved')
    } catch { flash('❌ Couldn’t save the device name') }
  }

  const toggleMonitor = async () => {
    const next = !paused
    setPaused(next); setMonitorPaused(next)
    try {
      if (next) { await window.stressTwin?.stopMonitor?.(); setMonitorRunning(false) }
      else { await window.stressTwin?.startMonitor?.(); setMonitorRunning(true) }
    } catch { flash('❌ Couldn’t change monitoring') }
  }

  const saveProfile = async () => {
    setSaving(true)
    try {
      const updated = await updateProfile({ full_name: fullName, if_threshold: threshold })
      setUser(updated)
      flash('✅ Settings saved')
    } catch { flash('❌ Save failed') }
    finally { setSaving(false) }
  }

  const connectCalendar = async (provider: 'google' | 'outlook') => {
    setCalLoading(provider)
    try {
      const { auth_url } = await getCalendarAuthUrl(provider)
      window.stressTwin?.openExternal(auth_url)
      flash('Finish signing in in your browser — this page updates when you’re back.')
    } catch { flash('❌ Connection failed') }
    finally { setCalLoading(null) }
  }

  const disconnectCal = async (provider: 'google' | 'outlook') => {
    setCalLoading(provider)
    try {
      await disconnectCalendar(provider)
      const profile = await getProfile()
      setUser(profile)
      flash(`Disconnected ${provider}`)
    } catch { flash('❌ Failed to disconnect') }
    finally { setCalLoading(null) }
  }

  const syncCal = async (provider: 'google' | 'outlook') => {
    setCalLoading(provider)
    try {
      await syncCalendar(provider)
      flash(`✅ ${provider} calendar synced`)
    } catch { flash('❌ Sync failed') }
    finally { setCalLoading(null) }
  }

  const signOut = async () => {
    await authLogout().catch(() => {})
    localStorage.removeItem('st_token')
    window.stressTwin?.clearToken?.()
    setToken(null)
    setUser(null)
  }

  const deleteData = async () => {
    try {
      await deleteAllData()
    } catch {
      setDelConfirm(false)
      return flash('❌ Couldn’t delete your data — nothing was changed. Try again.')
    }
    signOut()
  }

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Settings</h1>
          <p className={s.pageSub}>Account, calendar, monitoring preferences</p>
        </div>
      </div>

      {msg && <div className={s.flash}>{msg}</div>}

      {/* Profile */}
      <div className={s.section}>
        <div className={s.sectionTitle}>Profile</div>
        <div className={s.card} style={{padding:20}}>
          <div className={s.field}>
            <label className={s.label}>Full name</label>
            <input className={s.input} value={fullName} onChange={e=>setFullName(e.target.value)} placeholder="Your name" />
          </div>
          <div className={s.field}>
            <label className={s.label}>Email</label>
            <input className={s.input} value={user?.email ?? ''} disabled style={{opacity:.5}} />
          </div>
          <div className={s.field}>
            <label className={s.label}>Stress threshold (IF) — {threshold}/100</label>
            <input type="range" min={30} max={95} value={threshold}
                   onChange={e=>setThreshold(Number(e.target.value))} className={s.slider} />
            <div className={s.sliderHint}>
              Lower = more sensitive · Higher = fewer alerts · Current: {threshold}
            </div>
          </div>
          <button className={s.saveBtn} onClick={saveProfile} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {/* This device */}
      <div className={s.section}>
        <div className={s.sectionTitle}>This device</div>
        <div className={s.card} style={{padding:20}}>
          <div className={s.field}>
            <label className={s.label}>Device name (shown next to your other devices)</label>
            <div style={{display:'flex',gap:8}}>
              <input className={s.input} value={devName} maxLength={40} onChange={e=>setDevName(e.target.value)} />
              <button className={s.saveBtn} style={{marginTop:0}} onClick={saveDevice}>Save</button>
            </div>
          </div>
          <div className={s.calRow}>
            <div>
              <div className={s.calName}>Behavior monitoring</div>
              <div className={s.calStatus} style={{color: monitorRunning ? 'var(--accent)' : 'var(--hint)'}}>
                {monitorRunning ? '● Collecting on this device' : paused ? 'Paused by you' : 'Not running'}
              </div>
            </div>
            <button className={paused ? s.calBtnPrimary : s.calBtn} onClick={toggleMonitor}>{paused ? 'Resume' : 'Pause'}</button>
          </div>
          <div className={s.sliderHint}>Your numbers vs. all your devices are on the Insights page.</div>
        </div>
      </div>

      {/* Calendar */}
      <div className={s.section}>
        <div className={s.sectionTitle}>Calendar Integration</div>
        <div className={s.card} style={{padding:20,display:'flex',flexDirection:'column',gap:14}}>
          {(['google','outlook'] as const).map(provider => {
            const connected = provider === 'google' ? user?.google_connected : user?.outlook_connected
            return (
              <div key={provider} className={s.calRow}>
                <div className={s.calInfo}>
                  <div className={s.calIcon}>{provider === 'google' ? '🗓️' : '📅'}</div>
                  <div>
                    <div className={s.calName}>{provider === 'google' ? 'Google Calendar' : 'Outlook Calendar'}</div>
                    <div className={s.calStatus} style={{color: connected ? 'var(--accent)' : 'var(--hint)'}}>
                      {connected ? '✓ Connected' : 'Not connected'}
                    </div>
                  </div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  {connected ? (
                    <>
                      <button className={s.calBtn} onClick={() => syncCal(provider)} disabled={calLoading===provider}>
                        {calLoading===provider ? '…' : '↻ Sync'}
                      </button>
                      <button className={s.calBtnDanger} onClick={() => disconnectCal(provider)} disabled={calLoading===provider}>
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button className={s.calBtnPrimary} onClick={() => connectCalendar(provider)} disabled={calLoading===provider}>
                      {calLoading===provider ? 'Opening…' : 'Connect'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Data & Privacy */}
      <div className={s.section}>
        <div className={s.sectionTitle}>Data & Privacy</div>
        <div className={s.card} style={{padding:20,display:'flex',flexDirection:'column',gap:12}}>
          <p className={s.privacyNote}>
            StressTwin records only counts and timings: time between keys, how often Backspace is used, pauses, mouse speed, and on phones touch/motion statistics. It never records which keys you press, what you type, where the pointer is, what is on screen, or any audio or camera data. Calendar event titles are scanned for workload keywords and then discarded.
          </p>
          <div className={s.statsRow}>
            <div className={s.stat}><div className={s.statVal}>{user?.days_of_data ?? 0}</div><div className={s.statLbl}>Days of data</div></div>
            <div className={s.stat}><div className={s.statVal}>{user?.mood_checkins_count ?? 0}</div><div className={s.statLbl}>Mood check-ins</div></div>
            <div className={s.stat}><div className={s.statVal}>{user?.if_model_ready ? '✓' : '○'}</div><div className={s.statLbl}>IF model</div></div>
            <div className={s.stat}><div className={s.statVal}>{user?.lstm_model_ready ? '✓' : '○'}</div><div className={s.statLbl}>LSTM model</div></div>
          </div>
        </div>
      </div>

      {/* Account actions */}
      <div className={s.section}>
        <div className={s.sectionTitle}>Account</div>
        <div className={s.card} style={{padding:20,display:'flex',gap:10}}>
          <button className={s.signOutBtn} onClick={signOut}>Sign out</button>
          {!delConfirm ? (
            <button className={s.deleteBtn} onClick={() => setDelConfirm(true)}>Delete all my data</button>
          ) : (
            <>
              <button className={s.deleteConfirmBtn} onClick={deleteData}>⚠ Confirm delete (irreversible)</button>
              <button className={s.calBtn} onClick={() => setDelConfirm(false)}>Cancel</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
