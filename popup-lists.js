'use strict';

// ── Market, Watchlist, History ─────────────────────────────────────────────────
// Extracted from popup.js (multi-script split). Shares global scope; loaded
// before popup.js. Deps (runtime): WORKER_URL, watchlist, historyList,
// currentTicker, currentData, lang (popup.js); cacheGet/cacheSet/save/fmtMoney
// (core.js); drawSpark (popup-charts.js); loadLivePriceSWR/applyPriceToElements/
// pillClass/normalizeVerdict/normalizeSector (popup-analysis.js); runAnalysis
// (popup-analysis.js); showPanel (popup.js). All called only after DOMContentLoaded.

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
  // User picks which stocks show on home by starring them in the watchlist
  // (w.home). Show ALL starred (up to 12 — their explicit choice, not just the
  // first 6). If none are starred, fall back to the first 6 (prior behaviour).
  var pinned = watchlist.filter(function(w) { return w.home; });
  var shown = pinned.length ? pinned.slice(0, 12) : watchlist.slice(0, 6);
  var html = '';
  shown.forEach(function(w) {
    var pill = pillClass(w.color);
    html += '<div class="hwl-item" data-ticker="' + w.ticker + '">' +
      '<span class="hwl-ticker">' + w.ticker + '</span>' +
      '<span class="hwl-price" id="hwp-' + w.ticker + '" style="color:var(--dim)">—</span>' +
      '<canvas class="hwl-spark" id="hwspark-' + w.ticker + '"></canvas>' +
      '<span class="hwl-pct" id="hwpc-' + w.ticker + '"></span>' +
      '<span class="verdict-pill ' + pill + '" style="font-size:9px">' + escHtml(normalizeVerdict(w.verdict||'', lang)) + '</span>' +
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

// ── Watchlist ─────────────────────────────────────────────────────────────────
function isInWatch(t) { for (var i = 0; i < watchlist.length; i++) if (watchlist[i].ticker === t) return true; return false; }
function updateWatchBtn() {
  var btn = document.getElementById('watch-btn');
  if (!currentTicker) return;
  if (isInWatch(currentTicker)) { btn.textContent = L('✓ В списку', '✓ Added', '✓ Ajouté'); btn.classList.add('added'); }
  else { btn.textContent = L('+ Список', '+ Watchlist', '+ Liste'); btn.classList.remove('added'); }
}
function toggleWatch() {
  if (!currentTicker || !currentData) return;
  if (isInWatch(currentTicker)) { watchlist = watchlist.filter(function(w) { return w.ticker !== currentTicker; }); }
  // Store BOTH verdict and sector in a canonical language (EN) so switching the UI
  // language later re-localizes them — otherwise a stock added while analyzing in
  // UA kept its Ukrainian sector forever (Pylyp: BTC "Фінансовий" in EN mode).
  else { watchlist.push({ ticker: currentTicker, sector: normalizeSector(currentData.sector || '', 'en'), verdict: normalizeVerdict(currentData.verdict || '', 'en'), color: currentData.color, t: Date.now() }); }
  save({ watchlist: watchlist }); updateWatchBtn();
}
function renderWatchlist() {
  var el = document.getElementById('watchlist-content');
  if (!watchlist.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><p>' + L('Список порожній.', 'Watchlist is empty.', 'Liste vide.') + '</p></div>';
    return;
  }
  // Hint so users discover the star picks what shows on the home screen.
  var html = '<div style="font-size:10px;color:var(--muted);padding:2px 4px 8px;font-family:var(--mono)">' +
    L('★ — обрати для головної', '★ — pick for home screen', "★ — choisir pour l'accueil") + '</div>';
  for (var i = 0; i < watchlist.length; i++) {
    var w = watchlist[i];
    var pill = pillClass(w.color);
    var star = w.home ? '★' : '☆';
    // Gold filled / clearly-visible empty star — the old var(--dim) ☆ was almost
    // invisible on the dark background, so users never noticed they could pick
    // which stocks show on home (Pylyp). Brighter + bigger so it reads as a toggle.
    var starTitle = L('Показувати на головній', 'Show on home screen', "Afficher sur l'accueil");
    html += '<div class="watch-item" data-ticker="' + w.ticker + '">' +
      '<button class="watch-star" data-ticker="' + w.ticker + '" title="' + starTitle + '" ' +
        'style="background:none;border:none;cursor:pointer;font-size:17px;line-height:1;padding:0 5px;color:' + (w.home ? 'var(--yellow)' : 'var(--muted)') + '">' + star + '</button>' +
      '<span class="watch-ticker">' + w.ticker + '</span>' +
      '<div class="watch-info"><div class="watch-sector">' + escHtml(normalizeSector(w.sector || '', lang)) + '</div></div>' +
      '<span class="watch-price" id="wp-' + w.ticker + '" style="color:var(--dim)">—</span>' +
      '<span class="watch-pct" id="wpc-' + w.ticker + '"></span>' +
      '<span class="verdict-pill ' + pill + '">' + escHtml(normalizeVerdict(w.verdict || '', lang)) + '</span>' +
      '<button class="watch-remove" data-ticker="' + w.ticker + '">✕</button>' +
    '</div>';
  }
  el.innerHTML = html;

  var items = el.querySelectorAll('.watch-item');
  for (var i = 0; i < items.length; i++) {
    items[i].addEventListener('click', function(e) {
      if (e.target.classList.contains('watch-remove') || e.target.classList.contains('watch-star')) return;
      document.getElementById('ticker-input').value = this.getAttribute('data-ticker');
      showPanel('search'); runAnalysis();
    });
  }
  // Star toggles "show on home" for that ticker
  var stars = el.querySelectorAll('.watch-star');
  for (var i = 0; i < stars.length; i++) {
    stars[i].addEventListener('click', function(e) {
      e.stopPropagation();
      var t = this.getAttribute('data-ticker');
      watchlist.forEach(function(w) { if (w.ticker === t) w.home = !w.home; });
      // Refresh BOTH lists: re-render the home selection immediately, else the
      // star looks like it does nothing until the popup is reopened (Pylyp).
      save({ watchlist: watchlist }); renderWatchlist(); renderHomeWatchlist();
    });
  }
  var removes = el.querySelectorAll('.watch-remove');
  for (var i = 0; i < removes.length; i++) {
    removes[i].addEventListener('click', function(e) {
      e.stopPropagation();
      var t = this.getAttribute('data-ticker');
      watchlist = watchlist.filter(function(w) { return w.ticker !== t; });
      save({ watchlist: watchlist }); renderWatchlist(); renderHomeWatchlist(); updateWatchBtn();
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
  // Store the verdict canonically (EN) so history re-localizes on a language switch
  // (it was stored raw in the analysis language — same bug as the watchlist sector).
  historyList.unshift({ ticker: ticker, color: data.color, verdict: normalizeVerdict(data.verdict || '', 'en'), t: Date.now() });
  if (historyList.length > 20) historyList = historyList.slice(0, 20);
  save({ history: historyList });
}
function renderHistory() {
  var el = document.getElementById('history-content');
  if (!historyList.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">🕐</div><p>' + L('Історія порожня.', 'History is empty.', 'Historique vide.') + '</p></div>'; return; }
  var html = '';
  for (var i = 0; i < historyList.length; i++) {
    var h = historyList[i]; var pill = pillClass(h.color);
    var diff = Math.floor((Date.now() - h.t) / 60000);
    var time = diff < 1    ? L('Щойно', 'Just now', "À l'instant")
             : diff < 60   ? diff + L(' хв', 'm ago', ' min')
             : diff < 1440 ? Math.floor(diff / 60) + L(' год', 'h ago', ' h')
             : Math.floor(diff / 1440) + L(' д', 'd ago', ' j');
    html += '<div class="hist-item" data-ticker="' + h.ticker + '"><span class="hist-ticker">' + h.ticker + '</span><span class="hist-time">' + time + '</span><span class="verdict-pill ' + pill + '">' + escHtml(normalizeVerdict(h.verdict || '', lang)) + '</span></div>';
  }
  el.innerHTML = html;
  var items = el.querySelectorAll('.hist-item');
  for (var i = 0; i < items.length; i++) { items[i].addEventListener('click', function() { document.getElementById('ticker-input').value = this.getAttribute('data-ticker'); showPanel('search'); runAnalysis(); }); }
}
