'use strict';

// ── Replace with your Cloudflare Worker URL after deployment ─────────────────
var WORKER_URL = 'https://stock-ai-analyzer.chelb-dev.workers.dev';

var lang = 'ua';
var theme = 'dark';
var currency = 'USD'; // display currency for all prices
var fxRate = 1;       // USD → currency multiplier (loaded from /fx)
var isTabMode = (new URLSearchParams(window.location.search).get('tab') === '1');
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
var chatSending = false; // guard against concurrent send requests
// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  loadAll(function(s) {
    if (s.lang) lang = s.lang;
    if (s.theme) theme = s.theme;
    // Apply tab mode class so CSS centers the card
    if (isTabMode) {
      document.documentElement.classList.add('tab-mode');
      document.body.classList.add('tab-mode');
    }
    if (s.watchlist) watchlist = s.watchlist;
    if (s.history) historyList = s.history;
    if (s.conversations) conversations = s.conversations;
    if (s.currentConvId) currentConvId = s.currentConvId;
    if (s.portfolio) portfolio = s.portfolio;
    migratePortfolioToLots();
    if (s.currency && CURRENCY_META[s.currency]) currency = s.currency;
    document.getElementById('currency-select').value = currency;
    applyTheme();
    cachePrune(); // clean up stale cache entries on each startup

    // Load current conversation
    if (currentConvId) {
      var conv = conversations.find(function(c) { return c.id === currentConvId; });
      if (conv) {
        chatHistory = conv.messages || [];
        chatContext = conv.context || null;
        document.getElementById('chat-conv-title').textContent = conv.title || 'Діалог';
        if (chatContext) {
          var ticker = chatContext.split(':')[0];
          setCtxBar(ticker);
        }
        chatHistory.forEach(function(msg) {
          appendChatMsg(msg.role === 'assistant' ? 'ai' : 'user', msg.content);
        });
      }
    }

    applyLang();
    loadFxRate(function() {
      fetchMarketData();
      // SWR: cached numbers paint instantly, live fetch replaces them silently
      renderHomeWatchlist();
    });

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
    ['search','watchlist','history','chat','news','alerts','settings'].forEach(function(id) {
      document.getElementById('tab-' + id).addEventListener('click', function() { showPanel(id); });
    });

    document.getElementById('lang-btn').addEventListener('click', function() {
      lang = lang === 'ua' ? 'en' : 'ua';
      save({ lang: lang });
      applyLang();
      renderWatchlist();
      renderHistory();
      initAlerts(); // re-render price targets + last prices in the new language
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
      // Force-clear price cache for all watchlist/portfolio tickers so ↻ always fetches fresh
      var keysToRemove = [];
      watchlist.forEach(function(w) { keysToRemove.push('c_price_' + w.ticker); });
      portfolio.forEach(function(p) { if (!keysToRemove.includes('c_price_' + p.ticker)) keysToRemove.push('c_price_' + p.ticker); });
      chrome.storage.local.remove(keysToRemove, function() {
        if (document.getElementById('portfolio-panel').style.display !== 'none') renderPortfolio();
        else renderWatchlist();
      });
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

    // Alerts — slider live update
    document.getElementById('threshold-slider').addEventListener('input', function() {
      document.getElementById('threshold-value').textContent = this.value + '%';
    });
    document.getElementById('btn-save-threshold').addEventListener('click', function() {
      var val = parseInt(document.getElementById('threshold-slider').value);
      chrome.storage.local.set({ alertThreshold: val }, function() {
        toast(lang === 'ua' ? '✓ Поріг збережено: ' + val + '%' : '✓ Threshold saved: ' + val + '%');
      });
    });
    document.getElementById('btn-add-target').addEventListener('click', addPriceTarget);
    document.getElementById('target-price').addEventListener('keydown', function(e) { if (e.key === 'Enter') addPriceTarget(); });
    document.getElementById('btn-check-now').addEventListener('click', function() {
      chrome.runtime.sendMessage({ action: 'checkNow' }, function() {
        var btn = document.getElementById('btn-check-now');
        btn.textContent = lang === 'ua' ? '✓ Перевірено' : '✓ Checked';
        setTimeout(function() {
          btn.textContent = lang === 'ua' ? '↻ Перевірити' : '↻ Check now';
          // Refresh prices AND targets — fired one-shot targets disappear from the list
          initAlerts();
        }, 1500);
      });
    });

    // Pin as floating window
    document.getElementById('btn-pin-tab').addEventListener('click', function() {
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html'),
        type: 'popup',
        width: 460,
        height: 680,
        focused: true,
      }, function() { window.close(); });
    });

    // Currency select — reload rate, then re-render every visible price surface
    document.getElementById('currency-select').addEventListener('change', function() {
      currency = this.value;
      save({ currency: currency });
      loadFxRate(function() {
        fetchMarketData();
        renderHomeWatchlist();
        renderWatchlist();
        if (document.getElementById('portfolio-panel').style.display !== 'none') renderPortfolio();
        if (currentData && currentData._quote) renderPrice(currentData._quote);
        chrome.storage.local.get(['priceAlerts'], function(s) { renderAlertPrices(s.priceAlerts || {}); });
        toast(currency);
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
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.body.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme');
  }
}

// ── Lang ──────────────────────────────────────────────────────────────────────
function applyLang() {
  var ua = lang === 'ua';
  // Shows the CURRENT language (cousin's UX feedback) — click switches
  document.getElementById('lang-btn').textContent = ua ? 'UA' : 'EN';
  // Full words instead of WL/Hist. — accessibility feedback
  document.getElementById('tab-search').textContent = ua ? 'Пошук' : 'Search';
  document.getElementById('tab-watchlist').textContent = ua ? 'Список' : 'Watchlist';
  document.getElementById('tab-history').textContent = ua ? 'Історія' : 'History';
  document.getElementById('analyze-btn').textContent = ua ? 'Аналіз' : 'Analyze';
  document.getElementById('lbl-popular').textContent = ua ? 'Популярні:' : 'Popular:';
  document.getElementById('lbl-market').textContent = ua ? 'Ринок' : 'Market';
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
  document.getElementById('target-label').textContent = ua ? '🎯 Цінові цілі:' : '🎯 Price targets:';
  document.getElementById('btn-add-target').textContent = ua ? '+ Додати ціль' : '+ Add target';
  var tdSel = document.getElementById('target-dir');
  tdSel.options[0].text = ua ? 'впаде нижче' : 'falls below';
  tdSel.options[1].text = ua ? 'зросте вище' : 'rises above';
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
  var lblBmac = document.getElementById('lbl-bmac');
  if (lblBmac) lblBmac.textContent = ua ? 'Підтримати проект' : 'Support the project';
  var lblCurrency = document.getElementById('lbl-currency');
  if (lblCurrency) lblCurrency.textContent = ua ? '💱 Валюта цін' : '💱 Price currency';
  var lblPin = document.getElementById('lbl-pin');
  if (lblPin) lblPin.textContent = ua ? '📌 Відкрити у вікні' : '📌 Open in window';
  var btnPin = document.getElementById('btn-pin-tab');
  if (btnPin) btnPin.textContent = ua ? '↗ Відкрити' : '↗ Open';
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
// Drops cached prices for the given tickers so the next render fetches fresh
function freshPrices(tickers, cb) {
  var keys = [];
  tickers.forEach(function(t) {
    if (keys.indexOf('c_price_' + t) === -1) keys.push('c_price_' + t);
  });
  if (!keys.length) { cb(); return; }
  chrome.storage.local.remove(keys, cb);
}

function showPanel(id) {
  var panels = document.querySelectorAll('.panel');
  for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
  var tabs = document.querySelectorAll('.nav-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  document.getElementById('panel-' + id).classList.add('active');
  document.getElementById('tab-' + id).classList.add('active');
  // Panels show cached prices instantly and refresh live (SWR). Portfolio
  // keeps explicit cache clearing — its P&L math can't take double callbacks.
  var wlTickers = watchlist.map(function(w) { return w.ticker; });
  if (id === 'search') {
    renderHomeWatchlist();
    fetchMarketData();
  }
  if (id === 'watchlist') {
    var pfVisible = document.getElementById('portfolio-panel').style.display !== 'none';
    if (pfVisible) {
      var pfTickers = portfolio.map(function(p) { return p.ticker; });
      freshPrices(pfTickers, renderPortfolio);
    } else {
      renderWatchlist();
    }
  }
  if (id === 'history') renderHistory();
  if (id === 'news') initNews();
  if (id === 'alerts') freshPrices(wlTickers, initAlerts);
}

// ── Market Overview ───────────────────────────────────────────────────────────
function fetchMarketData() {
  // Stale-while-revalidate: cached cards appear instantly, then a fresh
  // fetch silently updates them — popup open always ends with live data
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
    var price = fmtMoney(d.c);
    html += '<div class="mcard" data-card="' + k + '" style="cursor:pointer" title="Аналіз ' + CARD_TICKERS[k] + '">' +
      '<div class="mcard-label">' + icons[k] + ' ' + d.label + '</div>' +
      '<div class="mcard-price">' + price + '</div>' +
      '<div class="mcard-pct" style="color:' + color + '">' + (up?'▲':'▼') + Math.abs(d.pct).toFixed(2) + '%</div>' +
      '<canvas class="mcard-spark" id="spark-' + k + '"></canvas>' +
    '</div>';
  });
  var el = document.getElementById('market-cards');
  if (!el) return;
  el.innerHTML = html;

  // Mini trend sparklines (cousin's "fill the gap with graphs" feedback) —
  // 30-day candles, 30-min cached so the home screen loads them only once
  keys.forEach(function(k) {
    if (!data[k]) return;
    var ticker = CARD_TICKERS[k];
    var up = data[k].pct >= 0;
    cacheGet('candle_' + ticker, CACHE_CANDLE_TTL, function(cached) {
      if (cached) { drawSpark('spark-' + k, cached, up); return; }
      fetch(WORKER_URL + '/candle?ticker=' + ticker)
        .then(function(r) { return r.json(); })
        .then(function(c) {
          if (c.c && c.c.length >= 2) {
            cacheSet('candle_' + ticker, c.c);
            drawSpark('spark-' + k, c.c, up);
          }
        })
        .catch(function() {});
    });
  });

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
  // Show more of the user's curated list (was 4) so home fills the gap —
  // the watchlist IS the chosen set, so add/remove there controls home
  var shown = watchlist.slice(0, 6);
  var html = '';
  shown.forEach(function(w) {
    var pill = pillClass(w.color);
    html += '<div class="hwl-item" data-ticker="' + w.ticker + '">' +
      '<span class="hwl-ticker">' + w.ticker + '</span>' +
      '<span class="hwl-price" id="hwp-' + w.ticker + '" style="color:var(--dim)">—</span>' +
      '<canvas class="hwl-spark" id="hwspark-' + w.ticker + '"></canvas>' +
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

  // Fetch live prices (with cache) + draw a mini trend sparkline per row
  shown.forEach(function(w) {
    loadLivePriceSWR(w.ticker, function(d) {
      applyPriceToElements(d, 'hwp-' + w.ticker, 'hwpc-' + w.ticker);
    });
    cacheGet('candle_' + w.ticker, CACHE_CANDLE_TTL, function(cached) {
      if (cached && cached.length >= 2) {
        drawSpark('hwspark-' + w.ticker, cached, cached[cached.length - 1] >= cached[0]);
        return;
      }
      fetch(WORKER_URL + '/candle?ticker=' + w.ticker)
        .then(function(r) { return r.json(); })
        .then(function(c) {
          if (c.c && c.c.length >= 2) {
            cacheSet('candle_' + w.ticker, c.c);
            drawSpark('hwspark-' + w.ticker, c.c, c.c[c.c.length - 1] >= c.c[0]);
          }
        })
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
    // Auto-abort after 65s: at peak hours Groq free tier queues requests
    // (measured 58s on QQQ) — better to wait than to drop a near-ready result
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
        // Seed price cache from _quote (fresh, just fetched by /analyze)
        // so fetchFreshPrice doesn't make a redundant /price call
        if (data._quote && data._quote.c > 0) cacheSet('price_' + realT, data._quote);
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
    var pill = pillClass(w.color);
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
    loadLivePriceSWR(w.ticker, function(d) {
      applyPriceToElements(d, 'wp-' + w.ticker, 'wpc-' + w.ticker);
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
    var h = historyList[i]; var pill = pillClass(h.color);
    var diff = Math.floor((Date.now() - h.t) / 60000);
    var time = diff < 1    ? (lang === 'ua' ? 'Щойно' : 'Just now')
             : diff < 60   ? diff + (lang === 'ua' ? ' хв' : 'm ago')
             : diff < 1440 ? Math.floor(diff / 60) + (lang === 'ua' ? ' год' : 'h ago')
             : Math.floor(diff / 1440) + (lang === 'ua' ? ' д' : 'd ago');
    html += '<div class="hist-item" data-ticker="' + h.ticker + '"><span class="hist-ticker">' + h.ticker + '</span><span class="hist-time">' + time + '</span><span class="verdict-pill ' + pill + '">' + normalizeVerdict(h.verdict || '', lang) + '</span></div>';
  }
  el.innerHTML = html;
  var items = el.querySelectorAll('.hist-item');
  for (var i = 0; i < items.length; i++) { items[i].addEventListener('click', function() { document.getElementById('ticker-input').value = this.getAttribute('data-ticker'); showPanel('search'); runAnalysis(); }); }
}

// ── Toast (shared utility) ──────────────────────────────────────────────────────
function toast(msg) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:var(--green);color:#0a0f0a;font-family:var(--mono);font-size:11px;padding:6px 16px;border-radius:20px;z-index:999;pointer-events:none';
  t.textContent = msg; document.body.appendChild(t); setTimeout(function() { t.remove(); }, 2000);
}

// ── News ──────────────────────────────────────────────────────────────────────
// Moved to popup-news.js (multi-script split, loaded before popup.js).

// ── Alerts & Price targets ─────────────────────────────────────────────────────
// Moved to popup-alerts.js (multi-script split, loaded before popup.js).
