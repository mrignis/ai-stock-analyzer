# 📈 AI Stock Analyzer

AI-powered Chrome extension for real-time stock analysis. **Completely free — no API keys needed.**

## ✨ Features

- 🤖 **AI Analysis** — instant stock analysis powered by Llama 3.3 (Groq)
- 💬 **AI Chat** — ask anything about stocks, get live price data automatically
- 💰 **Real-time prices** — live prices via Finnhub
- 📋 **Watchlist** — track your favorite stocks
- 🔔 **Price alerts** — get notified when stocks move significantly
- 🕐 **Search history** — keep track of analyzed stocks
- 🇺🇦🇬🇧 **Bilingual** — Ukrainian and English support

## 🚀 Installation

1. Download this repository as ZIP → click **Code → Download ZIP**
2. Unzip the folder
3. Open Chrome → go to `chrome://extensions/`
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** → select the unzipped folder
6. The 📈 icon will appear in your Chrome toolbar

**No API keys required.** The extension uses a free cloud backend.

## 📊 How to use

1. Click the 📈 icon in Chrome toolbar
2. Enter a stock ticker (e.g. TSLA, AAPL, NVDA)
3. Click **Analyze** — get full AI analysis in seconds
4. Open 💬 **Chat** tab to ask follow-up questions
5. Add stocks to Watchlist with **+ Watchlist** button
6. Set price alerts in the 🔔 tab

## 💡 Tech Stack

- Chrome Extension (Manifest V3)
- Cloudflare Workers (free serverless backend)
- Groq API — Llama 3.3 70B (free tier)
- Finnhub API (real-time market data)

## 🔒 Privacy

No personal data is stored. Stock tickers and your questions are sent to the AI only to generate a response and are not logged or saved.

## 🛠️ Self-hosting (optional)

If you want to run your own backend:

1. Get a free API key at [console.groq.com](https://console.groq.com)
2. Get a free Finnhub key at [finnhub.io](https://finnhub.io)
3. Install [Wrangler](https://developers.cloudflare.com/workers/wrangler/):
   ```
   npm install -g wrangler
   ```
4. Add your secrets:
   ```
   wrangler secret put GROQ_KEY
   wrangler secret put FINNHUB_KEY
   ```
5. Deploy:
   ```
   wrangler deploy
   ```
6. Update `WORKER_URL` in `popup.js` and `background.js` with your worker URL
