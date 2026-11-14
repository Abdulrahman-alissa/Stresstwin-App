import { useEffect, useRef, useCallback } from 'react'
import { Gyroscope, Accelerometer } from 'expo-sensors'
import { submitBatch } from '../api/client'
import { useAppStore } from '../store/useAppStore'

const WINDOW_MS = 30_000

export function useBehavioralMonitor() {
  const { setScore, addTrend, setMonitorRunning, addSignal, token } = useAppStore()
  const gyroData  = useRef<{ x: number; y: number; z: number }[]>([])
  const accelData = useRef<number[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const sendBatch = useCallback(async () => {
    if (!token) return
    const gyro = gyroData.current
    const accel = accelData.current

    // Gyro variance
    let gyroVar = 0
    if (gyro.length > 1) {
      const mags = gyro.map(g => Math.sqrt(g.x**2 + g.y**2 + g.z**2))
      const mean = mags.reduce((a, b) => a + b, 0) / mags.length
      gyroVar = mags.reduce((a, b) => a + (b - mean)**2, 0) / mags.length
    }

    // Touch pressure (approximated via accelerometer magnitude variance)
    let touchPressure = null
    if (accel.length > 0) {
      const mean = accel.reduce((a, b) => a + b, 0) / accel.length
      touchPressure = Math.min(mean / 20, 1)
    }

    // Local live view: hand-restlessness index from the gyroscope (numbers only).
    addSignal({
      t: Date.now(), dur: WINDOW_MS / 1000, keys: null, cps: null, interKeyMs: null, errorRate: null,
      pauses: null, bursts: null, motion: Math.min(gyroVar * 100, 200),
    })

    const features = {
      platform:      'android' as const,
      window_start:  new Date().toISOString(),
      gyro_variance: gyroVar,
      touch_pressure: touchPressure,
      idle_frequency: gyro.length < 10 ? 0.8 : 0.2,
      session_duration: 30,
    }

    try {
      const res = await submitBatch(features)
      setScore(res.deviation_score, res.threshold_crossed, res.intervention_type, res.model_ready)
      addTrend({ score: res.deviation_score, at: new Date().toISOString() })
    } catch {}

    // Reset buffers
    gyroData.current = []
    accelData.current = []
  }, [token])

  useEffect(() => {
    if (!token) return

    Gyroscope.setUpdateInterval(500)
    const gyroSub = Gyroscope.addListener(data => {
      gyroData.current.push(data)
      if (gyroData.current.length > 200) gyroData.current.shift()
    })

    Accelerometer.setUpdateInterval(500)
    const accelSub = Accelerometer.addListener(({ x, y, z }) => {
      accelData.current.push(Math.sqrt(x**2 + y**2 + z**2))
      if (accelData.current.length > 200) accelData.current.shift()
    })

    setMonitorRunning(true)
    intervalRef.current = setInterval(sendBatch, WINDOW_MS)

    return () => {
      gyroSub.remove()
      accelSub.remove()
      if (intervalRef.current) clearInterval(intervalRef.current)
      setMonitorRunning(false)
    }
  }, [token])
}
