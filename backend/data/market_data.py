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
    "sp500":    "SPY",      # ETF proxy — ^GSPC unreliable on weekends via batch
    "dow":      "DIA",      # ETF proxy — ^DJI same issue
    "nasdaq":   "QQQ",      # ETF proxy — ^IXIC same issue
    "vix_us":   "^VIX",
    "crude":    "CL=F",
    "gold":     "GC=F",
    "usdinr":   "INR=X",    # USDINR=X often returns empty; INR=X is reliable
    "us10y":    "^TNX",
    "nikkei":   "^N225",
    "hangseng": "^HSI",
}

# Conversion factors for ETF proxies → index points (approx multipliers)
_ETF_TO_INDEX = {
    "sp500":  8.85,    # SPY ≈ S&P 500 / 8.85
    "dow":    311.0,   # DIA ≈ Dow / 311
    "nasdaq": 50.0,    # QQQ ≈ Nasdaq / 50 (rough)
    "usdinr": 1.0,     # INR=X is already USD per INR — we invert below
}

# Static high-impact macro events (updated periodically)
_MACRO_EVENTS = [
    # ── NSE Holidays 2026 ────────────────────────────────────────────────────────
    {"date": "2026-01-26", "event": "NSE Closed — Republic Day",            "impact": "nse_holiday"},
    {"date": "2026-02-26", "event": "NSE Closed — Maha Shivaratri",         "impact": "nse_holiday"},
    {"date": "2026-03-18", "event": "NSE Closed — Holi",                    "impact": "nse_holiday"},
    {"date": "2026-04-02", "event": "NSE Closed — Ramzan Id (Eid ul Fitr)", "impact": "nse_holiday"},
    {"date": "2026-04-03", "event": "NSE Closed — Good Friday",             "impact": "nse_holiday"},
    {"date": "2026-04-14", "event": "NSE Closed — Dr. Ambedkar Jayanti",    "impact": "nse_holiday"},
    {"date": "2026-05-01", "event": "NSE Closed — Maharashtra Day",         "impact": "nse_holiday"},
    {"date": "2026-08-15", "event": "NSE Closed — Independence Day",        "impact": "nse_holiday"},
    {"date": "2026-10-02", "event": "NSE Closed — Gandhi Jayanti",          "impact": "nse_holiday"},
    {"date": "2026-10-19", "event": "NSE Closed — Diwali (Laxmi Puja)",     "impact": "nse_holiday"},
    {"date": "2026-10-20", "event": "NSE Closed — Diwali (Balipratipada)",  "impact": "nse_holiday"},
    {"date": "2026-11-24", "event": "NSE Closed — Gurunanak Jayanti",       "impact": "nse_holiday"},
    {"date": "2026-12-25", "event": "NSE Closed — Christmas",               "impact": "nse_holiday"},
    # ── US Market Holidays 2026 (NYSE) ──────────────────────────────────────────
    {"date": "2026-01-01", "event": "NYSE Closed — New Year's Day",         "impact": "us_holiday"},
    {"date": "2026-01-19", "event": "NYSE Closed — MLK Day",                "impact": "us_holiday"},
    {"date": "2026-02-16", "event": "NYSE Closed — Presidents' Day",        "impact": "us_holiday"},
    {"date": "2026-04-03", "event": "NYSE Closed — Good Friday",            "impact": "us_holiday"},
    {"date": "2026-05-25", "event": "NYSE Closed — Memorial Day",           "impact": "us_holiday"},
    {"date": "2026-06-19", "event": "NYSE Closed — Juneteenth",             "impact": "us_holiday"},
    {"date": "2026-07-03", "event": "NYSE Closed — Independence Day (obs)", "impact": "us_holiday"},
    {"date": "2026-09-07", "event": "NYSE Closed — Labor Day",              "impact": "us_holiday"},
    {"date": "2026-11-26", "event": "NYSE Closed — Thanksgiving",           "impact": "us_holiday"},
    {"date": "2026-12-25", "event": "NYSE Closed — Christmas",              "impact": "us_holiday"},
    # ── March 2026 ──────────────────────────────────────────────────────────────
    {"date": "2026-03-12", "event": "India CPI (Feb)",           "impact": "moderate"},
    {"date": "2026-03-14", "event": "India WPI (Feb)",           "impact": "low"},
    {"date": "2026-03-19", "event": "US Fed FOMC decision",      "impact": "extreme"},
    {"date": "2026-03-24", "event": "India PMI Flash",           "impact": "moderate"},
    {"date": "2026-03-26", "event": "India IIP (Jan)",           "impact": "low"},
    {"date": "2026-03-27", "event": "US GDP Q4 Final",           "impact": "watch"},
    {"date": "2026-03-31", "event": "India fiscal year end",     "impact": "watch"},
    # ── April 2026 ──────────────────────────────────────────────────────────────
    {"date": "2026-04-01", "event": "India new fiscal year",     "impact": "watch"},
    {"date": "2026-04-08", "event": "RBI MPC decision",         "impact": "extreme"},
    {"date": "2026-04-11", "event": "India CPI (Mar)",           "impact": "moderate"},
    {"date": "2026-04-14", "event": "India WPI (Mar)",           "impact": "low"},
    {"date": "2026-04-16", "event": "US retail sales",           "impact": "moderate"},
    {"date": "2026-04-29", "event": "US Fed FOMC decision",      "impact": "extreme"},
    {"date": "2026-04-30", "event": "US GDP Q1 Advance",         "impact": "high"},
    # ── May 2026 ────────────────────────────────────────────────────────────────
    {"date": "2026-05-01", "event": "India PMI Mfg",             "impact": "low"},
    {"date": "2026-05-12", "event": "India CPI (Apr)",           "impact": "moderate"},
    {"date": "2026-05-15", "event": "India IIP (Mar)",           "impact": "low"},
    {"date": "2026-05-29", "event": "India Q4 GDP advance",      "impact": "high"},
    # ── June 2026 ───────────────────────────────────────────────────────────────
    {"date": "2026-06-05", "event": "US Non-Farm Payrolls",      "impact": "moderate"},
    {"date": "2026-06-06", "event": "RBI MPC decision",         "impact": "extreme"},
    {"date": "2026-06-10", "event": "India CPI (May)",           "impact": "moderate"},
    {"date": "2026-06-17", "event": "US Fed FOMC decision",      "impact": "extreme"},
    # ── July 2026 ───────────────────────────────────────────────────────────────
    {"date": "2026-07-07", "event": "India CPI (Jun)",           "impact": "moderate"},
    {"date": "2026-07-08", "event": "RBI MPC decision",         "impact": "extreme"},
    {"date": "2026-07-29", "event": "US Fed FOMC decision",      "impact": "extreme"},
    {"date": "2026-07-30", "event": "US GDP Q2 Advance",         "impact": "high"},
    # ── August 2026 ─────────────────────────────────────────────────────────────
    {"date": "2026-08-12", "event": "India CPI (Jul)",           "impact": "moderate"},
    {"date": "2026-08-14", "event": "India IIP (Jun)",           "impact": "low"},
    # ── September 2026 ──────────────────────────────────────────────────────────
    {"date": "2026-09-12", "event": "India CPI (Aug)",           "impact": "moderate"},
    {"date": "2026-09-16", "event": "US Fed FOMC decision",      "impact": "extreme"},
    {"date": "2026-09-30", "event": "India Q1 FY27 GDP",         "impact": "high"},
    # ── October 2026 ────────────────────────────────────────────────────────────
    {"date": "2026-10-07", "event": "RBI MPC decision",         "impact": "extreme"},
    {"date": "2026-10-13", "event": "India CPI (Sep)",           "impact": "moderate"},
    {"date": "2026-10-28", "event": "US Fed FOMC decision",      "impact": "extreme"},
    # ── November 2026 ───────────────────────────────────────────────────────────
    {"date": "2026-11-12", "event": "India CPI (Oct)",           "impact": "moderate"},
    {"date": "2026-11-13", "event": "India IIP (Sep)",           "impact": "low"},
    # ── December 2026 ───────────────────────────────────────────────────────────
    {"date": "2026-12-04", "event": "RBI MPC decision",         "impact": "extreme"},
    {"date": "2026-12-10", "event": "India CPI (Nov)",           "impact": "moderate"},
    {"date": "2026-12-16", "event": "US Fed FOMC decision",      "impact": "extreme"},
    {"date": "2026-12-31", "event": "Calendar year end",         "impact": "watch"},
]


def _weekly_expiry_tuesdays(from_date: "date", days: int = 365) -> list:
    """Fallback: generate all Tuesdays (NIFTY weekly expiry) for the next `days` days.
    Used only when NSE API is unreachable; real dates come from get_nse_expiry_dates()."""
    events = []
    d = from_date
    # advance to nearest Tuesday (weekday 1)
    while d.weekday() != 1:
        d += timedelta(days=1)
    cutoff = from_date + timedelta(days=days)
    while d <= cutoff:
        events.append({"date": d.isoformat(), "event": "NIFTY weekly expiry", "impact": "trade_day"})
        d += timedelta(weeks=1)
    return events


# Legacy alias — kept so existing callers don't break
ECONOMIC_CALENDAR = _MACRO_EVENTS

_GLOBAL_CACHE: dict = {"data": None, "ts": 0.0}
_CACHE_TTL = 300  # 5 minutes — matches frontend poll interval


class MarketData:

    def get_global_markets(self) -> dict:
        """Fetch previous night's closes for all global instruments (batched + cached)."""
        now = time.monotonic()
        if _GLOBAL_CACHE["data"] and now - _GLOBAL_CACHE["ts"] < _CACHE_TTL:
            return _GLOBAL_CACHE["data"]

        result = {}
        try:
            symbols = list(TICKERS.values())
            # Use 5d to guarantee 2+ trading days even after weekends/holidays
            raw = yf.download(
                tickers=symbols,
                period="5d",
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
                        # INR=X gives USD-per-INR (e.g. 0.01185); invert to get INR-per-USD
                        display_val = curr
                        display_chg = chg
                        if key == "usdinr" and curr < 5:
                            display_val = round(1.0 / curr, 2)
                            prev_inv    = 1.0 / prev if prev else display_val
                            display_chg = round(display_val - prev_inv, 2)
                            pct         = round((display_chg / prev_inv) * 100, 2) if prev_inv else 0.0
                        result[key] = {
                            "value":  round(display_val, 2),
                            "change": display_chg,
                            "pct":    pct,
                            "bias":   "bullish" if pct > 0.3 else "bearish" if pct < -0.3 else "neutral",
                        }
                    elif len(close) == 1:
                        # Only 1 day available — show value without change
                        curr = float(close.iloc[-1])
                        display_val = curr
                        if key == "usdinr" and curr < 5:
                            display_val = round(1.0 / curr, 2)
                        result[key] = {
                            "value":  round(display_val, 2),
                            "change": 0.0,
                            "pct":    0.0,
                            "bias":   "neutral",
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
        GIFT Nifty — tries live SGX/GIFT futures via yfinance, then falls back
        to estimating from S&P 500 + Dow weighted average vs NIFTY prev close.
        """
        nifty_close = (precomputed_global or {}).get("nifty_close") or self._get_nifty_prev_close()

        # Try GIFT Nifty futures directly (traded on NSE IFSC / SGX)
        for ticker in ("NIFTY.SGX", "GNF=F"):
            try:
                t    = yf.Ticker(ticker)
                hist = t.history(period="1d", interval="5m")
                if not hist.empty:
                    gift_val = round(float(hist["Close"].iloc[-1]), 2)
                    gap_pts  = round(gift_val - nifty_close) if nifty_close else 0
                    return {
                        "value":   gift_val,
                        "gap_pts": gap_pts,
                        "source":  "live",
                        "bias":    "up" if gap_pts > 30 else "down" if gap_pts < -30 else "flat",
                    }
            except Exception:
                continue

        # Fallback: weighted estimate from US indices (S&P 60%, Dow 40%)
        # Only estimate when we have both US data and NIFTY prev close.
        g       = precomputed_global or self.get_global_markets()
        sp_pct  = g.get("sp500",  {}).get("pct") or 0
        dow_pct = g.get("dow",    {}).get("pct") or 0

        if not nifty_close:
            # No NIFTY base → can't estimate a level; return unavailable
            return {"value": None, "gap_pts": None, "source": "unavailable", "bias": "flat"}

        us_pct  = sp_pct * 0.6 + dow_pct * 0.4
        # 1% move in US ≈ 0.5–0.6% move in NIFTY; use 0.55 as multiplier
        gap_est  = round((us_pct * 0.55 / 100) * nifty_close)
        gift_val = round(nifty_close + gap_est, 2)
        return {
            "value":   gift_val,
            "gap_pts": gap_est,
            "source":  "estimated",
            "bias":    "up" if gap_est > 30 else "down" if gap_est < -30 else "flat",
        }

    def _get_nifty_prev_close(self) -> Optional[float]:
        try:
            hist = yf.Ticker("^NSEI").history(period="5d", interval="1d")
            close = hist["Close"].dropna()
            return round(float(close.iloc[-1]), 2) if not close.empty else None
        except Exception:
            return None

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
                vix_curr, vix_chg, vix_pct = None, None, None
            return {
                "nifty":     nse.get_spot_price("NIFTY"),
                "banknifty": nse.get_spot_price("BANKNIFTY"),
                "finnifty":  nse.get_spot_price("FINNIFTY"),
                "vix":       {"value": vix_curr, "price": vix_curr, "change": vix_chg, "pct": vix_pct},
            }
        except Exception as e:
            print(f"[Market] indices error: {e}")
            return {
                "nifty":     {"price": None, "pct": None},
                "banknifty": {"price": None, "pct": None},
                "finnifty":  {"price": None, "pct": None},
                "vix":       {"value": None, "price": None, "change": None, "pct": None},
            }

    def get_economic_calendar(self) -> list:
        """Macro events for the next 365 days (expiry dates injected by main.py from NSE API)."""
        today  = date.today()
        cutoff = today + timedelta(days=365)
        macro  = [e for e in _MACRO_EVENTS if today.isoformat() <= e["date"] <= cutoff.isoformat()]
        # Fallback weekly expiries — replaced by real NSE dates in main.py when NSE is reachable
        expiry = _weekly_expiry_tuesdays(today, 365)
        return sorted(macro + expiry, key=lambda e: e["date"])

    def _mock_global(self, key: str) -> dict:
        """Return null-safe empty dict — never return hardcoded fake prices."""
        return {"value": None, "change": None, "pct": None, "bias": "neutral"}
