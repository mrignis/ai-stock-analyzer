'use strict';

// ── Replace with your Cloudflare Worker URL after deployment ─────────────────
var WORKER_URL = 'https://stock-ai-analyzer.chelb-dev.workers.dev';

var lang = 'ua';
var currentTicker = '';
var currentData = null;
var watchlist = [];
var historyList = [];

// Chat state
var chatHistory = [];
var chatContext = null;

function loadAll(cb) { chrome.storage.local.get(['lang','watchlist','history'], cb); }
function save(obj) { chrome.storage.local.set(obj); }

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  loadAll(function(s) {
    if (s.lang) lang = s.lang;
    if (s.watchlist) watchlist = s.watchlist;
    if (s.history) historyList = s.history;

    applyLang();

    document.getElementById('tab-search').addEventListener('click', function() { showPanel('search'); });
    document.getElementById('tab-watchlist').addEventListener('click', function() { showPanel('watchlist'); });
    document.getElementById('tab-history').addEventListener('click', function() { showPanel('history'); });
    document.getElementById('tab-chat').addEventListener('click', function() { showPanel('chat'); });
    document.getElementById('tab-alerts').addEventListener('click', function() { showPanel('alerts'); });
    document.getElementById('tab-settings').addEventListener('click', function() { showPanel('settings'); });

    document.getElementById('lang-btn').addEventListener('click', function() {
      lang = lang === 'ua' ? 'en' : 'ua';
      save({ lang: lang });
      applyLang();
      renderWatchlist();
      renderHistory();
      if (currentTicker) runAnalysis();
    });

    document.getElementById('analyze-btn').addEventListener('click', runAnalysis);
    document.getElementById('stop-btn').addEventListener('click', stopAnalysis);
    document.getElementById('ticker-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') runAnalysis(); });

    var qps = document.querySelectorAll('.qp');
    for (var i = 0; i < qps.length; i++) {
      qps[i].addEventListener('click', function() {
        document.getElementById('ticker-input').value = this.getAttribute('data-ticker');
        runAnalysis();
      });
    }

    document.getElementById('watch-btn').addEventListener('click', toggleWatch);
    document.getElementById('btn-refresh').addEventListener('click', renderWatchlist);
    document.getElementById('btn-clear').addEventListener('click', function() { historyList = []; save({ history: [] }); renderHistory(); });

    // Chat
    document.getElementById('chat-send-btn').addEventListener('click', sendChat);
    document.getElementById('chat-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') sendChat(); });
    document.getElementById('chat-ctx-clear').addEventListener('click', clearChatContext);
  });
});

// ── Lang ──────────────────────────────────────────────────────────────────────
function applyLang() {
  var ua = lang === 'ua';
  document.getElementById('lang-btn').textContent = ua ? 'EN' : 'UA';
  document.getElementById('tab-search').textContent = ua ? 'Пошук' : 'Search';
  document.getElementById('tab-history').textContent = ua ? 'Іст.' : 'Hist.';
  document.getElementById('analyze-btn').textContent = ua ? 'Аналіз' : 'Analyze';
  document.getElementById('lbl-popular').textContent = ua ? 'Популярні:' : 'Popular:';
  document.getElementById('empty-text').textContent = ua ? 'Введи тікер і отримай AI-аналіз' : 'Enter a ticker for AI analysis';
  document.getElementById('r-disclaimer').textContent = ua ? 'Не є фінансовою порадою.' : 'Not financial advice.';
  document.getElementById('lbl-sector').textContent = ua ? 'Сектор' : 'Sector';
  document.getElementById('lbl-risk').textContent = ua ? 'Ризик' : 'Risk';
  document.getElementById('lbl-trend').textContent = ua ? 'Тренд' : 'Trend';
  document.getElementById('lbl-for').textContent = ua ? 'Для кого' : 'Best for';
  document.getElementById('lbl-chart').textContent = ua ? 'Тренд (30д)' : 'Trend (30d)';
  document.getElementById('lbl-what').textContent = ua ? 'Що робить компанія' : 'What the company does';
  document.getElementById('lbl-risks').textContent = ua ? 'Головні ризики' : 'Key risks';
  document.getElementById('lbl-forecast').textContent = ua ? 'AI Прогноз' : 'AI Forecast';
  document.getElementById('lbl-conclusion').textContent = ua ? 'Висновок AI' : 'AI Conclusion';
  document.getElementById('lbl-watchlist-title').textContent = ua ? 'Відстежуються' : 'Watchlist';
  document.getElementById('lbl-history-title').textContent = ua ? 'Історія пошуків' : 'Search History';
  document.getElementById('btn-clear').textContent = ua ? 'Очистити' : 'Clear';
  document.getElementById('lbl-alerts-title').textContent = ua ? 'Алерти цін' : 'Price Alerts';
  document.getElementById('alerts-info').textContent = ua ? 'Отримуй сповіщення коли акції з Watchlist змінюються більше ніж на заданий %.' : 'Get notified when Watchlist stocks change more than the set %.';
  document.getElementById('threshold-label').textContent = ua ? 'Поріг сповіщення (% зміни):' : 'Alert threshold (% change):';
  document.getElementById('btn-save-threshold').textContent = ua ? 'Зберегти' : 'Save';
  document.getElementById('btn-check-now').textContent = ua ? '↻ Перевірити' : '↻ Check now';
  document.getElementById('lbl-chat-ctx').textContent = ua ? 'Контекст:' : 'Context:';
  document.getElementById('lbl-chat-welcome').textContent = ua
    ? 'Привіт! Запитай мене про будь-яку акцію або ринок. Після аналізу — отримую контекст автоматично.'
    : 'Hi! Ask me about any stock or market. After analysis, I get context automatically.';
  document.getElementById('settings-how-it-works').textContent = ua
    ? 'Розширення використовує наш хмарний сервер для AI аналізу. Твої дані не зберігаються.'
    : 'The extension uses our cloud server for AI analysis. Your data is not stored.';
  var stopBtn = document.getElementById('stop-btn');
  if (stopBtn) stopBtn.textContent = ua ? '✕ Стоп' : '✕ Stop';
}

// ── Panels ────────────────────────────────────────────────────────────────────
function showPanel(id) {
  var panels = document.querySelectorAll('.panel');
  for (var i = 0; i < panels.length; i++) panels[i].classList.remove('active');
  var tabs = document.querySelectorAll('.nav-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  document.getElementById('panel-' + id).classList.add('active');
  document.getElementById('tab-' + id).classList.add('active');
  if (id === 'watchlist') renderWatchlist();
  if (id === 'history') renderHistory();
  if (id === 'alerts') initAlerts();
}

// ── Analysis ──────────────────────────────────────────────────────────────────
var currentAbort = null;

function stopAnalysis() {
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
  currentTicker = ''; currentData = null;
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('empty-state').style.display = 'block';
  document.getElementById('empty-text').textContent = lang === 'ua' ? 'Пошук скасовано.' : 'Search cancelled.';
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'block';
}

function runAnalysis() {
  var raw = document.getElementById('ticker-input').value.trim().toUpperCase();
  if (!raw) return;
  if (currentAbort) { currentAbort.abort(); }
  currentAbort = new AbortController();
  currentTicker = raw; currentData = null;
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('result').style.display = 'none';
  document.getElementById('loading-state').style.display = 'block';
  document.getElementById('loading-msg').textContent = (lang === 'ua' ? 'Аналізую ' : 'Analyzing ') + raw + '...';
  document.getElementById('price-box').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'block';

  var signal = currentAbort.signal;

  fetch(WORKER_URL + '/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticker: raw, lang: lang }),
    signal: signal,
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) throw new Error('Worker: ' + data.error + (data.raw ? ' | ' + data.raw.slice(0, 100) : ''));
      // Show price from worker response (avoids extra round trip)
      if (data._quote && data._quote.c) {
        var q = data._quote;
        var change = q.c - q.pc;
        var pct = (change / q.pc) * 100;
        showPrice({
          price: q.c.toFixed(2),
          change: (change >= 0 ? '+' : '') + change.toFixed(2),
          pct: (pct >= 0 ? '+' : '') + pct.toFixed(2),
          currency: 'USD',
        });
      }
      finish(raw, normalizeAI(data));
    })
    .catch(function(e) {
      if (e.name === 'AbortError') return;
      var msg = e.message || '';
      var retryMatch = msg.match(/retry in ([\d.]+)s/i);
      if (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('exhausted')) {
        var sec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
        msg = lang === 'ua'
          ? '⏳ Перевищено ліміт. Спробуй через ' + sec + ' сек.'
          : '⏳ Rate limit. Try again in ' + sec + ' sec.';
      }
      showError(msg || (lang === 'ua' ? 'Помилка з\'єднання' : 'Connection error'));
    });
}

function showPrice(info) {
  var el = document.getElementById('price-box');
  if (!info) { el.style.display = 'none'; return; }
  var up = parseFloat(info.change) >= 0;
  var c = up ? 'var(--green)' : 'var(--red)';
  var a = up ? '▲' : '▼';
  el.style.display = 'flex';
  el.innerHTML =
    '<span style="font-size:20px;font-weight:600;font-family:var(--mono);color:var(--text)">' + info.currency + ' ' + info.price + '</span>' +
    '<span style="font-size:12px;font-family:var(--mono);color:' + c + ';margin-left:10px">' + a + ' ' + info.change + ' (' + info.pct + '%)</span>' +
    '<span style="font-size:9px;color:var(--dim);font-family:var(--mono);margin-left:auto">Finnhub</span>';
}

function normalizeAI(j) {
  return {
    sector: j.sector || '',
    risk: j.risk || '',
    trend: j.trend || '',
    forWho: j.forWho || '',
    what: j.what || '',
    risks: j.risks || '',
    forecast: j.forecast || '',
    conclusion: j.conclusion || '',
    verdict: normalizeVerdict(j.verdict || '', lang),
    color: j.color || 'blue',
    dir: j.dir || j.trend_dir || 'flat',
  };
}

function normalizeVerdict(verdict, lang) {
  if (!verdict) return verdict;
  var v = verdict.toLowerCase().trim();
  var map = {
    'buy': { ua: 'Купувати', en: 'Buy' },
    'sell': { ua: 'Продавати', en: 'Sell' },
    'hold': { ua: 'Тримати', en: 'Hold' },
    'stable': { ua: 'Стабільно', en: 'Stable' },
    'risky': { ua: 'Ризиковано', en: 'Risky' },
    'promising': { ua: 'Перспективно', en: 'Promising' },
    'caution': { ua: 'Обережно', en: 'Caution' },
    'cautious': { ua: 'Обережно', en: 'Caution' },
    'situational': { ua: 'Ситуаційно', en: 'Situational' },
    'avoid': { ua: 'Уникати', en: 'Avoid' },
    'strong buy': { ua: 'Активно купувати', en: 'Strong Buy' },
    'bullish': { ua: 'Перспективно', en: 'Promising' },
    'bearish': { ua: 'Ризиковано', en: 'Risky' },
    'neutral': { ua: 'Нейтрально', en: 'Neutral' },
    'купувати': { ua: 'Купувати', en: 'Buy' },
    'купити': { ua: 'Купувати', en: 'Buy' },
    'продавати': { ua: 'Продавати', en: 'Sell' },
    'тримати': { ua: 'Тримати', en: 'Hold' },
    'стабільно': { ua: 'Стабільно', en: 'Stable' },
    'ризиковано': { ua: 'Ризиковано', en: 'Risky' },
    'перспективно': { ua: 'Перспективно', en: 'Promising' },
    'обережно': { ua: 'Обережно', en: 'Caution' },
    'ситуаційно': { ua: 'Ситуаційно', en: 'Situational' },
    'уникати': { ua: 'Уникати', en: 'Avoid' },
    'нейтрально': { ua: 'Нейтрально', en: 'Neutral' },
    'negative': { ua: 'Негативний', en: 'Negative' },
    'негативний': { ua: 'Негативний', en: 'Negative' },
    'positive': { ua: 'Позитивний', en: 'Positive' },
    'позитивний': { ua: 'Позитивний', en: 'Positive' },
    'growth': { ua: 'Зростання', en: 'Growth' },
    'зростання': { ua: 'Зростання', en: 'Growth' },
    'decline': { ua: 'Спад', en: 'Decline' },
    'спад': { ua: 'Спад', en: 'Decline' },
  };
  var found = map[v];
  if (found) return found[lang] || found.en;
  return verdict.charAt(0).toUpperCase() + verdict.slice(1);
}

function normalizeSector(sector, lang) {
  if (!sector) return sector;
  var map = {
    'technology': { ua: 'Технології', en: 'Technology' },
    'semiconductors': { ua: 'Напівпровідники', en: 'Semiconductors' },
    'automotive': { ua: 'Автомобілі', en: 'Automotive' },
    'auto / energy': { ua: 'Авто / Енергетика', en: 'Auto / Energy' },
    'social media / ai': { ua: 'Соц. мережі / AI', en: 'Social Media / AI' },
    'e-commerce / cloud': { ua: 'E-commerce / Cloud', en: 'E-commerce / Cloud' },
    'consumer goods': { ua: 'Споживчі товари', en: 'Consumer Goods' },
    'consumer discretionary': { ua: 'Споживчі товари', en: 'Consumer Discretionary' },
    'healthcare': { ua: 'Охорона здоровя', en: 'Healthcare' },
    'financials': { ua: 'Фінанси', en: 'Financials' },
    'information technology': { ua: 'Інф. технології', en: 'Information Technology' },
    'communication services': { ua: 'Комунікації', en: 'Communication Services' },
    'energy': { ua: 'Енергетика', en: 'Energy' },
    'utilities': { ua: 'Комунальні', en: 'Utilities' },
    'real estate': { ua: 'Нерухомість', en: 'Real Estate' },
    'materials': { ua: 'Матеріали', en: 'Materials' },
    'industrials': { ua: 'Промисловість', en: 'Industrials' },
    'defense': { ua: 'Оборонна пром.', en: 'Defense' },
    'biotech': { ua: 'Біотехнології', en: 'Biotech' },
    'biotechnology': { ua: 'Біотехнології', en: 'Biotechnology' },
    'pharmaceuticals': { ua: 'Фармацевтика', en: 'Pharmaceuticals' },
    'cloud computing': { ua: 'Хмарні обч.', en: 'Cloud Computing' },
    'artificial intelligence': { ua: 'Штучний інтелект', en: 'Artificial Intelligence' },
    'quantum computing': { ua: 'Квантові обч.', en: 'Quantum Computing' },
  };
  var found = map[sector.toLowerCase()];
  if (found) return found[lang] || found.en;
  return sector;
}

function finish(ticker, data) {
  currentAbort = null;
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'block';
  currentData = data;
  addHistory(ticker, data);
  renderResult(ticker, data);
  setChatContext(ticker, data);
}

function showError(msg) {
  currentAbort = null;
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'block';
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('empty-state').style.display = 'block';
  document.getElementById('empty-text').textContent = '⚠ ' + msg;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderResult(ticker, d) {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('result').style.display = 'block';
  document.getElementById('r-ticker').textContent = ticker;
  document.getElementById('r-sector').textContent = normalizeSector(d.sector, lang);
  document.getElementById('r-risk').textContent = d.risk;
  document.getElementById('r-trend').textContent = d.trend;
  document.getElementById('r-for').textContent = d.forWho;
  document.getElementById('r-what').textContent = d.what;
  document.getElementById('r-risks').textContent = d.risks;
  document.getElementById('r-forecast').textContent = d.forecast;
  document.getElementById('r-conclusion').textContent = d.conclusion;
  var pillMap = { green:'pill-green', yellow:'pill-yellow', red:'pill-red', blue:'pill-blue' };
  var vEl = document.getElementById('r-verdict');
  vEl.textContent = d.verdict; vEl.className = 'verdict-pill ' + (pillMap[d.color] || 'pill-blue');
  var sMap = {
    green: 'background:var(--green-dim);border:1px solid var(--green-border);color:var(--green)',
    yellow: 'background:var(--yellow-dim);border:1px solid rgba(251,191,36,0.25);color:var(--yellow)',
    red: 'background:var(--red-dim);border:1px solid rgba(248,113,113,0.25);color:var(--red)',
    blue: 'background:var(--blue-dim);border:1px solid rgba(96,165,250,0.25);color:var(--blue)',
  };
  document.getElementById('r-conclusion-box').style.cssText = sMap[d.color] || sMap.blue;
  drawChart(d.dir, d.color);
  updateWatchBtn();
}

function drawChart(dir, color) {
  var canvas = document.getElementById('trend-chart');
  var ctx = canvas.getContext('2d');
  var W = canvas.offsetWidth || 400, H = 80;
  canvas.width = W; canvas.height = H;
  var cfgs = { up:{d:-0.6,n:2.5}, up_strong:{d:-1.1,n:3}, down:{d:0.7,n:2.5}, volatile:{d:0,n:6}, flat:{d:0,n:1.5} };
  var cfg = cfgs[dir] || cfgs.flat;
  var pts = [], y = H / 2, pad = 8;
  for (var i = 0; i < 30; i++) {
    y += cfg.d + (Math.random() - 0.5) * cfg.n * 2;
    y = Math.max(pad, Math.min(H - pad, y));
    pts.push({ x: pad + (i / 29) * (W - pad * 2), y: y });
  }
  var cMap = { green:'#4ade80', yellow:'#fbbf24', red:'#f87171', blue:'#60a5fa' };
  var lc = cMap[color] || '#60a5fa';
  var ch = (((pts[29].y - pts[0].y) / pts[0].y) * -100).toFixed(1);
  var chEl = document.getElementById('chart-change');
  chEl.style.color = ch >= 0 ? 'var(--green)' : 'var(--red)';
  chEl.textContent = (ch >= 0 ? '+' : '') + ch + '%';
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath(); ctx.moveTo(pts[0].x, H);
  for (var i = 0; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineTo(pts[29].x, H); ctx.closePath(); ctx.fillStyle = lc + '22'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (var i = 1; i < pts.length; i++) {
    var mx = (pts[i - 1].x + pts[i].x) / 2;
    var my = (pts[i - 1].y + pts[i].y) / 2;
    ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, mx, my);
  }
  ctx.strokeStyle = lc; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(pts[29].x, pts[29].y, 3, 0, Math.PI * 2); ctx.fillStyle = lc; ctx.fill();
}

// ── Watchlist ─────────────────────────────────────────────────────────────────
function isInWatch(t) { for (var i = 0; i < watchlist.length; i++) if (watchlist[i].ticker === t) return true; return false; }
function updateWatchBtn() {
  var btn = document.getElementById('watch-btn');
  if (!currentTicker) return;
  if (isInWatch(currentTicker)) { btn.textContent = lang === 'ua' ? '✓ В списку' : '✓ Added'; btn.classList.add('added'); }
  else { btn.textContent = '+ Watchlist'; btn.classList.remove('added'); }
}
function toggleWatch() {
  if (!currentTicker || !currentData) return;
  if (isInWatch(currentTicker)) { watchlist = watchlist.filter(function(w) { return w.ticker !== currentTicker; }); }
  else { watchlist.push({ ticker: currentTicker, sector: currentData.sector, verdict: normalizeVerdict(currentData.verdict || '', 'en'), color: currentData.color, t: Date.now() }); }
  save({ watchlist: watchlist }); updateWatchBtn();
}
function renderWatchlist() {
  var el = document.getElementById('watchlist-content');
  if (!watchlist.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><p>' + (lang === 'ua' ? 'Watchlist порожній.' : 'Watchlist is empty.') + '</p></div>'; return; }
  var html = '';
  for (var i = 0; i < watchlist.length; i++) {
    var w = watchlist[i]; var pill = { green:'pill-green', yellow:'pill-yellow', red:'pill-red', blue:'pill-blue' }[w.color] || 'pill-blue';
    html += '<div class="watch-item" data-ticker="' + w.ticker + '"><span class="watch-ticker">' + w.ticker + '</span><div class="watch-info"><div class="watch-sector">' + normalizeSector(w.sector || '', lang) + '</div></div><span class="verdict-pill ' + pill + '">' + normalizeVerdict(w.verdict || '', lang) + '</span><button class="watch-remove" data-ticker="' + w.ticker + '">✕</button></div>';
  }
  el.innerHTML = html;
  var items = el.querySelectorAll('.watch-item');
  for (var i = 0; i < items.length; i++) { items[i].addEventListener('click', function(e) { if (e.target.classList.contains('watch-remove')) return; document.getElementById('ticker-input').value = this.getAttribute('data-ticker'); showPanel('search'); runAnalysis(); }); }
  var removes = el.querySelectorAll('.watch-remove');
  for (var i = 0; i < removes.length; i++) { removes[i].addEventListener('click', function(e) { e.stopPropagation(); var t = this.getAttribute('data-ticker'); watchlist = watchlist.filter(function(w) { return w.ticker !== t; }); save({ watchlist: watchlist }); renderWatchlist(); updateWatchBtn(); }); }
}

// ── History ───────────────────────────────────────────────────────────────────
function addHistory(ticker, data) {
  historyList = historyList.filter(function(h) { return h.ticker !== ticker; });
  historyList.unshift({ ticker: ticker, color: data.color, verdict: data.verdict, t: Date.now() });
  if (historyList.length > 20) historyList = historyList.slice(0, 20);
  save({ history: historyList });
}
function renderHistory() {
  var el = document.getElementById('history-content');
  if (!historyList.length) { el.innerHTML = '<div class="empty"><div class="empty-icon">🕐</div><p>' + (lang === 'ua' ? 'Історія порожня.' : 'History is empty.') + '</p></div>'; return; }
  var html = '';
  for (var i = 0; i < historyList.length; i++) {
    var h = historyList[i]; var pill = { green:'pill-green', yellow:'pill-yellow', red:'pill-red', blue:'pill-blue' }[h.color] || 'pill-blue';
    var diff = Math.floor((Date.now() - h.t) / 60000);
    var time = diff < 1 ? (lang === 'ua' ? 'Щойно' : 'Just now') : diff < 60 ? diff + (lang === 'ua' ? ' хв' : 'm ago') : Math.floor(diff / 60) + (lang === 'ua' ? ' год' : 'h ago');
    html += '<div class="hist-item" data-ticker="' + h.ticker + '"><span class="hist-ticker">' + h.ticker + '</span><span class="hist-time">' + time + '</span><span class="verdict-pill ' + pill + '">' + normalizeVerdict(h.verdict || '', lang) + '</span></div>';
  }
  el.innerHTML = html;
  var items = el.querySelectorAll('.hist-item');
  for (var i = 0; i < items.length; i++) { items[i].addEventListener('click', function() { document.getElementById('ticker-input').value = this.getAttribute('data-ticker'); showPanel('search'); runAnalysis(); }); }
}

function toast(msg) {
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:var(--green);color:#0a0f0a;font-family:var(--mono);font-size:11px;padding:6px 16px;border-radius:20px;z-index:999;pointer-events:none';
  t.textContent = msg; document.body.appendChild(t); setTimeout(function() { t.remove(); }, 2000);
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function setChatContext(ticker, data) {
  chatContext = ticker + ': sector=' + data.sector + ', verdict=' + data.verdict + ', trend=' + data.trend + ', risk=' + data.risk + '. Forecast: ' + data.forecast;
  var bar = document.getElementById('chat-ctx-bar');
  document.getElementById('chat-ctx-ticker').textContent = ticker;
  bar.style.display = 'flex';
}

function clearChatContext() {
  chatContext = null;
  document.getElementById('chat-ctx-bar').style.display = 'none';
  document.getElementById('chat-ctx-ticker').textContent = '';
}

function sendChat() {
  var input = document.getElementById('chat-input');
  var msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  input.focus();

  appendChatMsg('user', msg);
  chatHistory.push({ role: 'user', content: msg });

  var typingEl = appendChatMsg('ai', lang === 'ua' ? 'Думаю...' : 'Thinking...', true);

  fetch(WORKER_URL + '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: chatHistory, context: chatContext, lang: lang }),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      typingEl.remove();
      if (data.error) {
        var errMsg = data.error;
        var retryMatch = errMsg.match(/retry in ([\d.]+)s/i);
        if (errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('exhausted')) {
          var sec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60;
          errMsg = lang === 'ua'
            ? '⏳ Перевищено ліміт запитів. Спробуй через ' + sec + ' сек.'
            : '⏳ Rate limit reached. Try again in ' + sec + ' sec.';
        }
        appendChatMsg('ai', errMsg);
        return;
      }
      var reply = data.reply || (lang === 'ua' ? 'Порожня відповідь.' : 'Empty response.');
      appendChatMsg('ai', reply);
      chatHistory.push({ role: 'assistant', content: reply });
      if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    })
    .catch(function() {
      typingEl.remove();
      appendChatMsg('ai', lang === 'ua' ? '⚠ Помилка зв\'язку.' : '⚠ Connection error.');
    });
}

function renderChatText(text) {
  // Strip leftover markdown symbols and render line breaks as paragraphs
  var clean = text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/#+\s*/g, '')
    .replace(/`(.+?)`/g, '$1');
  var parts = clean.split(/\n{2,}/);
  return parts.map(function(p) {
    var t = p.replace(/\n/g, '<br>').trim();
    return t ? '<p style="margin:0 0 6px">' + t + '</p>' : '';
  }).join('');
}

function appendChatMsg(role, content, isTyping) {
  var container = document.getElementById('chat-messages');
  var welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'none';
  var el = document.createElement('div');
  el.className = 'chat-msg ' + role + (isTyping ? ' typing' : '');
  if (isTyping) {
    el.textContent = content;
  } else {
    el.innerHTML = renderChatText(content);
  }
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

// ── Alerts ────────────────────────────────────────────────────────────────────
function initAlerts() {
  chrome.storage.local.get(['alertThreshold', 'priceAlerts'], function(s) {
    var threshold = s.alertThreshold || 3;
    document.getElementById('threshold-slider').value = threshold;
    document.getElementById('threshold-value').textContent = threshold + '%';
    renderAlertPrices(s.priceAlerts || {});
  });

  document.getElementById('threshold-slider').addEventListener('input', function() {
    document.getElementById('threshold-value').textContent = this.value + '%';
  });

  document.getElementById('btn-save-threshold').addEventListener('click', function() {
    var val = parseInt(document.getElementById('threshold-slider').value);
    chrome.storage.local.set({ alertThreshold: val });
    toast(lang === 'ua' ? '✓ Поріг збережено!' : '✓ Threshold saved!');
  });

  document.getElementById('btn-check-now').addEventListener('click', function() {
    chrome.runtime.sendMessage({ action: 'checkNow' });
    toast(lang === 'ua' ? 'Перевіряю ціни...' : 'Checking prices...');
    setTimeout(function() {
      chrome.storage.local.get(['priceAlerts'], function(s) {
        renderAlertPrices(s.priceAlerts || {});
      });
    }, 5000);
  });
}

function renderAlertPrices(priceAlerts) {
  var el = document.getElementById('alert-prices-list');
  if (!watchlist.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔔</div><p>' + (lang === 'ua' ? 'Додай акції у Watchlist.' : 'Add stocks to Watchlist.') + '</p></div>';
    return;
  }
  var html = '<div style="margin-top:12px"><p style="font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">' + (lang === 'ua' ? 'Останні ціни' : 'Last prices') + '</p>';
  watchlist.forEach(function(w) {
    var info = priceAlerts[w.ticker];
    var pill = { green:'pill-green', yellow:'pill-yellow', red:'pill-red', blue:'pill-blue' }[w.color] || 'pill-blue';
    html += '<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:var(--r);padding:9px 12px;margin-bottom:6px">';
    html += '<span style="font-family:var(--mono);font-size:13px;font-weight:500;color:var(--green);width:50px">' + w.ticker + '</span>';
    if (info) {
      var up = info.pct >= 0;
      var color = up ? 'var(--green)' : 'var(--red)';
      var arrow = up ? '▲' : '▼';
      html += '<span style="font-family:var(--mono);font-size:12px;color:var(--text)">$' + info.price.toFixed(2) + '</span>';
      html += '<span style="font-family:var(--mono);font-size:11px;color:' + color + '">' + arrow + ' ' + (up ? '+' : '') + info.pct.toFixed(1) + '%</span>';
      var ago = Math.floor((Date.now() - info.time) / 60000);
      var timeStr = ago < 1 ? (lang === 'ua' ? 'щойно' : 'just now') : ago + (lang === 'ua' ? ' хв тому' : 'm ago');
      html += '<span style="font-family:var(--mono);font-size:10px;color:var(--dim);margin-left:auto">' + timeStr + '</span>';
    } else {
      html += '<span style="font-family:var(--mono);font-size:11px;color:var(--dim)">' + (lang === 'ua' ? 'ще не перевірено' : 'not checked yet') + '</span>';
    }
    html += '</div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

// Listen for price updates from background
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.action === 'pricesUpdated') {
    chrome.storage.local.get(['priceAlerts'], function(s) {
      renderAlertPrices(s.priceAlerts || {});
    });
  }
});
