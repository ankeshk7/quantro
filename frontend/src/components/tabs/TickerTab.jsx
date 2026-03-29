import { useState, useEffect, useRef } from 'react'
import { useApi, invalidateCache } from '../../hooks/useApi.js'
import { useTicker, useTickerConnected } from '../../hooks/useTicker.js'
import { api } from '../../utils/api.js'
import { fmt, chgColor, biasBadge } from '../../utils/formatters.js'
import { StatCard, SectionTitle, Loading, ErrorMsg, TendencyCard, NewsCard, PriceHeader } from '../ui/index.jsx'
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts'

const round2 = (v) => Math.round(v * 100) / 100

function InstRow({ row, last }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <div
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '6px 0', borderBottom: last ? 'none' : '0.5px solid var(--border)',
          fontSize: 12, cursor: 'default' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text2)' }}>
          {row.label}
          <span style={{ fontSize: 9, color: 'var(--text3)' }}>ⓘ</span>
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: row.color }}>{row.val}</span>
      </div>
      {show && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
          width: 220, background: 'var(--bg3)', border: '0.5px solid var(--border)',
          borderRadius: 7, padding: '8px 10px', zIndex: 999,
          boxShadow: '0 4px 16px rgba(0,0,0,0.25)', fontSize: 10,
          color: 'var(--text2)', lineHeight: 1.6, pointerEvents: 'none',
        }}>
          {row.hint}
        </div>
      )}
    </div>
  )
}

function _tvChartUrl(symbol) {
  const map = { 'NIFTY 50': 'NSE:NIFTY', 'NIFTY': 'NSE:NIFTY', 'BANKNIFTY': 'NSE:BANKNIFTY', 'FINNIFTY': 'NSE:FINNIFTY', 'MIDCPNIFTY': 'NSE:MIDCPNIFTY', 'INDIA VIX': 'NSE:INDIAVIX' }
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(map[symbol] || 'NSE:' + symbol)}`
}


const _TF = [
  { label: '5m',  interval: '5m'  },
  { label: '15m', interval: '15m' },
  { label: '1D',  interval: '1d'  },
]

// ── Candlestick chart (self-hosted via lightweight-charts) ─────────────────────
function CandlestickChart({ symbol }) {
  const containerRef = useRef(null)
  const chartRef     = useRef(null)
  const candleRef    = useRef(null)
  const volRef       = useRef(null)
  const [tf,      setTf]      = useState('1d')
  const [err,     setErr]     = useState(null)
  const [loading, setLoading] = useState(true)

  // Create chart once on mount
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 320,
      layout: {
        background: { color: '#0d1117' },
        textColor: '#9ca3af',
        attributionLogo: false,   // hide the TradingView watermark
      },
      grid:            { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      crosshair:       { mode: 1 },
      rightPriceScale: { borderColor: '#1f2937' },
      timeScale:       { borderColor: '#1f2937', timeVisible: true, secondsVisible: false },
    })
    chartRef.current  = chart
    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor:   '#26a69a', wickDownColor:   '#ef5350',
    })
    volRef.current = chart.addSeries(HistogramSeries, {
      color: '#374151', priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })

    const ro = new ResizeObserver(entries => {
      if (entries[0]) chart.applyOptions({ width: entries[0].contentRect.width })
    })
    ro.observe(containerRef.current)
    return () => { ro.disconnect(); chart.remove() }
  }, [symbol])

  // Reload data whenever symbol or timeframe changes
  useEffect(() => {
    if (!candleRef.current || !volRef.current) return
    setErr(null); setLoading(true)
    api.hist(symbol, tf)
      .then(rows => {
        if (!rows || rows.length === 0) { setErr('No data for this timeframe'); setLoading(false); return }
        const candles = rows.map(r => ({ time: r.t, open: r.o, high: r.h, low: r.l, close: r.c }))
        const vols    = rows.map(r => ({ time: r.t, value: r.v, color: r.c >= r.o ? '#26a69a44' : '#ef535044' }))
        candleRef.current.setData(candles)
        volRef.current.setData(vols)
        chartRef.current.timeScale().fitContent()
        setLoading(false)
      })
      .catch(() => { setErr('Failed to load chart data'); setLoading(false) })
  }, [symbol, tf])

  return (
    <div style={{ marginBottom: 12, borderRadius: 8, overflow: 'hidden', border: '0.5px solid var(--border)', background: '#0d1117' }}>
      {/* Timeframe buttons */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 10px 6px', borderBottom: '0.5px solid #1f2937' }}>
        {_TF.map(t => (
          <button key={t.interval} onClick={() => setTf(t.interval)}
            style={{ padding: '2px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer', borderRadius: 4,
              background: tf === t.interval ? '#26a69a22' : 'transparent',
              color:      tf === t.interval ? '#26a69a'   : '#6b7280',
              border: `0.5px solid ${tf === t.interval ? '#26a69a' : '#374151'}` }}>
            {t.label}
          </button>
        ))}
        {loading && <span style={{ fontSize: 10, color: '#6b7280', alignSelf: 'center', marginLeft: 6 }}>Loading…</span>}
        {err    && <span style={{ fontSize: 10, color: '#ef5350', alignSelf: 'center', marginLeft: 6 }}>{err}</span>}
      </div>
      <div ref={containerRef} />
    </div>
  )
}

function OIBar({ pct, color }) {
  return (
    <div style={{ display: 'inline-block', width: `${Math.max(4, pct)}px`, height: 5, background: color, borderRadius: 2, verticalAlign: 'middle', marginLeft: 3 }} />
  )
}

function FullOIAnalysis({ data }) {
  const { oi } = data
  if (!oi) return null
  const { walls, chain, changes, max_pain, pcr, ivr } = oi

  return (
    <div style={{ marginTop: 8 }}>
      {/* Range */}
      <SectionTitle>Implied range — from OI walls</SectionTitle>
      <div className="card" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 3 }}>OI derived range</div>
            <div style={{ fontSize: 20, fontWeight: 500 }}>{walls?.implied_range}</div>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>Width: {walls?.range_width} pts · Max pain: {fmt.price(max_pain)}</div>
          </div>
          <span className="badge badge-green">Range defined</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, borderTop: '0.5px solid var(--border)', paddingTop: 8 }}>
          ⟶ &nbsp;Iron Fly fits inside this range.
          Spot is {fmt.price(walls?.distance_to_support)} pts from put wall (support) and {fmt.price(walls?.distance_to_resist)} pts from call wall (resistance).
        </div>
      </div>

      {/* OI Walls */}
      <SectionTitle>OI walls</SectionTitle>
      <div className="stat-grid-2" style={{ marginBottom: 8 }}>
        <div className="stat-card">
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--red)', marginBottom: 3 }}>Call wall · Resistance</div>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{fmt.price(walls?.call_wall)}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6, lineHeight: 1.5, borderTop: '0.5px solid var(--border)', paddingTop: 6 }}>
            Dominant call writing. Option sellers betting spot stays below this. Strong ceiling today.
          </div>
        </div>
        <div className="stat-card">
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--green)', marginBottom: 3 }}>Put wall · Support</div>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{fmt.price(walls?.put_wall)}</div>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 6, lineHeight: 1.5, borderTop: '0.5px solid var(--border)', paddingTop: 6 }}>
            Heavy put writing. Put sellers defending this hard. Natural floor, expect bounce if touched.
          </div>
        </div>
      </div>

      {/* OI summary */}
      <SectionTitle>OI summary</SectionTitle>
      <div className="card" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: pcr >= 1 ? 'var(--green)' : 'var(--red)', marginBottom: 5 }}>
              {pcr >= 1.2 ? 'Bullish' : pcr >= 1.0 ? 'Mildly bullish' : pcr >= 0.8 ? 'Neutral' : 'Bearish'} · Range-bound
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <span className={`badge ${pcr >= 1 ? 'badge-green' : 'badge-red'}`}>PCR {pcr}</span>
              <span className={`badge ${ivr >= 50 ? 'badge-green' : 'badge-amber'}`}>IVR {ivr}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)' }}>Put-Call Ratio</div>
            <div style={{ fontSize: 22, fontWeight: 500, color: pcr >= 1 ? 'var(--green)' : 'var(--red)' }}>{pcr}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65, borderTop: '0.5px solid var(--border)', paddingTop: 8 }}>
          {pcr >= 1
            ? `PCR of ${pcr} means more puts being written than calls — institutions comfortable selling downside protection. Bullish signal.`
            : `PCR of ${pcr} means more calls being written than puts — cautious sentiment. Watch for further signals before entering.`}
        </div>
      </div>

      {/* Strike-by-strike chain */}
      <SectionTitle>Options chain — with plain English meaning</SectionTitle>
      <div style={{ overflowX: 'auto', marginBottom: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr>
              {['CE OI','Chg','bar','Strike','bar','Chg','PE OI','Meaning'].map((h, i) => (
                <th key={i} style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', padding: '4px 4px', borderBottom: '0.5px solid var(--border)', textAlign: i <= 2 ? 'left' : i === 3 ? 'center' : 'right', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(chain || []).map((row, i) => {
              const cePct = row.ce_coi_pct
              const pePct = row.pe_coi_pct
              return (
                <tr key={i} style={{ background: row.is_atm ? 'var(--bg2)' : 'transparent' }}>
                  <td style={{ padding: '5px 4px', borderBottom: '0.5px solid var(--border)', fontFamily: 'var(--font-mono)', color: row.is_call_wall ? 'var(--red)' : 'var(--text2)' }}>{row.ce_oi_lbl}</td>
                  <td style={{ padding: '5px 4px', borderBottom: '0.5px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 9, color: cePct > 0 ? 'var(--red)' : cePct < 0 ? 'var(--green)' : 'var(--text3)', whiteSpace: 'nowrap' }}>
                    {cePct !== 0 ? `${cePct > 0 ? '+' : ''}${cePct}%` : '—'}
                  </td>
                  <td style={{ padding: '5px 4px', borderBottom: '0.5px solid var(--border)' }}><OIBar pct={row.ce_oi_bar * 0.8} color="var(--red)" /></td>
                  <td style={{ padding: '5px 4px', borderBottom: '0.5px solid var(--border)', textAlign: 'center', fontWeight: 500, color: row.is_atm ? 'var(--amber)' : 'var(--text1)' }}>
                    {fmt.price(row.strike)}
                    {row.is_atm && <span className="badge badge-amber" style={{ marginLeft: 3, fontSize: 7 }}>ATM</span>}
                  </td>
                  <td style={{ padding: '5px 4px', borderBottom: '0.5px solid var(--border)' }}><OIBar pct={row.pe_oi_bar * 0.8} color="var(--green)" /></td>
                  <td style={{ padding: '5px 4px', borderBottom: '0.5px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 9, color: pePct > 0 ? 'var(--green)' : pePct < 0 ? 'var(--red)' : 'var(--text3)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {pePct !== 0 ? `${pePct > 0 ? '+' : ''}${pePct}%` : '—'}
                  </td>
                  <td style={{ padding: '5px 4px', borderBottom: '0.5px solid var(--border)', fontFamily: 'var(--font-mono)', color: row.is_put_wall ? 'var(--green)' : 'var(--text2)', textAlign: 'right' }}>{row.pe_oi_lbl}</td>
                  <td style={{ padding: '5px 4px 5px 8px', borderBottom: '0.5px solid var(--border)', fontSize: 10, color: row.is_atm ? 'var(--amber)' : 'var(--text2)', maxWidth: 130, lineHeight: 1.4 }}>{row.meaning}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* OI changes */}
      {changes?.length > 0 && (
        <>
          <SectionTitle>OI change today — smart money signals</SectionTitle>
          <div className="card" style={{ marginBottom: 8 }}>
            {changes.map((c, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '7px 0', borderBottom: i < changes.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text1)', marginBottom: 2 }}>{fmt.price(c.strike)} {c.leg} — OI {c.delta}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.5 }}>{c.explain}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, paddingLeft: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 500, color: c.bias === 'bullish' ? 'var(--green)' : 'var(--red)' }}>{c.type}</span>
                  <span className={`badge ${c.bias === 'bullish' ? 'badge-green' : c.bias === 'bearish' ? 'badge-red' : 'badge-amber'}`}>{c.bias}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Change triggers */}
      {data?.strategy_fit?.triggers?.length > 0 && (
        <>
          <SectionTitle>What would change this recommendation</SectionTitle>
          <div className="card">
            {data.strategy_fit.triggers.map((t, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '6px 0', borderBottom: i < data.strategy_fit.triggers.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: 'var(--text1)' }}>{t.condition}</div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>→ {t.action}</div>
                </div>
                <span className={`badge ${t.severity === 'exit' || t.severity === 'skip' ? 'badge-red' : 'badge-amber'}`} style={{ marginLeft: 8 }}>{t.severity}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TickerView({ symbol }) {
  const [showFull,  setShowFull]  = useState(false)
  const [showChart, setShowChart] = useState(false)
  // v2: invalidate cache on mount so stale responses (pre-institutional field) don't show dashes
  useEffect(() => { invalidateCache(`ticker-${symbol}`) }, [symbol])
  const { data, loading, error } = useApi(() => api.ticker(symbol), [symbol], `ticker-${symbol}`)

  // Real-time LTP from Kite WebSocket — zero delay
  const tickerLtp  = useTicker(symbol)
  const tickerLive = useTickerConnected()

  // Fallback: HTTP poll every 30s when WebSocket isn't available
  const [httpLtp, setHttpLtp] = useState(null)
  useEffect(() => {
    if (tickerLive) return
    const fetchPrice = async () => {
      try { const p = await api.price(symbol); if (p?.price) setHttpLtp(p.price) } catch {}
    }
    fetchPrice()
    const id = setInterval(fetchPrice, 30000)
    return () => clearInterval(id)
  }, [symbol, tickerLive])

  if (loading) return <Loading type="ticker" />
  if (error)   return <ErrorMsg message={error} />

  const d          = data
  const ltp        = tickerLtp ?? httpLtp ?? d.price?.price
  const isLive     = tickerLive && tickerLtp != null
  const httpChange = d.price?.change ?? 0
  const httpPct    = d.price?.pct    ?? 0
  const liveChange = ltp && d.price?.prev ? round2(ltp - d.price.prev) : httpChange
  const livePct    = ltp && d.price?.prev ? round2((liveChange / d.price.prev) * 100) : httpPct

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>

      {/* ── Left column: price data + analysis ─────────────────────────── */}
      <div style={{ flex: '0 0 420px', minWidth: 300 }}>

        {/* Price header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <PriceHeader
              symbol={`${symbol} · NSE${d.is_fno ? ' F&O' : ''}`}
              price={ltp}
              change={liveChange}
              pct={livePct}
              meta={`Vol: ${fmt.lakh(d.ohlcv?.volume)} · 52W H: ${fmt.price(d.ohlcv?.week52h)} · 52W L: ${fmt.price(d.ohlcv?.week52l)}`}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingTop: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: isLive ? 'var(--green)' : 'var(--amber)', display: 'inline-block', animation: isLive ? 'pulse 1s infinite' : 'none' }} />
            <span style={{ fontSize: 9, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{isLive ? 'Kite live' : 'HTTP'}</span>
          </div>
        </div>

        <div className="stat-grid-4" style={{ marginBottom: 8 }}>
          <StatCard label="Open"  value={fmt.price(d.ohlcv?.open)}  valueColor="var(--text1)" />
          <StatCard label="High"  value={fmt.price(d.ohlcv?.high)}  valueColor="var(--green)" />
          <StatCard label="Low"   value={fmt.price(d.ohlcv?.low)}   valueColor="var(--red)"   />
          <StatCard label="Prev"  value={fmt.price(d.ohlcv?.prev)}  valueColor="var(--text1)" />
        </div>

        {/* Tendency */}
        <SectionTitle>Tendency & outlook</SectionTitle>
        <TendencyCard
          signal={d.strategy_fit?.recommendation === 'Skip' ? 'Neutral — Skip this week' : `${d.strategy_fit?.recommendation} · ${d.strategy_fit?.confidence}% confidence`}
          color={d.strategy_fit?.recommendation === 'Skip' ? 'var(--red)' : 'var(--green)'}
          reasoning={d.strategy_fit?.why}
          tags={(d.strategy_fit?.signals ? Object.entries(d.strategy_fit.signals).map(([k, v]) => ({
            label: `${k.replace('_', ' ')} ${v.value}`,
            cls:   v.ok ? 'badge-green' : 'badge-red',
          })) : [])}
        />

        {/* Technicals */}
        <SectionTitle>Technicals</SectionTitle>
        {[
          { label: 'Trend (daily)',   value: d.technicals?.trend,      sig: d.technicals?.trend === 'bullish' ? 'bull' : d.technicals?.trend === 'bearish' ? 'bear' : 'neutral' },
          { label: 'Support (S1)',    value: fmt.price(d.technicals?.support),    sig: 'neutral' },
          { label: 'Resistance (R1)', value: fmt.price(d.technicals?.resistance), sig: 'neutral' },
          { label: '20 EMA',          value: fmt.price(d.technicals?.ema20),      sig: (d.price?.price || 0) > (d.technicals?.ema20 || 0) ? 'bull' : 'bear' },
          { label: 'RSI (14)',        value: `${d.technicals?.rsi || '—'}`,       sig: (d.technicals?.rsi || 50) > 55 ? 'bull' : (d.technicals?.rsi || 50) < 45 ? 'bear' : 'neutral' },
        ].map((row, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'var(--bg2)', borderRadius: 6, border: '0.5px solid var(--border)', marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text2)' }}>{row.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 500, fontFamily: 'var(--font-mono)' }}>{row.value}</span>
              <span className={`badge ${row.sig === 'bull' ? 'badge-green' : row.sig === 'bear' ? 'badge-red' : 'badge-gray'}`}>{row.sig}</span>
            </div>
          </div>
        ))}

        {/* Options snapshot — only for F&O instruments */}
        {d.is_fno ? (
          <>
            <SectionTitle>Options snapshot</SectionTitle>
            <div className="stat-grid-3" style={{ marginBottom: 8 }}>
              <StatCard label="Max pain" value={fmt.price(d.oi?.max_pain)} />
              <StatCard label="IVR"      value={d.oi?.ivr} valueColor={(d.oi?.ivr || 0) >= 50 ? 'var(--green)' : 'var(--amber)'} sub={(d.oi?.ivr || 0) >= 50 ? 'Sell premium' : 'Low'} />
              <StatCard label="PCR"      value={d.oi?.pcr} valueColor={(d.oi?.pcr || 0) >= 1 ? 'var(--green)' : 'var(--red)'}   sub={(d.oi?.pcr || 0) >= 1 ? 'Bullish' : 'Bearish'} />
            </div>
          </>
        ) : (
          <div style={{ padding: '10px 14px', background: 'var(--bg2)', borderRadius: 8, border: '0.5px solid var(--border)', marginBottom: 8, fontSize: 11, color: 'var(--text3)' }}>
            No F&O options — this stock is not in the derivatives segment.
          </div>
        )}

        {/* Institutional activity */}
        <SectionTitle>Institutional activity</SectionTitle>
        <div className="card">
          {(() => {
            const inst = d.institutional || {}
            const delivPct  = inst.delivery_pct
            const futOi     = inst.futures_oi
            const futOiChg  = inst.futures_oi_chg
            const pcr       = inst.pcr
            const bias      = inst.futures_bias || 'neutral'
            const biasColor = bias === 'bullish' ? 'var(--green)' : bias === 'bearish' ? 'var(--red)' : 'var(--text2)'
            const rows = [
              {
                label: 'Delivery %',
                hint:  'High delivery (>60%) = institutions holding positions, not intraday traders',
                val:   delivPct != null ? `${delivPct}%` : '—',
                color: delivPct == null ? 'var(--text2)' : delivPct >= 60 ? 'var(--green)' : delivPct >= 40 ? 'var(--amber)' : 'var(--red)',
              },
              {
                label: 'Futures OI',
                hint:  'Total open positions in stock futures',
                val:   futOi != null ? Number(futOi).toLocaleString('en-IN') : '—',
                color: 'var(--text1)',
              },
              {
                label: 'Futures OI change',
                hint:  'OI rising with price = longs building (bullish). OI rising with price falling = shorts building (bearish)',
                val:   futOiChg != null ? `${futOiChg > 0 ? '+' : ''}${Number(futOiChg).toLocaleString('en-IN')}` : '—',
                color: futOiChg == null ? 'var(--text2)' : futOiChg > 0 ? biasColor : 'var(--text2)',
              },
              {
                label: 'Put-Call Ratio',
                hint:  'PCR >1.2 = put-heavy (bullish support). PCR <0.8 = call-heavy (bearish pressure)',
                val:   pcr != null ? pcr.toFixed(2) : '—',
                color: pcr == null ? 'var(--text2)' : pcr >= 1.2 ? 'var(--green)' : pcr <= 0.8 ? 'var(--red)' : 'var(--amber)',
              },
            ]
            return (
              <>
                {rows.map((row, i) => (
                  <InstRow key={i} row={row} last={i === rows.length - 1} />
                ))}
                <div style={{ marginTop: 8, fontSize: 9, color: 'var(--text3)', lineHeight: 1.5 }}>
                  {inst.note || 'Proxy signals — true FII/DII data is disclosed quarterly only.'}
                </div>
              </>
            )
          })()}
        </div>
      </div>

      {/* ── Right column: chart + OI + news ────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 300 }}>

        {/* Chart toggle + external link — works for all symbols */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button
            onClick={() => setShowChart(v => !v)}
            style={{ flex: 1, padding: '9px 0', fontSize: 12, cursor: 'pointer', borderRadius: 6,
              background: showChart ? '#1a2a1a' : 'var(--bg2)',
              border: `0.5px solid ${showChart ? 'var(--green)' : 'var(--border)'}`,
              color: showChart ? 'var(--green)' : 'var(--text1)' }}>
            {showChart ? '▲ Hide chart' : '📈 Show chart'}
          </button>
          <a href={_tvChartUrl(symbol)} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', fontSize: 12, borderRadius: 6,
              whiteSpace: 'nowrap', background: 'var(--bg2)', border: '0.5px solid var(--border)',
              color: 'var(--text2)', textDecoration: 'none' }}>
            TradingView ↗
          </a>
        </div>
        {showChart && <CandlestickChart key={symbol} symbol={symbol} />}

        {/* Full OI toggle — only for F&O instruments */}
        {d.is_fno && (
          <>
            <button
              onClick={() => setShowFull(v => !v)}
              style={{ width: '100%', padding: '9px 0', fontSize: 12, cursor: 'pointer', borderRadius: 6, marginBottom: 8, background: 'var(--bg2)', border: '0.5px solid var(--border)', color: 'var(--text1)' }}>
              {showFull ? 'Hide OI analysis ▲' : 'Full OI analysis + options chain ▼'}
            </button>
            {showFull && <FullOIAnalysis data={d} />}
          </>
        )}

        {/* News */}
        <SectionTitle>Latest news</SectionTitle>
        {(d.news || []).map((n, i) => <NewsCard key={i} headline={n.title} source={n.source} sentiment={n.sentiment || 'neutral'} url={n.url} />)}
      </div>

    </div>
  )
}

export default function TickerTab({ initialSymbol }) {
  const [query,      setQuery]      = useState(initialSymbol || '')
  const [results,    setResults]    = useState([])
  const [selected,   setSelected]   = useState(initialSymbol || null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const handleSearch = async (val) => {
    setQuery(val)
    if (val.length < 1) { setResults([]); return }
    try {
      const data = await api.search(val)
      setResults(data)
    } catch {
      setResults([])
    }
  }

  const select = (sym) => {
    setSelected(sym)
    setQuery(sym)
    setResults([])
  }

  const handleRefresh = async () => {
    if (!selected || refreshing) return
    setRefreshing(true)
    invalidateCache(`ticker-${selected}`)
    setRefreshKey(k => k + 1)
    setTimeout(() => setRefreshing(false), 1000)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text3)' }}>⌕</span>
          <input
            value={query}
            onChange={e => handleSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && query && select(query.toUpperCase())}
            placeholder="Search — NIFTY, BANKNIFTY, RELIANCE..."
            style={{ width: '100%', padding: '10px 14px 10px 36px', fontSize: 13, fontFamily: 'var(--font-mono)', background: 'var(--bg2)', border: '0.5px solid var(--border)', borderRadius: 8, color: 'var(--text1)', outline: 'none', boxSizing: 'border-box' }}
          />
          {results.length > 0 && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, zIndex: 10, overflow: 'hidden' }}>
              {results.map((r, i) => (
                <div key={i} onClick={() => select(r.symbol)} style={{ padding: '8px 14px', fontSize: 12, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: i < results.length - 1 ? '0.5px solid var(--border)' : 'none' }}>
                  <div>
                    <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{r.symbol}</span>
                    {r.name && r.name !== r.symbol && (
                      <span style={{ marginLeft: 8, color: 'var(--text3)', fontSize: 10 }}>{r.name}</span>
                    )}
                  </div>
                  <span style={{ color: 'var(--text3)', fontSize: 9, flexShrink: 0, marginLeft: 8 }}>{r.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {selected && (
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh all data"
            style={{
              padding: '10px 12px', fontSize: 15, cursor: refreshing ? 'default' : 'pointer',
              borderRadius: 8, background: 'var(--bg2)', border: '0.5px solid var(--border)',
              color: refreshing ? 'var(--text3)' : 'var(--text1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              transition: 'transform 0.3s',
              transform: refreshing ? 'rotate(180deg)' : 'rotate(0deg)',
            }}>
            ↻
          </button>
        )}
      </div>

      {selected
        ? <TickerView key={`${selected}-${refreshKey}`} symbol={selected} />
        : (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text3)' }}>
            <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>◎</div>
            <div style={{ fontSize: 13 }}>Search any NSE ticker</div>
            <div style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>Price · OI · Technicals · FII · News · Strategy fit</div>
          </div>
        )
      }
    </div>
  )
}
