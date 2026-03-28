import { useState, useRef, useEffect } from 'react'
import { useApi } from '../../hooks/useApi.js'
import { useTicker, useTickerConnected } from '../../hooks/useTicker.js'
import { api } from '../../utils/api.js'
import { fmt, chgColor, impactBadge } from '../../utils/formatters.js'
import { StatCard, SectionTitle, Loading, ErrorMsg, SignalRow, NewsCard } from '../ui/index.jsx'

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
      <SectionTitle>This week's events</SectionTitle>
      {(calendar || []).map((ev, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--bg2)', borderRadius: 6, border: '0.5px solid var(--border)', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text3)', minWidth: 60 }}>{ev.date?.slice(5)}</span>
          <span style={{ fontSize: 12, color: 'var(--text1)', flex: 1, paddingLeft: 8 }}>{ev.event}</span>
          <span className={`badge ${impactBadge(ev.impact)}`}>{ev.impact?.replace('_', ' ')}</span>
        </div>
      ))}

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
