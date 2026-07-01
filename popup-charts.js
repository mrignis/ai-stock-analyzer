'use strict';
// ── Charts ────────────────────────────────────────────────────────────────────
// Split out of popup.js (cousin's "hard to scale" feedback). Plain script,
// NOT a module — shares the global scope with popup.js, so it reads globals
// (lang, currentData, currentTicker, cacheGet, WORKER_URL...) at call time.
// Loaded before popup.js in popup.html.

var CHART_COLORS = { green:'#4ade80', yellow:'#fbbf24', red:'#f87171', blue:'#60a5fa' };

// Shared canvas drawing — used by both real and simulated chart functions
function drawChartLine(canvas, pts, lc, changePct) {
  var ctx = canvas.getContext('2d');
  var H = canvas.height, n = pts.length;
  var chEl = document.getElementById('chart-change');
  if (chEl) {
    chEl.style.color = changePct >= 0 ? 'var(--green)' : 'var(--red)';
    chEl.textContent = (changePct >= 0 ? '+' : '') + changePct.toFixed(1) + '%';
  }
  ctx.clearRect(0, 0, canvas.width, H);
  ctx.beginPath(); ctx.moveTo(pts[0].x, H);
  pts.forEach(function(p) { ctx.lineTo(p.x, p.y); });
  ctx.lineTo(pts[n-1].x, H); ctx.closePath();
  ctx.fillStyle = lc + '22'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (var i = 1; i < n; i++) {
    var mx = (pts[i-1].x + pts[i].x) / 2;
    var my = (pts[i-1].y + pts[i].y) / 2;
    ctx.quadraticCurveTo(pts[i-1].x, pts[i-1].y, mx, my);
  }
  ctx.lineTo(pts[n-1].x, pts[n-1].y);
  ctx.strokeStyle = lc; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(pts[n-1].x, pts[n-1].y, 3, 0, Math.PI*2);
  ctx.fillStyle = lc; ctx.fill();
}

function fetchRealChart(ticker, color) {
  var lbl = document.getElementById('lbl-chart');
  cacheGet('candle_' + ticker, CACHE_CANDLE_TTL, function(cached) {
    if (cached) {
      drawChartFromPrices(cached, color);
      if (lbl) lbl.textContent = (L('Реальні дані 30д', 'Real data 30d', 'Données réelles 30j'));
      return;
    }
    fetch(WORKER_URL + '/candle?ticker=' + ticker)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.c && d.c.length >= 2) {
          cacheSet('candle_' + ticker, d.c);
          drawChartFromPrices(d.c, color);
          if (lbl) lbl.textContent = (L('Реальні дані 30д', 'Real data 30d', 'Données réelles 30j'));
        } else {
          drawChartSimulated(currentData ? currentData.dir : 'flat', color);
          if (lbl) lbl.textContent = (L('Тренд (прогноз)', 'Trend (forecast)', 'Tendance (prévision)'));
        }
      })
      .catch(function() {
        drawChartSimulated(currentData ? currentData.dir : 'flat', color);
        if (lbl) lbl.textContent = (L('Тренд (прогноз)', 'Trend (forecast)', 'Tendance (prévision)'));
      });
  });
}

function drawChartFromPrices(prices, color) {
  var canvas = document.getElementById('trend-chart');
  if (!canvas) return;
  var W = canvas.offsetWidth || 400, H = 80, pad = 8;
  canvas.width = W; canvas.height = H;
  var min = Math.min.apply(null, prices);
  var max = Math.max.apply(null, prices);
  var range = max - min || 1;
  var n = prices.length;
  var pts = prices.map(function(p, i) {
    return {
      x: pad + (i / (n-1)) * (W - pad*2),
      y: H - pad - ((p - min) / range) * (H - pad*2)
    };
  });
  drawChartLine(canvas, pts, CHART_COLORS[color] || '#60a5fa', (prices[n-1] - prices[0]) / prices[0] * 100);
}

function drawChartSimulated(dir, color) {
  var canvas = document.getElementById('trend-chart');
  if (!canvas) return;
  var W = canvas.offsetWidth || 400, H = 80, pad = 8;
  canvas.width = W; canvas.height = H;
  var cfgs = { up:{d:-0.6,n:2.5}, up_strong:{d:-1.1,n:3}, down:{d:0.7,n:2.5}, volatile:{d:0,n:6}, flat:{d:0,n:1.5} };
  var cfg = cfgs[dir] || cfgs.flat;
  var seed = 0;
  for (var ci = 0; ci < currentTicker.length; ci++) seed += currentTicker.charCodeAt(ci);
  seed += dir.length * 31;
  var s = seed;
  function rand() { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; }
  var pts = [], y = H / 2;
  for (var i = 0; i < 30; i++) {
    y += cfg.d + (rand() - 0.5) * cfg.n * 2;
    y = Math.max(pad, Math.min(H - pad, y));
    pts.push({ x: pad + (i / 29) * (W - pad*2), y: y });
  }
  drawChartLine(canvas, pts, CHART_COLORS[color] || '#60a5fa', (pts[29].y - pts[0].y) / pts[0].y * -100);
}

// Tiny sparkline for the market cards — thin line + soft fill, green/red by trend
function drawSpark(canvasId, prices, up) {
  var canvas = document.getElementById(canvasId);
  if (!canvas || !prices || prices.length < 2) return;
  var W = canvas.offsetWidth || 100, H = canvas.offsetHeight || 22;
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');
  var min = Math.min.apply(null, prices);
  var max = Math.max.apply(null, prices);
  var range = max - min || 1;
  var n = prices.length;
  var pad = 2;
  var x = function(i) { return (i / (n - 1)) * W; };
  var y = function(p) { return H - pad - ((p - min) / range) * (H - pad * 2); };
  var stroke = up ? '#22C55E' : '#EF4444';

  // soft fill under the line
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (var i = 0; i < n; i++) ctx.lineTo(x(i), y(prices[i]));
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = up ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)';
  ctx.fill();

  // the trend line
  ctx.beginPath();
  ctx.moveTo(x(0), y(prices[0]));
  for (var j = 1; j < n; j++) ctx.lineTo(x(j), y(prices[j]));
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
}
