/**
 * Real-time price hook via Kite WebSocket.
 *
 * Single shared WebSocket connection — all components subscribe to the same stream.
 * Falls back gracefully when Kite is not connected (returns null).
 *
 * Usage:
 *   const ltp = useTicker('NIFTY 50')       // single symbol → number | null
 *   const prices = useTickerAll()            // all prices → { 'NIFTY 50': 22934, ... }
 */

import { useState, useEffect } from 'react'

// ── Shared singleton state ────────────────────────────────────────────────────

const _prices     = {}                  // symbol → ltp
const _listeners  = new Set()           // (prices) => void
let   _ws         = null
let   _connected  = false
let   _retryTimer = null

function _notify() {
  const snap = { ..._prices }
  _listeners.forEach(fn => fn(snap))
}

function _connect() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return

  try {
    _ws = new WebSocket(`ws://${location.host}/ws/ticks`)

    _ws.onopen = () => {
      _connected = true
      if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null }
    }

    _ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data._ping) return            // keepalive, ignore
        let changed = false
        for (const [sym, ltp] of Object.entries(data)) {
          if (_prices[sym] !== ltp) { _prices[sym] = ltp; changed = true }
        }
        if (changed) _notify()
      } catch { /* ignore malformed */ }
    }

    _ws.onerror = () => {
      _ws.close()
    }

    _ws.onclose = () => {
      _connected = false
      _ws = null
      // Reconnect with back-off (2s, then 5s, then every 10s)
      _retryTimer = setTimeout(_connect, _retryTimer ? 10000 : 2000)
    }
  } catch { /* WebSocket not supported / blocked */ }
}

// Start connection immediately (singleton)
_connect()

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** Returns live LTP for a single symbol, or null if not yet received. */
export function useTicker(symbol) {
  const [ltp, setLtp] = useState(_prices[symbol] ?? null)

  useEffect(() => {
    // If we already have it, set immediately
    if (_prices[symbol] != null) setLtp(_prices[symbol])

    const listener = (prices) => {
      if (symbol in prices) setLtp(prices[symbol])
    }
    _listeners.add(listener)
    return () => _listeners.delete(listener)
  }, [symbol])

  return ltp
}

/** Returns a map of all live prices { symbol → ltp }. Updates on every tick. */
export function useTickerAll() {
  const [prices, setPrices] = useState({ ..._prices })

  useEffect(() => {
    const listener = (p) => setPrices(p)
    _listeners.add(listener)
    return () => _listeners.delete(listener)
  }, [])

  return prices
}

/**
 * Whether Kite is actively streaming prices.
 * Returns true only when the WebSocket is open AND real ticks have been received.
 */
export function useTickerConnected() {
  const hasData = () => _connected && Object.keys(_prices).length > 0
  const [connected, setConnected] = useState(hasData())

  useEffect(() => {
    const id = setInterval(() => setConnected(hasData()), 1000)
    return () => clearInterval(id)
  }, [])

  return connected
}
