# 📈 AI Stock Analyzer

AI-powered Chrome extension for real-time stock & crypto analysis. **Completely free — no setup, no API keys.**

![Version](https://img.shields.io/badge/version-2.8-green) ![License](https://img.shields.io/badge/license-MIT-blue) [![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-available-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/gmildjlnkoljdenbocapnkpllgkdombk)

## ✨ Features

| Feature | Description |
|---|---|
| 🤖 **AI Analysis** | Full stock/crypto analysis — sector, risk, trend, forecast & verdict. Groq Llama 3.3 70B with an instant fallback engine for peak hours |
| 👔 **Analyst Ratings** | Wall-Street buy/hold/sell consensus (Finnhub, with a Yahoo fallback for foreign/TSX listings). Says plainly when there's no coverage |
| 🏦 **ETF / Fund Aware** | ETFs and index/commodity funds (SPY, QQQ, GLD…) are analyzed as diversified baskets, not single companies — no misleading labels |
| 🌐 **Ticker Highlighting** | On Yahoo Finance, Google Finance, MarketWatch, CNBC, Reuters, Bloomberg & Seeking Alpha, tickers in articles are highlighted — hover for a live price card, click for full analysis |
| 📊 **TradingView Chart** | One click opens a clean, interactive full chart right in the popup (price-only, no clutter) |
| 🔥 **Reddit Buzz** | Social-hype signal — how a ticker is trending across r/wallstreetbets, r/stocks & co (via ApeWisdom, keyless) |
| ↗ **Viral Share Card** | Turn any analysis into a branded image and post the AI verdict to X or Reddit in one click |
| 💬 **Smart AI Chat** | Live prices, company profile, recent news and Wikipedia background in every answer; keeps context ("what about now?" just works) |
| 🔎 **Company Registry** | Ask by name in any case — "ferrari", "servicenow", "coca cola" — resolved to the right ticker via Yahoo's symbol registry |
| 💼 **Portfolio with Lots** | Wealthsimple-style: one position per ticker, expandable purchase history, weighted average cost, P&L and today's change |
| 📄 **One-Click CSV Import** | Import a broker export (Wealthsimple & others) — columns auto-detected, real cost basis from book value, no manual entry |
| 💱 **Multi-Currency** | Mixed CAD/USD/… holdings are valued correctly in your chosen display currency (TSX listings priced in CAD, converted — never a fake FX "loss"). 21 display currencies |
| 🎯 **Price Targets** | "Tell me when TSLA falls below $300" — checked every minute, one-shot notification |
| 📈 **Real Charts** | 30-day real price history via Yahoo Finance + mini sparklines |
| 💰 **Live Prices** | Finnhub primary, Yahoo fallback, edge-cached — consistent across all tabs |
| 📋 **Watchlist** | Track favorites with live prices + AI verdicts; ⭐ pick which show on the home screen |
| 📰 **News Feed** | Latest company news per ticker |
| 🔔 **Price Alerts** | Background %-change notifications with the full watchlist picture in one toast |
| 🌍 **Trilingual** | Full 🇺🇦 Ukrainian, 🇬🇧 English and 🇫🇷 French — everything (incl. stored verdicts/sectors) re-localizes on switch |
| 🌙☀️ **Dark / Light Theme** | Switchable themes with a warm cream light mode |
| 📌 **Pin Window** | Open as a floating window that stays open while you work |
| ⚡ **Instant UI** | Stale-while-revalidate everywhere — cached numbers paint instantly, live data replaces them silently |

## 🚀 Installation

**Option A — Chrome Web Store** *(recommended)*
> [**Install from the Chrome Web Store**](https://chromewebstore.google.com/detail/gmildjlnkoljdenbocapnkpllgkdombk) — one click, no setup.

**Option B — Manual (Developer mode)**
1. Download this repository → **Code → Download ZIP**
2. Unzip the folder
3. Open Chrome → `chrome://extensions/`
4. Enable **Developer mode** (top-right toggle)
5. **Load unpacked** → select the unzipped folder
6. The 📈 icon appears in your toolbar

**No API keys required.** The extension talks to a free cloud backend automatically.

## 📊 How to use

1. Click the 📈 icon in the toolbar
2. Enter a stock or crypto ticker — `TSLA`, `AAPL`, `BTC`, `CARDANO`, or a company name like `ferrari`
3. Click **Analyze** — the live price appears instantly, full AI analysis in seconds
4. Scroll for sector, risk, trend, analyst consensus, Reddit buzz, forecast and the AI conclusion
5. Tap **📊 Full chart** for an interactive TradingView chart, or **↗ Share** to post the verdict to X/Reddit
6. While reading finance sites, hover a highlighted ticker for a live price card — click it to analyze
7. Use **💬 Chat** to ask anything by ticker or name, with live data, news and follow-up context
8. Add to **WL** (Watchlist); ⭐ a stock to pin it to the home screen
9. Open the **💼 Portfolio** tab — add buys manually or **📄 Import broker CSV**; positions merge into one with purchase history and correct multi-currency P&L
10. In **🔔 Alerts**: set a %-change threshold and add 🎯 price targets
11. Pick your display currency and 📌 Pin Window in **⚙ Settings**

## 💡 Tech Stack

- **Chrome Extension** — Manifest V3, vanilla JS, zero dependencies, strict CSP
- **Cloudflare Workers** — free serverless backend with edge caching
- **Groq API** — Llama 3.3 70B primary + Llama 3.1 8B-instant fallback (free tier)
- **Finnhub** — real-time quotes, company profiles, analyst recommendations, news
- **Yahoo Finance** — price history, fallback prices, FX rates, symbol search, foreign/TSX analyst data
- **ApeWisdom** — Reddit/social mention data for the buzz signal (keyless)
- **TradingView** — embedded interactive chart (iframe, no external script)
- **Ollama web search + Wikipedia** — company background for the AI chat

## 🔒 Privacy

- All data (watchlist, portfolio, history, conversations) stored **locally** in `chrome.storage`
- Tickers and chat messages are sent to the AI only to generate a response — not logged or saved
- No accounts, no tracking, no ads

<details>
<summary>🛠️ Self-hosting (for developers only)</summary>

> Regular users don't need this. The extension works out of the box with a shared free backend.

Want to run your own backend?

1. Get a free API key at [console.groq.com](https://console.groq.com) and [finnhub.io](https://finnhub.io)
2. Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/): `npm install -g wrangler`
3. Add your secrets:
   ```bash
   wrangler secret put GROQ_KEY        # chat/analyze engine
   wrangler secret put FINNHUB_KEY     # quotes, profiles, analysts, news
   wrangler secret put OLLAMA_API_KEY  # optional — company web search only
   ```
4. Deploy: `wrangler deploy`
5. Update `WORKER_URL` in `popup.js` and `background.js` with your worker URL

</details>
