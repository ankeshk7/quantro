import { useState } from 'react'
import { impactBadge } from '../../utils/formatters.js'

const IMPACT_DOT = {
  extreme:     'var(--red)',
  high:        'var(--red)',
  watch:       'var(--amber)',
  moderate:    'var(--amber)',
  trade_day:   'var(--green)',
  nse_holiday: '#6b8cde',
  us_holiday:  '#9b72cf',
  low:         'var(--text3)',
  clear:       'var(--bg3)',
}
const IMPACT_LABEL = {
  extreme:     'Extreme',
  high:        'High',
  watch:       'Watch',
  moderate:    'Moderate',
  trade_day:   'Expiry',
  nse_holiday: 'NSE Holiday',
  us_holiday:  'US Holiday',
  low:         'Low',
  clear:       'Clear',
}
const IMPACT_DESC = {
  extreme:     'Major macro event — expect large intraday moves. Consider sitting out or hedging aggressively.',
  high:        'High-impact data release. Volatility likely around the announcement time.',
  watch:       'Worth watching closely. May cause moderate price swings depending on the outcome.',
  moderate:    'Moderate impact. Markets may react briefly but are likely to stabilise.',
  trade_day:   'Weekly NIFTY expiry — premium decay accelerates sharply after 12 PM. Manage positions early.',
  nse_holiday: 'NSE market closed. No Indian equity or F&O trading. Plan positions a day ahead.',
  us_holiday:  'US markets closed. Expect lower global liquidity and potentially muted pre-market cues for India.',
  low:         'Low expected impact on broad indices. Normal trading conditions.',
  clear:       'No major scheduled events. Clean technical tape.',
}
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW_LABELS  = ['S','M','T','W','T','F','S']

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const FILTER_OPTS = [
  { id: 'all',     label: 'All' },
  { id: 'events',  label: 'Events' },
  { id: 'nse',     label: 'NSE Off' },
  { id: 'us',      label: 'US Off' },
]

const FILTER_IMPACTS = {
  all:    null,  // show everything
  events: ['extreme','high','watch','moderate','low','trade_day'],
  nse:    ['nse_holiday'],
  us:     ['us_holiday'],
}

export default function MonthCalendar({ events = [] }) {
  const today    = new Date()
  const todayIso = isoDate(today)

  const [year,     setYear]     = useState(today.getFullYear())
  const [month,    setMonth]    = useState(today.getMonth())
  const [selected, setSelected] = useState(todayIso)
  const [filter,   setFilter]   = useState('all')

  const minYear = today.getFullYear() - 1
  const maxYear = today.getFullYear() + 1

  const prevMonth = () => {
    if (month === 0) { if (year <= minYear) return; setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { if (year >= maxYear) return; setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const firstDay  = new Date(year, month, 1)
  const daysInMon = new Date(year, month + 1, 0).getDate()
  const cells     = Array(firstDay.getDay()).fill(null)
  for (let d = 1; d <= daysInMon; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)

  const allowedImpacts = FILTER_IMPACTS[filter]
  const filteredEvents = allowedImpacts
    ? events.filter(ev => allowedImpacts.includes(ev.impact))
    : events

  const byDate = {}
  for (const ev of filteredEvents) {
    if (!byDate[ev.date]) byDate[ev.date] = []
    byDate[ev.date].push(ev)
  }

  const selEvents  = byDate[selected] || []
  const selDateObj = new Date(selected + 'T12:00:00')
  const canPrev    = !(year === minYear && month === 0)
  const canNext    = !(year === maxYear && month === 11)

  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelected(todayIso) }

  return (
    <div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
        {FILTER_OPTS.map(opt => (
          <button key={opt.id} onClick={() => setFilter(opt.id)} style={{
            flex: 1, fontSize: 9, fontWeight: 600, padding: '3px 0', borderRadius: 5, cursor: 'pointer',
            textTransform: 'uppercase', letterSpacing: '0.05em',
            border: '0.5px solid',
            borderColor: filter === opt.id ? 'var(--border)' : 'transparent',
            background:  filter === opt.id ? 'var(--bg3)' : 'transparent',
            color:       filter === opt.id ? 'var(--text1)' : 'var(--text3)',
          }}>{opt.label}</button>
        ))}
      </div>

      {/* Month nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <button onClick={prevMonth} disabled={!canPrev} style={{ border: '0.5px solid var(--border)', background: canPrev ? 'var(--bg2)' : 'transparent', color: canPrev ? 'var(--text1)' : 'var(--text3)', borderRadius: 6, width: 26, height: 26, cursor: canPrev ? 'pointer' : 'default', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text1)' }}>{MONTH_NAMES[month]}</div>
          <div style={{ fontSize: 9, color: 'var(--text3)' }}>{year}</div>
        </div>
        <button onClick={nextMonth} disabled={!canNext} style={{ border: '0.5px solid var(--border)', background: canNext ? 'var(--bg2)' : 'transparent', color: canNext ? 'var(--text1)' : 'var(--text3)', borderRadius: 6, width: 26, height: 26, cursor: canNext ? 'pointer' : 'default', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 3 }}>
        {DOW_LABELS.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 9, fontWeight: 600, color: 'var(--text3)', padding: '1px 0' }}>{d}</div>
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
          const isWknd  = d.getDay() === 0 || d.getDay() === 6
          const topClr  = dayEvs.length ? (IMPACT_DOT[dayEvs[0].impact] || 'var(--text3)') : null
          return (
            <div key={iso} onClick={() => setSelected(iso)}
              style={{ textAlign: 'center', borderRadius: 6, padding: '5px 2px 4px', cursor: 'pointer', transition: 'background 0.1s',
                background: isSel ? 'var(--text1)' : isToday ? 'var(--green)' : 'transparent',
                opacity: isPast && !isToday && !isSel ? 0.38 : 1 }}
              onMouseEnter={e => { if (!isSel && !isToday) e.currentTarget.style.background = 'var(--bg2)' }}
              onMouseLeave={e => { if (!isSel && !isToday) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ fontSize: 11, fontWeight: isSel || isToday ? 600 : 400, lineHeight: 1.2,
                color: isSel || isToday ? 'var(--bg)' : isWknd ? 'var(--text3)' : 'var(--text2)' }}>
                {d.getDate()}
              </div>
              <div style={{ height: 4, display: 'flex', justifyContent: 'center', gap: 2, marginTop: 1 }}>
                {dayEvs.length > 0 && <span style={{ width: 3, height: 3, borderRadius: '50%', display: 'inline-block', background: isSel || isToday ? 'rgba(255,255,255,0.8)' : topClr }} />}
                {dayEvs.length > 1 && <span style={{ width: 3, height: 3, borderRadius: '50%', display: 'inline-block', background: isSel || isToday ? 'rgba(255,255,255,0.5)' : (IMPACT_DOT[dayEvs[1].impact] || 'var(--text3)') }} />}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend + today button */}
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { label: 'Expiry', color: 'var(--green)' },
            { label: 'Watch',  color: 'var(--amber)' },
            { label: 'High',   color: 'var(--red)' },
            { label: 'NSE',    color: '#6b8cde' },
            { label: 'US',     color: '#9b72cf' },
          ].map(l => (
            <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: 'var(--text3)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: l.color, display: 'inline-block' }} />
              {l.label}
            </div>
          ))}
        </div>
        {(year !== today.getFullYear() || month !== today.getMonth()) && (
          <button onClick={goToday} style={{ padding: '2px 8px', fontSize: 9, cursor: 'pointer', borderRadius: 5, border: '0.5px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)' }}>
            Today
          </button>
        )}
      </div>

      {/* Event detail */}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '0.5px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 7 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text1)' }}>
            {selDateObj.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          {selected === todayIso && <span style={{ fontSize: 9, color: 'var(--green)', fontWeight: 500 }}>Today</span>}
        </div>

        {selEvents.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--text3)', padding: '8px 10px', background: 'var(--bg2)', borderRadius: 6 }}>
            No events — clean tape.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {selEvents.map((ev, i) => (
              <div key={i} style={{ borderRadius: 7, border: '0.5px solid var(--border)', overflow: 'hidden', background: 'var(--bg2)' }}>
                <div style={{ height: 2, background: IMPACT_DOT[ev.impact] || 'var(--text3)' }} />
                <div style={{ padding: '7px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text1)', marginBottom: 2 }}>{ev.event}</div>
                    <div style={{ fontSize: 10, color: 'var(--text2)', lineHeight: 1.5 }}>{IMPACT_DESC[ev.impact] || ''}</div>
                  </div>
                  <span className={`badge ${impactBadge(ev.impact)}`} style={{ flexShrink: 0 }}>{IMPACT_LABEL[ev.impact] || ev.impact}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}
