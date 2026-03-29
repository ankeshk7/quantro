export const fmt = {
  price:  (v) => v ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—',
  pts:    (v) => v != null ? `${v > 0 ? '+' : ''}${Math.round(v)} pts` : '—',
  pct:    (v) => v != null ? `${v > 0 ? '+' : ''}${Number(v).toFixed(2)}%` : '—',
  inr:    (v) => v != null ? `₹${Math.abs(Number(v)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—',
  inrSign:(v) => v != null ? `${v >= 0 ? '+' : '−'}₹${Math.abs(Number(v)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—',
  lakh:   (v) => v != null ? `${(v / 100000).toFixed(1)}L` : '—',
  cr:     (v) => v != null ? `₹${(v / 10000000).toFixed(0)} Cr` : '—',
  round:  (v, d=1) => v != null ? Number(v).toFixed(d) : '—',
}

export function chgColor(v) {
  if (v > 0) return 'var(--green)'
  if (v < 0) return 'var(--red)'
  return 'var(--text2)'
}

export function biasColor(bias) {
  if (bias === 'bullish') return 'var(--green)'
  if (bias === 'bearish') return 'var(--red)'
  return 'var(--amber)'
}

export function biasBadge(bias) {
  if (bias === 'bullish') return 'badge-green'
  if (bias === 'bearish') return 'badge-red'
  return 'badge-amber'
}

export function impactBadge(impact) {
  const map = {
    extreme:     'badge-red',
    high:        'badge-red',
    watch:       'badge-amber',
    moderate:    'badge-amber',
    trade_day:   'badge-green',
    nse_holiday: 'badge-blue',
    us_holiday:  'badge-purple',
    low:         'badge-gray',
    clear:       'badge-gray',
  }
  return map[impact] || 'badge-gray'
}
