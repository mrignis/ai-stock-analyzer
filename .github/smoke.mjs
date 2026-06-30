// CI smoke test for the AI Stock Analyzer popup (runs on GitHub Actions / Ubuntu,
// where Playwright's bundled Chromium loads unpacked extensions out of the box —
// unlike the dev Windows box). Loads the extension from the repo root and clicks
// through the core flows against the LIVE worker.
// Local run (Linux/mac, or Windows with a working VC++ runtime):
//   npm i playwright && npx playwright install chromium && node .github/smoke.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const EXT = process.env.EXT_DIR || resolve(__dir, '..'); // extension = repo root
const SHOTS = resolve(__dir, '..', 'smoke-shots');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const pass = (n, d = '') => { results.push(['PASS', n, d]); console.log(`  PASS ${n}${d ? ' — ' + d : ''}`); };
const fail = (n, d = '') => { results.push(['FAIL', n, d]); console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); };
const consoleErrors = [];

async function main() {
  const context = await chromium.launchPersistentContext('', {
    headless: false, // bundled Chromium under xvfb; honors --load-extension
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });

  // Poll for the MV3 service worker — on a cold CI runner it can take >15s to
  // register, so retry for up to 30s instead of failing on the first miss (flaky).
  let extId = null;
  for (let i = 0; i < 30 && !extId; i++) {
    const s = context.serviceWorkers()[0];
    if (s) extId = s.url().split('/')[2];
    else await new Promise(r => setTimeout(r, 1000));
  }
  if (!extId) { console.log('  FAIL extension service worker never started — extension did not load'); await context.close(); process.exit(2); }
  console.log(`\n  AI Stock Analyzer — popup smoke test  (ext ${extId})\n`);

  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.setViewportSize({ width: 420, height: 640 });
  await page.waitForSelector('#ticker-input', { timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/1-home.png` });
  pass('popup loads');

  // 1) Analyze AAPL
  try {
    await page.fill('#ticker-input', 'AAPL');
    await page.click('#analyze-btn');
    await page.waitForSelector('#result', { state: 'visible', timeout: 70000 });
    await page.waitForFunction(() => (document.querySelector('#r-verdict')?.textContent.trim().length || 0) > 0, { timeout: 70000 });
    const verdict = (await page.textContent('#r-verdict'))?.trim();
    const sector = (await page.textContent('#r-sector'))?.trim();
    await page.screenshot({ path: `${SHOTS}/2-analyze.png` });
    verdict ? pass('analyze AAPL', `verdict="${verdict}" sector="${sector}"`) : fail('analyze AAPL', 'empty verdict');
  } catch (e) { fail('analyze AAPL', e.message); await page.screenshot({ path: `${SHOTS}/2-analyze-FAIL.png` }); }

  // 2) Watchlist + star picker
  try {
    await page.click('#watch-btn');
    await page.click('#tab-watchlist');
    await page.waitForSelector('.watch-item', { timeout: 5000 });
    const stars = await page.locator('.watch-star').count();
    await page.screenshot({ path: `${SHOTS}/3-watchlist.png` });
    stars > 0 ? pass('watchlist + star picker', `${stars} star(s)`) : fail('watchlist + star picker', 'no .watch-star');
  } catch (e) { fail('watchlist + star picker', e.message); }

  // 3) Chat reply
  try {
    await page.click('#tab-chat');
    await page.waitForSelector('#chat-input', { state: 'visible', timeout: 5000 });
    const before = (await page.textContent('#chat-messages'))?.length || 0;
    await page.fill('#chat-input', 'who is the CEO of Apple');
    await page.click('#chat-send-btn');
    await page.waitForFunction((b) => (document.querySelector('#chat-messages')?.textContent.length || 0) > b + 40, before, { timeout: 60000 });
    await page.screenshot({ path: `${SHOTS}/4-chat.png` });
    const txt = (await page.textContent('#chat-messages')) || '';
    txt.length > before + 40 ? pass('chat reply', txt.slice(-110).replace(/\s+/g, ' ').trim()) : fail('chat reply', 'no AI message');
  } catch (e) { fail('chat reply', e.message); await page.screenshot({ path: `${SHOTS}/4-chat-FAIL.png` }); }

  // 4) Language toggle
  try {
    await page.click('#tab-search');
    const b = (await page.textContent('#analyze-btn'))?.trim();
    await page.click('#lang-btn');
    await page.waitForFunction((x) => document.querySelector('#analyze-btn')?.textContent.trim() !== x, b, { timeout: 4000 });
    const a = (await page.textContent('#analyze-btn'))?.trim();
    await page.screenshot({ path: `${SHOTS}/5-lang.png` });
    pass('language toggle', `"${b}" → "${a}"`);
  } catch (e) { fail('language toggle', e.message); }

  await context.close();

  console.log('\n  ── Summary ──');
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(`  ${results.length - failed} passed, ${failed} failed`);
  if (consoleErrors.length) {
    console.log(`\n  Console errors (${consoleErrors.length}):`);
    [...new Set(consoleErrors)].slice(0, 10).forEach(e => console.log('   • ' + e.slice(0, 160)));
  } else console.log('  No console errors.');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(2); });
