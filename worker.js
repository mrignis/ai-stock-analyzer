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

const GROQ_FALLBACK_MODEL = 'llama-3.1-8b-instant'; // backup engine: simpler but never queued

async function callGroq(env, messages, temperature = 0.3, maxTokens = 2048) {
  // Primary engine (70B, 20s) → on timeout/overload retry with the fast
  // fallback (8B-instant, 12s). User always gets an answer at peak hours.
  try {
    return await groqRequest(env, GROQ_MODEL, messages, temperature, maxTokens, 20000);
  } catch (e) {
    return await groqRequest(env, GROQ_FALLBACK_MODEL, messages, temperature, maxTokens, 12000);
  }
}

async function groqRequest(env, model, messages, temperature, maxTokens, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.GROQ_KEY,
      },
      body: JSON.stringify({
        model,
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

// ── Rate limiting (abuse protection, cousin's security feedback) ──────────────
// In-memory per-isolate counter: not perfectly global, but stops bursts and
// script abuse without paid infrastructure. AI endpoints are the expensive ones.
const rateBuckets = new Map();
const RATE_LIMIT = 20;        // max AI requests...
const RATE_WINDOW = 60000;    // ...per minute per IP

function rateLimited(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now - b.start > RATE_WINDOW) {
    rateBuckets.set(ip, { start: now, count: 1 });
    if (rateBuckets.size > 5000) rateBuckets.clear(); // memory guard
    return false;
  }
  b.count++;
  return b.count > RATE_LIMIT;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    // Expensive AI endpoints are rate-limited per IP
    if ((url.pathname === '/analyze' || url.pathname === '/chat') && rateLimited(request)) {
      return json({ error: 'Too many requests — please slow down / забагато запитів, зачекай хвилину' }, 429);
    }

    try {
      if (url.pathname === '/test' && request.method === 'GET') {
        return json({ ok: true, time: Date.now(), model: GROQ_MODEL });
      }
      // Edge cache for hot GET endpoints: every client sees the SAME price
      // within a 20s window (consistency) and repeat hits answer in ~50ms
      // straight from Cloudflare's edge instead of round-tripping to Finnhub.
      if ((url.pathname === '/price' || url.pathname === '/market') && request.method === 'GET') {
        const cache = caches.default;
        const cacheKey = new Request(url.toString());
        const hit = await cache.match(cacheKey);
        if (hit) return hit;
        const res = url.pathname === '/price'
          ? await handlePrice(request, env)
          : await handleMarket(env);
        if (res.status === 200) {
          const cacheable = new Response(res.body, res);
          cacheable.headers.set('Cache-Control', 'public, max-age=20');
          ctx.waitUntil(cache.put(cacheKey, cacheable.clone()));
          return cacheable;
        }
        return res;
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
      if (url.pathname === '/fx' && request.method === 'GET') {
        return await handleFx(request);
      }
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};

// ── Shared helpers ────────────────────────────────────────────────────────────

// fetch with a hard timeout — a hung upstream API must not eat the 25s budget
// (claude-helper audit finding #1)
async function fetchT(url, opts = {}, ms = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Parses ?ticker= from URL, normalizes crypto names. Returns null if missing.
function parseTicker(request) {
  const raw = (new URL(request.url).searchParams.get('ticker') || '').toUpperCase();
  if (!raw) return null;
  const t = CRYPTO_NAMES[raw] || raw;
  return { t, isCrypto: !!CRYPTO_MAP[t] };
}

// Fetches a Finnhub quote, returns parsed JSON or null on error/timeout
async function finnhubQuote(env, sym) {
  try {
    const res = await fetchT(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${env.FINNHUB_KEY}`
    );
    if (!res.ok) return null; // 429/5xx: don't try to parse HTML error pages
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
    fetchT(`https://finnhub.io/api/v1/stock/profile2?symbol=${t}&token=${env.FINNHUB_KEY}`)
      .then(r => r.ok ? r.json() : null).catch(() => null),
    fetchT(`https://finnhub.io/api/v1/company-news?symbol=${t}&from=${getDateDaysAgo(7)}&to=${getToday()}&token=${env.FINNHUB_KEY}`)
      .then(r => r.ok ? r.json() : []).catch(() => []),
  ]);

  const parts = [];
  if (profile && profile.name) {
    // Guard: free-tier Finnhub may return cap as string/null — only format real numbers
    const cap = Number(profile.marketCapitalization);
    parts.push(
      `${t} company profile: ${profile.name}, country of registration=${profile.country || 'N/A'}, ` +
      `industry=${profile.finnhubIndustry || 'N/A'}, ` +
      `market cap=${cap > 0 ? '$' + (cap / 1000).toFixed(1) + 'B' : 'N/A'}, ` +
      `IPO=${profile.ipo || 'N/A'}, website=${profile.weburl || 'N/A'}.`
    );
    // Wikipedia intro — covers history and what the company is known for.
    // Try the full profile name first ("Apple Inc"), fall back to the stripped one.
    try {
      const stripped = profile.name.replace(/[,.]?\s+(Inc|Corp|Corporation|Ltd|PLC|Co|Class [A-C])\.?$/i, '').trim();
      for (const title of [...new Set([profile.name, stripped])]) {
        const w = await fetchT(
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

// Company-name → ticker via Yahoo's symbol registry: "ferrari" → RACE,
// "servicenow" → NOW. Noise queries return empty — safe to call with raw text.
// Hybrid resolver (team vote, fixes "intell"→BOTZ): exact/prefix match gives
// a confident symbol; otherwise return top candidates so the caller can ask
// "did you mean…?" instead of silently picking a substring match.
async function resolveTickerByName(text) {
  try {
    const r = await fetch(
      'https://query1.finance.yahoo.com/v1/finance/search?q=' +
      encodeURIComponent(text.slice(0, 80)) + '&quotesCount=3&newsCount=0',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const d = await r.json();
    const quotes = (d.quotes || []).filter(q =>
      q.symbol && (q.score || 0) > 10000 && !q.symbol.includes('.'));
    if (!quotes.length) return null;
    const Q = text.trim().toUpperCase();
    const starts = s => (s || '').toUpperCase().startsWith(Q);
    const hit = quotes.find(q =>
      q.symbol.toUpperCase() === Q || starts(q.longname) || starts(q.shortname));
    if (hit) return { sym: hit.symbol };
    return { candidates: quotes.map(q => q.symbol + ' (' + (q.longname || q.shortname || '?') + ')') };
  } catch { /* registry is optional — detection just stays empty */ }
  return null;
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
    const res  = await fetchT(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (!res.ok) return null;
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
async function handleAnalyze(request, env, _retried) {
  const { ticker, lang } = await request.json();
  if (!ticker) return json({ error: 'Missing ticker' }, 400);

  let raw = ticker.toUpperCase().trim();
  // Company NAME in the search box? ("INTEL", "FERRARI", "интел") —
  // resolve via Yahoo's registry so users can find any firm (tester request).
  // One cheap quote probe decides: real ticker -> proceed; otherwise ask the
  // registry ONCE before the expensive pipeline (no double Groq runs).
  // Known crypto NEVER goes to the registry — a flaky Finnhub probe must not
  // turn BTC into "Did you mean BTC-USD?" (regression caught by Pylyp)
  if (!CRYPTO_MAP[CRYPTO_NAMES[raw] || raw]) {
    const probe = await finnhubQuote(env, CRYPTO_NAMES[raw] || raw);
    if (!probe || !probe.c || probe.c === 0) {
      const resolved = await resolveTickerByName(raw);
      if (resolved && resolved.sym && /^[A-Z0-9.\-:/]{1,15}$/.test(resolved.sym.toUpperCase())) {
        raw = resolved.sym.toUpperCase();
      } else if (resolved && resolved.candidates) {
        return json({ error: (lang === 'ua' ? 'Можливо, ви мали на увазі: ' : 'Did you mean: ') +
          resolved.candidates.join(', ') + '?' }, 404);
      }
    }
  }
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

  // .catch: Finnhub 429s return HTML pages — treat as empty, never crash
  // Promise.resolve: crypto path uses stub objects whose json() is synchronous
  const safeJson = (r, fb) => r.status === 'fulfilled'
    ? Promise.resolve(r.value.json()).catch(() => fb)
    : fb;
  let quote     = await safeJson(quoteRes, {});
  const profile = await safeJson(profileRes, {});
  const newsRaw = await safeJson(newsRes, []);
  const metrics = await safeJson(metricsRes, {});

  // Unknown ticker guard: no price AND no profile = the symbol does not
  // exist — refuse instead of letting the AI invent a company (test finding).
  // Last chance: maybe it's a company NAME ("INTEL") — ask the registry once.
  if ((!quote.c || quote.c === 0) && !profile.name) {
    // Last chance before refusing: getLivePrice has the Yahoo fallback —
    // saves crypto and rate-limited moments (BTC regression, caught by Pylyp)
    const lp = await getLivePrice(env, t);
    if (lp && lp.c > 0) {
      quote = { c: lp.c, pc: lp.pc, dp: pctChange(lp.c, lp.pc) };
    } else {
      return json({ error: 'Unknown ticker: ' + t + '. Check the symbol / Невідомий тікер.' }, 404);
    }
  }

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
    _ticker: t, // resolved symbol — client may have typed a company name
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
  'HE','SHE','ME','MY','WHO','HOW','WHY','ITS','HIM','AM','PM','OK',
  // Common chat words that look like tickers
  'INFO','TELL','SHOW','GIVE','HELP','DOES','MEAN','NEED','FIND','BEST','NEXT',
  'SELL','HIGH','DOWN','FALL','RISE','GAIN','LOSS','LOST','LAST','PAST','REAL',
  'LIVE','DATA','NEWS','SURE','OKAY','CHAT','LONG','HOLD','NICE','SAFE',
  // Greetings & chat words that collide with real tickers (HI = Hillenbrand!)
  'HI','HEY','OK','YES','YEAH','THX','LOL','PLS','BYE','HMM',
  // Generic finance nouns that are also tickers (FIRM, EV, CEO...)
  'FIRM','EV','CEO','IPO','ETF','USD','EUR','API',
  'RISK','RATE','PLAN','OPEN','STOP','KEEP','CASH','IDEA','ONES','BOTH',
  'ABOVE','BELOW','ABOUT','AFTER','AGAIN','PRICE','STOCK','SHARE','TRADE','WORTH',
  'TODAY','SINCE','THINK','FEELS','LOOKS','MAYBE','RIGHT','WRONG','STILL','OTHER',
]);

async function handleChat(request, env) {
  const { messages, context, lang, currency: userCurrency, fxRate: userFxRate } = await request.json();
  if (!messages || !messages.length) return json({ error: 'No messages' }, 400);

  // Server-side limit — client enforces 40 but direct POST calls bypass it
  const safeMessages = messages.slice(-40);

  const ua = lang === 'ua';

  // Ticker priority (quality redesign after the "tell me firm info" bug):
  //   1. explicit tickers in the LAST message
  //   2. company name via registry (last message only)
  //   3. tickers from earlier conversation (follow-up safety net)
  // A non-resolving word ("firm") must never block the conversation context.
  let candidateNote = '';
  const lastMsg = safeMessages[safeMessages.length - 1]?.content || '';
  const upperLast = lastMsg.toUpperCase();
  const upperConv = safeMessages.slice(-4, -1).map(m => m.content || '').join(' ').toUpperCase();

  const tickersIn = (text) => {
    const raw = text.match(/\b[A-Z]{2,5}\b/g) || [];
    // Word boundaries so "METAL" doesn't trigger META, "PINEAPPLE" doesn't trigger APPLE
    const named = [...Object.entries(NAME_TO_TICKER), ...Object.entries(CRYPTO_NAMES)]
      .filter(([name]) => new RegExp('\\b' + name + '\\b').test(text))
      .map(([, t]) => t);
    return raw.filter(t => !SKIP_WORDS.has(t)).concat(named);
  };

  const lastTickers = tickersIn(upperLast);
  const convTickers = tickersIn(upperConv);

  // Registry lookup when the last message names no ticker directly
  if (lastTickers.length === 0) {
    const substance = upperLast
      .replace(/[^A-ZА-ЯІЇЄҐ0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !SKIP_WORDS.has(w))
      .slice(0, 4)
      .join(' ');
    if (substance) {
      const resolved = await resolveTickerByName(substance);
      if (resolved && resolved.sym) lastTickers.push(resolved.sym.toUpperCase());
      else if (resolved && resolved.candidates && convTickers.length === 0) candidateNote =
        'The query did not match a ticker exactly. Possible matches: ' +
        resolved.candidates.join(', ') +
        '. Ask the user which one they meant — do NOT silently pick one.';
    }
  }

  // Conversation tickers are the safety net, never the blocker
  const potentialTickers = [...new Set(lastTickers.concat(convTickers))].slice(0, 3);

  let liveData = '';
  let companyInfo = '';
  if (potentialTickers.length > 0) {
    // Prices and deep company info run in PARALLEL (saves ~0.5-1s per message);
    // deep info goes for the first detected ticker
    const results = await Promise.all(
      potentialTickers.map(async t => ({ ticker: t, d: await getLivePrice(env, t) })));
    // Deep info follows the first ticker WITH a live price — "firm" (no price)
    // must not steal it from the Intel being discussed
    const primary = results.find(r => r.d && r.d.c > 0);
    const info = primary ? await fetchCompanyInfo(env, primary.ticker) : '';
    const quotes = results
      .filter(r => r.d && r.d.c > 0)
      .map(r => {
        const pct = pctChange(r.d.c, r.d.pc).toFixed(2);
        return `${r.ticker}: $${r.d.c} (${Number(pct) > 0 ? '+' : ''}${pct}% today)`;
      });
    if (quotes.length > 0) liveData = 'Live market data: ' + quotes.join('; ') + '.';
    companyInfo = info;
  }

  const system = [
    'You are a helpful stock market and finance assistant with access to live market data.',
    `Today is ${getToday()}.`,
    'CRITICAL RULE: If live market data or analysis context below contains a price for a ticker, that ticker IS valid and currently trading. Do NOT say a ticker is invalid, delisted, or non-existent if data was provided for it. Your training data is outdated — companies get relisted, renamed, or split. Always trust live data over training knowledge.',
    'Never contradict live data with training knowledge. NEVER give specific prices, percentages, or market cap figures from your training data — those are outdated and wrong. Only state prices that appear in the live data or context provided. If you do not have live data for a ticker, say you do not have current price info rather than guessing.',
    context ? `Current stock analysis context (treat as ground truth): ${context}` : '',
    liveData,
    companyInfo,
    candidateNote,
    companyInfo ? 'Use the company profile, Wikipedia background, and news headlines above to answer questions about the company (founders, history, country, what is happening now). For FAMOUS companies (Apple, Microsoft, Tesla tier) you may state founders and founding year from general knowledge. For small, recent, or little-known companies: if the founder/person is NOT named in the provided data, say plainly that this information is not in your data — NEVER invent names, biographies, or education details. A made-up person is the worst possible answer. Never guess prices, market caps, or financial figures — those only from live data above.' : '',
    'IMPORTANT: You DO have internet-sourced data — live prices, recent news, and company profiles are fetched for you and provided above. Never tell the user you cannot search the internet or have no access to current information. If asked to "search", answer using the live data and news provided above.',
    (userCurrency && userCurrency !== 'USD' && userFxRate > 0)
      ? `The user's display currency is ${userCurrency} (1 USD = ${userFxRate} ${userCurrency}). When stating prices, give USD first and add the approximate ${userCurrency} value in parentheses.`
      : '',
    ua ? 'IMPORTANT: Respond ONLY in Ukrainian language. Never use Chinese, Japanese, Arabic or any other non-Latin/Cyrillic characters. If you catch yourself writing non-Ukrainian text, stop and rewrite in Ukrainian.' : 'Respond in English only.',
    'STYLE RULES: Be dense and specific. Every sentence must contain a concrete fact (number, date, event, name) or a direct answer. FORBIDDEN: filler and obvious generalities like "prices can change over time", "one of the largest companies in the world", "many factors influence the price", "it is worth noting". Never repeat the same idea twice. Default length 3-6 short sentences; go longer only if the user asks for detail.',
    'News headlines may mention several companies — attribute each fact to the correct company, never mix them up.',
    'Treat a word as a stock ticker ONLY if live data for it is provided above, or the user wrote it in CAPITALS (TSLA, NOW). Lowercase common words ("now", "all", "key", "open") are ordinary English words — never reinterpret them as tickers.',
    'Generic references — "the firm", "the company", "it", "фірма", "компанія" — and ambiguous follow-ups ("what about now?", "tell me firm info", "а зараз?") always mean the most recently discussed company. NEVER reply "I do not have info" when live data for the discussed ticker is right above — use it. For price follow-ups give 2-3 sentences: the price and day change, plus one extra concrete detail from the data above (recent news driver, market cap, or how it compares to the day).',
    'Use plain text only — no markdown, no asterisks. If you need a list, start each line with "- " (dash and space). Use line breaks between paragraphs.',
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

// ── /fx?to=UAH — USD → currency rate ──────────────────────────────────────────
// Chain (claude-helper design): Yahoo "UAH=X" → NBU API (for UAH) → static emergency rates
const FX_STATIC = {
  UAH: 41.5, EUR: 0.92, CAD: 1.36, GBP: 0.79, PLN: 4.0, JPY: 150, CHF: 0.88,
  AUD: 1.5, CZK: 23, SEK: 10.5, NOK: 10.7, DKK: 6.9, TRY: 34, INR: 84,
  CNY: 7.2, BRL: 5.6, MXN: 18, KRW: 1380, ILS: 3.7, AED: 3.67,
};

async function handleFx(request) {
  const to = (new URL(request.url).searchParams.get('to') || '').toUpperCase();
  if (!to) return json({ error: 'Missing to' }, 400);
  if (to === 'USD') return json({ rate: 1, source: 'fixed' });
  if (!/^[A-Z]{3}$/.test(to)) return json({ error: 'Unsupported currency' }, 400);

  const q = await yahooQuote(to + '=X'); // Yahoo: "UAH=X" is USD→UAH
  if (q && q.c > 0) return json({ rate: q.c, source: 'yahoo' });

  if (to === 'UAH') {
    try {
      const r = await fetchT('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json');
      const d = r.ok ? await r.json() : null;
      if (Array.isArray(d) && d[0] && d[0].rate > 0) return json({ rate: d[0].rate, source: 'nbu' });
    } catch { /* NBU is optional — fall through */ }
  }
  // Free open API as the live fallback for any currency (claude-helper audit finding #4)
  try {
    const r = await fetchT('https://open.er-api.com/v6/latest/USD');
    const d = r.ok ? await r.json() : null;
    const rate = d && d.rates && d.rates[to];
    if (rate > 0) return json({ rate, source: 'er-api' });
  } catch { /* fall through to static */ }
  if (to in FX_STATIC) return json({ rate: FX_STATIC[to], source: 'static' });
  return json({ error: 'Rate unavailable' }, 502);
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
