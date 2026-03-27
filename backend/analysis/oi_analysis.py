"""
OI Analysis — max pain, OI walls, PCR, IVR, interpreted chain, OI changes.
All computed from the options chain DataFrame returned by NSEData.
"""

import pandas as pd
import numpy as np
from typing import Optional


def _fmt_oi(val: int) -> str:
    """Format OI value: use K for < 1L, L for >= 1L. Never show 0.0L."""
    if val >= 100_000:
        return f"{val / 100_000:.1f}L"
    elif val >= 1_000:
        return f"{val / 1_000:.0f}K"
    return str(val)


# Plain-English meaning rules for each strike
def _interpret_strike(row, spot, call_wall, put_wall, max_pain, is_atm):
    ce_oi  = row["ce_oi"]
    pe_oi  = row["pe_oi"]
    ce_coi = row.get("ce_coi", 0)
    pe_coi = row.get("pe_coi", 0)
    strike = row["strike"]

    if is_atm:
        return (
            f"Max pain zone. Balanced writing both sides — "
            f"market likely to pin near {int(strike)} into expiry. "
            f"Best center for Iron Fly."
        )
    if strike == call_wall:
        return (
            f"Dominant call wall — key ceiling. "
            f"Option sellers betting spot stays below {int(strike)}. "
            f"Strong resistance, unlikely to break today."
        )
    if strike == put_wall:
        return (
            f"Dominant put wall — key support. "
            f"Put sellers defending {int(strike)} hard. "
            f"Expect bounce if spot touches this."
        )
    if pe_oi > ce_oi * 1.5:
        return f"Heavy put writing — strong support floor. Unlikely to fall below {int(strike)} today."
    if ce_oi > pe_oi * 1.5:
        return f"Heavy call writing — resistance zone. Sellers not expecting a move above {int(strike)}."
    if strike < spot:
        return f"Moderate put support. Secondary floor zone."
    return f"Moderate call resistance. Secondary ceiling zone."


def _oi_change_signal(ce_coi, pe_coi, ce_ltp_chg, pe_ltp_chg):
    """Classify OI change as fresh short, long unwinding, etc."""
    signals = []
    if ce_coi > 0:
        signals.append({
            "leg": "CE", "delta": ce_coi,
            "type": "Fresh short" if ce_ltp_chg <= 0 else "Fresh long",
            "bias": "bearish" if ce_ltp_chg <= 0 else "bullish",
            "explain": (
                "New call sellers entering — ceiling being reinforced."
                if ce_ltp_chg <= 0 else
                "New call buyers entering — bullish momentum building."
            ),
        })
    elif ce_coi < 0:
        signals.append({
            "leg": "CE", "delta": ce_coi,
            "type": "Long unwinding" if ce_ltp_chg <= 0 else "Short covering",
            "bias": "bearish" if ce_ltp_chg <= 0 else "bullish",
            "explain": (
                "Call buyers exiting — giving up on upside. Bearish."
                if ce_ltp_chg <= 0 else
                "Call sellers covering — expecting upside. Bullish."
            ),
        })
    if pe_coi > 0:
        signals.append({
            "leg": "PE", "delta": pe_coi,
            "type": "Fresh short" if pe_ltp_chg >= 0 else "Fresh long",
            "bias": "bullish" if pe_ltp_chg >= 0 else "bearish",
            "explain": (
                "New put sellers entering — support being reinforced. Bullish."
                if pe_ltp_chg >= 0 else
                "New put buyers entering — hedging/bearish bets increasing."
            ),
        })
    return signals


class OIAnalysis:

    def __init__(self, df: pd.DataFrame, spot: Optional[float] = None):
        self.df   = df.copy()
        self.spot = spot or self._estimate_spot()

    def _estimate_spot(self) -> float:
        """ATM strike = closest to where CE≈PE premium."""
        if self.df.empty:
            return 0
        self.df["premium_diff"] = abs(self.df["ce_ltp"] - self.df["pe_ltp"])
        atm_idx  = self.df["premium_diff"].idxmin()
        return float(self.df.loc[atm_idx, "strike"])

    def max_pain(self) -> int:
        """
        Max pain = strike where total option buyer loss is maximum.
        Equivalent to strike where option writers make most money.
        """
        if self.df.empty:
            return 0
        strikes     = self.df["strike"].values
        total_loss  = []
        for s in strikes:
            ce_loss = self.df.apply(
                lambda r: max(0, r["strike"] - s) * r["ce_oi"], axis=1
            ).sum()
            pe_loss = self.df.apply(
                lambda r: max(0, s - r["strike"]) * r["pe_oi"], axis=1
            ).sum()
            total_loss.append(ce_loss + pe_loss)
        mp_idx = np.argmin(total_loss)
        return int(strikes[mp_idx])

    def pcr(self) -> float:
        """Put-Call Ratio — total PE OI / total CE OI."""
        total_ce = self.df["ce_oi"].sum()
        total_pe = self.df["pe_oi"].sum()
        if total_ce == 0:
            return 1.0
        return round(total_pe / total_ce, 2)

    def ivr(self, lookback_days: int = 52) -> int:
        """
        IV Rank — where current IV sits vs last 52 weeks.
        Simplified: use ATM IV vs historical range.
        Returns 0–100.
        """
        try:
            atm_row  = self.df.iloc[(self.df["strike"] - self.spot).abs().argsort()[:1]]
            curr_iv  = float(atm_row["ce_iv"].values[0])
            iv_min   = self.df["ce_iv"].min()
            iv_max   = self.df["ce_iv"].max()
            if iv_max == iv_min:
                return 50
            ivr = int((curr_iv - iv_min) / (iv_max - iv_min) * 100)
            return max(0, min(100, ivr))
        except:
            return 50

    def oi_walls(self) -> dict:
        """
        Find dominant CE wall (resistance) and PE wall (support).
        Returns implied range and width.
        """
        if self.df.empty:
            return {
                "call_wall": 0, "put_wall": 0, "range_width": 0,
                "distance_to_support": 0, "distance_to_resist": 0,
                "implied_range": "N/A",
            }

        # CE wall = highest OI strike ABOVE spot
        ce_above  = self.df[self.df["strike"] > self.spot]
        call_wall = int(ce_above.loc[ce_above["ce_oi"].idxmax(), "strike"]) if not ce_above.empty else 0

        # PE wall = highest OI strike BELOW spot
        pe_below  = self.df[self.df["strike"] < self.spot]
        put_wall  = int(pe_below.loc[pe_below["pe_oi"].idxmax(), "strike"]) if not pe_below.empty else 0

        range_width = call_wall - put_wall
        dist_to_sup = round(self.spot - put_wall, 0)
        dist_to_res = round(call_wall - self.spot, 0)

        return {
            "call_wall":          call_wall,
            "put_wall":           put_wall,
            "range_width":        range_width,
            "distance_to_support": dist_to_sup,
            "distance_to_resist":  dist_to_res,
            "implied_range":      f"{put_wall:,} – {call_wall:,}",
        }

    def interpreted_chain(self) -> list:
        """
        Full options chain with bar widths and plain-English meaning per strike.
        """
        if self.df.empty:
            return []

        walls     = self.oi_walls()
        call_wall = walls["call_wall"]
        put_wall  = walls["put_wall"]
        mp        = self.max_pain()

        max_ce_oi = self.df["ce_oi"].max()
        max_pe_oi = self.df["pe_oi"].max()

        rows = []
        for _, row in self.df.iterrows():
            strike  = row["strike"]
            dist    = abs(strike - self.spot)
            is_atm  = dist == self.df.apply(lambda r: abs(r["strike"] - self.spot), axis=1).min()

            ce_oi   = int(row["ce_oi"])
            pe_oi   = int(row["pe_oi"])
            ce_coi  = int(row.get("ce_coi", 0))
            pe_coi  = int(row.get("pe_coi", 0))
            ce_prev = ce_oi - ce_coi
            pe_prev = pe_oi - pe_coi
            ce_coi_pct = round(ce_coi / ce_prev * 100, 1) if ce_prev and ce_prev > 0 else 0
            pe_coi_pct = round(pe_coi / pe_prev * 100, 1) if pe_prev and pe_prev > 0 else 0

            rows.append({
                "strike":       int(strike),
                "is_atm":       is_atm,
                "is_max_pain":  int(strike) == mp,
                "is_call_wall": int(strike) == call_wall,
                "is_put_wall":  int(strike) == put_wall,
                "ce_oi":        ce_oi,
                "ce_oi_lbl":    _fmt_oi(ce_oi),
                "ce_oi_bar":    round(ce_oi / max_ce_oi * 100) if max_ce_oi else 0,
                "ce_coi_pct":   ce_coi_pct,
                "ce_iv":        round(float(row.get("ce_iv", 0)), 1),
                "ce_ltp":       round(float(row.get("ce_ltp", 0)), 1),
                "pe_oi":        pe_oi,
                "pe_oi_lbl":    _fmt_oi(pe_oi),
                "pe_oi_bar":    round(pe_oi / max_pe_oi * 100) if max_pe_oi else 0,
                "pe_coi_pct":   pe_coi_pct,
                "pe_iv":        round(float(row.get("pe_iv", 0)), 1),
                "pe_ltp":       round(float(row.get("pe_ltp", 0)), 1),
                "meaning":      _interpret_strike(row, self.spot, call_wall, put_wall, mp, is_atm),
            })
        return rows

    def oi_changes(self) -> list:
        """
        Interpret OI change (vs previous day) for top strikes.
        Returns list of signals with plain-English explanation.
        """
        if self.df.empty or "ce_coi" not in self.df.columns:
            return []

        top_strikes = self.df.nlargest(5, "ce_oi")["strike"].tolist()
        results     = []

        for strike in top_strikes:
            row     = self.df[self.df["strike"] == strike].iloc[0]
            ce_coi  = row.get("ce_coi", 0)
            pe_coi  = row.get("pe_coi", 0)
            if abs(ce_coi) < 100_000 and abs(pe_coi) < 100_000:
                continue
            signals = _oi_change_signal(ce_coi, pe_coi, 0, 0)
            for s in signals:
                results.append({
                    "strike":  int(strike),
                    "leg":     s["leg"],
                    "delta":   f"{s['delta']/100000:+.1f}L",
                    "type":    s["type"],
                    "bias":    s["bias"],
                    "explain": s["explain"],
                })
        return results[:6]

    def confidence(self) -> int:
        """Overall confidence score for current setup (0–100)."""
        score = 50
        if self.pcr() > 1.0:  score += 10
        if self.pcr() > 1.2:  score += 5
        if self.ivr() > 50:   score += 10
        if self.ivr() > 65:   score += 5
        walls = self.oi_walls()
        if walls["range_width"] and 100 < walls["range_width"] < 300:
            score += 10
        if walls["distance_to_support"] < walls["range_width"] * 0.3:
            score += 10
        return min(100, score)
