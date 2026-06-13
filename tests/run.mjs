// Behavioral test runner for the AI Stock Analyzer worker.
// Cases authored by claude-helper, runner by Claude. Run: node tests/run.mjs
// Hits the live worker and asserts on BEHAVIOR (not exact prices, which move).
import { readFileSync } from 'node:fs';

const BASE = process.env.WORKER_URL || 'https://stock-ai-analyzer.chelb-dev.workers.dev';
const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url)));

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

async function runCase(c) {
  const opts = { method: c.method, headers: { 'Content-Type': 'application/json' } };
  if (c.body) opts.body = JSON.stringify(c.body);

  let res, text, data;
  try {
    res = await fetch(BASE + c.path, opts);
    text = await res.text();
    try { data = JSON.parse(text); } catch { data = null; }
  } catch (e) {
    return { ok: false, why: 'network error: ' + e.message };
  }

  const reply = (data && (data.reply || data.error || '')) || text || '';
  switch (c.check) {
    case 'status':
      return { ok: res.status === c.value, why: `status ${res.status}, expected ${c.value}` };
    case 'json_positive': {
      const v = Number(get(data || {}, c.field));
      return { ok: v > 0, why: `${c.field}=${v}` };
    }
    case 'json_array_min': {
      const arr = get(data || {}, c.field);
      const n = Array.isArray(arr) ? arr.length : -1;
      return { ok: n >= c.value, why: `${c.field}.length=${n}, need >=${c.value}` };
    }
    case 'json_contains': {
      const v = String(get(data || {}, c.field) || '');
      return { ok: v.toLowerCase().includes(String(c.value).toLowerCase()), why: `${c.field}="${v}"` };
    }
    case 'reply_contains_any': {
      const hit = c.value.find(v => reply.toLowerCase().includes(String(v).toLowerCase()));
      return { ok: !!hit, why: hit ? `found "${hit}"` : `none of [${c.value}] in reply` };
    }
    case 'reply_not_contains':
      return { ok: !reply.toLowerCase().includes(String(c.value).toLowerCase()),
               why: `reply ${reply.toLowerCase().includes(String(c.value).toLowerCase()) ? 'HAS' : 'lacks'} "${c.value}"` };
    default:
      return { ok: false, why: 'unknown check: ' + c.check };
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
console.log(`\n  AI Stock Analyzer — behavioral tests (${cases.length})  →  ${BASE}\n`);
for (const c of cases) {
  process.stdout.write('  • ' + c.name.padEnd(48));
  let r = await runCase(c);
  // One retry for AI endpoints — Groq queue / our own rate limiter can blip
  if (!r.ok && c.path.match(/chat|analyze/)) { await sleep(4000); r = await runCase(c); }
  if (r.ok) { pass++; console.log('PASS'); }
  else { fail++; console.log('FAIL  (' + r.why + ')'); }
  await sleep(2500); // stay under the worker's 20-req/min rate limit
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
