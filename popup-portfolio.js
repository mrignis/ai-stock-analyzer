'use strict';

// ── Portfolio ─────────────────────────────────────────────────────────────────
// Split out of popup.js (no build step): shares the global scope, loaded before
// popup.js. Depends on `portfolio` (global var in popup.js), fmtMoney/loadLivePrice
// (core.js) and toast (popup.js) — all resolved at call time, post-DOMContentLoaded.

function savePortfolio() { save({ portfolio: portfolio }); }

// Exchange → ticker suffix (for the live-price fetch) and native currency. A TSX
// holding must be priced as CNQ.TO (CAD), not the US listing CNQ (USD), or its
// CAD cost basis reads as a ~30% "loss" that's really just the USD/CAD rate.
var PF_EXCH_SUFFIX = { TSX: '.TO', TSXV: '.V', CVE: '.V', NEO: '.NE', CSE: '.CN', LSE: '.L', ASX: '.AX', NSE: '.NS' };
var PF_EXCH_CCY    = { TSX: 'CAD', TSXV: 'CAD', CVE: 'CAD', NEO: 'CAD', CSE: 'CAD', LSE: 'GBP', ASX: 'AUD', NSE: 'INR' };
// Same, keyed by a suffix already on the ticker (manual add of "CNQ.TO").
var PF_SUFFIX_CCY  = { '.TO': 'CAD', '.V': 'CAD', '.NE': 'CAD', '.CN': 'CAD', '.L': 'GBP', '.AX': 'AUD', '.NS': 'INR' };
function ccyForTicker(ticker) {
  var m = /(\.[A-Z]{1,2})$/.exec(ticker);
  return (m && PF_SUFFIX_CCY[m[1]]) || 'USD';
}

// Wealthsimple-style model: one position per ticker, individual buys kept
// as "lots" inside it. Migrates old flat records on startup.
function migratePortfolioToLots() {
  var byTicker = {};
  var migrated = [];
  var changed = false;
  portfolio.forEach(function(p) {
    var lots = p.lots || [{ shares: p.shares, buyPrice: p.buyPrice, addedAt: p.addedAt || Date.now() }];
    if (!p.lots) changed = true;
    var ex = byTicker[p.ticker];
    if (ex) {
      ex.lots = ex.lots.concat(lots);
      changed = true;
    } else {
      var pos = { ticker: p.ticker, lots: lots };
      byTicker[p.ticker] = pos;
      migrated.push(pos);
    }
  });
  if (changed) { portfolio = migrated; savePortfolio(); }
}

function posShares(p)   { return p.lots.reduce(function(s, l) { return s + l.shares; }, 0); }
function posInvested(p) { return p.lots.reduce(function(s, l) { return s + l.shares * l.buyPrice; }, 0); }

function addPortfolioPosition() {
  var ticker   = document.getElementById('pf-ticker').value.trim().toUpperCase();
  var shares   = parseFloat(document.getElementById('pf-shares').value.replace(',', '.'));
  var buyPrice = parseFloat(document.getElementById('pf-buyprice').value.replace(',', '.'));
  if (!ticker || isNaN(shares) || shares <= 0 || isNaN(buyPrice) || buyPrice <= 0) {
    toast(L('⚠ Заповни всі поля', '⚠ Fill all fields', '⚠ Remplissez tous les champs'));
    return;
  }
  // Security: allow only real ticker characters (same charset as the worker).
  // CSP already blocks injected handlers; this keeps stored data clean too.
  if (!/^[A-Z0-9.\-:/]{1,15}$/.test(ticker)) {
    toast(L('⚠ Невірний тікер', '⚠ Invalid ticker', '⚠ Symbole invalide'));
    return;
  }
  // Wealthsimple-style: a new buy of an existing ticker becomes a lot
  // inside the same position — summary on top, history preserved
  var lot = { shares: shares, buyPrice: buyPrice, addedAt: Date.now() };
  var existing = portfolio.find(function(p) { return p.ticker === ticker; });
  if (existing) {
    existing.lots.push(lot);
  } else {
    // A ".TO"/".L"/… suffix tells us the native currency; the buy price the user
    // typed is in that currency, and the live price fetch uses the same symbol.
    var cur = ccyForTicker(ticker);
    portfolio.push({ ticker: ticker, sym: ticker, cur: cur, lots: [lot] });
  }
  savePortfolio();
  document.getElementById('pf-ticker').value = '';
  document.getElementById('pf-shares').value = '';
  document.getElementById('pf-buyprice').value = '';
  document.getElementById('pf-ticker').focus();
  renderPortfolio();
  toast(L('✓ Додано ' + ticker, '✓ Added ' + ticker, '✓ Ajouté ' + ticker));
}

// ── CSV import (broker export → portfolio) — one-click activation, no permissions ──
// Handles comma/semicolon delimiters + quoted cells; detects columns by header name
// (Symbol/Ticker, Quantity/Shares, and a cost/price column across common brokers).
function parseCSV(text) {
  var lines = text.replace(/\r\n?/g, '\n').split('\n').filter(function (l) { return l.trim(); });
  if (!lines.length) return [];
  var delim = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  return lines.map(function (line) {
    var cells = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === delim && !q) { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    return cells.map(function (s) { return s.trim().replace(/^"|"$/g, ''); });
  });
}

function importPortfolioCSV(text) {
  var rows = parseCSV(text);
  if (rows.length < 2) { toast(L('⚠ Порожній або невірний CSV', '⚠ Empty or invalid CSV', '⚠ CSV vide ou invalide')); return; }
  var header = rows[0].map(function (h) { return h.toLowerCase(); });
  // Match by NAME PRIORITY (names outer): so "average cost" wins over a generic
  // "price"/"last price" column that may sit earlier in the row — otherwise the
  // current price gets imported as the cost basis and P&L reads ~0%.
  var find = function (names) {
    for (var j = 0; j < names.length; j++) for (var i = 0; i < header.length; i++) if (header[i].indexOf(names[j]) >= 0) return i;
    return -1;
  };
  var has = function (sub) { for (var i = 0; i < header.length; i++) if (header[i].indexOf(sub) >= 0) return i; return -1; };
  var iT = find(['symbol', 'ticker', 'instrument']);
  var iS = find(['quantity', 'shares', 'qty', 'units']); // NOT 'position' — matches "Position Direction"
  // Wealthsimple-style broker export: has Exchange + a total "Book Value" (native)
  // → real cost/share = Book Value / Quantity, currency + listing from those cols.
  var iExch = has('exchange');
  var iBook = has('book value (market)'); // total cost in the position's native ccy
  var iBookCcy = has('book value currency (market)');
  var iMktCcy = has('market price currency');
  // Generic per-share cost column (Fidelity/Schwab/…). Cost names first; bare
  // 'price' is the last resort and is only reached when no Book Value exists.
  var iP = find(['average cost', 'avg cost', 'cost basis per share', 'cost per share', 'purchase price', 'unit cost', 'buy price', 'average price', 'price paid', 'price']);
  if (iT < 0 || iS < 0) { toast(L('⚠ Немає колонок Symbol/Quantity', '⚠ No Symbol/Quantity columns', '⚠ Colonnes Symbol/Quantity manquantes')); return; }
  var num = function (s) { return parseFloat(String(s || '').replace(/[,$\s]/g, '')); };
  var added = 0;
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var ticker = String(row[iT] || '').trim().toUpperCase().replace(/[^A-Z0-9.\-:/]/g, '');
    var shares = num(row[iS]);
    if (!ticker || !/^[A-Z0-9.\-:/]{1,15}$/.test(ticker) || isNaN(shares) || shares <= 0) continue;

    var exch = iExch >= 0 ? String(row[iExch] || '').toUpperCase().trim() : '';
    var suffix = PF_EXCH_SUFFIX[exch] || '';
    // Native currency: prefer the CSV's currency column, else infer from exchange,
    // else a suffix already on the symbol, else USD.
    var cur = (iBookCcy >= 0 && row[iBookCcy]) ? String(row[iBookCcy]).toUpperCase().trim()
            : (iMktCcy >= 0 && row[iMktCcy]) ? String(row[iMktCcy]).toUpperCase().trim()
            : PF_EXCH_CCY[exch] || ccyForTicker(ticker);
    // Per-share cost: Book Value / Quantity (real cost) wins; else a cost column;
    // never the current "Market Price".
    var price = NaN;
    if (iBook >= 0) { var bv = num(row[iBook]); if (!isNaN(bv) && shares > 0) price = bv / shares; }
    if (isNaN(price) && iP >= 0) price = num(row[iP]);
    if (isNaN(price) || price < 0) price = 0; // unknown cost → 0 (user can edit the lot)
    // Symbol to fetch the live price in the SAME currency as the cost basis.
    var sym = suffix ? ticker + suffix : ticker;

    var lot = { shares: shares, buyPrice: price, addedAt: Date.now() };
    var ex = portfolio.find(function (p) { return p.ticker === ticker && (p.cur || 'USD') === cur; });
    if (ex) {
      // Idempotent re-import: a holdings snapshot has one row per position, so skip
      // a lot that's already there (same shares+cost) instead of doubling it.
      var dup = ex.lots.some(function (l) { return l.shares === shares && l.buyPrice === price; });
      if (dup) continue;
      if (!ex.sym) ex.sym = sym; if (!ex.cur) ex.cur = cur;
      ex.lots.push(lot);
    } else {
      portfolio.push({ ticker: ticker, sym: sym, cur: cur, lots: [lot] });
    }
    added++;
  }
  savePortfolio();
  renderPortfolio();
  toast(added
    ? L('✓ Імпортовано ' + added, '✓ Imported ' + added, '✓ Importé ' + added)
    : L('⚠ Нічого не імпортовано', '⚠ Nothing imported', '⚠ Rien à importer'));
}

function handlePortfolioCSVFile(e) {
  var file = e.target.files && e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () { importPortfolioCSV(String(reader.result || '')); };
  reader.readAsText(file);
  e.target.value = ''; // reset so the same file can be re-imported
}

// Wipe the whole portfolio (confirm first) — needed to re-import a broker CSV
// cleanly instead of stacking duplicate positions on top of the old ones.
function clearPortfolio() {
  if (!portfolio.length) return;
  if (!confirm(L('Очистити весь портфель?', 'Clear the whole portfolio?', 'Vider tout le portefeuille ?'))) return;
  portfolio = [];
  savePortfolio();
  renderPortfolio();
  toast(L('✓ Портфель очищено', '✓ Portfolio cleared', '✓ Portefeuille vidé'));
}

function removePortfolioPosition(idx) {
  portfolio.splice(idx, 1);
  savePortfolio();
  renderPortfolio();
}

function removeLot(posIdx, lotIdx) {
  var p = portfolio[posIdx];
  if (!p) return;
  p.lots.splice(lotIdx, 1);
  if (p.lots.length === 0) portfolio.splice(posIdx, 1); // last buy removed → position gone
  savePortfolio();
  renderPortfolio();
}

function renderPortfolio() {
  var listEl = document.getElementById('portfolio-list');
  var summEl = document.getElementById('portfolio-summary');

  if (!portfolio.length) {
    summEl.style.display = 'none';
    listEl.innerHTML = '<div class="empty"><div class="empty-icon">💼</div><p>' +
      (L('Портфель порожній.<br>Додай першу позицію вище.', 'Portfolio is empty.<br>Add your first position above.', 'Portefeuille vide.<br>Ajoutez votre première position ci-dessus.')) +
      '</p></div>';
    return;
  }

  // A mixed-currency portfolio (TSX in CAD + NYSE in USD) is valued in one base:
  // convert every native amount → USD, then fmtMoney renders it in the toggle
  // currency. Pre-load USD→ccy for each native currency held so the avg-cost row
  // (rendered up front, before prices) already converts correctly.
  var curSet = {}; portfolio.forEach(function(p) { curSet[(p.cur || 'USD').toUpperCase()] = 1; });
  loadRates(Object.keys(curSet), function(rates) {
    var toUSD = function(amt, cur) { return amt / (rates[(cur || 'USD').toUpperCase()] || 1); };

  // Render rows with placeholders, then fetch prices.
  // Main row = position summary; click expands the purchase history (lots).
  var html = '';
  portfolio.forEach(function(p, i) {
    var shares = posShares(p);
    var avg = shares > 0 ? toUSD(posInvested(p), p.cur) / shares : 0;
    var hint = p.lots.length > 1 ? ' ▸ ' + p.lots.length + (L(' покупки', ' buys', ' achats')) : '';
    html += '<div class="pf-row" id="pf-row-' + i + '" data-idx="' + i + '" style="cursor:pointer">' +
      '<span class="pf-ticker">' + p.ticker + '</span>' +
      '<div class="pf-info">' +
        '<div class="pf-shares">' + shares + ' ' + (L('акцій', 'shares', 'actions')) + ' · ' + fmtMoney(avg) + hint + '</div>' +
        '<div class="pf-prices" id="pf-price-' + i + '" style="color:var(--dim)">—</div>' +
      '</div>' +
      '<div class="pf-pl" id="pf-pl-' + i + '" style="color:var(--dim)">—</div>' +
      '<button class="pf-remove" data-idx="' + i + '">✕</button>' +
    '</div>';
    // Hidden lot history under the row (Wealthsimple "Activity" style)
    html += '<div class="pf-lots" id="pf-lots-' + i + '" style="display:none;padding:2px 12px 8px 24px">';
    p.lots.forEach(function(l, j) {
      var date = new Date(l.addedAt).toLocaleDateString(L('uk-UA', 'en-US', 'fr-FR'));
      html += '<div style="display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10px;color:var(--dim);padding:3px 0">' +
        '<span style="width:70px">' + date + '</span>' +
        '<span style="color:var(--text)">' + l.shares + ' × ' + fmtMoney(toUSD(l.buyPrice, p.cur)) + '</span>' +
        '<span style="margin-left:auto">' + fmtMoney(toUSD(l.shares * l.buyPrice, p.cur)) + '</span>' +
        '<button class="pf-lot-remove" data-pos="' + i + '" data-lot="' + j + '" style="background:none;border:none;color:var(--dim);cursor:pointer;font-size:10px">✕</button>' +
      '</div>';
    });
    html += '</div>';
  });
  listEl.innerHTML = html;

  listEl.querySelectorAll('.pf-remove').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      removePortfolioPosition(parseInt(this.getAttribute('data-idx')));
    });
  });
  // Click on a position toggles its purchase history
  listEl.querySelectorAll('.pf-row').forEach(function(row) {
    row.addEventListener('click', function() {
      var lotsEl = document.getElementById('pf-lots-' + this.getAttribute('data-idx'));
      if (lotsEl) lotsEl.style.display = lotsEl.style.display === 'none' ? 'block' : 'none';
    });
  });
  // Removing a single lot (one purchase)
  listEl.querySelectorAll('.pf-lot-remove').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      removeLot(parseInt(this.getAttribute('data-pos')), parseInt(this.getAttribute('data-lot')));
    });
  });

  // Fetch current prices and compute P&L
  var totalInvested = 0, totalCurrent = 0, totalDayChange = 0;
  var pending = portfolio.length;
  var failed  = 0;

  portfolio.forEach(function(p, i) {
    // NOTE: totalInvested is accumulated only when a price IS available,
    // so P&L = totalCurrent - totalInvested reflects only priced positions.
    // Fetch the listing that matches the cost basis' currency (p.sym, e.g. CNQ.TO
    // in CAD), then convert to USD so a CAD cost isn't compared to a USD price.
    loadLivePrice(p.sym || p.ticker, function(d) {
      if (!d || !d.c || d.c === 0) { failed++; pending--; updateSummary(); return; }
      var invested = toUSD(posInvested(p), p.cur);
      var current  = toUSD(posShares(p) * d.c, p.cur);
      totalInvested += invested;
      var pl    = current - invested;
      var plPct = invested > 0 ? (pl / invested * 100) : 0;
      var up    = pl >= 0;
      var color = up ? 'var(--green)' : 'var(--red)';
      var sign  = up ? '+' : '';

      // Today's change (Wealthsimple-style): pct is currency-free; the amount is
      // shares × (now − prev close), converted to USD like everything else.
      var dayPct = (d.pc && d.pc > 0) ? ((d.c - d.pc) / d.pc * 100) : 0;
      var dayChg = (d.pc && d.pc > 0) ? toUSD(posShares(p) * (d.c - d.pc), p.cur) : 0;
      totalDayChange += dayChg;

      var priceEl = document.getElementById('pf-price-' + i);
      var plEl    = document.getElementById('pf-pl-' + i);
      if (priceEl) {
        var dUp = dayPct >= 0;
        priceEl.innerHTML = '<span style="color:var(--text)">' + fmtMoney(toUSD(d.c, p.cur)) + '</span> ' +
          '<span style="font-size:10px;color:' + (dUp ? 'var(--green)' : 'var(--red)') + '">' +
          (dUp ? '▲' : '▼') + Math.abs(dayPct).toFixed(1) + (L('% сьогодні', '% today', " % aujourd'hui")) + '</span>';
      }
      if (plEl) {
        plEl.innerHTML = '<span style="color:' + color + '">' + sign + fmtMoney(Math.abs(pl)) + '</span>' +
          '<br><span style="font-size:10px;color:' + color + '">' + sign + plPct.toFixed(1) + '%</span>';
      }
      totalCurrent += current;
      pending--;
      updateSummary();
    });
  });

  function updateSummary() {
    if (pending > 0) return;
    var pl    = totalCurrent - totalInvested;
    var plPct = totalInvested > 0 ? (pl / totalInvested * 100) : 0;
    var up    = pl >= 0;
    var color = up ? 'var(--green)' : 'var(--red)';
    var sign  = up ? '+' : '';
    var partial = failed > 0
      ? '<div style="font-family:var(--mono);font-size:9px;color:var(--yellow);text-align:center;margin-top:6px">' +
        (L('⚠ ' + failed + ' ціни не завантажились', '⚠ ' + failed + ' prices unavailable', '⚠ ' + failed + ' prix indisponibles')) + '</div>'
      : '';
    var dUp = totalDayChange >= 0;
    var dColor = dUp ? 'var(--green)' : 'var(--red)';
    var dSign = dUp ? '+' : '';
    // Today's total change — small line under the summary row (keeps the
    // liked Invested/Current/P&L trio intact, adds the Wealthsimple "today")
    var todayLine = '<div style="font-family:var(--mono);font-size:10px;text-align:center;margin-top:6px;color:' + dColor + '">' +
      (L('Сьогодні: ', 'Today: ', "Aujourd'hui : ")) + dSign + fmtMoney(Math.abs(totalDayChange)) + '</div>';
    summEl.style.display = 'block';
    summEl.innerHTML = '<div class="pf-summary-row">' +
      '<div class="pf-sum-item"><div class="pf-sum-lbl">' + (L('Вкладено', 'Invested', 'Investi')) + '</div><div class="pf-sum-val" style="color:var(--text)">' + fmtMoney(totalInvested) + '</div></div>' +
      '<div class="pf-sum-item"><div class="pf-sum-lbl">' + (L('Зараз', 'Current', 'Actuel')) + '</div><div class="pf-sum-val" style="color:var(--text)">' + fmtMoney(totalCurrent) + '</div></div>' +
      '<div class="pf-sum-item"><div class="pf-sum-lbl">P&L</div><div class="pf-sum-val" style="color:' + color + '">' + sign + fmtMoney(Math.abs(pl)) + ' (' + sign + plPct.toFixed(1) + '%)</div></div>' +
    '</div>' + todayLine + partial;
  }
  }); // loadRates
}
