"""
Global market data — S&P, Dow, Nasdaq, Crude, Gold, USD/INR, GIFT Nifty.
Source: yfinance (free, no API key needed).
Batch-fetches all tickers in one call; results cached for 5 minutes.
"""

import yfinance as yf
from datetime import datetime, date, timedelta
from typing import Optional
import time


TICKERS = {
    "sp500":    "^GSPC",
    "dow":      "^DJI",
    "nasdaq":   "^IXIC",
    "vix_us":   "^VIX",
    "crude":    "CL=F",
    "gold":     "GC=F",
    "usdinr":   "USDINR=X",
    "us10y":    "^TNX",
    "nikkei":   "^N225",
    "hangseng": "^HSI",
}

ECONOMIC_CALENDAR = [
    {"date": "2026-03-24", "event": "US PMI data",           "impact": "moderate"},
    {"date": "2026-03-25", "event": "NIFTY weekly expiry",   "impact": "trade_day"},
    {"date": "2026-03-26", "event": "India CPI release",     "impact": "moderate"},
    {"date": "2026-03-27", "event": "US GDP Q4 final",       "impact": "watch"},
    {"date": "2026-03-28", "event": "No major events",       "impact": "clear"},
    {"date": "2026-04-01", "event": "RBI MPC decision",      "impact": "extreme"},
    {"date": "2026-04-07", "event": "India trade data",      "impact": "low"},
]

_GLOBAL_CACHE: dict = {"data": None, "ts": 0.0}
_CACHE_TTL = 300  # 5 minutes


class MarketData:

    def get_global_markets(self) -> dict:
        """Fetch previous night's closes for all global instruments (batched + cached)."""
        now = time.monotonic()
        if _GLOBAL_CACHE["data"] and now - _GLOBAL_CACHE["ts"] < _CACHE_TTL:
            return _GLOBAL_CACHE["data"]

        result = {}
        try:
            symbols = list(TICKERS.values())
            # Single network call for all tickers
            raw = yf.download(
                tickers=symbols,
                period="2d",
                interval="1d",
                group_by="ticker",
                auto_adjust=True,
                progress=False,
                threads=True,
            )
            for key, ticker in TICKERS.items():
                try:
                    if len(symbols) == 1:
                        hist = raw
                    else:
                        hist = raw[ticker] if ticker in raw.columns.get_level_values(0) else raw
                    close = hist["Close"].dropna()
                    if len(close) >= 2:
                        prev = float(close.iloc[-2])
                        curr = float(close.iloc[-1])
                        chg  = round(curr - prev, 2)
                        pct  = round((chg / prev) * 100, 2) if prev else 0.0
                        result[key] = {
                            "value":  round(curr, 2),
                            "change": chg,
                            "pct":    pct,
                            "bias":   "bullish" if pct > 0.3 else "bearish" if pct < -0.3 else "neutral",
                        }
                    else:
                        result[key] = self._mock_global(key)
                except Exception:
                    result[key] = self._mock_global(key)
        except Exception as e:
            print(f"[Market] batch fetch error: {e}")
            result = {k: self._mock_global(k) for k in TICKERS}

        _GLOBAL_CACHE["data"] = result
        _GLOBAL_CACHE["ts"] = now
        return result

    def get_macro(self) -> dict:
        """Key macro signals relevant to NIFTY."""
        g = self.get_global_markets()
        return {
            "sp500":  g.get("sp500", {}),
            "crude":  g.get("crude", {}),
            "usdinr": g.get("usdinr", {}),
            "us10y":  g.get("us10y", {}),
            "gold":   g.get("gold", {}),
        }

    def get_gift_nifty(self, precomputed_global: Optional[dict] = None) -> dict:
        """
        GIFT Nifty gap estimate.
        Accepts precomputed global markets to avoid a second yfinance fetch.
        """
        try:
            import requests
            url = "https://ifsca.gov.in/api/gift-nifty"
            r   = requests.get(url, timeout=4)
            if r.status_code == 200:
                data = r.json()
                return {"value": data.get("last", 0), "gap_pts": data.get("gap", 0)}
        except Exception:
            pass

        g        = precomputed_global or self.get_global_markets()
        sp_pct   = g.get("sp500", {}).get("pct", 0)
        nifty_close = g.get("nifty_close") or 22381
        gap_est  = round(sp_pct * 50)   # rough: 1% S&P ≈ 50 NIFTY pts
        return {
            "value":   round(nifty_close + gap_est, 2),
            "gap_pts": gap_est,
            "source":  "estimated",
            "bias":    "up" if gap_est > 30 else "down" if gap_est < -30 else "flat",
        }

    def get_indices(self) -> dict:
        """Live Indian indices for home screen."""
        try:
            from data.nse_data import NSEData
            nse = NSEData()
            # Fetch VIX with previous-close change
            try:
                vix_t    = yf.Ticker("^INDIAVIX")
                vix_hist = vix_t.history(period="2d", interval="1d")
                if len(vix_hist) >= 2:
                    vix_curr = round(float(vix_hist["Close"].iloc[-1]), 2)
                    vix_prev = round(float(vix_hist["Close"].iloc[-2]), 2)
                    vix_chg  = round(vix_curr - vix_prev, 2)
                    vix_pct  = round((vix_chg / vix_prev) * 100, 2) if vix_prev else 0.0
                else:
                    vix_curr = round(float(vix_t.fast_info["last_price"]), 2)
                    vix_chg  = 0.0
                    vix_pct  = 0.0
            except Exception:
                vix_curr, vix_chg, vix_pct = 14.5, 0.0, 0.0
            return {
                "nifty":     nse.get_spot_price("NIFTY"),
                "banknifty": nse.get_spot_price("BANKNIFTY"),
                "finnifty":  nse.get_spot_price("FINNIFTY"),
                "vix":       {"value": vix_curr, "price": vix_curr, "change": vix_chg, "pct": vix_pct},
            }
        except Exception as e:
            print(f"[Market] indices error: {e}")
            return {
                "nifty":     {"price": 22381, "pct": -0.08},
                "banknifty": {"price": 47840, "pct":  0.23},
                "finnifty":  {"price": 23450, "pct":  0.11},
                "vix":       {"value": 14.5,  "price": 14.5, "change": 0.0, "pct": 0.0},
            }

    def get_economic_calendar(self) -> list:
        """Economic events for the next 4 weeks (from today onwards)."""
        today   = date.today()
        cutoff  = today + timedelta(days=28)
        events  = [
            e for e in ECONOMIC_CALENDAR
            if today.isoformat() <= e["date"] <= cutoff.isoformat()
        ]
        return events if events else ECONOMIC_CALENDAR

    # ── Mock data ──────────────────────────────────────────────────────────────

    def _mock_global(self, key: str) -> dict:
        mocks = {
            "sp500":    {"value": 5312,  "change": 31.2,   "pct":  0.59, "bias": "bullish"},
            "dow":      {"value": 39820, "change": 124.0,  "pct":  0.31, "bias": "bullish"},
            "nasdaq":   {"value": 16480, "change": 58.4,   "pct":  0.36, "bias": "bullish"},
            "crude":    {"value": 82.4,  "change": 0.94,   "pct":  1.15, "bias": "neutral"},
            "gold":     {"value": 2348,  "change": 6.2,    "pct":  0.26, "bias": "neutral"},
            "usdinr":   {"value": 83.42, "change": -0.04,  "pct": -0.05, "bias": "neutral"},
            "us10y":    {"value": 4.28,  "change": 0.02,   "pct":  0.47, "bias": "neutral"},
            "nikkei":   {"value": 38420, "change": 180.0,  "pct":  0.47, "bias": "bullish"},
            "hangseng": {"value": 17240, "change": -42.0,  "pct": -0.24, "bias": "neutral"},
            "vix_us":   {"value": 18.2,  "change": -0.4,   "pct": -2.15, "bias": "bullish"},
        }
        return mocks.get(key, {"value": 0, "change": 0, "pct": 0, "bias": "neutral"})
