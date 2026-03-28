import { chgColor, fmt } from '../../utils/formatters.js'
import { useState, useEffect, createContext, useContext, useCallback } from 'react'

// ── Toast system ───────────────────────────────────────────────────────────────
const ToastCtx = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const add = useCallback((msg, type = 'default', duration = 3000) => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, type }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), duration)
  }, [])
  return (
    <ToastCtx.Provider value={add}>
      {children}
      <div className="toast-wrap">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() { return useContext(ToastCtx) }

// ── Skeleton ───────────────────────────────────────────────────────────────────
export function Skeleton({ width = '100%', height = 13, radius = 4, style }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius, flexShrink: 0, ...style }} />
}

export function SkeletonStatGrid({ cols = 3, rows = 1 }) {
  return (
    <div className={`stat-grid-${cols}`} style={{ marginBottom: 10 }}>
      {Array.from({ length: cols * rows }).map((_, i) => (
        <div key={i} className="stat-card">
          <Skeleton width="55%" height={9} style={{ marginBottom: 8 }} />
          <Skeleton width="75%" height={18} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonCard({ lines = 2 }) {
  return (
    <div className="card" style={{ marginBottom: 6 }}>
      <Skeleton width="45%" height={9} style={{ marginBottom: 8 }} />
      <Skeleton width="80%" height={16} style={{ marginBottom: lines > 1 ? 6 : 0 }} />
      {lines > 1 && <Skeleton width="35%" height={9} />}
    </div>
  )
}

export function StatCard({ label, value, sub, valueColor }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value mono" style={valueColor ? { color: valueColor } : {}}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

export function SignalRow({ label, value, badge, badgeClass }) {
  return (
    <div className="signal-row">
      <span className="key">{label}</span>
      <span className="val">
        {value}
        {badge && <span className={`badge ${badgeClass || 'badge-gray'}`}>{badge}</span>}
      </span>
    </div>
  )
}

export function SectionTitle({ children, style }) {
  return <div className="section-title" style={style}>{children}</div>
}

export function Loading({ type }) {
  if (type === 'scanner') return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="card scanner-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Skeleton width="30%" height={11} style={{ marginBottom: 7 }} />
            <Skeleton width="70%" height={9} />
          </div>
          <Skeleton width={52} height={22} radius={6} />
        </div>
      ))}
    </div>
  )
  if (type === 'home') return (
    <div>
      <SkeletonStatGrid cols={3} />
      <SkeletonStatGrid cols={4} />
      {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
    </div>
  )
  if (type === 'ticker') return (
    <div>
      <Skeleton height={56} style={{ marginBottom: 12 }} />
      <SkeletonStatGrid cols={2} />
      <SkeletonStatGrid cols={3} />
      {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
    </div>
  )
  // default: generic shimmer lines
  return (
    <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Skeleton width="100%" height={13} />
      <Skeleton width="82%" height={13} />
      <Skeleton width="60%" height={13} />
    </div>
  )
}

export function ErrorMsg({ message }) {
  return (
    <div style={{ padding: '1rem', color: 'var(--red)', fontSize: 12, background: 'var(--bg2)', borderRadius: 8 }}>
      {message || 'Something went wrong. Is the backend running?'}
    </div>
  )
}

export function PriceHeader({ symbol, price, change, pct, meta }) {
  return (
    <div style={{ paddingBottom: 10, marginBottom: 8, borderBottom: '0.5px solid var(--border)' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 3 }}>
        {symbol}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 38, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--text1)' }}>
          {fmt.price(price)}
        </span>
        <span style={{ fontSize: 14, color: chgColor(change) }}>
          {change >= 0 ? '▲' : '▼'} {fmt.price(Math.abs(change))} pts
        </span>
        <span style={{ fontSize: 12, color: chgColor(pct) }}>({fmt.pct(pct)})</span>
      </div>
      {meta && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>{meta}</div>}
    </div>
  )
}

export function TendencyCard({ signal, color, reasoning, tags = [] }) {
  return (
    <div className="card" style={{ marginBottom: 8, borderLeft: `2px solid ${color || 'var(--green)'}`, borderRadius: '0 8px 8px 0' }}>
      <div style={{ fontSize: 16, fontWeight: 500, color: color || 'var(--green)', marginBottom: 5 }}>{signal}</div>
      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65, marginBottom: tags.length ? 8 : 0 }}>{reasoning}</div>
      {tags.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {tags.map((t, i) => (
            <span key={i} className={`badge ${t.cls || 'badge-gray'}`}>{t.label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProgressBar({ value, max, color = 'var(--green)', height = 5 }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div style={{ height, background: 'var(--bg3)', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: height / 2, transition: 'width 0.4s' }} />
    </div>
  )
}

export function NewsCard({ headline, source, sentiment, url }) {
  const cls     = sentiment === 'positive' ? 'badge-green' : sentiment === 'negative' ? 'badge-red' : 'badge-amber'
  const content = (
    <>
      <div style={{ fontSize: 12, color: url ? 'var(--text1)' : 'var(--text2)', marginBottom: 4, lineHeight: 1.5 }}>{headline}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{source}</span>
        <span className={`badge ${cls}`}>{sentiment}</span>
      </div>
    </>
  )
  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', display: 'block' }}>
        <div className="card" style={{ marginBottom: 5, cursor: 'pointer' }}>{content}</div>
      </a>
    )
  }
  return <div className="card" style={{ marginBottom: 5 }}>{content}</div>
}
