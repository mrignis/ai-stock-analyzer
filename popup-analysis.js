'use strict';

// ── Analysis & Render ──────────────────────────────────────────────────────────
// Extracted from popup.js (multi-script split). Shares the global scope; loaded
// before popup.js. Deps (runtime): WORKER_URL, lang, currentTicker, currentData,
// fxRate, watchlist (popup.js); cacheGet/cacheSet, fmtMoney, formatPrice,
// formatChange, pillClass, loadLivePrice (core.js); renderChart (popup-charts.js);
// addToHistory (popup.js). Callers are runtime.

// ── Analysis ──────────────────────────────────────────────────────────────────
var currentAbort = null;

function stopAnalysis() {
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
  currentTicker = ''; currentData = null;
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('empty-state').style.display = 'block';
  document.getElementById('price-box').style.display = 'none';
  document.getElementById('result').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'block';
}

function runAnalysis() {
  var raw = document.getElementById('ticker-input').value.trim().toUpperCase();
  if (!raw) return;
  if (currentAbort) { currentAbort.abort(); }
  currentAbort = new AbortController();
  currentTicker = raw; currentData = null;

  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('result').style.display = 'none';
  document.getElementById('price-box').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'block';

  // Cache key includes lang — UA and EN results cached separately
  var cacheKey = 'analyze_' + raw + '_' + lang;

  // Check cache first — show result instantly if available
  cacheGet(cacheKey, CACHE_ANALYZE_TTL, function(cached) {
    if (currentTicker !== raw) return; // a newer analysis started — drop stale callback
    // A cached analysis without a live price is a broken artifact (e.g. the
    // pre-registry fabrications) — ignore it and fetch fresh instead
    if (cached && (!cached._quote || !cached._quote.c)) cached = null;
    if (cached) {
      document.getElementById('loading-state').style.display = 'none';
      // Show cached price immediately (instant UX — stale-while-revalidate)
      if (cached._quote && cached._quote.c > 0) renderPrice(cached._quote);
      // Also fetch fresh price in background — updates price box silently when ready
      fetchFreshPrice(raw, cached);
      finish(raw, normalizeAI(cached));
      return;
    }

    // No cache — show loading skeleton and fetch
    document.getElementById('loading-state').style.display = 'block';
    document.getElementById('loading-msg').textContent = (lang === 'ua' ? 'Аналізую ' : 'Analyzing ') + raw + '...';

    // Price arrives in ~0.3s — show it immediately while the AI (3-5s)
    // is still thinking, so the screen is never "all skeleton"
    fetchFreshPrice(raw, null);

    var signal = currentAbort.signal;
    // Auto-abort after 65s: the AI engine (Groq Llama 3.3) can queue under load
    // at peak hours — better to wait than to drop a near-ready result
    var timeoutId = setTimeout(function() {
      if (currentAbort) { currentAbort.abort(); currentAbort = null; }
    }, 65000);
    // Tell the user it's the AI queue, not a hang
    setTimeout(function() {
      var msgEl = document.getElementById('loading-msg');
      if (msgEl && document.getElementById('loading-state').style.display !== 'none') {
        msgEl.textContent = lang === 'ua'
          ? 'AI перевантажений, ще секунд 20-30...'
          : 'AI is busy, ~20-30 more seconds...';
      }
    }, 15000);
    fetch(WORKER_URL + '/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker: raw, lang: lang }),
      signal: signal,
    })
      .then(function(r) { return r.text(); })
      .then(function(txt) {
        // Cloudflare returns an HTML error page when the worker crashes or
        // times out — show a human message instead of a JSON parse error
        try { return JSON.parse(txt); }
        catch (_) {
          throw new Error(lang === 'ua'
            ? 'Сервер тимчасово недоступний. Спробуй ще раз за хвилину.'
            : 'Server temporarily unavailable. Try again in a minute.');
        }
      })
      .then(function(data) {
        clearTimeout(timeoutId);
        if (currentTicker !== raw) return; // stale response — user already analyzes another ticker
        if (data.error) throw new Error('Worker: ' + data.error + (data.raw ? ' | ' + data.raw.slice(0, 100) : ''));
        cacheSet(cacheKey, data); // Save to cache (includes lang)
        // The server may resolve a typed NAME to a real symbol (SIXT -> TSLX):
        // use the resolved ticker for the price and the header, or the price
        // lookup misses and the box stays empty
        var realT = data._ticker || raw;
        currentTicker = realT;
        // Always refetch a live /price here. The /analyze blob may be served from
        // the worker's 30-min edge cache, so its _quote can be up to 30 min stale —
        // seeding the price cache from it would show a stale price. _quote still
        // rides along as fetchFreshPrice's fallback if the live /price call fails.
        fetchFreshPrice(realT, data);
        finish(realT, normalizeAI(data));
      })
      .catch(function(e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
          showError(lang === 'ua' ? 'Час очікування вийшов. Спробуй ще раз.' : 'Request timed out. Please try again.');
          return;
        }
        var msg = e.message || '';
        var retryMatch = msg.match(/retry in ([\d.]+)s/i);
        if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('exhausted') || msg.toLowerCase().includes('rate')) {
          var sec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
          msg = lang === 'ua'
            ? '⏳ Перевищено ліміт. Спробуй через ' + sec + ' сек.'
            : '⏳ Rate limit. Try again in ' + sec + ' sec.';
        }
        showError(msg || (lang === 'ua' ? 'Помилка з\'єднання' : 'Connection error'));
      });
  });
}

function fetchFreshPrice(raw, fallbackData) {
  loadLivePrice(raw, function(d) {
    if (currentTicker !== raw) return; // late callback after Stop or a newer analysis
    if (d && d.c && d.c > 0) {
      renderPrice(d);
    } else if (fallbackData && fallbackData._quote && fallbackData._quote.c) {
      renderPrice(fallbackData._quote);
    }
  });
}


function renderPrice(q) {
  if (!q || !q.c) return;
  var change = q.pc > 0 ? q.c - q.pc : 0;
  var pct    = q.pc > 0 ? (change / q.pc) * 100 : 0;
  showPrice({
    price: formatPrice(q.c * fxRate),
    change: (change >= 0 ? '+' : '') + formatChange(change * fxRate),
    pct: (pct >= 0 ? '+' : '') + pct.toFixed(2),
    currency: currency,
  });
}

function showPrice(info) {
  var el = document.getElementById('price-box');
  if (!info) { el.style.display = 'none'; return; }
  var up = parseFloat(info.change) >= 0;
  var c = up ? 'var(--green)' : 'var(--red)';
  var a = up ? '▲' : '▼';
  el.style.display = 'flex';
  el.innerHTML =
    '<span style="font-size:20px;font-weight:600;font-family:var(--mono);color:var(--text)">' + info.currency + ' ' + info.price + '</span>' +
    '<span style="font-size:12px;font-family:var(--mono);color:' + c + ';margin-left:10px">' + a + ' ' + info.change + ' (' + info.pct + '%)</span>' +
    '<span style="font-size:9px;color:var(--dim);font-family:var(--mono);margin-left:auto">Finnhub</span>';
}


function normalizeAI(j) {
  return {
    sector: j.sector || '',
    risk: j.risk || '',
    trend: j.trend || '',
    forWho: j.forWho || '',
    what: j.what || '',
    risks: j.risks || '',
    forecast: j.forecast || '',
    conclusion: j.conclusion || '',
    verdict: normalizeVerdict(j.verdict || '', lang),
    color: j.color || 'blue',
    dir: j.dir || j.trend_dir || 'flat',
  };
}

function normalizeVerdict(verdict, lang) {
  if (!verdict) return verdict;
  var v = verdict.toLowerCase().trim();
  var map = {
    'buy': { ua: 'Купувати', en: 'Buy' },
    'sell': { ua: 'Продавати', en: 'Sell' },
    'hold': { ua: 'Тримати', en: 'Hold' },
    'stable': { ua: 'Стабільно', en: 'Stable' },
    'risky': { ua: 'Ризиковано', en: 'Risky' },
    'promising': { ua: 'Перспективно', en: 'Promising' },
    'caution': { ua: 'Обережно', en: 'Caution' },
    'cautious': { ua: 'Обережно', en: 'Caution' },
    'situational': { ua: 'Ситуаційно', en: 'Situational' },
    'avoid': { ua: 'Уникати', en: 'Avoid' },
    'strong buy': { ua: 'Активно купувати', en: 'Strong Buy' },
    'bullish': { ua: 'Перспективно', en: 'Promising' },
    'bearish': { ua: 'Ризиковано', en: 'Risky' },
    'neutral': { ua: 'Нейтрально', en: 'Neutral' },
    'купувати': { ua: 'Купувати', en: 'Buy' },
    'купити': { ua: 'Купувати', en: 'Buy' },
    'продавати': { ua: 'Продавати', en: 'Sell' },
    'тримати': { ua: 'Тримати', en: 'Hold' },
    'стабільно': { ua: 'Стабільно', en: 'Stable' },
    'ризиковано': { ua: 'Ризиковано', en: 'Risky' },
    'перспективно': { ua: 'Перспективно', en: 'Promising' },
    'обережно': { ua: 'Обережно', en: 'Caution' },
    'ситуаційно': { ua: 'Ситуаційно', en: 'Situational' },
    'уникати': { ua: 'Уникати', en: 'Avoid' },
    'нейтрально': { ua: 'Нейтрально', en: 'Neutral' },
    'negative': { ua: 'Негативний', en: 'Negative' },
    'негативний': { ua: 'Негативний', en: 'Negative' },
    'positive': { ua: 'Позитивний', en: 'Positive' },
    'позитивний': { ua: 'Позитивний', en: 'Positive' },
    'growth': { ua: 'Зростання', en: 'Growth' },
    'зростання': { ua: 'Зростання', en: 'Growth' },
    'decline': { ua: 'Спад', en: 'Decline' },
    'спад': { ua: 'Спад', en: 'Decline' },
  };
  var found = map[v];
  if (found) return found[lang] || found.en;
  return verdict.charAt(0).toUpperCase() + verdict.slice(1);
}

function normalizeSector(sector, lang) {
  if (!sector) return sector;
  var map = {
    // English keys
    'technology': { ua: 'Технології', en: 'Technology' },
    'semiconductors': { ua: 'Напівпровідники', en: 'Semiconductors' },
    'automotive': { ua: 'Автомобілі', en: 'Automotive' },
    'automobiles': { ua: 'Автомобілі', en: 'Automotive' },
    'auto / energy': { ua: 'Авто / Енергетика', en: 'Auto / Energy' },
    'social media / ai': { ua: 'Соц. мережі / AI', en: 'Social Media / AI' },
    'e-commerce / cloud': { ua: 'E-commerce / Cloud', en: 'E-commerce / Cloud' },
    'consumer goods': { ua: 'Споживчі товари', en: 'Consumer Goods' },
    'consumer discretionary': { ua: 'Споживчі товари', en: 'Consumer Discretionary' },
    'healthcare': { ua: 'Охорона здоровя', en: 'Healthcare' },
    'financials': { ua: 'Фінанси', en: 'Financials' },
    'finance': { ua: 'Фінанси', en: 'Finance' },
    'information technology': { ua: 'Інф. технології', en: 'Information Technology' },
    'communication services': { ua: 'Комунікації', en: 'Communication Services' },
    'energy': { ua: 'Енергетика', en: 'Energy' },
    'utilities': { ua: 'Комунальні', en: 'Utilities' },
    'real estate': { ua: 'Нерухомість', en: 'Real Estate' },
    'materials': { ua: 'Матеріали', en: 'Materials' },
    'industrials': { ua: 'Промисловість', en: 'Industrials' },
    'defense': { ua: 'Оборонна пром.', en: 'Defense' },
    'biotech': { ua: 'Біотехнології', en: 'Biotech' },
    'biotechnology': { ua: 'Біотехнології', en: 'Biotechnology' },
    'pharmaceuticals': { ua: 'Фармацевтика', en: 'Pharmaceuticals' },
    'cloud computing': { ua: 'Хмарні обч.', en: 'Cloud Computing' },
    'artificial intelligence': { ua: 'Штучний інтелект', en: 'Artificial Intelligence' },
    'quantum computing': { ua: 'Квантові обч.', en: 'Quantum Computing' },
    'food & beverage': { ua: 'Їжа і напої', en: 'Food & Beverage' },
    'retail': { ua: 'Роздрібна торг.', en: 'Retail' },
    'media': { ua: 'Медіа', en: 'Media' },
    'streaming': { ua: 'Стрімінг', en: 'Streaming' },
    // Ukrainian keys
    'технології': { ua: 'Технології', en: 'Technology' },
    'напівпровідники': { ua: 'Напівпровідники', en: 'Semiconductors' },
    'автомобілі': { ua: 'Автомобілі', en: 'Automotive' },
    'автомобільна промисловість': { ua: 'Автомобілі', en: 'Automotive' },
    'авто / енергетика': { ua: 'Авто / Енергетика', en: 'Auto / Energy' },
    'соц. мережі / ai': { ua: 'Соц. мережі / AI', en: 'Social Media / AI' },
    'споживчі товари': { ua: 'Споживчі товари', en: 'Consumer Goods' },
    'охорона здоровя': { ua: 'Охорона здоровя', en: 'Healthcare' },
    'фінанси': { ua: 'Фінанси', en: 'Finance' },
    'інф. технології': { ua: 'Інф. технології', en: 'Information Technology' },
    'комунікації': { ua: 'Комунікації', en: 'Communication Services' },
    'енергетика': { ua: 'Енергетика', en: 'Energy' },
    'комунальні': { ua: 'Комунальні', en: 'Utilities' },
    'нерухомість': { ua: 'Нерухомість', en: 'Real Estate' },
    'матеріали': { ua: 'Матеріали', en: 'Materials' },
    'промисловість': { ua: 'Промисловість', en: 'Industrials' },
    'оборонна пром.': { ua: 'Оборонна пром.', en: 'Defense' },
    'біотехнології': { ua: 'Біотехнології', en: 'Biotechnology' },
    'фармацевтика': { ua: 'Фармацевтика', en: 'Pharmaceuticals' },
    'хмарні обч.': { ua: 'Хмарні обч.', en: 'Cloud Computing' },
    'штучний інтелект': { ua: 'Штучний інтелект', en: 'Artificial Intelligence' },
    'продукти харчування': { ua: 'Продукти харчування', en: 'Food & Beverage' },
    'роздрібна торг.': { ua: 'Роздрібна торг.', en: 'Retail' },
    'медіа': { ua: 'Медіа', en: 'Media' },
    'стрімінг': { ua: 'Стрімінг', en: 'Streaming' },
  };
  var found = map[sector.toLowerCase()];
  if (found) return found[lang] || found.en;
  return sector;
}

function finish(ticker, data) {
  currentAbort = null;
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'block';
  currentData = data;
  addHistory(ticker, data);
  renderResult(ticker, data);
  fetchRealChart(ticker, data.color);
}

function showError(msg) {
  currentAbort = null;
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'block';
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('empty-state').style.display = 'block';
  // Show inline error (empty-text was removed in redesign)
  var errEl = document.getElementById('inline-error');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.id = 'inline-error';
    errEl.style.cssText = 'background:var(--red-dim);border:1px solid rgba(248,113,113,0.3);border-radius:8px;padding:8px 12px;margin-bottom:10px;font-family:var(--mono);font-size:11px;color:var(--red)';
    var emptyState = document.getElementById('empty-state');
    emptyState.insertBefore(errEl, emptyState.firstChild);
  }
  errEl.textContent = '⚠ ' + msg;
  errEl.style.display = 'block';
  setTimeout(function() { if (errEl) errEl.style.display = 'none'; }, 6000);
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderResult(ticker, d) {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('result').style.display = 'block';
  document.getElementById('r-ticker').textContent = ticker;
  document.getElementById('r-sector').textContent = normalizeSector(d.sector, lang);
  document.getElementById('r-risk').textContent = d.risk;
  document.getElementById('r-trend').textContent = d.trend;
  document.getElementById('r-for').textContent = d.forWho;
  document.getElementById('r-what').textContent = d.what;
  document.getElementById('r-risks').textContent = d.risks;
  document.getElementById('r-forecast').textContent = d.forecast;
  document.getElementById('r-conclusion').textContent = d.conclusion;
  var vEl = document.getElementById('r-verdict');
  vEl.textContent = d.verdict; vEl.className = 'verdict-pill ' + pillClass(d.color);
  var sMap = {
    green:  'background:var(--green-dim);border:1px solid var(--green-border);color:var(--green)',
    yellow: 'background:var(--yellow-dim);border:1px solid var(--yellow-border);color:var(--yellow)',
    red:    'background:var(--red-dim);border:1px solid var(--red-border);color:var(--red)',
    blue:   'background:var(--blue-dim);border:1px solid var(--blue-border);color:var(--blue)',
  };
  var colorStyle = sMap[d.color] || sMap.blue;
  document.getElementById('r-conclusion-box').style.cssText = colorStyle;
  // Forecast block also matches verdict color (was hardcoded green before)
  document.getElementById('r-forecast-box').style.cssText = colorStyle;
  drawChartSimulated(d.dir, d.color); // placeholder until real candle data loads
  updateWatchBtn();
}

// Chart functions (drawChartLine, fetchRealChart, drawChartFromPrices,
// drawChartSimulated, drawSpark, CHART_COLORS) live in popup-charts.js,
// loaded before this file — they share the global scope.

