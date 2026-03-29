"""
NSE data — live feeds via jugaad_data (NSE API) + yfinance.
Falls back to mock data on any network / parse error.
Cache layers prevent hammering external APIs.
"""

import time
import math as _math
import requests
import pandas as pd
import yfinance as yf
from typing import Optional


# ── Symbol constants ──────────────────────────────────────────────────────────

FO_STOCKS = [
    "RELIANCE","HDFCBANK","INFY","TCS","ICICIBANK","AXISBANK","SBIN",
    "BAJFINANCE","TATAMOTORS","TATASTEEL","SUNPHARMA","WIPRO","MARUTI",
    "ADANIENT","LTIM","HINDUNILVR","ONGC","POWERGRID","NTPC","COALINDIA",
    "JSWSTEEL","HINDALCO","TATACONSUM","DIVISLAB","DRREDDY","CIPLA",
    "EICHERMOT","BAJAJFINSV","BRITANNIA","HEROMOTOCO",
]

INDICES = ["NIFTY 50", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"]

# Our internal symbol → yfinance ticker
_YF = {
    "NIFTY":      "^NSEI",
    "NIFTY 50":   "^NSEI",
    "BANKNIFTY":  "^NSEBANK",
    "FINNIFTY":   "^CNXFIN",
    "MIDCPNIFTY": "^NSEMDCP50",
    "INDIAVIX":   "^INDIAVIX",
}

_SECTOR_YF = {
    "Bank":   "^NSEBANK",
    "IT":     "^CNXIT",
    "Auto":   "^CNXAUTO",
    "Pharma": "^CNXPHARMA",
    "Metal":  "^CNXMETAL",
    "FMCG":   "^CNXFMCG",
}

# Symbols that have index option chains on NSE
_INDEX_FO = {"NIFTY", "NIFTY 50", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"}


def _yf_sym(symbol: str) -> str:
    """Convert our symbol name to yfinance ticker."""
    return _YF.get(symbol, symbol + ".NS")


# ── NSELive lazy singleton ────────────────────────────────────────────────────

_nse        = None
_nse_ts     = 0.0
_NSE_TTL    = 600   # re-init session every 10 min

# ── Full NSE equity list cache ─────────────────────────────────────────────────
_SYMLIST_CACHE: dict = {"data": None, "ts": 0.0}
_SYMLIST_TTL = 24 * 3600   # refresh daily


def _load_all_symbols() -> list:
    """
    Download NSE's full equity list (2000+ stocks) from their public CSV.
    Cached for 24 hours. Falls back to hardcoded FO_STOCKS on error.
    """
    import io, requests
    now = time.monotonic()
    if _SYMLIST_CACHE["data"] and now - _SYMLIST_CACHE["ts"] < _SYMLIST_TTL:
        return _SYMLIST_CACHE["data"]
    try:
        r = requests.get(
            "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=10,
        )
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text))
        # Columns: SYMBOL, " NAME OF COMPANY", SERIES, ...
        name_col = next((c for c in df.columns if "NAME" in c.upper()), df.columns[1])
        symbols = [
            {"symbol": str(row["SYMBOL"]).strip(), "name": str(row[name_col]).strip(), "type": "Equity"}
            for _, row in df.iterrows()
            if str(row.get("SERIES", "EQ")).strip() in ("EQ", "BE", "BZ", "")
        ]
        # Prepend indices
        for idx in reversed(INDICES):
            symbols.insert(0, {"symbol": idx, "name": idx, "type": "Index"})
        _SYMLIST_CACHE["data"] = symbols
        _SYMLIST_CACHE["ts"]   = now
        print(f"[NSE] loaded {len(symbols)} symbols")
        return symbols
    except Exception as e:
        print(f"[NSE] symbol list error: {e} — using fallback")
        fallback = [{"symbol": s, "name": s, "type": "Index" if s in INDICES else "F&O"} for s in INDICES + FO_STOCKS]
        _SYMLIST_CACHE["data"] = fallback
        _SYMLIST_CACHE["ts"]   = now
        return fallback


def _get_nse():
    """Return a live NSELive session, re-initialising if stale."""
    global _nse, _nse_ts
    now = time.monotonic()
    if _nse is None or now - _nse_ts > _NSE_TTL:
        try:
            from jugaad_data.nse import NSELive
            _nse    = NSELive()
            _nse_ts = now
        except Exception as e:
            print(f"[NSE] session init: {e}")
            _nse = None
    return _nse


# ── Module-level TTL caches ───────────────────────────────────────────────────

_SPOT_CACHE: dict = {}          # symbol → {data, ts}
_OC_CACHE:   dict = {}          # symbol → {data, ts}
_TECH_CACHE: dict = {}          # symbol → {data, ts}
_VIX_CACHE:  dict = {"value": None, "ts": 0.0}
_FII_CACHE:  dict = {"value": None, "ts": 0.0}

_SHORT_TTL  = 60    # 1 min  – spot prices, VIX
_MEDIUM_TTL = 300   # 5 min  – options chain, FII/DII
_LONG_TTL   = 600   # 10 min – technicals (slow to fetch, slow to change)
_LOT_TTL    = 3600  # 1 hour – lot sizes change rarely

_LOT_CACHE: dict = {}         # symbol → {lot_size, ts}
_FO_LOTS_CACHE: dict = {"data": None, "ts": 0.0}   # full CSV lot table, 24h TTL
_EXPIRY_CACHE: dict = {"data": None, "ts": 0.0}    # NSE expiry dates, 6h TTL
_GAINERS_CACHE: dict = {"data": None, "ts": 0.0}   # top gainers, 3 min TTL


def _load_fo_lot_sizes() -> dict:
    """
    Download NSE's official F&O market-lots CSV and return {SYMBOL: lot_size}.
    The CSV has columns: SYMBOL, <month1>, <month2>, <month3> …
    We use the first non-zero value found for each symbol.
    Cached for 24 hours — lot sizes are only revised quarterly.
    """
    import csv, io
    now = time.monotonic()
    if _FO_LOTS_CACHE["data"] and now - _FO_LOTS_CACHE["ts"] < 86400:
        return _FO_LOTS_CACHE["data"]

    url = "https://archives.nseindia.com/content/fo/fo_mktlots.csv"
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/csv,text/plain,*/*",
        "Referer": "https://www.nseindia.com/",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        # NSE CSV uses Windows \r\n — normalise before parsing so csv.reader
        # doesn't choke on embedded carriage returns in unquoted fields.
        text   = resp.content.decode("utf-8", errors="ignore").replace("\r\n", "\n").replace("\r", "\n")
        reader = csv.reader(io.StringIO(text))
        rows   = list(reader)
        # Row 0 is a header like: SYMBOL, Jan 2025, Feb 2025, Mar 2025
        result = {}
        for row in rows[1:]:
            if len(row) < 2:
                continue
            sym = row[0].strip().upper()
            if not sym or sym == "SYMBOL":
                continue
            # Pick first non-empty, non-zero numeric value across month columns
            # Use float() then int() to handle "500", "500.0", "1,500" etc.
            for cell in row[1:]:
                val = cell.strip().replace(",", "").replace(" ", "")
                if not val:
                    continue
                try:
                    num = int(float(val))
                    if num > 0:
                        result[sym] = num
                        break
                except (ValueError, TypeError):
                    continue
        if result:
            _FO_LOTS_CACHE["data"] = result
            _FO_LOTS_CACHE["ts"]   = now
            print(f"[NSE] Loaded {len(result)} F&O lot sizes from NSE CSV")
        return result
    except Exception as e:
        print(f"[NSE] fo_mktlots fetch failed: {e}")
        return _FO_LOTS_CACHE.get("data") or {}


# ── Mock fallback data ────────────────────────────────────────────────────────

_MOCK_PRICES = {
    "NIFTY": 22381, "NIFTY 50": 22381, "BANKNIFTY": 47840,
    "FINNIFTY": 23450, "MIDCPNIFTY": 12180,
    "RELIANCE": 2845, "HDFCBANK": 1642, "INFY": 1780, "TCS": 4120,
    "ICICIBANK": 1245, "AXISBANK": 1095, "SBIN": 812, "BAJFINANCE": 6820,
    "TATAMOTORS": 1015, "TATASTEEL": 164, "SUNPHARMA": 1680, "WIPRO": 535,
    "MARUTI": 12450, "ADANIENT": 2480, "LTIM": 5640, "HINDUNILVR": 2340,
    "ONGC": 285, "POWERGRID": 335, "NTPC": 382, "COALINDIA": 485,
    "JSWSTEEL": 940, "HINDALCO": 685, "TATACONSUM": 1120, "DIVISLAB": 5480,
    "DRREDDY": 6280, "CIPLA": 1560, "EICHERMOT": 4920, "BAJAJFINSV": 1720,
    "BRITANNIA": 4840, "HEROMOTOCO": 4650,
}

_MOCK_CHANGES = {
    "NIFTY": (18, 0.08), "NIFTY 50": (18, 0.08), "BANKNIFTY": (-120, -0.25),
    "FINNIFTY": (45, 0.19), "MIDCPNIFTY": (-22, -0.18),
    "RELIANCE": (12, 0.42), "HDFCBANK": (-8, -0.49), "INFY": (22, 1.25),
    "TCS": (-18, -0.44), "ICICIBANK": (15, 1.21), "AXISBANK": (-5, -0.46),
    "SBIN": (6, 0.74), "BAJFINANCE": (-42, -0.61), "TATAMOTORS": (18, 1.77),
    "TATASTEEL": (2, 1.22), "SUNPHARMA": (-12, -0.71), "WIPRO": (8, 1.50),
    "MARUTI": (95, 0.77), "ADANIENT": (28, 1.14), "LTIM": (-35, -0.62),
    "HINDUNILVR": (12, 0.51), "ONGC": (-3, -1.04), "POWERGRID": (4, 1.21),
    "NTPC": (-5, -1.29), "COALINDIA": (6, 1.25), "JSWSTEEL": (-8, -0.84),
    "HINDALCO": (10, 1.48), "TATACONSUM": (-6, -0.53), "DIVISLAB": (45, 0.83),
    "DRREDDY": (32, 0.51), "CIPLA": (18, 1.16), "EICHERMOT": (-28, -0.57),
    "BAJAJFINSV": (12, 0.70), "BRITANNIA": (-22, -0.45), "HEROMOTOCO": (38, 0.82),
}

LOT_SIZES = {
    "NIFTY": 65, "NIFTY 50": 65, "BANKNIFTY": 35,
    "FINNIFTY": 65, "MIDCPNIFTY": 120,
    "RELIANCE": 250, "HDFCBANK": 550, "INFY": 300, "TCS": 150,
    "ICICIBANK": 700, "AXISBANK": 1200, "SBIN": 1500, "BAJFINANCE": 125,
    "TATAMOTORS": 1425, "TATASTEEL": 5500, "SUNPHARMA": 350, "WIPRO": 1500,
    "MARUTI": 100, "ADANIENT": 625, "LTIM": 75, "HINDUNILVR": 300,
    "ONGC": 1925, "POWERGRID": 4900, "NTPC": 2475, "COALINDIA": 1400,
    "JSWSTEEL": 675, "HINDALCO": 1075, "TATACONSUM": 575,
    "DIVISLAB": 200, "DRREDDY": 125, "CIPLA": 650, "EICHERMOT": 200,
    "BAJAJFINSV": 500, "BRITANNIA": 200, "HEROMOTOCO": 350,
}

_SECTOR_CHANGES_MOCK = {
    "Bank":  0.18, "IT": 0.62, "Auto": -0.31,
    "Pharma": 0.45, "Metal": 0.84, "FMCG": -0.12,
}


# ── NSEData class ─────────────────────────────────────────────────────────────

class NSEData:

    # ── Spot price ─────────────────────────────────────────────────────────────

    def get_spot_price(self, symbol: str) -> dict:
        now    = time.monotonic()
        cached = _SPOT_CACHE.get(symbol)
        if cached and now - cached["ts"] < _SHORT_TTL:
            return cached["data"]

        data = self._spot_via_yfinance(symbol) or self._spot_via_nselive(symbol)
        if data:
            _SPOT_CACHE[symbol] = {"data": data, "ts": now}
            return data
        return self._mock_spot(symbol)

    def _spot_via_yfinance(self, symbol: str) -> dict | None:
        """Try yfinance; return None on any failure."""
        try:
            import warnings
            t  = yf.Ticker(_yf_sym(symbol))
            fi = t.fast_info
            price = round(float(fi["last_price"]), 2)
            # Try 5d history for prev close (more reliable than 2d)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                hist = t.history(period="5d", interval="1d")
            if len(hist) >= 2:
                prev = round(float(hist["Close"].iloc[-2]), 2)
            else:
                prev = round(float(fi.get("previous_close") or price), 2)
            chg = round(price - prev, 2)
            pct = round((chg / prev) * 100, 2) if prev else 0.0
            return {
                "symbol": symbol, "price": price, "change": chg, "pct": pct,
                "open":   round(float(fi.get("open")      or price), 2),
                "high":   round(float(fi.get("day_high")  or price), 2),
                "low":    round(float(fi.get("day_low")   or price), 2),
                "prev":   prev,
                "volume": int(fi.get("three_month_average_volume") or 0),
            }
        except Exception:
            return None

    def _spot_via_nselive(self, symbol: str) -> dict | None:
        """Try NSELive as fallback; return None on any failure."""
        nse = _get_nse()
        if nse is None:
            return None
        try:
            if symbol in _INDEX_FO or symbol == "NIFTY 50":
                nse_sym = "NIFTY 50" if symbol in ("NIFTY", "NIFTY 50") else symbol
                raw   = nse.live_index(nse_sym)
                row   = (raw.get("data") or [{}])[0]
                price = round(float(row["last"]), 2)
                prev  = round(float(row.get("previousClose") or price), 2)
                chg   = round(float(row.get("variation") or (price - prev)), 2)
                pct   = round(float(row.get("percentChange") or 0), 2)
                return {
                    "symbol": symbol, "price": price, "change": chg, "pct": pct,
                    "open": round(float(row.get("open") or price), 2),
                    "high": round(float(row.get("high") or price), 2),
                    "low":  round(float(row.get("low")  or price), 2),
                    "prev": prev, "volume": 0,
                }
            else:
                raw = nse.stock_quote(symbol)
                pi  = raw.get("priceInfo") or {}
                # NSE API uses lastPrice or ltp depending on session
                price = float(
                    pi.get("lastPrice") or pi.get("ltp") or
                    raw.get("lastPrice") or 0
                )
                if not price:
                    return None
                price = round(price, 2)
                prev  = round(float(pi.get("previousClose") or pi.get("prevClose") or price), 2)
                hl    = pi.get("intraDayHighLow") or {}
                return {
                    "symbol": symbol,
                    "price":  price,
                    "change": round(float(pi.get("change") or (price - prev)), 2),
                    "pct":    round(float(pi.get("pChange") or 0), 2),
                    "open":   round(float(pi.get("open") or price), 2),
                    "high":   round(float(hl.get("max") or price), 2),
                    "low":    round(float(hl.get("min") or price), 2),
                    "prev":   prev, "volume": 0,
                }
        except Exception:
            return None

    # ── Lot size ───────────────────────────────────────────────────────────────

    def get_lot_size(self, symbol: str) -> int:
        """
        Return F&O lot size for symbol.
        Priority:
          1. Per-symbol in-memory cache (1 hour TTL)
          2. NSE's official fo_mktlots.csv — exact lot sizes for all F&O symbols
          3. Hard-coded LOT_SIZES fallback dict (covers major indices/stocks offline)
          4. Generic default of 50
        """
        now    = time.monotonic()
        cached = _LOT_CACHE.get(symbol)
        if cached and now - cached["ts"] < _LOT_TTL:
            return cached["lot_size"]

        # 1. Try official NSE CSV (most accurate, covers all F&O symbols)
        fo_lots = _load_fo_lot_sizes()
        lot = fo_lots.get(symbol)

        # 2. Hard-coded fallback for when NSE CSV is unavailable
        if lot is None:
            lot = LOT_SIZES.get(symbol, 50)

        _LOT_CACHE[symbol] = {"lot_size": lot, "ts": now}
        return lot

    # ── OHLCV ──────────────────────────────────────────────────────────────────

    def get_ohlcv(self, symbol: str) -> dict:
        try:
            t    = yf.Ticker(_yf_sym(symbol))
            hist = t.history(period="5d", interval="1d")
            if hist.empty:
                raise ValueError("empty history")
            # Drop rows where Close is NaN (can happen for today if market is mid-session
            # or yfinance hasn't received data yet)
            hist = hist.dropna(subset=["Close", "Open", "High", "Low"])
            if hist.empty:
                raise ValueError("all rows NaN")
            row   = hist.iloc[-1]
            # Use previous row as "prev close" when fast_info is missing
            prev_close_fallback = float(hist.iloc[-2]["Close"]) if len(hist) > 1 else float(row["Close"])
            fi    = t.fast_info
            price = round(float(row["Close"]), 2)
            prev  = round(float(fi.get("previous_close") or prev_close_fallback), 2)
            w52h  = fi.get("fifty_two_week_high")
            w52l  = fi.get("fifty_two_week_low")
            return {
                "open":    round(float(row["Open"]), 2),
                "high":    round(float(row["High"]), 2),
                "low":     round(float(row["Low"]), 2),
                "close":   price,
                "prev":    prev,
                "volume":  int(row["Volume"]),
                "week52h": round(float(w52h), 2) if w52h else None,
                "week52l": round(float(w52l), 2) if w52l else None,
            }
        except Exception as e:
            print(f"[NSE] ohlcv {symbol}: {e}")
            return self._mock_ohlcv(symbol)

    def get_hist(self, symbol: str, interval: str = "1d") -> list:
        """Return OHLCV history as list of dicts for charting.
        interval: '1d' → 3 months daily, '15m' → 5 days 15-min, '5m' → 2 days 5-min
        """
        # yfinance period/interval combinations that work reliably
        _cfg = {
            "1d":  {"period": "3mo",  "interval": "1d"},
            "15m": {"period": "5d",   "interval": "15m"},
            "5m":  {"period": "2d",   "interval": "5m"},
        }
        cfg = _cfg.get(interval, _cfg["1d"])
        try:
            t    = yf.Ticker(_yf_sym(symbol))
            hist = t.history(period=cfg["period"], interval=cfg["interval"], auto_adjust=True)
            if hist.empty:
                return []
            hist = hist.reset_index()
            date_col = "Datetime" if "Datetime" in hist.columns else "Date"
            rows = []
            for _, row in hist.iterrows():
                dt = row[date_col]
                ts = int(dt.timestamp()) if hasattr(dt, "timestamp") else 0
                o = float(row["Open"])
                h = float(row["High"])
                l = float(row["Low"])
                c = float(row["Close"])
                v = int(row["Volume"])
                if any(_math.isnan(x) for x in [o, h, l, c]):
                    continue
                rows.append({"t": ts, "o": round(o, 2), "h": round(h, 2),
                              "l": round(l, 2), "c": round(c, 2), "v": v})
            return rows
        except Exception as e:
            print(f"[NSE] hist {symbol}: {e}")
            return []

    # ── Options chain ──────────────────────────────────────────────────────────

    def get_options_chain(self, symbol: str) -> pd.DataFrame:
        now    = time.monotonic()
        cached = _OC_CACHE.get(symbol)
        if cached and now - cached["ts"] < _MEDIUM_TTL:
            return cached["data"]

        nse = _get_nse()
        if nse is None:
            return self._mock_chain(symbol)

        try:
            nse_sym = "NIFTY" if symbol == "NIFTY 50" else symbol
            if nse_sym in _INDEX_FO:
                raw = nse.index_option_chain(nse_sym)
            else:
                raw = nse.equities_option_chain(nse_sym)

            records = (raw.get("records") or {}).get("data") or []
            if not records:
                # NSE returned no data → non-F&O stock or invalid symbol.
                # Return empty DF (not mock) so the UI shows "no options" correctly.
                return pd.DataFrame()

            spot = float((raw.get("records") or {}).get("underlyingValue") or 22000)

            rows = []
            # Adaptive range: ±10% of spot or 600 pts minimum (handles NIFTY at 22k and stocks at 500)
            range_pts = max(600, int(spot * 0.12))
            near_expiry = ""
            for r in records:
                strike = int(r.get("strikePrice", 0))
                if abs(strike - spot) > range_pts:
                    continue
                ce = r.get("CE") or {}
                pe = r.get("PE") or {}
                if not near_expiry:
                    near_expiry = ce.get("expiryDate") or pe.get("expiryDate") or ""
                rows.append({
                    "strike":    strike,
                    "expiry":    ce.get("expiryDate") or pe.get("expiryDate") or "",
                    "ce_oi":     int(ce.get("openInterest", 0)),
                    "ce_coi":    int(ce.get("changeinOpenInterest", 0)),
                    "ce_iv":     float(ce.get("impliedVolatility", 0)),
                    "ce_ltp":    float(ce.get("lastPrice", 0)),
                    "ce_bid":    float(ce.get("bidprice", ce.get("bidPrice", 0)) or 0),
                    "ce_ask":    float(ce.get("askPrice", ce.get("askprice", 0)) or 0),
                    "ce_volume": int(ce.get("totalTradedVolume", 0)),
                    "pe_oi":     int(pe.get("openInterest", 0)),
                    "pe_coi":    int(pe.get("changeinOpenInterest", 0)),
                    "pe_iv":     float(pe.get("impliedVolatility", 0)),
                    "pe_ltp":    float(pe.get("lastPrice", 0)),
                    "pe_bid":    float(pe.get("bidprice", pe.get("bidPrice", 0)) or 0),
                    "pe_ask":    float(pe.get("askPrice", pe.get("askprice", 0)) or 0),
                    "pe_volume": int(pe.get("totalTradedVolume", 0)),
                })

            if not rows:
                return pd.DataFrame()   # valid chain but no strikes in ±600 range

            df = pd.DataFrame(rows).sort_values("strike").reset_index(drop=True)
            _OC_CACHE[symbol] = {"data": df, "ts": now}
            return df

        except Exception as e:
            print(f"[NSE] options chain {symbol}: {e}")
            return pd.DataFrame()   # API failure → empty (not mock) so UI stays clean

    # ── NSE Expiry Dates ──────────────────────────────────────────────────────

    def get_nse_expiry_dates(self) -> list:
        """
        Fetch real NSE expiry dates from NIFTY option chain.
        Returns list of ISO date strings e.g. ['2026-03-31', '2026-04-07', ...]
        Cached for 6 hours. Falls back to empty list on failure.
        """
        from datetime import datetime
        now = time.monotonic()
        if _EXPIRY_CACHE["data"] is not None and now - _EXPIRY_CACHE["ts"] < 21600:
            return _EXPIRY_CACHE["data"]
        try:
            nse = _get_nse()
            if nse is None:
                return []
            raw    = nse.index_option_chain("NIFTY")
            dates  = (raw.get("records") or {}).get("expiryDates") or []
            # Convert "30-Mar-2026" → "2026-03-30"
            iso    = []
            for d in dates:
                try:
                    iso.append(datetime.strptime(d, "%d-%b-%Y").strftime("%Y-%m-%d"))
                except Exception:
                    pass
            _EXPIRY_CACHE["data"] = iso
            _EXPIRY_CACHE["ts"]   = now
            return iso
        except Exception as e:
            print(f"[NSE] expiry dates: {e}")
            return _EXPIRY_CACHE.get("data") or []

    # ── India VIX ─────────────────────────────────────────────────────────────

    def get_india_vix(self) -> float:
        now = time.monotonic()
        if _VIX_CACHE["value"] is not None and now - _VIX_CACHE["ts"] < _SHORT_TTL:
            return _VIX_CACHE["value"]
        try:
            t    = yf.Ticker("^INDIAVIX")
            hist = t.history(period="2d", interval="1d")
            if not hist.empty:
                val = float(hist["Close"].iloc[-1])
            else:
                val = t.fast_info.get("last_price") or t.fast_info.get("regularMarketPrice")
                if val is None:
                    raise ValueError("VIX unavailable")
                val = float(val)
            vix = round(val, 2)
            _VIX_CACHE["value"] = vix
            _VIX_CACHE["ts"]    = now
            return vix
        except Exception as e:
            print(f"[NSE] VIX: {e}")
            return _VIX_CACHE["value"]  # None if never fetched successfully

    # ── FII / DII ─────────────────────────────────────────────────────────────

    def get_fii_dii_today(self, symbol: str = None) -> dict:
        now = time.monotonic()
        if _FII_CACHE["value"] is not None and now - _FII_CACHE["ts"] < _MEDIUM_TTL:
            return _FII_CACHE["value"]

        nse = _get_nse()
        if nse is None:
            return self._mock_fii_dii()

        try:
            url  = "https://www.nseindia.com/api/fiidiiTradeReact"
            resp = nse.s.get(url, timeout=6)
            data = resp.json()

            fii = next((d for d in data if "FII" in d.get("category", "").upper()), {})
            dii = next((d for d in data if d.get("category", "").strip().upper() == "DII"), {})

            def _parse(val):
                try:
                    return round(float(str(val).replace(",", "")), 0)
                except Exception:
                    return 0.0

            fii_net = int(_parse(fii.get("netValue", 0)))
            dii_net = int(_parse(dii.get("netValue", 0)))
            fii_buy = int(_parse(fii.get("buyValue", 0)))
            fii_sel = int(_parse(fii.get("sellValue", 0)))

            # NSE fiidiiTradeReact gives one total row per category — not split by
            # cash/futures/options. Using total FII net for directional bias.
            result = {
                "index_futures_net": fii_net,   # total FII net (proxy for bias; cash+deriv combined)
                "index_options_net": None,       # not separately available from this endpoint
                "cash_net_fii":      None,       # not separately available from this endpoint
                "cash_net_dii":      dii_net,
                "fii_buy":           fii_buy,
                "fii_sell":          fii_sel,
                "label":             "FII net long" if fii_net > 0 else "FII net short",
                "bias":              "bullish" if fii_net > 0 else "bearish",
            }
            _FII_CACHE["value"] = result
            _FII_CACHE["ts"]    = now
            return result

        except Exception as e:
            print(f"[NSE] FII/DII: {e}")
            return self._mock_fii_dii()

    # ── Sector performance ────────────────────────────────────────────────────

    def get_sector_performance(self) -> list:
        try:
            symbols = list(_SECTOR_YF.values())
            raw = yf.download(
                tickers     = symbols,
                period      = "2d",
                interval    = "1d",
                group_by    = "ticker",
                auto_adjust = True,
                progress    = False,
                threads     = True,
            )
            result = []
            for sector, sym in _SECTOR_YF.items():
                try:
                    hist  = raw[sym] if len(symbols) > 1 else raw
                    close = hist["Close"].dropna()
                    if len(close) >= 2:
                        pct = round(
                            (float(close.iloc[-1]) - float(close.iloc[-2]))
                            / float(close.iloc[-2]) * 100, 2
                        )
                    else:
                        pct = None   # only 1 day of data — no change available
                except Exception:
                    pct = None       # download failed — show dash, not fake value
                result.append({
                    "sector": sector,
                    "change": pct,
                    "bias":   ("bullish" if pct > 0 else "bearish" if pct < 0 else "neutral") if pct is not None else "neutral",
                })
            return result
        except Exception as e:
            print(f"[NSE] sectors: {e}")
            return self._mock_sectors()

    # ── Stock-level institutional proxies ────────────────────────────────────

    def get_stock_institutional(self, symbol: str) -> dict:
        """
        Returns stock-specific institutional activity proxies:
          - delivery_pct   : % of traded volume delivered (high = institutional accumulation)
          - futures_oi     : open interest on stock futures
          - futures_oi_chg : OI change today (+ = positions building, - = unwinding)
          - futures_bias   : bullish / bearish / neutral derived from price + OI direction
          - pcr            : put-call ratio from options chain
          - note           : disclaimer that this is a proxy, not actual FII/DII data
        """
        result = {
            "delivery_pct":   None,
            "futures_oi":     None,
            "futures_oi_chg": None,
            "futures_bias":   "neutral",
            "pcr":            None,
            "note": "Institutional proxy — delivery %, futures OI & PCR. True stock-level FII/DII is disclosed quarterly only.",
        }
        try:
            nse = _get_nse()
            ti  = nse.trade_info(symbol)
            dp  = ti.get("securityWiseDP", {})
            if dp.get("deliveryToTradedQuantity") is not None:
                result["delivery_pct"] = round(float(dp["deliveryToTradedQuantity"]), 1)
        except Exception as e:
            print(f"[NSE] trade_info {symbol}: {e}")

        try:
            nse  = _get_nse()
            fno  = nse.stock_quote_fno(symbol)
            data = fno.get("stocks", [])
            # Find the nearest futures contract
            for row in data:
                if row.get("metadata", {}).get("instrumentType") == "Stock Futures":
                    md = row["metadata"]
                    oi     = md.get("openInterest")
                    oi_chg = md.get("changeinOpenInterest")
                    price_chg = md.get("change", 0)
                    result["futures_oi"]     = oi
                    result["futures_oi_chg"] = oi_chg
                    # Price up + OI up = longs building (bullish)
                    # Price down + OI up = shorts building (bearish)
                    # OI down = positions unwinding
                    if oi_chg and oi_chg > 0:
                        result["futures_bias"] = "bullish" if (price_chg or 0) >= 0 else "bearish"
                    elif oi_chg and oi_chg < 0:
                        result["futures_bias"] = "neutral"  # unwinding
                    break
        except Exception as e:
            print(f"[NSE] stock_quote_fno {symbol}: {e}")

        try:
            chain = self.get_options_chain(symbol)
            if not chain.empty:
                total_ce = int(chain["ce_oi"].sum())
                total_pe = int(chain["pe_oi"].sum())
                if total_ce:
                    result["pcr"] = round(total_pe / total_ce, 2)
        except Exception:
            pass

        return result

    # ── Top gainers ───────────────────────────────────────────────────────────

    def get_top_gainers(self, n: int = 15) -> list:
        """
        Fetch top N gainers from NIFTY 50 stocks by % change today.
        Cached 3 minutes.
        """
        now = time.monotonic()
        if _GAINERS_CACHE["data"] is not None and now - _GAINERS_CACHE["ts"] < 180:
            return _GAINERS_CACHE["data"]
        try:
            tickers = [s + ".NS" for s in FO_STOCKS]
            raw = yf.download(
                tickers     = tickers,
                period      = "2d",
                interval    = "1d",
                group_by    = "ticker",
                auto_adjust = True,
                progress    = False,
                threads     = True,
            )
            results = []
            for sym in FO_STOCKS:
                yf_sym = sym + ".NS"
                try:
                    hist  = raw[yf_sym] if len(tickers) > 1 else raw
                    close = hist["Close"].dropna()
                    if len(close) < 2:
                        continue
                    prev  = float(close.iloc[-2])
                    curr  = float(close.iloc[-1])
                    pct   = round((curr - prev) / prev * 100, 2)
                    results.append({"symbol": sym, "price": round(curr, 2), "change": pct})
                except Exception:
                    continue
            results.sort(key=lambda x: x["change"], reverse=True)
            top = results[:n]
            _GAINERS_CACHE["data"] = top
            _GAINERS_CACHE["ts"]   = now
            return top
        except Exception as e:
            print(f"[NSE] gainers: {e}")
            return _GAINERS_CACHE["data"] or []

    # ── Technicals ────────────────────────────────────────────────────────────

    def get_technicals(self, symbol: str) -> dict:
        now    = time.monotonic()
        cached = _TECH_CACHE.get(symbol)
        if cached and now - cached["ts"] < _LONG_TTL:
            return cached["data"]
        try:
            hist = yf.Ticker(_yf_sym(symbol)).history(period="3mo", interval="1d")
            if len(hist) < 20:
                raise ValueError("insufficient history")

            close = hist["Close"]
            ema20 = round(float(close.ewm(span=20, adjust=False).mean().iloc[-1]), 1)
            ema50 = round(
                float(close.ewm(span=50, adjust=False).mean().iloc[-1])
                if len(close) >= 50 else ema20, 1
            )

            delta = close.diff()
            gain  = delta.clip(lower=0).rolling(14).mean()
            loss  = (-delta.clip(upper=0)).rolling(14).mean()
            rs    = gain.iloc[-1] / loss.iloc[-1] if loss.iloc[-1] else 1.0
            rsi   = round(float(100 - 100 / (1 + rs)), 1)

            support    = round(float(hist["Low"].tail(20).min()), 1)
            resistance = round(float(hist["High"].tail(20).max()), 1)
            price      = float(close.iloc[-1])

            trend = (
                "bullish"  if price > ema20 > ema50 else
                "bearish"  if price < ema20 < ema50 else
                "sideways"
            )

            data = {
                "trend": trend, "ema20": ema20, "ema50": ema50,
                "rsi": rsi, "support": support, "resistance": resistance,
            }
            _TECH_CACHE[symbol] = {"data": data, "ts": now}
            return data
        except Exception as e:
            print(f"[NSE] technicals {symbol}: {e}")
            return self._mock_technicals(symbol)

    # ── Scanner ───────────────────────────────────────────────────────────────

    # Cache: { filter → {data, ts} }  — 5-minute TTL (options data changes slowly)
    _SCAN_CACHE: dict = {}
    _SCAN_TTL = 300

    def scan_setups(self, filter: str = "all") -> list:
        now    = time.monotonic()
        cached = self._SCAN_CACHE.get(filter)
        if cached and now - cached["ts"] < self._SCAN_TTL:
            return cached["data"]

        vix = self.get_india_vix()

        def _scan_one(symbol: str) -> dict | None:
            try:
                spot  = self.get_spot_price(symbol)
                chain = self.get_options_chain(symbol)
                tech  = self.get_technicals(symbol)
                oi    = _OIQuick(chain)
                ivr   = oi.ivr()
                pcr   = oi.pcr()
                walls = oi.oi_walls()
                price = spot.get("price") or 0
                pct   = spot.get("pct") or 0

                strategy, confidence, signals = _score_signals(
                    ivr        = ivr,
                    pcr        = pcr,
                    vix        = vix,
                    trend      = tech.get("trend", "sideways"),
                    rsi        = tech.get("rsi", 50),
                    price      = price,
                    ema20      = tech.get("ema20", price),
                    ema50      = tech.get("ema50", price),
                    pct_change = pct,
                    range_width= walls["range_width"],
                    call_wall  = walls["call_wall"],
                    put_wall   = walls["put_wall"],
                )

                return {
                    "symbol":     symbol,
                    "price":      price,
                    "change":     pct,
                    "ivr":        ivr,
                    "strategy":   strategy,
                    "range":      walls["range_width"],
                    "detail":     f"IVR {ivr} · PCR {pcr} · RSI {tech.get('rsi','—')} · {tech.get('trend','—').capitalize()}",
                    "confidence": confidence,
                    "signals":    signals,
                    "_walls":     walls,
                }
            except Exception as e:
                print(f"[Scanner] {symbol}: {e}")
                return None

        # Fetch all symbols in parallel — options chain is cached per-symbol so
        # repeated scanner runs are instant; first run hits NSE in parallel threads.
        from concurrent.futures import ThreadPoolExecutor, as_completed
        symbols = FO_STOCKS  # scan all 30 F&O stocks
        raw = []
        with ThreadPoolExecutor(max_workers=10) as pool:
            futures = {pool.submit(_scan_one, sym): sym for sym in symbols}
            for future in as_completed(futures):
                r = future.result()
                if r:
                    raw.append(r)

        # Apply filters
        results = []
        for r in raw:
            walls = r.pop("_walls", {})
            if filter == "high_ivr"     and r["ivr"] < 50:                              continue
            if filter == "oi_buildup"   and r["ivr"] < 30:                              continue
            if filter == "breakout"     and "Bull" not in r["strategy"] and "Bear" not in r["strategy"]: continue
            if filter == "near_support" and walls.get("distance_to_support", 999) > 100: continue
            results.append(r)

        results.sort(key=lambda x: x.get("confidence", 0), reverse=True)
        out = results[:10]
        self._SCAN_CACHE[filter] = {"data": out, "ts": now}
        return out

    def scan_one_symbol(self, symbol: str) -> dict | None:
        """Scan a single symbol on demand — used by frontend search."""
        vix = self.get_india_vix()
        try:
            spot  = self.get_spot_price(symbol)
            chain = self.get_options_chain(symbol)
            tech  = self.get_technicals(symbol)
            oi    = _OIQuick(chain)
            ivr   = oi.ivr()
            pcr   = oi.pcr()
            walls = oi.oi_walls()
            price = spot.get("price") or 0
            pct   = spot.get("pct") or 0
            strategy, confidence, signals = _score_signals(
                ivr=ivr, pcr=pcr, vix=vix,
                trend=tech.get("trend", "sideways"), rsi=tech.get("rsi", 50),
                price=price, ema20=tech.get("ema20", price), ema50=tech.get("ema50", price),
                pct_change=pct, range_width=walls["range_width"],
                call_wall=walls["call_wall"], put_wall=walls["put_wall"],
            )
            return {
                "symbol": symbol, "price": price, "change": pct,
                "ivr": ivr, "strategy": strategy,
                "range": walls["range_width"],
                "detail": f"IVR {ivr} · PCR {pcr} · RSI {tech.get('rsi','—')} · {tech.get('trend','—').capitalize()}",
                "confidence": confidence, "signals": signals,
            }
        except Exception as e:
            print(f"[Scanner] {symbol}: {e}")
            return None

    def search(self, q: str) -> list:
        symbols = _load_all_symbols()
        q_up    = q.upper().strip()
        if not q_up:
            return []
        # Symbol prefix match first, then company name contains
        by_sym  = [s for s in symbols if s["symbol"].startswith(q_up)]
        by_name = [s for s in symbols if q_up in s["name"].upper() and not s["symbol"].startswith(q_up)]
        results = (by_sym + by_name)[:12]
        return [{"symbol": r["symbol"], "name": r["name"], "type": r["type"]} for r in results]

    # ── Mock helpers (fallback) ───────────────────────────────────────────────

    def _mock_spot(self, symbol: str) -> dict:
        """Data unavailable — return nulls, never fake prices."""
        return {
            "symbol": symbol, "price": None, "change": None, "pct": None,
            "open": None, "high": None, "low": None, "prev": None, "volume": None,
        }

    def _mock_ohlcv(self, symbol: str) -> dict:
        return {
            "open": None, "high": None, "low": None, "close": None,
            "prev": None, "volume": None, "week52h": None, "week52l": None,
        }

    def _mock_fii_dii(self) -> dict:
        return {
            "index_futures_net": None, "index_options_net": None,
            "cash_net_fii": None, "cash_net_dii": None,
            "label": "Unavailable", "bias": "neutral",
        }

    def _mock_sectors(self) -> list:
        return []

    def _mock_chain(self, symbol: str) -> pd.DataFrame:
        return pd.DataFrame()

    def _mock_technicals(self, symbol: str) -> dict:
        return {
            "trend": None, "ema20": None, "ema50": None, "rsi": None,
            "support": None, "resistance": None,
        }


# ── Lightweight OI helper for scanner ────────────────────────────────────────

class _OIQuick:
    """Lightweight OI helper used only by scan_setups."""

    def __init__(self, df: pd.DataFrame):
        required = {"ce_oi", "pe_oi", "ce_iv", "pe_iv", "strike"}
        if df is None or df.empty or not required.issubset(df.columns):
            raise ValueError("options chain unavailable or missing columns")
        self.df = df

    def ivr(self) -> int:
        try:
            mid   = len(self.df) // 2
            ce_iv = float(self.df.iloc[mid]["ce_iv"])
            pe_iv = float(self.df.iloc[mid]["pe_iv"])
            avg   = (ce_iv + pe_iv) / 2
            if avg <= 0:
                raise ValueError("zero IV — chain likely outside market hours")
            # Normalise against NSE IV range 10-60 (wider to avoid perpetual 100)
            return min(100, max(0, int((avg - 10) / 50 * 100)))
        except Exception:
            raise   # propagate so _scan_one skips this symbol rather than using fake IVR

    def pcr(self) -> float:
        total_ce = int(self.df["ce_oi"].sum())
        total_pe = int(self.df["pe_oi"].sum())
        return round(total_pe / total_ce, 2) if total_ce else 1.0

    def oi_walls(self) -> dict:
        ce_max = int(self.df.loc[self.df["ce_oi"].idxmax(), "strike"])
        pe_max = int(self.df.loc[self.df["pe_oi"].idxmax(), "strike"])
        return {
            "call_wall":           ce_max,
            "put_wall":            pe_max,
            "range_width":         ce_max - pe_max,
            "distance_to_support": 80,
        }

    def confidence(self) -> int:
        # Legacy fallback — real confidence now comes from _score_signals
        ivr = self.ivr()
        base = 50 + (ivr - 50) // 5 if ivr > 50 else 40
        return min(80, max(30, base))


def _score_signals(
    ivr: int, pcr: float, vix: float, trend: str, rsi: float,
    price: float, ema20: float, ema50: float, pct_change: float,
    range_width: int, call_wall: int, put_wall: int,
) -> tuple[str, int, dict]:
    """
    Score 7 independent signals, each casting a directional vote.
      +1 = bullish,  -1 = bearish,  0 = neutral/skip
    Only recommend a strategy when enough signals agree.
    Returns (strategy_name, confidence_0_100, signals_dict).
    """

    signals = {}

    # 1. Trend (EMA alignment)
    if trend == "bullish":   signals["trend"] = 1
    elif trend == "bearish": signals["trend"] = -1
    else:                    signals["trend"] = 0

    # 2. RSI momentum
    if rsi >= 60:            signals["rsi"] = 1
    elif rsi <= 40:          signals["rsi"] = -1
    else:                    signals["rsi"] = 0

    # 3. Price vs EMA20
    if ema20 and price > ema20 * 1.005:   signals["ema"] = 1
    elif ema20 and price < ema20 * 0.995: signals["ema"] = -1
    else:                                  signals["ema"] = 0

    # 4. PCR (Put-Call Ratio)
    # PCR > 1.2 → more puts = hedging → underlying likely supported → bullish
    # PCR < 0.8 → more calls = speculation → underlying may be topping → bearish
    if pcr >= 1.2:    signals["pcr"] = 1
    elif pcr <= 0.8:  signals["pcr"] = -1
    else:             signals["pcr"] = 0

    # 5. Price momentum (recent day % change)
    if pct_change >= 1.0:    signals["momentum"] = 1
    elif pct_change <= -1.0: signals["momentum"] = -1
    else:                    signals["momentum"] = 0

    # 6. OI wall skew — spot closer to call wall = bearish resistance overhead
    if call_wall and put_wall and call_wall > put_wall:
        mid      = (call_wall + put_wall) / 2
        skew     = (price - mid) / (call_wall - put_wall + 1)
        if skew > 0.1:   signals["oi_skew"] = -1   # near call wall = resistance
        elif skew < -0.1: signals["oi_skew"] = 1    # near put wall = support
        else:             signals["oi_skew"] = 0
    else:
        signals["oi_skew"] = 0

    # 7. IVR regime — high IV favours selling, not buying direction
    #    Only counts toward neutral conviction, not directional
    high_ivr = ivr >= 50

    total = sum(signals.values())
    bullish_count = sum(1 for v in signals.values() if v == 1)
    bearish_count = sum(1 for v in signals.values() if v == -1)
    aligned = max(bullish_count, bearish_count)  # how many signals agree

    high_vix  = vix and vix > 22
    ivr_ok    = ivr >= 30

    # ── Strategy selection ────────────────────────────────────────────────────

    # Need at least 4/7 signals aligned for directional, else check neutral
    DIRECTIONAL_THRESHOLD = 4
    NEUTRAL_THRESHOLD     = 3   # for neutral/range-bound setups

    if not ivr_ok:
        # IV too low — premium not worth selling
        return "Skip", 0, signals

    if total >= DIRECTIONAL_THRESHOLD:
        # Bullish bias
        if high_vix:
            strategy = "Bull Put Spread"   # defined risk in volatile tape
        elif high_ivr:
            strategy = "Bull Put Spread"   # sell put spread to collect premium
        else:
            strategy = "Bull Call Spread"  # buy direction cheaply
        confidence = _calc_confidence(aligned, ivr, vix, bullish=True)
        return strategy, confidence, signals

    if total <= -DIRECTIONAL_THRESHOLD:
        # Bearish bias
        if high_vix or high_ivr:
            strategy = "Bear Call Spread"
        else:
            strategy = "Bear Put Spread"
        confidence = _calc_confidence(aligned, ivr, vix, bullish=False)
        return strategy, confidence, signals

    # Neutral — signals conflicting or flat
    if aligned >= NEUTRAL_THRESHOLD and high_ivr and not high_vix:
        if range_width > 0 and range_width <= 200:
            strategy = "Iron Fly"
        elif range_width <= 400:
            strategy = "Iron Condor"
        else:
            strategy = "Short Straddle"
        confidence = _calc_confidence(aligned, ivr, vix, bullish=None)
        return strategy, confidence, signals

    return "Skip", 0, signals


def _calc_confidence(aligned: int, ivr: int, vix: float, bullish) -> int:
    """Compute 0-100 confidence from signal alignment + IV quality."""
    # Base: signal alignment (4→60, 5→75, 6→85, 7→95)
    base = {4: 60, 5: 75, 6: 85, 7: 95}.get(aligned, max(40, aligned * 12))
    # IVR bonus
    if ivr >= 70: base += 10
    elif ivr >= 50: base += 5
    # VIX penalty when extreme
    if vix and vix > 25: base -= 10
    elif vix and vix > 22: base -= 5
    return min(95, max(30, base))
