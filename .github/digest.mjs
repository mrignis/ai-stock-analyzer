// Daily digest — schedule gating + toast composition.
//
// background.js is a service worker: no browser, no Playwright. It is loaded here
// as source into a Function() with stubbed chrome.* and fetch, so the scheduling
// rules (hour window, weekends, once-a-day, double-fire) can be tested against a
// frozen clock — the alternative is waiting until 09:00 on a Wednesday to find out.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

let store = {};
let notifications = [];
const chrome = {
  runtime: { onInstalled:{addListener(){}}, onStartup:{addListener(){}}, onMessage:{addListener(){}}, lastError:null },
  alarms: { clear:(n,cb)=>cb&&cb(), create(){}, onAlarm:{addListener(){}} },
  notifications: { create:(id,o,cb)=>{notifications.push(o); cb&&cb();}, getAll:(cb)=>cb({}), clear(){}, onClicked:{addListener(){}} },
  storage: { local: {
    get:(keys,cb)=>{ const o={}; keys.forEach(k=>{ if(k in store) o[k]=store[k]; }); cb(o); },
    set:(o,cb)=>{ Object.assign(store,o); cb&&cb(); },
  }},
  tabs:{create(){}},
};

globalThis.chrome = chrome;
globalThis.fetch = async (url) => {
  if (url.includes('/market')) return { json: async () => ({ SP500:{label:'S&P 500',pct:-0.385}, NASDAQ:{label:'NASDAQ',pct:0.1797} }) };
  if (url.includes('/calendar')) {
    const t = new URL(url, 'http://x').searchParams.get('ticker');
    if (t === 'AAPL') return { json: async () => ({ earningsDate: Math.floor((Date.now()+2*86400000)/1000), epsEstimate:1.98 }) };
    if (t === 'ZZ')   return { json: async () => ({ earningsDate: Math.floor((Date.now()+40*86400000)/1000) }) }; // too far
    return { json: async () => ({}) };
  }
  if (url.includes('/price')) {
    const t = new URL(url, 'http://x').searchParams.get('ticker');
    const map = { AAPL:[100,98], NVDA:[184.2,178.5], TSLA:[402.1,410.7], ZZ:[10,10] };
    const [c,pc] = map[t] || [50,50];
    return { json: async () => ({ c, pc, cur:'USD' }) };
  }
  throw new Error('unexpected ' + url);
};

const mod = new Function('WORKER_URL_UNUSED', src + '\n; return { runDigestCheck, buildDigest, N, dayKey, digestMinutes };');
const api = mod();

const sleep = ms => new Promise(r=>setTimeout(r,ms));
let pass=0, fail=0;
function check(name, cond, extra='') {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra?'  → '+extra:'')); }
}

// Freeze "now" to a Wednesday 09:30 local
const RealDate = Date;
function setNow(y,m,d,h,min){
  class D extends RealDate {
    constructor(...a){ if(!a.length) super(y,m,d,h,min); else super(...a); }
    static now(){ return new RealDate(y,m,d,h,min).getTime(); }
  }
  globalThis.Date = D;
}
function resetNow(){ globalThis.Date = RealDate; }

console.log('\n☀️  Daily digest — gating & composition\n');

// 2026-09-09 is a Wednesday
async function run(label, {y=2026,m=8,d=9,h=9,min=30}={}, st={}) {
  notifications = []; store = Object.assign({ digestEnabled:true, notificationsEnabled:true, lang:'ua',
    watchlist:[{ticker:'AAPL'},{ticker:'NVDA'},{ticker:'TSLA'}] }, st);
  setNow(y,m,d,h,min);
  api.runDigestCheck();
  await sleep(60);
  resetNow();
  return notifications;
}

check('fires at the chosen hour on a weekday', (await run('a')).length === 1);
check('does not fire before the chosen hour', (await run('b',{h:7})).length === 0);
check('does not fire 5h late (outside the grace window)', (await run('c',{h:14})).length === 0);
check('fires 3h late (inside the grace window)', (await run('d',{h:12})).length === 1);
check('respects a legacy numeric hour (07:00)', (await run('e',{h:7},{digestHour:7})).length === 1);
// User-typed HH:MM (the time input), including minutes
check('user time 07:45 → silent at 07:30', (await run('t1',{h:7,min:30},{digestTime:'07:45'})).length === 0);
check('user time 07:45 → fires at 07:50',  (await run('t2',{h:7,min:50},{digestTime:'07:45'})).length === 1);
check('user time 21:30 (evening) fires',   (await run('t3',{h:21,min:35},{digestTime:'21:30'})).length === 1);
check('digestTime wins over legacy digestHour', (await run('t4',{h:16,min:5},{digestTime:'16:00',digestHour:9})).length === 1);
check('garbage digestTime falls back to 09:00', (await run('t5',{h:9,min:5},{digestTime:'oops'})).length === 1);
check('silent on Saturday', (await run('f',{d:12})).length === 0);   // 2026-09-12 = Sat
check('silent on Sunday', (await run('g',{d:13})).length === 0);      // Sun
check('off by default flag → silent', (await run('h',{},{digestEnabled:false})).length === 0);
check('notificationsEnabled=false → silent', (await run('i',{},{notificationsEnabled:false})).length === 0);
check('empty watchlist → silent', (await run('j',{},{watchlist:[]})).length === 0);
check('already sent today → silent', (await run('k',{},{digestLastDate:'2026-9-9'})).length === 0);

// No double-fire: two alarms in the same window
notifications = [];
store = { digestEnabled:true, notificationsEnabled:true, lang:'ua', watchlist:[{ticker:'AAPL'}] };
setNow(2026,8,9,9,30);
api.runDigestCheck(); api.runDigestCheck();
await sleep(80); resetNow();
check('two alarms in one window → exactly one toast', notifications.length === 1, 'got '+notifications.length);

// Composition
notifications = [];
store = { lang:'ua', watchlist:[] };
api.buildDigest([{ticker:'AAPL'},{ticker:'NVDA'},{ticker:'TSLA'}], 'ua');
await sleep(60);
const msg = notifications[0] ? notifications[0].message : '';
const title = notifications[0] ? notifications[0].title : '';
console.log('\n  --- UA toast ---\n  ' + title + '\n  ' + msg.split('\n').join('\n  ') + '\n');
check('has market line', msg.includes('S&P 500') && msg.includes('NASDAQ'));
check('biggest mover first (NVDA +3.2%)', msg.split('\n')[1].includes('NVDA'));
check('shows earnings within 7d', msg.includes('Звіти') && msg.includes('AAPL'));
check('UA title', title.includes('щоденний дайджест'));

for (const [lg, want] of [['en','daily digest'],['fr','résumé quotidien']]) {
  notifications = [];
  api.buildDigest([{ticker:'AAPL'},{ticker:'NVDA'}], lg);
  await sleep(60);
  const t = notifications[0].title, mm = notifications[0].message;
  console.log('  --- ' + lg.toUpperCase() + ' toast ---\n  ' + t + '\n  ' + mm.split('\n').join('\n  ') + '\n');
  check(lg.toUpperCase()+' title localized', t.toLowerCase().includes(want));
  check(lg.toUpperCase()+' earnings line localized', /Earnings|Résultats/.test(mm));
}

// Far-out earnings excluded
notifications = [];
api.buildDigest([{ticker:'ZZ'}], 'en');
await sleep(60);
check('earnings 40 days away are excluded', !(notifications[0]||{message:''}).message.includes('Earnings'));

// N() helper
check('N() falls back fr→en when no fr string', api.N('fr','у','en') === 'en');
check('N() picks fr when present', api.N('fr','у','en','fr!') === 'fr!');

// digestMinutes() parsing
check('digestMinutes "07:45" → 465', api.digestMinutes({digestTime:'07:45'}) === 465);
check('digestMinutes "7:05" (no pad) → 425', api.digestMinutes({digestTime:'7:05'}) === 425);
check('digestMinutes rejects 25:00', api.digestMinutes({digestTime:'25:00'}) === 540);
check('digestMinutes rejects 09:99', api.digestMinutes({digestTime:'09:99'}) === 540);
check('digestMinutes default is 09:00', api.digestMinutes({}) === 540);

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
