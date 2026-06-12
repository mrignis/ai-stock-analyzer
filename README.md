# 📈 AI Stock Analyzer

AI-powered Chrome extension for real-time stock & crypto analysis. **Completely free — no setup required.**

![Version](https://img.shields.io/badge/version-2.1-green) ![License](https://img.shields.io/badge/license-MIT-blue)

## ✨ Features

| Feature | Description |
|---|---|
| 🤖 **AI Analysis** | Full stock/crypto analysis — Llama 3.3 70B with an instant fallback engine for peak hours |
| 💬 **Smart AI Chat** | Live prices, company profile, recent news and Wikipedia background in every answer; keeps conversation context ("what about now?" just works) |
| 🔎 **Company Registry** | Ask by name in any case — "ferrari", "servicenow", "coca cola" — resolved to the right ticker via Yahoo's symbol registry |
| 🎯 **Price Targets** | "Tell me when TSLA falls below $300" — checked every minute, one-shot notification |
| 💼 **Portfolio with Lots** | Wealthsimple-style: one position per ticker, expandable purchase history, weighted average cost, P&L |
| 💱 **21 Currencies** | View all prices in USD, EUR, UAH, GBP, JPY, PLN and more — chat converts too |
| 📈 **Real Charts** | 30-day real price history via Yahoo Finance |
| 💰 **Live Prices** | Finnhub primary, Yahoo fallback, ~120ms edge-cached — consistent across all tabs |
| 📋 **Watchlist** | Track your favorite stocks with live prices and AI verdicts |
| 📰 **News Feed** | Latest company news per ticker |
| 🔔 **Price Alerts** | Background %-change notifications with the full watchlist picture in one toast |
| 🌙☀️ **Dark / Light Theme** | Switchable themes with warm cream light mode |
| 📌 **Pin Window** | Open as a floating window that stays open while you work |
| 🇺🇦🇬🇧 **Bilingual** | Full Ukrainian and English support |
| ⚡ **Instant UI** | Stale-while-revalidate everywhere — cached numbers paint instantly, live data replaces them silently |

## 🚀 Installation

**Option A — Chrome Web Store** *(coming soon)*
> One-click install — no setup needed

**Option B — Manual (Developer mode)**
1. Download this repository → click **Code → Download ZIP**
2. Unzip the folder
3. Open Chrome → go to `chrome://extensions/`
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** → select the unzipped folder
6. The 📈 icon appears in your Chrome toolbar

**No API keys required.** The extension connects to a free cloud backend automatically.

## 📊 How to use

1. Click the 📈 icon in the Chrome toolbar
2. Enter a stock or crypto ticker — `TSLA`, `AAPL`, `BTC`, `CARDANO`...
3. Click **Analyze** — the live price appears instantly, full AI analysis in seconds
4. Scroll down to see sector, risk, trend, forecast, chart and AI conclusion
5. Use **💬 Chat** to ask anything — by ticker or by name ("what about ferrari?"), with live data, news and follow-up context
6. Add to **WL** (Watchlist) to track prices
7. Open **💼 Portfolio** tab inside WL — add buys of the same ticker and they merge into one position with purchase history
8. In **🔔 Alerts**: set a %-change threshold and add 🎯 price targets ("notify when TSLA falls below $300")
9. Pick your display currency in **⚙ Settings** (21 supported)
10. **⚙ Settings → 📌 Pin Window** keeps the extension open as a floating window

## 💡 Tech Stack

- **Chrome Extension** — Manifest V3, vanilla JS, zero dependencies
- **Cloudflare Workers** — free serverless backend with 20s edge caching
- **Groq API** — Llama 3.3 70B primary + Llama 3.1 8B-instant fallback (free tier)
- **Finnhub API** — real-time stock quotes, company profiles, news
- **Yahoo Finance** — price history charts, fallback prices, FX rates, symbol search
- **Wikipedia API** — company background for the AI chat

## 🔒 Privacy

- All data (watchlist, portfolio, history, conversations) stored **locally** in `chrome.storage`
- Stock tickers and chat messages are sent to the AI only to generate a response — not logged or saved
- No accounts, no tracking, no ads

<details>
<summary>🛠️ Self-hosting (for developers only)</summary>

> Regular users don't need this. The extension works out of the box with a shared free backend.

Want to run your own backend?

1. Get a free API key at [console.groq.com](https://console.groq.com)
2. Get a free Finnhub key at [finnhub.io](https://finnhub.io)
3. Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/):
   ```bash
   npm install -g wrangler
   ```
4. Add your secrets:
   ```bash
   wrangler secret put GROQ_KEY
   wrangler secret put FINNHUB_KEY
   ```
5. Deploy:
   ```bash
   wrangler deploy
   ```
6. Update `WORKER_URL` in `popup.js` and `background.js` with your worker URL

</details>
