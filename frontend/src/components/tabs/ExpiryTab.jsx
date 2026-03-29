import { useState, useEffect } from 'react'
import { useApi } from '../../hooks/useApi.js'
import { useTicker } from '../../hooks/useTicker.js'
import { api } from '../../utils/api.js'
import { fmt, chgColor } from '../../utils/formatters.js'
import { SectionTitle, Loading, ErrorMsg, SignalRow } from '../ui/index.jsx'

// ── Helpers ───────────────────────────────────────────────────────────────────
function Dot({ ok }) {
  return (
    <span style={{
      width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
      background: ok ? 'var(--green)' : 'var(--red)',
    }} />
  )
}

function MetricCard({ label, value, sub, valueColor }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value" style={{ color: valueColor || 'var(--text1)' }}>{value ?? '—'}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

function useNextExpiry(nextExpiryIso) {
  const calc = () => {
    if (!nextExpiryIso) return null
    const now    = new Date()
    const target = new Date(nextExpiryIso + 'T15:30:00+05:30')
    const diffMs = target - now
    if (diffMs <= 0) return 'Expired'
    const days = Math.floor(diffMs / 86400000)
    const hrs  = Math.floor((diffMs % 86400000) / 3600000)
    if (days > 0) return `${days}d ${hrs}h to expiry`
    return `${hrs}h to expiry`
  }
  const [label, setLabel] = useState(calc)
  useEffect(() => {
    setLabel(calc())
    const id = setInterval(() => setLabel(calc()), 60000)
    return () => clearInterval(id)
  }, [nextExpiryIso])
  return label
}

function useTimeToExpiry() {
  const calc = () => {
    const now = new Date()
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const nowMins    = ist.getHours() * 60 + ist.getMinutes()
    const expiryMins = 15 * 60 + 30  // 3:30 PM IST
    if (nowMins >= expiryMins) return 'Expired'
    if (nowMins < 9 * 60 + 15) return 'Market not open yet'
    const diffMs = (expiryMins - nowMins) * 60000
    const h = Math.floor(diffMs / 3600000)
    const m = Math.floor((diffMs % 3600000) / 60000)
    return h > 0 ? `${h}h ${m}m to expiry` : `${m}m to expiry`
  }

  const [label, setLabel] = useState(calc)
  useEffect(() => {
    const id = setInterval(() => setLabel(calc()), 60000)
    return () => clearInterval(id)
  }, [])
  return label
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ExpiryTab() {
  const { data: d, loading, error } = useApi(() => api.expirySignal(), [], 'expiry-signal', 5 * 60 * 1000)
  const { data: lv }                = useApi(() => api.expiryLive(),   [], 'expiry-live',   60 * 1000)
  const tickerSpot                  = useTicker('NIFTY 50')
  const exitLabel                   = useTimeToExpiry()
  const nextExpiryLabel             = useNextExpiry(d?.next_expiry)

  if (loading) return <Loading type="expiry" />
  if (error)   return <ErrorMsg message={error} />
  if (!d)      return null

  const signal     = d.signal || '—'
  const isSkip     = signal === 'Skip'
  const strategy   = d.strategy || {}
  const strikes    = strategy.strikes || {}
  const isDir      = strategy.directional === true
  const confidence = strategy.confidence || 0
  const lots       = strategy.lots || 1

  const signalColor = isSkip
    ? 'var(--red)'
    : confidence >= 65 ? 'var(--green)' : 'var(--amber)'

  const spot = tickerSpot ?? lv?.spot?.price ?? d.max_pain ?? 0
  const spotChange = lv?.spot?.change ?? 0

  // ── Metric helpers ────────────────────────────────────────────────────────
  const vixColor   = d.vix > 20 ? 'var(--red)' : d.vix > 16 ? 'var(--amber)' : 'var(--green)'
  const ivrColor   = d.ivr >= 50 ? 'var(--green)' : d.ivr >= 30 ? 'var(--amber)' : 'var(--red)'
  const pcrColor   = d.pcr >= 1.1 ? 'var(--green)' : d.pcr >= 0.8 ? 'var(--text1)' : 'var(--red)'
  const riskColor  = d.risk_score <= 4 ? 'var(--green)' : d.risk_score <= 6 ? 'var(--amber)' : 'var(--red)'

  // Legs to display based on strategy
  const legs = isDir
    ? signal === 'Bear Call Spread'
      ? [
          { action: 'SELL', label: 'Short CE (OTM)', strike: strikes.short_ce },
          { action: 'BUY',  label: 'Hedge CE (OTM)', strike: strikes.long_ce  },
        ]
      : [
          { action: 'SELL', label: 'Short PE (OTM)', strike: strikes.short_pe },
          { action: 'BUY',  label: 'Hedge PE (OTM)', strike: strikes.long_pe  },
        ]
    : [
        { action: 'SELL', label: 'ATM Call',   strike: strikes.short_ce ?? d.max_pain },
        { action: 'SELL', label: 'ATM Put',    strike: strikes.short_pe ?? d.max_pain },
        { action: 'BUY',  label: 'Wing Call',  strike: strikes.long_ce  ?? (d.max_pain + 100) },
        { action: 'BUY',  label: 'Wing Put',   strike: strikes.long_pe  ?? (d.max_pain - 100) },
      ]

  return (
    <div>

      {/* ── Next expiry countdown (non-expiry days) ────────────────────── */}
      {!d.is_expiry_today && d.next_expiry && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 12px', marginBottom: 10, borderRadius: 8, background: 'var(--bg2)', border: '0.5px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>
            Next expiry <span style={{ color: 'var(--text1)', fontWeight: 600 }}>
              {new Date(d.next_expiry + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>{nextExpiryLabel}</div>
        </div>
      )}

      {/* ── 1. Signal card ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>

          {/* Left: signal name + subtitle */}
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 6 }}>
              This week's signal
            </div>
            <div style={{ fontSize: 28, fontWeight: 600, color: signalColor, letterSpacing: '-0.01em' }}>
              {signal}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>
              {isSkip
                ? (strategy.why || 'Conditions unfavourable this week')
                : isDir
                  ? `${strategy.direction || ''} bias · ${lots} lot${lots > 1 ? 's' : ''}`
                  : `${fmt.price(d.max_pain)} ATM · ${lots} lot${lots > 1 ? 's' : ''} · Entry 9:45–10:15`}
            </div>
          </div>

          {/* Right: conviction + risk */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', marginBottom: 4 }}>
              Conviction
            </div>
            <div style={{ fontSize: 30, fontWeight: 600, color: signalColor }}>
              {confidence}%
            </div>
            <div style={{ fontSize: 10, color: riskColor, marginTop: 2, fontWeight: 600, position: 'relative', display: 'inline-block', cursor: 'default' }}
              onMouseEnter={e => { const t = e.currentTarget.querySelector('.risk-tooltip'); if (t) t.style.display = 'block' }}
              onMouseLeave={e => { const t = e.currentTarget.querySelector('.risk-tooltip'); if (t) t.style.display = 'none' }}
            >
              Event risk {d.risk_score ?? '—'}/10
              {(d.sentiment?.key_risks?.length > 0) && (
                <div className="risk-tooltip" style={{
                  display: 'none', position: 'absolute', right: 0, top: '100%', marginTop: 6,
                  background: 'var(--bg3)', border: '0.5px solid var(--border)',
                  borderRadius: 8, padding: '8px 12px', zIndex: 50,
                  minWidth: 200, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                }}>
                  <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', marginBottom: 5 }}>
                    Key risks this week
                  </div>
                  {d.sentiment.key_risks.map((r, i) => (
                    <div key={i} style={{ fontSize: 11, color: 'var(--text1)', lineHeight: 1.5, display: 'flex', gap: 6, marginBottom: 3 }}>
                      <span style={{ color: 'var(--red)', flexShrink: 0 }}>·</span>{r}
                    </div>
                  ))}
                  {d.sentiment.key_positives?.length > 0 && (
                    <>
                      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', margin: '8px 0 5px' }}>
                        Positives
                      </div>
                      {d.sentiment.key_positives.map((p, i) => (
                        <div key={i} style={{ fontSize: 11, color: 'var(--text1)', lineHeight: 1.5, display: 'flex', gap: 6, marginBottom: 3 }}>
                          <span style={{ color: 'var(--green)', flexShrink: 0 }}>·</span>{p}
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Skip diagnostics */}
        {isSkip && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--border)', display: 'flex', gap: 16, fontSize: 10, color: 'var(--text3)' }}>
            <span>VIX <span style={{ color: 'var(--text1)', fontWeight: 600 }}>{d.vix != null ? Number(d.vix).toFixed(1) : '—'}</span></span>
            <span>IVR <span style={{ color: 'var(--text1)', fontWeight: 600 }}>{d.ivr != null ? Math.round(d.ivr) : '—'}</span></span>
            <span>PCR <span style={{ color: 'var(--text1)', fontWeight: 600 }}>{d.pcr != null ? Number(d.pcr).toFixed(2) : '—'}</span></span>
            <span>Risk <span style={{ color: 'var(--text1)', fontWeight: 600 }}>{d.risk_score ?? '—'}/10</span></span>
            <span>Score <span style={{ color: 'var(--text1)', fontWeight: 600 }}>{strategy.conviction_score != null ? `${strategy.conviction_score > 0 ? '+' : ''}${strategy.conviction_score}` : '—'}</span></span>
          </div>
        )}

        {/* Size advice */}
        {!isSkip && strategy.size_reason && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--border)', fontSize: 11, color: 'var(--text2)' }}>
            <span style={{ fontWeight: 600, color: signalColor }}>Sizing: </span>
            {strategy.size_reason}
          </div>
        )}
      </div>

      {/* ── 2. Key metrics ─────────────────────────────────────────────── */}
      <div className="stat-grid-4" style={{ marginBottom: 10 }}>
        <MetricCard label="India VIX"  value={d.vix != null ? Number(d.vix).toFixed(1) : '—'} sub={d.vix <= 14 ? 'Very calm' : d.vix <= 18 ? 'Calm' : 'Elevated'} valueColor={vixColor} />
        <MetricCard label="IVR"        value={d.ivr != null ? `${Math.round(d.ivr)}` : '—'}   sub={d.ivr >= 50 ? 'Good premium' : 'Low premium'}                         valueColor={ivrColor} />
        <MetricCard label="PCR"        value={d.pcr != null ? Number(d.pcr).toFixed(2) : '—'} sub={d.pcr >= 1.1 ? 'Bullish OI' : d.pcr >= 0.8 ? 'Neutral OI' : 'Bearish OI'} valueColor={pcrColor} />
        <MetricCard label="Max Pain"   value={d.max_pain ? fmt.price(d.max_pain) : '—'}       sub="Strike gravity" />
      </div>

      {/* ── 3. OI walls ────────────────────────────────────────────────── */}
      {d.walls && (d.walls.call_wall || d.walls.put_wall) && (
        <>
          <SectionTitle>OI walls</SectionTitle>
          <div className="stat-grid-2" style={{ marginBottom: 10 }}>
            <MetricCard
              label="Call wall (resistance)"
              value={d.walls.call_wall ? fmt.price(d.walls.call_wall) : '—'}
              sub={d.walls.distance_to_resist != null ? `${Math.round(d.walls.distance_to_resist)} pts away` : ''}
              valueColor="var(--red)"
            />
            <MetricCard
              label="Put wall (support)"
              value={d.walls.put_wall ? fmt.price(d.walls.put_wall) : '—'}
              sub={d.walls.distance_to_support != null ? `${Math.round(d.walls.distance_to_support)} pts away` : ''}
              valueColor="var(--green)"
            />
          </div>
        </>
      )}

      {/* ── 4. Suggested structure ─────────────────────────────────────── */}
      {!isSkip && (
        <>
          <SectionTitle>Suggested structure</SectionTitle>
          <div className="stat-grid-2" style={{ marginBottom: 10 }}>
            {legs.map((leg, i) => (
              <div key={i} className="stat-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)' }}>{leg.label}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                    background: leg.action === 'SELL' ? 'rgba(255,79,79,0.14)' : 'rgba(0,212,140,0.14)',
                    color:      leg.action === 'SELL' ? 'var(--red)' : 'var(--green)',
                  }}>{leg.action}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text1)' }}>
                  {leg.strike ? fmt.price(leg.strike) : '—'}
                </div>
              </div>
            ))}
          </div>
          {strikes.note && (
            <div style={{ fontSize: 11, color: 'var(--text3)', padding: '6px 10px', background: 'var(--bg2)', borderRadius: 6, marginBottom: 10 }}>
              {strikes.note}
            </div>
          )}
        </>
      )}

      {/* ── 4b. Break-even & risk/reward ────────────────────────────────── */}
      {d.breakeven && (
        <>
          <SectionTitle>Break-even & risk/reward</SectionTitle>
          <div className="card" style={{ marginBottom: 10 }}>
            {d.breakeven.breakeven != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--border)', fontSize: 12 }}>
                <span style={{ color: 'var(--text2)' }}>Break-even</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--amber)' }}>{fmt.price(d.breakeven.breakeven)}</span>
              </div>
            )}
            {d.breakeven.breakeven_up != null && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--border)', fontSize: 12 }}>
                  <span style={{ color: 'var(--text2)' }}>Upper break-even</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--red)' }}>{fmt.price(d.breakeven.breakeven_up)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--border)', fontSize: 12 }}>
                  <span style={{ color: 'var(--text2)' }}>Lower break-even</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--green)' }}>{fmt.price(d.breakeven.breakeven_down)}</span>
                </div>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '0.5px solid var(--border)', fontSize: 12 }}>
              <span style={{ color: 'var(--text2)' }}>Max profit (per lot)</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--green)' }}>
                {d.breakeven.max_profit != null ? `₹${Math.round(d.breakeven.max_profit * (d.lot_size || 25))}` : '—'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: d.breakeven.note ? '0.5px solid var(--border)' : 'none', fontSize: 12 }}>
              <span style={{ color: 'var(--text2)' }}>Max loss (per lot)</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--red)' }}>
                {d.breakeven.max_loss != null ? `₹${Math.round(d.breakeven.max_loss * (d.lot_size || 25))}` : '—'}
              </span>
            </div>
            {d.breakeven.note && (
              <div style={{ paddingTop: 8, fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>{d.breakeven.note}</div>
            )}
          </div>
        </>
      )}

      {/* ── Exit guidance — always shown ─────────────────────────────────── */}
      <SectionTitle>Exit & stop-loss guidance</SectionTitle>
      <div className="card" style={{ marginBottom: 10 }}>
        {[
          { label: 'Target exit time', val: 'Square off by 2:30–3:00 PM IST on expiry day. Premium decay accelerates after 12 PM but so does gamma risk — don\'t overstay.' },
          { label: 'Profit target',    val: 'Take 50% of max profit early if it becomes available. Don\'t be greedy into close — theta works for you, gamma works against you.' },
          { label: 'Stop-loss',        val: isDir
              ? 'Exit if NIFTY moves beyond your short strike by 50+ pts intraday. Max loss = (spread width − net credit received) × lot size.'
              : isSkip
              ? 'No active trade this week. If you\'re holding positions from a prior week, exit if net loss reaches 1× the original premium collected.'
              : 'Exit if net loss equals 1× the premium collected. Never let a premium-selling trade become a runaway loss.' },
          { label: 'Breach rule',      val: isDir
              ? 'If spot closes above your short CE (Bear Call Spread) or below your short PE (Bull Put Spread) — exit immediately. Do not hold overnight with a breached short.'
              : isSkip
              ? 'General rule: if the index breaks a major OI wall (call or put), that level is no longer valid — reassess before holding any spread.'
              : 'If NIFTY breaks through either OI wall (call or put), close the breached side of your spread immediately and evaluate the other.' },
        ].map((row, i, arr) => (
          <div key={i} style={{ padding: '7px 0', borderBottom: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text2)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{row.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text1)', lineHeight: 1.6 }}>{row.val}</div>
          </div>
        ))}
      </div>

      {/* ── 5. Signal convergence ──────────────────────────────────────── */}
      <SectionTitle>Signal breakdown</SectionTitle>

      {/* Legend */}
      <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6, background: 'var(--bg2)', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
        Each signal votes on market direction. <span style={{ color: 'var(--green)', fontWeight: 500 }}>Green</span> = favourable for the recommended strategy. <span style={{ color: 'var(--red)', fontWeight: 500 }}>Red</span> = headwind. The net conviction score combines all votes — higher absolute value = stronger edge.
      </div>

      <div className="card" style={{ marginBottom: 10, padding: 0, overflow: 'hidden' }}>
        {(strategy.signals_detail?.length > 0
          ? strategy.signals_detail
          : [
              { label: 'India VIX',      value: d.vix  != null ? Number(d.vix).toFixed(1)  : '—', ok: (d.vix  || 99) <= 18,
                note: 'Volatility index. Below 14 = calm market (Iron Fly/Condor work well). 14–20 = normal. Above 20 = elevated — consider directional spread only. Above 25 = extreme — stay cautious.' },
              { label: 'IVR',            value: d.ivr  != null ? `${Math.round(d.ivr)}`     : '—', ok: (d.ivr  ||  0) >= 40,
                note: 'IV Rank — where current implied volatility sits vs the past year. Above 40 = options are expensive, good time to sell premium. Below 20 = options are cheap, selling is not worth the risk.' },
              { label: 'PCR',            value: d.pcr  != null ? Number(d.pcr).toFixed(2)   : '—', ok: (d.pcr  ||  0) >= 0.9,
                note: 'Put-Call Ratio = total put OI ÷ call OI. Above 1.2 = more puts written than calls → bulls defending support, bullish. Below 0.8 = more calls written → bears defending resistance, bearish.' },
              { label: 'Event risk',     value: d.risk_score != null ? `${d.risk_score}/10` : '—', ok: (d.risk_score || 9) <= 5,
                note: 'News & macro risk score (0–10). Based on scheduled events (RBI, Fed, GDP, elections) + geopolitical news. Above 7 = avoid neutral strategies; above 9 = no trade.' },
              { label: 'FII net futures', value: d.fii_net != null ? `${d.fii_net > 0 ? '+' : ''}${Math.round(d.fii_net / 100) / 10}K Cr` : '—', ok: (d.fii_net || 0) >= 0,
                note: 'Foreign institutional investor positioning in index futures (in ₹ Cr). Positive = FIIs net long (bullish smart money). Negative = FIIs net short (smart money selling). Strong predictor of direction.' },
              { label: 'GIFT Nifty gap', value: d.gift_nifty?.gap_pts != null ? `${d.gift_nifty.gap_pts >= 0 ? '+' : ''}${d.gift_nifty.gap_pts} pts` : '—', ok: (d.gift_nifty?.gap_pts || 0) >= -30,
                note: 'GIFT Nifty (Singapore SGX) trades overnight and indicates how Nifty will open. A large gap-up/down invalidates pre-set strikes and increases gap risk. Neutral within ±30 pts.' },
            ]
        ).map((sig, i, arr) => (
          <div key={i} style={{
            padding: '10px 14px',
            borderBottom: i < arr.length - 1 ? '0.5px solid var(--border)' : 'none',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
          }}>
            {/* Left: dot + label + explanation */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
              <div style={{ paddingTop: 2, flexShrink: 0 }}><Dot ok={sig.ok} /></div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text1)', marginBottom: 2 }}>{sig.label}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.55 }}>{sig.note}</div>
              </div>
            </div>
            {/* Right: value */}
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: sig.ok ? 'var(--green)' : 'var(--red)' }}>{sig.value}</div>
              <div style={{ fontSize: 9, marginTop: 2, color: sig.ok ? 'var(--green)' : 'var(--red)', opacity: 0.7 }}>{sig.ok ? 'Favourable' : 'Headwind'}</div>
            </div>
          </div>
        ))}

        {/* Conviction total */}
        {strategy.conviction_score != null && (
          <div style={{ padding: '10px 14px', borderTop: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg3)' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Net conviction score</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                {Math.abs(strategy.conviction_score) >= 5 ? 'Very strong directional edge' :
                 Math.abs(strategy.conviction_score) >= 3 ? 'Moderate edge — trade with normal size' :
                 'Weak — reduce size or skip'}
              </div>
            </div>
            <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)',
              color: strategy.conviction_score > 3 ? 'var(--green)' : strategy.conviction_score < -3 ? 'var(--red)' : 'var(--text2)' }}>
              {strategy.conviction_score > 0 ? `+${strategy.conviction_score}` : strategy.conviction_score}
            </span>
          </div>
        )}
      </div>

      {/* ── 6. AI reasoning ────────────────────────────────────────────── */}
      {d.reasoning && (
        <>
          <SectionTitle>AI reasoning</SectionTitle>
          <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, background: 'var(--bg2)', borderLeft: '2px solid var(--green)', padding: '10px 14px', borderRadius: '0 6px 6px 0', marginBottom: 10 }}>
            {d.reasoning}
          </div>
        </>
      )}

      {/* ── 7. Live spot & levels (expiry day only) ────────────────────── */}
      {d.is_expiry_today && (
        <>
          <SectionTitle>Live — expiry day</SectionTitle>
          <div className="card" style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 4 }}>NIFTY spot</div>
                <div style={{ fontSize: 36, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text1)', lineHeight: 1 }}>
                  {fmt.price(spot)}
                </div>
                {spotChange !== 0 && (
                  <div style={{ fontSize: 12, color: chgColor(spotChange), marginTop: 4 }}>
                    {spotChange > 0 ? '▲' : '▼'} {Math.abs(Math.round(spotChange))} pts
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--amber)', fontFamily: 'var(--font-mono)' }}>
                  {exitLabel}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Expiry at 3:30 PM IST</div>
              </div>
            </div>

            {/* Key levels row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, paddingTop: 10, borderTop: '0.5px solid var(--border)' }}>
              {[
                { label: 'Max pain',   value: d.max_pain ? fmt.price(d.max_pain) : '—',              color: 'var(--text1)' },
                { label: 'Call wall',  value: d.walls?.call_wall ? fmt.price(d.walls.call_wall) : '—', color: 'var(--red)' },
                { label: 'Put wall',   value: d.walls?.put_wall  ? fmt.price(d.walls.put_wall)  : '—', color: 'var(--green)' },
              ].map(item => (
                <div key={item.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', marginBottom: 3 }}>{item.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)', color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

    </div>
  )
}
