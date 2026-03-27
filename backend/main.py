from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import asyncio, json, os
import pandas as pd
import numpy as np

from datetime import datetime
from typing import Optional


def _run(fn, *args):
    """Run a blocking function in the default thread pool."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(None, fn, *args)


import math as _math

def _to_python(obj):
    """Recursively convert numpy types to native Python types.
    NaN / Infinity → None so json.dumps produces valid JSON (null)."""
    if isinstance(obj, dict):
        return {k: _to_python(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_python(v) for v in obj]
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        if _math.isnan(obj) or _math.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return [_to_python(v) for v in obj.tolist()]
    return obj


class NumpyJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(_to_python(content)).encode("utf-8")


def J(data) -> NumpyJSONResponse:
    """Wrap a dict/list in NumpyJSONResponse so FastAPI skips jsonable_encoder."""
    return NumpyJSONResponse(content=data)

from data.nse_data import NSEData
from data.market_data import MarketData
from data.news import NewsFetcher
from analysis.oi_analysis import OIAnalysis
from analysis.strategy_fit import StrategyFit
from sentiment.scorer import SentimentScorer
import data.kite_data as kite_data
import data.kite_ticker as kite_ticker

load_dotenv()

# Suppress yfinance / urllib3 noise about delisted / 404 symbols
import logging, warnings
logging.getLogger("yfinance").setLevel(logging.CRITICAL)
logging.getLogger("urllib3").setLevel(logging.CRITICAL)
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message=".*possibly delisted.*")

app = FastAPI(title="QUANTRO API", version="1.0.0", default_response_class=NumpyJSONResponse)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

nse     = NSEData()
market  = MarketData()
news    = NewsFetcher()
scorer  = SentimentScorer()


@app.on_event("startup")
async def startup():
    """Auto-start Kite ticker and pre-warm the expiry signal cache in background."""
    pair = kite_data.get_any_valid_token()
    if pair:
        print("[startup] Kite session found — starting ticker")
        kite_ticker.start(pair[0], pair[1])
    # Pre-warm symbol list and expiry signal so first requests are instant
    asyncio.create_task(_warm_expiry_cache())
    asyncio.get_event_loop().run_in_executor(None, nse.search, "NIFTY")  # triggers symbol list download


@app.on_event("shutdown")
async def shutdown():
    kite_ticker.stop()

TRADES_FILE = os.path.join(os.path.dirname(__file__), "../data/trades.json")

# ── Server-side cache for slow endpoints ──────────────────────────────────────
_EXPIRY_CACHE: dict = {"data": None, "ts": 0.0}
_EXPIRY_TTL = 10 * 60  # 10 minutes


# ── Helpers ───────────────────────────────────────────────────────────────────

def load_trades():
    if not os.path.exists(TRADES_FILE):
        return []
    with open(TRADES_FILE) as f:
        return json.load(f)

def save_trades(trades):
    with open(TRADES_FILE, "w") as f:
        json.dump(trades, f, indent=2)


async def _build_expiry_signal() -> dict:
    """Compute the full expiry signal. Called by both the endpoint and the warmer."""
    vix, fii, oi_data, headlines, global_mkts, spot_data = await asyncio.gather(
        _run(nse.get_india_vix),
        _run(nse.get_fii_dii_today),
        _run(nse.get_options_chain, "NIFTY"),
        _run(news.fetch_all),
        _run(market.get_global_markets),
        _run(nse.get_spot_price, "NIFTY"),
    )
    sentiment  = await scorer.score(headlines)
    gift_nifty = market.get_gift_nifty(precomputed_global=global_mkts)
    macro      = {k: global_mkts.get(k, {}) for k in ("sp500", "crude", "usdinr", "us10y", "gold")}
    spot       = spot_data.get("price")
    oi         = OIAnalysis(oi_data, spot=spot)
    max_pain   = oi.max_pain()
    pcr        = oi.pcr()
    ivr        = oi.ivr()
    walls      = oi.oi_walls()
    fit        = StrategyFit.recommend(
        range_width        = walls["range_width"],
        ivr                = ivr,
        vix                = vix,
        pcr                = pcr,
        risk_score         = sentiment["risk_score"],
        direction          = sentiment.get("direction_bias", "neutral"),
        gap_pts            = gift_nifty.get("gap_pts", 0) or 0,
        max_pain           = max_pain,
        spot               = spot,
        fii_net            = fii.get("index_futures_net", 0) or 0,
        call_wall          = walls.get("call_wall"),
        put_wall           = walls.get("put_wall"),
        distance_to_resist = walls.get("distance_to_resist"),
        distance_to_support= walls.get("distance_to_support"),
    )
    lot_size = await _run(nse.get_lot_size, "NIFTY")
    return {
        "signal":     fit["recommendation"],
        "risk_score": sentiment["risk_score"],
        "direction":  sentiment["direction_bias"],
        "reasoning":  sentiment["reasoning"],
        "vix":        vix,
        "ivr":        ivr,
        "pcr":        pcr,
        "max_pain":   max_pain,
        "lot_size":   lot_size,
        "gift_nifty": gift_nifty,
        "fii_net":    fii["index_futures_net"],
        "walls":      walls,
        "strategy":   fit,
        "sentiment":  sentiment,
    }


async def _warm_expiry_cache():
    """Pre-build the expiry signal cache on startup (runs in background)."""
    try:
        print("[startup] Pre-warming expiry signal cache…")
        data = await _build_expiry_signal()
        _EXPIRY_CACHE["data"] = data
        _EXPIRY_CACHE["ts"]   = asyncio.get_event_loop().time()
        print("[startup] Expiry signal cache ready")
    except Exception as e:
        print(f"[startup] Cache warm failed: {e}")


# ── Home / Daily overview ─────────────────────────────────────────────────────

@app.get("/api/home")
async def get_home():
    """Daily morning dashboard — global markets, sectors, FII/DII, calendar."""
    indices, global_mkts, sectors, fii_dii, calendar = await asyncio.gather(
        _run(market.get_indices),
        _run(market.get_global_markets),
        _run(nse.get_sector_performance),
        _run(nse.get_fii_dii_today),
        _run(market.get_economic_calendar),
    )
    # gift_nifty uses precomputed global_mkts; inject NIFTY close for base value
    nifty_close = (indices.get("nifty") or {}).get("price")
    if nifty_close:
        global_mkts = {**global_mkts, "nifty_close": nifty_close}
    gift_nifty = await _run(market.get_gift_nifty, global_mkts)
    return J({
        "indices":  indices,
        "global":   {**global_mkts, "gift_nifty": gift_nifty},
        "sectors":  sectors,
        "fii_dii":  fii_dii,
        "calendar": calendar,
    })


# ── Expiry / Iron Fly ─────────────────────────────────────────────────────────

@app.get("/api/expiry/signal")
async def get_expiry_signal():
    """Monday night pre-trade signal. Cached 10 min server-side for fast loads."""
    now = asyncio.get_event_loop().time()
    if _EXPIRY_CACHE["data"] and now - _EXPIRY_CACHE["ts"] < _EXPIRY_TTL:
        return J(_EXPIRY_CACHE["data"])
    data = await _build_expiry_signal()
    _EXPIRY_CACHE["data"] = data
    _EXPIRY_CACHE["ts"]   = now
    return J(data)

@app.get("/api/expiry/live")
async def get_expiry_live():
    """Tuesday live cockpit — spot, P&L progress, 3-question check."""
    spot, vix = await asyncio.gather(
        _run(nse.get_spot_price, "NIFTY"),
        _run(nse.get_india_vix),
    )
    return J({
        "spot":    spot,
        "vix":     vix,
        "time":    datetime.now().isoformat(),
    })


# ── Ticker search ─────────────────────────────────────────────────────────────

@app.get("/api/ticker/{symbol:path}")
async def get_ticker(symbol: str):
    """Full instrument analysis for any NSE ticker."""
    symbol = symbol.upper()

    # return_exceptions=True ensures one failing source (e.g. no F&O chain for
    # non-derivatives stocks) does not crash the whole response.
    results = await asyncio.gather(
        _run(nse.get_spot_price, symbol),
        _run(nse.get_ohlcv, symbol),
        _run(nse.get_options_chain, symbol),
        _run(nse.get_fii_dii_today, symbol),
        _run(news.fetch_ticker, symbol),
        _run(nse.get_technicals, symbol),
        _run(nse.get_india_vix),
        return_exceptions=True,
    )

    def ok(v, default=None):
        return default if isinstance(v, Exception) else v

    price      = ok(results[0], {})
    ohlcv      = ok(results[1], {})
    oi_data    = ok(results[2], pd.DataFrame())
    fii        = ok(results[3], {})
    headlines  = ok(results[4], [])
    technicals = ok(results[5], {})
    vix        = ok(results[6], 15.0)

    # Log individual failures for debugging
    for i, label in enumerate(["price","ohlcv","chain","fii","news","technicals","vix"]):
        if isinstance(results[i], Exception):
            print(f"[ticker/{symbol}] {label} failed: {results[i]}")

    try:
        oi    = OIAnalysis(oi_data)
        walls = oi.oi_walls()
        fit   = StrategyFit.recommend(
            range_width = walls["range_width"],
            ivr         = oi.ivr(),
            vix         = vix if isinstance(vix, (int, float)) else 15.0,
        )
        oi_payload = {
            "max_pain": oi.max_pain(),
            "pcr":      oi.pcr(),
            "ivr":      oi.ivr(),
            "walls":    walls,
            "chain":    oi.interpreted_chain(),
            "changes":  oi.oi_changes(),
        }
    except Exception as e:
        print(f"[ticker/{symbol}] analysis failed: {e}")
        oi_payload = {"max_pain": 0, "pcr": 1.0, "ivr": 50, "walls": {}, "chain": [], "changes": []}
        fit = {"recommendation": "Skip", "confidence": 0, "why": "Analysis unavailable.", "signals": {}, "triggers": [], "strikes": {}, "lots": 0, "size_reason": "", "signals_detail": []}

    is_fno = not oi_data.empty

    return J({
        "symbol":     symbol,
        "is_fno":     is_fno,
        "price":      price,
        "ohlcv":      ohlcv,
        "technicals": technicals,
        "oi":         oi_payload,
        "strategy_fit": fit,
        "fii":        fii,
        "news":       headlines,
    })

@app.get("/api/hist/{symbol:path}")
async def get_hist(symbol: str, interval: str = "1d"):
    """Historical OHLCV for charting. interval: 1d | 15m | 5m"""
    return J(await _run(nse.get_hist, symbol.upper(), interval))

@app.get("/api/price/{symbol:path}")
async def get_price(symbol: str):
    """Lightweight spot price only — used for live polling."""
    return J(await _run(nse.get_spot_price, symbol.upper()))

@app.get("/api/search")
async def search_tickers(q: str):
    """Autocomplete ticker search."""
    return J(nse.search(q))


# ── Scanner ───────────────────────────────────────────────────────────────────

@app.get("/api/scanner")
async def get_scanner(filter: Optional[str] = "all"):
    """
    Scan F&O stocks for setups.
    filter: all | high_ivr | oi_buildup | breakout | near_support
    """
    return J(await _run(nse.scan_setups, filter))


# ── Kite Connect ──────────────────────────────────────────────────────────────

from fastapi import Request, Response as FResponse
_COOKIE = "kite_uid"
_COOKIE_OPTS = dict(httponly=True, samesite="lax", max_age=86400)

def _uid(request: Request) -> str:
    return request.cookies.get(_COOKIE, "")

@app.get("/api/kite/status")
async def kite_status(request: Request):
    """Per-user Kite connection status."""
    return J(kite_data.get_status(_uid(request)))

@app.get("/api/kite/auth-url")
async def kite_auth_url():
    """Returns the Kite login URL (same for all users — OAuth handles identity)."""
    return J({"url": kite_data.get_auth_url(), "configured": kite_data.is_configured()})

@app.get("/api/kite/connect")
async def kite_connect(request_token: str):
    """
    OAuth callback — Kite redirects here after the user logs in.
    Works for any Zerodha user: exchanges their request_token for an access_token,
    sets a browser cookie (kite_uid) to identify them on future requests,
    then starts the shared market data ticker if not already running.

    Set this URL in your Kite developer console:
      http://<your-domain>/api/kite/connect
    """
    from fastapi.responses import RedirectResponse
    result = await _run(kite_data.connect, request_token)
    if result.get("ok"):
        user_id = result["user_id"]
        # Start shared ticker if not running (first connected user wins)
        pair = kite_data.get_any_valid_token()
        if pair:
            kite_ticker.start(pair[0], pair[1])
        response = RedirectResponse(url="/?kite=connected")
        response.set_cookie(_COOKIE, user_id, **_COOKIE_OPTS)
        return response
    return RedirectResponse(url="/?kite=error")

@app.get("/api/kite/positions")
async def kite_positions(request: Request):
    """Live positions for the logged-in user."""
    return J(await _run(kite_data.get_positions, _uid(request)))

@app.post("/api/kite/disconnect")
async def kite_disconnect(request: Request, response: FResponse):
    """Clear this user's Kite session. Stops ticker only if no users remain connected."""
    uid = _uid(request)
    kite_data.disconnect(uid)
    # Stop ticker only when no valid sessions remain
    if not kite_data.get_any_valid_token():
        kite_ticker.stop()
    response.delete_cookie(_COOKIE)
    return J({"ok": True})


# ── Live ticker WebSocket ──────────────────────────────────────────────────────

@app.websocket("/ws/ticks")
async def ws_ticks(websocket: WebSocket):
    """
    Frontend connects here to receive real-time LTP updates.
    Sends JSON: { "NIFTY 50": 22934.35, "RELIANCE": 2845.5, ... }
    """
    await websocket.accept()
    loop = asyncio.get_event_loop()
    kite_ticker.register_client(websocket, loop)
    try:
        # Send current cached prices immediately so UI isn't blank
        current = kite_ticker.get_all_ticks()
        if current:
            await websocket.send_json(current)
        # Keep alive — actual data is pushed from the ticker thread
        while True:
            await asyncio.sleep(30)
            await websocket.send_json({"_ping": 1})
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        kite_ticker.unregister_client(websocket)


# ── Positions (Kite-backed) ────────────────────────────────────────────────────

@app.get("/api/positions")
async def get_positions(request: Request):
    """Open positions — from Kite if the user is connected, else empty."""
    uid = _uid(request)
    if kite_data.is_connected(uid):
        pos = await _run(kite_data.get_positions, uid)
        open_pos = [p for p in pos.get("net", []) if p.get("quantity", 0) != 0]
        return J({"positions": open_pos, "source": "kite"})
    return J({"positions": [], "source": "none"})


# ── Trade journal ─────────────────────────────────────────────────────────────

@app.get("/api/journal")
async def get_journal():
    """Full trade history + performance stats."""
    trades  = load_trades()
    closed  = [t for t in trades if t.get("status") != "open"]
    wins    = [t for t in closed if t.get("pnl", 0) > 0]
    losses  = [t for t in closed if t.get("pnl", 0) < 0]
    skips   = [t for t in closed if t.get("action") == "skip"]

    win_rate  = round(len(wins) / len(closed) * 100, 1) if closed else 0
    total_pnl = sum(t.get("pnl", 0) for t in closed)

    return J({
        "trades":     sorted(trades, key=lambda x: x.get("date",""), reverse=True),
        "stats": {
            "total":    len(closed),
            "wins":     len(wins),
            "losses":   len(losses),
            "skips":    len(skips),
            "win_rate": win_rate,
            "total_pnl": total_pnl,
        },
    })

@app.post("/api/journal")
async def add_trade(trade: dict):
    """Log a new trade or skip."""
    trades = load_trades()
    trade["id"]         = f"trade_{len(trades)+1:04d}"
    trade["created_at"] = datetime.now().isoformat()
    trades.append(trade)
    save_trades(trades)
    return J({"ok": True, "trade": trade})

@app.patch("/api/journal/{trade_id}")
async def update_trade(trade_id: str, update: dict):
    """Close a trade — add exit price, P&L, status."""
    trades = load_trades()
    for t in trades:
        if t["id"] == trade_id:
            t.update(update)
            t["closed_at"] = datetime.now().isoformat()
            save_trades(trades)
            return J({"ok": True, "trade": t})
    raise HTTPException(404, "Trade not found")


# ── Calculator ────────────────────────────────────────────────────────────────

@app.get("/api/calc/prefill/{symbol:path}")
async def calc_prefill(symbol: str):
    """Auto-fill Iron Fly calculator from live data."""
    symbol = symbol.upper()
    results = await asyncio.gather(
        _run(nse.get_spot_price, symbol),
        _run(nse.get_options_chain, symbol),
        return_exceptions=True,
    )
    spot_data = results[0] if not isinstance(results[0], Exception) else {}
    chain     = results[1] if not isinstance(results[1], Exception) else pd.DataFrame()
    spot      = spot_data.get("price", 22000)
    lot_size = await _run(nse.get_lot_size, symbol)

    # ATM = nearest strike in chain; fall back to rounding spot
    def _mid(row, side):
        """Use mid-price if bid/ask available, else LTP."""
        bid = float(row.get(f"{side}_bid", 0) or 0)
        ask = float(row.get(f"{side}_ask", 0) or 0)
        ltp = float(row.get(f"{side}_ltp", 0) or 0)
        if bid > 0 and ask > 0:
            return round((bid + ask) / 2, 1)
        return round(ltp, 1)

    try:
        chain["dist"] = (chain["strike"] - spot).abs()
        atm_row  = chain.loc[chain["dist"].idxmin()]
        atm      = int(atm_row["strike"])
        ce_ltp   = _mid(atm_row, "ce")
        pe_ltp   = _mid(atm_row, "pe")
        ce_iv    = round(float(atm_row.get("ce_iv", 0)), 1)
        pe_iv    = round(float(atm_row.get("pe_iv", 0)), 1)
        expiry   = str(atm_row.get("expiry", ""))
        step     = int(chain["strike"].diff().dropna().mode()[0])   # most common strike interval
        wing_w   = step * 2                                          # 2 strikes wide
        # Wing CE = long call at ATM + wing_width; Wing PE = long put at ATM - wing_width
        wing_ce_row = chain[chain["strike"] == atm + wing_w]
        wing_pe_row = chain[chain["strike"] == atm - wing_w]
        wing_ce     = _mid(wing_ce_row.iloc[0], "ce") if not wing_ce_row.empty else round(ce_ltp * 0.4, 1)
        wing_pe     = _mid(wing_pe_row.iloc[0], "pe") if not wing_pe_row.empty else round(pe_ltp * 0.4, 1)
        wing_ce_iv  = round(float(wing_ce_row.iloc[0].get("ce_iv", 0)), 1) if not wing_ce_row.empty else 0
        wing_pe_iv  = round(float(wing_pe_row.iloc[0].get("pe_iv", 0)), 1) if not wing_pe_row.empty else 0
    except Exception as e:
        print(f"[calc_prefill] {symbol}: {e}")
        atm    = int(round(spot / 50) * 50)
        ce_ltp = pe_ltp = wing_ce = wing_pe = 0
        ce_iv  = pe_iv = wing_ce_iv = wing_pe_iv = 0
        wing_w = 100
        expiry = ""

    return J({
        "symbol":       symbol,
        "spot":         round(spot, 1),
        "expiry":       expiry,
        "lot_size":     lot_size,
        "short_strike": atm,
        "wing_width":   wing_w,
        "ce_premium":   ce_ltp,
        "pe_premium":   pe_ltp,
        "wing_ce":      wing_ce,
        "wing_pe":      wing_pe,
        "ce_iv":        ce_iv,
        "pe_iv":        pe_iv,
        "wing_ce_iv":   wing_ce_iv,
        "wing_pe_iv":   wing_pe_iv,
    })


@app.post("/api/calc/ironfly")
async def calc_ironfly(body: dict):
    """
    Calculate Iron Fly P&L, costs, margin, breakevens.
    body: { symbol, spot, short_strike, wing_width, lots, ce_premium, pe_premium, wing_ce, wing_pe }
    """
    lots        = body.get("lots", 1)
    lot_size    = body.get("lot_size", 65)
    ce_pr       = body.get("ce_premium", 0)
    pe_pr       = body.get("pe_premium", 0)
    wing_ce     = body.get("wing_ce", 0)
    wing_pe     = body.get("wing_pe", 0)
    short_s     = body.get("short_strike", 0)
    wing_width  = body.get("wing_width", 100)

    net_premium  = ce_pr + pe_pr - wing_ce - wing_pe
    units        = lots * lot_size
    gross        = net_premium * units

    # Zerodha cost breakdown
    brokerage    = 20 * 4 * lots          # ₹20/order, 4 legs
    stt          = round(gross * 0.0125)  # STT on sell legs at expiry ~0.125%
    exchange     = round(gross * 0.0053)  # NSE exchange charges
    sebi         = round(gross * 0.0001)
    gst          = round(brokerage * 0.18)
    total_cost   = brokerage + stt + exchange + sebi + gst
    net          = gross - total_cost

    # Key levels
    take_profit  = round(net * 0.5)
    stop_loss    = round(net * 2)
    be_upper     = short_s + net_premium
    be_lower     = short_s - net_premium
    max_loss_pts = wing_width - net_premium

    return J({
        "net_premium":  net_premium,
        "gross":        gross,
        "costs": {
            "brokerage": brokerage,
            "stt":       stt,
            "exchange":  exchange,
            "sebi":      sebi,
            "gst":       gst,
            "total":     total_cost,
        },
        "net":          net,
        "take_profit":  take_profit,
        "stop_loss":    stop_loss,
        "be_upper":     be_upper,
        "be_lower":     be_lower,
        "max_loss_pts": max_loss_pts,
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
