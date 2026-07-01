'use strict';

// core.js — shared foundation: storage, cache, prices, currency, time.
// Loaded BEFORE popup.js (plain script, shared globals — no ES modules).


function loadAll(cb) { chrome.storage.local.get(['lang','theme','currency','watchlist','history','conversations','currentConvId','portfolio'], cb); }
function save(obj) { chrome.storage.local.set(obj); }

// ── Cache ─────────────────────────────────────────────────────────────────────
var CACHE_MARKET_TTL  = 5  * 60 * 1000; // 5 хв
var CACHE_ANALYZE_TTL = 15 * 60 * 1000; // 15 хв
var CACHE_PRICE_TTL   = 2  * 60 * 1000; // 2 хв
var CACHE_CANDLE_TTL  = 30 * 60 * 1000; // 30 хв

// Remove stale cache entries to prevent chrome.storage.local from filling up
function cachePrune() {
  chrome.storage.local.get(null, function(all) {
    var toRemove = [];
    var now = Date.now();
    var maxAge = CACHE_ANALYZE_TTL * 8; // keep entries up to 2h max
    Object.keys(all).forEach(function(k) {
      if (k.startsWith('c_') && all[k] && all[k].t && (now - all[k].t) > maxAge) {
        toRemove.push(k);
      }
    });
    if (toRemove.length) chrome.storage.local.remove(toRemove);
  });
}

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

// ── Shared helpers ────────────────────────────────────────────────────────────

// Unified cache-then-fetch for live prices; calls cb(data) or cb(null) on error
function loadLivePrice(ticker, cb) {
  cacheGet('price_' + ticker, CACHE_PRICE_TTL, function(cached) {
    if (cached) { cb(cached); return; }
    fetch(WORKER_URL + '/price?ticker=' + ticker)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.c && d.c > 0) cacheSet('price_' + ticker, d);
        cb(d);
      })
      .catch(function() { cb(null); });
  });
}

// Stale-while-revalidate flavour: cb fires instantly with the cached price
// (even expired — no blank rows), then again with the fresh one.
// Safe only for idempotent UI updates (NOT for P&L accumulation).
function loadLivePriceSWR(ticker, cb) {
  chrome.storage.local.get('c_price_' + ticker, function(s) {
    var e = s['c_price_' + ticker];
    if (e && e.d) cb(e.d);
    fetch(WORKER_URL + '/price?ticker=' + ticker)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.c && d.c > 0) { cacheSet('price_' + ticker, d); cb(d); }
        else if (!e) cb(null);
      })
      .catch(function() { if (!e) cb(null); });
  });
}

// Applies live price data to a price + percent element pair
function applyPriceToElements(d, priceId, pctId) {
  if (!d || !d.c || d.c === 0) return;
  var priceEl = document.getElementById(priceId);
  var pctEl   = document.getElementById(pctId);
  if (!priceEl || !pctEl) return;
  var pct = (d.pc && d.pc > 0) ? ((d.c - d.pc) / d.pc * 100) : 0;
  var up = pct >= 0;
  priceEl.textContent = fmtMoney(d.c);
  priceEl.style.color = 'var(--text)';
  pctEl.textContent = (up ? '▲' : '▼') + Math.abs(pct).toFixed(1) + '%';
  pctEl.style.color = up ? 'var(--green)' : 'var(--red)';
}

// ── Currency ──────────────────────────────────────────────────────────────────
var CURRENCY_META = {
  USD: { sym: '$',   post: false },
  UAH: { sym: '₴',   post: true  },  // 4 150 ₴
  EUR: { sym: '€',   post: false },
  CAD: { sym: 'C$',  post: false },
  GBP: { sym: '£',   post: false },
  PLN: { sym: 'zł',  post: true  },
  CHF: { sym: 'CHF', post: true  },
  JPY: { sym: '¥',   post: false },
  CNY: { sym: '¥',   post: false },
  AUD: { sym: 'A$',  post: false },
  CZK: { sym: 'Kč',  post: true  },
  SEK: { sym: 'kr',  post: true  },
  NOK: { sym: 'kr',  post: true  },
  DKK: { sym: 'kr',  post: true  },
  TRY: { sym: '₺',   post: false },
  INR: { sym: '₹',   post: false },
  BRL: { sym: 'R$',  post: false },
  MXN: { sym: 'MX$', post: false },
  KRW: { sym: '₩',   post: false },
  ILS: { sym: '₪',   post: false },
  AED: { sym: 'AED', post: true  },
};
var CACHE_FX_TTL = 60 * 60 * 1000; // 1 год

// Formats a USD amount in the selected display currency
function fmtMoney(usd) {
  if (usd == null || isNaN(usd)) return '—';
  var m = CURRENCY_META[currency] || CURRENCY_META.USD;
  var num = formatPrice(usd * fxRate);
  return m.post ? num + ' ' + m.sym : m.sym + num;
}

// Loads USD→currency rate (cache 1h → /fx → fallback 1:1), then calls cb
function loadFxRate(cb) {
  if (currency === 'USD') { fxRate = 1; if (cb) cb(); return; }
  cacheGet('fx_' + currency, CACHE_FX_TTL, function(cached) {
    if (cached) { fxRate = cached; if (cb) cb(); return; }
    fetch(WORKER_URL + '/fx?to=' + currency)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        fxRate = (d && d.rate > 0) ? d.rate : 1;
        if (d && d.rate > 0) cacheSet('fx_' + currency, d.rate);
        if (cb) cb();
      })
      .catch(function() { fxRate = 1; if (cb) cb(); });
  });
}

// Maps verdict color to its pill CSS class
function pillClass(color) {
  return { green: 'pill-green', yellow: 'pill-yellow', red: 'pill-red', blue: 'pill-blue' }[color] || 'pill-blue';
}

// Unified "time ago" — long=true adds "тому" suffix (for alerts/news)
function timeAgo(ts, long) {
  var diff = Math.floor((Date.now() - ts) / 60000);
  var suf = long && lang === 'ua' ? ' тому' : '';
  if (diff < 1)    return L('щойно', 'just now', "à l'instant");
  if (diff < 60)   return diff + L(' хв' + suf, 'm ago', ' min');
  if (diff < 1440) return Math.floor(diff / 60) + L(' год' + suf, 'h ago', ' h');
  return Math.floor(diff / 1440) + L(' д' + suf, 'd ago', ' j');
}

// Escape HTML — shared by chat (renderConvList) and news (XSS protection)
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
