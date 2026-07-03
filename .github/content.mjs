// Deep test for the content-script ticker highlighter (growth feature A).
// Serves a controlled fixture AT a matched finance host (finance.yahoo.com) via
// route interception, loads the unpacked extension, and verifies: cashtag +
// parenthesised tickers get highlighted; stop-words and tickers inside links do
// NOT; and clicking a highlight opens the analysis tab with the right ticker.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const EXT = process.env.EXT_DIR || resolve(__dir, '..');

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title></head>
<body><article>
  <p id="p1">Analysts love $TSLA and shares of (AAPL) this quarter. Buy $NVDA now.</p>
  <p id="p2">The (CEO) told (USA) investors the (ETF) looks strong — all stop-words.</p>
  <p id="p3"><a href="#" id="lnk">Full report on (MSFT)</a> is worth a read.</p>
</article></body></html>`;

const results = [];
const ok = (n) => { results.push(['PASS', n]); console.log('  PASS ' + n); };
const bad = (n, d = '') => { results.push(['FAIL', n]); console.log('  FAIL ' + n + (d ? ' — ' + d : '')); };

async function main() {
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  });
  // wait for the extension service worker so the extension is actually loaded
  let extId = null;
  for (let i = 0; i < 30 && !extId; i++) {
    const s = context.serviceWorkers()[0];
    if (s) extId = s.url().split('/')[2];
    else await new Promise(r => setTimeout(r, 1000));
  }
  if (!extId) { console.log('  FAIL extension did not load'); await context.close(); process.exit(2); }
  console.log(`\n  Content-script ticker highlighter  (ext ${extId})\n`);

  const page = await context.newPage();
  // Serve our fixture as if it were finance.yahoo.com (a matched host) so the
  // content script injects exactly as it would in production.
  await page.route('**/finance.yahoo.com/**', r =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: FIXTURE }));
  await page.goto('https://finance.yahoo.com/news/test-article.html', { waitUntil: 'load' });
  // content script runs at document_idle + does an initial scan; give it a moment
  await page.waitForSelector('.ais-tk-hl', { timeout: 8000 }).catch(() => {});

  const hl = await page.$$eval('.ais-tk-hl', els => els.map(e => e.getAttribute('data-ais')));
  const has = t => hl.includes(t);

  // 1) real tickers highlighted
  (has('TSLA') && has('AAPL') && has('NVDA'))
    ? ok('highlights $TSLA, (AAPL), $NVDA') : bad('highlights real tickers', 'got ' + JSON.stringify(hl));
  // 2) stop-words NOT highlighted
  (!has('CEO') && !has('USA') && !has('ETF'))
    ? ok('skips stop-words (CEO/USA/ETF)') : bad('skips stop-words', 'got ' + JSON.stringify(hl));
  // 3) ticker inside a link NOT highlighted
  !has('MSFT') ? ok('skips ticker inside <a>') : bad('skips ticker inside <a>');
  // 4) exactly 3 highlights (no over-matching)
  hl.length === 3 ? ok('exactly 3 highlights') : bad('highlight count', 'got ' + hl.length);

  // 5) click a highlight → opens analysis tab with the right ticker
  try {
    const [newPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 8000 }),
      page.click('.ais-tk-hl[data-ais="TSLA"]'),
    ]);
    const url = newPage.url();
    /ticker=TSLA/.test(url) ? ok('click opens analysis tab (ticker=TSLA)') : bad('click opens tab', 'url ' + url);
  } catch (e) { bad('click opens analysis tab', e.message); }

  await context.close();
  const failed = results.filter(r => r[0] === 'FAIL').length;
  console.log(`\n  ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e); process.exit(2); });
