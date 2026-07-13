// i18n regression guard (Node, no browser needed). Renders the REAL
// renderWatchlist + renderHistory in EN/UA/FR with deliberately MESSY
// mixed-language stored data (a sector saved in Ukrainian, a verdict saved in
// French, etc. — as accumulates when a user analyzes in different languages) and
// asserts nothing leaks in the wrong language after a language switch.
//
// Why this exists: sectors/verdicts are stored in the watchlist/history and must
// re-localize when the UI language changes. A bug once left BTC's sector stuck as
// "Фінансовий" in English mode. Isolated function tests missed it; this renders
// the actual list HTML and checks it.
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hasCyrillic = s => /[А-Яа-яІіЇїЄєҐґ]/.test(s);
const FR_MARKERS = ['Financier', 'Cryptomonnaie', 'Exploitation', 'Services financiers', 'Technologie', 'Semi-conducteurs', 'Conserver', 'Acheter', 'Vendre'];

function render(lang) {
  const nodes = {};
  const mk = () => { const n = { _h: '', style: {}, textContent: '', querySelectorAll: () => [], addEventListener() {}, getAttribute: () => '' }; Object.defineProperty(n, 'innerHTML', { get() { return this._h; }, set(v) { this._h = v; } }); return n; };
  const ctx = {
    console, lang, WORKER_URL: 'x',
    L: (ua, en, fr) => (lang === 'ua' ? ua : lang === 'fr' ? (fr || en) : en),
    document: { getElementById: id => (nodes[id] || (nodes[id] = mk())) },
    chrome: { storage: { local: { set() {}, get(k, cb) { cb && cb({}); } } } },
    save() {}, showPanel() {}, runAnalysis() {}, loadLivePriceSWR() {}, applyPriceToElements() {},
    cacheGet() {}, cacheSet() {}, drawSpark() {}, fetch: () => Promise.reject(), timeAgo: () => '', updateWatchBtn() {},
    CACHE_CANDLE_TTL: 1,
  };
  ctx.global = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/core.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/popup-analysis.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/popup-lists.js', 'utf8'), ctx);
  ctx.watchlist = [
    { ticker: 'BTC', sector: 'Фінансовий', verdict: 'Buy', color: 'green' },
    { ticker: 'BAC', sector: 'Financial Services', verdict: 'Тримати', color: 'yellow' }, // non-ETF: plain localization
    { ticker: 'CNQ', sector: 'Mining', verdict: 'Hold', color: 'yellow' },
    { ticker: 'ETH', sector: 'Cryptocurrency', verdict: 'Купувати', color: 'green' },
    { ticker: 'GLD', sector: 'Gold', verdict: 'Conserver', color: 'yellow' },       // ETF theme — must localize (Золото/Or)
    { ticker: 'SPY2', sector: 'Broad Market', verdict: 'Hold', color: 'yellow' },   // fund theme — Широкий ринок/Marché large
    { ticker: 'MINE', sector: 'Exploitation minière', verdict: 'Buy', color: 'green' }, // stored FR
  ];
  ctx.historyList = [{ ticker: 'NVDA', color: 'green', verdict: 'Купувати', t: Date.now() }];
  ctx.renderWatchlist();
  ctx.renderHistory();
  const extract = (html, cls) => [...html.matchAll(new RegExp('class="[^"]*' + cls + '[^"]*"[^>]*>([^<]*)<', 'g'))].map(m => m[1].trim()).filter(Boolean);
  const wl = nodes['watchlist-content'].innerHTML;
  const hist = nodes['history-content'] ? nodes['history-content'].innerHTML : '';
  return { sectors: extract(wl, 'watch-sector'), verdicts: extract(wl, 'verdict-pill'), hist: extract(hist, 'verdict-pill') };
}

let ok = true;
for (const lang of ['en', 'ua', 'fr']) {
  const r = render(lang);
  const all = [...r.sectors, ...r.verdicts, ...r.hist];
  const bad = all.filter(s =>
    (lang === 'en' && (hasCyrillic(s) || FR_MARKERS.some(f => s.includes(f)))) ||
    (lang === 'ua' && !hasCyrillic(s)) ||
    (lang === 'fr' && hasCyrillic(s)));
  const mark = bad.length ? 'FAIL' : 'PASS';
  if (bad.length) ok = false;
  console.log(`  ${mark} [${lang}] sectors=${JSON.stringify(r.sectors)} verdicts=${JSON.stringify(r.verdicts)}${bad.length ? ' LEAK=' + JSON.stringify(bad) : ''}`);
}
console.log(ok ? '\n✅ i18n: watchlist + history re-localize in EN/UA/FR' : '\n❌ i18n leak — sectors/verdicts stuck in a stored language');
process.exit(ok ? 0 : 1);
