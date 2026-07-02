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

  scan(document.body);

  // Re-scan on dynamically loaded content (infinite-scroll news), debounced.
  var timer = null;
  var mo = new MutationObserver(function (muts) {
    if (count >= MAX_HL) { mo.disconnect(); return; }
    if (timer) return;
    timer = setTimeout(function () {
      timer = null;
      muts.forEach(function (mu) {
        for (var i = 0; i < mu.addedNodes.length; i++) {
          var nd = mu.addedNodes[i];
          if (nd.nodeType === 1 && !(nd.classList && nd.classList.contains(HL_CLASS))) scan(nd);
        }
      });
    }, 500);
  });
  try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
})();
