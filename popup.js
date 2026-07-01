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
var conversations = []; // [{id, title, messages}]
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
        document.getElementById('chat-conv-title').textContent = conv.title || 'Діалог';
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
    loadMarketNews(); // fills the home gap with market headlines

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
      lang = lang === 'ua' ? 'en' : lang === 'en' ? 'fr' : 'ua'; // cycle UA→EN→FR
      save({ lang: lang });
      applyLang();
      renderWatchlist();
      renderHomeWatchlist(); // home "Список" verdicts/labels must switch language too
      updateWatchBtn();      // "+ Список" / "✓ В списку" button text follows the language
      // Portfolio renders its own labels (акцій/shares, Сьогодні/Today) — must
      // re-render too, or it stays in the old language while static labels switch
      if (document.getElementById('portfolio-panel').style.display !== 'none') renderPortfolio();
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
    document.getElementById('btn-new-chat').addEventListener('click', newChat);
    document.getElementById('btn-conv-list').addEventListener('click', toggleConvList);

    // Alerts — slider live update
    document.getElementById('threshold-slider').addEventListener('input', function() {
      document.getElementById('threshold-value').textContent = this.value + '%';
    });
    document.getElementById('btn-save-threshold').addEventListener('click', function() {
      var val = parseInt(document.getElementById('threshold-slider').value);
      chrome.storage.local.set({ alertThreshold: val }, function() {
        toast(L('✓ Поріг збережено: ' + val + '%', '✓ Threshold saved: ' + val + '%', '✓ Seuil enregistré : ' + val + '%'));
      });
    });
    document.getElementById('btn-add-target').addEventListener('click', addPriceTarget);
    document.getElementById('notif-toggle').addEventListener('click', toggleNotifications);
    document.getElementById('target-price').addEventListener('keydown', function(e) { if (e.key === 'Enter') addPriceTarget(); });
    document.getElementById('btn-check-now').addEventListener('click', function() {
      chrome.runtime.sendMessage({ action: 'checkNow' }, function() {
        var btn = document.getElementById('btn-check-now');
        btn.textContent = L('✓ Перевірено', '✓ Checked', '✓ Vérifié');
        setTimeout(function() {
          btn.textContent = L('↻ Перевірити', '↻ Check now', '↻ Vérifier');
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
// Data table for applyLang(): [elementId, ua, en, prop?].
// prop defaults to 'textContent' (also 'placeholder' / 'title').
var I18N_LABELS = [
  ['lang-btn', 'UA', 'EN'],                 // shows the CURRENT language; click switches
  ['tab-search', 'Пошук', 'Search'],
  ['tab-watchlist', 'Список', 'Watchlist'],
  ['tab-history', 'Історія', 'History'],
  ['analyze-btn', 'Аналіз', 'Analyze'],
  ['lbl-popular', 'Популярні:', 'Popular:'],
  ['lbl-market', 'Ринок', 'Market'],
  ['lbl-home-wl', 'Список', 'Watchlist'],
  ['lbl-home-news', 'Новини ринку', 'Market news'],
  ['r-disclaimer', 'Не є фінансовою порадою.', 'Not financial advice.'],
  ['lbl-sector', 'Сектор', 'Sector'],
  ['lbl-risk', 'Ризик', 'Risk'],
  ['lbl-trend', 'Тренд', 'Trend'],
  ['lbl-for', 'Для кого', 'Best for'],
  ['lbl-chart', 'Тренд (30д)', 'Trend (30d)'],
  ['lbl-what', 'Що робить компанія', 'What the company does'],
  ['lbl-risks', 'Головні ризики', 'Key risks'],
  ['lbl-forecast', 'AI Прогноз', 'AI Forecast'],
  ['lbl-conclusion', 'Висновок AI', 'AI Conclusion'],
  ['wl-tab-wl', 'WL', 'WL'],
  ['wl-tab-pf', '💼 Портфель', '💼 Portfolio'],
  ['lbl-add-position', 'Додати позицію', 'Add position'],
  ['pf-add-btn', '+ Додати', '+ Add'],
  ['lbl-history-title', 'Історія пошуків', 'Search History'],
  ['btn-clear', 'Очистити', 'Clear'],
  ['lbl-alerts-title', 'Алерти цін', 'Price Alerts'],
  ['lbl-notif', '🔔 Сповіщення', '🔔 Notifications'],
  ['alerts-info', 'Отримуй сповіщення коли акції зі Списку змінюються більше ніж на заданий %.', 'Get notified when Watchlist stocks change more than the set %.'],
  ['threshold-label', 'Поріг сповіщення (% зміни):', 'Alert threshold (% change):'],
  ['target-label', '🎯 Цінові цілі:', '🎯 Price targets:'],
  ['btn-add-target', '+ Додати ціль', '+ Add target'],
  ['btn-save-threshold', 'Зберегти', 'Save'],
  ['btn-check-now', '↻ Перевірити', '↻ Check now'],
  ['lbl-chat-welcome', 'Привіт! Запитай мене про будь-яку акцію або ринок.', 'Hi! Ask me about any stock or market.'],
  ['news-search-btn', 'Пошук', 'Search'],
  ['lbl-news-empty', 'Введи тікер або вибери зі списку', 'Enter a ticker or pick from the list'],
  ['stop-btn', '✕ Стоп', '✕ Stop'],
  ['lbl-bmac', 'Підтримати проект', 'Support the project'],
  ['lbl-currency', '💱 Валюта цін', '💱 Price currency'],
  ['lbl-pin', '📌 Відкрити у вікні', '📌 Open in window'],
  ['btn-pin-tab', '↗ Відкрити', '↗ Open'],
  // placeholders
  ['pf-ticker', 'TSLA', 'TSLA', 'placeholder'],
  ['pf-shares', 'Акцій', 'Shares', 'placeholder'],
  ['pf-buyprice', 'Ціна $', 'Buy price $', 'placeholder'],
  ['chat-input', 'Запитай про TSLA, ринок...', 'Ask about TSLA, market...', 'placeholder'],
  ['news-input', 'TSLA, AAPL...', 'TSLA, AAPL...', 'placeholder'],
  // titles
  ['btn-new-chat', 'Новий діалог', 'New chat', 'title'],
  ['btn-conv-list', 'Діалоги', 'Conversations', 'title']
];

// French UI strings keyed by element id — added alongside the ua/en columns in
// I18N_LABELS so a third language needs one dictionary, not a rewrite of every
// tuple. Missing keys fall back to English.
var FR_LABELS = {
  'lang-btn': 'FR',
  'tab-search': 'Recherche', 'tab-watchlist': 'Liste', 'tab-history': 'Historique',
  'analyze-btn': 'Analyser', 'lbl-popular': 'Populaires :', 'lbl-market': 'Marché',
  'lbl-home-wl': 'Liste', 'lbl-home-news': 'Actualités du marché',
  'r-disclaimer': 'Pas un conseil financier.', 'lbl-sector': 'Secteur', 'lbl-risk': 'Risque',
  'lbl-trend': 'Tendance', 'lbl-for': 'Idéal pour', 'lbl-chart': 'Tendance (30j)',
  'lbl-what': "Ce que fait l'entreprise", 'lbl-risks': 'Risques clés',
  'lbl-forecast': 'Prévision IA', 'lbl-conclusion': 'Conclusion IA',
  'wl-tab-pf': '💼 Portefeuille', 'lbl-add-position': 'Ajouter une position', 'pf-add-btn': '+ Ajouter',
  'lbl-history-title': 'Historique des recherches', 'btn-clear': 'Effacer',
  'lbl-alerts-title': 'Alertes de prix', 'lbl-notif': '🔔 Notifications',
  'alerts-info': 'Recevez une alerte quand une action de la Liste varie de plus du % défini.',
  'threshold-label': "Seuil d'alerte (% de variation) :", 'target-label': '🎯 Objectifs de prix :',
  'btn-add-target': '+ Ajouter un objectif', 'btn-save-threshold': 'Enregistrer', 'btn-check-now': '↻ Vérifier',
  'lbl-chat-welcome': 'Bonjour ! Posez-moi une question sur une action ou le marché.',
  'news-search-btn': 'Recherche', 'lbl-news-empty': 'Saisissez un symbole ou choisissez dans la liste',
  'stop-btn': '✕ Stop', 'lbl-bmac': 'Soutenir le projet', 'lbl-currency': '💱 Devise des prix',
  'lbl-pin': '📌 Ouvrir dans une fenêtre', 'btn-pin-tab': '↗ Ouvrir',
  'pf-shares': 'Actions', 'pf-buyprice': "Prix d'achat $",
  'chat-input': 'Posez une question sur TSLA, le marché...',
  'btn-new-chat': 'Nouveau chat', 'btn-conv-list': 'Conversations',
};

// 3-language string pick: L(ua, en, fr). `lang` is the global code; fr falls back
// to en when not supplied. Used everywhere a UI string was a ua/en ternary.
function L(ua, en, fr) { return lang === 'fr' ? (fr != null ? fr : en) : lang === 'ua' ? ua : en; }

function applyLang() {
  var ua = lang === 'ua';

  // Data-driven labels — one loop replaces ~45 repetitive getElementById lines.
  // Each element is guarded, so a renamed/removed ID is skipped instead of
  // throwing and breaking init. French comes from FR_LABELS (fallback: English).
  for (var i = 0; i < I18N_LABELS.length; i++) {
    var row = I18N_LABELS[i];
    var el = document.getElementById(row[0]);
    if (!el) continue;
    var val = lang === 'fr' ? (FR_LABELS[row[0]] != null ? FR_LABELS[row[0]] : row[2]) : (ua ? row[1] : row[2]);
    el[row[3] || 'textContent'] = val;
  }

  // ── Special cases (more than a plain table lookup) ──
  var tdSel = document.getElementById('target-dir');
  tdSel.options[0].text = L('впаде нижче', 'falls below', 'chute sous');
  tdSel.options[1].text = L('зросте вище', 'rises above', 'monte au-dessus');

  // Update conv title if it's a default one
  var titleEl = document.getElementById('chat-conv-title');
  if (['Новий діалог', 'New chat', 'Nouveau chat'].indexOf(titleEl.textContent) !== -1) {
    titleEl.textContent = L('Новий діалог', 'New chat', 'Nouveau chat');
  }
  // Re-render conv list if visible
  if (convListVisible) renderConvList();
  document.getElementById('settings-version').textContent = 'AI Stock Analyzer v' + chrome.runtime.getManifest().version + ' · Groq Llama 3.3 · Finnhub';

  // Theme labels depend on BOTH theme and language
  var lblTheme = document.getElementById('lbl-theme');
  if (lblTheme) lblTheme.textContent = theme === 'light'
    ? L('☀️ Світла тема', '☀️ Light theme', '☀️ Thème clair')
    : L('🌙 Темна тема', '🌙 Dark theme', '🌙 Thème sombre');
  var themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) themeToggle.textContent = theme === 'light'
    ? L('🌙 Темна', '🌙 Dark', '🌙 Sombre')
    : L('☀️ Світла', '☀️ Light', '☀️ Clair');
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
    loadMarketNews();
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
