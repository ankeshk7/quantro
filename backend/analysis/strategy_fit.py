"""
NIFTY Expiry Strategy Engine — Quantitative Convergence Model
=============================================================

Every signal votes on market direction (-ve = bearish, +ve = bullish).
The sum determines strategy type. VIX and IVR gate the volatility regime.

Signals used:
  1. PCR          — put-call ratio: >1 = bulls writing puts (bullish)
  2. Max Pain     — distance and direction spot must travel to pin
  3. FII Net      — index futures positioning (smart money direction)
  4. Sentiment    — news risk score + AI direction bias
  5. OI Asymmetry — which wall is closer (resistance vs support distance)
  6. GIFT Nifty   — overnight gap direction and magnitude

Convergence → strategy type → VIX/IVR gate → sizing → strike levels
"""

from typing import Optional


# ── Strategy definitions ───────────────────────────────────────────────────────

NEUTRAL_STRATEGIES = {
    "Iron Fly": {
        "range_min": 0,   "range_max": 280,
        "ivr_min":   35,
        "description": "ATM straddle + OTM wings. Best when spot is near max pain.",
    },
    "Iron Condor": {
        "range_min": 260, "range_max": 500,
        "ivr_min":   30,
        "description": "OTM strangle + wings. Better for wider expected ranges.",
    },
}

DIRECTIONAL_STRATEGIES = {
    "Bear Call Spread": {
        "direction":   "bearish",
        "description": "Sell OTM call, buy higher call. High IV = more credit. Profit when market falls or stays flat.",
    },
    "Bull Put Spread": {
        "direction":   "bullish",
        "description": "Sell OTM put, buy lower put. High IV = more credit. Profit when market rises or stays flat.",
    },
}

SKIP_REASONS = {
    "vix_extreme":   "VIX > 25 — gap risk is too large for any short-option strategy. Stay in cash.",
    "ivr_too_low":   "IVR < 20 — premium is too thin. Risk/reward doesn't justify selling options this week.",
    "gap_extreme":   "Expected gap open > 150 pts — entry prices are invalidated before market even opens.",
    "risk_extreme":  "News risk score ≥ 9 — extreme event risk (crash, geopolitical shock). Capital protection first.",
    "no_conviction": "High risk environment with no clear directional conviction. A coin-toss is not a strategy.",
}


# ── Main recommendation function ───────────────────────────────────────────────

def recommend(
    range_width:       float,
    ivr:               float,
    vix:               float,
    pcr:               float = 1.0,
    risk_score:        int   = 3,
    gap_pts:           float = 0,
    max_pain:          Optional[float] = None,
    spot:              Optional[float] = None,
    direction:         str   = "neutral",
    fii_net:           float = 0,       # FII index futures net in Cr
    call_wall:         Optional[float] = None,
    put_wall:          Optional[float] = None,
    distance_to_resist: Optional[float] = None,
    distance_to_support: Optional[float] = None,
) -> dict:

    direction = (direction or "neutral").lower()

    # ── Hard stops — no trade under any conditions ─────────────────────────────
    if vix > 25:
        return _skip("vix_extreme", vix, ivr, pcr, range_width)
    if ivr < 20:
        return _skip("ivr_too_low", vix, ivr, pcr, range_width)
    if abs(gap_pts) > 150:
        return _skip("gap_extreme", vix, ivr, pcr, range_width)
    if risk_score >= 9:
        return _skip("risk_extreme", vix, ivr, pcr, range_width)

    # ── Score each signal ──────────────────────────────────────────────────────
    signal_votes = _score_signals(
        vix, ivr, pcr, risk_score, direction, fii_net,
        max_pain, spot, gap_pts, distance_to_resist, distance_to_support,
    )

    total_score = sum(v["score"] for v in signal_votes.values())
    signals_ok  = sum(1 for v in signal_votes.values() if v["ok"])

    # ── Determine regime ───────────────────────────────────────────────────────
    high_vix  = vix > 18
    strong_dir = abs(total_score) >= 4

    # ── High VIX: only trade if there's clear directional conviction ───────────
    if high_vix:
        if not strong_dir:
            return _skip("no_conviction", vix, ivr, pcr, range_width)
        strategy_name = "Bear Call Spread" if total_score < 0 else "Bull Put Spread"
        return _build_directional(
            strategy_name, total_score, signal_votes, signals_ok,
            vix, ivr, pcr, risk_score, direction,
            max_pain, spot, call_wall, put_wall, range_width,
        )

    # ── Normal VIX: pick by conviction strength ────────────────────────────────
    if total_score <= -5:
        return _build_directional(
            "Bear Call Spread", total_score, signal_votes, signals_ok,
            vix, ivr, pcr, risk_score, direction,
            max_pain, spot, call_wall, put_wall, range_width,
        )
    if total_score >= 5:
        return _build_directional(
            "Bull Put Spread", total_score, signal_votes, signals_ok,
            vix, ivr, pcr, risk_score, direction,
            max_pain, spot, call_wall, put_wall, range_width,
        )

    # ── Neutral/range-bound: Iron Fly or Condor ────────────────────────────────
    if range_width <= 280 and ivr >= 35:
        strategy_name = "Iron Fly"
    elif range_width <= 500 and ivr >= 30:
        strategy_name = "Iron Condor"
    elif range_width <= 280:
        strategy_name = "Iron Fly"
    else:
        strategy_name = "Iron Condor"

    return _build_neutral(
        strategy_name, total_score, signal_votes, signals_ok,
        vix, ivr, pcr, risk_score, range_width,
        max_pain, spot, call_wall, put_wall,
    )


# ── Signal scoring ─────────────────────────────────────────────────────────────

def _score_signals(vix, ivr, pcr, risk_score, direction, fii_net,
                   max_pain, spot, gap_pts, dist_resist, dist_support) -> dict:
    votes = {}

    # 1. PCR — put-call ratio (weight: 3 pts max)
    if pcr >= 1.5:
        votes["pcr"] = {"score": 3, "ok": True,
            "label": "PCR", "value": round(pcr, 2),
            "note": f"PCR {pcr:.2f} — heavy put writing below. Bulls are very active. Bullish."}
    elif pcr >= 1.2:
        votes["pcr"] = {"score": 2, "ok": True,
            "label": "PCR", "value": round(pcr, 2),
            "note": f"PCR {pcr:.2f} — more puts than calls written. Moderately bullish."}
    elif pcr >= 0.9:
        votes["pcr"] = {"score": 1, "ok": True,
            "label": "PCR", "value": round(pcr, 2),
            "note": f"PCR {pcr:.2f} — near neutral. Slight bullish lean."}
    elif pcr >= 0.7:
        votes["pcr"] = {"score": -1, "ok": True,
            "label": "PCR", "value": round(pcr, 2),
            "note": f"PCR {pcr:.2f} — more calls than puts. Moderately bearish."}
    elif pcr >= 0.5:
        votes["pcr"] = {"score": -2, "ok": False,
            "label": "PCR", "value": round(pcr, 2),
            "note": f"PCR {pcr:.2f} — low PCR, bearish OI positioning."}
    else:
        votes["pcr"] = {"score": -3, "ok": False,
            "label": "PCR", "value": round(pcr, 2),
            "note": f"PCR {pcr:.2f} — extreme bearish positioning. Strong sell pressure."}

    # 2. Max pain vs spot (weight: 2 pts max)
    if max_pain and spot:
        diff = max_pain - spot   # positive = max pain above spot (bullish gravity)
        if diff > 80:
            votes["max_pain"] = {"score": 2, "ok": True,
                "label": "Max Pain", "value": int(max_pain),
                "note": f"Max pain {int(max_pain)} is {int(diff)} pts above spot. Strong magnetic pull upward."}
        elif diff > 30:
            votes["max_pain"] = {"score": 1, "ok": True,
                "label": "Max Pain", "value": int(max_pain),
                "note": f"Max pain {int(max_pain)} is {int(diff)} pts above spot. Slight bullish gravity."}
        elif diff >= -30:
            votes["max_pain"] = {"score": 0, "ok": True,
                "label": "Max Pain", "value": int(max_pain),
                "note": f"Spot is near max pain ({int(max_pain)}). High pin probability — ideal Iron Fly center."}
        elif diff >= -80:
            votes["max_pain"] = {"score": -1, "ok": True,
                "label": "Max Pain", "value": int(max_pain),
                "note": f"Spot {int(-diff)} pts above max pain. Gravity pull downward."}
        else:
            votes["max_pain"] = {"score": -2, "ok": False,
                "label": "Max Pain", "value": int(max_pain),
                "note": f"Spot {int(-diff)} pts above max pain — strong downward pull. Bearish."}

    # 3. FII net futures positioning (weight: 2 pts max)
    if fii_net >= 3000:
        votes["fii"] = {"score": 2, "ok": True,
            "label": "FII Futures", "value": round(fii_net),
            "note": f"FII net long ₹{int(fii_net)}Cr in index futures. Smart money bullish."}
    elif fii_net >= 1000:
        votes["fii"] = {"score": 1, "ok": True,
            "label": "FII Futures", "value": round(fii_net),
            "note": f"FII mild long ₹{int(fii_net)}Cr. Moderately positive."}
    elif fii_net >= -1000:
        votes["fii"] = {"score": 0, "ok": True,
            "label": "FII Futures", "value": round(fii_net),
            "note": f"FII near neutral (₹{int(fii_net)}Cr). No strong positioning signal."}
    elif fii_net >= -3000:
        votes["fii"] = {"score": -1, "ok": False,
            "label": "FII Futures", "value": round(fii_net),
            "note": f"FII net short ₹{int(abs(fii_net))}Cr. Selling pressure."}
    else:
        votes["fii"] = {"score": -2, "ok": False,
            "label": "FII Futures", "value": round(fii_net),
            "note": f"FII aggressively short ₹{int(abs(fii_net))}Cr in futures. Strong institutional sell."}

    # 4. Sentiment / news (weight: 2 pts max)
    if risk_score <= 3:
        dir_score = {"bullish": 1, "neutral": 0, "bearish": -1}.get(direction, 0)
        votes["sentiment"] = {"score": dir_score, "ok": True,
            "label": "News Sentiment", "value": risk_score,
            "note": f"Low risk environment ({risk_score}/10). {direction.capitalize()} bias from news."}
    elif risk_score <= 6:
        dir_score = {"bullish": 1, "neutral": 0, "bearish": -1}.get(direction, 0)
        votes["sentiment"] = {"score": dir_score, "ok": True,
            "label": "News Sentiment", "value": risk_score,
            "note": f"Moderate risk ({risk_score}/10) — {direction} bias. Reduce size."}
    elif risk_score <= 8:
        # High risk: direction matters a lot
        dir_score = {"bullish": 1, "neutral": 0, "bearish": -2}.get(direction, 0)
        votes["sentiment"] = {"score": dir_score, "ok": False,
            "label": "News Sentiment", "value": risk_score,
            "note": f"High risk ({risk_score}/10) with {direction} bias — geopolitical/macro stress. Directional only."}

    # 5. OI wall asymmetry (weight: 1 pt max)
    if dist_resist is not None and dist_support is not None and dist_support > 0:
        ratio = dist_resist / dist_support
        if ratio > 1.5:
            # Resistance is far, support is close → bullish (more room to go up)
            votes["oi_walls"] = {"score": 1, "ok": True,
                "label": "OI Wall Skew", "value": round(ratio, 1),
                "note": f"Support {int(dist_support)} pts away, resistance {int(dist_resist)} pts away. More upside room — bullish skew."}
        elif ratio < 0.67:
            # Support is far, resistance is close → bearish (more room to go down)
            votes["oi_walls"] = {"score": -1, "ok": True,
                "label": "OI Wall Skew", "value": round(ratio, 1),
                "note": f"Resistance {int(dist_resist)} pts away, support {int(dist_support)} pts away. More downside room — bearish skew."}
        else:
            votes["oi_walls"] = {"score": 0, "ok": True,
                "label": "OI Wall Skew", "value": round(ratio, 1),
                "note": f"Symmetric OI walls — range-bound setup. Ideal for neutral strategies."}

    # 6. GIFT Nifty gap (weight: 1 pt max)
    if gap_pts != 0:
        if gap_pts > 60:
            votes["gift_gap"] = {"score": 1, "ok": True,
                "label": "GIFT Nifty", "value": round(gap_pts),
                "note": f"GIFT Nifty +{int(gap_pts)} pts gap-up. Global cues bullish."}
        elif gap_pts > 20:
            votes["gift_gap"] = {"score": 0, "ok": True,
                "label": "GIFT Nifty", "value": round(gap_pts),
                "note": f"GIFT Nifty minor gap-up ({int(gap_pts)} pts). Neutral."}
        elif gap_pts >= -20:
            votes["gift_gap"] = {"score": 0, "ok": True,
                "label": "GIFT Nifty", "value": round(gap_pts),
                "note": f"GIFT Nifty flat ({int(gap_pts)} pts). No directional cue."}
        elif gap_pts >= -60:
            votes["gift_gap"] = {"score": 0, "ok": True,
                "label": "GIFT Nifty", "value": round(gap_pts),
                "note": f"GIFT Nifty minor gap-down ({int(gap_pts)} pts). Slight caution."}
        else:
            votes["gift_gap"] = {"score": -1, "ok": False,
                "label": "GIFT Nifty", "value": round(gap_pts),
                "note": f"GIFT Nifty {int(gap_pts)} pts gap-down. Global cues bearish."}

    return votes


# ── Strategy builders ──────────────────────────────────────────────────────────

def _build_directional(name, total_score, signal_votes, signals_ok,
                        vix, ivr, pcr, risk_score, direction,
                        max_pain, spot, call_wall, put_wall, range_width) -> dict:

    cfg = DIRECTIONAL_STRATEGIES[name]

    # Strike suggestion
    strikes = _directional_strikes(name, spot, call_wall, put_wall, range_width)

    # Confidence: more signals agreeing = higher confidence
    total_signals = len(signal_votes)
    aligned = sum(
        1 for v in signal_votes.values()
        if (name == "Bear Call Spread" and v["score"] < 0) or
           (name == "Bull Put Spread"  and v["score"] > 0)
    )
    confidence = 40 + (aligned / max(total_signals, 1)) * 35
    if ivr >= 50:   confidence += 8
    if vix < 22:    confidence += 5
    confidence = min(82, int(confidence))

    # Sizing
    lots, size_reason = _sizing(abs(total_score), ivr, vix, risk_score)

    # Why text
    top_reasons = sorted(signal_votes.values(), key=lambda x: abs(x["score"]), reverse=True)[:3]
    why = (
        f"{name} recommended — {aligned}/{total_signals} signals aligned. "
        f"{'; '.join(r['note'] for r in top_reasons)}. "
        f"High IV (IVR {ivr}) inflates the credit collected — sell premium, let time decay work."
    )

    return {
        "recommendation": name,
        "confidence":     confidence,
        "directional":    True,
        "direction":      cfg["direction"],
        "why":            why,
        "lots":           lots,
        "size_reason":    size_reason,
        "conviction_score": total_score,
        "strikes":        strikes,
        "signals_detail": list(signal_votes.values()),
        "alternatives":   [
            {"name": "Skip", "reason": "Acceptable if you prefer to avoid high-risk weeks entirely.", "fit": 30}
        ],
        "triggers": [
            {"condition": "VIX spikes above 25", "action": "Exit immediately — gap risk too large", "severity": "exit"},
            {"condition": f"Spot breaks {'above' if name == 'Bear Call Spread' else 'below'} your short strike",
             "action": "Thesis invalidated — cut at 1× premium loss", "severity": "exit"},
            {"condition": "Sentiment reverses sharply (direction flips)",
             "action": "Close spread — don't hold directional bets without conviction", "severity": "exit"},
        ],
        "signals": {
            "pcr":         {"value": signal_votes.get("pcr", {}).get("value"), "ok": signal_votes.get("pcr", {}).get("ok", True)},
            "ivr":         {"value": ivr,        "ok": ivr >= 35},
            "vix":         {"value": vix,        "ok": vix <= 20},
            "risk_score":  {"value": risk_score, "ok": risk_score <= 6},
        },
    }


def _build_neutral(name, total_score, signal_votes, signals_ok,
                   vix, ivr, pcr, risk_score, range_width,
                   max_pain, spot, call_wall, put_wall) -> dict:

    strikes = _neutral_strikes(name, max_pain, spot, call_wall, put_wall, range_width)

    # Confidence
    confidence = 45
    if name == "Iron Fly":
        if max_pain and spot and abs(max_pain - spot) < 50: confidence += 15   # strong pin
        elif max_pain and spot and abs(max_pain - spot) < 100: confidence += 8
    if ivr >= 60: confidence += 12
    elif ivr >= 45: confidence += 7
    if vix <= 15: confidence += 8
    elif vix <= 18: confidence += 4
    if risk_score <= 3: confidence += 8
    elif risk_score <= 5: confidence += 4
    if pcr >= 0.9 and pcr <= 1.3: confidence += 5   # neutral PCR = range-bound
    confidence = min(92, confidence)

    # Sizing
    lots, size_reason = _sizing(signals_ok, ivr, vix, risk_score)

    # Why
    neutral_signals = [v for v in signal_votes.values() if abs(v["score"]) <= 1]
    if name == "Iron Fly":
        why = (
            f"Neutral conviction (score {total_score:+d}) — {signals_ok}/{len(signal_votes)} signals positive. "
            f"Range of {range_width:.0f} pts fits Iron Fly (100–280 pts sweet spot). "
            f"{'Spot near max pain — high pin probability. ' if max_pain and spot and abs(max_pain-spot) < 60 else ''}"
            f"IVR {ivr} provides enough premium to justify entry. "
            f"Sell ATM straddle at {int(max_pain) if max_pain else 'ATM'}, hedge with OTM wings."
        )
    else:
        why = (
            f"Range of {range_width:.0f} pts is wider than Iron Fly's sweet spot. "
            f"Iron Condor with OTM strikes gives more room — "
            f"sell calls above {int(call_wall) if call_wall else 'resistance'}, sell puts below {int(put_wall) if put_wall else 'support'}. "
            f"IVR {ivr} still justifies premium selling."
        )

    return {
        "recommendation":   name,
        "confidence":       confidence,
        "directional":      False,
        "why":              why,
        "lots":             lots,
        "size_reason":      size_reason,
        "conviction_score": total_score,
        "strikes":          strikes,
        "signals_detail":   list(signal_votes.values()),
        "alternatives":     [
            {"name": "Bear Call Spread", "reason": "If you expect downside — sell calls above OI wall.", "fit": 40},
            {"name": "Skip",             "reason": "If risk score is 5+ and you want to preserve capital.", "fit": 15},
        ],
        "triggers": [
            {"condition": "VIX spikes above 20 intraday", "action": "Exit — IV expansion kills short premium", "severity": "exit"},
            {"condition": "Spot breaks OI wall (call or put)", "action": "Range thesis broken — exit or skip entry", "severity": "exit"},
            {"condition": "IVR drops below 25", "action": "Premium too thin — close early or skip", "severity": "shift"},
            {"condition": "Risk score crosses 7 on intraday news", "action": "Switch to directional spread or exit", "severity": "shift"},
        ],
        "signals": {
            "pcr":        {"value": signal_votes.get("pcr", {}).get("value"), "ok": signal_votes.get("pcr", {}).get("ok", True)},
            "ivr":        {"value": ivr,        "ok": ivr >= 35},
            "vix":        {"value": vix,        "ok": vix <= 18},
            "risk_score": {"value": risk_score, "ok": risk_score <= 5},
        },
    }


# ── Strike level suggestions ───────────────────────────────────────────────────

def _neutral_strikes(name, max_pain, spot, call_wall, put_wall, range_width) -> dict:
    center = max_pain or spot or 0
    if not center:
        return {}

    if name == "Iron Fly":
        step   = 50
        short  = _round_strike(center, step)
        wing_w = max(100, _round_strike(range_width * 0.4, step))
        return {
            "short_ce":  short,
            "short_pe":  short,
            "long_ce":   short + wing_w,
            "long_pe":   short - wing_w,
            "note":      f"Short both at {int(short)} (max pain). Wings at ±{int(wing_w)} pts.",
        }
    else:  # Iron Condor
        step = 50
        if call_wall and put_wall:
            short_ce = _round_strike(call_wall - 50, step)
            short_pe = _round_strike(put_wall + 50, step)
        else:
            short_ce = _round_strike((spot or center) + range_width * 0.3, step)
            short_pe = _round_strike((spot or center) - range_width * 0.3, step)
        return {
            "short_ce": short_ce,
            "short_pe": short_pe,
            "long_ce":  short_ce + 100,
            "long_pe":  short_pe - 100,
            "note":     f"Sell CE at {int(short_ce)} (below call wall), sell PE at {int(short_pe)} (above put wall).",
        }


def _directional_strikes(name, spot, call_wall, put_wall, range_width) -> dict:
    step = 50
    center = spot or 0
    if not center:
        return {}

    if name == "Bear Call Spread":
        # Sell just below call wall or 1.5-2% OTM from spot
        short = int(call_wall - 50) if call_wall else _round_strike(center * 1.015, step)
        short = _round_strike(short, step)
        long  = short + 100
        return {
            "short_ce": short,
            "long_ce":  long,
            "note":     f"Sell CE {int(short)} (just below call wall). Buy CE {int(long)} (hedge). Max profit if NIFTY stays below {int(short)}.",
        }
    else:  # Bull Put Spread
        short = int(put_wall + 50) if put_wall else _round_strike(center * 0.985, step)
        short = _round_strike(short, step)
        long  = short - 100
        return {
            "short_pe": short,
            "long_pe":  long,
            "note":     f"Sell PE {int(short)} (just above put wall). Buy PE {int(long)} (hedge). Max profit if NIFTY stays above {int(short)}.",
        }


def _round_strike(value, step=50) -> int:
    return int(round(value / step) * step)


# ── Sizing recommendation ──────────────────────────────────────────────────────

def _sizing(conviction: float, ivr: float, vix: float, risk_score: int) -> tuple:
    """Returns (lots, reason_string)."""
    if vix > 20 or risk_score >= 7:
        return 1, "Reduced to 1 lot — elevated risk environment. Capital protection first."
    if conviction >= 7 and ivr >= 50:
        return 2, "2 lots — high conviction (5+ signals aligned) + elevated premium (IVR ≥ 50)."
    if conviction >= 5 and ivr >= 40:
        return 2, "1–2 lots — good conviction with decent premium. Scale second lot after 10:15 AM if trade is working."
    if conviction >= 3:
        return 1, "1 lot — moderate conviction. Wait for 9:45–10:15 AM entry window."
    return 1, "1 lot — low conviction. Enter smaller; add if setup confirms post-open."


# ── Skip builder ───────────────────────────────────────────────────────────────

def _skip(reason_key, vix, ivr, pcr, range_width) -> dict:
    return {
        "recommendation": "Skip",
        "confidence":     0,
        "directional":    False,
        "why":            SKIP_REASONS.get(reason_key, "Conditions not favourable this week."),
        "skip_reason":    reason_key,
        "lots":           0,
        "size_reason":    "No trade.",
        "conviction_score": 0,
        "strikes":        {},
        "signals_detail": [],
        "alternatives":   [],
        "triggers":       [],
        "signals": {
            "vix":        {"value": vix,        "ok": vix <= 20},
            "ivr":        {"value": ivr,        "ok": ivr >= 20},
            "pcr":        {"value": round(pcr, 2), "ok": pcr >= 0.8},
            "risk_score": {"value": None,       "ok": False},
        },
    }


# ── Legacy class wrapper (keeps existing call sites working) ───────────────────

class StrategyFit:
    @staticmethod
    def recommend(range_width, ivr, vix, risk_score=3, gap_pts=0,
                  max_pain=None, spot=None, direction="neutral",
                  pcr=1.0, fii_net=0, call_wall=None, put_wall=None,
                  distance_to_resist=None, distance_to_support=None) -> dict:
        return recommend(
            range_width=range_width, ivr=ivr, vix=vix,
            pcr=pcr, risk_score=risk_score, gap_pts=gap_pts,
            max_pain=max_pain, spot=spot, direction=direction,
            fii_net=fii_net, call_wall=call_wall, put_wall=put_wall,
            distance_to_resist=distance_to_resist,
            distance_to_support=distance_to_support,
        )
