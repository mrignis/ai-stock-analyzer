// Deeper "real user" journey test for the AI Stock Analyzer popup. Goes beyond the
// smoke test: name resolution, foreign + crypto tickers, multi-stock watchlist with
// the home-screen star picker, and a multi-turn chat. Runs on CI (Ubuntu) against
// the live worker. Local: node .github/journey.mjs (needs a working Chromium).
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const EXT = process.env.EXT_DIR || resolve(__dir, '..');
const SHOTS = resolve(__dir, '..', 'smoke-shots');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const pass = (n, d = '') => { results.push(['PASS', n]); console.log(`  PASS ${n}${d ? ' — ' + d : ''}`); };
const fail = (n, d = '') => { results.push(['FAIL', n]); console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); };
const errs = [];

// Analyze `input`, wait until the resolved header (#r-ticker) matches `expect`
// (regex) and a verdict is present. Returns {ticker, verdict, price}.
async function analyze(page, input, expect, shot) {
  await page.click('#tab-search');
  // Retry once on timeout: the shared free Groq key can rate-limit (429) or queue
  // under load, which is a transient infra blip, not a product failure. Wait out
  // the window and re-submit before giving up (mirrors run.mjs 429-resilience).
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.fill('#ticker-input', input);
    await page.click('#analyze-btn');
    try {
      await page.waitForFunction((re) => {
        const t = document.querySelector('#r-ticker')?.textContent?.trim() || '';
        const v = document.querySelector('#r-verdict')?.textContent?.trim() || '';
        return new RegExp(re, 'i').test(t) && v.length > 0;
      }, expect, { timeout: 55000 });
      lastErr = null; break;
    } catch (e) { lastErr = e; await page.waitForTimeout(12000); }
  }
  if (lastErr) throw lastErr;
  const ticker = (await page.textContent('#r-ticker'))?.trim();
  const verdict = (await page.textContent('#r-verdict'))?.trim();
  const priceVisible = await page.locator('#price-box').isVisible();
  const priceText = priceVisible ? (await page.textContent('#price-box'))?.replace(/\s+/g, ' ').trim() : '';
  if (shot) await page.screenshot({ path: `${SHOTS}/${shot}` });
  return { ticker, verdict, price: priceText };
}

async function main() {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });
  // Poll for the MV3 service worker (cold CI runner can need >15s to register).
  let extId = null;
  for (let i = 0; i < 30 && !extId; i++) {
    const s = context.serviceWorkers()[0];
    if (s) extId = s.url().split('/')[2];
    else await new Promise(r => setTimeout(r, 1000));
  }
  if (!extId) { console.log('  FAIL extension did not load'); await context.close(); process.exit(2); }
  console.log(`\n  AI Stock Analyzer — user journey  (ext ${extId})\n`);

  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  // Best-effort screenshots — a capture hiccup (xvfb) must not fail the run.
  const _ss = page.screenshot.bind(page);
  page.screenshot = async (o) => { try { return await _ss(o); } catch (e) { console.log('  (screenshot skipped: ' + e.message.slice(0, 50) + ')'); } };
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.setViewportSize({ width: 420, height: 700 });
  await page.waitForSelector('#ticker-input', { timeout: 15000 });

  // 1) Home renders market cards + news
  try {
    await page.waitForSelector('#market-cards', { state: 'visible', timeout: 8000 });
    await page.waitForFunction(() => (document.querySelector('#market-cards')?.textContent.length || 0) > 10, null, { timeout: 15000 });
    await page.screenshot({ path: `${SHOTS}/j1-home.png` });
    pass('home: market cards render');
  } catch (e) { fail('home: market cards render', e.message); }

  // 2) Search by COMPANY NAME → resolves to a ticker
  try {
    const r = await analyze(page, 'Tesla', 'TSLA', 'j2-name.png');
    pass('name "Tesla" → TSLA', `${r.ticker}, verdict="${r.verdict}", ${r.price}`);
  } catch (e) { fail('name "Tesla" → TSLA', e.message); await page.screenshot({ path: `${SHOTS}/j2-FAIL.png` }); }

  // 3) Foreign/penny ticker → the exchange probe resolves it to a suffixed listing
  // (SAU → SAU.TO). Price comes from Yahoo, which throttles GitHub's IPs, so we
  // assert the FOREIGN RESOLUTION (the feature under test), not a live price value.
  try {
    const r = await analyze(page, 'SAU', 'SAU', 'j3-foreign.png');
    const ok = /\.(TO|V|NE|L|AX|NS)\b/i.test(r.ticker); // resolved to a foreign exchange
    ok ? pass('foreign SAU → exchange-suffixed', `${r.ticker}${/\d/.test(r.price) ? ', ' + r.price : ' (price throttled in CI)'}`)
       : fail('foreign SAU → exchange-suffixed', `${r.ticker}, price="${r.price}"`);
  } catch (e) { fail('foreign SAU → exchange-suffixed', e.message); await page.screenshot({ path: `${SHOTS}/j3-FAIL.png` }); }

  // 4) Crypto → price + verdict, then add to watchlist
  try {
    const r = await analyze(page, 'BTC', 'BTC', 'j4-crypto.png');
    await page.click('#watch-btn');
    pass('crypto BTC analyze + add', `${r.ticker}, ${r.price}`);
  } catch (e) { fail('crypto BTC analyze + add', e.message); }

  // 4b) Share card — click Share, the overlay + rendered canvas appear
  try {
    await page.click('#share-btn');
    await page.waitForSelector('#share-overlay', { state: 'visible', timeout: 5000 });
    const painted = await page.evaluate(() => {
      const c = document.getElementById('share-canvas');
      const ctx = c.getContext('2d');
      const px = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonBlack = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 60) { nonBlack++; if (nonBlack > 500) break; }
      return nonBlack > 500; // the card actually drew something
    });
    await page.screenshot({ path: `${SHOTS}/j4b-share.png` });
    await page.click('#share-close');
    painted ? pass('share card renders') : fail('share card renders', 'canvas looks blank');
  } catch (e) { fail('share card renders', e.message); await page.screenshot({ path: `${SHOTS}/j4b-FAIL.png` }); }

  // 4c) TradingView full chart — toggle it open on the BTC result, assert the
  // iframe mounts with the exchange-qualified symbol (BTC → BINANCE:BTCUSDT), then
  // toggle it closed. We check the iframe src, not TradingView's network load, so
  // the step never flakes on a slow third-party frame.
  try {
    await page.click('#tv-toggle');
    await page.waitForSelector('#tv-chart-box iframe', { state: 'attached', timeout: 5000 });
    const info = await page.evaluate(() => {
      const box = document.getElementById('tv-chart-box');
      const f = box && box.querySelector('iframe');
      return { visible: box && getComputedStyle(box).display !== 'none', src: (f && f.src) || '' };
    });
    const okSym = info.src.includes('BINANCE%3ABTCUSDT') && info.src.includes('tradingview.com/widgetembed');
    await page.screenshot({ path: `${SHOTS}/j4c-tvchart.png` });
    await page.click('#tv-toggle'); // collapse again
    const collapsed = await page.evaluate(() => getComputedStyle(document.getElementById('tv-chart-box')).display === 'none');
    (info.visible && okSym && collapsed) ? pass('TradingView full chart', 'BTC → BINANCE:BTCUSDT, toggles')
      : fail('TradingView full chart', `visible=${info.visible} collapsed=${collapsed} src=${info.src.slice(0, 90)}`);
  } catch (e) { fail('TradingView full chart', e.message); await page.screenshot({ path: `${SHOTS}/j4c-FAIL.png` }); }

  // 4d) Reddit buzz row — rendered after the BTC analysis (worker /social →
  // ApeWisdom). "trending" vs "low buzz" both render, so the live board never
  // flakes the step. Visibility is toggled via the .is-hidden class (not inline
  // display), and we assert the COMPUTED display is flex — an inline display:block
  // once overrode the CSS flex and collapsed the words together (Pylyp). Guard it.
  try {
    await page.waitForFunction(() => {
      const el = document.getElementById('r-social');
      return el && !el.classList.contains('is-hidden') && el.textContent.trim().length > 0;
    }, { timeout: 8000 });
    const info = await page.evaluate(() => {
      const el = document.getElementById('r-social');
      return { display: getComputedStyle(el).display, text: el.innerText };
    });
    await page.screenshot({ path: `${SHOTS}/j4d-social.png` });
    (info.display === 'flex')
      ? pass('Reddit buzz row', info.text.replace(/\s+/g, ' ').slice(0, 60))
      : fail('Reddit buzz row', `display=${info.display} (expected flex) — gap would be dead`);
  } catch (e) { fail('Reddit buzz row', e.message); await page.screenshot({ path: `${SHOTS}/j4d-FAIL.png` }); }

  // 4e) Compare A vs B — on the BTC result, open compare, enter AAPL, and assert
  // the side-by-side grid renders both tickers with data.
  try {
    await page.click('#compare-btn');
    await page.waitForSelector('#compare-overlay', { state: 'visible', timeout: 5000 });
    await page.fill('#cmp-input', 'AAPL');
    await page.click('#cmp-go');
    await page.waitForFunction(() => {
      const g = document.querySelector('#cmp-result .cmp-grid');
      return g && /AAPL/.test(g.textContent) && /\$\d/.test(g.textContent);
    }, { timeout: 30000 });
    const txt = (await page.textContent('#cmp-result')) || '';
    await page.screenshot({ path: `${SHOTS}/j4e-compare.png` });
    const ok = /AAPL/.test(txt) && /BTC/.test(txt) && /\$\d/.test(txt);
    await page.click('#compare-close');
    ok ? pass('Compare A vs B', 'BTC vs AAPL grid') : fail('Compare A vs B', txt.slice(0, 120));
  } catch (e) { fail('Compare A vs B', e.message); await page.screenshot({ path: `${SHOTS}/j4e-FAIL.png` }); }

  // 5) Second stock to watchlist, then star it and confirm it shows on home.
  // Use the RESOLVED ticker (#r-ticker) for the selectors — the worker may resolve
  // AAPL to a foreign listing on a Finnhub blip, so the star's data-ticker isn't
  // always the literal input.
  try {
    const rA = await analyze(page, 'AAPL', 'AAPL');
    const addT = rA.ticker; // whatever the header/watchlist actually uses
    await page.click('#watch-btn');
    await page.click('#tab-watchlist');
    await page.waitForSelector('.watch-item', { timeout: 5000 });
    const items = await page.locator('.watch-item').count();
    await page.locator(`.watch-star[data-ticker="${addT}"]`).first().click();
    await page.screenshot({ path: `${SHOTS}/j5-watchlist.png` });
    // Back to the HOME view via the logo — #tab-search alone keeps the last
    // analysis result on screen, which hides the home watchlist block. The logo
    // clears the result and shows the home list where pinned tiles live.
    await page.click('#nav-logo');
    await page.waitForSelector(`.hwl-item[data-ticker="${addT}"]`, { state: 'visible', timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/j6-home-pinned.png` });
    pass('watchlist→star→home', `${items} items, ${addT} pinned to home`);
  } catch (e) { fail('watchlist→star→home', e.message); await page.screenshot({ path: `${SHOTS}/j5-FAIL.png` }); }

  // 5b) CSV portfolio import — upload a sample broker export, positions appear.
  // The CSV puts "Last Price" BEFORE "Average Cost" on purpose: asserting the
  // cost (150.25) not the last price (308) also verifies the column-priority fix.
  try {
    await page.click('#tab-watchlist');
    await page.click('#wl-tab-pf');
    const csv = 'Symbol,Last Price,Quantity,Average Cost\nAAPL,308,10,150.25\nGMIN.TO,45,100,40.50\nBTC,62000,0.5,58000\n';
    await page.setInputFiles('#pf-csv-input', { name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForFunction(() => /AAPL/.test(document.getElementById('portfolio-list')?.textContent || ''), { timeout: 6000 });
    const txt = (await page.textContent('#portfolio-list')) || '';
    // Cost basis 150.25 present proves the cost column won over "Last Price" (308):
    // had it picked Last Price, the shown cost would be 308.00, not 150.25.
    const ok = /AAPL/.test(txt) && /GMIN\.TO/.test(txt) && /BTC/.test(txt) && /150\.25/.test(txt);
    await page.screenshot({ path: `${SHOTS}/j6b-csv.png` });
    ok ? pass('CSV import (foreign+crypto, cost-column priority)') : fail('CSV import', txt.slice(0, 140));
  } catch (e) { fail('CSV import', e.message); await page.screenshot({ path: `${SHOTS}/j6b-FAIL.png` }); }

  // 5c) Wealthsimple-style CSV — cost basis is Book Value / Quantity, NOT the
  // current "Market Price" (that bug made a CAD holding read as a ~30% loss).
  // Clear first (also exercises the new clear button) so we don't stack on 5b.
  try {
    page.once('dialog', d => d.accept()); // confirm() in clearPortfolio
    await page.click('#pf-clear-btn');
    await page.waitForFunction(() => !/AAPL/.test(document.getElementById('portfolio-list')?.textContent || ''), { timeout: 4000 }).catch(() => {});
    const ws = 'Symbol,Exchange,Quantity,Market Price,Market Price Currency,Book Value (Market),Book Value Currency (Market)\n'
             + 'WMTX,NYSE,10,999,USD,500,USD\nCNQ,TSX,10,57.74,CAD,530,CAD\n';
    await page.setInputFiles('#pf-csv-input', { name: 'ws.csv', mimeType: 'text/csv', buffer: Buffer.from(ws) });
    await page.waitForFunction(() => /WMTX/.test(document.getElementById('portfolio-list')?.textContent || ''), { timeout: 6000 });
    const txt = (await page.textContent('#portfolio-list')) || '';
    // Cost = Book Value 500 / 10 = $50.00 (USD display); the Market Price 999 must
    // NOT appear as the cost. CNQ present confirms the TSX row imported too.
    const ok = /WMTX/.test(txt) && /50\.00/.test(txt) && !/999/.test(txt) && /CNQ/.test(txt);
    await page.screenshot({ path: `${SHOTS}/j6c-ws-csv.png` });
    ok ? pass('Wealthsimple CSV (Book Value cost, not Market Price)') : fail('Wealthsimple CSV', txt.slice(0, 160));
  } catch (e) { fail('Wealthsimple CSV', e.message); await page.screenshot({ path: `${SHOTS}/j6c-FAIL.png` }); }

  // 6) Multi-turn chat: ask, then a follow-up
  try {
    await page.click('#tab-chat');
    await page.waitForSelector('#chat-input', { state: 'visible', timeout: 5000 });
    const l0 = (await page.textContent('#chat-messages'))?.length || 0;
    await page.fill('#chat-input', 'tell me about Nvidia');
    await page.click('#chat-send-btn');
    await page.waitForFunction((b) => (document.querySelector('#chat-messages')?.textContent.length || 0) > b + 40, l0, { timeout: 60000 });
    const l1 = (await page.textContent('#chat-messages'))?.length || 0;
    await page.fill('#chat-input', 'is it a good buy right now?');
    await page.click('#chat-send-btn');
    await page.waitForFunction((b) => (document.querySelector('#chat-messages')?.textContent.length || 0) > b + 40, l1, { timeout: 60000 });
    await page.screenshot({ path: `${SHOTS}/j7-chat-multiturn.png` });
    pass('chat multi-turn (2 replies)');
  } catch (e) { fail('chat multi-turn (2 replies)', e.message); await page.screenshot({ path: `${SHOTS}/j7-FAIL.png` }); }

  // 7) Language cycles UA→EN→FR — click until the French label lands (proves
  // FR_LABELS + applyLang localize the UI in a real browser, not just the AI).
  try {
    await page.click('#tab-search');
    let fr = null;
    for (let i = 0; i < 3 && fr !== 'Analyser'; i++) {
      await page.click('#lang-btn');
      await page.waitForTimeout(300);
      fr = (await page.textContent('#analyze-btn'))?.trim();
    }
    await page.screenshot({ path: `${SHOTS}/j8-french.png` });
    fr === 'Analyser' ? pass('language → French UI', `analyze btn = "${fr}"`) : fail('language → French UI', `got "${fr}"`);
  } catch (e) { fail('language → French UI', e.message); }

  await context.close();

  console.log('\n  ── Journey summary ──');
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(`  ${results.length - failed} passed, ${failed} failed`);
  if (errs.length) { console.log(`\n  Console errors (${errs.length}):`); [...new Set(errs)].slice(0, 10).forEach(e => console.log('   • ' + e.slice(0, 160))); }
  else console.log('  No console errors.');
  // Surface the per-check result on the run's Summary page (visible without logs).
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('fs');
    const md = '### user journey\n\n' + results.map(r => `- ${r[0] === 'PASS' ? '✅' : '❌'} ${r[1]}`).join('\n') + '\n';
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
