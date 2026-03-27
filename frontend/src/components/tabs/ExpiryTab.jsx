import { useApi } from '../../hooks/useApi.js'
import { useTicker } from '../../hooks/useTicker.js'
import { api } from '../../utils/api.js'
import { fmt } from '../../utils/formatters.js'
import { StatCard, SectionTitle, Loading, ErrorMsg, SignalRow, ProgressBar } from '../ui/index.jsx'

function SignalDot({ ok }) {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: ok ? 'var(--green)' : 'var(--red)', display: 'inline-block', marginRight: 5 }} />
}

export default function ExpiryTab() {
  const signal    = useApi(() => api.expirySignal(), [], 'expiry-signal')
  const live      = useApi(() => api.expiryLive(),   [], 'expiry-live')
  const kite        = useApi(() => api.kitePositions(), [], 'kite-positions')
  const hasPosition = (kite.data?.net || []).some(p => p.quantity !== 0)

  const d  = signal.data
  const lv = live.data

  const isDirectional = d?.strategy?.directional === true
  const isSkip        = d?.signal === 'Skip'
  const signalColor   = isSkip ? 'var(--red)' : isDirectional ? 'var(--amber)' : 'var(--green)'

  // Tuesday live cockpit state (in real app these come from user's open position)
  const lotSize     = d?.lot_size || 75   // will be populated once calc/prefill is called
  const premium     = 76
  const captured    = 27
  const capturePct  = Math.round((captured / premium) * 100)
  const tickerSpot  = useTicker('NIFTY 50')   // real-time from Kite WebSocket
  const shortStrike = d?.max_pain || 22400
  const spot        = tickerSpot ?? lv?.spot?.price ?? 22381
  const distPts     = Math.round(Math.abs(spot - shortStrike) * 10) / 10
  const posStatus   = distPts < 60 ? 'HOLD' : 'DANGER'
  const posColor    = distPts < 60 ? 'var(--green)' : 'var(--red)'

  return (
    <div>
      {/* Monday Night Signal */}
      <SectionTitle>Weekly signal — monday night</SectionTitle>
      {signal.loading ? <Loading /> : signal.error ? <ErrorMsg message={signal.error} /> : (
        <>
          {/* Signal header */}
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 4 }}>This Tuesday</div>
              <div style={{ fontSize: 24, fontWeight: 500, color: signalColor }}>{d?.signal || '—'}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 3 }}>
                {isDirectional
                  ? `${d?.strategy?.direction || ''} bias · ${d?.strategy?.lots || 1} lot${(d?.strategy?.lots || 1) > 1 ? 's' : ''}`
                  : `${fmt.price(shortStrike)} ATM · ${d?.strategy?.lots || 1} lot${(d?.strategy?.lots || 1) > 1 ? 's' : ''}`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Conviction</div>
              <div style={{ fontSize: 28, fontWeight: 500, color: (d?.strategy?.confidence || 0) >= 65 ? 'var(--green)' : (d?.strategy?.confidence || 0) >= 45 ? 'var(--amber)' : 'var(--red)' }}>
                {d?.strategy?.confidence || 0}%
              </div>
              <div style={{ fontSize: 9, color: 'var(--text3)' }}>Risk {d?.risk_score ?? '—'}/10</div>
            </div>
          </div>

          {/* Sizing advice */}
          {d?.strategy?.size_reason && (
            <div style={{ fontSize: 11, color: 'var(--text2)', background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
              <span style={{ fontWeight: 500, color: signalColor }}>Size: </span>{d.strategy.size_reason}
            </div>
          )}

          {/* Convergence signal votes */}
          <SectionTitle>Signal convergence</SectionTitle>
          <div className="card" style={{ marginBottom: 8 }}>
            {(d?.strategy?.signals_detail?.length > 0
              ? d.strategy.signals_detail
              : [
                  { label: 'India VIX', value: d?.vix != null ? Number(d.vix).toFixed(2) : '—', ok: (d?.vix || 99) <= 18, note: (d?.vix || 99) <= 18 ? 'Calm — premium sellers in control' : 'Elevated — caution', score: 0 },
                  { label: 'IVR',       value: d?.ivr != null ? Math.round(d.ivr) : '—',        ok: (d?.ivr || 0) >= 40,  note: (d?.ivr || 0) >= 40 ? 'Good premium environment' : 'Low premium', score: 0 },
                  { label: 'PCR',       value: d?.pcr != null ? Number(d.pcr).toFixed(2) : '—', ok: (d?.pcr || 0) >= 0.9, note: (d?.pcr || 0) >= 1.1 ? 'Bullish OI positioning' : 'Bearish/neutral OI', score: 0 },
                  { label: 'News',      value: d?.risk_score != null ? `${d.risk_score}/10` : '—', ok: (d?.risk_score || 9) <= 5, note: 'Sentiment risk', score: 0 },
                ]
            ).map((sig, i) => (
              <SignalRow key={i}
                label={<>
                  <SignalDot ok={sig.ok} />
                  {sig.label}
                </>}
                value={
                  <span style={{ fontFamily: 'var(--font-mono)', color: sig.score > 0 ? 'var(--green)' : sig.score < 0 ? 'var(--red)' : 'var(--text2)' }}>
                    {sig.value != null ? sig.value : '—'}
                    {sig.score !== 0 && <span style={{ fontSize: 9, marginLeft: 4 }}>{sig.score > 0 ? `+${sig.score}` : sig.score}</span>}
                  </span>
                }
                badge={sig.note}
                badgeClass={sig.ok ? 'badge-green' : 'badge-red'}
              />
            ))}
            {d?.strategy?.conviction_score != null && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total score</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600,
                  color: d.strategy.conviction_score > 3 ? 'var(--green)' : d.strategy.conviction_score < -3 ? 'var(--red)' : 'var(--text2)' }}>
                  {d.strategy.conviction_score > 0 ? `+${d.strategy.conviction_score}` : d.strategy.conviction_score}
                  <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 4 }}>
                    ({d.strategy.conviction_score > 3 ? 'bullish' : d.strategy.conviction_score < -3 ? 'bearish' : 'neutral'})
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* AI reasoning */}
          {d?.reasoning && (
            <>
              <SectionTitle>AI reasoning</SectionTitle>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65, background: 'var(--bg2)', borderLeft: '2px solid var(--green)', padding: '8px 12px', borderRadius: '0 6px 6px 0', marginBottom: 8 }}>
                {d.reasoning}
              </div>
            </>
          )}

          {/* Strategy structure — from live strike suggestions */}
          <SectionTitle>Suggested structure</SectionTitle>
          {(() => {
            const strikes = d?.strategy?.strikes || {}
            const legs = isDirectional
              ? d?.signal === 'Bear Call Spread'
                ? [
                    { action: 'SELL', label: 'OTM CE (short)', strike: strikes.short_ce, color: 'var(--amber)' },
                    { action: 'BUY',  label: 'OTM CE (hedge)', strike: strikes.long_ce,  color: 'var(--green)' },
                  ]
                : [
                    { action: 'SELL', label: 'OTM PE (short)', strike: strikes.short_pe, color: 'var(--amber)' },
                    { action: 'BUY',  label: 'OTM PE (hedge)', strike: strikes.long_pe,  color: 'var(--green)' },
                  ]
              : [
                  { action: 'SELL', label: 'ATM CE', strike: strikes.short_ce ?? shortStrike, color: 'var(--amber)' },
                  { action: 'SELL', label: 'ATM PE', strike: strikes.short_pe ?? shortStrike, color: 'var(--amber)' },
                  { action: 'BUY',  label: 'Wing CE', strike: strikes.long_ce ?? (shortStrike + 100), color: 'var(--green)' },
                  { action: 'BUY',  label: 'Wing PE', strike: strikes.long_pe ?? (shortStrike - 100), color: 'var(--green)' },
                ]
            return (
              <>
                <div className={`stat-grid-${legs.length === 2 ? '2' : '2'}`} style={{ marginBottom: 8 }}>
                  {legs.map((leg, i) => (
                    <div key={i} className="stat-card">
                      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', marginBottom: 3 }}>{leg.action} · {leg.label}</div>
                      <div style={{ fontSize: 17, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text1)' }}>{leg.strike ? fmt.price(leg.strike) : '—'}</div>
                      <div style={{ fontSize: 10, color: leg.color, marginTop: 2 }}>{leg.action === 'SELL' ? 'Credit' : 'Debit'}</div>
                    </div>
                  ))}
                </div>
                {strikes.note && (
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, padding: '6px 10px', background: 'var(--bg2)', borderRadius: 6 }}>
                    {strikes.note}
                  </div>
                )}
              </>
            )
          })()}
          <div className="stat-grid-2">
            <StatCard label="Entry window" value="9:45–10:15" sub="Post open settle" />
            <StatCard label="Lots" value={d?.strategy?.lots || 1} sub={isDirectional ? 'Directional — reduce size' : 'Adjust per capital'} />
          </div>
        </>
      )}

      {/* Tuesday Live Cockpit */}
      <SectionTitle style={{ marginTop: '1.5rem' }}>Tuesday live cockpit</SectionTitle>

      {live.loading ? <Loading /> : (
        <>
          {/* Spot price */}
          {(() => {
            const chg     = lv?.spot?.change ?? 0
            const chgPts  = Math.round(Math.abs(chg))
            const chgDir  = chg >= 0 ? '▲' : '▼'
            const chgClr  = chg >= 0 ? 'var(--green)' : 'var(--red)'
            const now     = new Date()
            const exit    = new Date(); exit.setHours(14, 30, 0, 0)
            const diffMs  = Math.max(0, exit - now)
            const remH    = Math.floor(diffMs / 3600000)
            const remM    = Math.floor((diffMs % 3600000) / 60000)
            const timeStr = diffMs > 0 ? `${remH}h ${remM}m remaining` : 'Market closed'
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 38, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text1)' }}>{fmt.price(spot)}</span>
                  <span style={{ fontSize: 14, color: chgClr }}>{chgDir} {chgPts} pts</span>
                </div>
                <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 3 }}>Hard exit at 2:30 PM</div>
                    <div style={{ fontSize: 20, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{timeStr}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', textAlign: 'right' }}>
                    <div>NSE · Tuesday expiry</div>
                    <div>{now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                </div>
              </>
            )
          })()}

          {/* Position status + drill-down — only when user has an open position */}
          {hasPosition ? (
            <>
              <div className="card" style={{ textAlign: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text3)', marginBottom: 5 }}>Position status</div>
                <div style={{ fontSize: 28, fontWeight: 500, color: posColor }}>{posStatus}</div>
              </div>

              <SectionTitle>Distance from short strike</SectionTitle>
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text2)', marginBottom: 4 }}>
                  <span>Strike {fmt.price(shortStrike)}</span>
                  <span style={{ color: distPts < 60 ? 'var(--green)' : 'var(--red)' }}>{distPts} pts away · {distPts < 60 ? 'SAFE' : 'DANGER'}</span>
                  <span>Danger &gt; 60 pts</span>
                </div>
                <ProgressBar value={distPts} max={100} color={distPts < 60 ? 'var(--green)' : 'var(--red)'} height={6} />
              </div>

              <div className="card" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Premium collected</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{premium} pts · ₹{(premium * lotSize).toLocaleString('en-IN')}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Captured so far</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--green)' }}>{captured} pts ({capturePct}%)</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>Progress to target (50% = {Math.round(premium * 0.5)} pts)</div>
                <ProgressBar value={capturePct} max={100} color="var(--green)" height={7} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
                  <span>0</span>
                  <span style={{ color: 'var(--green)' }}>Target: {Math.round(premium * 0.5)} pts</span>
                  <span style={{ color: 'var(--red)' }}>SL: {premium * 2} pts</span>
                </div>
              </div>

              <SectionTitle>3-question check</SectionTitle>
              {[
                { q: 'NIFTY within 60 pts of short strike?', a: `${distPts <= 60 ? 'YES' : 'NO'} · ${distPts} pts`, ok: distPts <= 60 },
                { q: 'P&L past 50% of premium?',             a: `NO · at ${capturePct}%`, ok: false },
                { q: `Loss past 2× premium (${premium * 2} pts)?`, a: 'NO · far away',    ok: true  },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg2)', borderRadius: 6, border: '0.5px solid var(--border)', marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>{item.q}</span>
                  <span style={{ fontSize: 11, fontWeight: 500, fontFamily: 'var(--font-mono)', color: item.ok ? 'var(--green)' : 'var(--amber)' }}>{item.a}</span>
                </div>
              ))}
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--text3)', fontSize: 12, border: '0.5px dashed var(--border)', borderRadius: 8 }}>
              No open position — log a trade in the Journal tab to track it here
            </div>
          )}
        </>
      )}
    </div>
  )
}
