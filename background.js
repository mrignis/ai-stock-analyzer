'use strict';

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

function fetchFinnhub(ticker, key, cb) {
  var url = 'https://finnhub.io/api/v1/quote?symbol=' + ticker + '&token=' + key;
  fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.c || d.c === 0) { cb(null); return; }
      var price = d.c;
      var prev = d.pc;
      var pct = ((price - prev) / prev) * 100;
      cb({ price: price, pct: pct });
    })
    .catch(function() { cb(null); });
}

function checkPrices() {
  chrome.storage.local.get(['watchlist', 'priceAlerts', 'alertThreshold', 'finnhubKey'], function(s) {
    var watchlist = s.watchlist || [];
    var savedPrices = s.priceAlerts || {};
    var threshold = s.alertThreshold || 3;
    var finnhubKey = s.finnhubKey || '';
    if (!watchlist.length || !finnhubKey) return;

    watchlist.forEach(function(item) {
      var ticker = item.ticker;
      fetchFinnhub(ticker, finnhubKey, function(info) {
        if (!info) return;
        var lastPrice = savedPrices[ticker];
        var now = Date.now();
        savedPrices[ticker] = { price: info.price, pct: info.pct, time: now };
        chrome.storage.local.set({ priceAlerts: savedPrices });

        var shouldAlert = false;
        var reason = '';

        if (Math.abs(info.pct) >= threshold) {
          shouldAlert = true;
          reason = (info.pct > 0 ? '📈' : '📉') + ' ' + ticker + ' ' + (info.pct > 0 ? '+' : '') + info.pct.toFixed(1) + '% за день. $' + info.price.toFixed(2);
        }

        if (lastPrice && !shouldAlert) {
          var ch = ((info.price - lastPrice.price) / lastPrice.price) * 100;
          if (Math.abs(ch) >= threshold) {
            shouldAlert = true;
            reason = (ch > 0 ? '📈' : '📉') + ' ' + ticker + ' ' + (ch > 0 ? '+' : '') + ch.toFixed(1) + '% з останньої перевірки. $' + info.price.toFixed(2);
          }
        }

        if (shouldAlert) {
          chrome.notifications.create('alert_' + ticker + '_' + now, {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '📊 AI Stocks — ' + ticker,
            message: reason,
            priority: 2
          });
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
