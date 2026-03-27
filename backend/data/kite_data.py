"""
Zerodha Kite Connect integration — multi-user, cookie-based sessions.

How it works:
  - App owner creates ONE Kite Connect app at developers.kite.trade (₹2,000/month).
  - Users visit the site, click "Connect Kite", log in with their own Zerodha account.
  - OAuth redirects back here; we exchange the request_token for an access_token.
  - Each user's session is stored under their Zerodha user_id.
  - A browser cookie (kite_uid) tells us which user is making each request.
  - The WebSocket market ticker is shared — all users see the same live prices.

Setup (app owner only):
  1. Create app at https://developers.kite.trade
  2. Set redirect URL: http://<your-domain>/api/kite/connect
  3. Add to backend/.env:
       KITE_API_KEY=your_api_key
       KITE_API_SECRET=your_api_secret
"""

import os, json, time
from typing import Optional

_SESSIONS_FILE = os.path.join(os.path.dirname(__file__), "../../data/kite_sessions.json")

# In-memory store: { user_id: { access_token, user_name, date } }
_sessions: dict = {}
_kite_instances: dict = {}   # user_id → KiteConnect


def _load_sessions():
    global _sessions
    try:
        if os.path.exists(_SESSIONS_FILE):
            with open(_SESSIONS_FILE) as f:
                _sessions = json.load(f)
    except Exception:
        _sessions = {}


def _save_sessions():
    os.makedirs(os.path.dirname(_SESSIONS_FILE), exist_ok=True)
    with open(_SESSIONS_FILE, "w") as f:
        json.dump(_sessions, f, indent=2)


# Load on module import
_load_sessions()


def _api_key() -> Optional[str]:
    return os.getenv("KITE_API_KEY")


def _api_secret() -> Optional[str]:
    return os.getenv("KITE_API_SECRET")


def is_configured() -> bool:
    return bool(_api_key() and _api_secret())


def _session_valid(session: dict) -> bool:
    """Kite tokens expire daily at 6 AM IST — validate by date."""
    token = session.get("access_token")
    today = time.strftime("%Y-%m-%d")
    return bool(token and session.get("date") == today)


def is_connected(user_id: str) -> bool:
    if not is_configured() or not user_id:
        return False
    return _session_valid(_sessions.get(user_id, {}))


def get_any_valid_token() -> Optional[tuple[str, str]]:
    """Return (api_key, access_token) for any still-valid user. Used to start the ticker."""
    key = _api_key()
    if not key:
        return None
    for uid, sess in _sessions.items():
        if _session_valid(sess):
            return key, sess["access_token"]
    return None


def get_kite(user_id: str):
    """Return authenticated KiteConnect instance for this user, or None."""
    if not is_connected(user_id):
        return None
    try:
        from kiteconnect import KiteConnect
        sess = _sessions[user_id]
        if user_id not in _kite_instances:
            _kite_instances[user_id] = KiteConnect(api_key=_api_key())
        inst = _kite_instances[user_id]
        inst.set_access_token(sess["access_token"])
        return inst
    except Exception as e:
        print(f"[Kite] get_kite({user_id}): {e}")
        return None


def get_auth_url() -> str:
    if not is_configured():
        return ""
    try:
        from kiteconnect import KiteConnect
        return KiteConnect(api_key=_api_key()).login_url()
    except Exception as e:
        print(f"[Kite] auth_url: {e}")
        return ""


def connect(request_token: str) -> dict:
    """
    Exchange request_token → access_token.
    Returns the user's data including user_id (used as the cookie value).
    """
    try:
        from kiteconnect import KiteConnect
        kite = KiteConnect(api_key=_api_key())
        data = kite.generate_session(request_token, api_secret=_api_secret())
        user_id      = data["user_id"]
        access_token = data["access_token"]
        kite.set_access_token(access_token)
        _kite_instances[user_id] = kite
        _sessions[user_id] = {
            "access_token": access_token,
            "user_name":    data.get("user_name", ""),
            "user_id":      user_id,
            "date":         time.strftime("%Y-%m-%d"),
        }
        _save_sessions()
        return {
            "ok":       True,
            "user_id":  user_id,
            "user":     data.get("user_name", ""),
        }
    except Exception as e:
        print(f"[Kite] connect: {e}")
        return {"ok": False, "error": str(e)}


def get_status(user_id: str) -> dict:
    sess = _sessions.get(user_id, {})
    connected = _session_valid(sess)
    return {
        "configured": is_configured(),
        "connected":  connected,
        "user":       sess.get("user_name", "") if connected else "",
        "user_id":    user_id if connected else "",
    }


def get_positions(user_id: str) -> dict:
    kite = get_kite(user_id)
    if not kite:
        return {"connected": False, "net": [], "day": [], "summary": {}}
    try:
        raw = kite.positions()
        net = raw.get("net", [])
        day = raw.get("day", [])
        total_pnl = sum(p.get("pnl", 0) or 0 for p in net)
        total_m2m = sum(p.get("m2m", 0) or 0 for p in net)
        open_pos  = [p for p in net if (p.get("quantity") or 0) != 0]
        return {
            "connected": True,
            "net":       _fmt_positions(net),
            "day":       _fmt_positions(day),
            "summary": {
                "total_pnl":   round(total_pnl, 2),
                "total_m2m":   round(total_m2m, 2),
                "open_count":  len(open_pos),
                "total_count": len(net),
            },
        }
    except Exception as e:
        print(f"[Kite] positions({user_id}): {e}")
        # Token likely expired
        _sessions.pop(user_id, None)
        _kite_instances.pop(user_id, None)
        _save_sessions()
        return {"connected": False, "error": str(e), "net": [], "day": [], "summary": {}}


def _fmt_positions(positions: list) -> list:
    out = []
    for p in positions:
        qty  = p.get("quantity") or 0
        avg  = p.get("average_price") or 0
        ltp  = p.get("last_price") or 0
        pnl  = p.get("pnl") or 0
        m2m  = p.get("m2m") or 0
        out.append({
            "symbol":        p.get("tradingsymbol", ""),
            "exchange":      p.get("exchange", ""),
            "product":       p.get("product", ""),
            "quantity":      qty,
            "side":          "SELL" if qty < 0 else "BUY" if qty > 0 else "FLAT",
            "average_price": round(float(avg), 2),
            "ltp":           round(float(ltp), 2),
            "pnl":           round(float(pnl), 2),
            "m2m":           round(float(m2m), 2),
            "unrealised":    round(float(p.get("unrealised") or pnl), 2),
            "realised":      round(float(p.get("realised") or 0), 2),
        })
    return out


def disconnect(user_id: str):
    _sessions.pop(user_id, None)
    _kite_instances.pop(user_id, None)
    _save_sessions()
