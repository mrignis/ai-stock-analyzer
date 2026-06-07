'use strict';

// ── Replace with your Cloudflare Worker URL after deployment ─────────────────
var WORKER_URL = 'https://stock-ai-analyzer.chelb-dev.workers.dev';

var lang = 'ua';
var currentTicker = '';
var currentData = null;
var watchlist = [];
var historyList = [];

// Chat state
var chatHistory = [];
var chatContext = null;
var conversations = []; // [{id, title, messages, context}]
var currentConvId = null;
var convListVisible = false;

function loadAll(cb) { chrome.storage.local.get(['lang','watchlist','history','conversations','currentConvId'], cb); }
function save(obj) { chrome.storage.local.set(obj); }

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  loadAll(function(s) {
    if (s.lang) lang = s.lang;
    if (s.watchlist) watchlist = s.watchlist;
    if (s.history) historyList = s.history;
    if (s.conversations) conversations = s.conversations;
    if (s.currentConvId) currentConvId = s.currentConvId;

    // Load current conversation
    if (currentConvId) {
      var conv = conversations.find(function(c) { return c.id === currentConvId; });
      if (conv) {
        chatHistory = conv.messages || [];
        chatContext = conv.context || null;
        document.getElementById('chat-conv-title').textContent = conv.title || 'Діалог';
        if (chatContext) {
          var ticker = chatContext.split(':')[0];
          document.getElementById('chat-ctx-ticker').textContent = ticker;
          document.getElementById('chat-ctx-bar').style.display = 'flex';
        }
        chatHistory.forEach(function(msg) {
          appendChatMsg(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
        });
      }
    }

    applyLang();
    fetchMarketData();
    renderHomeWatchlist();

    document.getElementById('nav-logo').addEventListener('click', function() {
      if (currentAbort) { currentAbort.abort(); currentAbort = null; }
      showPanel('search');
      document.getElementById('loading-state').style.display = 'none';
      document.getElementById('result').style.display = 'none';
      document.getElementById('price-box').style.display = 'none';
      document.getElementById('empty-state').style.display = 'block';
      document.getElementById('stop-btn').style.display = 'none';
      document.getElementById('analyze-btn').style.display = 'block';
      document.getElementById('ticker-input').value = '';
      document.getElementById('ticker-input').focus();
      currentTicker = ''; currentData = null;
    });
    document.getElementById('tab-search').addEventListener('click', function() { showPanel('search'); });
    document.getElementById('tab-watchlist').addEventListener('click', function() { showPanel('watchlist'); });
    document.getElementById('tab-history').addEventListener('click', function() { showPanel('history'); });
    document.getElementById('tab-chat').addEventListener('click', function() { showPanel('chat'); });
    document.getElementById('tab-alerts').addEventListener('click', function() { showPanel('alerts'); });
    document.getElementById('tab-settings').addEventListener('click', function() { showPanel('settings'); });

    document.getElementById('lang-btn').addEventListener('click', function() {
      lang = lang === 'ua' ? 'en' : 'ua';
      save({ lang: lang });
      applyLang();
      renderWatchlist();
      renderHistory();
      if (currentTicker) runAnalysis();
    });

    document.getElementById('analyze-btn').addEventListener('click', runAnalysis);
    document.getElementById('stop-btn').addEventListener('click', stopAnalysis);
    document.getElementById('ticker-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') runAnalysis(); });

    var qps = document.querySelectorAll('.qp');
    for (var i = 0; i < qps.length; i++) {
      qps[i].addEventListener('click', function() {
        document.getElementById('ticker-input').value = this.getAttribute('data-ticker');
        runAnalysis();
      });
    }

    document.getElementById('watch-btn').addEventListener('click', toggleWatch);
    document.getElementById('btn-refresh').addEventListener('click', renderWatchlist);
    document.getElementById('btn-clear').addEventListener('click', function() { historyList = []; save({ history: [] }); renderHistory(); });

    // Chat
    document.getElementById('chat-send-btn').addEventListener('click', sendChat);
    document.getElementById('chat-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') sendChat(); });
    document.getElementById('chat-ctx-clear').addEventListener('click', clearChatContext);
    document.getElementById('btn-new-chat').addEventListener('click', newChat);
    document.getElementById('btn-conv-list').addEventListener('click', toggleConvList);
  });
});

// ── Lang ──────────────────────────────────────────────────────────────────────
function applyLang() {
  var ua = lang === 'ua';
  document.getElementById('lang-btn').textContent = ua ? 'EN' : 'UA';
  document.getElementById('tab-search').textContent = ua ? 'Пошук' : 'Search';
  document.getElementById('tab-history').textContent = ua ? 'Іст.' : 'Hist.';
  document.getElementById('analyze-btn').textContent = ua ? 'Аналіз' : 'Analyze';
  document.getElementById('lbl-popular').textContent = ua ? 'Популярні:' : 'Popular:';
  document.getElementById('lbl-market').textContent = ua ? 'Ринок' : 'Market';
  var hwlEl = document.getElementById('lbl-home-wl');
  if (hwlEl) hwlEl.textContent = ua ? 'Watchlist' : 'Watchlist';
  var emptyTextEl = document.getElementById('empty-text');
  if (emptyTextEl) emptyTextEl.textContent = ua ? 'Введи тікер і отримай AI-аналіз' : 'Enter a ticker for AI analysis';
  document.getElementById('r-disclaimer').textContent = ua ? 'Не є фінансовою порадою.' : 'Not financial advice.';
  document.getElementById('lbl-sector').textContent = ua ? 'Сектор' : 'Sector';
  document.getElementById('lbl-risk').textContent = ua ? 'Ризик' : 'Risk';
  document.getElementById('lbl-trend').textContent = ua ? 'Тренд' : 'Trend';
  document.getElementById('lbl-for').textContent = ua ? 'Для кого' : 'Best for';
  document.getElementById('lbl-chart').textContent = ua ? 'Тренд (30д)' : 'Trend (30d)';
  document.getElementById('lbl-what').textContent = ua ? 'Що робить компанія' : 'What the company does';
  document.getElementById('lbl-risks').textContent = ua ? 'Головні ризики' : 'Key risks';
  document.getElementById('lbl-forecast').textContent = ua ? 'AI Прогноз' : 'AI Forecast';
  document.getElementById('lbl-conclusion').textContent = ua ? 'Висновок AI' : 'AI Conclusion';
  document.getElementById('lbl-watchlist-title').textContent = ua ? 'Відстежуються' : 'Watchlist';
  document.getElementById('lbl-history-title').textContent = ua ? 'Історія пошуків' : 'Search History';
  document.getElementById('btn-clear').textContent = ua ? 'Очистити' : 'Clear';
  document.getElementById('lbl-alerts-title').textContent = ua ? 'Алерти цін' : 'Price Alerts';
  document.getElementById('alerts-info').textContent = ua ? 'Отримуй сповіщення коли акції з Watchlist змінюються більше ніж на заданий %.' : 'Get notified when Watchlist stocks change more than the set %.';
  document.getElementById('threshold-label').textContent = ua ? 'Поріг сповіщення (% зміни):' : 'Alert threshold (% change):';
  document.getElementById('btn-save-threshold').textContent = ua ? 'Зберегти' : 'Save';
  document.getElementById('btn-check-now').textContent = ua ? '↻ Перевірити' : '↻ Check now';
  document.getElementById('lbl-chat-ctx').textContent = ua ? 'Контекст:' : 'Context:';
  var welcomeEl = document.getElementById('lbl-chat-welcome');
  if (welcomeEl) welcomeEl.textContent = ua
    ? 'Привіт! Запитай мене про будь-яку акцію або ринок. Після аналізу — отримую контекст автоматично.'
    : 'Hi! Ask me about any stock or market. After analysis, I get context automatically.';
  document.getElementById('chat-input').placeholder = ua ? 'Запитай про TSLA, ринок...' : 'Ask about TSLA, market...';
  document.getElementById('btn-new-chat').title = ua ? 'Новий діалог' : 'New chat';
  document.getElementById('btn-conv-list').title = ua ? 'Діалоги' : 'Conversations';
  // Update conv title if it's a default one
  var titleEl = document.getElementById('chat-conv-title');
  if (titleEl.textContent === 'Новий діалог' || titleEl.textContent === 'New chat') {
    titleEl.textContent = ua ? 'Новий діалог' : 'New chat';
  }
  // Re-render conv list if visible
  if (convListVisible) renderConvList();
  document.getElementById('settings-how-it-works').textContent = ua
    ? 'Розширення використовує наш хмарний сервер для AI аналізу. Твої дані не зберігаються.'
    : 'The extension uses our cloud server for AI analysis. Your data is not stored.';
  document.getElementById('settings-free-note').textContent = ua
    ? '✓ Безкоштовно — ключі не потрібні. Аналіз на базі Groq Llama 3.3 + реальні дані Finnhub.'
    : '✓ Free — no API keys needed. Powered by Groq Llama 3.3 + real-time Finnhub data.';
  var stopBtn = document.getElementById('stop-btn');
  if (stopBtn) stopBtn.textContent = ua ? '✕ Стоп' : '✕ Stop';
}

// ── Panels ────────────────────────────────────────────────────────────────────
function showPanel(id) {
  var panels = document.querySelectorAll('.panel');
  for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
  var tabs = document.querySelectorAll('.nav-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  document.getElementById('panel-' + id).classList.add('active');
  document.getElementById('tab-' + id).classList.add('active');
  if (id === 'search') { renderHomeWatchlist(); fetchMarketData(); }
  if (id === 'watchlist') renderWatchlist();
  if (id === 'history') renderHistory();
  if (id === 'alerts') initAlerts();
}

// ── Market Overview ───────────────────────────────────────────────────────────
function fetchMarketData() {
  fetch(WORKER_URL + '/market')
    .then(function(r) { return r.json(); })
    .then(function(data) { renderMarketCards(data); })
    .catch(function() {});
}

var CARD_TICKERS = { SP500: 'SPY', NASDAQ: 'QQQ', BTC: 'BTC', GOLD: 'GLD' };

function renderMarketCards(data) {
  var keys = ['SP500','NASDAQ','BTC','GOLD'];
  var icons = { SP500:'📊', NASDAQ:'💻', BTC:'₿', GOLD:'🥇' };
  var html = '';
  keys.forEach(function(k) {
    var d = data[k];
    if (!d) return;
    var up = d.pct >= 0;
    var color = up ? 'var(--green)' : 'var(--red)';
    var price = d.c >= 1000
      ? '$' + Math.round(d.c).toLocaleString()
      : '$' + d.c.toFixed(2);
    html += '<div class="mcard" data-card="' + k + '" style="cursor:pointer" title="Аналіз ' + CARD_TICKERS[k] + '">' +
      '<div class="mcard-label">' + icons[k] + ' ' + d.label + '</div>' +
      '<div class="mcard-price">' + price + '</div>' +
      '<div class="mcard-pct" style="color:' + color + '">' + (up?'▲':'▼') + Math.abs(d.pct).toFixed(2) + '%</div>' +
    '</div>';
  });
  var el = document.getElementById('market-cards');
  if (!el) return;
  if (html) el.innerHTML = html;

  // Make cards clickable
  el.querySelectorAll('.mcard').forEach(function(card) {
    card.addEventListener('click', function() {
      var ticker = CARD_TICKERS[this.getAttribute('data-card')];
      if (ticker) {
        document.getElementById('ticker-input').value = ticker;
        runAnalysis();
      }
    });
  });

  // Update time
  var timeEl = document.getElementById('market-time');
  if (timeEl) {
    var now = new Date();
    timeEl.textContent = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  }
}

function renderHomeWatchlist() {
  var container = document.getElementById('home-watchlist');
  var itemsEl = document.getElementById('home-wl-items');
  if (!watchlist.length) { container.style.display = 'none'; return; }
  container.style.display = 'block';
  var shown = watchlist.slice(0, 4);
  var html = '';
  shown.forEach(function(w) {
    var pill = { green:'pill-green', yellow:'pill-yellow', red:'pill-red', blue:'pill-blue' }[w.color] || 'pill-blue';
    html += '<div class="hwl-item" data-ticker="' + w.ticker + '">' +
      '<span class="hwl-ticker">' + w.ticker + '</span>' +
      '<span class="hwl-price" id="hwp-' + w.ticker + '" style="color:var(--dim)">—</span>' +
      '<span class="hwl-pct" id="hwpc-' + w.ticker + '"></span>' +
      '<span class="verdict-pill ' + pill + '" style="font-size:9px">' + normalizeVerdict(w.verdict||'', lang) + '</span>' +
    '</div>';
  });
  itemsEl.innerHTML = html;

  itemsEl.querySelectorAll('.hwl-item').forEach(function(item) {
    item.addEventListener('click', function() {
      document.getElementById('ticker-input').value = this.getAttribute('data-ticker');
      runAnalysis();
    });
  });

  // Fetch live prices
  shown.forEach(function(w) {
    fetch(WORKER_URL + '/price?ticker=' + w.ticker)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.c || d.c === 0) return;
        var priceEl = document.getElementById('hwp-' + w.ticker);
        var pctEl = document.getElementById('hwpc-' + w.ticker);
        if (!priceEl) return;
        var pct = ((d.c - d.pc) / d.pc * 100);
        var up = pct >= 0;
        priceEl.textContent = '$' + d.c.toFixed(2);
        priceEl.style.color = 'var(--text)';
        pctEl.textContent = (up ? '▲' : '▼') + Math.abs(pct).toFixed(1) + '%';
        pctEl.style.color = up ? 'var(--green)' : 'var(--red)';
      })
      .catch(function() {});
  });
}

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
  document.getElementById('loading-state').style.display = 'block';
  document.getElementById('loading-msg').textContent = (lang === 'ua' ? 'Аналізую ' : 'Analyzing ') + raw + '...';
  document.getElementById('price-box').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'block';

  var signal = currentAbort.signal;

  fetch(WORKER_URL + '/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker: raw, lang: lang }),
    signal: signal,
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) throw new Error('Worker: ' + data.error + (data.raw ? ' | ' + data.raw.slice(0, 100) : ''));
      // Fetch fresh price separately for accurate display (esp. crypto)
      fetch(WORKER_URL + '/price?ticker=' + raw)
        .then(function(r) { return r.json(); })
        .then(function(pd) {
          if (pd.c && pd.c > 0) {
            var ch = pd.c - pd.pc;
            var p = (ch / pd.pc) * 100;
            showPrice({
              price: formatPrice(pd.c),
              change: (ch >= 0 ? '+' : '') + formatChange(ch),
              pct: (p >= 0 ? '+' : '') + p.toFixed(2),
              currency: 'USD',
            });
          } else if (data._quote && data._quote.c) {
            var q = data._quote;
            var change = q.c - q.pc;
            var pct = (change / q.pc) * 100;
            showPrice({
              price: formatPrice(q.c),
              change: (change >= 0 ? '+' : '') + formatChange(change),
              pct: (pct >= 0 ? '+' : '') + pct.toFixed(2),
              currency: 'USD',
            });
          }
        })
        .catch(function() {
          if (data._quote && data._quote.c) {
            var q = data._quote;
            var change = q.c - q.pc;
            var pct = (change / q.pc) * 100;
            showPrice({
              price: formatPrice(q.c),
              change: (change >= 0 ? '+' : '') + formatChange(change),
              pct: (pct >= 0 ? '+' : '') + pct.toFixed(2),
              currency: 'USD',
            });
          }
        });
      finish(raw, normalizeAI(data));
    })
    .catch(function(e) {
      if (e.name === 'AbortError') return;
      var msg = e.message || '';
      var retryMatch = msg.match(/retry in ([\d.]+)s/i);
      if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('exhausted')) {
        var sec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
        msg = lang === 'ua'
          ? '⏳ Перевищено ліміт. Спробуй через ' + sec + ' сек.'
          : '⏳ Rate limit. Try again in ' + sec + ' sec.';
      }
      showError(msg || (lang === 'ua' ? 'Помилка з\'єднання' : 'Connection error'));
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

function formatPrice(p) {
  if (p >= 10000) return Math.round(p).toLocaleString();
  if (p >= 100)   return p.toFixed(2);
  if (p >= 1)     return p.toFixed(2);
  return p.toFixed(4);
}

function formatChange(ch) {
  if (Math.abs(ch) >= 100) return Math.round(ch).toString();
  if (Math.abs(ch) >= 1)   return ch.toFixed(2);
  return ch.toFixed(4);
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
  setChatContext(ticker, data);
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
  var pillMap = { green:'pill-green', yellow:'pill-yellow', red:'pill-red', blue:'pill-blue' };
  var vEl = document.getElementById('r-verdict');
  vEl.textContent = d.verdict; vEl.className = 'verdict-pill ' + (pillMap[d.color] || 'pill-blue');
  var sMap = {
    green: 'background:var(--green-dim);border:1px solid var(--green-border);color:var(--green)',
    yellow: 'background:var(--yellow-dim);border:1px solid rgba(251,191,36,0.25);color:var(--yellow)',
    red: 'background:var(--red-dim);border:1px solid rgba(248,113,113,0.25);color:var(--red)',
    blue: 'background:var(--blue-dim);border:1px solid rgba(96,165,250,0.25);color:var(--blue)',
  };
  document.getElementById('r-conclusion-box').style.cssText = sMap[d.color] || sMap.blue;
  drawChart(d.dir, d.color);
  updateWatchBtn();
}

function drawChart(dir, color) {
  var canvas = document.getElementById('trend-chart');
  var ctx = canvas.getContext('2d');
  var W = canvas.offsetWidth || 400, H = 80;
  canvas.width = W; canvas.height = H;
  var cfgs = { up:{d:-0.6,n:2.5}, up_strong:{d:-1.1,n:3}, down:{d:0.7,n:2.5}, volatile:{d:0,n:6}, flat:{d:0,n:1.5} };
  var cfg = cfgs[dir] || cfgs.flat;
  var pts = [], y = H / 2, pad = 8;
  for (var i = 0; i < 30; i++) {
    y += cfg.d + (Math.random() - 0.5) * cfg.n * 2;
    y = Math.max(pad, Math.min(H - pad, y));
    pts.push({ x: pad + (i / 29) * (W - pad * 2), y: y });
  }
  var cMap = { green:'#4ade80', yellow:'#fbbf24', red:'#f87171', blue:'#60a5fa' };
  var lc = cMap[color] || '#60a5fa';
  var ch = (((pts[29].y - pts[0].y) / pts[0].y) * -100).toFixed(1);
  var chEl = document.getElementById('chart-change');
  chEl.style.color = ch >= 0 ? 'var(--green)' : 'var(--red)';
  chEl.textContent = (ch >= 0 ? '+' : '') + ch + '%';
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.moveTo(pts[0].x, H);
  for (var i = 0; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineTo(pts[29].x, H); ctx.closePath(); ctx.fillStyle = lc + '22'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (var i = 1; i < pts.length; i++) {
    var mx = (pts[i - 1].x + pts[i].x) / 2;
    var my = (pts[i - 1].y + pts[i].y) / 2;
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, mx, my);
  }
  ctx.strokeStyle = lc; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(pts[29].x, pts[29].y, 3, 0, Math.PI * 2); ctx.fillStyle = lc; ctx.fill();
}

// ── Watchlist ─────────────────────────────────────────────────────────────────
function isInWatch(t) { for (var i = 0; i < watchlist.length; i++) if (watchlist[i].ticker === t) return true; return false; }
function updateWatchBtn() {
  var btn = document.getElementById('watch-btn');
  if (!currentTicker) return;
  if (isInWatch(currentTicker)) { btn.textContent = lang === 'ua' ? '✓ В списку' : '✓ Added'; btn.classList.add('added'); }
  else { btn.textContent = '+ Watchlist'; btn.classList.remove('added'); }
}
function toggleWatch() {
  if (!currentTicker || !currentData) return;
  if (isInWatch(currentTicker)) { watchlist = watchlist.filter(function(w) { return w.ticker !== currentTicker; }); }
  else { watchlist.push({ ticker: currentTicker, sector: currentData.sector, verdict: normalizeVerdict(currentData.verdict || '', 'en'), color: currentData.color, t: Date.now() }); }
  save({ watchlist: watchlist }); updateWatchBtn();
}
function renderWatchlist() {
  var el = document.getElementById('watchlist-content');
  if (!watchlist.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><p>' + (lang === 'ua' ? 'Watchlist порожній.' : 'Watchlist is empty.') + '</p></div>';
    return;
  }
  var html = '';
  for (var i = 0; i < watchlist.length; i++) {
    var w = watchlist[i];
    var pill = { green:'pill-green', yellow:'pill-yellow', red:'pill-red', blue:'pill-blue' }[w.color] || 'pill-blue';
    html += '<div class="watch-item" data-ticker="' + w.ticker + '">' +
      '<span class="watch-ticker">' + w.ticker + '</span>' +
      '<div class="watch-info"><div class="watch-sector">' + normalizeSector(w.sector || '', lang) + '</div></div>' +
      '<span class="watch-price" id="wp-' + w.ticker + '" style="color:var(--dim)">—</span>' +
      '<span class="watch-pct" id="wpc-' + w.ticker + '"></span>' +
      '<span class="verdict-pill ' + pill + '">' + normalizeVerdict(w.verdict || '', lang) + '</span>' +
      '<button class="watch-remove" data-ticker="' + w.ticker + '">✕</button>' +
    '</div>';
  }
  el.innerHTML = html;

  var items = el.querySelectorAll('.watch-item');
  for (var i = 0; i < items.length; i++) {
    items[i].addEventListener('click', function(e) {
      if (e.target.classList.contains('watch-remove')) return;
      document.getElementById('ticker-input').value = this.getAttribute('data-ticker');
      showPanel('search'); runAnalysis();
    });
  }
  var removes = el.querySelectorAll('.watch-remove');
  for (var i = 0; i < removes.length; i++) {
    removes[i].addEventListener('click', function(e) {
      e.stopPropagation();
      var t = this.getAttribute('data-ticker');
      watchlist = watchlist.filter(function(w) { return w.ticker !== t; });
      save({ watchlist: watchlist }); renderWatchlist(); updateWatchBtn();
    });
  }

  // Fetch live prices for all tickers
  watchlist.forEach(function(w) {
    fetch(WORKER_URL + '/price?ticker=' + w.ticker)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.c || d.c === 0) return;
        var priceEl = document.getElementById('wp-' + w.ticker);
        var pctEl = document.getElementById('wpc-' + w.ticker);
        if (!priceEl) return;
        var pct = ((d.c - d.pc) / d.pc * 100);
        var up = pct >= 0;
        priceEl.textContent = '$' + d.c.toFixed(2);
        priceEl.style.color = 'var(--text)';
        pctEl.textContent = (up ? '▲' : '▼') + Math.abs(pct).toFixed(1) + '%';
        pctEl.style.color = up ? 'var(--green)' : 'var(--red)';
      })
      .catch(function() {});
  });
}

// ── History ───────────────────────────────────────────────────────────────────
function addHistory(ticker, data) {
  historyList = historyList.filter(function(h) { return h.ticker !== ticker; });
  historyList.unshift({ ticker: ticker, color: data.color, verdict: data.verdict, t: Date.now() });
  if (historyList.length > 20) historyList = historyList.slice(0, 20);
  save({ history: historyList });
}
function renderHistory() {
  var el = document.getElementById('history-content');
  if (!historyList.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">🕐</div><p>' + (lang === 'ua' ? 'Історія порожня.' : 'History is empty.') + '</p></div>'; return; }
  var html = '';
  for (var i = 0; i < historyList.length; i++) {
    var h = historyList[i]; var pill = { green:'pill-green', yellow:'pill-yellow', red:'pill-red', blue:'pill-blue' }[h.color] || 'pill-blue';
    var diff = Math.floor((Date.now() - h.t) / 60000);
    var time = diff < 1 ? (lang === 'ua' ? 'Щойно' : 'Just now') : diff < 60 ? diff + (lang === 'ua' ? ' хв' : 'm ago') : Math.floor(diff / 60) + (lang === 'ua' ? ' год' : 'h ago');
    html += '<div class="hist-item" data-ticker="' + h.ticker + '"><span class="hist-ticker">' + h.ticker + '</span><span class="hist-time">' + time + '</span><span class="verdict-pill ' + pill + '">' + normalizeVerdict(h.verdict || '', lang) + '</span></div>';
  }
  el.innerHTML = html;
  var items = el.querySelectorAll('.hist-item');
  for (var i = 0; i < items.length; i++) { items[i].addEventListener('click', function() { document.getElementById('ticker-input').value = this.getAttribute('data-ticker'); showPanel('search'); runAnalysis(); }); }
}

function toast(msg) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:var(--green);color:#0a0f0a;font-family:var(--mono);font-size:11px;padding:6px 16px;border-radius:20px;z-index:999;pointer-events:none';
  t.textContent = msg; document.body.appendChild(t); setTimeout(function() { t.remove(); }, 2000);
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function saveConversations() {
  save({ conversations: conversations, currentConvId: currentConvId });
}

function saveCurrentConv() {
  if (!currentConvId) return;
  var idx = conversations.findIndex(function(c) { return c.id === currentConvId; });
  if (idx >= 0) {
    conversations[idx].messages = chatHistory;
    conversations[idx].context = chatContext;
  }
  saveConversations();
}

function newChat() {
  // Save current conv if has messages
  if (chatHistory.length > 0) saveCurrentConv();

  // Create new conversation
  var id = Date.now();
  var conv = { id: id, title: lang === 'ua' ? 'Новий діалог' : 'New chat', messages: [], context: null, date: id };
  conversations.unshift(conv);
  currentConvId = id;
  chatHistory = [];
  chatContext = null;

  // Reset UI
  document.getElementById('chat-conv-title').textContent = conv.title;
  document.getElementById('chat-ctx-bar').style.display = 'none';
  document.getElementById('chat-ctx-ticker').textContent = '';
  document.getElementById('chat-messages').innerHTML =
    '<div class="chat-welcome" id="chat-welcome"><div class="chat-welcome-icon">🤖</div>' +
    '<p id="lbl-chat-welcome">' + (lang === 'ua' ? 'Привіт! Запитай мене про будь-яку акцію або ринок.' : 'Hi! Ask me about any stock or market.') + '</p></div>';

  // Hide conv list if visible
  if (convListVisible) toggleConvList();
  document.getElementById('chat-input').focus();
  saveConversations();
}

function toggleConvList() {
  convListVisible = !convListVisible;
  var listEl = document.getElementById('conv-list');
  var msgsEl = document.getElementById('chat-messages');
  var inputRow = document.querySelector('.chat-input-row');
  var ctxBar = document.getElementById('chat-ctx-bar');

  if (convListVisible) {
    listEl.classList.add('active');
    msgsEl.style.display = 'none';
    inputRow.style.display = 'none';
    ctxBar.style.display = 'none';
    renderConvList();
  } else {
    listEl.classList.remove('active');
    msgsEl.style.display = 'flex';
    inputRow.style.display = 'flex';
    if (chatContext) ctxBar.style.display = 'flex';
  }
}

function renderConvList() {
  var el = document.getElementById('conv-list');
  if (!conversations.length) {
    el.innerHTML = '<div class="conv-empty">' + (lang === 'ua' ? 'Немає збережених діалогів' : 'No saved conversations') + '</div>';
    return;
  }
  var html = '';
  conversations.forEach(function(c) {
    var ago = timeSince(c.date);
    var isCurrent = c.id === currentConvId;
    html += '<div class="conv-item' + (isCurrent ? ' current' : '') + '" data-id="' + c.id + '">' +
      '<div class="conv-info"><div class="conv-title">' + escHtml(c.title) + '</div><div class="conv-date">' + ago + ' · ' + c.messages.length + ' повід.</div></div>' +
      '<button class="conv-del" data-id="' + c.id + '">🗑</button>' +
    '</div>';
  });
  el.innerHTML = html;

  el.querySelectorAll('.conv-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (e.target.classList.contains('conv-del')) return;
      loadConversation(parseInt(this.getAttribute('data-id')));
    });
  });
  el.querySelectorAll('.conv-del').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      deleteConversation(parseInt(this.getAttribute('data-id')));
    });
  });
}

function loadConversation(id) {
  if (chatHistory.length > 0) saveCurrentConv();
  var conv = conversations.find(function(c) { return c.id === id; });
  if (!conv) return;

  currentConvId = id;
  chatHistory = conv.messages || [];
  chatContext = conv.context || null;
  document.getElementById('chat-conv-title').textContent = conv.title;

  // Restore context bar
  if (chatContext) {
    document.getElementById('chat-ctx-ticker').textContent = chatContext.split(':')[0];
    document.getElementById('chat-ctx-bar').style.display = 'flex';
  } else {
    document.getElementById('chat-ctx-bar').style.display = 'none';
  }

  // Restore messages
  document.getElementById('chat-messages').innerHTML = '';
  if (chatHistory.length === 0) {
    document.getElementById('chat-messages').innerHTML =
      '<div class="chat-welcome" id="chat-welcome"><div class="chat-welcome-icon">🤖</div><p>' +
      (lang === 'ua' ? 'Продовжуй діалог...' : 'Continue the conversation...') + '</p></div>';
  } else {
    chatHistory.forEach(function(msg) {
      appendChatMsg(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
    });
  }

  saveConversations();
  if (convListVisible) toggleConvList();
}

function deleteConversation(id) {
  conversations = conversations.filter(function(c) { return c.id !== id; });
  if (currentConvId === id) {
    if (conversations.length > 0) {
      loadConversation(conversations[0].id);
      return;
    } else {
      currentConvId = null;
      chatHistory = [];
      chatContext = null;
      document.getElementById('chat-conv-title').textContent = lang === 'ua' ? 'Новий діалог' : 'New chat';
      document.getElementById('chat-ctx-bar').style.display = 'none';
    }
  }
  saveConversations();
  renderConvList();
}

function setChatContext(ticker, data) {
  chatContext = ticker + ': sector=' + data.sector + ', verdict=' + data.verdict + ', trend=' + data.trend + ', risk=' + data.risk + '. Forecast: ' + data.forecast;
  document.getElementById('chat-ctx-ticker').textContent = ticker;
  document.getElementById('chat-ctx-bar').style.display = 'flex';
  saveCurrentConv();
}

function clearChatContext() {
  chatContext = null;
  document.getElementById('chat-ctx-bar').style.display = 'none';
  document.getElementById('chat-ctx-ticker').textContent = '';
  saveCurrentConv();
}

function timeSince(ts) {
  var diff = Math.floor((Date.now() - ts) / 60000);
  if (diff < 1) return lang === 'ua' ? 'щойно' : 'just now';
  if (diff < 60) return diff + (lang === 'ua' ? ' хв' : 'm ago');
  if (diff < 1440) return Math.floor(diff / 60) + (lang === 'ua' ? ' год' : 'h ago');
  return Math.floor(diff / 1440) + (lang === 'ua' ? ' д' : 'd ago');
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function sendChat() {
  var input = document.getElementById('chat-input');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  input.focus();

  // Auto-create conversation on first message
  if (!currentConvId) {
    var id = Date.now();
    var title = msg.slice(0, 35) + (msg.length > 35 ? '…' : '');
    var conv = { id: id, title: title, messages: [], context: chatContext, date: id };
    conversations.unshift(conv);
    currentConvId = id;
    document.getElementById('chat-conv-title').textContent = title;
    saveConversations();
  } else if (chatHistory.length === 0) {
    // Update title from first message
    var idx = conversations.findIndex(function(c) { return c.id === currentConvId; });
    if (idx >= 0) {
      conversations[idx].title = msg.slice(0, 35) + (msg.length > 35 ? '…' : '');
      document.getElementById('chat-conv-title').textContent = conversations[idx].title;
    }
  }

  appendChatMsg('user', msg);
  chatHistory.push({ role: 'user', content: msg });

  var typingEl = appendChatMsg('ai', lang === 'ua' ? 'Думаю...' : 'Thinking...', true);

  fetch(WORKER_URL + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: chatHistory, context: chatContext, lang: lang }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      typingEl.remove();
      if (data.error) {
        var errMsg = data.error;
        var retryMatch = errMsg.match(/retry in ([\d.]+)s/i);
        if (errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('exhausted')) {
          var sec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
          errMsg = lang === 'ua'
            ? '⏳ Перевищено ліміт запитів. Спробуй через ' + sec + ' сек.'
            : '⏳ Rate limit reached. Try again in ' + sec + ' sec.';
        }
        appendChatMsg('ai', errMsg);
        return;
      }
      var reply = data.reply || (lang === 'ua' ? 'Порожня відповідь.' : 'Empty response.');
      appendChatMsg('ai', reply);
      chatHistory.push({ role: 'assistant', content: reply });
      if (chatHistory.length > 40) chatHistory = chatHistory.slice(-40);
      saveCurrentConv();
    })
    .catch(function() {
      typingEl.remove();
      appendChatMsg('ai', lang === 'ua' ? '⚠ Помилка зв\'язку.' : '⚠ Connection error.');
    });
}

function renderChatText(text) {
  // Strip leftover markdown symbols and render line breaks as paragraphs
  var clean = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/`(.+?)`/g, '$1');
  var parts = clean.split(/\n{2,}/);
  return parts.map(function(p) {
    var t = p.replace(/\n/g, '<br>').trim();
    return t ? '<p style="margin:0 0 6px">' + t + '</p>' : '';
  }).join('');
}

function appendChatMsg(role, content, isTyping) {
  var container = document.getElementById('chat-messages');
  var welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'none';

  if (role === 'ai' && !isTyping) {
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg-wrap';
    var el = document.createElement('div');
    el.className = 'chat-msg ai';
    el.innerHTML = renderChatText(content);
    var copyBtn = document.createElement('button');
    copyBtn.className = 'chat-copy-btn';
    copyBtn.textContent = '⎘';
    copyBtn.title = 'Copy';
    copyBtn.addEventListener('click', function() {
      navigator.clipboard.writeText(content).then(function() {
        copyBtn.textContent = '✓';
        setTimeout(function() { copyBtn.textContent = '⎘'; }, 1500);
      });
    });
    wrap.appendChild(el);
    wrap.appendChild(copyBtn);
    container.appendChild(wrap);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  var el = document.createElement('div');
  el.className = 'chat-msg ' + role + (isTyping ? ' typing' : '');
  if (isTyping) {
    el.textContent = content;
  } else {
    el.innerHTML = renderChatText(content);
  }
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

// ── Alerts ────────────────────────────────────────────────────────────────────
function initAlerts() {
  chrome.storage.local.get(['alertThreshold', 'priceAlerts'], function(s) {
    var threshold = s.alertThreshold || 3;
    document.getElementById('threshold-slider').value = threshold;
    document.getElementById('threshold-value').textContent = threshold + '%';
    renderAlertPrices(s.priceAlerts || {});
  });

  document.getElementById('threshold-slider').addEventListener('input', function() {
    document.getElementById('threshold-value').textContent = this.value + '%';
  });

  document.getElementById('btn-save-threshold').addEventListener('click', function() {
    var val = parseInt(document.getElementById('threshold-slider').value);
    chrome.storage.local.set({ alertThreshold: val });
    toast(lang === 'ua' ? '✓ Поріг збережено!' : '✓ Threshold saved!');
  });

  document.getElementById('btn-check-now').addEventListener('click', function() {
    chrome.runtime.sendMessage({ action: 'checkNow' });
    toast(lang === 'ua' ? 'Перевіряю ціни...' : 'Checking prices...');
    setTimeout(function() {
      chrome.storage.local.get(['priceAlerts'], function(s) {
        renderAlertPrices(s.priceAlerts || {});
      });
    }, 5000);
  });
}

function renderAlertPrices(priceAlerts) {
  var el = document.getElementById('alert-prices-list');
  if (!watchlist.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔔</div><p>' + (lang === 'ua' ? 'Додай акції у Watchlist.' : 'Add stocks to Watchlist.') + '</p></div>';
    return;
  }
  var html = '<div style="margin-top:12px"><p style="font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">' + (lang === 'ua' ? 'Останні ціни' : 'Last prices') + '</p>';
  watchlist.forEach(function(w) {
    var info = priceAlerts[w.ticker];
    var pill = { green:'pill-green', yellow:'pill-yellow', red:'pill-red', blue:'pill-blue' }[w.color] || 'pill-blue';
    html += '<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:var(--r);padding:9px 12px;margin-bottom:6px">';
    html += '<span style="font-family:var(--mono);font-size:13px;font-weight:500;color:var(--green);width:50px">' + w.ticker + '</span>';
    if (info) {
      var up = info.pct >= 0;
      var color = up ? 'var(--green)' : 'var(--red)';
      var arrow = up ? '▲' : '▼';
      html += '<span style="font-family:var(--mono);font-size:12px;color:var(--text)">$' + info.price.toFixed(2) + '</span>';
      html += '<span style="font-family:var(--mono);font-size:11px;color:' + color + '">' + arrow + ' ' + (up ? '+' : '') + info.pct.toFixed(1) + '%</span>';
      var ago = Math.floor((Date.now() - info.time) / 60000);
      var timeStr = ago < 1 ? (lang === 'ua' ? 'щойно' : 'just now') : ago + (lang === 'ua' ? ' хв тому' : 'm ago');
      html += '<span style="font-family:var(--mono);font-size:10px;color:var(--dim);margin-left:auto">' + timeStr + '</span>';
    } else {
      html += '<span style="font-family:var(--mono);font-size:11px;color:var(--dim)">' + (lang === 'ua' ? 'ще не перевірено' : 'not checked yet') + '</span>';
    }
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

// Listen for price updates from background
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.action === 'pricesUpdated') {
    chrome.storage.local.get(['priceAlerts'], function(s) {
      renderAlertPrices(s.priceAlerts || {});
    });
  }
});
