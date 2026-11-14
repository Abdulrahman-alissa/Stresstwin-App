import { useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { authLogin, authRegister, getProfile } from '../../api/client'
import s from './AuthPage.module.css'

type Mode = 'login' | 'register'

export default function AuthPage() {
  const { setToken, setUser } = useAppStore()
  const [mode, setMode]           = useState<Mode>('login')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [fullName, setFullName]   = useState('')
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      let data: any
      if (mode === 'login') {
        data = await authLogin(email, password)
      } else {
        data = await authRegister(email, password, fullName || undefined)
      }
      const token = data.access_token
      localStorage.setItem('st_token', token)
      if (window.stressTwin?.storeToken) await window.stressTwin.storeToken(token)
      setToken(token)
      const profile = await getProfile()
      setUser(profile)
    } catch (err: any) {
      const msg = err?.response?.data?.detail || 'Something went wrong. Please try again.'
      setError(Array.isArray(msg) ? msg.map((m: any) => m.msg).join(', ') : msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={s.root}>
      {/* Left panel */}
      <div className={s.left}>
        <div className={s.brandWrap}>
          <img className={s.brandLogo} src={`${import.meta.env.BASE_URL}logo.png`} alt="StressTwin" />
          <div className={s.brandName}>StressTwin</div>
        </div>
        <div className={s.hero}>
          <h1 className={s.heroTitle}>Know your stress<br />before it peaks.</h1>
          <p className={s.heroSub}>
            Passive behavioral monitoring + calendar-aware AI predicts stress
            3 days in advance — no wearable required.
          </p>
        </div>
        <div className={s.features}>
          {[
            ['⚡', 'Real-time detection', 'Isolation Forest scores every 30 seconds'],
            ['📅', 'Calendar forecasting', 'LSTM predicts risk from your schedule'],
            ['🛡️', 'Smart interventions', 'Breathing, focus mode, step-away prompts'],
          ].map(([icon, title, sub]) => (
            <div key={title} className={s.featureItem}>
              <span className={s.featureIcon}>{icon}</span>
              <div>
                <div className={s.featureTitle}>{title}</div>
                <div className={s.featureSub}>{sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className={s.right}>
        <div className={s.formCard}>
          <div className={s.formHeader}>
            <h2 className={s.formTitle}>
              {mode === 'login' ? 'Welcome back' : 'Create account'}
            </h2>
            <p className={s.formSub}>
              {mode === 'login'
                ? 'Sign in to your StressTwin account'
                : 'Start monitoring your stress today'}
            </p>
          </div>

          <form onSubmit={submit} className={s.form}>
            {mode === 'register' && (
              <div className={s.field}>
                <label className={s.label}>Full name</label>
                <input
                  className={s.input}
                  type="text"
                  placeholder="Alex Johnson"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                />
              </div>
            )}
            <div className={s.field}>
              <label className={s.label}>Email address</label>
              <input
                className={s.input}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className={s.field}>
              <label className={s.label}>Password</label>
              <input
                className={s.input}
                type="password"
                placeholder={mode === 'register' ? 'Min. 8 characters' : '••••••••'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={mode === 'register' ? 8 : undefined}
              />
            </div>

            {error && <div className={s.errorBox}>{error}</div>}

            <button type="submit" className={s.btn} disabled={loading}>
              {loading
                ? <span className={s.spinner} />
                : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className={s.switchRow}>
            {mode === 'login' ? (
              <>Don't have an account?{' '}
                <button className={s.switchBtn} onClick={() => { setMode('register'); setError('') }}>
                  Create one
                </button>
              </>
            ) : (
              <>Already have an account?{' '}
                <button className={s.switchBtn} onClick={() => { setMode('login'); setError('') }}>
                  Sign in
                </button>
              </>
            )}
          </div>

          <div className={s.privacy}>
            🔒 No keystrokes or screen content is ever captured or stored.
          </div>
        </div>
      </div>
    </div>
  )
}
