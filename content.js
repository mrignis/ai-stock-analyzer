'use strict';
// Content script (growth feature, council pick "A"): on financial news pages it
// highlights stock tickers written in the usual notations and lets the user click
// one to open a full AI analysis. Scoped to a few finance sites via manifest
// `matches` — NO broad host permissions. Detection is purely local (regex); the
// click hands the ticker to the extension. Kept lightweight so it never hangs a tab.
(function () {
  if (window.__aisTickerHL) return; // guard against double-injection
  window.__aisTickerHL = true;

  var HL_CLASS = 'ais-tk-hl';
  var MAX_HL = 250;      // safety cap per page
  var count = 0;
  var WORKER = 'https://stock-ai-analyzer.chelb-dev.workers.dev'; // in host_permissions

  // Cashtags ($TSLA) and parenthesised tickers (AAPL). Common acronyms are NOT
  // tickers — exclude them so we don't underline "(USA)" or "(CEO)".
  var STOP = { USA:1, CEO:1, CFO:1, COO:1, GDP:1, AI:1, ETF:1, IPO:1, SEC:1, FED:1,
    USD:1, EUR:1, GBP:1, CAD:1, NYSE:1, API:1, EU:1, UK:1, US:1, Q1:1, Q2:1, Q3:1, Q4:1,
    ESG:1, EPS:1, PE:1, YOY:1, CNBC:1, FAQ:1, TV:1, AM:1, PM:1, ID:1, IT:1, PR:1, HR:1 };
  var RE = /\$([A-Za-z]{1,5})\b|\(([A-Z]{2,5})\)/g;

  function tickerAt(m) {
    var t = (m[1] || m[2] || '').toUpperCase();
    if (!t || t.length < 2 || STOP[t]) return null;
    return t;
  }

  var SKIP = { SCRIPT:1, STYLE:1, NOSCRIPT:1, TEXTAREA:1, INPUT:1, SELECT:1, A:1, BUTTON:1, CODE:1 };
  function skip(node) {
    for (var p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      if (SKIP[p.nodeName]) return true;
      if (p.isContentEditable) return true;
      if (p.classList && p.classList.contains(HL_CLASS)) return true;
    }
    return false;
  }

  function wrap(textNode) {
    if (count >= MAX_HL) return;
    var text = textNode.nodeValue;
    if (!text || text.length < 3) return;
    if (text.indexOf('$') < 0 && text.indexOf('(') < 0) return; // fast reject
    RE.lastIndex = 0;
    var m, last = 0, frag = null;
    while ((m = RE.exec(text)) && count < MAX_HL) {
      var t = tickerAt(m);
      if (!t) continue;
      // Highlight only the ticker letters, not the $ or the parens
      var raw = m[0];
      var tickStart = m.index + raw.indexOf(m[1] || m[2]);
      var tickEnd = tickStart + t.length;
      if (!frag) frag = document.createDocumentFragment();
      if (tickStart > last) frag.appendChild(document.createTextNode(text.slice(last, tickStart)));
      var span = document.createElement('span');
      span.className = HL_CLASS;
      span.setAttribute('data-ais', t);
      span.textContent = text.slice(tickStart, tickEnd);
      span.style.cssText = 'border-bottom:1.5px dotted #16a34a;cursor:pointer;color:inherit';
      span.title = 'AI Stock Analyzer — ' + t;
      frag.appendChild(span);
      last = tickEnd;
      count++;
    }
    if (frag) {
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      textNode.parentNode.replaceChild(frag, textNode);
    }
  }

  function scan(root) {
    if (!root || count >= MAX_HL) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return (!skip(n) && n.nodeValue && (n.nodeValue.indexOf('$') >= 0 || n.nodeValue.indexOf('(') >= 0))
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n); // collect first (wrap mutates the tree)
    nodes.forEach(wrap);
  }

  // Click a highlighted ticker → ask the background to open the full analysis.
  document.addEventListener('click', function (e) {
    var el = e.target;
    if (el && el.classList && el.classList.contains(HL_CLASS)) {
      e.preventDefault(); e.stopPropagation();
      var t = el.getAttribute('data-ais');
      if (t) chrome.runtime.sendMessage({ action: 'openAnalysis', ticker: t });
    }
  }, true);

  // ── Phase 2: hover a highlighted ticker → floating card with the LIVE price ──
  // Cheap (a /price GET, cached 60s per ticker) — no AI cost. Click still opens the
  // full analysis. Card has pointer-events:none so it never intercepts page input.
  var card = null, hideTimer = null, priceCache = {}, userLang = 'en';
  try { chrome.storage.local.get('lang', function (s) { if (s && s.lang) userLang = s.lang; }); } catch (e) {}
  function L2(ua, en, fr) { return userLang === 'fr' ? fr : userLang === 'ua' ? ua : en; }

  function ensureCard() {
    if (card) return card;
    card = document.createElement('div');
    card.id = 'ais-tk-card';
    card.style.cssText = 'position:fixed;z-index:2147483647;background:#0f1420;color:#e8eaed;' +
      'border:1px solid #2a3345;border-radius:8px;padding:8px 10px;font:12px/1.35 system-ui,Arial,sans-serif;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:none;max-width:250px;display:none';
    (document.body || document.documentElement).appendChild(card);
    return card;
  }
  function paint(c, t, d) {
    var head = '<b style="color:#4ade80;font-family:monospace">' + t + '</b>';
    if (!d || !d.c) { c.innerHTML = head + ' · ' + L2('нема даних', 'no data', 'aucune donnée'); return; }
    var pc = d.dp != null ? d.dp : (d.pc > 0 ? ((d.c - d.pc) / d.pc * 100) : 0);
    var up = pc >= 0, col = up ? '#4ade80' : '#f87171', ar = up ? '▲' : '▼';
    c.innerHTML = head + ' <span style="font-family:monospace">$' + d.c + '</span> ' +
      '<span style="color:' + col + ';font-family:monospace">' + ar + ' ' + Math.abs(pc).toFixed(2) + '%</span>' +
      '<div style="margin-top:4px;color:#8b93a7;font-size:11px">' +
      L2('Клік — повний аналіз', 'Click for full analysis', "Cliquez pour l'analyse") + '</div>';
  }
  function showCard(target, t) {
    var c = ensureCard();
    var r = target.getBoundingClientRect();
    c.style.display = 'block';
    c.style.top = (r.bottom + 6) + 'px';
    c.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 256)) + 'px';
    var hit = priceCache[t];
    if (hit && Date.now() - hit.at < 60000) { paint(c, t, hit.d); return; }
    c.innerHTML = '<b style="color:#4ade80;font-family:monospace">' + t + '</b> · ' + L2('ціна…', 'loading…', 'chargement…');
    fetch(WORKER + '/price?ticker=' + encodeURIComponent(t))
      .then(function (r) { return r.json(); })
      .then(function (d) { priceCache[t] = { at: Date.now(), d: d }; if (card && card.style.display !== 'none') paint(card, t, d); })
      .catch(function () {});
  }
  document.addEventListener('mouseover', function (e) {
    var el = e.target;
    if (el && el.classList && el.classList.contains(HL_CLASS)) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      var t = el.getAttribute('data-ais'); if (t) showCard(el, t);
    }
  }, true);
  document.addEventListener('mouseout', function (e) {
    var el = e.target;
    if (el && el.classList && el.classList.contains(HL_CLASS)) {
      hideTimer = setTimeout(function () { if (card) card.style.display = 'none'; }, 150);
    }
  }, true);

  scan(document.body);

  // Re-scan on dynamically loaded content (infinite-scroll news), debounced.
  // Accumulate added nodes across ALL mutations in the debounce window (the old
  // code only kept the first batch, dropping nodes added mid-window), then scan
  // once. Skip nodes detached before the timer fires.
  var timer = null, pending = [];
  var mo = new MutationObserver(function (muts) {
    if (count >= MAX_HL) { mo.disconnect(); return; }
    for (var j = 0; j < muts.length; j++) {
      var an = muts[j].addedNodes;
      for (var i = 0; i < an.length; i++) {
        if (an[i].nodeType === 1 && !(an[i].classList && an[i].classList.contains(HL_CLASS))) pending.push(an[i]);
      }
    }
    if (timer || !pending.length) return;
    timer = setTimeout(function () {
      timer = null;
      var batch = pending; pending = [];
      batch.forEach(function (nd) { if (nd.isConnected !== false) scan(nd); });
    }, 500);
  });
  try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
})();
