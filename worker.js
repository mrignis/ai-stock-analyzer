// AI Stock Analyzer — Cloudflare Worker
// Deploy: wrangler deploy
// Secrets: wrangler secret put GROQ_KEY
//          wrangler secret put FINNHUB_KEY

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const CRYPTO_MAP = {
  'BTC': 'BINANCE:BTCUSDT', 'ETH': 'BINANCE:ETHUSDT',
  'SOL': 'BINANCE:SOLUSDT', 'BNB': 'BINANCE:BNBUSDT',
  'XRP': 'BINANCE:XRPUSDT', 'ADA': 'BINANCE:ADAUSDT',
  'DOGE': 'BINANCE:DOGEUSDT', 'DOT': 'BINANCE:DOTUSDT',
  'AVAX': 'BINANCE:AVAXUSDT', 'MATIC': 'BINANCE:MATICUSDT',
  'LINK': 'BINANCE:LINKUSDT', 'UNI': 'BINANCE:UNIUSDT',
};

// Full name → ticker normalization
const CRYPTO_NAMES = {
  'BITCOIN': 'BTC', 'ETHEREUM': 'ETH', 'SOLANA': 'SOL',
  'CARDANO': 'ADA', 'DOGECOIN': 'DOGE', 'BINANCECOIN': 'BNB',
  'RIPPLE': 'XRP', 'POLKADOT': 'DOT', 'AVALANCHE': 'AVAX',
  'POLYGON': 'MATIC', 'CHAINLINK': 'LINK', 'UNISWAP': 'UNI',
  'TRON': 'TRX',
};

async function callGroq(env, messages, temperature = 0.3, maxTokens = 2048) {
  // 25s timeout — Cloudflare Worker free tier limit is 30s wall-clock
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.GROQ_KEY,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Groq timeout — спробуй ще раз / try again');
    throw e;
  }
  clearTimeout(timer);

  // Read as text first — Groq sometimes returns HTML error pages instead of JSON
  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    // Not valid JSON — Groq returned an error page
    if (res.status === 503 || res.status === 504 || res.status === 502) {
      throw new Error('Groq перевантажений (HTTP ' + res.status + '). Спробуй ще раз / Try again.');
    }
    throw new Error('Groq error (HTTP ' + res.status + '). Try again.');
  }

  if (data.error) throw new Error('Groq: ' + (data.error.message || JSON.stringify(data.error)));
  const text = data.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('Groq returned empty response');
  return text;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/test' && request.method === 'GET') {
        return json({ ok: true, time: Date.now(), model: GROQ_MODEL });
      }
      if (url.pathname === '/market' && request.method === 'GET') {
        return await handleMarket(env);
      }
      if (url.pathname === '/price' && request.method === 'GET') {
        return await handlePrice(request, env);
      }
      if (url.pathname === '/analyze' && request.method === 'POST') {
        return await handleAnalyze(request, env);
      }
      if (url.pathname === '/chat' && request.method === 'POST') {
        return await handleChat(request, env);
      }
      if (url.pathname === '/news' && request.method === 'GET') {
        return await handleNews(request, env);
      }
      if (url.pathname === '/candle' && request.method === 'GET') {
        return await handleCandle(request, env);
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};

// ── Shared helpers ────────────────────────────────────────────────────────────

// Parses ?ticker= from URL, normalizes crypto names. Returns null if missing.
function parseTicker(request) {
  const raw = (new URL(request.url).searchParams.get('ticker') || '').toUpperCase();
  if (!raw) return null;
  const t = CRYPTO_NAMES[raw] || raw;
  return { t, isCrypto: !!CRYPTO_MAP[t] };
}

// Fetches a Finnhub quote, returns parsed JSON or null on network error
async function finnhubQuote(env, sym) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${env.FINNHUB_KEY}`
    );
    return await res.json();
  } catch {
    return null;
  }
}

// Percent change between current and previous close (0 when pc is invalid)
function pctChange(c, pc) {
  return pc > 0 ? ((c - pc) / pc * 100) : 0;
}

// Live price with full fallback chain: Finnhub (crypto-mapped) → Yahoo Finance.
// Returns { c, pc } or null. Used by chat so BTC etc. also get live data.
async function getLivePrice(env, t) {
  const fh = await finnhubQuote(env, CRYPTO_MAP[t] || t);
  if (fh && fh.c && fh.c > 0) return { c: fh.c, pc: fh.pc };
  return await yahooQuote(CRYPTO_MAP[t] ? t + '-USD' : t);
}

// Deep company info for chat: profile + recent news + Wikipedia background.
// Returns a compact string for the system prompt ('' when nothing found).
async function fetchCompanyInfo(env, t) {
  if (CRYPTO_MAP[t]) return ''; // crypto has no Finnhub profile/news on free tier

  const [profile, news] = await Promise.all([
    fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${t}&token=${env.FINNHUB_KEY}`)
      .then(r => r.json()).catch(() => null),
    fetch(`https://finnhub.io/api/v1/company-news?symbol=${t}&from=${getDateDaysAgo(7)}&to=${getToday()}&token=${env.FINNHUB_KEY}`)
      .then(r => r.json()).catch(() => []),
  ]);

  const parts = [];
  if (profile && profile.name) {
    parts.push(
      `${t} company profile: ${profile.name}, country of registration=${profile.country || 'N/A'}, ` +
      `industry=${profile.finnhubIndustry || 'N/A'}, ` +
      `market cap=${profile.marketCapitalization ? '$' + (profile.marketCapitalization / 1000).toFixed(1) + 'B' : 'N/A'}, ` +
      `IPO=${profile.ipo || 'N/A'}, website=${profile.weburl || 'N/A'}.`
    );
    // Wikipedia intro — covers history and what the company is known for.
    // Try the full profile name first ("Apple Inc"), fall back to the stripped one.
    try {
      const stripped = profile.name.replace(/[,.]?\s+(Inc|Corp|Corporation|Ltd|PLC|Co|Class [A-C])\.?$/i, '').trim();
      for (const title of [...new Set([profile.name, stripped])]) {
        const w = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
          { headers: { 'User-Agent': 'stock-ai-analyzer/1.0' } }
        );
        if (!w.ok) continue;
        const wd = await w.json();
        if (wd.extract && wd.type !== 'disambiguation') {
          parts.push(`Wikipedia background on ${title}: ${wd.extract.slice(0, 700)}`);
          break;
        }
      }
    } catch { /* Wikipedia is optional — skip on any error */ }
  }
  if (Array.isArray(news) && news.length > 0) {
    parts.push(
      `Recent ${t} news headlines (last 7 days): ` +
      news.slice(0, 5).map(n => n.headline).filter(Boolean).join(' | ')
    );
  }
  return parts.join(' ');
}

// Well-known company names → tickers, so "чому Microsoft падає" works without a ticker
const NAME_TO_TICKER = {
  'MICROSOFT': 'MSFT', 'APPLE': 'AAPL', 'TESLA': 'TSLA', 'GOOGLE': 'GOOGL',
  'AMAZON': 'AMZN', 'NVIDIA': 'NVDA', 'META': 'META', 'FACEBOOK': 'META',
  'NETFLIX': 'NFLX', 'INTEL': 'INTC', 'AMD': 'AMD', 'DISNEY': 'DIS',
};

// ── Yahoo Finance price helper (fallback) ─────────────────────────────────────
async function yahooQuote(symbol) {
  // Crypto needs -USD suffix (BTC → BTC-USD), stocks stay as-is (SPY, TSLA)
  try {
    const res  = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const c  = meta.regularMarketPrice || meta.previousClose || 0;
    const pc = meta.previousClose || meta.chartPreviousClose || c;
    if (!c || c <= 0) return null;
    return { c, pc };
  } catch {
    return null;
  }
}

// Yahoo symbols for market cards (Finnhub uses BINANCE:BTCUSDT, Yahoo uses BTC-USD)
const YAHOO_MARKET_SYM = { SP500:'SPY', NASDAQ:'QQQ', BTC:'BTC-USD', GOLD:'GLD' };

// ── /market ───────────────────────────────────────────────────────────────────
async function handleMarket(env) {
  const symbols = [
    { key: 'SP500', sym: 'SPY',             label: 'S&P 500' },
    { key: 'NASDAQ',sym: 'QQQ',             label: 'NASDAQ'  },
    { key: 'BTC',   sym: 'BINANCE:BTCUSDT', label: 'Bitcoin' },
    { key: 'GOLD',  sym: 'GLD',             label: 'Gold'    },
  ];

  const results = await Promise.all(
    symbols.map(async s => ({ ...s, q: await finnhubQuote(env, s.sym) }))
  );

  const data = {};
  // Collect which keys need Yahoo fallback
  const needFallback = [];

  results.forEach(r => {
    if (r.q && r.q.c > 0) {
      data[r.key] = { label: r.label, c: r.q.c, pc: r.q.pc, pct: pctChange(r.q.c, r.q.pc) };
    } else {
      // Finnhub failed or returned 0 — try Yahoo
      needFallback.push(r);
    }
  });

  // Yahoo fallback for failed cards
  if (needFallback.length > 0) {
    await Promise.allSettled(
      needFallback.map(async s => {
        const q = await yahooQuote(YAHOO_MARKET_SYM[s.key]);
        if (q) data[s.key] = { label: s.label, c: q.c, pc: q.pc, pct: pctChange(q.c, q.pc) };
      })
    );
  }

  return json(data);
}

// ── /price?ticker=TSLA ────────────────────────────────────────────────────────
async function handlePrice(request, env) {
  const parsed = parseTicker(request);
  if (!parsed) return json({ error: 'Missing ticker' }, 400);
  const { t, isCrypto } = parsed;

  // Try Finnhub first; if it returns a valid price — use it
  const finnhubData = await finnhubQuote(env, CRYPTO_MAP[t] || t);
  if (finnhubData && finnhubData.c && finnhubData.c > 0) return json(finnhubData);

  // Finnhub failed or returned zero — fallback to Yahoo Finance
  const yahooData = await yahooQuote(isCrypto ? t + '-USD' : t);
  if (yahooData) return json({ c: yahooData.c, pc: yahooData.pc, dp: pctChange(yahooData.c, yahooData.pc) });

  return json(finnhubData || {}); // return whatever Finnhub gave (may be empty)
}

// ── /analyze ──────────────────────────────────────────────────────────────────
async function handleAnalyze(request, env) {
  const { ticker, lang } = await request.json();
  if (!ticker) return json({ error: 'Missing ticker' }, 400);

  const raw = ticker.toUpperCase().trim();
  // Reject suspiciously long or malformed tickers before they enter the AI prompt
  if (raw.length > 15 || !/^[A-Z0-9.\-:/]+$/.test(raw)) {
    return json({ error: 'Invalid ticker' }, 400);
  }
  const t = CRYPTO_NAMES[raw] || raw; // normalize full name → ticker
  const isCrypto = !!CRYPTO_MAP[t];
  const finnhubSym = CRYPTO_MAP[t] || t;
  const today = getToday();
  const weekAgo = getDateDaysAgo(7);

  const [quoteRes, profileRes, newsRes, metricsRes] = await Promise.allSettled([
    fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSym)}&token=${env.FINNHUB_KEY}`),
    isCrypto
      ? fetch(`https://finnhub.io/api/v1/crypto/profile?symbol=${encodeURIComponent(finnhubSym)}&token=${env.FINNHUB_KEY}`)
      : fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${t}&token=${env.FINNHUB_KEY}`),
    isCrypto
      ? Promise.resolve({ json: () => [] })
      : fetch(`https://finnhub.io/api/v1/company-news?symbol=${t}&from=${weekAgo}&to=${today}&token=${env.FINNHUB_KEY}`),
    isCrypto
      ? Promise.resolve({ json: () => ({}) })
      : fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${t}&metric=all&token=${env.FINNHUB_KEY}`),
  ]);

  const quote   = quoteRes.status   === 'fulfilled' ? await quoteRes.value.json()   : {};
  const profile = profileRes.status === 'fulfilled' ? await profileRes.value.json() : {};
  const newsRaw = newsRes.status    === 'fulfilled' ? await newsRes.value.json()    : [];
  const metrics = metricsRes.status === 'fulfilled' ? await metricsRes.value.json() : {};

  const news = Array.isArray(newsRaw)
    ? newsRaw.slice(0, 5).map(n => `- ${n.headline}`).join('\n')
    : '';
  const m = metrics.metric || {};

  const context = `
Stock ticker: ${t}
Company: ${profile.name || t}
Industry: ${profile.finnhubIndustry || 'Unknown'} | Country: ${profile.country || 'N/A'}
Current price: $${quote.c || 'N/A'} | Prev close: $${quote.pc || 'N/A'} | Daily change: ${quote.dp != null ? quote.dp.toFixed(2) + '%' : 'N/A'}
Market cap: ${profile.marketCapitalization ? '$' + (profile.marketCapitalization / 1000).toFixed(1) + 'B' : 'N/A'}
P/E ratio: ${m['peNormalizedAnnual'] || m['peTTM'] || 'N/A'}
52-week high: $${m['52WeekHigh'] || 'N/A'} | 52-week low: $${m['52WeekLow'] || 'N/A'}
ROE (TTM): ${m['roeTTM'] != null ? m['roeTTM'].toFixed(1) + '%' : 'N/A'}
Revenue growth YoY: ${m['revenueGrowthTTMYoy'] != null ? m['revenueGrowthTTMYoy'].toFixed(1) + '%' : 'N/A'}
Recent news (last 7 days):
${news || 'No recent news available'}`.trim();

  const ua = lang === 'ua';
  const systemPrompt = `You are a professional stock analyst. Reply ONLY with valid JSON — no markdown, no explanation, no extra text.`;
  const userPrompt = `Analyze this stock based on real data:

${context}

${ua ? 'IMPORTANT: Respond ENTIRELY in Ukrainian language using only Cyrillic characters. Never mix in Chinese, Japanese, or any other non-Cyrillic script.' : 'Respond in English only.'}
Return ONLY this JSON structure:
{"sector":"...","risk":"${ua ? 'Високий або Середній або Низький' : 'High or Medium or Low'}","trend":"...","forWho":"...","what":"2-3 sentences about what the company does","risks":"2-3 sentences about key risks","forecast":"2-3 sentences with price target","conclusion":"2-3 sentences summary","verdict":"${ua ? 'одне слово: Купувати або Тримати або Продавати' : 'one word: Buy or Hold or Sell'}","color":"green or yellow or red or blue","dir":"up or down or volatile or flat or up_strong"}`;

  let text;
  try {
    text = await callGroq(env, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], 0.3, 1024);
  } catch (e) {
    return json({ error: e.message }, 500);
  }

  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return json({ error: 'AI parse error', raw: text.slice(0, 300) }, 500);

  let analysis;
  try {
    analysis = JSON.parse(match[0]);
  } catch (e) {
    return json({ error: 'AI JSON parse error', raw: text.slice(0, 300) }, 500);
  }
  return json({
    ...analysis,
    _quote: quote,
    _country: profile.country || null,
    _name: profile.name || null,
  });
}

// ── /news?ticker=TSLA ────────────────────────────────────────────────────────
async function handleNews(request, env) {
  const parsed = parseTicker(request);
  if (!parsed) return json({ error: 'Missing ticker' }, 400);
  const { t, isCrypto } = parsed;
  if (isCrypto) return json([]); // Finnhub free tier has no crypto news

  const today = getToday();
  const weekAgo = getDateDaysAgo(7);

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(t)}&from=${weekAgo}&to=${today}&token=${env.FINNHUB_KEY}`
    );
    const raw_news = await res.json();
    if (!Array.isArray(raw_news)) return json([]);

    const news = raw_news.slice(0, 12).map(n => ({
      headline: n.headline || '',
      source:   n.source   || '',
      url:      n.url      || '',
      datetime: n.datetime || 0,
      summary:  n.summary  ? n.summary.slice(0, 180) : '',
    }));
    return json(news);
  } catch (e) {
    return json([]);
  }
}

// ── /candle?ticker=TSLA ───────────────────────────────────────────────────────
async function handleCandle(request, env) {
  const parsed = parseTicker(request);
  if (!parsed) return json({ error: 'Missing ticker' }, 400);
  const { t, isCrypto } = parsed;
  // Yahoo Finance: stocks use ticker as-is (TSLA), crypto adds -USD (BTC-USD)
  const yahooSym = isCrypto ? t + '-USD' : t;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSym}?interval=1d&range=1mo`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return json({ error: 'no_data' }, 404);

    const closes = result.indicators?.quote?.[0]?.close;
    if (!closes || closes.length < 2) return json({ error: 'no_data' }, 404);

    const filtered = closes.filter(c => c !== null && c !== undefined);
    if (filtered.length < 2) return json({ error: 'no_data' }, 404);

    return json({ c: filtered });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

// ── /chat ─────────────────────────────────────────────────────────────────────
const SKIP_WORDS = new Set([
  'I','A','AN','THE','IS','IN','ON','AT','TO','DO','BE','AS','BY','OR','AND','FOR',
  'NOT','BUT','HIS','HER','CAN','MAY','GET','SET','NEW','NOW','ALL','ANY','HAS',
  'HAD','WAS','ARE','WILL','WHAT','WHEN','THIS','THAT','WITH','FROM','HAVE','THEY',
  'SAID','BEEN','ALSO','SOME','INTO','THAN','THEN','EACH','TIME','LIKE','JUST',
  'KNOW','TAKE','YEAR','YOUR','GOOD','MUCH','VERY','WELL','SUCH','EVEN','MOST',
  'USED','MAKE','WANT','LOOK','MORE','GO','IT','OF','IF','US','WE','UP','NO','SO',
  'HE','SHE','ME','MY','WHO','HOW','WHY','ITS','HIM',
  // Common chat words that look like tickers
  'INFO','TELL','SHOW','GIVE','HELP','DOES','MEAN','NEED','FIND','BEST','NEXT',
  'SELL','HIGH','DOWN','FALL','RISE','GAIN','LOSS','LOST','LAST','PAST','REAL',
  'LIVE','DATA','NEWS','SURE','OKAY','CHAT','LONG','HOLD','NICE','SAFE',
  'RISK','RATE','PLAN','OPEN','STOP','KEEP','CASH','IDEA','ONES','BOTH',
  'ABOVE','BELOW','ABOUT','AFTER','AGAIN','PRICE','STOCK','SHARE','TRADE','WORTH',
  'TODAY','SINCE','THINK','FEELS','LOOKS','MAYBE','RIGHT','WRONG','STILL','OTHER',
]);

async function handleChat(request, env) {
  const { messages, context, lang } = await request.json();
  if (!messages || !messages.length) return json({ error: 'No messages' }, 400);

  // Server-side limit — client enforces 40 but direct POST calls bypass it
  const safeMessages = messages.slice(-40);

  const ua = lang === 'ua';

  // Detect tickers and fetch live prices
  const lastMsg = safeMessages[safeMessages.length - 1]?.content || '';
  const upperMsg = lastMsg.toUpperCase();
  const rawTokens = upperMsg.match(/\b[A-Z]{2,5}\b/g) || [];
  // Also catch well-known company/crypto names ("Microsoft" → MSFT, "BITCOIN" → BTC).
  // Word boundaries so "METAL" doesn't trigger META, "PINEAPPLE" doesn't trigger APPLE.
  const namedTickers = [...Object.entries(NAME_TO_TICKER), ...Object.entries(CRYPTO_NAMES)]
    .filter(([name]) => new RegExp('\\b' + name + '\\b').test(upperMsg))
    .map(([, t]) => t);
  const potentialTickers = [...new Set(
    rawTokens.filter(t => !SKIP_WORDS.has(t)).concat(namedTickers)
  )].slice(0, 3);

  let liveData = '';
  let companyInfo = '';
  if (potentialTickers.length > 0) {
    const results = await Promise.all(
      potentialTickers.map(async t => ({ ticker: t, d: await getLivePrice(env, t) }))
    );
    const quotes = results
      .filter(r => r.d && r.d.c > 0)
      .map(r => {
        const pct = pctChange(r.d.c, r.d.pc).toFixed(2);
        return `${r.ticker}: $${r.d.c} (${Number(pct) > 0 ? '+' : ''}${pct}% today)`;
      });
    if (quotes.length > 0) liveData = 'Live market data: ' + quotes.join('; ') + '.';

    // Deep info (profile + news + Wikipedia) for the first ticker with a real quote
    const primary = results.find(r => r.d && r.d.c > 0);
    if (primary) companyInfo = await fetchCompanyInfo(env, primary.ticker);
  }

  const system = [
    'You are a helpful stock market and finance assistant with access to live market data.',
    `Today is ${getToday()}.`,
    'CRITICAL RULE: If live market data or analysis context below contains a price for a ticker, that ticker IS valid and currently trading. Do NOT say a ticker is invalid, delisted, or non-existent if data was provided for it. Your training data is outdated — companies get relisted, renamed, or split. Always trust live data over training knowledge.',
    'Never contradict live data with training knowledge. NEVER give specific prices, percentages, or market cap figures from your training data — those are outdated and wrong. Only state prices that appear in the live data or context provided. If you do not have live data for a ticker, say you do not have current price info rather than guessing.',
    context ? `Current stock analysis context (treat as ground truth): ${context}` : '',
    liveData,
    companyInfo,
    companyInfo ? 'Use the company profile, Wikipedia background, and news headlines above to answer questions about the company (founders, history, country, what is happening now). For stable historical facts (founders, founding year, headquarters) you may also use your general knowledge when confident. Never guess prices, market caps, or financial figures — those only from live data above.' : '',
    ua ? 'IMPORTANT: Respond ONLY in Ukrainian language. Never use Chinese, Japanese, Arabic or any other non-Latin/Cyrillic characters. If you catch yourself writing non-Ukrainian text, stop and rewrite in Ukrainian.' : 'Respond in English only.',
    'Be concise, factual, and helpful. Use plain text only — no markdown, no asterisks. If you need a list, start each line with "- " (dash and space). Use line breaks between paragraphs.',
  ].filter(Boolean).join(' ');

  const groqMessages = [
    { role: 'system', content: system },
    ...safeMessages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  ];

  let reply;
  try {
    reply = await callGroq(env, groqMessages, 0.7, 800);
  } catch (e) {
    return json({ error: e.message }, 500);
  }

  return json({ reply });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}
