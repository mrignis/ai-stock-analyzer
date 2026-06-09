# 📈 AI Stock Analyzer

AI-powered Chrome extension for real-time stock & crypto analysis. **Completely free — no setup required.**

![Version](https://img.shields.io/badge/version-2.0-green) ![License](https://img.shields.io/badge/license-MIT-blue)

## ✨ Features

| Feature | Description |
|---|---|
| 🤖 **AI Analysis** | Full stock/crypto analysis powered by Groq Llama 3.3 70B |
| 💬 **AI Chat** | Ask anything about stocks with live price context |
| 📈 **Real Charts** | 30-day real price history via Yahoo Finance |
| 💰 **Live Prices** | Real-time prices — Finnhub primary, Yahoo Finance fallback |
| 📋 **Watchlist** | Track your favorite stocks with live prices |
| 💼 **Portfolio Tracker** | Track P&L across all your positions |
| 📰 **News Feed** | Latest company news per ticker |
| 🔔 **Price Alerts** | Background notifications when stocks move past your threshold |
| 🌙☀️ **Dark / Light Theme** | Switchable themes with warm cream light mode |
| 📌 **Pin Window** | Open as a floating window that stays open while you work |
| 🇺🇦🇬🇧 **Bilingual** | Full Ukrainian and English support |
| ⚡ **Smart Cache** | Instant results from cache — market 5min, analysis 15min, prices 2min |

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
3. Click **Analyze** — get full AI analysis in seconds
4. Scroll down to see sector, risk, trend, forecast, chart and AI conclusion
5. Use **💬 Chat** to ask follow-up questions with automatic context
6. Add to **WL** (Watchlist) to track prices
7. Open **💼 Portfolio** tab inside WL to track your positions and P&L
8. Set price alert threshold in **🔔 Alerts** tab
9. Open **⚙ Settings → 📌 Pin Window** to keep the extension open as a floating window

## 💡 Tech Stack

- **Chrome Extension** — Manifest V3
- **Cloudflare Workers** — free serverless backend
- **Groq API** — Llama 3.3 70B (free tier, OpenAI-compatible)
- **Finnhub API** — real-time stock quotes, company data, news
- **Yahoo Finance** — 30-day price history charts + fallback prices

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
