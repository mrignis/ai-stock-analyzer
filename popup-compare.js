'use strict';
// ── Compare (A vs B) ─────────────────────────────────────────────────────────
// Side-by-side of the current ticker vs another. Reuses /analyze through the
// client cache (a ticker already analyzed this session is instant) — no new
// permissions, no worker change. Deps (globals): L, lang, currentTicker,
// currentData, WORKER_URL, cacheGetFull/cacheSet, CACHE_ANALYZE_TTL, normalizeAI,
// normalizeSector, pillClass, priceToUSD, fmtMoney, escHtml.

function openCompare() {
  if (!currentTicker || !currentData) return;
  document.getElementById('cmp-input').value = '';
  document.getElementById('cmp-result').innerHTML = '';
  document.getElementById('compare-overlay').style.display = 'flex';
  document.getElementById('cmp-input').focus();
}
function closeCompare() { document.getElementById('compare-overlay').style.display = 'none'; }

// Cache-first analysis for any ticker (raw payload with _quote/_analysts), keyed
// exactly like runAnalysis so an on-screen/history ticker returns with no network.
function fetchAnalysisFor(ticker, cb) {
  var key = 'analyze_' + ticker + '_' + lang;
  cacheGetFull(key, CACHE_ANALYZE_TTL, function (entry) {
    if (entry && entry.d && entry.d._quote && entry.d._quote.c) { cb(entry.d); return; }
    fetch(WORKER_URL + '/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticker: ticker, lang: lang }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && !d.error && d._quote) { cacheSet(key, d); cb(d); } else cb(null); })
      .catch(function () { cb(null); });
  });
}

function cmpMsg(t) { return '<div style="text-align:center;color:var(--muted);font-family:var(--mono);font-size:11px;padding:16px">' + t + '</div>'; }

function runCompare() {
  var a = currentTicker;
  var b = document.getElementById('cmp-input').value.trim().toUpperCase().replace(/[^A-Z0-9.\-:]/g, '').slice(0, 15);
  var res = document.getElementById('cmp-result');
  if (!b) return;
  if (b === a) { res.innerHTML = cmpMsg(L('Введи інший тікер', 'Enter a different ticker', 'Entrez un autre symbole')); return; }
  res.innerHTML = cmpMsg(L('Аналізую ', 'Analyzing ', 'Analyse ') + escHtml(b) + '…');
  fetchAnalysisFor(a, function (da) {
    fetchAnalysisFor(b, function (db) {
      if (!da || !db) { res.innerHTML = cmpMsg(L('Не вдалося порівняти ' + b, 'Could not compare ' + b, 'Comparaison impossible ' + b)); return; }
      // Convert each price off its native currency to USD, then fmtMoney renders it
      // in the display currency (a CAD/.TO price isn't USD).
      priceToUSD(da._quote || {}, function (ua) {
        priceToUSD(db._quote || {}, function (ub) {
          renderCompare(a, da, ua, b, db, ub);
        });
      });
    });
  });
}

// Analyst consensus → buy% + total (null when there's no coverage).
function analystBuyPct(x) {
  if (!x) return null;
  var total = x.strongBuy + x.buy + x.hold + x.sell + x.strongSell;
  if (total <= 0) return null;
  return { pct: Math.round((x.strongBuy + x.buy) / total * 100), total: total };
}

function renderCompare(a, da, ua, b, db, ub) {
  var na = normalizeAI(da), nb = normalizeAI(db);
  var e = function (s) { return escHtml(String(s == null ? '' : s)); };
  var headCell = function (t, n) {
    return '<div class="cmp-head"><span class="cmp-tk">' + e(t) + '</span>' +
      '<span class="verdict-pill ' + pillClass(n.color) + '" style="font-size:9px">' + e(n.verdict) + '</span></div>';
  };
  var price = function (u) { return (u && u.c) ? escHtml(fmtMoney(u.c)) : '—'; };
  var aBuy = analystBuyPct(na.analysts), bBuy = analystBuyPct(nb.analysts);
  var buy = function (x) { return x ? (x.pct + '% ' + L('купувати', 'buy', 'achat') + ' (' + x.total + ')') : L('нема покриття', 'no coverage', 'aucune'); };
  var row = function (label, va, vb) {
    return '<div class="cmp-lbl">' + label + '</div><div class="cmp-a">' + va + '</div><div class="cmp-b">' + vb + '</div>';
  };
  document.getElementById('cmp-result').innerHTML = '<div class="cmp-grid">' +
    '<div></div>' + headCell(a, na) + headCell(b, nb) +
    row(L('Ціна', 'Price', 'Prix'), price(ua), price(ub)) +
    row(L('Сектор', 'Sector', 'Secteur'), e(normalizeSector(na.sector, lang)) || '—', e(normalizeSector(nb.sector, lang)) || '—') +
    row(L('Ризик', 'Risk', 'Risque'), e(na.risk) || '—', e(nb.risk) || '—') +
    row(L('Тренд', 'Trend', 'Tendance'), e(na.trend) || '—', e(nb.trend) || '—') +
    row(L('Аналітики', 'Analysts', 'Analystes'), e(buy(aBuy)), e(buy(bBuy))) +
    '</div>';
}
