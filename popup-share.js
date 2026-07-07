'use strict';
// ── Share card (viral "AI DD Card", growth feature) ──────────────────────────
// Renders the current analysis as a branded image (canvas) the user can copy,
// download, or post to X/Reddit. No new permissions: canvas + best-effort
// clipboard (falls back to download) + a tab to the share intent.
// Deps (globals): currentTicker, currentData (popup.js); L (popup.js); toast (core.js).

var STORE_URL = 'https://chromewebstore.google.com/detail/gmildjlnkoljdenbocapnkpllgkdombk';
var VCOLOR = { green: '#4ade80', yellow: '#fbbf24', red: '#f87171', blue: '#60a5fa' };

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Draw the card. Returns nothing; paints on #share-canvas (800x418).
function drawShareCard() {
  var cv = document.getElementById('share-canvas');
  var ctx = cv.getContext('2d');
  var W = cv.width, H = cv.height;
  var d = currentData || {};
  var accent = VCOLOR[d.color] || VCOLOR.blue;

  // Background gradient + baseline
  var g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#111623'); g.addColorStop(1, '#0a0c12');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Accent left bar
  ctx.fillStyle = accent; ctx.fillRect(0, 0, 8, H);

  var PX = 44;
  // Ticker + verdict pill
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = accent;
  ctx.font = '700 56px "Segoe UI", Arial, sans-serif';
  ctx.fillText(currentTicker || '', PX, 92);
  var tickW = ctx.measureText(currentTicker || '').width;
  var verdict = (d.verdict || '').toString();
  if (verdict) {
    ctx.font = '600 26px "Segoe UI", Arial, sans-serif';
    var vw = ctx.measureText(verdict).width + 36;
    rr(ctx, PX + tickW + 22, 56, vw, 42, 21); ctx.fillStyle = accent; ctx.fill();
    ctx.fillStyle = '#0a0f0a'; ctx.fillText(verdict, PX + tickW + 40, 86);
  }

  // Price line (read the already-formatted price box)
  var pb = document.getElementById('price-box');
  var priceTxt = pb ? (pb.textContent || '').replace(/Finnhub/gi, '').replace(/\s+/g, ' ').trim() : '';
  ctx.fillStyle = '#e8eaed';
  ctx.font = '600 34px "Segoe UI", Arial, sans-serif';
  ctx.fillText(priceTxt, PX, 150);

  // Stat row: sector · risk · trend
  var stats = [d.sector, d.risk, d.trend].filter(Boolean).join('   ·   ');
  ctx.fillStyle = '#9aa2b4';
  ctx.font = '400 22px "Segoe UI", Arial, sans-serif';
  ctx.fillText(stats.slice(0, 60), PX, 196);

  // Insight line (forecast, trimmed to 2 lines)
  var insight = (d.forecast || d.conclusion || '').toString().trim();
  ctx.fillStyle = '#c7ccd8';
  ctx.font = '400 23px "Segoe UI", Arial, sans-serif';
  wrapText(ctx, insight, PX, 244, W - PX * 2, 32, 2);

  // Fill the mid band: analyst consensus bar when there is coverage, otherwise the
  // real 30-day chart (reused from #trend-chart) — so ETFs/no-coverage never leave
  // an awkward gap. bw/bx shared.
  var a = d.analysts;
  var total = a ? (a.strongBuy + a.buy + a.hold + a.sell + a.strongSell) : 0;
  var bw = W - PX * 2, bx = PX, yBar = 322;
  if (a && total > 0) {
    var buy = a.strongBuy + a.buy, hold = a.hold, sell = a.sell + a.strongSell;
    ctx.fillStyle = '#7a7f8a'; ctx.font = '400 16px "Segoe UI", Arial, sans-serif';
    ctx.fillText(L('Аналітики', 'Analysts', 'Analystes') + ' · ' + total +
      '   (' + buy + ' ' + L('купувати', 'buy', 'acheter') + ' · ' + hold + ' ' + L('тримати', 'hold', 'conserver') +
      ' · ' + sell + ' ' + L('продавати', 'sell', 'vendre') + ')', PX, yBar - 10);
    var seg = function (x, w, col) { rr(ctx, x, yBar, Math.max(0, w), 12, 6); ctx.fillStyle = col; ctx.fill(); };
    seg(bx, bw * buy / total, '#4ade80');
    seg(bx + bw * buy / total, bw * hold / total, '#7a7f8a');
    seg(bx + bw * (buy + hold) / total, bw * sell / total, '#f87171');
  } else {
    var tc = document.getElementById('trend-chart');
    if (tc && tc.width) {
      ctx.fillStyle = '#7a7f8a'; ctx.font = '400 16px "Segoe UI", Arial, sans-serif';
      ctx.fillText(L('Тренд 30 днів', '30-day trend', 'Tendance 30 jours'), PX, 300);
      try { ctx.drawImage(tc, bx, 308, bw, 56); } catch (e) {}
    }
  }

  // Watermark footer
  ctx.fillStyle = accent; ctx.font = '700 22px "Segoe UI", Arial, sans-serif';
  ctx.fillText('▲ AI Stock Analyzer', PX, H - 26);
  ctx.fillStyle = '#7a7f8a'; ctx.font = '400 18px "Segoe UI", Arial, sans-serif';
  var note = L('Не фінансова порада', 'Not financial advice', 'Pas un conseil financier');
  ctx.fillText(note, W - PX - ctx.measureText(note).width, H - 26);
}

function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
  var words = (text || '').split(' '), line = '', lines = 0;
  for (var i = 0; i < words.length; i++) {
    var test = line + words[i] + ' ';
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line.trim(), x, y); y += lh; lines++; line = words[i] + ' ';
      if (lines >= maxLines - 1) {
        var rest = words.slice(i).join(' ');
        while (ctx.measureText(rest + '…').width > maxW && rest.length) rest = rest.slice(0, -1);
        ctx.fillText(rest + (words.slice(i).join(' ').length > rest.length ? '…' : ''), x, y); return;
      }
    } else line = test;
  }
  if (line.trim()) ctx.fillText(line.trim(), x, y);
}

function openShareCard() {
  if (!currentTicker || !currentData) return;
  drawShareCard();
  document.getElementById('share-overlay').style.display = 'flex';
}
function closeShareCard() { document.getElementById('share-overlay').style.display = 'none'; }

function shareCardBlob(cb) { document.getElementById('share-canvas').toBlob(cb, 'image/png'); }

function copyShareCard() {
  shareCardBlob(function (blob) {
    if (navigator.clipboard && window.ClipboardItem) {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
        toast(L('✓ Скопійовано — вставте у пост', '✓ Copied — paste into your post', '✓ Copié — collez dans votre post'));
      }).catch(function () { downloadShareCard(); });
    } else downloadShareCard();
  });
}
function downloadShareCard() {
  var url = document.getElementById('share-canvas').toDataURL('image/png');
  var a = document.createElement('a');
  a.href = url; a.download = (currentTicker || 'analysis') + '-ai-stock-analyzer.png';
  document.body.appendChild(a); a.click(); a.remove();
  toast(L('✓ Завантажено', '✓ Downloaded', '✓ Téléchargé'));
}
// $TICKER is a clickable cashtag on X and boosts discovery. A few rotating hooks
// (light A/B) keep repeat posts from all reading identical.
function shareHook() {
  var t = currentTicker || '', v = (currentData && currentData.verdict) || '';
  var hooks = [
    '$' + t + ' — AI verdict: ' + v + '.',
    'My AI just rated $' + t + ': ' + v + '.',
    '$' + t + ' AI analysis → ' + v + '.',
  ];
  return hooks[Math.floor(Math.random() * hooks.length)];
}
function shareText() { return shareHook() + ' via AI Stock Analyzer'; } // Reddit title (hashtags do nothing there)
function shareToX() {
  copyShareCard();
  var text = shareHook() + ' Free AI stock DD 👇 #stocks #investing\n';
  var u = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(STORE_URL);
  chrome.tabs.create({ url: u });
}
function shareToReddit() {
  copyShareCard();
  var u = 'https://www.reddit.com/submit?title=' + encodeURIComponent(shareText()) + '&url=' + encodeURIComponent(STORE_URL);
  chrome.tabs.create({ url: u });
}
