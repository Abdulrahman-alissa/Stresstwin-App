import { useEffect, useState } from 'react'
import { getScoreHistory } from '../api/client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import { BarChart3 } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import s from './Page.module.css'

export default function HistoryPage() {
  const { user } = useAppStore()
  const [history, setHistory] = useState<any[]>([])
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getScoreHistory(days)
      setHistory(data.history ?? [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [days])

  const threshold = user?.if_threshold ?? 70

  const barColor = (val: number) =>
    val < 50 ? 'var(--accent)' : val < threshold ? 'var(--amber)' : 'var(--red)'

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Score History</h1>
          <p className={s.pageSub}>Daily mean Isolation Forest deviation scores</p>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          {[7,14,30].map(d => (
            <button key={d} className={`${s.dayBtn} ${days===d ? s.dayBtnActive : ''}`} onClick={() => setDays(d)}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className={s.loading}><div className="spin" style={{width:24,height:24,border:'2.5px solid var(--brand)',borderTopColor:'transparent',borderRadius:'50%'}} /></div>
      ) : history.length === 0 ? (
        <div className={s.emptyCard}>
          <BarChart3 size={44} color="var(--hint)" style={{ marginBottom: 16 }} />
          <h3 className={s.emptyTitle}>No history yet</h3>
          <p className={s.emptySub}>Start a monitoring session and return in 24 hours to see your first daily summary.</p>
        </div>
      ) : (
        <div className={s.card} style={{padding:24}}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={history} margin={{top:10,right:10,bottom:20,left:0}}>
              <XAxis dataKey="date" tick={{fill:'var(--hint)',fontSize:10,fontFamily:'var(--mono)'}}
                     tickFormatter={v => v.slice(5)} />
              <YAxis domain={[0,100]} tick={{fill:'var(--hint)',fontSize:10,fontFamily:'var(--mono)'}} />
              <Tooltip
                contentStyle={{background:'var(--surface2)',border:'0.5px solid var(--border2)',borderRadius:8,fontSize:12}}
                formatter={(v:any) => [`${Math.round(v)}/100`,'Mean Score']}
              />
              <ReferenceLine y={threshold} stroke="var(--amber)" strokeDasharray="4 4"
                             label={{value:`Threshold ${threshold}`,fill:'var(--amber)',fontSize:10,fontFamily:'var(--mono)'}} />
              <Bar dataKey="mean_score" radius={[4,4,0,0]}>
                {history.map((entry,i) => (
                  <Cell key={i} fill={barColor(entry.mean_score)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Stats row */}
          <div style={{display:'flex',gap:14,marginTop:16,flexWrap:'wrap'}}>
            {[
              { label:'Avg Score',  val: history.length ? Math.round(history.reduce((a,b)=>a+b.mean_score,0)/history.length) : 0 },
              { label:'Peak Score', val: history.length ? Math.round(Math.max(...history.map(h=>h.max_score))) : 0 },
              { label:'Days Above Threshold', val: history.filter(h=>h.mean_score>threshold).length },
              { label:'Total Windows', val: history.reduce((a,h)=>a+h.sample_count,0) },
            ].map(st => (
              <div key={st.label} style={{flex:1,minWidth:120,background:'var(--surface2)',borderRadius:10,padding:'12px 14px',border:'0.5px solid var(--border)'}}>
                <div style={{fontFamily:'var(--mono)',fontSize:10,color:'var(--hint)',marginBottom:4}}>{st.label}</div>
                <div style={{fontFamily:'var(--mono)',fontSize:22,fontWeight:300,color:'var(--text)'}}>{st.val}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
