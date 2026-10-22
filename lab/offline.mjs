/**
 * offline.mjs —— 验证 PWA：Service Worker 注册 + 断网后还能打开
 * 用法： node lab/offline.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const BASE = process.env.WM_BASE || 'http://127.0.0.1:8123/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function check(c, label, extra) {
  if (c) { pass++; console.log('  ok   ' + label); }
  else { fails.push(label); console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')); }
}

async function waitJson(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch {}
    await sleep(100);
  }
  throw new Error('CDP not up');
}

const profile = path.join(os.tmpdir(), 'wm-offline-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  'about:blank',
], { stdio: 'ignore' });

let ws, msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 20000);
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'js error');
  return r.result?.value;
}

async function main() {
  await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    }
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  console.log('\n[1] first load, wait for SW');
  await send('Page.navigate', { url: BASE });
  await sleep(1200);
  let swState = 'none';
  for (let i = 0; i < 20; i++) {
    swState = await evaluate(`navigator.serviceWorker.ready.then(r => r.active ? r.active.state : 'none')`);
    if (swState === 'activated') break;
    await sleep(500);
  }
  check(swState === 'activated', `service worker activated (got ${swState})`);

  const cached = await evaluate(`(async () => {
    const keys = await caches.keys();
    if (!keys.length) return { keys, count: 0 };
    const c = await caches.open(keys[0]);
    const reqs = await c.keys();
    return { keys, count: reqs.length, urls: reqs.map(r => new URL(r.url).pathname) };
  })()`);
  check(cached.count >= 6, `precached ${cached.count} files`);
  const has = (p) => (cached.urls || []).some((u) => u.endsWith(p));
  check(has('/src/app.js') && has('/styles.css') && has('/index.html'), 'app shell cached', JSON.stringify(cached.urls));

  // 存点数据，等它保存
  await evaluate(`(() => {
    localStorage.setItem('wordmemo.state.v1', JSON.stringify({
      version: 1,
      books: [{ id: 'b1', name: '离线测试', on: true, createdAt: Date.now() }],
      words: [
        { id: 'w1', bookId: 'b1', word: 'abandon', pos: 'v', meaning: '放弃', phonetic: '', createdAt: Date.now() },
        { id: 'w2', bookId: 'b1', word: 'ability', pos: 'n', meaning: '能力', phonetic: '', createdAt: Date.now() }
      ],
      prog: {}, daily: {}, settings: { newPerDay: 20, reviewPerDay: 200, mode: 'auto' }, lastExport: 0
    }));
    return 'ok';
  })()`);

  console.log('\n[2] go offline, reload');
  await send('Network.emulateNetworkConditions', {
    offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  await send('Page.navigate', { url: BASE });
  await sleep(1500);
  const title = await evaluate(`document.querySelector('#viewTitle')?.innerText || ''`);
  const words = await evaluate(`window.__wm ? window.__wm.state.words.length : -1`);
  check(title.length > 0, `page opened offline (header "${title}")`);
  check(words === 2, `local data intact offline (${words} words)`);

  const startable = await evaluate(`!!document.querySelector('[data-act="start"]')`);
  check(startable, 'study button available offline');

  await send('Page.captureScreenshot', { format: 'png' });
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync('lab/shots', { recursive: true });
  fs.writeFileSync(path.resolve('lab/shots/19-offline.png'), Buffer.from(r.data, 'base64'));

  console.log('\n[3] back online');
  await send('Network.emulateNetworkConditions', {
    offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
  await send('Page.navigate', { url: BASE });
  await sleep(900);
  check(await evaluate(`window.__wm.state.words.length === 2`), 'still fine online');

  console.log(`\n${pass} passed, ${fails.length} failed`);
  ws.close();
  chrome.kill();
  if (fails.length) process.exit(1);
}

main().catch((e) => { console.error('crashed:', e.message); chrome.kill(); process.exit(2); });
