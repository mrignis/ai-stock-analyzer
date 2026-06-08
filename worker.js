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
  const res = await fetch(GROQ_URL, {
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
  });
  const data = await res.json();
  if (data.error) throw new Error('Groq: ' + data.error.message);
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
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};

// ── /market ───────────────────────────────────────────────────────────────────
async function handleMarket(env) {
  const symbols = [
    { key: 'SP500', sym: 'SPY',              label: 'S&P 500' },
    { key: 'NASDAQ',sym: 'QQQ',              label: 'NASDAQ'  },
    { key: 'BTC',   sym: 'BINANCE:BTCUSDT',  label: 'Bitcoin' },
    { key: 'GOLD',  sym: 'GLD',               label: 'Gold'    },
  ];
  const results = await Promise.allSettled(
    symbols.map(s =>
      fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s.sym)}&token=${env.FINNHUB_KEY}`)
        .then(r => r.json())
        .then(d => ({ ...s, c: d.c, pc: d.pc }))
    )
  );
  const data = {};
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value.c > 0) {
      const { key, label, c, pc } = r.value;
      data[key] = { label, c, pc, pct: ((c - pc) / pc * 100) };
    }
  });
  return json(data);
}

// ── /price?ticker=TSLA ────────────────────────────────────────────────────────
async function handlePrice(request, env) {
  const url = new URL(request.url);
  const raw = (url.searchParams.get('ticker') || '').toUpperCase();
  if (!raw) return json({ error: 'Missing ticker' }, 400);
  const ticker = CRYPTO_NAMES[raw] || raw;
  const sym = CRYPTO_MAP[ticker] || ticker;
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${env.FINNHUB_KEY}`
  );
  const data = await res.json();
  return json(data);
}

// ── /analyze ──────────────────────────────────────────────────────────────────
async function handleAnalyze(request, env) {
  const { ticker, lang } = await request.json();
  if (!ticker) return json({ error: 'Missing ticker' }, 400);

  const raw = ticker.toUpperCase();
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

${ua ? 'Respond ENTIRELY in Ukrainian language.' : 'Respond in English.'}
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
  return json({ ...analysis, _quote: quote });
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
]);

async function handleChat(request, env) {
  const { messages, context, lang } = await request.json();
  if (!messages || !messages.length) return json({ error: 'No messages' }, 400);

  const ua = lang === 'ua';

  // Detect tickers and fetch live prices
  const lastMsg = messages[messages.length - 1]?.content || '';
  const rawTokens = lastMsg.toUpperCase().match(/\b[A-Z]{2,5}\b/g) || [];
  const potentialTickers = [...new Set(rawTokens.filter(t => !SKIP_WORDS.has(t)))].slice(0, 3);

  let liveData = '';
  if (potentialTickers.length > 0) {
    const results = await Promise.allSettled(
      potentialTickers.map(t =>
        fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${env.FINNHUB_KEY}`)
          .then(r => r.json())
          .then(d => ({ ticker: t, d }))
      )
    );
    const quotes = results
      .filter(r => r.status === 'fulfilled' && r.value.d.c > 0)
      .map(r => {
        const { ticker, d } = r.value;
        const pct = ((d.c - d.pc) / d.pc * 100).toFixed(2);
        return `${ticker}: $${d.c} (${pct > 0 ? '+' : ''}${pct}% today)`;
      });
    if (quotes.length > 0) liveData = 'Live market data: ' + quotes.join('; ') + '.';
  }

  const system = [
    'You are a helpful stock market and finance assistant with access to live market data.',
    `Today is ${getToday()}.`,
    'Your training data has a cutoff — always prioritize the live market data provided below over your training knowledge. Never give prices or news from your training as if they are current.',
    context ? `Current analysis context: ${context}` : '',
    liveData,
    ua ? 'Always respond in Ukrainian language.' : 'Respond in English.',
    'Be concise, factual, and helpful. Use plain text only — no markdown, no asterisks, no bullet symbols. Use line breaks between paragraphs.',
  ].filter(Boolean).join(' ');

  const groqMessages = [
    { role: 'system', content: system },
    ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
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
