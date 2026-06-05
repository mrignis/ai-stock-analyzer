'use strict';

var lang = 'ua';
var currentTicker = '';
var currentData = null;
var watchlist = [];
var historyList = [];

function loadAll(cb) { chrome.storage.local.get(['lang','watchlist','history','openaiKey','makeUrl'], cb); }
function save(obj) { chrome.storage.local.set(obj); }

function getKey() { return document.getElementById('openai-key').value.trim(); }
function getMakeUrl() { return document.getElementById('make-url').value.trim(); }

// ── Yahoo Finance ─────────────────────────────────────────────────────────────
function fetchPrice(ticker, cb) {
  chrome.storage.local.get(['finnhubKey'], function(s) {
    var key = s.finnhubKey || '';
    if (!key) { cb(null); return; }
    var url = 'https://finnhub.io/api/v1/quote?symbol=' + ticker + '&token=' + key;
    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.c || d.c === 0) { cb(null); return; }
        var price = d.c;
        var prev = d.pc;
        var change = price - prev;
        var pct = (change / prev) * 100;
        cb({
          price: price.toFixed(2),
          change: (change >= 0 ? '+' : '') + change.toFixed(2),
          pct: (pct >= 0 ? '+' : '') + pct.toFixed(2),
          currency: 'USD'
        });
      })
      .catch(function() { cb(null); });
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
    '<span style="font-size:12px;font-family:var(--mono);color:' + c + ';margin-left:10px">' + a + ' ' + (up?'+':'') + info.change + ' (' + (up?'+':'') + info.pct + '%)</span>' +
    '<span style="font-size:9px;color:var(--dim);font-family:var(--mono);margin-left:auto">Yahoo Finance</span>';
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  loadAll(function(s) {
    if (s.lang) lang = s.lang;
    if (s.watchlist) watchlist = s.watchlist;
    if (s.history) historyList = s.history;
    if (s.openaiKey) { document.getElementById('openai-key').value = s.openaiKey; showKeyStatus(true); }
    if (s.makeUrl) document.getElementById('make-url').value = s.makeUrl;

    applyLang();
    checkKeyWarning();

    document.getElementById('tab-search').addEventListener('click', function() { showPanel('search'); });
    document.getElementById('tab-watchlist').addEventListener('click', function() { showPanel('watchlist'); });
    document.getElementById('tab-history').addEventListener('click', function() { showPanel('history'); });
    document.getElementById('tab-settings').addEventListener('click', function() { showPanel('settings'); });

    document.getElementById('lang-btn').addEventListener('click', function() {
      lang = lang === 'ua' ? 'en' : 'ua';
      save({ lang: lang });
      applyLang();
      // Re-render lists with new language
      renderWatchlist();
      renderHistory();
      // If there's an active search - re-run with new language
      if (currentTicker) {
        runAnalysis();
      }
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

    document.getElementById('btn-save-key').addEventListener('click', function() {
      var key = getKey();
      if (!key) { toast(lang === 'ua' ? 'Введи ключ!' : 'Enter key!'); return; }
      save({ openaiKey: key });
      showKeyStatus(true);
      checkKeyWarning();
      toast(lang === 'ua' ? '✓ Ключ збережено!' : '✓ Key saved!');
    });

    document.getElementById('btn-save-make').addEventListener('click', function() {
      save({ makeUrl: getMakeUrl() });
      toast(lang === 'ua' ? '✓ URL збережено!' : '✓ URL saved!');
    });
  });
});

function showKeyStatus(ok) {
  var el = document.getElementById('key-status');
  el.style.display = ok ? 'block' : 'none';
  el.textContent = lang === 'ua' ? '✓ Ключ збережено' : '✓ Key saved';
}

function checkKeyWarning() {
  var w = document.getElementById('no-key-warning');
  w.style.display = !getKey() && !getMakeUrl() ? 'block' : 'none';
}

// ── Lang ──────────────────────────────────────────────────────────────────────
function applyLang() {
  var ua = lang === 'ua';
  document.getElementById('lang-btn').textContent = ua ? 'EN' : 'UA';
  document.getElementById('tab-search').textContent = ua ? 'Пошук' : 'Search';
  document.getElementById('tab-history').textContent = ua ? 'Історія' : 'History';
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
  document.getElementById('lbl-api-title').textContent = ua ? 'OpenAI API Ключ' : 'OpenAI API Key';
  document.getElementById('settings-desc').textContent = ua ? 'Отримай безкоштовний ключ на platform.openai.com → API Keys. Один аналіз коштує ~$0.001.' : 'Get a free key at platform.openai.com → API Keys. One analysis costs ~$0.001.';
  document.getElementById('privacy-info').textContent = ua ? '🔒 Ключ зберігається лише локально у твоєму браузері. Ніхто інший не має до нього доступу.' : '🔒 Your key is stored only locally in your browser. Nobody else can access it.';
  document.getElementById('make-desc').textContent = ua ? 'Якщо маєш Make.com webhook — встав URL тут. Інакше використовується OpenAI напряму.' : 'If you have a Make.com webhook — paste the URL here. Otherwise OpenAI is used directly.';
  document.getElementById('no-key-text').textContent = ua ? '⚠ Додай OpenAI ключ у ⚙ Налаштуваннях щоб аналізувати будь-яку акцію.' : '⚠ Add your OpenAI key in ⚙ Settings to analyze any stock.';
  document.getElementById('btn-save-key').textContent = ua ? 'Зберегти ключ' : 'Save key';
  var stopBtn = document.getElementById('stop-btn');
  if (stopBtn) stopBtn.textContent = ua ? '✕ Стоп' : '✕ Stop';
  document.getElementById('btn-save-make').textContent = ua ? 'Зберегти URL' : 'Save URL';
  // Settings descriptions
  var makeDescEl = document.getElementById('make-desc');
  if (makeDescEl) makeDescEl.textContent = ua ? 'Якщо маєш Make.com webhook — встав URL тут. Інакше використовується OpenAI напряму.' : 'If you have a Make.com webhook — paste the URL here. Otherwise OpenAI is used directly.';
  var finnhubDescEl = document.querySelector('#panel-settings .setup-box:last-of-type p');
  if (finnhubDescEl) finnhubDescEl.textContent = ua ? 'Безкоштовний ключ: finnhub.io → Dashboard → API Key. 60 запитів/хв безкоштовно.' : 'Free key: finnhub.io → Dashboard → API Key. 60 requests/min for free.';
  var saveFinEl = document.getElementById('btn-save-finnhub');
  if (saveFinEl) saveFinEl.textContent = ua ? 'Зберегти ключ' : 'Save key';
  var privacyEl = document.getElementById('privacy-info');
  if (privacyEl) privacyEl.textContent = ua ? '🔒 Ключ зберігається лише локально у твоєму браузері. Ніхто інший не має до нього доступу.' : '🔒 Your key is stored only locally in your browser. Nobody else can access it.';
  document.getElementById('lbl-alerts-title').textContent = ua ? 'Алерти цін' : 'Price Alerts';
  document.getElementById('alerts-info').textContent = ua ? 'Отримуй сповіщення коли акції з Watchlist змінюються більше ніж на заданий %.' : 'Get notified when Watchlist stocks change more than the set %.';
  document.getElementById('threshold-label').textContent = ua ? 'Поріг сповіщення (% зміни):' : 'Alert threshold (% change):';
  document.getElementById('btn-save-threshold').textContent = ua ? 'Зберегти' : 'Save';
  document.getElementById('btn-check-now').textContent = ua ? '↻ Перевірити' : '↻ Check now';
  showKeyStatus(!!getKey());
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
  document.getElementById('no-key-warning').style.display = 'none';
  document.getElementById('loading-state').style.display = 'block';
  document.getElementById('loading-msg').textContent = (lang === 'ua' ? 'Аналізую ' : 'Analyzing ') + raw + '...';
  document.getElementById('price-box').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'none';
  document.getElementById('stop-btn').style.display = 'block';

  fetchPrice(raw, function(info) { if (currentTicker === raw) showPrice(info); });

  var makeUrl = getMakeUrl();
  var key = getKey();

  if (makeUrl) {
    fetchMake(raw, makeUrl);
  } else if (key) {
    fetchOpenAI(raw, key);
  } else {
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('empty-state').style.display = 'block';
    document.getElementById('no-key-warning').style.display = 'block';
    document.getElementById('empty-text').textContent = lang === 'ua' ? 'Додай OpenAI ключ у ⚙ Налаштуваннях' : 'Add your OpenAI key in ⚙ Settings';
    document.getElementById('stop-btn').style.display = 'none';
    document.getElementById('analyze-btn').style.display = 'block';
  }
}

function fetchMake(ticker, url) {
  fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ticker: ticker, lang: lang }) })
    .then(function(r) { return r.text(); })
    .then(function(t) {
      try {
        var clean = t.replace(/```json|```/g,'').trim();
        // Find JSON object in response
        var match = clean.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON');
        var data = normalizeAI(JSON.parse(match[0]));
        finish(ticker, data);
      } catch(e) {
        showError('Make.com parse error');
      }
    })
    .catch(function() { showError('Make.com error'); });
}

function fetchOpenAI(ticker, key) {
  var ua = lang === 'ua';
  var prompt = 'You are a stock analyst. Analyze the stock "' + ticker + '". Language: ' + lang + '. ' +
    (ua ? 'Respond ENTIRELY in Ukrainian language.' : 'Respond in English.') +
    ' Reply ONLY valid JSON no markdown:\n{"sector":"...","risk":"' + (ua?'Високий або Середній або Низький':'High/Medium/Low') + '","trend":"...","forWho":"...","what":"2-3 ' + (ua?'речення':'sentences') + '","risks":"2-3 ' + (ua?'речення':'sentences') + '","forecast":"2-3 ' + (ua?'речення з ціновим таргетом':'sentences with price target') + '","conclusion":"2-3 ' + (ua?'речення':'sentences') + '","verdict":"' + (ua?'одне слово':'one word') + '","color":"green or yellow or red or blue","dir":"up or down or volatile or flat or up_strong"}';
  fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) { finish(ticker, normalizeAI(JSON.parse(d.choices[0].message.content.replace(/```json|```/g,'').trim()))); })
  .catch(function() { showError('OpenAI error'); });
}

function normalizeAI(j) {
  return { sector:j.sector||'', risk:j.risk||'', trend:j.trend||'', forWho:j.forWho||'', what:j.what||'', risks:j.risks||'', forecast:j.forecast||'', conclusion:j.conclusion||'', verdict:normalizeVerdict(j.verdict||'', lang), color:j.color||'blue', dir:j.dir||j.trend_dir||'flat' };
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
    'demo': { ua: 'Demo', en: 'Demo' },
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
    'бика': { ua: 'Перспективно', en: 'Promising' },
    'ведмедя': { ua: 'Ризиковано', en: 'Risky' },
    'sell!': { ua: 'Продавати!', en: 'Sell!' },
    'негативний': { ua: 'Негативний', en: 'Negative' },
    'negative': { ua: 'Негативний', en: 'Negative' },
    'бажано': { ua: 'Бажано', en: 'Desirable' },
    'desirable': { ua: 'Бажано', en: 'Desirable' },
    'позитивний': { ua: 'Позитивний', en: 'Positive' },
    'positive': { ua: 'Позитивний', en: 'Positive' },
    'ситуаційний': { ua: 'Ситуаційний', en: 'Situational' },
    'зростання': { ua: 'Зростання', en: 'Growth' },
    'growth': { ua: 'Зростання', en: 'Growth' },
    'спад': { ua: 'Спад', en: 'Decline' },
    'decline': { ua: 'Спад', en: 'Decline' },
    'купити': { ua: 'Купувати', en: 'Buy' },
    'buy!': { ua: 'Купувати!', en: 'Buy!' },
  };
  var found = map[v];
  if (found) return found[lang] || found.en;
  // Capitalize first letter as fallback
  return verdict.charAt(0).toUpperCase() + verdict.slice(1);
}

function normalizeSector(sector, lang) {
  if (!sector) return sector;
  var map = {
    'technology': { ua: 'Технології', en: 'Technology' },
    'semiconductors': { ua: 'Напівпровідники', en: 'Semiconductors' },
    'auto / energy': { ua: 'Авто / Енергетика', en: 'Auto / Energy' },
    'automotive and energy': { ua: 'Авто / Енергетика', en: 'Auto / Energy' },
    'automotive': { ua: 'Автомобілі', en: 'Automotive' },
    'food technology': { ua: 'Харчові технології', en: 'Food Technology' },
    'social media / ai': { ua: 'Соц. мережі / AI', en: 'Social Media / AI' },
    'e-commerce / cloud': { ua: 'E-commerce / Cloud', en: 'E-commerce / Cloud' },
    'consumer goods': { ua: 'Споживчі товари', en: 'Consumer Goods' },
    'consumer discretionary': { ua: 'Споживчі товари', en: 'Consumer Discretionary' },
    'consumer staples': { ua: 'Товари першої необхідності', en: 'Consumer Staples' },
    'healthcare': { ua: 'Охорона здоровя', en: 'Healthcare' },
    'health care': { ua: 'Охорона здоровя', en: 'Healthcare' },
    'finance': { ua: 'Фінанси', en: 'Finance' },
    'financials': { ua: 'Фінанси', en: 'Financials' },
    'information technology': { ua: 'Інформаційні технології', en: 'Information Technology' },
    'telecom': { ua: 'Телекомунікації', en: 'Telecom' },
    'telecommunications': { ua: 'Телекомунікації', en: 'Telecommunications' },
    'communication services': { ua: 'Комунікаційні послуги', en: 'Communication Services' },
    'energy': { ua: 'Енергетика', en: 'Energy' },
    'utilities': { ua: 'Комунальні послуги', en: 'Utilities' },
    'real estate': { ua: 'Нерухомість', en: 'Real Estate' },
    'materials': { ua: 'Матеріали', en: 'Materials' },
    'industrials': { ua: 'Промисловість', en: 'Industrials' },
    'defense': { ua: 'Оборонна промисловість', en: 'Defense' },
    'retail': { ua: 'Роздрібна торгівля', en: 'Retail' },
    'cloud computing': { ua: 'Хмарні обчислення', en: 'Cloud Computing' },
    'artificial intelligence': { ua: 'Штучний інтелект', en: 'Artificial Intelligence' },
    'biotech': { ua: 'Біотехнології', en: 'Biotech' },
    'biotechnology': { ua: 'Біотехнології', en: 'Biotechnology' },
    'pharmaceuticals': { ua: 'Фармацевтика', en: 'Pharmaceuticals' },
    'quantum computing': { ua: 'Квантові обчислення', en: 'Quantum Computing' },
    'технології': { ua: 'Технології', en: 'Technology' },
    'напівпровідники': { ua: 'Напівпровідники', en: 'Semiconductors' },
    'авто / енергетика': { ua: 'Авто / Енергетика', en: 'Auto / Energy' },
    'харчові технології': { ua: 'Харчові технології', en: 'Food Technology' },
    'соціальні мережі / ai': { ua: 'Соц. мережі / AI', en: 'Social Media / AI' },
    'споживчі товари': { ua: 'Споживчі товари', en: 'Consumer Goods' },
    'охорона здоровя': { ua: 'Охорона здоровя', en: 'Healthcare' },
    'фінанси': { ua: 'Фінанси', en: 'Finance' },
    'інформаційні технології': { ua: 'Інформаційні технології', en: 'Information Technology' },
    'телекомунікації': { ua: 'Телекомунікації', en: 'Telecom' },
    'енергетика': { ua: 'Енергетика', en: 'Energy' },
    'промисловість': { ua: 'Промисловість', en: 'Industrials' },
    'нерухомість': { ua: 'Нерухомість', en: 'Real Estate' },
    'біотехнології': { ua: 'Біотехнології', en: 'Biotech' },
    'фармацевтика': { ua: 'Фармацевтика', en: 'Pharmaceuticals' },
    'квантові обчислення': { ua: 'Квантові обчислення', en: 'Quantum Computing' },
  };
  var found = map[sector.toLowerCase()];
  if (found) return found[lang] || found.en;
  return sector;
}


function finish(ticker, data) {
  currentAbort = null;
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'block';
  currentData = data; addHistory(ticker, data); renderResult(ticker, data);
}
function showError(msg) {
  currentAbort = null;
  document.getElementById('stop-btn').style.display = 'none';
  document.getElementById('analyze-btn').style.display = 'block';
  document.getElementById('loading-state').style.display='none';
  document.getElementById('empty-state').style.display='block';
  document.getElementById('empty-text').textContent='⚠ '+msg;
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
  vEl.textContent = d.verdict; vEl.className = 'verdict-pill ' + (pillMap[d.color]||'pill-blue');
  var sMap = { green:'background:var(--green-dim);border:1px solid var(--green-border);color:var(--green)', yellow:'background:var(--yellow-dim);border:1px solid rgba(251,191,36,0.25);color:var(--yellow)', red:'background:var(--red-dim);border:1px solid rgba(248,113,113,0.25);color:var(--red)', blue:'background:var(--blue-dim);border:1px solid rgba(96,165,250,0.25);color:var(--blue)' };
  document.getElementById('r-conclusion-box').style.cssText = sMap[d.color]||sMap.blue;
  drawChart(d.dir, d.color); updateWatchBtn();
}

function drawChart(dir, color) {
  var canvas = document.getElementById('trend-chart');
  var ctx = canvas.getContext('2d');
  var W = canvas.offsetWidth||372, H = 80;
  canvas.width = W; canvas.height = H;
  var cfgs = { up:{d:-0.6,n:2.5}, up_strong:{d:-1.1,n:3}, down:{d:0.7,n:2.5}, volatile:{d:0,n:6}, flat:{d:0,n:1.5} };
  var cfg = cfgs[dir]||cfgs.flat;
  var pts = [], y = H/2, pad = 8;
  for (var i=0;i<30;i++) { y+=cfg.d+(Math.random()-0.5)*cfg.n*2; y=Math.max(pad,Math.min(H-pad,y)); pts.push({x:pad+(i/29)*(W-pad*2),y:y}); }
  var cMap = { green:'#4ade80', yellow:'#fbbf24', red:'#f87171', blue:'#60a5fa' };
  var lc = cMap[color]||'#60a5fa';
  var ch = (((pts[29].y-pts[0].y)/pts[0].y)*-100).toFixed(1);
  var chEl = document.getElementById('chart-change');
  chEl.style.color = ch>=0?'var(--green)':'var(--red)';
  chEl.textContent = (ch>=0?'+':'')+ch+'%';
  ctx.clearRect(0,0,W,H);
  ctx.beginPath(); ctx.moveTo(pts[0].x,H);
  for (var i=0;i<pts.length;i++) ctx.lineTo(pts[i].x,pts[i].y);
  ctx.lineTo(pts[29].x,H); ctx.closePath(); ctx.fillStyle=lc+'22'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(pts[0].x,pts[0].y);
  for (var i=1;i<pts.length;i++) { var mx=(pts[i-1].x+pts[i].x)/2; var my=(pts[i-1].y+pts[i].y)/2; ctx.quadraticCurveTo(pts[i-1].x,pts[i-1].y,mx,my); }
  ctx.strokeStyle=lc; ctx.lineWidth=2; ctx.stroke();
  ctx.beginPath(); ctx.arc(pts[29].x,pts[29].y,3,0,Math.PI*2); ctx.fillStyle=lc; ctx.fill();
}

// ── Watchlist ─────────────────────────────────────────────────────────────────
function isInWatch(t) { for (var i=0;i<watchlist.length;i++) if(watchlist[i].ticker===t) return true; return false; }
function updateWatchBtn() {
  var btn = document.getElementById('watch-btn');
  if (!currentTicker) return;
  if (isInWatch(currentTicker)) { btn.textContent=lang==='ua'?'✓ В списку':'✓ Added'; btn.classList.add('added'); }
  else { btn.textContent='+ Watchlist'; btn.classList.remove('added'); }
}
function toggleWatch() {
  if (!currentTicker||!currentData) return;
  if (isInWatch(currentTicker)) { watchlist=watchlist.filter(function(w){return w.ticker!==currentTicker;}); }
  else { watchlist.push({ticker:currentTicker,sector:currentData.sector,sectorKey:currentData.sector,verdict:normalizeVerdict(currentData.verdict||'','en'),color:currentData.color,t:Date.now()}); }
  save({watchlist:watchlist}); updateWatchBtn();
}
function renderWatchlist() {
  var el = document.getElementById('watchlist-content');
  if (!watchlist.length) { el.innerHTML='<div class="empty"><div class="empty-icon">📋</div><p>'+(lang==='ua'?'Watchlist порожній.':'Watchlist is empty.')+'</p></div>'; return; }
  var html='';
  for (var i=0;i<watchlist.length;i++) {
    var w=watchlist[i]; var pill={green:'pill-green',yellow:'pill-yellow',red:'pill-red',blue:'pill-blue'}[w.color]||'pill-blue';
    var wSector = normalizeSector(w.sector || '', lang);
    var wVerdict = normalizeVerdict(w.verdict || '', lang);
    html+='<div class="watch-item" data-ticker="'+w.ticker+'"><span class="watch-ticker">'+w.ticker+'</span><div class="watch-info"><div class="watch-sector">'+wSector+'</div></div><span class="verdict-pill '+pill+'">'+wVerdict+'</span><button class="watch-remove" data-ticker="'+w.ticker+'">✕</button></div>';
  }
  el.innerHTML=html;
  var items=el.querySelectorAll('.watch-item');
  for (var i=0;i<items.length;i++) { items[i].addEventListener('click',function(e){ if(e.target.classList.contains('watch-remove'))return; document.getElementById('ticker-input').value=this.getAttribute('data-ticker'); showPanel('search'); runAnalysis(); }); }
  var removes=el.querySelectorAll('.watch-remove');
  for (var i=0;i<removes.length;i++) { removes[i].addEventListener('click',function(e){ e.stopPropagation(); var t=this.getAttribute('data-ticker'); watchlist=watchlist.filter(function(w){return w.ticker!==t;}); save({watchlist:watchlist}); renderWatchlist(); updateWatchBtn(); }); }
}

// ── History ───────────────────────────────────────────────────────────────────
function addHistory(ticker, data) {
  historyList=historyList.filter(function(h){return h.ticker!==ticker;});
  historyList.unshift({ticker:ticker,color:data.color,verdict:data.verdict,t:Date.now()});
  if(historyList.length>20)historyList=historyList.slice(0,20);
  save({history:historyList});
}
function renderHistory() {
  var el=document.getElementById('history-content');
  if(!historyList.length){el.innerHTML='<div class="empty"><div class="empty-icon">🕐</div><p>'+(lang==='ua'?'Історія порожня.':'History is empty.')+'</p></div>';return;}
  var html='';
  for(var i=0;i<historyList.length;i++){
    var h=historyList[i]; var pill={green:'pill-green',yellow:'pill-yellow',red:'pill-red',blue:'pill-blue'}[h.color]||'pill-blue';
    var hVerdict=normalizeVerdict(h.verdict||'',lang);
    var diff=Math.floor((Date.now()-h.t)/60000);
    var time=diff<1?(lang==='ua'?'Щойно':'Just now'):diff<60?diff+(lang==='ua'?' хв':'m ago'):Math.floor(diff/60)+(lang==='ua'?' год':'h ago');
    html+='<div class="hist-item" data-ticker="'+h.ticker+'"><span class="hist-ticker">'+h.ticker+'</span><span class="hist-time">'+time+'</span><span class="verdict-pill '+pill+'">'+hVerdict+'</span></div>';
  }
  el.innerHTML=html;
  var items=el.querySelectorAll('.hist-item');
  for(var i=0;i<items.length;i++){items[i].addEventListener('click',function(){document.getElementById('ticker-input').value=this.getAttribute('data-ticker');showPanel('search');runAnalysis();});}
}

function toast(msg) {
  var t=document.createElement('div');
  t.style.cssText='position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:var(--green);color:#0a0f0a;font-family:var(--mono);font-size:11px;padding:6px 16px;border-radius:20px;z-index:999;pointer-events:none';
  t.textContent=msg; document.body.appendChild(t); setTimeout(function(){t.remove();},2000);
}

// ── Alerts ────────────────────────────────────────────────────────────────────
function initAlerts() {
  chrome.storage.local.get(['alertThreshold', 'priceAlerts'], function(s) {
    var threshold = s.alertThreshold || 3;
    var priceAlerts = s.priceAlerts || {};
    document.getElementById('threshold-slider').value = threshold;
    document.getElementById('threshold-value').textContent = threshold + '%';
    renderAlertPrices(priceAlerts);
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
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔔</div><p>' + (lang === 'ua' ? 'Додай акції у Watchlist щоб отримувати алерти.' : 'Add stocks to Watchlist to receive alerts.') + '</p></div>';
    return;
  }

  var html = '<div style="margin-top:12px">';
  html += '<p style="font-family:var(--mono);font-size:9px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px">' + (lang === 'ua' ? 'Останні ціни' : 'Last prices') + '</p>';

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
      html += '<span style="font-family:var(--mono);font-size:11px;color:' + color + '">' + arrow + ' ' + (up?'+':'') + info.pct.toFixed(1) + '%</span>';
      var ago = Math.floor((Date.now() - info.time) / 60000);
      var timeStr = ago < 1 ? (lang==='ua'?'щойно':'just now') : ago + (lang==='ua'?' хв тому':'m ago');
      html += '<span style="font-family:var(--mono);font-size:10px;color:var(--dim);margin-left:auto">' + timeStr + '</span>';
    } else {
      html += '<span style="font-family:var(--mono);font-size:11px;color:var(--dim)">' + (lang==='ua'?'ще не перевірено':'not checked yet') + '</span>';
    }

    html += '</div>';
  });

  html += '</div>';
  el.innerHTML = html;
}

// ── Override showPanel to init alerts ─────────────────────────────────────────
var _origShowPanel = showPanel;
showPanel = function(id) {
  _origShowPanel(id);
  if (id === 'alerts') initAlerts();
};

// Add alerts tab listener after DOM ready
document.addEventListener('DOMContentLoaded', function() {
  var alertTab = document.getElementById('tab-alerts');
  if (alertTab) alertTab.addEventListener('click', function() { showPanel('alerts'); });
});

// Listen for messages from background
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg.action === 'pricesUpdated') {
    chrome.storage.local.get(['priceAlerts'], function(s) {
      renderAlertPrices(s.priceAlerts || {});
    });
  }
});

// Alpha Vantage key save (added after DOMContentLoaded via delegation)
document.addEventListener('DOMContentLoaded', function() {
  chrome.storage.local.get(['finnhubKey'], function(s) {
    var el = document.getElementById('finnhub-key');
    if (el && s.finnhubKey) el.value = s.finnhubKey;
  });
  var btn = document.getElementById('btn-save-finnhub');
  if (btn) {
    btn.addEventListener('click', function() {
      var key = document.getElementById('finnhub-key').value.trim();
      chrome.storage.local.set({ finnhubKey: key });
      toast(lang === 'ua' ? '✓ Finnhub ключ збережено!' : '✓ Finnhub key saved!');
    });
  }
});

// ── Finnhub key init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  chrome.storage.local.get(['finnhubKey'], function(s) {
    var el = document.getElementById('finnhub-key');
    if (el && s.finnhubKey) el.value = s.finnhubKey;
  });
  var btn = document.getElementById('btn-save-finnhub');
  if (btn) {
    btn.addEventListener('click', function() {
      var key = document.getElementById('finnhub-key').value.trim();
      chrome.storage.local.set({ finnhubKey: key });
      toast(lang === 'ua' ? '✓ Finnhub ключ збережено!' : '✓ Finnhub key saved!');
    });
  }
});
