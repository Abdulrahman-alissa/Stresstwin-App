import { Monitor, Smartphone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getDevices } from '../api/client'
import s from './DeviceStrip.module.css'

interface Device {
  id: string
  device_id: string
  platform: 'desktop' | 'android' | 'ios'
  display_name: string
  keyboard_active: boolean
  last_snapshot_at: string | null
  last_sync_at: string | null
  status: 'sending' | 'stale' | 'inactive'
}

const ICON: Record<Device['platform'], typeof Monitor> = { desktop: Monitor, android: Smartphone, ios: Smartphone }
const DOT: Record<Device['status'], string> = { sending: 'var(--accent)', stale: 'var(--amber)', inactive: 'var(--hint)' }

function ago(iso: string | null) {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  return `${Math.round(mins / 60)} hr ago`
}

export default function DeviceStrip() {
  const [devices, setDevices] = useState<Device[]>([])

  useEffect(() => {
    const load = () => getDevices().then(setDevices).catch(() => {})
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])

  const uniqueDevices = Array.from(
    new Map(devices.map(d => [d.device_id || d.id, d])).values()
  )

  const sending = uniqueDevices.filter(d => d.status === 'sending').length

  return (
    <div className={s.card}>
      <div className={s.clbl}>My Devices</div>
      {uniqueDevices.length === 0 ? (
        <p className={s.empty}>No devices reporting yet.</p>
      ) : (
        <>
          {uniqueDevices.map(d => (
            <div key={d.device_id || d.id} className={s.row}>
              <span className={s.icon}>{(() => { const I = ICON[d.platform]; return <I size={20} color="var(--brand)" /> })()}</span>
              <div className={s.meta}>
                <div className={s.name}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: DOT[d.status], marginRight: 8 }} />{d.display_name}</div>
                <div className={s.sub}>Last snapshot: {ago(d.last_snapshot_at)} · Last sync: {ago(d.last_sync_at)}</div>
              </div>
            </div>
          ))}
          <div className={s.summary}>{uniqueDevices.length} Total Devices · {sending} Currently Sending Data</div>
        </>
      )}
    </div>
  )
}
