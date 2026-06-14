'use strict';

// ── Alerts & Price targets ─────────────────────────────────────────────────────
// Extracted from popup.js (multi-script split). Shares the global scope; loaded
// before popup.js. Deps (runtime): watchlist, lang, toast, pillClass (popup.js),
// loadLivePrice, fmtMoney (core.js). Listeners register at load; their callbacks
// run later when DOM/events are ready.

// Reactive refresh: when the background fires a price target (or updates prices),
// it rewrites storage. Re-render the open Alerts panel immediately instead of
// guessing with a fixed timer — fixes "target fired but still shows in the list".
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area !== 'local') return;
  var alertsOpen = document.getElementById('panel-alerts').classList.contains('active');
  if (!alertsOpen) return;
  if (changes.priceTargets) renderTargets(changes.priceTargets.newValue || []);
  if (changes.priceAlerts) renderAlertPrices(changes.priceAlerts.newValue || {});
});

function initAlerts() {
  chrome.storage.local.get(['alertThreshold', 'priceAlerts', 'priceTargets'], function(s) {
    var threshold = s.alertThreshold || 3;
    document.getElementById('threshold-slider').value = threshold;
    document.getElementById('threshold-value').textContent = threshold + '%';
    renderTargets(s.priceTargets || []);
    // Instant render from the background snapshot, then refresh with live
    // prices (stale-while-revalidate — same standard as the other tabs)
    renderAlertPrices(s.priceAlerts || {});
    var live = {};
    var pending = watchlist.length;
    if (!pending) return;
    watchlist.forEach(function(w) {
      loadLivePrice(w.ticker, function(d) {
        if (d && d.c && d.c > 0) {
          live[w.ticker] = {
            price: d.c,
            pct: (d.pc && d.pc > 0) ? ((d.c - d.pc) / d.pc * 100) : 0,
            time: Date.now(),
          };
        }
        pending--;
        if (pending === 0 && Object.keys(live).length > 0) renderAlertPrices(live);
      });
    });
  });
}

// ── Price targets ("tell me when TSLA falls below $300") ─────────────────────
function addPriceTarget() {
  var ticker = document.getElementById('target-ticker').value.trim().toUpperCase();
  var dir    = document.getElementById('target-dir').value;
  var price  = parseFloat(document.getElementById('target-price').value.replace(',', '.').replace('$', ''));
  if (!ticker || isNaN(price) || price <= 0) {
    toast(lang === 'ua' ? '⚠ Вкажи тікер і ціну' : '⚠ Enter ticker and price');
    return;
  }
  chrome.storage.local.get(['priceTargets'], function(s) {
    var targets = s.priceTargets || [];
    targets.push({ ticker: ticker, dir: dir, price: price, createdAt: Date.now() });
    chrome.storage.local.set({ priceTargets: targets }, function() {
      document.getElementById('target-ticker').value = '';
      document.getElementById('target-price').value = '';
      renderTargets(targets);
      toast('🎯 ' + ticker + ' ' + (dir === 'below' ? '↓' : '↑') + ' ' + price);
    });
  });
}

function removePriceTarget(idx) {
  chrome.storage.local.get(['priceTargets'], function(s) {
    var targets = s.priceTargets || [];
    targets.splice(idx, 1);
    chrome.storage.local.set({ priceTargets: targets }, function() { renderTargets(targets); });
  });
}

function renderTargets(targets) {
  var el = document.getElementById('target-list');
  if (!targets.length) { el.innerHTML = ''; return; }
  var html = '';
  targets.forEach(function(t, i) {
    var arrow = t.dir === 'below' ? '↓' : '↑';
    var word  = t.dir === 'below'
      ? (lang === 'ua' ? 'нижче' : 'below')
      : (lang === 'ua' ? 'вище' : 'above');
    html += '<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:var(--r);padding:8px 12px;margin-bottom:6px">' +
      '<span style="font-family:var(--mono);font-size:12px;color:var(--green);width:56px">' + t.ticker + '</span>' +
      '<span style="font-family:var(--mono);font-size:11px;color:var(--text)">' + arrow + ' ' + word + ' $' + t.price + '</span>' +
      '<button class="target-remove" data-idx="' + i + '" style="margin-left:auto;background:none;border:none;color:var(--dim);cursor:pointer;font-size:11px">✕</button>' +
    '</div>';
  });
  el.innerHTML = html;
  el.querySelectorAll('.target-remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      removePriceTarget(parseInt(this.getAttribute('data-idx')));
    });
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
    var pill = pillClass(w.color);
    html += '<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:var(--r);padding:9px 12px;margin-bottom:6px">';
    html += '<span style="font-family:var(--mono);font-size:13px;font-weight:500;color:var(--green);width:50px">' + w.ticker + '</span>';
    if (info) {
      var up = info.pct >= 0;
      var color = up ? 'var(--green)' : 'var(--red)';
      var arrow = up ? '▲' : '▼';
      html += '<span style="font-family:var(--mono);font-size:12px;color:var(--text)">' + fmtMoney(info.price) + '</span>';
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
