// In dev: VITE_API_URL is unset → calls go to /api (proxied to localhost:8000)
// In prod: VITE_API_URL = https://quantro-api.onrender.com → direct to Render
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api'

// credentials: 'include' sends the kite_uid cookie on every request
async function get(path) {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' })
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  return res.json()
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:      'POST',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(body),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  return res.json()
}

async function patch(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:      'PATCH',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(body),
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`)
  return res.json()
}

export const api = {
  home:         ()           => get('/home'),
  expirySignal: ()           => get('/expiry/signal'),
  expiryLive:   ()           => get('/expiry/live'),
  ticker:       (sym)        => get(`/ticker/${encodeURIComponent(sym)}`),
  hist:         (sym, tf)    => get(`/hist/${encodeURIComponent(sym)}?interval=${tf || '1d'}`),
  price:        (sym)        => get(`/price/${encodeURIComponent(sym)}`),
  search:       (q)          => get(`/search?q=${encodeURIComponent(q)}`),
  scanner:      (filter)     => get(`/scanner?filter=${filter || 'all'}`),
  positions:    ()           => get('/positions'),
  journal:      ()           => get('/journal'),
  addTrade:     (trade)      => post('/journal', trade),
  closeTrade:   (id, update) => patch(`/journal/${id}`, update),
  calcIronfly:  (body)       => post('/calc/ironfly', body),
  calcPrefill:  (sym)        => get(`/calc/prefill/${encodeURIComponent(sym)}`),
  // Kite Connect
  kiteStatus:      ()        => get('/kite/status'),
  kiteAuthUrl:     ()        => get('/kite/auth-url'),
  kitePositions:   ()        => get('/kite/positions'),
  kiteDisconnect:  ()        => post('/kite/disconnect', {}),
}
