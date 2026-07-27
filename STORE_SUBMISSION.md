# Chrome Web Store — submission pack (AI Stock Analyzer v2.5)

Paste-ready text for the CWS Developer Dashboard. Store form is in **English**.
Not shipped in the extension (build-zip.ps1 packs an explicit runtime allowlist).

---

## Single purpose (Dashboard → "Single purpose")
> AI-powered analysis of stocks and cryptocurrencies: live prices, charts, an AI Buy/Hold/Sell verdict, Wall-Street analyst ratings, a portfolio tracker, price alerts, and a finance chat assistant.

---

## Permission justifications (Dashboard → "Privacy practices")

**storage**
> Saves the user's watchlist, portfolio, price alerts, chat history, and settings locally on their device (chrome.storage.local). Nothing is sent to a server for storage.

**alarms**
> Runs a periodic background check (chrome.alarms, ~every 15 min) that compares watchlist prices against the user's alert thresholds, so price alerts work without keeping the popup open.

**notifications**
> Shows a desktop notification when a watchlisted stock moves past the user's set alert threshold.

**Host permission — `https://stock-ai-analyzer.chelb-dev.workers.dev/*`**
> The extension's own backend (a Cloudflare Worker) and the only external host it contacts — to fetch live prices, charts, news, and the AI analysis. Only the ticker the user chooses to analyze is sent; no browsing data.

**Content scripts (matches: finance.yahoo.com, google.com/finance, marketwatch.com, cnbc.com, reuters.com, bloomberg.com, seekingalpha.com, reddit.com, x.com, twitter.com)**
> Highlights stock tickers ($TSLA, cashtags) mentioned in articles and social posts on these financial-news and investing-community sites so the user can hover for a live price (plus, on Reddit/X, how the ticker is trending) and click one for an instant AI analysis. Reads only the visible text to find tickers; does not collect, store, or transmit page content, posts, or browsing history — only the ticker symbol the user chooses to look up is sent to our backend.

**Remote code**
> No. The extension executes no remotely-hosted code. All logic is bundled; the backend returns only data (JSON), never executable code.

---

## Data usage declaration (checkboxes)
- Data collected: **only what the user types** (tickers / chat questions), sent to the backend to return prices & analysis. Watchlist/portfolio/history stored **locally only**.
- **We do NOT** sell or transfer user data to third parties.
- **We do NOT** use data for purposes unrelated to the single purpose.
- **We do NOT** use data for creditworthiness / lending.
- Privacy policy URL: **https://mrignis.github.io/ai-stock-analyzer/privacy-policy.html**

---

## Store listing

**Name:** AI Stock Analyzer — Stocks, Crypto & Portfolio

**Short description (≤132 chars):**
> Your instant AI analyst for stocks & crypto: Buy/Hold/Sell verdict, analyst ratings, portfolio, price alerts & a finance chat.

**Detailed description:**
> Your instant AI analyst for stocks and crypto — built for investors who want answers, not homework.
>
> Type any ticker — TSLA, AAPL, BTC, NVDA — and get a clear, professional read in seconds: Buy / Hold / Sell verdict, key risks, price forecast, and Wall-Street analyst consensus. Complex markets, one simple answer.
>
> 🤖 Instant AI verdict — a full breakdown of any stock or crypto, in plain language.
> 📊 Analyst consensus — Wall-Street buy/hold/sell ratings, incl. foreign & TSX listings.
> 🔥 Reddit hype meter — see how retail is trending on a ticker before you act.
> 💬 Ask anything — a finance chat with live data: CEOs, news, "is it a buy?"
> 📰 Research as you browse — tickers on news sites, Reddit and X light up; hover for the price, click for the full analysis.
> ⚖ Compare — put two tickers side by side and pick the winner.
> 💼 Portfolio & P&L — track real gains across US, foreign, TSX and crypto, in your currency.
> 📋 Watchlist & alerts — follow your picks and get notified the moment they move.
> 📈 Real charts & live prices — 30-day history and real-time quotes.
>
> 🇬🇧🇺🇦🇫🇷 English · Ukrainian · French — 💱 21 currencies — 🌙 dark & light
>
> Not financial advice. For information only.

**Category:** Finance / Productivity
**Languages:** English, Ukrainian, French

---

## Screenshot checklist (1280×800, 24-bit, no alpha — use store-resize.ps1)
- [ ] Search + analysis result (verdict + analyst bar) — pick a covered US stock (e.g. AAPL/MSFT)
- [ ] Foreign/TSX example showing analyst ratings (e.g. GMIN.TO or SHOP.TO)
- [ ] Watchlist with the ★ home-picker + Portfolio P&L
- [ ] Finance chat answering a CEO/news question
- [ ] Ticker highlighting in a real article + hover price card
- [ ] Language toggle (FR or UA) to show localization

---

## Pre-submit checklist
- [ ] `manifest.json` version bumped ABOVE the published store version (rule: [[always-bump-manifest]])
- [ ] `powershell -File build-zip.ps1` → upload `ai-stock-analyzer-store.zip`
- [ ] Privacy policy URL live (GitHub Pages)
- [ ] All permission justifications + data-usage boxes filled (above)
- [ ] Screenshots uploaded, icon final
