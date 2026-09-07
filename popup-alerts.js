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
  chrome.storage.local.get(['alertThreshold', 'priceAlerts', 'priceTargets', 'notificationsEnabled', 'digestEnabled', 'digestTime', 'digestHour'], function(s) {
    var threshold = s.alertThreshold || 3;
    document.getElementById('threshold-slider').value = threshold;
    document.getElementById('threshold-value').textContent = threshold + '%';
    setNotifToggle(s.notificationsEnabled !== false); // default ON
    setDigestToggle(s.digestEnabled === true);        // default OFF — opt-in
    document.getElementById('digest-time').value = digestTimeValue(s);
    renderDigestStatus();
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
            price: d.c, // native currency; renderAlertPrices converts to display
            cur: d.cur || 'USD',
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

// Notifications on/off — gates background.js from firing any toast.
function setNotifToggle(enabled) {
  var btn = document.getElementById('notif-toggle');
  if (!btn) return;
  btn.textContent = enabled ? L('Увімкнено', 'On', 'Activé') : L('Вимкнено', 'Off', 'Désactivé');
  btn.style.color = enabled ? 'var(--green)' : 'var(--dim)';
}

function toggleNotifications() {
  chrome.storage.local.get(['notificationsEnabled'], function(s) {
    var enabled = (s.notificationsEnabled === false); // currently off -> turn on, else off
    chrome.storage.local.set({ notificationsEnabled: enabled }, function() {
      setNotifToggle(enabled);
      toast(enabled
        ? L('🔔 Сповіщення увімкнено', '🔔 Notifications on', '🔔 Notifications activées')
        : L('🔕 Сповіщення вимкнено', '🔕 Notifications off', '🔕 Notifications désactivées'));
    });
  });
}

// ── Daily digest ──────────────────────────────────────────────────────────────
// Opt-in: one notification per weekday at a time the user types in, with the
// market, the watchlist's biggest movers and earnings due within a week.
// background.js does the work; here we own the switch, the time and the preview.

// Stored "HH:MM" for <input type=time>, migrating the pre-2.8 numeric hour.
function digestTimeValue(s) {
  if (typeof s.digestTime === 'string' && /^\d{1,2}:\d{2}$/.test(s.digestTime)) {
    var p = s.digestTime.split(':');
    return ('0' + p[0]).slice(-2) + ':' + p[1];
  }
  if (typeof s.digestHour === 'number') return ('0' + s.digestHour).slice(-2) + ':00';
  return '09:00';
}

function setDigestToggle(enabled) {
  var btn = document.getElementById('digest-toggle');
  if (!btn) return;
  btn.textContent = enabled ? L('Увімкнено', 'On', 'Activé') : L('Вимкнено', 'Off', 'Désactivé');
  btn.style.color = enabled ? 'var(--green)' : 'var(--dim)';
}

// "When is it actually coming?" — the preview button proves the content, this
// line proves the schedule. Mirrors background.js's rules exactly (weekdays
// only, 4h grace window, once a day) so the user can see the next delivery
// instead of having to trust that an invisible alarm is set.
function renderDigestStatus() {
  var el = document.getElementById('digest-status');
  if (!el) return;
  chrome.storage.local.get(['digestEnabled', 'digestTime', 'digestHour', 'digestLastDate', 'notificationsEnabled'], function(s) {
    if (!s.digestEnabled) { el.textContent = ''; return; }
    if (s.notificationsEnabled === false) {
      el.textContent = L('🔕 Сповіщення вимкнено — дайджест не прийде.',
                         '🔕 Notifications are off — the digest will not arrive.',
                         '🔕 Notifications désactivées — le résumé n’arrivera pas.');
      return;
    }
    if (!watchlist.length) {
      el.textContent = L('Список порожній — нема про що звітувати.',
                         'The Watchlist is empty — nothing to report.',
                         'La Liste est vide — rien à signaler.');
      return;
    }

    var hhmm = digestTimeValue(s);
    var parts = hhmm.split(':');
    var mins = (+parts[0]) * 60 + (+parts[1]);

    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var todayKey = now.getFullYear() + '-' + (now.getMonth() + 1) + '-' + now.getDate();
    var sentToday = s.digestLastDate === todayKey;

    // Walk forward day by day to the next slot that background.js would accept.
    var d = new Date(now.getTime());
    var offset = 0;
    for (var i = 0; i < 8; i++) {
      var weekend = d.getDay() === 0 || d.getDay() === 6;
      var key = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
      var missed = offset === 0 && (nowMin >= mins + 4 * 60 || (sentToday && key === todayKey));
      if (!weekend && !missed && !(offset === 0 && sentToday)) break;
      d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); offset++;
    }

    var dayWord;
    if (offset === 0) dayWord = nowMin >= mins ? L('сьогодні', 'today', "aujourd'hui") : L('сьогодні', 'today', "aujourd'hui");
    else if (offset === 1) dayWord = L('завтра', 'tomorrow', 'demain');
    else {
      var days = { ua: ['неділю','понеділок','вівторок','середу','четвер','п’ятницю','суботу'],
                   en: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],
                   fr: ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'] };
      var list = days[lang] || days.en;
      dayWord = L('у ' + list[d.getDay()], 'on ' + list[d.getDay()], list[d.getDay()]);
    }

    var line = L('📬 Наступний: ' + dayWord + ' о ' + hhmm,
                 '📬 Next: ' + dayWord + ' at ' + hhmm,
                 '📬 Prochain : ' + dayWord + ' à ' + hhmm);
    if (sentToday) {
      line += L(' · сьогоднішній уже надіслано', ' · today’s was already sent', ' · celui d’aujourd’hui a déjà été envoyé');
    }
    el.textContent = line;
  });
}

function toggleDigest() {
  chrome.storage.local.get(['digestEnabled'], function(s) {
    var enabled = !s.digestEnabled;
    chrome.storage.local.set({ digestEnabled: enabled }, function() {
      setDigestToggle(enabled);
      renderDigestStatus();
      if (!enabled) { toast(L('Дайджест вимкнено', 'Digest off', 'Résumé désactivé')); return; }
      var hhmm = document.getElementById('digest-time').value || '09:00';
      toast(L('☀️ Дайджест о ' + hhmm, '☀️ Digest at ' + hhmm, '☀️ Résumé à ' + hhmm));
      if (!watchlist.length) {
        toast(L('Спершу додай акції у Список', 'Add stocks to the Watchlist first', "Ajoutez d'abord des actions à la Liste"));
      }
    });
  });
}

function saveDigestTime() {
  var hhmm = document.getElementById('digest-time').value;
  if (!/^\d{1,2}:\d{2}$/.test(hhmm || '')) return; // the picker was cleared — keep the stored value
  // Clear today's "already sent" stamp: moving the time to a later slot should
  // let today's digest still arrive instead of being swallowed by the guard.
  chrome.storage.local.set({ digestTime: hhmm, digestLastDate: '' }, function() {
    renderDigestStatus();
    toast(L('☀️ Дайджест о ' + hhmm, '☀️ Digest at ' + hhmm, '☀️ Résumé à ' + hhmm));
  });
}

function previewDigest() {
  if (!watchlist.length) {
    toast(L('Спершу додай акції у Список', 'Add stocks to the Watchlist first', "Ajoutez d'abord des actions à la Liste"));
    return;
  }
  chrome.runtime.sendMessage({ action: 'digestNow' }, function() {
    toast(L('☀️ Готую дайджест…', '☀️ Building digest…', '☀️ Préparation du résumé…'));
  });
}

// ── Price targets ("tell me when TSLA falls below $300") ─────────────────────
function addPriceTarget() {
  var ticker = document.getElementById('target-ticker').value.trim().toUpperCase();
  var dir    = document.getElementById('target-dir').value;
  var price  = parseFloat(document.getElementById('target-price').value.replace(',', '.').replace('$', ''));
  if (!ticker || isNaN(price) || price <= 0) {
    toast(L('⚠ Вкажи тікер і ціну', '⚠ Enter ticker and price', '⚠ Saisissez un symbole et un prix'));
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
      ? L('нижче', 'below', 'sous')
      : L('вище', 'above', 'au-dessus');
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
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔔</div><p>' + (L('Додай акції у Watchlist.', 'Add stocks to Watchlist.', 'Ajoutez des actions à la Liste.')) + '</p></div>';
    return;
  }
  // A foreign listing's last price is stored in its native currency (info.cur);
  // preload USD→ccy for every currency present so nativeToUSD converts cleanly,
  // then fmtMoney renders in the display currency. US-only lists load nothing.
  var curSet = {};
  watchlist.forEach(function(w) { var i = priceAlerts[w.ticker]; if (i && i.cur) curSet[i.cur.toUpperCase()] = 1; });
  loadRates(Object.keys(curSet), function() {
  var html = '<div style="margin-top:12px"><p style="font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">' + (L('Останні ціни', 'Last prices', 'Derniers prix')) + '</p>';
  watchlist.forEach(function(w) {
    var info = priceAlerts[w.ticker];
    var pill = pillClass(w.color);
    html += '<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:var(--r);padding:9px 12px;margin-bottom:6px">';
    html += '<span style="font-family:var(--mono);font-size:13px;font-weight:500;color:var(--green);width:50px">' + w.ticker + '</span>';
    if (info) {
      var up = info.pct >= 0;
      var color = up ? 'var(--green)' : 'var(--red)';
      var arrow = up ? '▲' : '▼';
      html += '<span style="font-family:var(--mono);font-size:12px;color:var(--text)">' + fmtMoney(nativeToUSD(info.price, info.cur)) + '</span>';
      html += '<span style="font-family:var(--mono);font-size:11px;color:' + color + '">' + arrow + ' ' + (up ? '+' : '') + info.pct.toFixed(1) + '%</span>';
      var ago = Math.floor((Date.now() - info.time) / 60000);
      var timeStr = ago < 1 ? L('щойно', 'just now', "à l'instant") : ago + L(' хв тому', 'm ago', ' min');
      html += '<span style="font-family:var(--mono);font-size:10px;color:var(--dim);margin-left:auto">' + timeStr + '</span>';
    } else {
      html += '<span style="font-family:var(--mono);font-size:11px;color:var(--dim)">' + (L('ще не перевірено', 'not checked yet', 'pas encore vérifié')) + '</span>';
    }
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
  }); // loadRates
}

// Listen for price updates from background
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.action === 'pricesUpdated') {
    chrome.storage.local.get(['priceAlerts'], function(s) {
      renderAlertPrices(s.priceAlerts || {});
    });
  }
});
