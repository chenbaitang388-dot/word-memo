/**
 * e2e.mjs —— 用 Chrome DevTools Protocol 驱动真浏览器跑一遍真实流程
 * 不依赖任何第三方包（Node 24 自带 WebSocket）
 *
 * 用法： node lab/e2e.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const BASE = process.env.WM_BASE || 'http://127.0.0.1:8123/';
const SHOTS = path.resolve('lab/shots');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function check(cond, label, extra) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fails.push(label); console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

async function waitJson(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(100);
  }
  throw new Error('CDP not up: ' + url);
}

const profile = path.join(os.tmpdir(), 'wm-profile-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--hide-scrollbars',
  '--disable-extensions', '--mute-audio',
  'about:blank',
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
const logs = [];

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
    }, 20000);
  });
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error('JS exception: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result?.value;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const p = path.join(SHOTS, name + '.png');
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  return p;
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    const ok = await evaluate(`document.readyState === 'complete' && !!document.querySelector('#tabbar') && !!window.__wm`);
    if (ok) return true;
    await sleep(100);
  }
  return false;
}

async function click(sel) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'NOTFOUND';
    el.click();
    return 'OK';
  })()`);
}

const MESSY = [
  'abandon v. 放弃，抛弃',
  'ability n. 能力，才能',
  'absolute adj. 绝对的，完全的',
  'absorb v. 吸收',
  'abstract adj. 抽象的',
  'accompany v. 陪伴',
  'accomplish v. 完成，实现',
  'accurate adj. 准确的',
  'achieve v. 达到，取得',
  'acquire v. 获得，学到',
  '  ',
  '这是中文没有英文',
  'abandon n. 放任',
  'onlyword',
  '12. adapt v. 适应',
  '  - adequate adj. 足够的',
  'admire v. 钦佩',
  'adopt v. 采用',
  'advance v. 前进',
  'afford v. 买得起',
  'aggressive adj. 好斗的',
  'alter v. 改变',
  'analyze v. 分析',
].join('\n');

async function main() {
  await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(m.error.message));
      else resolve(m.result);
      return;
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const lvl = m.params.type;
      if (lvl === 'error' || lvl === 'warning') {
        logs.push(lvl + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('exception: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });

  console.log('\n[1] first screen');
  await send('Page.navigate', { url: BASE });
  await waitReady();
  await sleep(300);
  check(await evaluate(`!!document.querySelector('[data-act="demo"]')`), 'empty state shows demo entry');
  await shot('01-empty');

  console.log('\n[2] new book');
  check((await click('[data-act="new-book"]')) === 'OK', 'new-book button clickable');
  await sleep(200);
  check(await evaluate(`!document.querySelector('#modal').hidden`), 'modal opened');
  await evaluate(`(() => {
    const i = document.querySelector('#modalInput');
    i.value = '考研 Unit 1-10';
    return i.value;
  })()`);
  await shot('02-new-book');
  await evaluate(`[...document.querySelectorAll('#modal .modal-actions .btn')].pop().click()`);
  await sleep(250);
  check(await evaluate(`!!document.querySelector('#importText')`), 'entered book detail');
  await shot('03-book-detail');

  console.log('\n[3] paste import with bad lines');
  await evaluate(`(() => {
    const t = document.querySelector('#importText');
    t.value = ${JSON.stringify(MESSY)};
    return t.value.length;
  })()`);
  check((await click('[data-act="import-run"]')) === 'OK', 'import button clickable');
  await sleep(400);
  const report = await evaluate(`document.querySelector('#importReport').innerText`);
  const nWords = await evaluate(`window.__wm.state.words.length`);
  check(nWords === 19, `imported 19 words (got ${nWords})`);
  check(/有问题 2 行/.test(report), 'reports 2 bad lines', JSON.stringify(report));
  check(/跳过重复/.test(report), 'reports duplicates', JSON.stringify(report));
  check(/缺少中文释义/.test(report), 'explains missing meaning', JSON.stringify(report));
  check(/没找到英文单词/.test(report), 'explains not-a-word line', JSON.stringify(report));
  check(!/第 15 行|第 16 行/.test(report), 'numbered / bullet lines parse fine');
  await shot('04-import-report');

  console.log('\n[4] card self-rating');
  await click('#tabbar button[data-tab="study"]');
  await sleep(200);
  check(await evaluate(`!!document.querySelector('[data-act="start"]')`), 'start button on home');
  await shot('05-today');
  await click('[data-act="start"]');
  await sleep(250);
  check(await evaluate(`!!document.querySelector('.qcard .bigword')`), 'word card appears');
  check(await evaluate(`!!document.querySelector('.reveal')`), 'meaning hidden by default');
  await shot('06-card');
  await click('.reveal');
  await sleep(200);
  check(await evaluate(`!!document.querySelector('.qcard .meaning')`), 'meaning shows after reveal');
  check(await evaluate(`document.querySelectorAll('[data-act="rate"]').length === 3`), 'three rating buttons');
  await shot('07-card-revealed');
  await click('[data-act="rate"][data-res="know"]');
  await sleep(300);
  check(await evaluate(`window.__wm.state.daily[Object.keys(window.__wm.state.daily)[0]].okN === 1`), 'counted one "know"');
  check(await evaluate(`window.__wm.session.i === 1`), 'auto advanced');

  console.log('\n[5] seeded stages -> choice / spell');
  const seeded = await evaluate(`(() => {
    const KEY = 'wordmemo.state.v1';
    const s = JSON.parse(localStorage.getItem(KEY));
    const ws = s.words.slice(0, 2);
    s.prog = {};
    s.prog[ws[0].word.toLowerCase()] = { stage: 2, ease: 2.5, interval: 259200000, due: 0, reps: 2, lapses: 0, lastAt: Date.now() - 5000, firstAt: Date.now() - 9e7, hist: [] };
    s.prog[ws[1].word.toLowerCase()] = { stage: 4, ease: 2.5, interval: 1296000000, due: 0, reps: 4, lapses: 0, lastAt: Date.now() - 4000, firstAt: Date.now() - 9e7, hist: [] };
    s.daily = {};
    localStorage.setItem(KEY, JSON.stringify(s));
    return Object.keys(s.prog);
  })()`);
  check(seeded && seeded.length === 2, 'seeded two stages', JSON.stringify(seeded));

  await send('Page.navigate', { url: BASE });
  await waitReady();
  await sleep(300);
  await click('[data-act="start"]');
  await sleep(300);
  const optCount = await evaluate(`document.querySelectorAll('.opt').length`);
  check(optCount >= 2, `choice question rendered (${optCount} options)`);
  check(await evaluate(`!document.querySelector('#spellInput')`), 'stage 2 is choice, not spell');
  await shot('08-choice');

  const wantIdx = await evaluate(`(() => {
    const want = window.__wm.session.items[window.__wm.session.i].meaning;
    const opts = [...document.querySelectorAll('.opt')];
    return opts.findIndex(o => o.querySelector('span:nth-child(2)').innerText.trim() === want);
  })()`);
  check(wantIdx >= 0, 'correct option is among choices');
  const pick = wantIdx === 0 ? 1 : 0;
  await click(`.opt[data-idx="${pick}"]`);
  await sleep(250);
  check(await evaluate(`document.querySelectorAll('.opt.wrong').length === 1`), 'wrong choice marked red');
  check(await evaluate(`document.querySelectorAll('.opt.right').length === 1`), 'right answer marked');
  await shot('09-choice-wrong');
  await sleep(1700);
  check(await evaluate(`!!document.querySelector('#spellInput')`), 'next item is spell mode');
  await shot('10-spell');
  await evaluate(`(() => { const i = document.querySelector('#spellInput'); i.value = 'zzzzz'; return i.value; })()`);
  await click('[data-act="spell-submit"]');
  await sleep(300);
  check(await evaluate(`!!document.querySelector('.spell-input.wrong')`), 'misspelling marked red');
  check(await evaluate(`document.querySelector('#spellInput').value === 'zzzzz'`), 'input keeps what was typed');
  check(await evaluate(`!!document.querySelector('.feedback.err')`), 'feedback shown');
  await shot('11-spell-wrong');
  await click('[data-act="cont"]');
  await sleep(250);

  console.log('\n[6] other screens');
  await click('#tabbar button[data-tab="books"]');
  await sleep(250);
  check(await evaluate(`document.querySelectorAll('.switch').length === 1`), 'book toggle present');
  await shot('12-books');

  await click('#tabbar button[data-tab="stats"]');
  await sleep(250);
  check(await evaluate(`document.querySelectorAll('.cal i').length === 56`), 'heatmap 56 cells');
  await shot('13-stats');

  await click('#tabbar button[data-tab="settings"]');
  await sleep(250);
  check(await evaluate(`!!document.querySelector('#setNew')`), 'settings has daily limit');
  await shot('14-settings');

  console.log('\n[7] export backup');
  await click('[data-act="export"]');
  await sleep(900);
  check(await evaluate(`window.__wm.state.lastExport > 0`), 'export recorded timestamp');

  console.log('\n[7b] restore from backup file');
  await click('#tabbar button[data-tab="settings"]');
  await sleep(250);
  const doc = await send('DOM.getDocument');
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
  check(!!q.nodeId, 'file input found');
  await send('DOM.setFileInputFiles', {
    files: [path.resolve('lab/sample-backup.json')],
    nodeId: q.nodeId,
  });
  await evaluate(`document.querySelector('#fileInput').dispatchEvent(new Event('change'))`);
  await sleep(500);
  check(await evaluate(`!document.querySelector('#modal').hidden`), 'restore dialog opened');
  await shot('17-restore-dialog');
  await evaluate(`[...document.querySelectorAll('#modal .modal-actions .btn')].pop().click()`);
  await sleep(400);
  const after = await evaluate(`({
    books: window.__wm.state.books.length,
    words: window.__wm.state.words.length,
    hasZebra: window.__wm.state.words.some(w => w.word === 'zebra'),
  })`);
  check(after.books === 2, `merged into 2 books (got ${after.books})`);
  check(after.words === 21, `words 21 after merge (got ${after.words})`);
  check(after.hasZebra, 'imported word present');
  await shot('18-after-restore');

  console.log('\n[8] dark mode');
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await click('#tabbar button[data-tab="study"]');
  await sleep(300);
  await shot('15-dark-today');
  try { await click('[data-act="start"]'); } catch {}
  await sleep(300);
  await shot('16-dark-card');

  console.log('\n[9] console');
  const bad = logs.filter((l) => !/Service Worker registration blocked/.test(l));
  check(bad.length === 0, 'no JS errors', bad.join('\n'));
  if (bad.length) console.log(bad.join('\n'));

  console.log(`\n${pass} passed, ${fails.length} failed`);
  ws.close();
  chrome.kill();
  if (fails.length) process.exit(1);
}

main().catch(async (e) => {
  console.error('crashed:', e.message);
  try { await shot('99-crash'); } catch {}
  chrome.kill();
  process.exit(2);
});
