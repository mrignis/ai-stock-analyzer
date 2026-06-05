# 📈 AI Stock Analyzer

AI-powered Chrome extension for real-time stock analysis with prices, watchlist, and price alerts.

## ✨ Features

- 🤖 **AI Analysis** — get instant analysis of any stock via OpenAI
- 💰 **Real-time prices** — live prices via Finnhub API
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

## ⚙️ Setup

### OpenAI API Key (required for AI analysis)
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new key
3. Open the extension → ⚙️ Settings → paste your key → Save
4. Cost: ~$0.001 per analysis

### Finnhub API Key (required for real-time prices)
1. Go to [finnhub.io](https://finnhub.io) → Get free API key
2. Open the extension → ⚙️ Settings → Finnhub API → paste your key → Save
3. Free plan: 60 requests/minute

### Make.com (optional alternative to OpenAI)
1. Create a webhook scenario on [make.com](https://make.com)
2. Connect OpenAI module
3. Paste webhook URL in Settings → Make.com

## 🔒 Privacy

All API keys are stored **locally in your browser only**. Nobody else can access them.

## 📊 How to use

1. Click the 📈 icon in Chrome toolbar
2. Enter a stock ticker (e.g. TSLA, AAPL, NVDA)
3. Click **Analyze**
4. Add stocks to Watchlist with **+ Watchlist** button
5. Set price alerts in the 🔔 tab

## 💡 Tech Stack

- Chrome Extension (Manifest V3)
- OpenAI GPT-4o-mini
- Finnhub API
- Make.com (optional)
