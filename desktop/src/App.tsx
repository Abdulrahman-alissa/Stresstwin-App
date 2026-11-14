import { useEffect, useState } from 'react'
import { useAppStore } from './store/useAppStore'
import { getProfile } from './api/client'
import AuthPage from './pages/auth/AuthPage'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import ForecastPage from './pages/ForecastPage'
import HistoryPage from './pages/HistoryPage'
import SettingsPage from './pages/SettingsPage'
import InsightsPage from './pages/InsightsPage'

export default function App() {
  const { token, setToken, setUser, page } = useAppStore()
  const [booting, setBooting] = useState(true)

  // On launch: try to load saved token from Electron safeStorage
  useEffect(() => {
    const init = async () => {
      try {
        let saved: string | null = null
        if (window.stressTwin?.loadToken) {
          saved = await window.stressTwin.loadToken()
        } else {
          saved = localStorage.getItem('st_token')
        }
        if (saved) {
          setToken(saved)
          localStorage.setItem('st_token', saved)
          const profile = await getProfile()
          setUser(profile)
        }
      } catch {
        setToken(null)
        setUser(null)
      } finally {
        setBooting(false)
      }
    }
    init()
  }, [])

  if (booting) {
    return (
      <div style={{
        height: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--bg)', flexDirection: 'column', gap: 16,
      }}>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="StressTwin" width={72} height={72} style={{ borderRadius: 18 }} />
        <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2.5px solid var(--brand)', borderTopColor: 'transparent' }} className="spin" />
      </div>
    )
  }

  if (!token) return <AuthPage />

  const pages: Record<string, JSX.Element> = {
    dashboard: <Dashboard />,
    insights:  <InsightsPage />,
    forecast:  <ForecastPage />,
    history:   <HistoryPage />,
    settings:  <SettingsPage />,
  }

  return <Layout>{pages[page] ?? <Dashboard />}</Layout>
}
