import { useState, useEffect } from 'react'
import { api } from './utils/api.js'
import { invalidateCache, prefetch } from './hooks/useApi.js'
import { useTicker, useTickerConnected } from './hooks/useTicker.js'
import HomeTab    from './components/tabs/HomeTab.jsx'
import ExpiryTab  from './components/tabs/ExpiryTab.jsx'
import TickerTab  from './components/tabs/TickerTab.jsx'
import { ScannerTab, PositionsTab, JournalTab, CalculatorTab } from './components/tabs/OtherTabs.jsx'
import { ToastProvider } from './components/ui/index.jsx'

const BASE_TABS = [
  { id: 'home',      label: 'Home',       badge: null },
  { id: 'expiry',    label: 'Expiry',     badge: 'Tue' },
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
  const [theme, setThemeState] = useState(() => localStorage.getItem('ts-theme') || 'auto')

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
    const saved = localStorage.getItem('ts-theme') || 'auto'
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

  // VIX from WebSocket ticker (instant); falls back to HTTP poll
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
                background: tab.id === 'positions' ? '#EAF3DE' : '#FAEEDA',
                color:      tab.id === 'positions' ? '#3B6D11'  : '#854F0B',
              }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      </div>{/* end sticky-header */}

      {/* Content — key forces fade-in animation on tab switch */}
      <div key={active} className="tab-content main-content" style={{ paddingTop: '1rem' }}>
        {active === 'home'      && <HomeTab />}
        {active === 'expiry'    && <ExpiryTab />}
        {active === 'scanner'   && <ScannerTab onViewTicker={goToTicker} />}
        {active === 'ticker'    && <TickerTab initialSymbol={tickerSymbol} />}
        {active === 'positions' && <PositionsTab />}
        {active === 'journal'   && <JournalTab />}
        {active === 'calc'      && <CalculatorTab />}
      </div>
    </div>
  )
}

export default function AppWithToast() {
  return <ToastProvider><App /></ToastProvider>
}
