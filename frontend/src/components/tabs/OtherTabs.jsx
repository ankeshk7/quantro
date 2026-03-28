import { useState, useEffect } from 'react'
import { useApi, invalidateCache } from '../../hooks/useApi.js'
import { api } from '../../utils/api.js'
import { fmt, chgColor } from '../../utils/formatters.js'
import { StatCard, SectionTitle, Loading, ErrorMsg, ProgressBar } from '../ui/index.jsx'

function useRelativeTime(ts) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    const compute = () => {
      if (!ts) { setLabel(''); return }
      const secs = Math.round((Date.now() - ts) / 1000)
      if (secs < 10)  { setLabel('just now'); return }
      if (secs < 60)  { setLabel(`${secs}s ago`); return }
      const mins = Math.floor(secs / 60)
      if (mins < 60)  { setLabel(`${mins}m ago`); return }
      setLabel(`${Math.floor(mins / 60)}h ago`)
    }
    compute()
    const id = setInterval(compute, 15000)
    return () => clearInterval(id)
  }, [ts])
  return label
}

// ── Scanner ───────────────────────────────────────────────────────────────────

const FILTERS = [
  { key: 'all',          label: 'All' },
  { key: 'high_ivr',     label: 'High IVR' },
  { key: 'oi_buildup',   label: 'OI buildup' },
  { key: 'breakout',     label: 'Breakout' },
  { key: 'near_support', label: 'Near support' },
]

const SORTS = [
  { key: 'confidence', label: 'Confidence' },
  { key: 'change',     label: 'Change %' },
  { key: 'ivr',        label: 'IVR' },
]

export function ScannerTab({ onViewTicker }) {
  const [filter, setFilter] = useState('all')
  const [sort,   setSort]   = useState('confidence')
  const [search, setSearch] = useState('')
  const { data, loading, error, refresh, lastUpdated } = useApi(() => api.scanner(filter), [filter], `scanner-${filter}`)
  const updatedLabel = useRelativeTime(lastUpdated)

  const badgeCls = (strategy) => {
    if (strategy === 'Skip') return 'badge-red'
    if (strategy?.includes('Bull')) return 'badge-green'
    if (strategy?.includes('Bear')) return 'badge-red'
    if (strategy === 'Iron Fly' || strategy === 'Iron Condor') return 'badge-blue'
    return 'badge-gray'
  }

  const sorted = [...(data || [])]
    .filter(s => !search || s.symbol?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'confidence') return (b.confidence ?? 0) - (a.confidence ?? 0)
      if (sort === 'change')     return Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0)
      if (sort === 'ivr')        return (b.ivr ?? 0) - (a.ivr ?? 0)
      return 0
    })

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)', marginBottom: 2 }}>F&O Scanner</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            Click any stock to open Ticker analysis
            {updatedLabel && <span style={{ marginLeft: 6, color: 'var(--text3)' }}>· {updatedLabel}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {/* Search */}
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol…"
            style={{ padding: '4px 9px', fontSize: 11, background: 'var(--bg2)', border: '0.5px solid var(--border)',
              borderRadius: 6, color: 'var(--text1)', width: 130, outline: 'none' }} />
          {/* Refresh */}
          <button onClick={refresh} disabled={loading}
            style={{ padding: '4px 10px', fontSize: 10, cursor: loading ? 'default' : 'pointer', borderRadius: 6,
              background: 'var(--bg2)', border: '0.5px solid var(--border)', color: 'var(--text2)', opacity: loading ? 0.5 : 1 }}>
            {loading ? '…' : '↺ Refresh'}
          </button>
          {/* Sort */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sort</span>
            {SORTS.map(s => (
              <button key={s.key} onClick={() => setSort(s.key)}
                style={{ padding: '3px 9px', fontSize: 10, fontWeight: 500, cursor: 'pointer', borderRadius: 4,
                  background: sort === s.key ? 'var(--text1)' : 'var(--bg2)',
                  color:      sort === s.key ? 'var(--bg)'    : 'var(--text3)',
                  border: '0.5px solid var(--border)', transition: 'all 0.12s' }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            style={{ padding: '4px 11px', fontSize: 10, fontWeight: 600, cursor: 'pointer', borderRadius: 20,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              background: filter === f.key ? '#EAF3DE' : 'var(--bg2)',
              color:      filter === f.key ? '#3B6D11'  : 'var(--text2)',
              border: `0.5px solid ${filter === f.key ? '#3B6D11' : 'var(--border)'}`,
              transition: 'all 0.12s' }}>
            {f.label}
          </button>
        ))}
        {!loading && data && (
          <span style={{ fontSize: 10, color: 'var(--text3)', alignSelf: 'center', marginLeft: 4 }}>
            {sorted.length} result{sorted.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {loading ? <Loading type="scanner" /> : error ? <ErrorMsg message={error} /> : sorted.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
          No setups match this filter right now.
        </div>
      ) : (
        sorted.map((s, i) => (
          <div key={i} className="scanner-card" onClick={() => onViewTicker?.(s.symbol)}
            style={{ background: 'var(--bg2)', borderRadius: 8, padding: '12px 14px',
              border: '0.5px solid var(--border)', marginBottom: 6,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              cursor: 'pointer', transition: 'all 0.15s', gap: 10 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--green)'; e.currentTarget.style.background = 'var(--bg3)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg2)' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text1)', fontFamily: 'var(--font-mono)' }}>{s.symbol}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: chgColor(s.change) }}>{s.change >= 0 ? '+' : ''}{s.change}%</span>
                <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>₹{fmt.price(s.price)}</span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text2)', lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.detail}</div>
              {/* Confidence bar */}
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ flex: 1, height: 3, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${s.confidence}%`, borderRadius: 2, transition: 'width 0.4s',
                    background: s.confidence >= 75 ? 'var(--green)' : s.confidence >= 55 ? 'var(--amber)' : 'var(--red)' }} />
                </div>
                <span style={{ fontSize: 9, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{s.confidence}%</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
              <span className={`badge ${badgeCls(s.strategy)}`}>{s.strategy}</span>
              {s.ivr != null && <span style={{ fontSize: 9, color: 'var(--text3)' }}>IVR {s.ivr}</span>}
            </div>
          </div>
        ))
      )}
    </div>
  )
}


// ── Positions (Kite Connect) ───────────────────────────────────────────────────

export function PositionsTab() {
  const [connecting, setConnecting] = useState(false)
  const status    = useApi(() => api.kiteStatus(), [], 'kite-status')
  const kite      = useApi(() => api.kitePositions(), [], 'kite-positions')

  const connected  = status.data?.connected
  const configured = status.data?.configured

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const { url } = await api.kiteAuthUrl()
      if (url) window.open(url, '_blank', 'width=600,height=700')
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    await api.kiteDisconnect()
    invalidateCache('kite-status')
    invalidateCache('kite-positions')
    status.reload()
    kite.reload()
  }

  const positions = kite.data?.net || []
  const openPos   = positions.filter(p => p.quantity !== 0)
  const summary   = kite.data?.summary || {}

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <SectionTitle style={{ margin: 0 }}>Live positions</SectionTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {connected && (
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>
              {status.data?.user} · Kite
            </span>
          )}
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? 'var(--green)' : 'var(--text3)' }} />
          {connected ? (
            <button onClick={handleDisconnect}
              style={{ fontSize: 10, padding: '3px 9px', cursor: 'pointer', borderRadius: 5, background: 'var(--bg2)', border: '0.5px solid var(--border)', color: 'var(--text2)' }}>
              Disconnect
            </button>
          ) : (
            <button onClick={handleConnect} disabled={connecting || !configured}
              style={{ fontSize: 11, padding: '5px 14px', cursor: configured ? 'pointer' : 'default', borderRadius: 5, fontWeight: 500,
                background: configured ? '#EAF3DE' : 'var(--bg2)',
                border: `0.5px solid ${configured ? '#C0DD97' : 'var(--border)'}`,
                color: configured ? '#3B6D11' : 'var(--text3)' }}>
              {connecting ? 'Opening…' : 'Connect Kite'}
            </button>
          )}
        </div>
      </div>

      {/* Not configured */}
      {!configured && (
        <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '14px 16px', border: '0.5px solid var(--border)', marginBottom: 12, fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 500, color: 'var(--text1)', marginBottom: 6 }}>Setup required</div>
          1. Create an app at <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>developers.kite.trade</span><br />
          2. Set redirect URL to <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>http://127.0.0.1:8000/api/kite/connect</span><br />
          3. Add to <span style={{ fontFamily: 'var(--font-mono)' }}>backend/.env</span>:<br />
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text3)', paddingLeft: 12 }}>
            KITE_API_KEY=your_key<br />
            KITE_API_SECRET=your_secret
          </span><br />
          4. Restart the backend, then click <strong>Connect Kite</strong>
        </div>
      )}

      {/* Not connected */}
      {configured && !connected && !status.loading && (
        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text3)', fontSize: 12 }}>
          <div style={{ marginBottom: 8 }}>Session expired or not logged in</div>
          <div style={{ fontSize: 11 }}>Click <strong style={{ color: 'var(--text2)' }}>Connect Kite</strong> to log in with Zerodha</div>
        </div>
      )}

      {/* Connected — positions */}
      {connected && (
        <>
          {/* Summary bar */}
          {summary.total_count > 0 && (
            <div className="stat-grid-3" style={{ marginBottom: 12 }}>
              <StatCard label="Open positions" value={summary.open_count} sub={`${summary.total_count} total`} />
              <StatCard label="Net P&L"        value={fmt.inrSign(summary.total_pnl)} valueColor={chgColor(summary.total_pnl)} sub="Unrealised" />
              <StatCard label="M2M"            value={fmt.inrSign(summary.total_m2m)} valueColor={chgColor(summary.total_m2m)} sub="Today" />
            </div>
          )}

          {kite.loading ? <Loading /> : openPos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text3)', fontSize: 12 }}>No open positions in Kite</div>
          ) : (
            openPos.map((p, i) => {
              const pnl  = p.pnl || 0
              const side = p.quantity < 0 ? 'SHORT' : 'LONG'
              return (
                <div key={i} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 12px', border: `0.5px solid ${pnl >= 0 ? 'var(--green)' : 'var(--red)'}22`, marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text1)' }}>{p.symbol}</div>
                      <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2 }}>
                        <span style={{ color: side === 'SHORT' ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>{side}</span>
                        {' · '}{Math.abs(p.quantity)} qty · {p.product} · {p.exchange}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 15, fontWeight: 500, fontFamily: 'var(--font-mono)', color: chgColor(pnl) }}>{fmt.inrSign(pnl)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                        avg {p.average_price} → ltp {p.ltp}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}

          {/* Flat positions (closed today) */}
          {positions.filter(p => p.quantity === 0).length > 0 && (
            <>
              <SectionTitle>Closed today</SectionTitle>
              {positions.filter(p => p.quantity === 0).map((p, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--bg2)', borderRadius: 6, border: '0.5px solid var(--border)', marginBottom: 4, opacity: 0.7 }}>
                  <div style={{ fontSize: 12, color: 'var(--text1)' }}>{p.symbol} <span style={{ fontSize: 10, color: 'var(--text3)' }}>· {p.product}</span></div>
                  <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)', color: chgColor(p.pnl) }}>{fmt.inrSign(p.pnl)}</div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}


// ── Journal ───────────────────────────────────────────────────────────────────

export function JournalTab() {
  const { data, loading, error, reload } = useApi(() => api.journal(), [], 'journal')
  const [adding, setAdding] = useState(false)
  const [form, setForm]     = useState({ symbol: 'NIFTY', strategy: 'Iron Fly', lots: 1, action: 'trade', notes: '' })

  const submit = async () => {
    await api.addTrade({ ...form, date: new Date().toISOString().slice(0, 10), status: 'open' })
    setAdding(false)
    reload()
  }

  if (loading) return <Loading />
  if (error)   return <ErrorMsg message={error} />

  const { trades = [], stats = {} } = data || {}

  return (
    <div>
      <SectionTitle>Performance summary</SectionTitle>
      <div className="stat-grid-3" style={{ marginBottom: 8 }}>
        <StatCard label="Win rate"     value={`${stats.win_rate || 0}%`} sub={`${stats.wins || 0} of ${stats.total || 0} trades`} valueColor="var(--green)" />
        <StatCard label="Net P&L"      value={fmt.inrSign(stats.total_pnl || 0)} valueColor={chgColor(stats.total_pnl || 0)} />
        <StatCard label="Total trades" value={stats.total || 0} sub={`${stats.skips || 0} skipped`} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <SectionTitle>Trade log</SectionTitle>
        <button onClick={() => setAdding(v => !v)}
          style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer', borderRadius: 5, background: 'var(--bg2)', border: '0.5px solid var(--border)', color: 'var(--text1)', marginBottom: 6 }}>
          + Log trade
        </button>
      </div>

      {adding && (
        <div className="card" style={{ marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            {[
              { key: 'symbol',   label: 'Symbol',   type: 'text' },
              { key: 'strategy', label: 'Strategy', type: 'text' },
              { key: 'lots',     label: 'Lots',     type: 'number' },
              { key: 'action',   label: 'Action',   type: 'text' },
            ].map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', marginBottom: 3 }}>{f.label}</div>
                <input type={f.type} value={form[f.key]} onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                  style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: 'var(--bg3)', border: '0.5px solid var(--border)', borderRadius: 5, color: 'var(--text1)' }} />
              </div>
            ))}
          </div>
          <textarea value={form.notes} onChange={e => setForm(v => ({ ...v, notes: e.target.value }))} placeholder="Notes (optional)"
            style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: 'var(--bg3)', border: '0.5px solid var(--border)', borderRadius: 5, color: 'var(--text1)', marginBottom: 8, resize: 'vertical', minHeight: 48 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={submit} style={{ flex: 1, padding: '7px', fontSize: 12, cursor: 'pointer', borderRadius: 5, background: '#EAF3DE', border: '0.5px solid #C0DD97', color: '#3B6D11', fontWeight: 500 }}>Save</button>
            <button onClick={() => setAdding(false)} style={{ padding: '7px 16px', fontSize: 12, cursor: 'pointer', borderRadius: 5, background: 'var(--bg2)', border: '0.5px solid var(--border)', color: 'var(--text2)' }}>Cancel</button>
          </div>
        </div>
      )}

      {trades.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text3)', fontSize: 12 }}>No trades logged yet.</div>
      ) : trades.map((t, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--bg2)', borderRadius: 6, border: '0.5px solid var(--border)', marginBottom: 5 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text1)' }}>{t.symbol} {t.strategy} · {t.date}</div>
            <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1 }}>{t.lots} lot · {t.notes || t.action}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 500, fontFamily: 'var(--font-mono)', color: chgColor(t.pnl || 0) }}>{t.pnl ? fmt.inrSign(t.pnl) : '—'}</div>
            <span className={`badge ${t.action === 'skip' ? 'badge-blue' : (t.pnl || 0) >= 0 ? 'badge-green' : 'badge-red'}`}>
              {t.action === 'skip' ? 'skip' : (t.pnl || 0) >= 0 ? 'win' : 'loss'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}


// ── Calculator ────────────────────────────────────────────────────────────────

const BLANK = { lot_size: 65, short_strike: '', wing_width: '', ce_premium: '', pe_premium: '', wing_ce: '', wing_pe: '' }

// ── Payoff chart (SVG, pure frontend — updates live as fields change) ──────────
function PayoffChart({ form, lots }) {
  const s   = Number(form.short_strike)
  const w   = Number(form.wing_width)
  const ceP = Number(form.ce_premium)
  const peP = Number(form.pe_premium)
  const wce = Number(form.wing_ce)
  const wpe = Number(form.wing_pe)
  const ls  = Number(form.lot_size) || 1
  const l   = Number(lots) || 1

  if (!s || !w) return (
    <div style={{ borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--bg2)', padding: '40px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 12 }}>
      Enter short strike + wing width to see payoff
    </div>
  )

  const units      = l * ls
  const lower      = s - w
  const upper      = s + w
  const netCredit  = ceP + peP - wce - wpe

  const rangeStart = s - w * 1.8
  const rangeEnd   = s + w * 1.8

  const payoff = (spot) => {
    const sc = ceP  - Math.max(0, spot - s)
    const sp = peP  - Math.max(0, s - spot)
    const lc = -wce + Math.max(0, spot - upper)
    const lp = -wpe + Math.max(0, lower - spot)
    return (sc + sp + lc + lp) * units
  }

  const pts = Array.from({ length: 201 }, (_, i) => {
    const spot = rangeStart + (rangeEnd - rangeStart) * i / 200
    return { spot, pnl: payoff(spot) }
  })

  const maxPnl  = Math.max(...pts.map(p => p.pnl))
  const minPnl  = Math.min(...pts.map(p => p.pnl))
  const halfRng = Math.max(Math.abs(maxPnl), Math.abs(minPnl)) * 1.25 || 1

  const W = 500, H = 210
  const PAD = { top: 24, right: 16, bottom: 36, left: 68 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom

  const toX = (spot) => ((spot - rangeStart) / (rangeEnd - rangeStart)) * cW + PAD.left
  const toY = (pnl)  => H - PAD.bottom - ((pnl + halfRng) / (halfRng * 2)) * cH
  const zeroY = toY(0)

  const pathD = pts.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${toX(p.spot).toFixed(1)} ${toY(p.pnl).toFixed(1)}`
  ).join(' ')
  const fillD = `${pathD} L ${toX(rangeEnd).toFixed(1)} ${zeroY.toFixed(1)} L ${toX(rangeStart).toFixed(1)} ${zeroY.toFixed(1)} Z`

  const fmtPnl = (v) => {
    const abs = Math.abs(v)
    const str = abs >= 100000 ? `${(abs/100000).toFixed(1)}L` : abs >= 1000 ? `${(abs/1000).toFixed(1)}K` : Math.round(abs).toString()
    return `${v < 0 ? '−' : ''}₹${str}`
  }

  const beUpper = s + netCredit
  const beLower = s - netCredit

  // Only show be lines if within chart range
  const inRange = (x) => x >= rangeStart && x <= rangeEnd

  return (
    <div style={{ borderRadius: 8, border: '0.5px solid var(--border)', overflow: 'hidden', background: 'var(--bg2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', borderBottom: '0.5px solid var(--border)' }}>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)' }}>Payoff at expiry</span>
        <span style={{ fontSize: 10, color: 'var(--text2)' }}>{l} lot{l !== 1 ? 's' : ''} × {ls} = {units} units</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        <defs>
          <clipPath id="pf-above">
            <rect x={PAD.left} y={PAD.top} width={cW} height={Math.max(0, zeroY - PAD.top)} />
          </clipPath>
          <clipPath id="pf-below">
            <rect x={PAD.left} y={Math.max(PAD.top, zeroY)} width={cW} height={Math.max(0, H - PAD.bottom - zeroY)} />
          </clipPath>
        </defs>

        {/* Horizontal grid */}
        {[0.5, 0, -0.5].map(f => (
          <line key={f} x1={PAD.left} y1={toY(f * halfRng)} x2={W - PAD.right} y2={toY(f * halfRng)}
            stroke="var(--border)" strokeWidth={0.5} />
        ))}

        {/* Profit fill */}
        <path d={fillD} fill="#1D9E75" fillOpacity={0.15} clipPath="url(#pf-above)" />
        {/* Loss fill */}
        <path d={fillD} fill="#E24B4A" fillOpacity={0.15} clipPath="url(#pf-below)" />

        {/* Zero line */}
        <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} stroke="var(--text3)" strokeWidth={0.5} />

        {/* Wing strike lines */}
        {[lower, upper].map((k, i) => inRange(k) && (
          <line key={i} x1={toX(k)} y1={PAD.top} x2={toX(k)} y2={H - PAD.bottom}
            stroke="var(--border)" strokeWidth={1} strokeDasharray="3,3" />
        ))}

        {/* Short strike */}
        {inRange(s) && (
          <line x1={toX(s)} y1={PAD.top} x2={toX(s)} y2={H - PAD.bottom}
            stroke="var(--amber)" strokeWidth={1} strokeDasharray="4,3" />
        )}

        {/* Break-even lines */}
        {[beLower, beUpper].map((be, i) => inRange(be) && (
          <line key={i} x1={toX(be)} y1={PAD.top} x2={toX(be)} y2={H - PAD.bottom}
            stroke="var(--red)" strokeWidth={0.5} strokeDasharray="2,3" />
        ))}

        {/* Payoff line — green where profit, red where loss */}
        <path d={pathD} fill="none" stroke="#1D9E75" strokeWidth={2} clipPath="url(#pf-above)" />
        <path d={pathD} fill="none" stroke="#E24B4A" strokeWidth={2} clipPath="url(#pf-below)" />

        {/* Y axis labels */}
        <text x={PAD.left - 4} y={toY(maxPnl) + 4} textAnchor="end" fontSize={9} fill="#1D9E75">{fmtPnl(maxPnl)}</text>
        <text x={PAD.left - 4} y={zeroY + 4}        textAnchor="end" fontSize={9} fill="var(--text3)">0</text>
        <text x={PAD.left - 4} y={toY(minPnl) + 4}  textAnchor="end" fontSize={9} fill="#E24B4A">{fmtPnl(minPnl)}</text>

        {/* X axis labels */}
        {[lower, s, upper].map((k, i) => inRange(k) && (
          <text key={i} x={toX(k)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={8.5}
            fill={i === 1 ? 'var(--amber)' : 'var(--text3)'}>
            {Math.round(k)}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '6px 12px', borderTop: '0.5px solid var(--border)', fontSize: 10, color: 'var(--text3)' }}>
        <span><span style={{ color: 'var(--amber)' }}>— </span>ATM {Math.round(s)}</span>
        <span><span style={{ color: 'var(--red)' }}>-- </span>B/E {Math.round(beLower)} / {Math.round(beUpper)}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--green)' }}>Max profit {fmtPnl(maxPnl)}</span>
        <span style={{ color: 'var(--red)' }}>Max loss {fmtPnl(minPnl)}</span>
      </div>
    </div>
  )
}

export function CalculatorTab() {
  const [symbol,      setSymbol]      = useState('NIFTY')
  const [symInput,    setSymInput]    = useState('NIFTY')
  const [searchRes,   setSearchRes]   = useState([])
  const [lots,        setLots]        = useState(1)
  const [form,        setForm]        = useState(BLANK)
  const [meta,        setMeta]        = useState(null)   // { spot, expiry, ce_iv, pe_iv, wing_ce_iv, wing_pe_iv }
  const [fetching,    setFetching]    = useState(false)
  const [result,      setResult]      = useState(null)
  const [loading,     setLoading]     = useState(false)

  const loadLiveData = async (sym) => {
    setFetching(true)
    setResult(null)
    try {
      const d = await api.calcPrefill(sym)
      setForm({
        lot_size:     d.lot_size,
        short_strike: d.short_strike,
        wing_width:   d.wing_width,
        ce_premium:   d.ce_premium,
        pe_premium:   d.pe_premium,
        wing_ce:      d.wing_ce,
        wing_pe:      d.wing_pe,
      })
      setMeta({
        spot:        d.spot,
        expiry:      d.expiry,
        ce_iv:       d.ce_iv,
        pe_iv:       d.pe_iv,
        wing_ce_iv:  d.wing_ce_iv,
        wing_pe_iv:  d.wing_pe_iv,
      })
    } catch (e) {
      console.error(e)
    } finally {
      setFetching(false)
    }
  }

  // Load NIFTY on first render
  useEffect(() => { loadLiveData('NIFTY') }, [])

  const handleSymInput = async (val) => {
    setSymInput(val)
    if (val.length < 1) { setSearchRes([]); return }
    try {
      const data = await api.search(val)
      setSearchRes(data)
    } catch {
      setSearchRes([])
    }
  }

  const selectSymbol = (sym) => {
    setSymInput(sym)
    setSearchRes([])
    setSymbol(sym)
    loadLiveData(sym)
  }

  const setField = (k, v) => setForm(f => ({ ...f, [k]: Number(v) || v }))

  const calculate = async () => {
    setLoading(true)
    try {
      const r = await api.calcIronfly({ ...form, symbol, lots })
      setResult(r)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const AUTO_FIELDS = [
    { key: 'lot_size',     label: 'Lot size' },
    { key: 'short_strike', label: 'Short strike (ATM)' },
    { key: 'wing_width',   label: 'Wing width (pts)' },
    { key: 'ce_premium',   label: 'CE premium (pts)' },
    { key: 'pe_premium',   label: 'PE premium (pts)' },
    { key: 'wing_ce',      label: 'Wing CE cost (pts)' },
    { key: 'wing_pe',      label: 'Wing PE cost (pts)' },
  ]

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>

      {/* ── Left column: inputs ─────────────────────────────────────────── */}
      <div style={{ flex: '0 0 360px', minWidth: 280 }}>
        <SectionTitle>Strategy builder</SectionTitle>

        {/* Symbol search */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', marginBottom: 3 }}>Symbol</div>
          <div style={{ position: 'relative' }}>
            <input
              value={symInput}
              onChange={e => handleSymInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && symInput && selectSymbol(symInput.trim().toUpperCase())}
              placeholder="Search — NIFTY, BANKNIFTY, RELIANCE…"
              style={{ width: '100%', padding: '9px 12px', fontSize: 13, fontFamily: 'var(--font-mono)', background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 8, color: 'var(--text1)', boxSizing: 'border-box', outline: 'none' }}
            />
            {searchRes.length > 0 && (
              <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, zIndex: 10, overflow: 'hidden' }}>
                {searchRes.map((r, i) => (
                  <div key={i} onClick={() => selectSymbol(r.symbol)}
                    style={{ padding: '8px 14px', fontSize: 12, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: i < searchRes.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{r.symbol}</span>
                      {r.name && r.name !== r.symbol && (
                        <span style={{ marginLeft: 8, color: 'var(--text3)', fontSize: 10 }}>{r.name}</span>
                      )}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--green)' }}>Load ↵</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {fetching && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>Loading live data for {symbol}…</div>}
        </div>

        {/* Lots */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--green)', marginBottom: 3 }}>Lots (manual)</div>
          <input type="number" value={lots} onChange={e => setLots(Number(e.target.value) || 1)} min={1}
            style={{ width: '100%', padding: '7px 8px', fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 600, background: 'var(--bg2)', border: '0.5px solid var(--green)', borderRadius: 6, color: 'var(--text1)' }} />
        </div>

        {/* Auto-populated fields */}
        <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', marginBottom: 6 }}>
          Auto-filled from live data · override if needed
        </div>
        <div className="stat-grid-2" style={{ marginBottom: 10 }}>
          {AUTO_FIELDS.map(f => (
            <div key={f.key}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', marginBottom: 3 }}>{f.label}</div>
              <input type="number" value={form[f.key]} onChange={e => setField(f.key, e.target.value)}
                disabled={fetching}
                style={{ width: '100%', padding: '7px 8px', fontSize: 13, fontFamily: 'var(--font-mono)', background: fetching ? 'var(--bg3)' : 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 6, color: fetching ? 'var(--text3)' : 'var(--text1)' }} />
            </div>
          ))}
        </div>

        <button onClick={calculate} disabled={loading || fetching}
          style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 500, cursor: 'pointer', borderRadius: 6, background: '#EAF3DE', border: '0.5px solid #C0DD97', color: '#3B6D11' }}>
          {loading ? 'Calculating...' : 'Calculate P&L'}
        </button>
      </div>

      {/* ── Right column: legs + payoff chart + P&L breakdown ──────────── */}
      <div style={{ flex: 1, minWidth: 280 }}>

        {/* Trade legs — shown as soon as form has strike data */}
        {form.short_strike && form.wing_width ? (() => {
          const atm  = Number(form.short_strike)
          const wing = Number(form.wing_width)
          const net  = Number(form.ce_premium) + Number(form.pe_premium) - Number(form.wing_ce) - Number(form.wing_pe)
          const legs = [
            { action: 'SELL', strike: atm,        type: 'CE', premium: form.ce_premium, iv: meta?.ce_iv,      role: 'Short call — collect premium' },
            { action: 'SELL', strike: atm,        type: 'PE', premium: form.pe_premium, iv: meta?.pe_iv,      role: 'Short put — collect premium'  },
            { action: 'BUY',  strike: atm + wing, type: 'CE', premium: form.wing_ce,    iv: meta?.wing_ce_iv, role: 'Long call — cap upside loss'  },
            { action: 'BUY',  strike: atm - wing, type: 'PE', premium: form.wing_pe,    iv: meta?.wing_pe_iv, role: 'Long put — cap downside loss'  },
          ]
          return (
            <>
              <SectionTitle>Trade legs — Iron Fly</SectionTitle>

              {/* Context bar: spot + expiry */}
              {meta && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                  <div style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--bg2)', border: '0.5px solid var(--border)', fontSize: 11 }}>
                    <span style={{ color: 'var(--text3)' }}>Spot </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{meta.spot}</span>
                  </div>
                  {meta.expiry && (
                    <div style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--bg2)', border: '0.5px solid var(--border)', fontSize: 11 }}>
                      <span style={{ color: 'var(--text3)' }}>Expiry </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{meta.expiry}</span>
                    </div>
                  )}
                  <div style={{ padding: '5px 10px', borderRadius: 6, background: 'var(--bg2)', border: '0.5px solid var(--border)', fontSize: 11 }}>
                    <span style={{ color: 'var(--text3)' }}>Source </span>
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>NSE live chain</span>
                  </div>
                </div>
              )}

              <div style={{ borderRadius: 8, border: '0.5px solid var(--border)', overflow: 'hidden', marginBottom: 8 }}>
                {legs.map((leg, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: i < 3 ? '0.5px solid var(--border)' : 'none', background: 'var(--bg2)' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 7px', borderRadius: 4, flexShrink: 0,
                      background: leg.action === 'SELL' ? '#FCEBEB' : '#EAF3DE',
                      color:      leg.action === 'SELL' ? '#A32D2D'  : '#3B6D11' }}>
                      {leg.action}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--text1)' }}>
                        {symbol} {leg.strike} {leg.type}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                        {leg.role}{leg.iv ? ` · IV ${leg.iv}%` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 600,
                        color: leg.action === 'SELL' ? 'var(--green)' : 'var(--red)' }}>
                        {leg.action === 'SELL' ? '+' : '−'}{leg.premium}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        pts &nbsp;{leg.action === 'SELL' ? 'credit' : 'debit'}
                      </div>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg3)', borderTop: '0.5px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 1 }}>Net credit</div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>{lots} lot{lots !== 1 ? 's' : ''} × {form.lot_size} units</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15,
                      color: net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {net >= 0 ? '+' : ''}{net.toFixed(1)} pts
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
                      ₹{Math.round(net * Number(form.lot_size) * lots).toLocaleString('en-IN')}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )
        })() : null}

        <SectionTitle>Payoff at expiry</SectionTitle>
        <PayoffChart form={form} lots={lots} />

        {result && (
          <>
            <SectionTitle>P&L breakdown</SectionTitle>
            <div className="card" style={{ marginBottom: 8 }}>
              {[
                { label: 'Gross premium',           val: fmt.inr(result.gross),                                              color: 'var(--green)' },
                { label: 'Brokerage (4 orders)',     val: `−${fmt.inr(result.costs?.brokerage)}`,                            color: 'var(--red)' },
                { label: 'STT (expiry day)',         val: `−${fmt.inr(result.costs?.stt)}`,                                  color: 'var(--red)' },
                { label: 'Exchange + SEBI charges',  val: `−${fmt.inr(result.costs?.exchange + result.costs?.sebi)}`,        color: 'var(--red)' },
                { label: 'GST on brokerage',         val: `−${fmt.inr(result.costs?.gst)}`,                                  color: 'var(--red)' },
              ].map((row, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '0.5px solid var(--border)', fontSize: 12 }}>
                  <span style={{ color: 'var(--text2)' }}>{row.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: row.color }}>{row.val}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, fontSize: 13, fontWeight: 500, borderTop: '0.5px solid var(--border)', marginTop: 4 }}>
                <span>Net premium (actual)</span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{fmt.inr(result.net)}</span>
              </div>
            </div>

            <SectionTitle>Key levels</SectionTitle>
            <div className="stat-grid-2">
              <StatCard label="Take profit (50%)" value={fmt.inr(result.take_profit)} valueColor="var(--amber)" sub={`${Math.round(result.net_premium / 2)} pts captured`} />
              <StatCard label="Stop loss (2×)"    value={fmt.inr(result.stop_loss)}   valueColor="var(--red)"   sub={`${result.net_premium * 2} pts loss`} />
              <StatCard label="Break-even upper"  value={fmt.price(result.be_upper)}  />
              <StatCard label="Break-even lower"  value={fmt.price(result.be_lower)}  />
            </div>
          </>
        )}
      </div>

    </div>
  )
}
