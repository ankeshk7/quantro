"""
Kite WebSocket ticker — real-time price streaming.

Connects to Zerodha's KiteTicker, subscribes to NSE instruments,
and broadcasts LTP updates to all connected frontend WebSocket clients.

The ticker runs on a background thread; notifications to FastAPI
async handlers are posted via asyncio.run_coroutine_threadsafe().
"""

import asyncio
import threading
import time
from typing import Optional

# ── Shared state ──────────────────────────────────────────────────────────────

_tick_cache:     dict = {}          # symbol → ltp  (read by REST fallback too)
_token_to_sym:   dict = {}          # instrument_token → symbol
_ws_clients:     set  = set()       # FastAPI WebSocket objects
_clients_lock         = threading.Lock()
_event_loop: Optional[asyncio.AbstractEventLoop] = None

_ticker       = None
_ticker_lock  = threading.Lock()


# ── Public API ────────────────────────────────────────────────────────────────

def get_ltp(symbol: str) -> Optional[float]:
    """Return latest LTP for symbol, or None if not yet received."""
    return _tick_cache.get(symbol)


def get_all_ticks() -> dict:
    return dict(_tick_cache)


def is_running() -> bool:
    return _ticker is not None


def register_client(ws, loop: asyncio.AbstractEventLoop):
    """Register a FastAPI WebSocket client to receive tick broadcasts."""
    global _event_loop
    _event_loop = loop
    with _clients_lock:
        _ws_clients.add(ws)


def unregister_client(ws):
    with _clients_lock:
        _ws_clients.discard(ws)


# ── Ticker lifecycle ──────────────────────────────────────────────────────────

def start(api_key: str, access_token: str):
    """Start KiteTicker in a background thread. Safe to call multiple times."""
    global _ticker
    with _ticker_lock:
        if _ticker is not None:
            return   # already running
        threading.Thread(target=_run_ticker, args=(api_key, access_token), daemon=True).start()


def stop():
    global _ticker
    with _ticker_lock:
        if _ticker is not None:
            try:
                _ticker.close()
            except Exception:
                pass
            _ticker = None


def _run_ticker(api_key: str, access_token: str):
    global _ticker
    try:
        from kiteconnect import KiteConnect, KiteTicker
        from data.nse_data import FO_STOCKS

        # ── Build instrument map ───────────────────────────────────────────
        kite = KiteConnect(api_key=api_key)
        kite.set_access_token(access_token)

        print("[Ticker] fetching instrument list…")
        instruments = kite.instruments("NSE")

        # Symbols we want to track
        want = set(FO_STOCKS) | {"NIFTY 50", "NIFTY BANK", "INDIA VIX",
                                   "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"}

        token_to_sym: dict = {}
        tokens: list = []
        for inst in instruments:
            sym = inst["tradingsymbol"]
            if sym in want:
                tok = inst["instrument_token"]
                token_to_sym[tok] = sym
                tokens.append(tok)

        # Kite index tokens (hardcoded as they never change)
        INDEX_TOKENS = {
            256265:  "NIFTY 50",
            260105:  "NIFTY BANK",
            264969:  "INDIA VIX",
        }
        for tok, sym in INDEX_TOKENS.items():
            if tok not in token_to_sym:
                token_to_sym[tok] = sym
                tokens.append(tok)

        _token_to_sym.update(token_to_sym)
        print(f"[Ticker] subscribing to {len(tokens)} instruments")

        # ── Callbacks ──────────────────────────────────────────────────────
        def on_ticks(ws, ticks):
            updated = {}
            for tick in ticks:
                tok = tick.get("instrument_token")
                ltp = tick.get("last_price")
                if tok and ltp is not None:
                    sym = _token_to_sym.get(tok)
                    if sym:
                        _tick_cache[sym] = round(float(ltp), 2)
                        updated[sym] = _tick_cache[sym]
            if updated:
                _broadcast(updated)

        def on_connect(ws, response):
            print("[Ticker] connected — subscribing")
            ws.subscribe(tokens)
            ws.set_mode(ws.MODE_LTP, tokens)

        def on_error(ws, code, reason):
            print(f"[Ticker] error {code}: {reason}")

        def on_close(ws, code, reason):
            print(f"[Ticker] closed {code}: {reason}")
            global _ticker
            _ticker = None

        # ── Start ──────────────────────────────────────────────────────────
        kt = KiteTicker(api_key, access_token, reconnect=True)
        kt.on_ticks   = on_ticks
        kt.on_connect = on_connect
        kt.on_error   = on_error
        kt.on_close   = on_close

        with _ticker_lock:
            _ticker = kt

        kt.connect(threaded=False)   # blocks until closed

    except Exception as e:
        print(f"[Ticker] fatal error: {e}")
        with _ticker_lock:
            _ticker = None


# ── Broadcast to frontend WebSocket clients ───────────────────────────────────

def _broadcast(data: dict):
    """Post a tick update to all frontend clients. Called from ticker thread."""
    loop = _event_loop
    if not loop:
        return
    with _clients_lock:
        clients = list(_ws_clients)
    for ws in clients:
        asyncio.run_coroutine_threadsafe(_safe_send(ws, data), loop)


async def _safe_send(ws, data: dict):
    try:
        await ws.send_json(data)
    except Exception:
        with _clients_lock:
            _ws_clients.discard(ws)
