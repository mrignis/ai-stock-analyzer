'use strict';

// ── News ──────────────────────────────────────────────────────────────────────
// Extracted from popup.js (multi-script split). Shares the global scope; loaded
// before popup.js. Deps: WORKER_URL, currentTicker, watchlist, lang (popup.js),
// cacheGet/cacheSet, escHtml (core.js) — all resolved at runtime.

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
  document.getElementById('lbl-news-empty').textContent = L('Завантаження...', 'Loading...', 'Chargement...');

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
    document.getElementById('lbl-news-empty').textContent = L('Новин не знайдено для ' + ticker, 'No news found for ' + ticker, 'Aucune actualité pour ' + ticker);
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
      (n.url ? '<div class="news-read">' + (L('Читати статтю →', 'Read article →', "Lire l'article →")) + '</div>' : '') +
    '</div>';
  });
  listEl.innerHTML = html;

  // Enrich with AI sentiment in the background — news paints instantly, mood
  // (overall banner + per-headline bull/bear tint) fills in when the AI replies.
  fetchNewsMood(ticker);

  // Attach click handlers via JS (CSP forbids inline onclick in extensions)
  listEl.querySelectorAll('.news-item[data-url]').forEach(function(item) {
    item.addEventListener('click', function() {
      // Defense-in-depth: only open http(s) URLs. A compromised news API
      // could return javascript:/data: — never hand those to tabs.create.
      var u = this.getAttribute('data-url');
      if (/^https?:\/\//i.test(u)) chrome.tabs.create({ url: u });
    });
  });
}

// ── AI news sentiment (bull/bear/neutral per headline + overall mood) ─────────
// Non-blocking enrichment of the news list. Worker /news-sentiment runs one AI
// call per ticker (cached 30 min). Codes come back language-agnostic; localized
// here. All values are our own codes (no AI free-text into innerHTML).
var SENT_C = { bull: 'var(--green)', bear: 'var(--red)', neutral: 'var(--muted)' };
function sentWord(s) {
  return s === 'bull' ? L('Бичача', 'Bullish', 'Haussière')
       : s === 'bear' ? L('Ведмежа', 'Bearish', 'Baissière')
       : L('Нейтральна', 'Neutral', 'Neutre');
}
function moodWord(o) {
  return o === 'bullish' ? L('Бичачий', 'Bullish', 'Haussier')
       : o === 'bearish' ? L('Ведмежий', 'Bearish', 'Baissier')
       : L('Нейтральний', 'Neutral', 'Neutre');
}
function fetchNewsMood(ticker) {
  cacheGet('mood_' + ticker, CACHE_NEWS_TTL, function(cached) {
    if (cached) { applyNewsMood(ticker, cached); return; }
    fetch(WORKER_URL + '/news-sentiment?ticker=' + encodeURIComponent(ticker))
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d && (d.overall || (d.items && d.items.length))) cacheSet('mood_' + ticker, d); applyNewsMood(ticker, d); })
      .catch(function() {});
  });
}
function applyNewsMood(ticker, d) {
  if (currentNewsTicker !== ticker || !d) return; // user switched tickers
  var listEl = document.getElementById('news-list');
  if (!listEl || listEl.style.display === 'none') return;
  // Overall mood banner at the top (idempotent — reuse if present)
  if (d.overall) {
    var col = SENT_C[d.overall === 'bullish' ? 'bull' : d.overall === 'bearish' ? 'bear' : 'neutral'];
    var banner = document.getElementById('news-mood');
    if (!banner) { banner = document.createElement('div'); banner.id = 'news-mood'; banner.className = 'news-mood'; listEl.insertBefore(banner, listEl.firstChild); }
    banner.style.color = col;
    banner.innerHTML = '📊 ' + escHtml(L('Настрій новин: ', 'News mood: ', 'Humeur : ')) + '<b>' + escHtml(moodWord(d.overall)) + '</b>';
  }
  // Per-headline tint + a small colored tag
  var map = {}; (d.items || []).forEach(function(it) { if (it.sentiment) map[it.headline] = it.sentiment; });
  listEl.querySelectorAll('.news-item').forEach(function(item) {
    var h = item.querySelector('.news-headline'); if (!h) return;
    var s = map[h.textContent]; if (!s) return;
    item.style.borderLeft = '2px solid ' + (s === 'neutral' ? 'var(--border2)' : SENT_C[s]);
    item.style.paddingLeft = '8px';
    if (!h.querySelector('.news-sent')) {
      // A colored arrow before the headline (▲ bull / ▼ bear / • neutral) +
      // title tooltip with the word — no layout disruption to the meta row.
      var dot = document.createElement('span');
      dot.className = 'news-sent';
      dot.style.cssText = 'color:' + SENT_C[s] + ';font-weight:700;margin-right:5px';
      dot.title = sentWord(s);
      dot.textContent = s === 'bull' ? '▲' : s === 'bear' ? '▼' : '•';
      h.insertBefore(dot, h.firstChild);
    }
  });
}

// Home-screen market news — fills the empty space below "Popular".
// Cached client-side ~15 min; worker edge-caches 5 min on top.
function loadMarketNews() {
  var box = document.getElementById('home-news-items');
  if (!box) return;
  cacheGet('marketnews', CACHE_NEWS_TTL, function(cached) {
    if (cached) { renderMarketNews(cached); return; }
    fetch(WORKER_URL + '/market-news')
      .then(function(r) { return r.json(); })
      .then(function(arr) {
        if (Array.isArray(arr) && arr.length) cacheSet('marketnews', arr);
        renderMarketNews(Array.isArray(arr) ? arr : []);
      })
      .catch(function() {});
  });
}

function renderMarketNews(articles) {
  var box = document.getElementById('home-news-items');
  if (!box) return;
  if (!articles.length) { document.getElementById('home-news').style.display = 'none'; return; }
  var html = '';
  articles.slice(0, 6).forEach(function(n) {
    var ago = timeAgoNews(n.datetime);
    var src = n.source ? escHtml(n.source) : '';
    var clickable = n.url ? ' data-url="' + escHtml(n.url) + '" style="cursor:pointer"' : '';
    html += '<div class="news-item"' + clickable + '>' +
      '<div class="news-meta"><span>' + src + '</span><span>' + ago + '</span></div>' +
      '<div class="news-headline">' + escHtml(n.headline || '') + '</div>' +
    '</div>';
  });
  box.innerHTML = html;
  box.querySelectorAll('.news-item[data-url]').forEach(function(item) {
    item.addEventListener('click', function() {
      var u = this.getAttribute('data-url');
      if (/^https?:\/\//i.test(u)) chrome.tabs.create({ url: u });
    });
  });
}

function timeAgoNews(ts) {
  if (!ts) return '';
  var diff = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 60));
  if (diff < 60)   return diff + (L(' хв тому', 'm ago', ' min'));
  if (diff < 1440) return Math.floor(diff / 60) + (L(' год тому', 'h ago', ' h'));
  return Math.floor(diff / 1440) + (L(' дн тому', 'd ago', ' j'));
}
