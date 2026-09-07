'use strict';

// Same URL as in popup.js
var WORKER_URL = 'https://stock-ai-analyzer.chelb-dev.workers.dev';

var CHECK_INTERVAL = 15;  // watchlist %-alerts: relaxed cadence (daily % won't run away)
var TARGET_INTERVAL = 1;  // price targets: traders need the alert NOW, not in 15 min
var DIGEST_INTERVAL = 5;  // daily digest: the user picks an exact HH:MM, so poll fine-grained

// 3-language string pick — the popup's L() has no counterpart in the service
// worker, so notifications used to be UA/EN only and French users got English.
function N(lang, ua, en, fr) {
  return lang === 'fr' ? (fr != null ? fr : en) : lang === 'ua' ? ua : en;
}

chrome.runtime.onInstalled.addListener(function() { setupAlarm(); });
chrome.runtime.onStartup.addListener(function() { setupAlarm(); });

function setupAlarm() {
  chrome.alarms.clear('priceCheck', function() {
    chrome.alarms.create('priceCheck', { periodInMinutes: CHECK_INTERVAL });
  });
  chrome.alarms.clear('targetCheck', function() {
    chrome.alarms.create('targetCheck', { periodInMinutes: TARGET_INTERVAL });
  });
  chrome.alarms.clear('digestCheck', function() {
    chrome.alarms.create('digestCheck', { periodInMinutes: DIGEST_INTERVAL });
  });
}

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'priceCheck') checkPrices();
  if (alarm.name === 'targetCheck') runTargetCheck();
  if (alarm.name === 'digestCheck') runDigestCheck();
});

function runTargetCheck() {
  chrome.storage.local.get(['priceTargets', 'lang', 'notificationsEnabled'], function(s) {
    if (s.notificationsEnabled === false) return; // notifications off — don't fire or consume one-shot targets
    checkPriceTargets(s.priceTargets || [], s.lang || 'ua');
  });
}

function fetchPrice(ticker, cb) {
  fetch(WORKER_URL + '/price?ticker=' + encodeURIComponent(ticker))
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.c || d.c === 0) { cb(null); return; }
      var pct = (d.pc && d.pc > 0) ? ((d.c - d.pc) / d.pc) * 100 : 0;
      // Keep the price in its native currency + tag it (foreign listings aren't USD);
      // the popup converts to the display currency. Percent alerts are currency-free.
      cb({ price: d.c, pct: pct, cur: d.cur || 'USD' });
    })
    .catch(function() { cb(null); });
}

function checkPrices() {
  chrome.storage.local.get(['watchlist', 'priceAlerts', 'alertThreshold', 'priceTargets', 'lang', 'notificationsEnabled'], function(s) {
    var watchlist = s.watchlist || [];
    var savedPrices = s.priceAlerts || {};
    var threshold = s.alertThreshold || 3;
    // Notifications follow the UI language (cousin's bug report)
    var lang = s.lang || 'ua';
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
          savedPrices[ticker] = { price: info.price, pct: info.pct, time: now, cur: info.cur };

          var shouldAlert = false;
          var reason = '';

          if (Math.abs(info.pct) >= threshold) {
            shouldAlert = true;
            reason = (info.pct > 0 ? '📈' : '📉') + ' ' + ticker + ' ' +
              (info.pct > 0 ? '+' : '') + info.pct.toFixed(1) +
              N(lang, '% за день. $', '% today. $', '% aujourd\'hui. $') + info.price.toFixed(2);
          }

          if (lastPrice && !shouldAlert) {
            var ch = ((info.price - lastPrice.price) / lastPrice.price) * 100;
            if (Math.abs(ch) >= threshold) {
              shouldAlert = true;
              reason = (ch > 0 ? '📈' : '📉') + ' ' + ticker + ' ' +
                (ch > 0 ? '+' : '') + ch.toFixed(1) +
                N(lang, '% з останньої перевірки. $', '% since last check. $', '% depuis la dernière vérification. $') + info.price.toFixed(2);
            }
          }

          if (shouldAlert) alertsToFire.push({ ticker: ticker, reason: reason });

          // Line for the combined toast — every ticker, movers highlighted
          allLines.push(
            (shouldAlert ? (info.pct > 0 ? '📈' : '📉') : '➖') + ' ' + ticker + ' ' +
            (info.pct > 0 ? '+' : '') + info.pct.toFixed(1) + '% • $' + info.price.toFixed(2)
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
          if (s.notificationsEnabled !== false && alertsToFire.length > 0) {
            // "рухи: 2 з 3" — movers vs. full watchlist, so counts always match the lines
            var title = '📊 AI Stocks — ' + N(lang, 'рухи: ', 'moves: ', 'mouvements : ') +
              alertsToFire.length + N(lang, ' з ', ' of ', ' sur ') + allLines.length;
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

// Price targets: "tell me when TSLA falls below $300" — one-shot alerts
function checkPriceTargets(targets, lang) {
  if (!targets.length) return;
  // De-duplicated tickers so one fetch covers multiple targets
  var tickers = targets
    .map(function(t) { return t.ticker; })
    .filter(function(v, i, a) { return a.indexOf(v) === i; });
  var prices = {};
  var pending = tickers.length;

  tickers.forEach(function(ticker) {
    fetchPrice(ticker, function(info) {
      if (info) prices[ticker] = info.price;
      pending--;
      if (pending > 0) return;

      var remaining = [];
      var hits = [];
      targets.forEach(function(t) {
        var cur = prices[t.ticker];
        var hit = cur != null && (
          (t.dir === 'below' && cur <= t.price) ||
          (t.dir === 'above' && cur >= t.price)
        );
        if (hit) {
          hits.push('🎯 ' + t.ticker + ' ' +
            (t.dir === 'below'
              ? N(lang, 'впав нижче', 'fell below', 'est passé sous')
              : N(lang, 'зріс вище', 'rose above', 'est monté au-dessus de')) + ' $' + t.price +
            N(lang, ' — зараз $', ' — now $', ' — actuellement $') + cur.toFixed(2));
        } else {
          remaining.push(t); // not hit (or no price) — keep waiting
        }
      });

      if (hits.length > 0) {
        chrome.storage.local.set({ priceTargets: remaining }); // fired targets are one-shot
        chrome.notifications.create('target_' + Date.now(), {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: N(lang, '🎯 AI Stocks — цінова ціль!', '🎯 AI Stocks — price target hit!', '🎯 AI Stocks — objectif atteint !'),
          message: hits.join('\n'),
          priority: 1,
        }, function() {
          if (chrome.runtime.lastError) {
            console.error('Target notification failed:', chrome.runtime.lastError.message);
          }
        });
      }
    });
  });
}

// ── Daily digest ──────────────────────────────────────────────────────────────
// One notification a day at a time the user types in: where the market stands,
// the biggest movers in the watchlist and any earnings report due within a week.
// Opt-in (default off) and gated by the same notificationsEnabled switch as
// everything else.
//
// Why polling instead of one alarm scheduled at the exact minute: a laptop that
// is asleep (or Chrome closed) at 09:00 never receives that alarm, and the
// digest would silently be skipped for the day. Polling + an "already sent
// today" date guard means it fires at the first opportunity after the chosen
// time, and exactly once. The 4-hour window keeps a digest set for 09:00 from
// landing at 23:00 on a machine that was off all day.
var DIGEST_GRACE_MIN = 4 * 60;
var DIGEST_MAX_TICKERS = 10; // cap the fan-out; a huge watchlist shouldn't spam the worker

function dayKey(d) {
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

// "HH:MM" → minutes since midnight. Falls back to the old numeric digestHour
// setting (pre-2.8 installs stored a whole hour), then to 09:00.
function digestMinutes(s) {
  var t = s.digestTime;
  if (typeof t === 'string') {
    var m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if (m) {
      var h = +m[1], mi = +m[2];
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) return h * 60 + mi;
    }
  }
  if (typeof s.digestHour === 'number') return s.digestHour * 60;
  return 9 * 60;
}

function runDigestCheck() {
  chrome.storage.local.get(
    ['digestEnabled', 'digestTime', 'digestHour', 'digestLastDate', 'notificationsEnabled', 'watchlist', 'lang'],
    function(s) {
      if (s.notificationsEnabled === false) return;
      if (!s.digestEnabled) return;
      var watchlist = s.watchlist || [];
      if (!watchlist.length) return;

      var now = new Date();
      var dow = now.getDay();
      if (dow === 0 || dow === 6) return; // markets are closed — a weekend digest is noise

      if (s.digestLastDate === dayKey(now)) return; // already sent today

      var nowMin = now.getHours() * 60 + now.getMinutes();
      var start = digestMinutes(s);
      if (nowMin < start || nowMin >= start + DIGEST_GRACE_MIN) return;

      // Claim the slot BEFORE the async fetches so a second alarm firing while
      // they are in flight can't produce a duplicate toast.
      chrome.storage.local.set({ digestLastDate: dayKey(now) }, function() {
        buildDigest(watchlist.slice(0, DIGEST_MAX_TICKERS), s.lang || 'ua');
      });
    }
  );
}

function buildDigest(watchlist, lang) {
  var tickers = watchlist.map(function(w) { return w.ticker; });
  var quotes = {};
  var earnings = [];
  var marketLine = '';
  // 1 market call + 2 calls per ticker; every one resolves (never rejects) so a
  // single dead endpoint can't stall the whole digest.
  var pending = 1 + tickers.length * 2;

  function done() {
    if (--pending > 0) return;
    sendDigest(tickers, quotes, earnings, marketLine, lang);
  }

  fetch(WORKER_URL + '/market')
    .then(function(r) { return r.json(); })
    .then(function(m) {
      var parts = [];
      ['SP500', 'NASDAQ'].forEach(function(k) {
        var v = m && m[k];
        if (v && typeof v.pct === 'number') {
          parts.push(v.label + ' ' + (v.pct >= 0 ? '+' : '') + v.pct.toFixed(1) + '%');
        }
      });
      marketLine = parts.join(' · ');
    })
    .catch(function() {})
    .then(done, done);

  tickers.forEach(function(ticker) {
    fetchPrice(ticker, function(info) {
      if (info) quotes[ticker] = info;
      done();
    });

    fetch(WORKER_URL + '/calendar?ticker=' + encodeURIComponent(ticker))
      .then(function(r) { return r.json(); })
      .then(function(c) {
        if (!c || !c.earningsDate) return;
        var days = Math.round((c.earningsDate * 1000 - Date.now()) / 86400000);
        if (days >= 0 && days <= 7) earnings.push({ ticker: ticker, days: days });
      })
      .catch(function() {})
      .then(done, done);
  });
}

function sendDigest(tickers, quotes, earnings, marketLine, lang) {
  // Biggest absolute movers first — the point of a digest is "what moved",
  // not an alphabetical dump of the whole watchlist.
  var movers = tickers
    .filter(function(t) { return quotes[t]; })
    .sort(function(a, b) { return Math.abs(quotes[b].pct) - Math.abs(quotes[a].pct); })
    .slice(0, 4)
    .map(function(t) {
      var q = quotes[t];
      return (q.pct >= 0 ? '📈' : '📉') + ' ' + t + ' ' +
        (q.pct >= 0 ? '+' : '') + q.pct.toFixed(1) + '% • $' + q.price.toFixed(2);
    });

  if (!movers.length && !marketLine) return; // nothing to say — stay silent rather than send an empty toast

  var lines = [];
  if (marketLine) lines.push('🌍 ' + marketLine);
  lines = lines.concat(movers);

  if (earnings.length) {
    earnings.sort(function(a, b) { return a.days - b.days; });
    var e = earnings.slice(0, 3).map(function(x) {
      var when = x.days === 0
        ? N(lang, 'сьогодні', 'today', "aujourd'hui")
        : N(lang, 'через ' + x.days + 'д', 'in ' + x.days + 'd', 'dans ' + x.days + 'j');
      return x.ticker + ' ' + when;
    });
    lines.push('📅 ' + N(lang, 'Звіти: ', 'Earnings: ', 'Résultats : ') + e.join(' · '));
  }

  chrome.notifications.create('digest_' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: N(lang, '☀️ AI Stocks — щоденний дайджест',
                  '☀️ AI Stocks — daily digest',
                  '☀️ AI Stocks — résumé quotidien'),
    message: lines.join('\n'),
    priority: 1,
  }, function() {
    if (chrome.runtime.lastError) {
      console.error('Digest notification failed:', chrome.runtime.lastError.message);
    }
  });
}

chrome.notifications.onClicked.addListener(function(notifId) {
  chrome.notifications.clear(notifId);
});

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === 'checkNow') { checkPrices(); runTargetCheck(); sendResponse({ ok: true }); }
  // "Preview" from the Alerts panel — builds the digest right now, ignoring the
  // hour/weekday/once-a-day guards, so the user can see what it looks like
  // instead of waiting until tomorrow morning. Does not consume the daily slot.
  if (msg.action === 'digestNow') {
    chrome.storage.local.get(['watchlist', 'lang'], function(s) {
      var wl = s.watchlist || [];
      if (wl.length) buildDigest(wl.slice(0, DIGEST_MAX_TICKERS), s.lang || 'ua');
    });
    sendResponse({ ok: true });
  }
  // Content-script clicked a highlighted ticker → open the full analysis in a tab.
  if (msg.action === 'openAnalysis' && msg.ticker && /^[A-Za-z0-9.\-]{1,10}$/.test(msg.ticker)) {
    chrome.tabs.create({ url: 'popup.html?tab=1&ticker=' + encodeURIComponent(msg.ticker.toUpperCase()) });
    sendResponse({ ok: true });
  }
  return true;
});
