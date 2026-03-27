"""
News sentiment scorer using Claude API.
Reads headlines → returns structured risk score + recommendation.
"""

import os, json, time, hashlib
import anthropic
from data.news import NewsFetcher

_SENTIMENT_CACHE: dict = {}
_SENTIMENT_TTL = 600  # 10 minutes


SYSTEM_PROMPT = """You are a NIFTY options expiry day risk analyst for an Indian retail trader.

Given a list of financial news headlines from Monday night, assess the risk for 
Tuesday's NIFTY weekly expiry session.

Return ONLY a valid JSON object with this exact structure:
{
  "risk_score": <integer 0-10>,
  "direction_bias": "<bullish|bearish|neutral>",
  "key_risks": ["<risk1>", "<risk2>"],
  "key_positives": ["<pos1>", "<pos2>"],
  "recommendation": "<ENTER|REDUCE SIZE|SKIP>",
  "reasoning": "<2 sentence plain English explanation>",
  "news_items": [
    {"headline": "<short headline>", "source": "<source>", "sentiment": "<positive|negative|neutral>"}
  ]
}

Scoring guide:
0-3: Benign backdrop, safe to enter Iron Fly with full size
4-6: Moderate risk, consider entering with reduced size (50%)  
7-8: High risk, skip this week
9-10: Extreme risk (major event, crash risk), skip without question

Be conservative. It's better to skip a marginal setup than to lose capital.
Return ONLY the JSON object, no preamble, no markdown."""


class SentimentScorer:

    def __init__(self):
        api_key   = os.getenv("ANTHROPIC_API_KEY")
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else None
        self.fetcher = NewsFetcher()

    async def score(self, headlines: list) -> dict:
        """
        Score news headlines for market risk.
        Returns structured sentiment analysis. Results cached for 10 minutes.
        """
        if not headlines:
            return self._neutral_score()

        formatted = self.fetcher.format_for_scoring(headlines)

        cache_key = hashlib.md5(formatted.encode()).hexdigest()
        now = time.monotonic()
        cached = _SENTIMENT_CACHE.get(cache_key)
        if cached and now - cached["ts"] < _SENTIMENT_TTL:
            print("[Sentiment] Cache hit — skipping API call")
            return cached["data"]

        if not self.client:
            print("[Sentiment] No API key — returning neutral score")
            return self._neutral_score()

        try:
            message = self.client.messages.create(
                model      = "claude-sonnet-4-20250514",
                max_tokens = 800,
                system     = SYSTEM_PROMPT,
                messages   = [{"role": "user", "content": formatted}],
            )
            raw  = message.content[0].text.strip()
            # Strip any accidental markdown fences
            raw  = raw.replace("```json", "").replace("```", "").strip()
            data = json.loads(raw)
            _SENTIMENT_CACHE[cache_key] = {"data": data, "ts": now}
            return data

        except json.JSONDecodeError as e:
            print(f"[Sentiment] JSON parse error: {e}")
            return self._neutral_score()
        except Exception as e:
            print(f"[Sentiment] API error: {e}")
            return self._neutral_score()

    def _neutral_score(self) -> dict:
        """Fallback when API unavailable."""
        return {
            "risk_score":    3,
            "direction_bias": "neutral",
            "key_risks":     ["Unable to fetch live sentiment"],
            "key_positives": ["No major event detected"],
            "recommendation": "ENTER",
            "reasoning":     "Live sentiment scoring unavailable. Check ANTHROPIC_API_KEY. Defaulting to neutral.",
            "news_items":    [],
        }
