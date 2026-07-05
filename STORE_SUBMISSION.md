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

**Content scripts (matches: finance.yahoo.com, google.com/finance, marketwatch.com, cnbc.com, reuters.com, bloomberg.com, seekingalpha.com)**
> Highlights stock tickers mentioned in articles on these financial-news sites so the user can click one for an instant analysis. Reads only the visible article text to find tickers; does not collect or transmit page content or browsing history.

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
> Instant AI analysis of any stock or crypto: live prices, Buy/Hold/Sell, analyst ratings, portfolio, alerts & a finance chat. Free.

**Detailed description:**
> AI Stock Analyzer gives you an instant, plain-language read on any stock or cryptocurrency — no API keys, no sign-up, completely free.
>
> • AI verdict — Buy / Hold / Sell with sector, risk, trend and a short forecast.
> • Wall-Street analyst ratings — buy/hold/sell consensus (incl. many foreign/TSX stocks).
> • Live prices & 30-day charts — US, foreign, TSX and crypto.
> • Finance chat — ask about any company's CEO, news or history and get a live answer.
> • Portfolio tracker — positions with cost basis and P&L.
> • Price alerts — desktop notifications when a stock crosses your threshold.
> • Reads the news with you — highlights tickers in finance articles; hover for the live price, click for full analysis.
> • 3 languages — English, Ukrainian, French.
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
