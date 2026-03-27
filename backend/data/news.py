"""
News fetcher — RSS feeds from Indian and global financial sources.
No API key needed. feedparser handles everything.
All 5 feeds fetched in parallel; results cached for 10 minutes.
"""

import feedparser
import html as html_lib
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional


RSS_FEEDS = {
    "ET Markets":    "https://economictimes.indiatimes.com/markets/rss.cms",
    "MoneyControl":  "https://www.moneycontrol.com/rss/MCtopnews.xml",
    "LiveMint":      "https://www.livemint.com/rss/markets",
    "Reuters India": "https://feeds.reuters.com/reuters/INbusinessNews",
    "NDTV Profit":   "https://feeds.feedburner.com/NdtvProfitLatestNews",
}

MAX_PER_FEED = 8
MAX_TOTAL    = 30
_CACHE_TTL   = 600  # 10 minutes

_NEWS_CACHE: dict = {"data": None, "ts": 0.0}


def _fetch_feed(source: str, url: str) -> list:
    """Fetch a single RSS feed; returns list of headline dicts."""
    try:
        feed = feedparser.parse(url)
        return [
            {
                "title":     html_lib.unescape(entry.get("title", "")),
                "summary":   html_lib.unescape(entry.get("summary", "")[:200]),
                "source":    source,
                "url":       entry.get("link", ""),
                "published": entry.get("published", ""),
            }
            for entry in feed.entries[:MAX_PER_FEED]
        ]
    except Exception as e:
        print(f"[News] {source} error: {e}")
        return []


class NewsFetcher:

    def fetch_all(self) -> list:
        """Fetch top headlines from all sources in parallel (cached 10 min)."""
        now = time.monotonic()
        if _NEWS_CACHE["data"] and now - _NEWS_CACHE["ts"] < _CACHE_TTL:
            return _NEWS_CACHE["data"]

        headlines = []
        with ThreadPoolExecutor(max_workers=len(RSS_FEEDS)) as pool:
            futures = {
                pool.submit(_fetch_feed, source, url): source
                for source, url in RSS_FEEDS.items()
            }
            for future in as_completed(futures):
                headlines.extend(future.result())

        result = headlines[:MAX_TOTAL]
        _NEWS_CACHE["data"] = result
        _NEWS_CACHE["ts"] = now
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
