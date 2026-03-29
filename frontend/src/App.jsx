import { useState, useEffect } from 'react'
import { api } from './utils/api.js'
import { invalidateCache, prefetch, useApi } from './hooks/useApi.js'
import { useTicker, useTickerConnected } from './hooks/useTicker.js'
import HomeTab    from './components/tabs/HomeTab.jsx'
import ExpiryTab  from './components/tabs/ExpiryTab.jsx'
import TickerTab  from './components/tabs/TickerTab.jsx'
import { ScannerTab, PositionsTab, JournalTab, CalculatorTab } from './components/tabs/OtherTabs.jsx'
import { ToastProvider } from './components/ui/index.jsx'
import MonthCalendar from './components/ui/MonthCalendar.jsx'
import TickerBanner from './components/ui/TickerBanner.jsx'

const BASE_TABS = [
  { id: 'home',      label: 'Home',       badge: null },
  { id: 'expiry',    label: 'Expiry',     badge: null },
  { id: 'scanner',   label: 'Scanner',    badge: null },
  { id: 'ticker',    label: 'Ticker',     badge: null },
  { id: 'positions', label: 'Positions',  badge: null },
  { id: 'journal',   label: 'Journal',    badge: null },
  { id: 'calc',      label: 'Calculator', badge: null },
]

// VIEWS is built dynamically in render to pass callbacks

// ── Theme management ──────────────────────────────────────────────────────────
// 'auto' = follow system, 'light' = force light, 'dark' = force dark
function useTheme() {
  const [theme, setThemeState] = useState(() => localStorage.getItem('ts-theme') || 'dark')

  const setTheme = (t) => {
    setThemeState(t)
    localStorage.setItem('ts-theme', t)
    if (t === 'auto') {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', t)
    }
  }

  // Apply on first render
  useEffect(() => {
    const saved = localStorage.getItem('ts-theme') || 'dark'
    if (saved !== 'auto') document.documentElement.setAttribute('data-theme', saved)
  }, [])

  return [theme, setTheme]
}

const THEME_CYCLE = { auto: 'light', light: 'dark', dark: 'auto' }
const THEME_LABEL = { auto: '⬤ Auto', light: '☀ Light', dark: '☽ Dark' }

// ── Market status ─────────────────────────────────────────────────────────────
function getMarketStatus() {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day  = ist.getDay()
  const mins = ist.getHours() * 60 + ist.getMinutes()
  if (day === 0 || day === 6) return { open: false, label: 'Closed', sub: 'Weekend' }
  if (mins >= 9 * 60 + 15 && mins < 15 * 60 + 30) {
    const rem = 15 * 60 + 30 - mins
    return { open: true, label: 'Live', sub: `Closes in ${Math.floor(rem / 60)}h ${rem % 60}m` }
  }
  if (mins >= 9 * 60 && mins < 9 * 60 + 15) {
    return { open: false, label: 'Pre-open', sub: `Opens in ${9 * 60 + 15 - mins}m` }
  }
  return { open: false, label: 'Closed', sub: 'Opens 9:15 IST' }
}

function useMarketStatus() {
  const [status, setStatus] = useState(getMarketStatus)
  useEffect(() => {
    const id = setInterval(() => setStatus(getMarketStatus()), 60000)
    return () => clearInterval(id)
  }, [])
  return status
}

function App() {
  const [active,         setActive]         = useState('home')
  const [tickerSymbol,   setTickerSymbol]   = useState(null)
  const [positionsCount, setPositionsCount] = useState(null)
  const [theme,          setTheme]          = useTheme()
  const market = useMarketStatus()

  const goToTicker = (symbol) => {
    setTickerSymbol(symbol)
    setActive('ticker')
  }

  // Warm caches for all tabs in the background so switching is instant.
  // Staggered: Home loads first (already mounted), then other tabs after 1 s.
  useEffect(() => {
    const t = setTimeout(() => {
      prefetch('expiry-signal',  () => api.expirySignal())
      prefetch('expiry-live',    () => api.expiryLive())
      prefetch('scanner-all',    () => api.scanner('all'))
      prefetch('kite-status',    () => api.kiteStatus())
      prefetch('kite-positions', () => api.kitePositions())
      prefetch('journal',        () => api.journal())
    }, 1000)
    return () => clearTimeout(t)
  }, [])

  // Live prices from WebSocket; fall back to HTTP poll / home cache
  const tickerNifty    = useTicker('NIFTY 50')
  const tickerBank     = useTicker('NIFTY BANK')
  const tickerVix      = useTicker('INDIA VIX')
  const tickerConnected = useTickerConnected()
  const [httpVix, setHttpVix] = useState(null)
  const vix = tickerVix ?? httpVix

  useEffect(() => {
    if (tickerConnected) return  // ticker handles it, no need to poll
    const fetchVix = async () => {
      try {
        const p = await api.price('INDIAVIX')
        if (p?.price) setHttpVix(p.price)
      } catch {}
    }
    fetchVix()
    const id = setInterval(fetchVix, 60000)
    return () => clearInterval(id)
  }, [tickerConnected])

  useEffect(() => {
    const fetchPositions = async () => {
      try {
        const p = await api.kitePositions()
        const open = (p?.net || []).filter(pos => pos.quantity !== 0)
        setPositionsCount(open.length)
      } catch {}
    }
    fetchPositions()

    // Listen for the popup signalling successful Kite connection
    const onMessage = (e) => {
      if (e.data === 'kite-connected') {
        invalidateCache('kite-status')
        invalidateCache('kite-positions')
        fetchPositions()
      }
    }
    window.addEventListener('message', onMessage)

    // If redirected back from Kite OAuth, refresh kite caches
    const params = new URLSearchParams(window.location.search)
    if (params.get('kite') === 'connected') {
      window.history.replaceState({}, '', '/')
      // Bust caches so HomeTab/PositionsTab/ExpiryTab pick up the new session
      invalidateCache('kite-status')
      invalidateCache('kite-positions')
      // If opened in a popup, notify opener and close self
      if (window.opener) {
        window.opener.postMessage('kite-connected', '*')
        window.close()
      }
      // Refresh positions count in the top bar
      fetchPositions()
    }

    return () => window.removeEventListener('message', onMessage)
  }, [])

  const TABS = BASE_TABS.map(t =>
    t.id === 'positions' && positionsCount > 0
      ? { ...t, badge: String(positionsCount) }
      : t
  )

  const vixColor = vix == null ? 'var(--text2)' : vix > 20 ? 'var(--red)' : vix > 16 ? 'var(--amber)' : 'var(--green)'

  // Calendar data — same cache key as HomeTab so no extra network call
  const { data: homeData } = useApi(() => api.home(), [], 'home')
  const calendar = homeData?.calendar || []

  // Today's HIGH/EXTREME events for the alert badge
  const todayIso     = new Date().toISOString().slice(0, 10)
  const todayAlerts  = calendar.filter(e =>
    e.date === todayIso && (e.impact === 'extreme' || e.impact === 'high')
  )
  const topAlert     = todayAlerts[0] || null
  const alertColor   = topAlert?.impact === 'extreme' ? 'var(--red)' : 'var(--amber)'
  const alertBg      = topAlert?.impact === 'extreme' ? 'rgba(255,79,79,0.12)' : 'rgba(240,160,32,0.12)'
  const alertBorder  = topAlert?.impact === 'extreme' ? 'rgba(255,79,79,0.35)' : 'rgba(240,160,32,0.35)'

  // Index prices: WebSocket live → HTTP home cache fallback
  const niftyPrice = tickerNifty ?? homeData?.indices?.nifty?.price
  const bankPrice  = tickerBank  ?? homeData?.indices?.banknifty?.price
  const niftyPct   = homeData?.indices?.nifty?.pct
  const bankPct    = homeData?.indices?.banknifty?.pct

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px 40px' }}>

      {/* Sticky top bar + tab nav wrapper */}
      <div className="sticky-header" style={{ marginLeft: -24, marginRight: -24, padding: '0 24px' }}>

      {/* Top bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0 0', marginBottom: 0 }}>
        {/* QUANTRO wordmark — V3: geometric Q with extended tail */}
        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text1)' }}>
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg"
               style={{ display: 'block', flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2.3"/>
            {/* Extended 45° tail — V3 style */}
            <line x1="16.7" y1="16.7" x2="23.4" y2="23.4"
                  stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"/>
          </svg>
          <span style={{ marginLeft: 1, fontSize: 19, fontWeight: 600, letterSpacing: '0.05em' }}>
            UANTRO
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* NIFTY 50 */}
          {niftyPrice != null && (
            <div style={{ padding: '4px 12px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--bg2)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: '0.06em' }}>NIFTY</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)' }}>{Number(niftyPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              {niftyPct != null && (
                <span style={{ fontSize: 11, fontWeight: 500, color: niftyPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {niftyPct >= 0 ? '▲' : '▼'} {Math.abs(niftyPct).toFixed(2)}%
                </span>
              )}
            </div>
          )}
          {/* BANK NIFTY */}
          {bankPrice != null && (
            <div style={{ padding: '4px 12px', borderRadius: 8, border: '0.5px solid var(--border)', background: 'var(--bg2)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'baseline', gap: 7 }}>
              <span style={{ fontSize: 10, color: 'var(--text3)', letterSpacing: '0.06em' }}>BANK</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text1)' }}>{Number(bankPrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              {bankPct != null && (
                <span style={{ fontSize: 11, fontWeight: 500, color: bankPct >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {bankPct >= 0 ? '▲' : '▼'} {Math.abs(bankPct).toFixed(2)}%
                </span>
              )}
            </div>
          )}
          {/* Market status */}
          <div title={market.sub} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, border: '0.5px solid var(--border)', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'default' }}>
            <span className={market.open ? 'market-open-dot' : ''}
              style={{ width: 6, height: 6, borderRadius: '50%', background: market.open ? 'var(--green)' : 'var(--text3)', display: 'inline-block', flexShrink: 0 }} />
            {market.label}
          </div>
          {/* Feed status */}
          <div style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, border: '0.5px solid var(--border)', color: 'var(--text2)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: tickerConnected ? 'var(--green)' : 'var(--amber)', display: 'inline-block', flexShrink: 0 }} />
            {tickerConnected ? 'Kite' : 'NSE'}
          </div>
          {/* VIX — colored by level */}
          <div style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, border: '0.5px solid var(--border)', color: vixColor, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
            VIX {vix != null ? Number(vix).toFixed(2) : '—'}
          </div>
          <button
            onClick={() => setTheme(THEME_CYCLE[theme])}
            title={`Theme: ${theme} — click to cycle`}
            style={{ fontSize: 10, padding: '3px 8px', borderRadius: 20, border: '0.5px solid var(--border)', color: 'var(--text2)', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {THEME_LABEL[theme]}
          </button>
        </div>
      </div>

      {/* HIGH/EXTREME alert bar */}
      {topAlert && (
        <div style={{
          margin: '6px -24px 0',
          padding: '6px 24px',
          background: alertBg,
          borderTop:    `1px solid ${alertBorder}`,
          borderBottom: `1px solid ${alertBorder}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 12, flexShrink: 0 }}>📌</span>
          {todayAlerts.map((e, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && <span style={{ color: alertColor, opacity: 0.4 }}>·</span>}
              <span style={{ fontSize: 9, fontWeight: 700, color: alertColor, textTransform: 'uppercase', letterSpacing: '0.08em', border: `0.5px solid ${alertBorder}`, borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>
                {e.impact}
              </span>
              <span style={{ fontSize: 11, color: alertColor, opacity: 0.9 }}>{e.event}</span>
            </span>
          ))}
        </div>
      )}

      {/* Tab nav */}
      <div style={{ display: 'flex', gap: 2, paddingTop: 6, overflowX: 'auto', borderBottom: '0.5px solid var(--border)', scrollbarWidth: 'none' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '7px 12px',
              fontSize: 11, fontWeight: 500,
              cursor: 'pointer',
              border: '0.5px solid',
              borderBottom: 'none',
              borderRadius: '6px 6px 0 0',
              whiteSpace: 'nowrap',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              position: 'relative',
              bottom: -1,
              transition: 'all 0.12s',
              borderColor: active === tab.id ? 'var(--border)' : 'transparent',
              background:  active === tab.id ? 'var(--bg)'     : 'transparent',
              color:       active === tab.id ? 'var(--text1)'  : 'var(--text3)',
            }}>
            {tab.label}
            {tab.badge && (
              <span style={{
                fontSize: 8, fontWeight: 600, padding: '1px 5px', borderRadius: 8,
                background: tab.id === 'positions' ? 'rgba(0,212,140,0.18)' : 'rgba(240,160,32,0.16)',
                color:      tab.id === 'positions' ? 'var(--green)' : 'var(--amber)',
              }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Top gainers running banner — inside sticky header so it stays fixed */}
      <TickerBanner />

      </div>{/* end sticky-header */}

      {/* Two-column layout: tab content left, calendar sidebar right */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', paddingTop: '1rem' }}>

        {/* Left: tab content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div key={active} className="tab-content">
          {active === 'home'      && <HomeTab />}
          {active === 'expiry'    && <ExpiryTab />}
          {active === 'scanner'   && <ScannerTab onViewTicker={goToTicker} />}
          {active === 'ticker'    && <TickerTab initialSymbol={tickerSymbol} />}
          {active === 'positions' && <PositionsTab />}
          {active === 'journal'   && <JournalTab />}
          {active === 'calc'      && <CalculatorTab />}
          </div>
        </div>

        {/* Right: sticky calendar sidebar */}
        <div style={{ width: 255, flexShrink: 0, position: 'sticky', top: 80 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text3)', marginBottom: 8 }}>
            Economic calendar
          </div>
          <MonthCalendar events={calendar} />
        </div>

      </div>
    </div>
  )
}

export default function AppWithToast() {
  return <ToastProvider><App /></ToastProvider>
}
