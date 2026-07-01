'use strict';

// ── Portfolio ─────────────────────────────────────────────────────────────────
// Split out of popup.js (no build step): shares the global scope, loaded before
// popup.js. Depends on `portfolio` (global var in popup.js), fmtMoney/loadLivePrice
// (core.js) and toast (popup.js) — all resolved at call time, post-DOMContentLoaded.

function savePortfolio() { save({ portfolio: portfolio }); }

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
    portfolio.push({ ticker: ticker, lots: [lot] });
  }
  savePortfolio();
  document.getElementById('pf-ticker').value = '';
  document.getElementById('pf-shares').value = '';
  document.getElementById('pf-buyprice').value = '';
  document.getElementById('pf-ticker').focus();
  renderPortfolio();
  toast(L('✓ Додано ' + ticker, '✓ Added ' + ticker, '✓ Ajouté ' + ticker));
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

  // Render rows with placeholders, then fetch prices.
  // Main row = position summary; click expands the purchase history (lots).
  var html = '';
  portfolio.forEach(function(p, i) {
    var shares = posShares(p);
    var avg = shares > 0 ? posInvested(p) / shares : 0;
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
        '<span style="color:var(--text)">' + l.shares + ' × ' + fmtMoney(l.buyPrice) + '</span>' +
        '<span style="margin-left:auto">' + fmtMoney(l.shares * l.buyPrice) + '</span>' +
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
    loadLivePrice(p.ticker, function(d) {
      if (!d || !d.c || d.c === 0) { failed++; pending--; updateSummary(); return; }
      var curPrice = d.c;
      var invested = posInvested(p);
      var current  = posShares(p) * curPrice;
      totalInvested += invested;
      var pl    = current - invested;
      var plPct = invested > 0 ? (pl / invested * 100) : 0;
      var up    = pl >= 0;
      var color = up ? 'var(--green)' : 'var(--red)';
      var sign  = up ? '+' : '';

      // Today's change for this position (Wealthsimple-style): shares × (now − prev close)
      var dayPct = (d.pc && d.pc > 0) ? ((d.c - d.pc) / d.pc * 100) : 0;
      var dayChg = (d.pc && d.pc > 0) ? posShares(p) * (d.c - d.pc) : 0;
      totalDayChange += dayChg;

      var priceEl = document.getElementById('pf-price-' + i);
      var plEl    = document.getElementById('pf-pl-' + i);
      if (priceEl) {
        var dUp = dayPct >= 0;
        priceEl.innerHTML = '<span style="color:var(--text)">' + fmtMoney(curPrice) + '</span> ' +
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
}
