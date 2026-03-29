import { useState, useRef, useEffect } from 'react'
import { useApi } from '../../hooks/useApi.js'
import { useTicker, useTickerConnected } from '../../hooks/useTicker.js'
import { api } from '../../utils/api.js'
import { fmt, chgColor } from '../../utils/formatters.js'
import { StatCard, SectionTitle, Loading, ErrorMsg, SignalRow, NewsCard } from '../ui/index.jsx'


function useRelativeTime(ts) {
  const [label, setLabel] = useState('')
  useEffect(() => {
    if (!ts) return
    const update = () => {
      const diff = Math.floor((Date.now() - ts) / 1000)
      if (diff < 60)       setLabel('just now')
      else if (diff < 3600) setLabel(`${Math.floor(diff / 60)}m ago`)
      else                  setLabel(`${Math.floor(diff / 3600)}h ago`)
    }
    update()
    const id = setInterval(update, 30000)
    return () => clearInterval(id)
  }, [ts])
  return label
}

function NewsHeader({ title, onRefresh, lastUpdated }) {
  const [spinning, setSpinning] = useState(false)
  const timeLabel = useRelativeTime(lastUpdated)

  const handleRefresh = () => {
    if (!onRefresh) return
    setSpinning(true)
    onRefresh()
    setTimeout(() => setSpinning(false), 1200)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '1rem 0 6px' }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text3)' }}>{title}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {timeLabel && <span style={{ fontSize: 10, color: 'var(--text3)' }}>{timeLabel}</span>}
        {onRefresh && (
          <button onClick={handleRefresh} title="Refresh news"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text3)', lineHeight: 1, display: 'flex', alignItems: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
              style={{ display: 'block', transition: 'transform 0.6s', transform: spinning ? 'rotate(360deg)' : 'none' }}>
              <path d="M13.5 8a5.5 5.5 0 1 1-1.1-3.3"/>
              <polyline points="13.5 2 13.5 5.5 10 5.5"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

const SENTIMENT_ORDER = { positive: 0, negative: 1, neutral: 2 }

function NewsBysentiment({ news = [] }) {
  const sorted = [...news].sort((a, b) =>
    (SENTIMENT_ORDER[a.sentiment] ?? 2) - (SENTIMENT_ORDER[b.sentiment] ?? 2)
  )
  return sorted.map((n, i) => (
    <NewsCard key={i} headline={n.title} source={n.source} sentiment={n.sentiment} url={n.url} />
  ))
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
  const { data, loading, error } = useApi(() => api.home(), [], 'home', 5 * 60 * 1000)
  const { data: newsData, refresh: refreshNews, lastUpdated: newsUpdated } = useApi(() => api.news(), [], 'news')
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

  const { indices, global: g, sectors, fii_dii } = data
  const global_news = newsData?.global_news || []
  const india_news  = newsData?.india_news  || []

  // Merge WebSocket LTP over HTTP data
  const nifty    = { ...indices?.nifty,     price: niftyLtp ?? indices?.nifty?.price }
  const banknifty= { ...indices?.banknifty, price: bankLtp  ?? indices?.banknifty?.price }
  const vix      = { ...indices?.vix,       price: vixLtp   ?? indices?.vix?.price, value: vixLtp ?? indices?.vix?.value }

  // ── Market bias roll-up ───────────────────────────────────────────────────
  const biasVotes = []
  if (vix?.price != null) biasVotes.push(vix.price > 20 ? -1 : vix.price < 16 ? 1 : 0)
  if (fii_dii?.index_futures_net != null) biasVotes.push(fii_dii.index_futures_net > 0 ? 1 : -1)
  if (g?.gift_nifty?.gap_pts != null) biasVotes.push(g.gift_nifty.gap_pts > 30 ? 1 : g.gift_nifty.gap_pts < -30 ? -1 : 0)
  const greenSectors = (sectors || []).filter(s => s.change != null && s.change > 0).length
  const redSectors   = (sectors || []).filter(s => s.change != null && s.change < 0).length
  if (sectors?.length) biasVotes.push(greenSectors > redSectors ? 1 : greenSectors < redSectors ? -1 : 0)
  const biasSum = biasVotes.reduce((a, b) => a + b, 0)
  const marketBias =
    biasSum >=  2 ? { label: 'Bullish',  color: 'var(--green)', bg: 'rgba(0,212,140,0.10)', border: 'rgba(0,212,140,0.3)',  desc: 'FII, VIX, global cues & sectors lean positive' } :
    biasSum <= -2 ? { label: 'Bearish',  color: 'var(--red)',   bg: 'rgba(255,79,79,0.10)', border: 'rgba(255,79,79,0.3)',  desc: 'FII, VIX, global cues & sectors lean negative' } :
                   { label: 'Cautious', color: 'var(--amber)', bg: 'rgba(240,160,32,0.10)', border: 'rgba(240,160,32,0.3)', desc: 'Mixed signals — no clear directional edge today'  }

  // ── Market open/close for global assets ──────────────────────────────────
  function _globalStatus(key) {
    const now = new Date()
    const utc = now.getUTCHours() * 60 + now.getUTCMinutes()
    if (key === 'sp' || key === 'nq') {
      // NYSE/Nasdaq: 13:30–20:00 UTC (Mon-Fri)
      const d = now.getUTCDay()
      if (d === 0 || d === 6) return 'Weekend'
      return (utc >= 13 * 60 + 30 && utc < 20 * 60) ? 'Live' : 'Closed'
    }
    if (key === 'cl' || key === 'gc') return 'CME 24h' // Crude & Gold trade nearly 24h
    if (key === 'fx') return '24h'
    if (key === 'gift') {
      const d = now.getUTCDay()
      return (d >= 1 && d <= 5) ? 'SGX Live' : 'Weekend'
    }
    return null
  }

  return (
    <div>
      {/* Kite connect banner — shown only when configured but not yet connected */}
      {!connected && configured && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 12px', marginBottom: 8, borderRadius: 8,
          background: 'var(--bg2)', border: '0.5px solid var(--border)',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text1)' }}>Connect Kite for live prices</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>Prices update every ms via Zerodha WebSocket</div>
          </div>
          <button onClick={handleConnect} disabled={connecting}
            style={{ fontSize: 11, padding: '5px 14px', cursor: 'pointer', borderRadius: 6, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, background: 'rgba(0,212,140,0.15)', border: '0.5px solid rgba(0,212,140,0.35)', color: 'var(--green)' }}>
            {connecting ? 'Opening…' : 'Connect Kite →'}
          </button>
        </div>
      )}

      <div>

          {/* Index bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 0', marginBottom: 8, borderBottom: '0.5px solid var(--border)' }}>
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

          {/* Market bias summary */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 8, marginBottom: 10, background: marketBias.bg, border: `0.5px solid ${marketBias.border}` }}>
            <div>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: marketBias.color, marginBottom: 3, fontWeight: 600 }}>Today's market bias</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: marketBias.color }}>{marketBias.label}</div>
              <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 3 }}>{marketBias.desc}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
              {[
                { label: 'VIX',     vote: vix?.price != null ? (vix.price > 20 ? -1 : vix.price < 16 ? 1 : 0) : null },
                { label: 'FII',     vote: fii_dii?.index_futures_net != null ? (fii_dii.index_futures_net > 0 ? 1 : -1) : null },
                { label: 'GIFT',    vote: g?.gift_nifty?.gap_pts != null ? (g.gift_nifty.gap_pts > 30 ? 1 : g.gift_nifty.gap_pts < -30 ? -1 : 0) : null },
                { label: 'Sectors', vote: sectors?.length ? (greenSectors > redSectors ? 1 : greenSectors < redSectors ? -1 : 0) : null },
              ].map(({ label, vote }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9 }}>
                  <span style={{ color: 'var(--text3)', width: 38, textAlign: 'right' }}>{label}</span>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: vote === 1 ? 'var(--green)' : vote === -1 ? 'var(--red)' : 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'var(--bg)', fontWeight: 700 }}>
                    {vote === 1 ? '▲' : vote === -1 ? '▼' : '–'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Global pre-market */}
          <SectionTitle>Global pre-market</SectionTitle>
          <div className="stat-grid-3" style={{ marginBottom: 8 }}>
            {[
              { label: 'GIFT Nifty', key: 'gift', val: g?.gift_nifty?.value,
                sub: g?.gift_nifty?.gap_pts != null
                  ? `${g.gift_nifty.source === 'estimated' ? 'est · ' : ''}gap ${g.gift_nifty.gap_pts >= 0 ? '+' : ''}${g.gift_nifty.gap_pts} pts`
                  : '—',
                valColor: chgColor(g?.gift_nifty?.gap_pts) },
              { label: 'S&P 500',   key: 'sp', val: g?.sp500?.pct,  sub: 'US close', valColor: chgColor(g?.sp500?.pct)  },
              { label: 'Nasdaq',    key: 'nq', val: g?.nasdaq?.pct, sub: 'US close', valColor: chgColor(g?.nasdaq?.pct) },
              { label: 'Crude Oil', key: 'cl', val: g?.crude?.pct,  sub: `$${fmt.round(g?.crude?.value)}`, valColor: chgColor(g?.crude?.pct) },
              { label: 'USD/INR',   key: 'fx', val: g?.usdinr?.pct, sub: `₹${fmt.round(g?.usdinr?.value)}`, valColor: chgColor(g?.usdinr?.pct) },
              { label: 'Gold',      key: 'gc', val: g?.gold?.pct,   sub: g?.gold?.value != null ? `$${fmt.round(g?.gold?.value)}` : '—', valColor: chgColor(g?.gold?.pct) },
            ].map(item => {
              const status = _globalStatus(item.key)
              const isLive = status === 'Live' || status === 'CME 24h' || status === '24h' || status === 'SGX Live'
              return (
                <div key={item.key} className="stat-card" style={{ position: 'relative' }}>
                  {status && (
                    <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 7, fontWeight: 600, letterSpacing: '0.04em', color: isLive ? 'var(--green)' : 'var(--text3)', textTransform: 'uppercase' }}>
                      {status}
                    </span>
                  )}
                  <div className="label">{item.label}</div>
                  <div className="value" style={{ color: item.valColor }}>
                    {item.key === 'gift' ? fmt.price(item.val) : (typeof item.val === 'number' ? fmt.pct(item.val) : '—')}
                  </div>
                  {item.sub && <div className="sub">{item.sub}</div>}
                </div>
              )
            })}
          </div>

          {/* Sector pulse */}
          <SectionTitle>Sector pulse</SectionTitle>
          <div className="stat-grid-3" style={{ marginBottom: 8 }}>
            {(sectors || []).map(s => {
              const hasData = s.change != null
              const unusual = hasData && Math.abs(s.change) >= 1.5
              return (
                <div key={s.sector} className="stat-card" style={{ padding: '6px 8px', position: 'relative' }}>
                  {unusual && (
                    <span style={{ position: 'absolute', top: 5, right: 7, fontSize: 7, fontWeight: 700, color: chgColor(s.change), textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {s.change > 0 ? 'Strong' : 'Weak'}
                    </span>
                  )}
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 2 }}>{s.sector}</div>
                  <div style={{ fontSize: 13, fontWeight: 500, fontFamily: 'var(--font-mono)', color: hasData ? chgColor(s.change) : 'var(--text3)' }}>
                    {hasData ? fmt.pct(s.change) : '—'}
                  </div>
                </div>
              )
            })}
          </div>

          {/* FII / DII */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0 6px' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text3)' }}>FII / DII today</span>
            {data?.fii_updated && <span style={{ fontSize: 10, color: 'var(--text3)' }}>As of {data.fii_updated}</span>}
          </div>
          <div className="card" style={{ marginBottom: 8 }}>
            <SignalRow label="FII net (total)"
              value={<span style={{ color: chgColor(fii_dii?.index_futures_net) }}>{fmt.inrSign(fii_dii?.index_futures_net)} Cr</span>}
              badge={fii_dii?.bias} badgeClass={fii_dii?.bias === 'bullish' ? 'badge-green' : 'badge-red'} />
            <SignalRow label="DII net (total)"
              value={<span style={{ color: chgColor(fii_dii?.cash_net_dii) }}>{fmt.inrSign(fii_dii?.cash_net_dii)} Cr</span>} />
          </div>

          {/* Global news */}
          {(global_news || []).length > 0 && (
            <>
              <NewsHeader title="Global markets news" onRefresh={refreshNews} lastUpdated={newsUpdated} />
              <NewsBysentiment news={global_news} />
            </>
          )}

          {/* India market news */}
          {(india_news || []).length > 0 && (
            <>
              <NewsHeader title="India market news" />
              <NewsBysentiment news={india_news} />
            </>
          )}
      </div>
    </div>
  )
}
