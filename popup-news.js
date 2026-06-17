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
      // Defense-in-depth: only open http(s) URLs. A compromised news API
      // could return javascript:/data: — never hand those to tabs.create.
      var u = this.getAttribute('data-url');
      if (/^https?:\/\//i.test(u)) chrome.tabs.create({ url: u });
    });
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
  if (diff < 60)   return diff + (lang === 'ua' ? ' хв тому' : 'm ago');
  if (diff < 1440) return Math.floor(diff / 60) + (lang === 'ua' ? ' год тому' : 'h ago');
  return Math.floor(diff / 1440) + (lang === 'ua' ? ' дн тому' : 'd ago');
}
