'use strict';

// ── Replace with your Cloudflare Worker URL after deployment ─────────────────
var WORKER_URL = 'https://stock-ai-analyzer.chelb-dev.workers.dev';

var lang = 'ua';
var theme = 'dark';
var currentTicker = '';
var currentData = null;
var watchlist = [];
var historyList = [];
var portfolio = []; // [{ticker, shares, buyPrice, addedAt}]

// Chat state
var chatHistory = [];
var chatContext = null;
var conversations = []; // [{id, title, messages, context}]
var currentConvId = null;
var convListVisible = false;

function loadAll(cb) { chrome.storage.local.get(['lang','theme','watchlist','history','conversations','currentConvId','portfolio'], cb); }
function save(obj) { chrome.storage.local.set(obj); }

// ── Cache ─────────────────────────────────────────────────────────────────────
var CACHE_MARKET_TTL  = 5  * 60 * 1000; // 5 хв
var CACHE_ANALYZE_TTL = 15 * 60 * 1000; // 15 хв
var CACHE_PRICE_TTL   = 2  * 60 * 1000; // 2 хв
var CACHE_CANDLE_TTL  = 30 * 60 * 1000; // 30 хв

function cacheGet(key, ttl, cb) {
  chrome.storage.local.get('c_' + key, function(s) {
    var e = s['c_' + key];
    cb(e && (Date.now() - e.t) < ttl ? e.d : null);
  });
}
function cacheSet(key, data) {
  var o = {}; o['c_' + key] = { d: data, t: Date.now() };
  chrome.storage.local.set(o);
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  loadAll(function(s) {
    if (s.lang) lang = s.lang;
    if (s.theme) theme = s.theme;
    if (s.watchlist) watchlist = s.watchlist;
    if (s.history) historyList = s.history;
    if (s.conversations) conversations = s.conversations;
    if (s.currentConvId) currentConvId = s.currentConvId;
    if (s.portfolio) portfolio = s.portfolio;
    applyTheme();

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
    document.getElementById('tab-news').addEventListener('click', function() { showPanel('news'); });
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
    document.getElementById('btn-refresh').addEventListener('click', function() {
      if (document.getElementById('portfolio-panel').style.display !== 'none') renderPortfolio();
      else renderWatchlist();
    });

    // WL ↔ Portfolio sub-tabs
    document.getElementById('wl-tab-wl').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('wl-tab-pf').classList.remove('active');
      document.getElementById('watchlist-content').style.display = 'block';
      document.getElementById('portfolio-panel').style.display = 'none';
    });
    document.getElementById('wl-tab-pf').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('wl-tab-wl').classList.remove('active');
      document.getElementById('watchlist-content').style.display = 'none';
      document.getElementById('portfolio-panel').style.display = 'block';
      renderPortfolio();
    });
    document.getElementById('pf-add-btn').addEventListener('click', addPortfolioPosition);
    document.getElementById('pf-ticker').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('pf-shares').focus(); });
    document.getElementById('pf-shares').addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('pf-buyprice').focus(); });
    document.getElementById('pf-buyprice').addEventListener('keydown', function(e) { if (e.key === 'Enter') addPortfolioPosition(); });
    document.getElementById('btn-clear').addEventListener('click', function() { historyList = []; save({ history: [] }); renderHistory(); });

    // Chat
    document.getElementById('news-search-btn').addEventListener('click', function() { fetchNews(document.getElementById('news-input').value.trim().toUpperCase()); });
    document.getElementById('news-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') fetchNews(this.value.trim().toUpperCase()); });
    document.getElementById('chat-send-btn').addEventListener('click', sendChat);
    document.getElementById('chat-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') sendChat(); });
    document.getElementById('chat-ctx-clear').addEventListener('click', clearChatContext);
    document.getElementById('btn-new-chat').addEventListener('click', newChat);
    document.getElementById('btn-conv-list').addEventListener('click', toggleConvList);

    // Alerts
    document.getElementById('btn-save-threshold').addEventListener('click', function() {
      var val = parseInt(document.getElementById('threshold-slider').value);
      chrome.storage.local.set({ alertThreshold: val }, function() {
        toast(lang === 'ua' ? '✓ Поріг збережено: ' + val + '%' : '✓ Threshold saved: ' + val + '%');
      });
    });
    document.getElementById('btn-check-now').addEventListener('click', function() {
      chrome.runtime.sendMessage({ action: 'checkNow' }, function() {
        var btn = document.getElementById('btn-check-now');
        btn.textContent = lang === 'ua' ? '✓ Перевірено' : '✓ Checked';
        setTimeout(function() {
          btn.textContent = lang === 'ua' ? '↻ Перевірити' : '↻ Check now';
          initAlerts(); // refresh list after check
        }, 1500);
      });
    });

    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('click', function() {
      theme = theme === 'dark' ? 'light' : 'dark';
      save({ theme: theme });
      applyTheme();
      applyLang();
    });
  });
});

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme() {
  if (theme === 'light') {
    document.body.setAttribute('data-theme', 'light');
  } else {
    document.body.removeAttribute('data-theme');
  }
}

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
  // lbl-watchlist-title moved to wl-tab-wl
  document.getElementById('wl-tab-wl').textContent = ua ? 'WL' : 'WL';
  document.getElementById('wl-tab-pf').textContent = ua ? '💼 Портфель' : '💼 Portfolio';
  document.getElementById('lbl-add-position').textContent = ua ? 'Додати позицію' : 'Add position';
  document.getElementById('pf-ticker').placeholder = ua ? 'TSLA' : 'TSLA';
  document.getElementById('pf-shares').placeholder = ua ? 'Акцій' : 'Shares';
  document.getElementById('pf-buyprice').placeholder = ua ? 'Ціна $' : 'Buy price $';
  document.getElementById('pf-add-btn').textContent = ua ? '+ Додати' : '+ Add';
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
  document.getElementById('settings-version').textContent = 'AI Stock Analyzer v2.0 · Groq Llama 3.3 · Finnhub';
  document.getElementById('news-search-btn').textContent = ua ? 'Пошук' : 'Search';
  document.getElementById('news-input').placeholder = ua ? 'TSLA, AAPL...' : 'TSLA, AAPL...';
  var newsEmptyEl = document.getElementById('lbl-news-empty');
  if (newsEmptyEl) newsEmptyEl.textContent = ua ? 'Введи тікер або вибери зі списку' : 'Enter a ticker or pick from the list';
  var stopBtn = document.getElementById('stop-btn');
  if (stopBtn) stopBtn.textContent = ua ? '✕ Стоп' : '✕ Stop';
  var lblTheme = document.getElementById('lbl-theme');
  if (lblTheme) lblTheme.textContent = theme === 'light'
    ? (ua ? '☀️ Світла тема' : '☀️ Light theme')
    : (ua ? '🌙 Темна тема' : '🌙 Dark theme');
  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) themeToggle.textContent = theme === 'light'
    ? (ua ? '🌙 Темна' : '🌙 Dark')
    : (ua ? '☀️ Світла' : '☀️ Light');
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
  if (id === 'news') initNews();
  if (id === 'alerts') initAlerts();
}

// ── Market Overview ───────────────────────────────────────────────────────────
function fetchMarketData() {
  // Show cached data instantly, then refresh in background
  cacheGet('market', CACHE_MARKET_TTL, function(cached) {
    if (cached) renderMarketCards(cached);
    fetch(WORKER_URL + '/market')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        cacheSet('market', data);
        renderMarketCards(data);
      })
      .catch(function() {});
  });
}

var CARD_TICKERS = { SP500: 'SPY', NASDAQ: 'QQQ', BTC: 'BTC', GOLD: 'GLD' };

var CARD_LABELS = { SP500:'S&P 500', NASDAQ:'NASDAQ', BTC:'Bitcoin', GOLD:'Gold' };

function renderMarketCards(data) {
  var keys = ['SP500','NASDAQ','BTC','GOLD'];
  var icons = { SP500:'📊', NASDAQ:'💻', BTC:'₿', GOLD:'🥇' };
  var html = '';
  keys.forEach(function(k) {
    var d = data[k];
    // Always render all 4 cards — show '—' if data missing
    if (!d) {
      html += '<div class="mcard" data-card="' + k + '" style="cursor:pointer;opacity:0.45" title="' + CARD_LABELS[k] + '">' +
        '<div class="mcard-label">' + icons[k] + ' ' + CARD_LABELS[k] + '</div>' +
        '<div class="mcard-price" style="color:var(--dim)">—</div>' +
        '<div class="mcard-pct" style="color:var(--dim)">—</div>' +
      '</div>';
      return;
    }
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
  el.innerHTML = html;

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

  // Fetch live prices (with cache)
  shown.forEach(function(w) {
    function applyPrice(d) {
      if (!d || !d.c || d.c === 0) return;
      var priceEl = document.getElementById('hwp-' + w.ticker);
      var pctEl   = document.getElementById('hwpc-' + w.ticker);
      if (!priceEl || !pctEl) return;
      var pct = ((d.c - d.pc) / d.pc * 100);
      var up = pct >= 0;
      priceEl.textContent = '$' + formatPrice(d.c);
      priceEl.style.color = 'var(--text)';
      pctEl.textContent = (up ? '▲' : '▼') + Math.abs(pct).toFixed(1) + '%';
      pctEl.style.color = up ? 'var(--green)' : 'var(--red)';
    }
    cacheGet('price_' + w.ticker, CACHE_PRICE_TTL, function(cached) {
      if (cached) { applyPrice(cached); return; } // cache fresh — skip network
      fetch(WORKER_URL + '/price?ticker=' + w.ticker)
        .then(function(r) { return r.json(); })
        .then(function(d) { if (d.c && d.c > 0) { cacheSet('price_' + w.ticker, d); applyPrice(d); } })
        .catch(function() {});
    });
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
  document.getElementById('price-box').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'block';

  // Cache key includes lang — UA and EN results cached separately
  var cacheKey = 'analyze_' + raw + '_' + lang;

  // Check cache first — show result instantly if available
  cacheGet(cacheKey, CACHE_ANALYZE_TTL, function(cached) {
    if (cached) {
      document.getElementById('loading-state').style.display = 'none';
      // Show cached price (from _quote), also seed the price cache
      showCachedPrice(raw, cached);
      if (cached._quote && cached._quote.c > 0) cacheSet('price_' + raw, cached._quote);
      finish(raw, normalizeAI(cached));
      return;
    }

    // No cache — show loading skeleton and fetch
    document.getElementById('loading-state').style.display = 'block';
    document.getElementById('loading-msg').textContent = (lang === 'ua' ? 'Аналізую ' : 'Analyzing ') + raw + '...';

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
        cacheSet(cacheKey, data); // Save to cache (includes lang)
        // Seed price cache from _quote to avoid extra fetch next time
        if (data._quote && data._quote.c > 0) cacheSet('price_' + raw, data._quote);
        fetchFreshPrice(raw, data);
        finish(raw, normalizeAI(data));
      })
      .catch(function(e) {
        if (e.name === 'AbortError') return;
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
  cacheGet('price_' + raw, CACHE_PRICE_TTL, function(cachedPrice) {
    if (cachedPrice) {
      renderPrice(cachedPrice);
      return;
    }
    fetch(WORKER_URL + '/price?ticker=' + raw)
      .then(function(r) { return r.json(); })
      .then(function(pd) {
        if (pd.c && pd.c > 0) {
          cacheSet('price_' + raw, pd);
          renderPrice(pd);
        } else if (fallbackData && fallbackData._quote && fallbackData._quote.c) {
          renderPrice(fallbackData._quote);
        }
      })
      .catch(function() {
        if (fallbackData && fallbackData._quote && fallbackData._quote.c) {
          renderPrice(fallbackData._quote);
        }
      });
  });
}

function showCachedPrice(raw, cached) {
  if (cached._quote && cached._quote.c) renderPrice(cached._quote);
}

function renderPrice(q) {
  if (!q || !q.c) return;
  var change = q.pc > 0 ? q.c - q.pc : 0;
  var pct    = q.pc > 0 ? (change / q.pc) * 100 : 0;
  showPrice({
    price: formatPrice(q.c),
    change: (change >= 0 ? '+' : '') + formatChange(change),
    pct: (pct >= 0 ? '+' : '') + pct.toFixed(2),
    currency: 'USD',
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
  var pillMap = { green:'pill-green', yellow:'pill-yellow', red:'pill-red', blue:'pill-blue' };
  var vEl = document.getElementById('r-verdict');
  vEl.textContent = d.verdict; vEl.className = 'verdict-pill ' + (pillMap[d.color] || 'pill-blue');
  var sMap = {
    green:  'background:var(--green-dim);border:1px solid var(--green-border);color:var(--green)',
    yellow: 'background:var(--yellow-dim);border:1px solid var(--yellow-border,rgba(217,119,6,0.3));color:var(--yellow)',
    red:    'background:var(--red-dim);border:1px solid var(--red-border,rgba(220,38,38,0.3));color:var(--red)',
    blue:   'background:var(--blue-dim);border:1px solid var(--blue-border,rgba(37,99,235,0.3));color:var(--blue)',
  };
  document.getElementById('r-conclusion-box').style.cssText = sMap[d.color] || sMap.blue;
  drawChartSimulated(d.dir, d.color); // placeholder until real candle data loads
  updateWatchBtn();
}

// ── Chart ─────────────────────────────────────────────────────────────────────
function fetchRealChart(ticker, color) {
  var lbl = document.getElementById('lbl-chart');
  cacheGet('candle_' + ticker, CACHE_CANDLE_TTL, function(cached) {
    if (cached) {
      drawChartFromPrices(cached, color);
      if (lbl) lbl.textContent = (lang === 'ua' ? 'Реальні дані 30д' : 'Real data 30d');
      return;
    }
    fetch(WORKER_URL + '/candle?ticker=' + ticker)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.c && d.c.length >= 2) {
          cacheSet('candle_' + ticker, d.c);
          drawChartFromPrices(d.c, color);
          if (lbl) lbl.textContent = (lang === 'ua' ? 'Реальні дані 30д' : 'Real data 30d');
        } else {
          drawChartSimulated(currentData ? currentData.dir : 'flat', color);
          if (lbl) lbl.textContent = (lang === 'ua' ? 'Тренд (прогноз)' : 'Trend (forecast)');
        }
      })
      .catch(function() {
        drawChartSimulated(currentData ? currentData.dir : 'flat', color);
        if (lbl) lbl.textContent = (lang === 'ua' ? 'Тренд (прогноз)' : 'Trend (forecast)');
      });
  });
}

function drawChartFromPrices(prices, color) {
  var canvas = document.getElementById('trend-chart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var W = canvas.offsetWidth || 400, H = 80, pad = 8;
  canvas.width = W; canvas.height = H;

  var min = Math.min.apply(null, prices);
  var max = Math.max.apply(null, prices);
  var range = max - min || 1;
  var n = prices.length;

  var pts = prices.map(function(p, i) {
    return {
      x: pad + (i / (n - 1)) * (W - pad * 2),
      y: H - pad - ((p - min) / range) * (H - pad * 2)
    };
  });

  var cMap = { green:'#4ade80', yellow:'#fbbf24', red:'#f87171', blue:'#60a5fa' };
  var lc = cMap[color] || '#60a5fa';

  // % change label
  var ch = ((prices[n - 1] - prices[0]) / prices[0] * 100).toFixed(1);
  var chEl = document.getElementById('chart-change');
  if (chEl) {
    chEl.style.color = ch >= 0 ? 'var(--green)' : 'var(--red)';
    chEl.textContent = (ch >= 0 ? '+' : '') + ch + '%';
  }

  ctx.clearRect(0, 0, W, H);
  // Fill area
  ctx.beginPath();
  ctx.moveTo(pts[0].x, H);
  pts.forEach(function(p) { ctx.lineTo(p.x, p.y); });
  ctx.lineTo(pts[n - 1].x, H);
  ctx.closePath();
  ctx.fillStyle = lc + '22';
  ctx.fill();
  // Smooth line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (var i = 1; i < pts.length; i++) {
    var mx = (pts[i - 1].x + pts[i].x) / 2;
    var my = (pts[i - 1].y + pts[i].y) / 2;
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, mx, my);
  }
  ctx.lineTo(pts[n - 1].x, pts[n - 1].y);
  ctx.strokeStyle = lc;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawChartSimulated(dir, color) {
  var canvas = document.getElementById('trend-chart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var W = canvas.offsetWidth || 400, H = 80, pad = 8;
  canvas.width = W; canvas.height = H;
  var cfgs = { up:{d:-0.6,n:2.5}, up_strong:{d:-1.1,n:3}, down:{d:0.7,n:2.5}, volatile:{d:0,n:6}, flat:{d:0,n:1.5} };
  var cfg = cfgs[dir] || cfgs.flat;
  var seed = 0;
  for (var ci = 0; ci < currentTicker.length; ci++) seed += currentTicker.charCodeAt(ci);
  seed += dir.length * 31;
  var s = seed;
  function rand() { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; }
  var pts = [], y = H / 2;
  for (var i = 0; i < 30; i++) {
    y += cfg.d + (rand() - 0.5) * cfg.n * 2;
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

  // Fetch live prices (with cache)
  watchlist.forEach(function(w) {
    function applyWPrice(d) {
      if (!d || !d.c || d.c === 0) return;
      var priceEl = document.getElementById('wp-' + w.ticker);
      var pctEl   = document.getElementById('wpc-' + w.ticker);
      if (!priceEl || !pctEl) return;
      var pct = ((d.c - d.pc) / d.pc * 100);
      var up = pct >= 0;
      priceEl.textContent = '$' + formatPrice(d.c);
      priceEl.style.color = 'var(--text)';
      pctEl.textContent = (up ? '▲' : '▼') + Math.abs(pct).toFixed(1) + '%';
      pctEl.style.color = up ? 'var(--green)' : 'var(--red)';
    }
    cacheGet('price_' + w.ticker, CACHE_PRICE_TTL, function(cached) {
      if (cached) { applyWPrice(cached); return; } // cache fresh — skip network
      fetch(WORKER_URL + '/price?ticker=' + w.ticker)
        .then(function(r) { return r.json(); })
        .then(function(d) { if (d.c && d.c > 0) { cacheSet('price_' + w.ticker, d); applyWPrice(d); } })
        .catch(function() {});
    });
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

// ── Alerts ────────────────────────────────────────────────────────────────────
function initAlerts() {
  chrome.storage.local.get(['alertThreshold', 'priceAlerts', 'watchlist'], function(s) {
    var threshold = s.alertThreshold || 3;
    var priceAlerts = s.priceAlerts || {};
    var wl = s.watchlist || [];

    var slider = document.getElementById('threshold-slider');
    var valEl  = document.getElementById('threshold-value');
    slider.value = threshold;
    valEl.textContent = threshold + '%';

    slider.oninput = function() { valEl.textContent = this.value + '%'; };

    renderAlertList(wl, priceAlerts, threshold);
  });
}

function renderAlertList(wl, priceAlerts, threshold) {
  var el = document.getElementById('alert-prices-list');
  var ua = lang === 'ua';

  if (!wl.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔔</div><p>' +
      (ua ? 'Додай акції до Watchlist щоб отримувати алерти.' : 'Add stocks to Watchlist to receive alerts.') + '</p></div>';
    return;
  }

  var html = '<div style="margin-top:12px;display:flex;flex-direction:column;gap:6px">';
  wl.forEach(function(item) {
    var t = item.ticker;
    var info = priceAlerts[t];
    var pct = info ? info.pct : null;
    var price = info ? info.price : null;
    var absPct = pct !== null ? Math.abs(pct) : null;
    var triggered = absPct !== null && absPct >= threshold;
    var pctColor = pct === null ? 'var(--dim)' : pct >= 0 ? 'var(--green)' : 'var(--red)';
    var pctStr = pct === null ? '—' : (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
    var priceStr = price ? '$' + (price >= 1000 ? price.toLocaleString('en-US', {maximumFractionDigits:2}) : price < 1 ? price.toFixed(5) : price.toFixed(2)) : '—';
    var lastChecked = info && info.time ? timeAgoAlerts(info.time) : (ua ? 'не перевірялось' : 'not checked');

    html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--surface2);border-radius:var(--r);' +
      (triggered ? 'border:1px solid ' + (pct >= 0 ? 'var(--green-border)' : 'var(--red-border,rgba(220,38,38,0.35))') + ';' : '') + '">' +
      '<span style="font-family:var(--mono);font-size:12px;font-weight:500;color:var(--green);min-width:70px">' + t + '</span>' +
      '<span style="font-family:var(--mono);font-size:12px;font-weight:500;color:var(--text);flex:1">' + priceStr + '</span>' +
      '<span style="font-family:var(--mono);font-size:12px;font-weight:500;color:' + pctColor + ';min-width:70px;text-align:right">' + pctStr + '</span>' +
      (triggered ? '<span style="font-size:14px">' + (pct >= 0 ? '📈' : '📉') + '</span>' : '') +
      '</div>' +
      '<div style="font-family:var(--mono);font-size:9px;color:var(--dim);padding:0 10px 4px">' + lastChecked + '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function timeAgoAlerts(ts) {
  var diff = Math.floor((Date.now() - ts) / 60000);
  var ua = lang === 'ua';
  if (diff < 1)  return ua ? 'щойно' : 'just now';
  if (diff < 60) return diff + (ua ? ' хв тому' : 'm ago');
  return Math.floor(diff / 60) + (ua ? ' год тому' : 'h ago');
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

// ── Portfolio ─────────────────────────────────────────────────────────────────
function savePortfolio() { save({ portfolio: portfolio }); }

function addPortfolioPosition() {
  var ticker   = document.getElementById('pf-ticker').value.trim().toUpperCase();
  var shares   = parseFloat(document.getElementById('pf-shares').value.replace(',', '.'));
  var buyPrice = parseFloat(document.getElementById('pf-buyprice').value.replace(',', '.'));
  if (!ticker || isNaN(shares) || shares <= 0 || isNaN(buyPrice) || buyPrice <= 0) {
    toast(lang === 'ua' ? '⚠ Заповни всі поля' : '⚠ Fill all fields');
    return;
  }
  portfolio.push({ ticker: ticker, shares: shares, buyPrice: buyPrice, addedAt: Date.now() });
  savePortfolio();
  document.getElementById('pf-ticker').value = '';
  document.getElementById('pf-shares').value = '';
  document.getElementById('pf-buyprice').value = '';
  document.getElementById('pf-ticker').focus();
  renderPortfolio();
  toast(lang === 'ua' ? '✓ Додано ' + ticker : '✓ Added ' + ticker);
}

function removePortfolioPosition(idx) {
  portfolio.splice(idx, 1);
  savePortfolio();
  renderPortfolio();
}

function renderPortfolio() {
  var listEl = document.getElementById('portfolio-list');
  var summEl = document.getElementById('portfolio-summary');

  if (!portfolio.length) {
    summEl.style.display = 'none';
    listEl.innerHTML = '<div class="empty"><div class="empty-icon">💼</div><p>' +
      (lang === 'ua' ? 'Портфель порожній.<br>Додай першу позицію вище.' : 'Portfolio is empty.<br>Add your first position above.') +
      '</p></div>';
    return;
  }

  // Render rows with placeholders, then fetch prices
  var html = '';
  portfolio.forEach(function(p, i) {
    html += '<div class="pf-row" id="pf-row-' + i + '">' +
      '<span class="pf-ticker">' + p.ticker + '</span>' +
      '<div class="pf-info">' +
        '<div class="pf-shares">' + p.shares + ' ' + (lang === 'ua' ? 'акцій' : 'shares') + ' · $' + p.buyPrice.toFixed(2) + '</div>' +
        '<div class="pf-prices" id="pf-price-' + i + '" style="color:var(--dim)">—</div>' +
      '</div>' +
      '<div class="pf-pl" id="pf-pl-' + i + '" style="color:var(--dim)">—</div>' +
      '<button class="pf-remove" data-idx="' + i + '">✕</button>' +
    '</div>';
  });
  listEl.innerHTML = html;

  listEl.querySelectorAll('.pf-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      removePortfolioPosition(parseInt(this.getAttribute('data-idx')));
    });
  });

  // Fetch current prices and compute P&L
  var totalInvested = 0, totalCurrent = 0;
  var pending = portfolio.length;

  portfolio.forEach(function(p, i) {
    totalInvested += p.shares * p.buyPrice;

    cacheGet('price_' + p.ticker, CACHE_PRICE_TTL, function(cached) {
      function applyPfPrice(d) {
        if (!d || !d.c || d.c === 0) { pending--; updateSummary(); return; }
        var curPrice = d.c;
        var invested = p.shares * p.buyPrice;
        var current  = p.shares * curPrice;
        var pl       = current - invested;
        var plPct    = invested > 0 ? (pl / invested * 100) : 0;
        var up       = pl >= 0;
        var color    = up ? 'var(--green)' : 'var(--red)';
        var sign     = up ? '+' : '';

        var priceEl = document.getElementById('pf-price-' + i);
        var plEl    = document.getElementById('pf-pl-' + i);
        if (priceEl) {
          priceEl.textContent = '$' + formatPrice(curPrice) + ' зараз';
          priceEl.style.color = 'var(--text)';
        }
        if (plEl) {
          plEl.innerHTML = '<span style="color:' + color + '">' + sign + '$' + Math.round(Math.abs(pl)).toLocaleString() + '</span>' +
            '<br><span style="font-size:10px;color:' + color + '">' + sign + plPct.toFixed(1) + '%</span>';
        }
        totalCurrent += current;
        pending--;
        updateSummary();
      }

      if (cached) { applyPfPrice(cached); return; }
      fetch(WORKER_URL + '/price?ticker=' + p.ticker)
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.c && d.c > 0) cacheSet('price_' + p.ticker, d);
          applyPfPrice(d);
        })
        .catch(function() { pending--; updateSummary(); });
    });
  });

  function updateSummary() {
    if (pending > 0) return;
    var pl    = totalCurrent - totalInvested;
    var plPct = totalInvested > 0 ? (pl / totalInvested * 100) : 0;
    var up    = pl >= 0;
    var color = up ? 'var(--green)' : 'var(--red)';
    var sign  = up ? '+' : '';
    summEl.style.display = 'block';
    summEl.innerHTML = '<div class="pf-summary-row">' +
      '<div class="pf-sum-item"><div class="pf-sum-lbl">' + (lang === 'ua' ? 'Вкладено' : 'Invested') + '</div><div class="pf-sum-val" style="color:var(--text)">$' + Math.round(totalInvested).toLocaleString() + '</div></div>' +
      '<div class="pf-sum-item"><div class="pf-sum-lbl">' + (lang === 'ua' ? 'Зараз' : 'Current') + '</div><div class="pf-sum-val" style="color:var(--text)">$' + Math.round(totalCurrent).toLocaleString() + '</div></div>' +
      '<div class="pf-sum-item"><div class="pf-sum-lbl">P&L</div><div class="pf-sum-val" style="color:' + color + '">' + sign + '$' + Math.round(Math.abs(pl)).toLocaleString() + ' (' + sign + plPct.toFixed(1) + '%)</div></div>' +
    '</div>';
  }
}

// ── News ──────────────────────────────────────────────────────────────────────
var CACHE_NEWS_TTL = 15 * 60 * 1000; // 15 хв
var currentNewsTicker = '';

function initNews() {
  renderNewsPills();
  // Auto-load news for current ticker if analyzed
  if (currentTicker) {
    document.getElementById('news-input').value = currentTicker;
    fetchNews(currentTicker);
  } else if (watchlist.length > 0) {
    fetchNews(watchlist[0].ticker);
  }
}

function renderNewsPills() {
  var el = document.getElementById('news-pills');
  if (!watchlist.length) { el.innerHTML = ''; return; }
  var html = '';
  watchlist.slice(0, 6).forEach(function(w) {
    var active = w.ticker === currentNewsTicker ? ' active' : '';
    html += '<button class="news-pill' + active + '" data-ticker="' + w.ticker + '">' + w.ticker + '</button>';
  });
  el.innerHTML = html;
  el.querySelectorAll('.news-pill').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.getElementById('news-input').value = this.getAttribute('data-ticker');
      fetchNews(this.getAttribute('data-ticker'));
    });
  });
}

function fetchNews(ticker) {
  if (!ticker) return;
  currentNewsTicker = ticker;
  document.getElementById('news-input').value = ticker;

  // Update pill active state
  document.querySelectorAll('.news-pill').forEach(function(p) {
    p.classList.toggle('active', p.getAttribute('data-ticker') === ticker);
  });

  var listEl  = document.getElementById('news-list');
  var emptyEl = document.getElementById('news-empty');
  listEl.style.display = 'none';
  emptyEl.style.display = 'block';
  document.getElementById('lbl-news-empty').textContent = lang === 'ua' ? 'Завантаження...' : 'Loading...';

  cacheGet('news_' + ticker, CACHE_NEWS_TTL, function(cached) {
    if (cached) { renderNews(ticker, cached); return; }
    fetch(WORKER_URL + '/news?ticker=' + encodeURIComponent(ticker))
      .then(function(r) { return r.json(); })
      .then(function(articles) {
        if (Array.isArray(articles)) cacheSet('news_' + ticker, articles);
        renderNews(ticker, Array.isArray(articles) ? articles : []);
      })
      .catch(function() { renderNews(ticker, []); });
  });
}

function renderNews(ticker, articles) {
  var listEl  = document.getElementById('news-list');
  var emptyEl = document.getElementById('news-empty');

  if (!articles.length) {
    listEl.style.display = 'none';
    emptyEl.style.display = 'block';
    document.getElementById('lbl-news-empty').textContent = lang === 'ua'
      ? 'Новин не знайдено для ' + ticker
      : 'No news found for ' + ticker;
    return;
  }

  emptyEl.style.display = 'none';
  listEl.style.display  = 'flex';

  var html = '';
  articles.forEach(function(n, i) {
    var ago = timeAgoNews(n.datetime);
    var src = n.source ? escHtml(n.source) : '—';
    var headline = escHtml(n.headline || '');
    var summary  = n.summary ? escHtml(n.summary) : '';
    var clickable = n.url ? ' data-url="' + escHtml(n.url) + '" style="cursor:pointer"' : '';
    html += '<div class="news-item"' + clickable + ' data-idx="' + i + '">' +
      '<div class="news-meta"><span>' + src + '</span><span>' + ago + '</span></div>' +
      '<div class="news-headline">' + headline + '</div>' +
      (summary ? '<div class="news-summary">' + summary + '</div>' : '') +
      (n.url ? '<div class="news-read">' + (lang === 'ua' ? 'Читати статтю →' : 'Read article →') + '</div>' : '') +
    '</div>';
  });
  listEl.innerHTML = html;

  // Attach click handlers via JS (CSP forbids inline onclick in extensions)
  listEl.querySelectorAll('.news-item[data-url]').forEach(function(item) {
    item.addEventListener('click', function() {
      chrome.tabs.create({ url: this.getAttribute('data-url') });
    });
  });
}

function timeAgoNews(ts) {
  if (!ts) return '';
  var diff = Math.floor((Date.now() / 1000 - ts) / 60);
  if (diff < 60)   return diff + (lang === 'ua' ? ' хв тому' : 'm ago');
  if (diff < 1440) return Math.floor(diff / 60) + (lang === 'ua' ? ' год тому' : 'h ago');
  return Math.floor(diff / 1440) + (lang === 'ua' ? ' дн тому' : 'd ago');
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
