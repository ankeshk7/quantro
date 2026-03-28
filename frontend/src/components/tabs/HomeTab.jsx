import { useState, useRef, useEffect } from 'react'
import { useApi } from '../../hooks/useApi.js'
import { useTicker, useTickerConnected } from '../../hooks/useTicker.js'
import { api } from '../../utils/api.js'
import { fmt, chgColor, impactBadge } from '../../utils/formatters.js'
import { StatCard, SectionTitle, Loading, ErrorMsg, SignalRow, NewsCard } from '../ui/index.jsx'

// ── Month Calendar ────────────────────────────────────────────────────────────
const IMPACT_DOT = {
  extreme:   'var(--red)',
  high:      'var(--red)',
  watch:     'var(--amber)',
  moderate:  'var(--amber)',
  trade_day: 'var(--green)',
  low:       'var(--text3)',
  clear:     'var(--bg3)',
}
const IMPACT_LABEL = {
  extreme:   'Extreme',
  high:      'High',
  watch:     'Watch',
  moderate:  'Moderate',
  trade_day: 'Trade day',
  low:       'Low',
  clear:     'Clear',
}
const IMPACT_DESC = {
  extreme:   'Major macro event — expect large intraday moves. Consider sitting out or hedging aggressively.',
  high:      'High-impact data release. Volatility likely around the announcement time.',
  watch:     'Worth watching closely. May cause moderate price swings depending on the outcome.',
  moderate:  'Moderate impact. Markets may react briefly but are likely to stabilise.',
  trade_day: 'Weekly NIFTY expiry — premium decay accelerates sharply after 12 PM. Manage positions early.',
  low:       'Low expected impact on broad indices. Normal trading conditions.',
  clear:     'No major scheduled events. Clean technical tape.',
}
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_LABELS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function MonthCalendar({ events = [] }) {
  const today    = new Date()
  const todayIso = isoDate(today)

  const [year,     setYear]     = useState(today.getFullYear())
  const [month,    setMonth]    = useState(today.getMonth())
  const [selected, setSelected] = useState(todayIso)

  // Clamp: stay within ±1 year of today
  const minYear = today.getFullYear() - 1
  const maxYear = today.getFullYear() + 1

  const prevMonth = () => {
    if (month === 0) {
      if (year <= minYear) return
      setMonth(11); setYear(y => y - 1)
    } else {
      setMonth(m => m - 1)
    }
  }
  const nextMonth = () => {
    if (month === 11) {
      if (year >= maxYear) return
      setMonth(0); setYear(y => y + 1)
    } else {
      setMonth(m => m + 1)
    }
  }

  // Build day cells for this month (including leading/trailing blanks)
  const firstDay  = new Date(year, month, 1)
  const daysInMon = new Date(year, month + 1, 0).getDate()
  const startDow  = firstDay.getDay()           // 0=Sun
  const cells     = Array(startDow).fill(null)
  for (let d = 1; d <= daysInMon; d++) cells.push(new Date(year, month, d))
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null)

  // Index events by date
  const byDate = {}
  for (const ev of events) {
    if (!byDate[ev.date]) byDate[ev.date] = []
    byDate[ev.date].push(ev)
  }

  const selEvents = byDate[selected] || []
  const selDateObj = new Date(selected + 'T12:00:00')

  // Today indicator: jump back to today's month
  const goToday = () => {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
    setSelected(todayIso)
  }

  const canPrev = !(year === minYear && month === 0)
  const canNext = !(year === maxYear && month === 11)

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>

      {/* ── Left: month grid ──────────────────────────────────── */}
      <div style={{ flex: '0 0 auto', width: 236 }}>

        {/* Month nav */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <button onClick={prevMonth} disabled={!canPrev}
            style={{ border: '0.5px solid var(--border)', background: canPrev ? 'var(--bg2)' : 'transparent', color: canPrev ? 'var(--text1)' : 'var(--text3)', borderRadius: 6, width: 28, height: 28, cursor: canPrev ? 'pointer' : 'default', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ‹
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)' }}>{MONTH_NAMES[month]}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>{year}</div>
          </div>
          <button onClick={nextMonth} disabled={!canNext}
            style={{ border: '0.5px solid var(--border)', background: canNext ? 'var(--bg2)' : 'transparent', color: canNext ? 'var(--text1)' : 'var(--text3)', borderRadius: 6, width: 28, height: 28, cursor: canNext ? 'pointer' : 'default', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ›
          </button>
        </div>

        {/* Day-of-week headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
          {DOW_LABELS.map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)', padding: '2px 0' }}>
              {d}
            </div>
          ))}
        </div>

        {/* Date cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} />
            const iso     = isoDate(d)
            const dayEvs  = byDate[iso] || []
            const isToday = iso === todayIso
            const isSel   = iso === selected
            const isPast  = iso < todayIso
            const isSun   = d.getDay() === 0
            const isSat   = d.getDay() === 6

            // pick the highest-impact event for the dot color
            const topColor = dayEvs.length
              ? (IMPACT_DOT[dayEvs[0].impact] || 'var(--text3)')
              : null

            return (
              <div key={iso} onClick={() => setSelected(iso)}
                style={{
                  textAlign: 'center',
                  borderRadius: 6,
                  padding: '4px 2px 3px',
                  cursor: 'pointer',
                  position: 'relative',
                  background: isSel
                    ? 'var(--text1)'
                    : isToday
                      ? 'var(--green)'
                      : 'transparent',
                  transition: 'background 0.12s',
                  opacity: isPast && !isToday && !isSel ? 0.45 : 1,
                }}
                onMouseEnter={e => { if (!isSel && !isToday) e.currentTarget.style.background = 'var(--bg2)' }}
                onMouseLeave={e => { if (!isSel && !isToday) e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{
                  fontSize: 11, fontWeight: isSel || isToday ? 600 : 400, lineHeight: 1.4,
                  color: isSel || isToday ? 'var(--bg)' : isSun || isSat ? 'var(--text3)' : 'var(--text2)',
                }}>
                  {d.getDate()}
                </div>
                {/* Event dot — show only if has events */}
                <div style={{ height: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, marginTop: 1 }}>
                  {dayEvs.length > 0 && (
                    <span style={{
                      width: 4, height: 4, borderRadius: '50%', display: 'inline-block',
                      background: isSel || isToday ? 'rgba(255,255,255,0.75)' : topColor,
                    }} />
                  )}
                  {dayEvs.length > 1 && (
                    <span style={{
                      width: 4, height: 4, borderRadius: '50%', display: 'inline-block',
                      background: isSel || isToday ? 'rgba(255,255,255,0.5)' : (IMPACT_DOT[dayEvs[1].impact] || 'var(--text3)'),
                    }} />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Today button */}
        {(year !== today.getFullYear() || month !== today.getMonth()) && (
          <button onClick={goToday}
            style={{ marginTop: 10, width: '100%', padding: '5px', fontSize: 10, cursor: 'pointer', borderRadius: 6, border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Today
          </button>
        )}

        {/* Legend */}
        <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
          {[
            { label: 'Expiry',   color: 'var(--green)' },
            { label: 'Watch',    color: 'var(--amber)' },
            { label: 'High/Extreme', color: 'var(--red)' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text3)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: l.color, display: 'inline-block', flexShrink: 0 }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: event detail panel ──────────────────────────── */}
      <div style={{ flex: 1, minWidth: 180 }}>
        {/* Selected date header */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)' }}>
            {selDateObj.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          {selected === todayIso && (
            <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 1, fontWeight: 500 }}>Today</div>
          )}
        </div>

        {selEvents.length === 0 ? (
          <div style={{ borderRadius: 10, border: '0.5px solid var(--border)', padding: '24px 16px', textAlign: 'center', background: 'var(--bg2)' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>📅</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 500, marginBottom: 3 }}>No events scheduled</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Clean trading day — no macro data releases.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {selEvents.map((ev, i) => (
              <div key={i} style={{
                borderRadius: 10,
                border: '0.5px solid var(--border)',
                overflow: 'hidden',
                background: 'var(--bg2)',
              }}>
                {/* Colored top bar */}
                <div style={{ height: 3, background: IMPACT_DOT[ev.impact] || 'var(--text3)' }} />
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text1)', lineHeight: 1.3, flex: 1, marginRight: 8 }}>{ev.event}</span>
                    <span className={`badge ${impactBadge(ev.impact)}`} style={{ flexShrink: 0 }}>{IMPACT_LABEL[ev.impact] || ev.impact}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.65 }}>
                    {IMPACT_DESC[ev.impact] || ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

function usePriceFlash(price) {
  const prev  = useRef(null)
  const [cls, setCls] = useState(null)
  useEffect(() => {
    if (price == null) return
    if (prev.current !== null && price !== prev.current) {
      const dir = price > prev.current ? 'flash-up' : 'flash-down'
      setCls(dir)
      const t = setTimeout(() => setCls(null), 900)
      prev.current = price
      return () => clearTimeout(t)
    }
    prev.current = price
  }, [price])
  return cls
}

export default function HomeTab() {
  const { data, loading, error } = useApi(() => api.home(), [], 'home')
  const kiteStatus   = useApi(() => api.kiteStatus(), [], 'kite-status')
  const tickerLive   = useTickerConnected()
  const [connecting, setConnecting] = useState(false)

  // Live prices from Kite WebSocket — overrides HTTP data instantly
  const niftyLtp = useTicker('NIFTY 50')
  const bankLtp  = useTicker('NIFTY BANK')
  const vixLtp   = useTicker('INDIA VIX')

  const niftyFlash = usePriceFlash(niftyLtp)
  const bankFlash  = usePriceFlash(bankLtp)
  const vixFlash   = usePriceFlash(vixLtp)

  const kite       = kiteStatus.data
  const configured = kite?.configured
  const connected  = kite?.connected

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const { url } = await api.kiteAuthUrl()
      if (url) window.open(url, '_blank', 'width=600,height=700')
    } finally {
      setConnecting(false)
    }
  }

  if (loading) return <Loading type="home" />
  if (error)   return <ErrorMsg message={error} />

  const { indices, global: g, sectors, fii_dii, calendar } = data

  // Merge WebSocket LTP over HTTP data
  const nifty    = { ...indices?.nifty,     price: niftyLtp ?? indices?.nifty?.price }
  const banknifty= { ...indices?.banknifty, price: bankLtp  ?? indices?.banknifty?.price }
  const vix      = { ...indices?.vix,       price: vixLtp   ?? indices?.vix?.price, value: vixLtp ?? indices?.vix?.value }

  return (
    <div>
      {/* Kite connect banner — shown only when not connected */}
      {!connected && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 12px', marginBottom: 8, borderRadius: 8,
          background: configured ? 'var(--bg2)' : '#1a1a0e',
          border: `0.5px solid ${configured ? 'var(--border)' : '#3a3a10'}`,
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text1)' }}>
              {configured ? 'Connect Kite for live prices' : 'Add Kite API keys to enable live streaming'}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
              {configured
                ? 'Prices update every ms via Zerodha WebSocket'
                : 'Add KITE_API_KEY + KITE_API_SECRET to backend/.env'}
            </div>
          </div>
          {configured && (
            <button
              onClick={handleConnect}
              disabled={connecting}
              style={{
                fontSize: 11, padding: '5px 14px', cursor: 'pointer', borderRadius: 6,
                fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                background: '#EAF3DE', border: '0.5px solid #C0DD97', color: '#3B6D11',
              }}>
              {connecting ? 'Opening…' : 'Connect Kite →'}
            </button>
          )}
        </div>
      )}

      {/* Index bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', marginBottom: 4, borderBottom: '0.5px solid var(--border)' }}>
        {[
          { label: 'NIFTY 50',   flash: niftyFlash, ...nifty },
          { label: 'Bank Nifty', flash: bankFlash,  ...banknifty },
          { label: 'India VIX',  flash: vixFlash,   ...vix },
        ].map(idx => (
          <div key={idx.label}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 2 }}>{idx.label}</div>
            <div className={idx.flash || ''} style={{ fontSize: 22, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text1)', transition: 'color 0.1s', display: 'inline-block' }}>
              {fmt.price(idx.price || idx.value)}
            </div>
            <div style={{ fontSize: 11, color: chgColor(idx.pct ?? idx.change) }}>
              {(idx.pct ?? 0) >= 0 ? '▲' : '▼'} {Number(Math.abs(idx.pct ?? 0)).toFixed(2)}%
              {tickerLive && <span style={{ marginLeft: 4, display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', verticalAlign: 'middle', animation: 'pulse 1s infinite' }} />}
            </div>
          </div>
        ))}
      </div>

      {/* Global pre-market */}
      <SectionTitle>Global pre-market</SectionTitle>
      <div className="stat-grid-3" style={{ marginBottom: 8 }}>
        {[
          {
            label: 'GIFT Nifty', key: 'gift',
            val: g?.gift_nifty?.value,
            sub: g?.gift_nifty?.gap_pts != null
              ? `gap ${g.gift_nifty.gap_pts >= 0 ? '+' : ''}${g.gift_nifty.gap_pts} pts`
              : '—',
            valColor: chgColor(g?.gift_nifty?.gap_pts),
          },
          { label: 'S&P 500',   key: 'sp', val: g?.sp500?.pct,   sub: 'US close',  valColor: chgColor(g?.sp500?.pct)  },
          { label: 'Nasdaq',    key: 'nq', val: g?.nasdaq?.pct,  sub: 'US close',  valColor: chgColor(g?.nasdaq?.pct) },
          { label: 'Crude Oil', key: 'cl', val: g?.crude?.pct,   sub: `$${fmt.round(g?.crude?.value)}`, valColor: chgColor(g?.crude?.pct) },
          { label: 'USD/INR',   key: 'fx', val: g?.usdinr?.pct,  sub: `₹${fmt.round(g?.usdinr?.value)}`, valColor: chgColor(g?.usdinr?.pct) },
          { label: 'Gold',      key: 'gc', val: g?.gold?.pct,    sub: g?.gold?.bias, valColor: chgColor(g?.gold?.pct) },
        ].map(item => (
          <StatCard
            key={item.key}
            label={item.label}
            value={item.key === 'gift'
              ? fmt.price(item.val)
              : (typeof item.val === 'number' ? fmt.pct(item.val) : '—')}
            sub={item.sub}
            valueColor={item.valColor}
          />
        ))}
      </div>

      {/* Sector pulse */}
      <SectionTitle>Sector pulse</SectionTitle>
      <div className="stat-grid-3" style={{ marginBottom: 8 }}>
        {(sectors || []).map(s => (
          <div key={s.sector} className="stat-card" style={{ textAlign: 'center', padding: '6px 8px' }}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 2 }}>{s.sector}</div>
            <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)', color: chgColor(s.change) }}>
              {fmt.pct(s.change)}
            </div>
          </div>
        ))}
      </div>

      {/* FII / DII */}
      <SectionTitle>FII / DII today</SectionTitle>
      <div className="card" style={{ marginBottom: 8 }}>
        <SignalRow label="FII net (futures)"
          value={<span style={{ color: chgColor(fii_dii?.index_futures_net) }}>{fmt.inrSign(fii_dii?.index_futures_net)} Cr</span>}
          badge={fii_dii?.bias} badgeClass={fii_dii?.bias === 'bullish' ? 'badge-green' : 'badge-red'} />
        <SignalRow label="FII net (cash)"
          value={<span style={{ color: chgColor(fii_dii?.cash_net_fii) }}>{fmt.inrSign(fii_dii?.cash_net_fii)} Cr</span>} />
        <SignalRow label="DII net (cash)"
          value={<span style={{ color: chgColor(fii_dii?.cash_net_dii) }}>{fmt.inrSign(fii_dii?.cash_net_dii)} Cr</span>} />
      </div>

      {/* Economic calendar */}
      <SectionTitle>Economic calendar</SectionTitle>
      <MonthCalendar events={calendar || []} />

      {/* Market news */}
      {(data?.news || []).length > 0 && (
        <>
          <SectionTitle>Market news</SectionTitle>
          {(data.news || []).map((n, i) => (
            <NewsCard key={i} headline={n.title} source={n.source} sentiment={n.sentiment} url={n.url} />
          ))}
        </>
      )}
    </div>
  )
}
