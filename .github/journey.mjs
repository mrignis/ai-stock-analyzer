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
  await page.fill('#ticker-input', input);
  await page.click('#analyze-btn');
  await page.waitForFunction((re) => {
    const t = document.querySelector('#r-ticker')?.textContent?.trim() || '';
    const v = document.querySelector('#r-verdict')?.textContent?.trim() || '';
    return new RegExp(re, 'i').test(t) && v.length > 0;
  }, expect, { timeout: 75000 });
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

  // 3) Foreign/penny ticker → resolves to .TO with a price
  try {
    const r = await analyze(page, 'SAU', 'SAU', 'j3-foreign.png');
    const ok = /SAU\.TO/i.test(r.ticker) && /\d/.test(r.price);
    ok ? pass('foreign SAU → SAU.TO + price', `${r.ticker}, ${r.price}`)
       : fail('foreign SAU → SAU.TO + price', `${r.ticker}, price="${r.price}"`);
  } catch (e) { fail('foreign SAU → SAU.TO + price', e.message); await page.screenshot({ path: `${SHOTS}/j3-FAIL.png` }); }

  // 4) Crypto → price + verdict, then add to watchlist
  try {
    const r = await analyze(page, 'BTC', 'BTC', 'j4-crypto.png');
    await page.click('#watch-btn');
    pass('crypto BTC analyze + add', `${r.ticker}, ${r.price}`);
  } catch (e) { fail('crypto BTC analyze + add', e.message); }

  // 5) Second stock to watchlist, then star it and confirm it shows on home
  try {
    await analyze(page, 'AAPL', 'AAPL');
    await page.click('#watch-btn');
    await page.click('#tab-watchlist');
    await page.waitForSelector('.watch-item', { timeout: 5000 });
    const items = await page.locator('.watch-item').count();
    // star the AAPL row
    await page.locator('.watch-star[data-ticker="AAPL"]').first().click();
    await page.screenshot({ path: `${SHOTS}/j5-watchlist.png` });
    // Back to the HOME view via the logo — #tab-search alone keeps the last
    // analysis result on screen, which hides the home watchlist block. The logo
    // clears the result and shows the home list where pinned tiles live.
    await page.click('#nav-logo');
    await page.waitForSelector('.hwl-item[data-ticker="AAPL"]', { state: 'visible', timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/j6-home-pinned.png` });
    pass('watchlist→star→home', `${items} items, AAPL pinned to home`);
  } catch (e) { fail('watchlist→star→home', e.message); await page.screenshot({ path: `${SHOTS}/j5-FAIL.png` }); }

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

  // 7) Language toggle re-localizes
  try {
    await page.click('#tab-search');
    const b = (await page.textContent('#analyze-btn'))?.trim();
    await page.click('#lang-btn');
    await page.waitForFunction((x) => document.querySelector('#analyze-btn')?.textContent.trim() !== x, b, { timeout: 4000 });
    const a = (await page.textContent('#analyze-btn'))?.trim();
    pass('language toggle', `"${b}" → "${a}"`);
  } catch (e) { fail('language toggle', e.message); }

  await context.close();

  console.log('\n  ── Journey summary ──');
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(`  ${results.length - failed} passed, ${failed} failed`);
  if (errs.length) { console.log(`\n  Console errors (${errs.length}):`); [...new Set(errs)].slice(0, 10).forEach(e => console.log('   • ' + e.slice(0, 160))); }
  else console.log('  No console errors.');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
