"""
News fetcher — RSS feeds from global and Indian financial sources.
No API key needed. feedparser handles everything.
Feeds fetched in parallel; results cached for 10 minutes.

Filtering pipeline per article:
  1. Skip buy/sell recommendations and tips
  2. Skip off-topic content (sports, lifestyle, entertainment, tech products)
  3. Score market impact (0–10) using tiered keyword weights
  4. Only pass articles that hit MIN_IMPACT_SCORE threshold
  5. Sort survivors by impact score descending, then by sentiment signal

Global sources (confirmed working): BBC Business, CNBC Markets,
  MarketWatch, Guardian Business, FT Markets, Yahoo Finance.
India sources (confirmed working): MoneyControl, LiveMint, NDTV Profit.
"""

import feedparser
import html as html_lib
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed


GLOBAL_FEEDS = {
    "BBC Business":       "https://feeds.bbci.co.uk/news/business/rss.xml",
    "CNBC Markets":       "https://www.cnbc.com/id/20910258/device/rss/rss.html",
    "MarketWatch":        "https://feeds.marketwatch.com/marketwatch/topstories/",
    "Guardian Business":  "https://www.theguardian.com/business/rss",
    "FT Markets":         "https://www.ft.com/rss/home/uk",
    "Yahoo Finance":      "https://finance.yahoo.com/news/rssindex",
}

INDIA_FEEDS = {
    "MoneyControl":  "https://www.moneycontrol.com/rss/MCtopnews.xml",
    "LiveMint":      "https://www.livemint.com/rss/markets",
    "NDTV Profit":   "https://feeds.feedburner.com/NdtvProfitLatestNews",
}

MAX_PER_FEED    = 12   # fetch more per feed so the filter has more to work with
MAX_GLOBAL      = 10
MAX_INDIA       = 8
MIN_IMPACT      = 2    # articles below this score are dropped
_CACHE_TTL      = 600  # 10 minutes

_GLOBAL_NEWS_CACHE: dict = {"data": None, "ts": 0.0}
_INDIA_NEWS_CACHE:  dict = {"data": None, "ts": 0.0}
_ALL_NEWS_CACHE:    dict = {"data": None, "ts": 0.0}


# ── Impact scoring ────────────────────────────────────────────────────────────
# Tier 1 (3 pts) — central bank decisions, major macro shocks, systemic events
_T1 = [
    "federal reserve", "fed reserve", "fomc", "rate cut", "rate hike",
    "interest rate decision", "rbi", "repo rate", "monetary policy",
    "ecb", "bank of england", "boj", "central bank",
    "us cpi", "us inflation", "us gdp", "nonfarm payroll", "jobs report",
    "trade war", "tariff", "tariffs", "sanctions", "debt ceiling",
    "financial crisis", "banking crisis", "sovereign default",
    "recession confirmed", "emergency meeting",
    "union budget", "india budget", "fiscal policy",
]

# Tier 2 (2 pts) — key economic data, major market moves, geopolitical
_T2 = [
    "inflation", "gdp", "unemployment", "cpi", "pce", "retail sales",
    "trade deficit", "current account", "fiscal deficit", "deficit",
    "oil price", "crude oil", "opec", "energy crisis",
    "dollar index", "rupee", "usdinr", "currency",
    "stock market", "wall street", "nifty", "sensex", "s&p 500", "nasdaq", "dow",
    "treasury yield", "bond yield", "10-year",
    "geopolitical", "war", "conflict", "ceasefire", "nato",
    "fii", "foreign investment", "capital outflow", "capital inflow",
    "sebi", "rbi policy", "mpc", "rbi governor",
    "earnings beat", "earnings miss", "quarterly results", "q1", "q2", "q3", "q4",
    "imd", "monsoon", "rainfall deficit",
]

# Tier 1.5 bonus for high-impact company names that move indices
_INDEX_MOVERS = [
    "reliance", "hdfc bank", "infosys", "tcs", "icici bank",
    "sbi", "wipro", "bajaj finance", "kotak", "l&t",
    "apple", "nvidia", "meta", "alphabet", "amazon", "microsoft", "tesla",
    "jpmorgan", "goldman sachs", "blackrock",
]

# Tier 1 (1 pt) — general market-related terms
_T3 = [
    "market", "equity", "stocks", "shares", "index", "indices",
    "economy", "economic", "growth", "slowdown", "contraction", "expansion",
    "profit", "revenue", "earnings", "results",
    "gold", "silver", "commodity", "metal",
    "fdi", "ipo", "listing", "merger", "acquisition",
    "bank", "banking", "finance", "financial", "credit",
    "government", "parliament", "policy", "regulation", "reform",
    "export", "import", "manufacturing", "pmi",
]

# Off-topic patterns — hard disqualify regardless of score
_OFFTOPIC = [
    r"\bcricket\b", r"\bfootball\b", r"\bsoccer\b", r"\btennis\b",
    r"\bipl\b", r"\bworld cup\b", r"\bolympics?\b",
    r"\bmovie\b", r"\bfilm\b", r"\bcinema\b", r"\bbollywood\b",
    r"\bcelebrity\b", r"\bactress?\b", r"\bactor\b",
    r"\bfashion\b", r"\bbeauty\b", r"\bwedding\b",
    r"\brecipe\b", r"\bfood\b", r"\brestaurant\b",
    r"\btravel\b", r"\btourism\b", r"\bhotel\b",
    r"\bhoroscope\b", r"\bastrology\b",
    r"\bweather\b", r"\btemperature\b", r"\bcyclone\b",
    r"\bcovid\b", r"\bvaccine\b", r"\bpandemic\b", r"\bhealth tip\b",
    r"\biphone\b", r"\bandroid\b", r"\bgaming\b", r"\bvideo game\b",
    r"\breal estate\b", r"\bproperty\b", r"\bhome loan\b",
]
_OFFTOPIC_RE = re.compile("|".join(_OFFTOPIC), re.IGNORECASE)

# Recommendation / tip phrases — hard disqualify
_REC_PHRASES = [
    "target price", "price target", "stock to buy", "stock to sell",
    "top pick", "top picks", "stocks to watch", "multibagger",
    "should you buy", "should you sell", "should buy", "should sell",
    "add to portfolio", "accumulate", "reduce holding", "entry point",
    "stop loss", "stop-loss", "trading call", "trading idea", "intraday call",
    "recommendation", "recommends", "recommended", "analyst target",
    "initiates coverage", "initiates with", "reiterates", "upgrades to buy",
    "downgrades to sell", "overweight", "underweight",
    "strong buy", "strong sell", "market perform",
    "invest in", "best stocks", "portfolio pick",
]


def _is_recommendation(text: str) -> bool:
    return any(p in text for p in _REC_PHRASES)

def _is_offtopic(text: str) -> bool:
    return bool(_OFFTOPIC_RE.search(text))

def _impact_score(title: str, summary: str = "") -> int:
    text = (title + " " + summary).lower()
    score = 0
    for kw in _T1:
        if kw in text:
            score += 3
    for kw in _INDEX_MOVERS:
        if kw in text:
            score += 2
    for kw in _T2:
        if kw in text:
            score += 2
    for kw in _T3:
        if kw in text:
            score += 1
    return score


# ── Sentiment scoring ─────────────────────────────────────────────────────────
_NEG_WORDS = {
    "fall", "falls", "fell", "drop", "drops", "dropped", "decline", "declines", "declined",
    "crash", "crashes", "crashed", "sell-off", "selloff", "plunge", "plunges", "plunged",
    "tumble", "tumbles", "slump", "slumps", "slumped", "weak", "weakness", "loss", "losses",
    "negative", "concern", "concerns", "worry", "worries", "worried", "cut", "cuts",
    "deficit", "downgrade", "downgrades", "downgraded",
    "warning", "caution", "fear", "fears", "pressure", "pressured",
    "volatility", "miss", "missed", "slowdown", "contraction", "default",
    "below", "disappoints", "disappointing", "downside", "bearish", "retreat",
}
_POS_WORDS = {
    "rally", "rallies", "rallied",
    "gain", "gains", "gained", "record", "strong", "strength", "growth", "profit",
    "profits", "positive", "beat", "beats", "upgrade", "upgrades", "upgraded",
    "recovery", "recovers", "bullish", "boost", "boosts",
    "buyback", "dividend", "lifted", "inflows", "upside",
    "optimism", "optimistic", "expansion", "robust", "healthy",
}

# Price-movement words that are only good news when the subject is equities/economy.
# When oil, gold, yields, VIX or safe-havens are rising it is usually BAD for markets.
_AMBIGUOUS_POS = {
    "rise", "rises", "rose", "surge", "surges", "surged",
    "jump", "jumps", "jumped", "high", "above",
}
_COMMODITY_SUBJECTS = {
    "oil", "crude", "brent", "wti", "gold", "silver", "copper",
    "yield", "yields", "bond", "bonds", "dollar", "vix", "haven",
    "inflation", "cpi", "prices",
}

# Words that strongly signal bad news regardless of positive words present — counted 2×
_STRONG_NEG = {
    "war", "conflict", "attack", "strike", "strikes", "missile", "sanctions",
    "crisis", "collapse", "panic", "darkening", "recession", "default",
    "threat", "threats", "uncertainty", "geopolitical", "tension", "tensions",
    "turmoil", "unrest", "instability", "escalation", "escalates",
}


def _score_sentiment(title: str, summary: str = "") -> str:
    text  = (title + " " + summary).lower()
    words = set(text.split())

    # Ambiguous pos words (rise/surge/jump) only count when the subject is
    # clearly equities/economy — not when oil/gold/yields are the subject.
    is_commodity_context = bool(words & _COMMODITY_SUBJECTS)
    active_pos = _POS_WORDS if is_commodity_context else (_POS_WORDS | _AMBIGUOUS_POS)

    pos  = len(words & active_pos)
    neg  = len(words & _NEG_WORDS)
    neg += 2 * len(words & _STRONG_NEG)   # war/crisis/conflict count double

    if pos > neg:   return "positive"
    if neg > pos:   return "negative"
    return "neutral"


# ── Feed fetching ─────────────────────────────────────────────────────────────

def _fetch_feed(source: str, url: str) -> list:
    """Fetch one RSS feed, apply all filters, return scored headline dicts."""
    try:
        feed = feedparser.parse(url)
        results = []
        for entry in feed.entries[:MAX_PER_FEED]:
            title   = html_lib.unescape(entry.get("title", "")).strip()
            summary = html_lib.unescape(entry.get("summary", "")[:300]).strip()
            text    = (title + " " + summary).lower()

            if not title:
                continue
            if _is_recommendation(text):
                continue
            if _is_offtopic(text):
                continue

            score = _impact_score(title, summary)
            if score < MIN_IMPACT:
                continue

            results.append({
                "title":     title,
                "summary":   summary,
                "source":    source,
                "url":       entry.get("link", ""),
                "published": entry.get("published", ""),
                "sentiment": _score_sentiment(title, summary),
                "impact":    score,   # kept for sorting; not sent to frontend
            })
        return results
    except Exception as e:
        print(f"[News] {source} error: {e}")
        return []


def _fetch_feeds_parallel(feed_dict: dict) -> list:
    headlines = []
    with ThreadPoolExecutor(max_workers=len(feed_dict)) as pool:
        futures = {
            pool.submit(_fetch_feed, source, url): source
            for source, url in feed_dict.items()
        }
        for future in as_completed(futures):
            headlines.extend(future.result())
    return headlines


def _top_n(headlines: list, n: int) -> list:
    """Sort by impact score desc, then put non-neutral sentiment first."""
    headlines.sort(key=lambda h: (h.get("impact", 0), h.get("sentiment") != "neutral"), reverse=True)
    # Strip internal impact field before returning
    return [{k: v for k, v in h.items() if k != "impact"} for h in headlines[:n]]


class NewsFetcher:

    def fetch_global(self) -> list:
        """Top global market headlines from trusted sources (cached 10 min)."""
        now = time.monotonic()
        if _GLOBAL_NEWS_CACHE["data"] and now - _GLOBAL_NEWS_CACHE["ts"] < _CACHE_TTL:
            return _GLOBAL_NEWS_CACHE["data"]

        result = _top_n(_fetch_feeds_parallel(GLOBAL_FEEDS), MAX_GLOBAL)
        _GLOBAL_NEWS_CACHE["data"] = result
        _GLOBAL_NEWS_CACHE["ts"]   = now
        return result

    def fetch_india(self) -> list:
        """Top Indian market headlines (cached 10 min)."""
        now = time.monotonic()
        if _INDIA_NEWS_CACHE["data"] and now - _INDIA_NEWS_CACHE["ts"] < _CACHE_TTL:
            return _INDIA_NEWS_CACHE["data"]

        result = _top_n(_fetch_feeds_parallel(INDIA_FEEDS), MAX_INDIA)
        _INDIA_NEWS_CACHE["data"] = result
        _INDIA_NEWS_CACHE["ts"]   = now
        return result

    def fetch_all(self) -> list:
        """All headlines combined (used by ticker tab for keyword filtering)."""
        now = time.monotonic()
        if _ALL_NEWS_CACHE["data"] and now - _ALL_NEWS_CACHE["ts"] < _CACHE_TTL:
            return _ALL_NEWS_CACHE["data"]

        result = _top_n(_fetch_feeds_parallel({**GLOBAL_FEEDS, **INDIA_FEEDS}), 30)
        _ALL_NEWS_CACHE["data"] = result
        _ALL_NEWS_CACHE["ts"]   = now
        return result

    def fetch_ticker(self, symbol: str) -> list:
        """Filter all-source headlines by symbol name."""
        all_news  = self.fetch_all()
        sym_lower = symbol.lower()
        name_map  = {
            "RELIANCE":  ["reliance", "ril"],
            "HDFCBANK":  ["hdfc bank", "hdfcbank"],
            "INFY":      ["infosys", "infy"],
            "TCS":       ["tcs", "tata consultancy"],
            "BANKNIFTY": ["bank nifty", "banknifty", "banking"],
            "NIFTY":     ["nifty", "sensex", "market"],
        }
        keywords = name_map.get(symbol, [sym_lower])
        filtered = [
            n for n in all_news
            if any(k in n["title"].lower() or k in n["summary"].lower() for k in keywords)
        ]
        return filtered[:8] if filtered else all_news[:5]

    def format_for_scoring(self, headlines: list) -> str:
        """Format headlines as text for Claude API scoring."""
        lines = []
        for i, h in enumerate(headlines[:15], 1):
            lines.append(f"{i}. [{h['source']}] {h['title']}")
            if h.get("summary"):
                lines.append(f"   {h['summary'][:120]}")
        return "\n".join(lines)
