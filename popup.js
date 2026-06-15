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

// ── Market, Watchlist, History → popup-lists.js ────────────────────────────────

// ── Toast (shared utility) ──────────────────────────────────────────────────────
function toast(msg) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:var(--green);color:#0a0f0a;font-family:var(--mono);font-size:11px;padding:6px 16px;border-radius:20px;z-index:999;pointer-events:none';
  t.textContent = msg; document.body.appendChild(t); setTimeout(function() { t.remove(); }, 2000);
}

// ── News → popup-news.js ──────────────────────────────────────────────────────

// ── Alerts & Price targets ─────────────────────────────────────────────────────
// Moved to popup-alerts.js (multi-script split, loaded before popup.js).
