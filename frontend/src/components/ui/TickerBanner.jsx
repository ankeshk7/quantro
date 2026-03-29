import { useApi } from '../../hooks/useApi.js'
import { api } from '../../utils/api.js'

export default function TickerBanner() {
  const { data } = useApi(() => api.gainers(), [], 'gainers', 3 * 60 * 1000)
  const gainers  = data?.gainers || []

  if (!gainers.length) return null

  // Duplicate the list so the scroll loops seamlessly
  const items = [...gainers, ...gainers]

  return (
    <div style={{
      overflow:     'hidden',
      borderTop:    '0.5px solid var(--border)',
      borderBottom: '0.5px solid var(--border)',
      background:   'var(--bg2)',
      height:       32,
      display:      'flex',
      alignItems:   'center',
      position:     'relative',
    }}>
      <div style={{
        display:         'flex',
        alignItems:      'center',
        gap:             0,
        animation:       'ticker-scroll 40s linear infinite',
        whiteSpace:      'nowrap',
        willChange:      'transform',
      }}>
        {items.map((g, i) => {
          const up    = g.change >= 0
          const color = up ? 'var(--green)' : 'var(--red)'
          const arrow = up ? '▲' : '▼'
          return (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 18px', borderRight: '0.5px solid var(--border)' }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text1)', letterSpacing: '0.04em' }}>
                {g.symbol}
              </span>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>
                {g.price?.toLocaleString('en-IN')}
              </span>
              <span style={{ fontSize: 9, color, fontWeight: 600 }}>
                {arrow} {Math.abs(g.change).toFixed(2)}%
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
