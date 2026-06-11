'use strict';

// Same URL as in popup.js
var WORKER_URL = 'https://stock-ai-analyzer.chelb-dev.workers.dev';

var CHECK_INTERVAL = 15;

chrome.runtime.onInstalled.addListener(function() { setupAlarm(); });
chrome.runtime.onStartup.addListener(function() { setupAlarm(); });

function setupAlarm() {
  chrome.alarms.clear('priceCheck', function() {
    chrome.alarms.create('priceCheck', { periodInMinutes: CHECK_INTERVAL });
  });
}

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'priceCheck') checkPrices();
});

function fetchPrice(ticker, cb) {
  fetch(WORKER_URL + '/price?ticker=' + ticker)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.c || d.c === 0) { cb(null); return; }
      var pct = (d.pc && d.pc > 0) ? ((d.c - d.pc) / d.pc) * 100 : 0;
      cb({ price: d.c, pct: pct });
    })
    .catch(function() { cb(null); });
}

function checkPrices() {
  chrome.storage.local.get(['watchlist', 'priceAlerts', 'alertThreshold'], function(s) {
    var watchlist = s.watchlist || [];
    var savedPrices = s.priceAlerts || {};
    var threshold = s.alertThreshold || 3;
    if (!watchlist.length) return;

    var pending = watchlist.length;
    var alertsToFire = []; // tickers that crossed the threshold
    var allLines = [];     // ALL watchlist tickers — the toast shows the full picture

    watchlist.forEach(function(item) {
      var ticker = item.ticker;
      fetchPrice(ticker, function(info) {
        if (info) {
          var lastPrice = savedPrices[ticker];
          var now = Date.now();
          savedPrices[ticker] = { price: info.price, pct: info.pct, time: now };

          var shouldAlert = false;
          var reason = '';

          if (Math.abs(info.pct) >= threshold) {
            shouldAlert = true;
            reason = (info.pct > 0 ? '📈' : '📉') + ' ' + ticker + ' ' +
              (info.pct > 0 ? '+' : '') + info.pct.toFixed(1) + '% за день. $' + info.price.toFixed(2);
          }

          if (lastPrice && !shouldAlert) {
            var ch = ((info.price - lastPrice.price) / lastPrice.price) * 100;
            if (Math.abs(ch) >= threshold) {
              shouldAlert = true;
              reason = (ch > 0 ? '📈' : '📉') + ' ' + ticker + ' ' +
                (ch > 0 ? '+' : '') + ch.toFixed(1) + '% з останньої перевірки. $' + info.price.toFixed(2);
            }
          }

          if (shouldAlert) alertsToFire.push({ ticker: ticker, reason: reason });

          // Line for the combined toast — every ticker, movers highlighted
          allLines.push(
            (shouldAlert ? (info.pct > 0 ? '📈' : '📉') : '▫') + ' ' + ticker + ' ' +
            (info.pct > 0 ? '+' : '') + info.pct.toFixed(1) + '% · $' + info.price.toFixed(2)
          );
        }

        pending--;
        if (pending === 0) {
          // Single batched storage write after ALL fetches complete
          chrome.storage.local.set({ priceAlerts: savedPrices });
          // ONE combined notification for all alerts: Windows shows toasts
          // one-by-one, so separate notifications hid each other ("не всі фірми").
          // Unique ID each time (same-ID re-creates are silently swallowed),
          // old ones cleared, and the toast is force-closed after 7s because
          // Windows otherwise keeps it on screen too long.
          if (alertsToFire.length > 0) {
            var title = '📊 AI Stocks — алерти (' + alertsToFire.length + ')';
            // Full watchlist in one toast (user request): movers with 📈/📉, rest with ▫.
            // No auto-dismiss — the user closes it himself.
            var message = allLines.slice(0, 6).join('\n');
            chrome.notifications.getAll(function(all) {
              Object.keys(all || {}).forEach(function(id) {
                if (id.indexOf('alert') === 0) chrome.notifications.clear(id);
              });
              chrome.notifications.create('alerts_' + Date.now(), {
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: title,
                message: message,
                priority: 1,
              }, function() {
                if (chrome.runtime.lastError) {
                  console.error('Notification failed:', chrome.runtime.lastError.message);
                }
              });
            });
          }
        }
      });
    });
  });
}

chrome.notifications.onClicked.addListener(function(notifId) {
  chrome.notifications.clear(notifId);
});

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === 'checkNow') { checkPrices(); sendResponse({ ok: true }); }
  return true;
});
