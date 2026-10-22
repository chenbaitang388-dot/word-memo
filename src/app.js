/* ============================================================
   app.js —— 界面层
   ============================================================ */

import {
  DAY, MIN10, MASTER_STAGE, LADDER,
  parseImport, schedule, modeFor, buildQueue, buildChoices,
  checkSpelling, spellHint, calcStreak, todayStats, summarize,
  mergeStates, dayKey, wordKey, uid, displayPos, studyWords, shuffle,
} from './core.js';

const LS_KEY = 'wordmemo.state.v1';
const APP_VERSION = '1.0.0';

/* ---------------- 状态 ---------------- */

function blankState() {
  return {
    version: 1,
    books: [],
    words: [],
    prog: {},
    daily: {},
    settings: { newPerDay: 20, reviewPerDay: 200, mode: 'auto' },
    lastExport: 0,
    createdAt: Date.now(),
  };
}

let state = blankState();
let session = null;
let view = 'study';
let currentBookId = null;
let lastImportReport = null;

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    state = Object.assign(blankState(), parsed);
    state.settings = Object.assign({ newPerDay: 20, reviewPerDay: 200, mode: 'auto' }, parsed.settings || {});
    state.books = Array.isArray(parsed.books) ? parsed.books : [];
    state.words = Array.isArray(parsed.words) ? parsed.words : [];
    state.prog = parsed.prog && typeof parsed.prog === 'object' ? parsed.prog : {};
    state.daily = parsed.daily && typeof parsed.daily === 'object' ? parsed.daily : {};
  } catch (e) {
    console.warn('读取本地数据失败', e);
  }
}

let saveTimer = null;
function save(immediate = false) {
  const doIt = () => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      toast('保存失败：手机存储可能满了，请先导出备份');
      console.error(e);
    }
  };
  if (immediate) { clearTimeout(saveTimer); doIt(); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doIt, 120);
}

/* ---------------- 小工具 ---------------- */

const $ = (sel, root = document) => root.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 250);
  }, 2200);
}

/**
 * 通用弹窗
 * 返回：确认 → true（或有输入时为字符串）；取消 → false / null
 */
function showModal({ title, body = '', ok = '确定', cancel = '取消', danger = false, input = null, alt = null }) {
  return new Promise((resolve) => {
    const m = $('#modal');
    const actions = m.querySelector('.modal-actions');
    $('#modalTitle').textContent = title;
    const bodyEl = $('#modalBody');
    if (input != null) {
      bodyEl.innerHTML = `${body ? esc(body) + '<br><br>' : ''}
        <input id="modalInput" class="spell-input" type="text" value="${esc(input)}"
          autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false">`;
    } else {
      bodyEl.textContent = body;
    }

    // 按需重建按钮行，避免上一次的残留
    actions.innerHTML = '';
    const mkBtn = (label, cls, val) => {
      const b = document.createElement('button');
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.onclick = () => close(val);
      actions.appendChild(b);
      return b;
    };

    let okBtn = null;
    mkBtn(cancel, 'ghost', input != null ? null : false);
    if (alt) mkBtn(alt, 'bad', 'alt');
    okBtn = mkBtn(ok, danger ? 'bad' : 'primary', input != null ? undefined : true);

    m.hidden = false;
    const inputEl = $('#modalInput');
    if (inputEl) setTimeout(() => { inputEl.focus(); inputEl.select(); }, 60);

    function close(val) {
      m.hidden = true;
      m.onclick = null;
      resolve(val);
    }
    const commit = () => {
      if (inputEl) {
        const v = inputEl.value.trim();
        if (!v) { inputEl.focus(); return; }
        close(v);
      } else close(true);
    };
    okBtn.onclick = commit;
    if (inputEl) inputEl.onkeydown = (ev) => { if (ev.key === 'Enter') commit(); };
    m.onclick = (e) => { if (e.target === m) close(inputEl != null ? null : false); };
  });
}

function modalConfirm(opts) { return showModal(opts); }

function bookById(id) { return state.books.find((b) => b.id === id) || null; }

function wordsOfBook(id) { return state.words.filter((w) => w.bookId === id); }

function fmtDate(ts) {
  if (!ts) return '从没备份过';
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function relDue(ts) {
  const diff = ts - Date.now();
  if (diff <= 0) return '待复习';
  if (diff < 3600000) return Math.round(diff / 60000) + ' 分钟后';
  if (diff < DAY) return Math.round(diff / 3600000) + ' 小时后';
  return Math.round(diff / DAY) + ' 天后';
}

/* ---------------- 页面骨架 ---------------- */

const TITLES = {
  study: ['学习', ''],
  books: ['词库', ''],
  book: ['词库', ''],
  stats: ['统计', ''],
  settings: ['设置', ''],
};

function setHeader(title, sub) {
  $('#viewTitle').textContent = title;
  if (sub != null) $('#viewSub').textContent = sub;
}

function render() {
  const main = $('#main');
  document.querySelectorAll('#tabbar button').forEach((b) => {
    const tab = b.dataset.tab;
    const active = tab === view || (view === 'book' && tab === 'books');
    b.classList.toggle('on', active);
  });

  if (view === 'study') renderStudy(main);
  else if (view === 'books') renderBooks(main);
  else if (view === 'book') renderBook(main);
  else if (view === 'stats') renderStats(main);
  else if (view === 'settings') renderSettings(main);

  $('#btnBackup').hidden = !(state.words.length > 0);
}

/* ---------------- 学习页 ---------------- */

function renderStudy(main) {
  if (session) { renderSession(main); return; }
  const s = summarize(state);
  setHeader('学习', state.words.length ? `${s.total} 个词 · 已掌握 ${s.mastered}` : '还没有词');

  if (!state.words.length) {
    main.innerHTML = `
      <div class="card center" style="padding:28px 20px">
        <div style="font-size:38px;line-height:1">📚</div>
        <h2 style="margin:14px 0 6px;font-size:19px">先建一个词库</h2>
        <p class="muted small" style="margin:0 0 18px">
          把你的单词表粘贴进来，一行一个，例如：<br>
          <span class="dim" style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px">abandon v. 放弃，抛弃</span>
        </p>
        <button class="btn primary block lg" data-act="new-book">新建词库</button>
        <button class="btn ghost block mt8" data-act="demo">先放 20 个示例词试试</button>
      </div>`;
    return;
  }

  const q = buildQueue(state);
  const total = q.reviews.length + q.news.length;
  const t = s.today;
  const perDay = Math.max(1, state.settings.newPerDay);
  const doneToday = Math.min(perDay, t.newN + (session ? 0 : 0));
  const pct = Math.min(100, Math.round((doneToday / perDay) * 100));

  const backupOld = state.words.length > 0 && (Date.now() - (state.lastExport || 0) > 7 * DAY)
    && Object.keys(state.prog).length > 0;

  main.innerHTML = `
    <div class="hero">
      <div class="big">${total > 0 ? total : '0'}</div>
      <div class="lbl">${total > 0 ? '个词等着你（复习优先）' : '今天的任务都完成了 🎉'}</div>
      <div class="hero-stats">
        <div><b>${q.reviews.length}</b>待复习</div>
        <div><b>${q.news.length}</b>新词</div>
        <div><b>${s.streak}</b>天连续</div>
      </div>
      <div class="bar on-hero" style="margin-top:14px"><i style="width:${pct}%"></i></div>
      <div class="lbl" style="margin-top:7px;font-size:11.5px">今日新词 ${t.newN}/${perDay}</div>
    </div>

    ${backupOld ? `<div class="notice">
      <span class="grow">已经 7 天没备份了，手机清缓存会丢数据，建议现在导出一份。</span>
      <button class="btn" data-act="export">备份</button>
    </div>` : ''}
    ${(q.backlogReviews > 0) ? `<div class="notice accent">
      <span class="grow">复习积压 ${q.backlogReviews} 个，超过今日上限，会顺延到明天。</span>
    </div>` : ''}
    ${(q.backlogNews > 0 && q.news.length === 0) ? `<div class="notice">
      <span class="grow">今天的新词额度用完了，还剩 ${q.backlogNews} 个明天继续。</span>
    </div>` : ''}

    <button class="btn primary block lg" data-act="start" ${total ? '' : 'disabled'}>
      ${total ? '开始学习' : '今天没有要学的了'}
    </button>

    <div class="stat-grid" style="margin-top:2px">
      <div class="stat"><div class="v">${t.acc}%</div><div class="k">今日正确率（${t.totalN} 次）</div></div>
      <div class="stat"><div class="v">${s.masteredPct}%</div><div class="k">掌握进度（${s.mastered}/${s.total}）</div></div>
    </div>

    <div class="card tight">
      <div class="row">
        <div class="grow">
          <div class="row-label">今天学了 ${t.totalN} 次</div>
          <div class="row-hint">复习 ${t.revN} · 新词 ${t.newN} · 掌握 ${t.okN}</div>
        </div>
        <button class="btn ghost small" data-act="tab" data-tab="stats">看统计</button>
      </div>
    </div>`;
}

/* ---------------- 一轮学习 ---------------- */

function startSession() {
  const q = buildQueue(state);
  const items = [
    ...q.reviews.map((w) => makeItem(w)),
    ...shuffle(q.news).map((w) => makeItem(w)),
  ];
  if (!items.length) { toast('今天没有要学的了'); return; }
  session = {
    items,
    i: 0,
    phase: 'q',
    revealed: false,
    lastResult: null,
    choiceIdx: null,
    stats: { know: 0, fuzzy: 0, forgot: 0, total: 0 },
    startedAt: Date.now(),
    round: 1,
    userInput: null,
  };
  render();
}

function makeItem(w) {
  const p = state.prog[w.key];
  const stage = p ? (p.stage || 0) : 0;
  return {
    key: w.key,
    word: w.word,
    pos: w.pos,
    meaning: w.meaning,
    phonetic: w.phonetic,
    bookName: w.bookName,
    mode: modeFor(stage, state.settings.mode),
  };
}

function currentItem() { return session ? session.items[session.i] : null; }

function renderSession(main) {
  if (session.i >= session.items.length) { renderSummary(main); return; }
  const item = currentItem();
  const total = session.items.length;
  const pct = Math.round((session.i / total) * 100);
  setHeader('学习中', `第 ${session.i + 1} / ${total} 个`);

  const head = `
    <div class="progress-line">
      <div class="bar"><i style="width:${pct}%"></i></div>
      <span>${session.i}/${total}</span>
      <button class="btn ghost small" style="padding:4px 10px;font-size:12.5px" data-act="end-session">结束</button>
    </div>`;

  let body = '';
  if (item.mode === 'card') body = cardHTML(item);
  else if (item.mode === 'choice') body = choiceHTML(item);
  else body = spellHTML(item);

  main.innerHTML = head + body;
  if (item.mode === 'spell' && session.phase === 'q') {
    const inp = $('#spellInput');
    if (inp) setTimeout(() => inp.focus(), 60);
  }
}

function posChip(item) {
  return item.pos ? `<span class="chip accent">${esc(displayPos(item.pos))}</span>` : '';
}

function cardHTML(item) {
  const revealed = session.revealed;
  return `
    <div class="qcard" data-act="reveal">
      <div class="pos-line">${posChip(item)}</div>
      <div class="bigword">${esc(item.word)}</div>
      ${item.phonetic ? `<div class="phon">${esc(item.phonetic)}</div>` : ''}
      ${revealed
        ? `<div class="divider"></div><div class="meaning">${esc(item.meaning)}</div>`
        : `<button class="btn primary reveal" data-act="reveal">显示释义</button>
           <div class="dim tiny" style="margin-top:14px">想好了再看</div>`}
    </div>
    ${revealed
      ? `<div class="rate-row">
           <button class="btn bad" data-act="rate" data-res="forgot">不认识<small>10 分钟后再来</small></button>
           <button class="btn warn" data-act="rate" data-res="fuzzy">模糊<small>约 1 天后</small></button>
           <button class="btn ok" data-act="rate" data-res="know">认识<small>往后推</small></button>
         </div>`
      : ''}
  `;
}

function choiceHTML(item) {
  if (!item.options) {
    const pool = studyWords(state).map((w) => ({ word: w.word, pos: w.pos, meaning: w.meaning }));
    const built = buildChoices(
      { word: item.word, pos: item.pos, meaning: item.meaning },
      pool
    );
    item.options = built.options;
    item.optionsComplete = built.complete;
  }
  const answered = session.phase === 'a';
  const chosen = session.choiceIdx;
  const correctIdx = item.options.indexOf(item.meaning);

  const opts = item.options.map((o, i) => {
    let cls = 'opt';
    let keyLabel = String(i + 1);
    if (answered) {
      if (i === correctIdx) { cls += ' right'; keyLabel = '✓'; }
      else if (i === chosen) { cls += ' wrong'; keyLabel = '✕'; }
    }
    return `<button class="${cls}" data-act="opt" data-idx="${i}" ${answered ? 'disabled' : ''}>
      <span class="key">${keyLabel}</span><span>${esc(o)}</span></button>`;
  }).join('');

  return `
    <div class="qcard" style="justify-content:center">
      <div class="pos-line">${posChip(item)}</div>
      <div class="bigword">${esc(item.word)}</div>
      ${item.phonetic ? `<div class="phon">${esc(item.phonetic)}</div>` : ''}
      <div class="dim small" style="margin-top:16px">选出正确的中文意思</div>
    </div>
    <div class="options">${opts}</div>
    ${item.optionsComplete === false ? `<div class="center dim tiny">词库太小，只能凑出 ${item.options.length} 个选项</div>` : ''}
  `;
}

function spellHTML(item) {
  const answered = session.phase === 'a';
  const ok = session.lastResult === 'right';
  const typed = session.userInput != null ? session.userInput : '';
  return `
    <div class="qcard" style="min-height:0;padding:24px 20px">
      <div class="pos-line">${posChip(item)}</div>
      <div class="meaning zh">${esc(item.meaning)}</div>
      ${answered ? `<div class="divider"></div><div class="bigword" style="font-size:30px;color:${ok ? 'var(--ok)' : 'var(--fg)'}">${esc(item.word)}</div>` : ''}
    </div>
    <div class="spell-box">
      <div class="hint">${esc(spellHint(item.word))} <span class="dim tiny">(${item.word.replace(/[\s]/g, '').length} 个字母)</span></div>
      <input id="spellInput" class="spell-input ${answered ? (ok ? 'right' : 'wrong') : ''}"
        type="text" inputmode="latin" autocapitalize="off" autocorrect="off"
        autocomplete="off" spellcheck="false" enterkeyhint="done"
        placeholder="在这里拼出单词" ${answered ? 'disabled' : ''}
        value="${esc(answered ? typed : '')}">
      ${answered
        ? `<button class="btn primary block lg mt14" data-act="cont">${ok ? '下一个' : '继续'}</button>`
        : `<button class="btn primary block lg mt14" data-act="spell-submit">提交</button>
           <button class="btn ghost block mt8" data-act="spell-giveup">想不起来，看答案</button>`}
    </div>
    ${answered ? `<div class="feedback ${ok ? 'good' : 'err'}">${ok ? '拼对了' : '正确的写法见上方'}</div>` : ''}
  `;
}

function applyAnswer(item, res) {
  const now = Date.now();
  const key = item.key;
  const prev = state.prog[key] || null;
  const isNew = !prev;
  state.prog[key] = schedule(prev, res, now);

  const dk = dayKey(now);
  const d = state.daily[dk] || (state.daily[dk] = { newN: 0, revN: 0, okN: 0, totalN: 0 });
  if (isNew) d.newN = (d.newN || 0) + 1;
  else d.revN = (d.revN || 0) + 1;
  d.totalN = (d.totalN || 0) + 1;
  if (res === 'know') d.okN = (d.okN || 0) + 1;

  session.stats[res] = (session.stats[res] || 0) + 1;
  session.stats.total++;
  save();
}

/** 不认识 → 本轮里过几个就再来一次 */
function requeue(item) {
  const at = Math.min(session.items.length, session.i + 1 + Math.min(6, session.items.length - session.i - 1));
  session.items.splice(at, 0, { ...item, requeued: true });
}

function advance() {
  session.i++;
  session.phase = 'q';
  session.revealed = false;
  session.lastResult = null;
  session.choiceIdx = null;
  session.userInput = null;
  render();
}

function renderSummary(main) {
  const st = session.stats;
  const acc = st.total ? Math.round((st.total - st.forgot - st.fuzzy) / st.total * 100) : 0;
  setHeader('一轮完成', `${st.total} 个词`);
  main.innerHTML = `
    <div class="card center" style="padding:30px 20px">
      <div style="font-size:40px;line-height:1">${acc >= 80 ? '🎉' : acc >= 50 ? '💪' : '🌱'}</div>
      <h2 style="margin:14px 0 4px;font-size:22px">本轮 ${st.total} 个词</h2>
      <p class="muted small" style="margin:0">正确率 ${acc}%</p>
    </div>
    <div class="stat-grid">
      <div class="stat"><div class="v" style="color:var(--ok)">${st.know}</div><div class="k">认识</div></div>
      <div class="stat"><div class="v" style="color:var(--warn)">${st.fuzzy}</div><div class="k">模糊</div></div>
      <div class="stat"><div class="v" style="color:var(--bad)">${st.forgot}</div><div class="k">不认识</div></div>
      <div class="stat"><div class="v">${Math.max(1, Math.round((Date.now() - session.startedAt) / 60000))}<span class="small dim">分</span></div><div class="k">用时</div></div>
    </div>
    <button class="btn primary block lg" data-act="again">再来一轮</button>
    <button class="btn ghost block" data-act="tab" data-tab="study">回首页</button>
  `;
}

function endSession() {
  if (!session) return;
  if (session.stats.total > 0 && session.i < session.items.length) {
    modalConfirm({
      title: '结束这一轮？',
      body: '已经答的会照常记入进度，没答的留到下次。',
      ok: '结束',
    }).then((yes) => {
      if (yes) { session = null; render(); }
    });
    return;
  }
  session = null;
  render();
}

/* ---------------- 词库页 ---------------- */

function renderBooks(main) {
  setHeader('词库', `${state.books.length} 个词库 · ${state.words.length} 个词`);
  const rows = state.books.map((b) => {
    const ws = wordsOfBook(b.id);
    const seen = new Set();
    let mastered = 0;
    for (const w of ws) {
      const k = wordKey(w.word);
      const p = state.prog[k];
      if (p && (p.stage || 0) >= MASTER_STAGE) mastered++;
      seen.add(k);
    }
    return `
      <div class="item">
        <div class="grow" data-act="open-book" data-id="${b.id}" style="cursor:pointer">
          <div class="name">${esc(b.name)}</div>
          <div class="meta">${ws.length} 词 · 掌握 ${mastered}</div>
        </div>
        <button class="switch ${b.on !== false ? 'on' : ''}" data-act="book-toggle" data-id="${b.id}"
          aria-label="参与复习"></button>
        <button class="btn ghost small" style="padding:7px 10px" data-act="open-book" data-id="${b.id}">›</button>
      </div>`;
  }).join('');

  main.innerHTML = `
    <button class="btn primary block lg" data-act="new-book">＋ 新建词库</button>
    <div class="card">
      <div class="row" style="margin-bottom:4px">
        <div class="grow">
          <div class="row-label">参与复习的词库</div>
          <div class="row-hint">关掉的词库不进入每日队列</div>
        </div>
      </div>
      ${state.books.length ? `<div class="list">${rows}</div>` : `<div class="empty">还没有词库，先新建一个</div>`}
    </div>
    <div class="card tight">
      <div class="row">
        <div class="grow"><div class="row-label">合并复习</div>
        <div class="row-hint">打开多个词库时，复习队列自动合并</div></div>
      </div>
    </div>
  `;
}

function renderBook(main) {
  const b = bookById(currentBookId);
  if (!b) { view = 'books'; render(); return; }
  const ws = wordsOfBook(b.id);
  setHeader(b.name, `${ws.length} 个词`);

  const shown = ws.slice(0, 200);
  const list = shown.map((w) => {
    const p = state.prog[wordKey(w.word)];
    const stage = p ? p.stage || 0 : 0;
    const label = !p ? '未学' : stage >= MASTER_STAGE ? '已掌握' : `第 ${stage} 阶`;
    return `<div class="item" data-act="word-info" data-id="${w.id}" data-key="${esc(wordKey(w.word))}" style="cursor:pointer">
      <div class="grow" style="min-width:0">
        <div class="name">${esc(w.word)} ${w.pos ? `<span class="dim tiny">${esc(displayPos(w.pos))}</span>` : ''}</div>
        <div class="meta" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w.meaning)}</div>
      </div>
      <span class="chip ${!p ? '' : stage >= MASTER_STAGE ? 'ok' : 'accent'}">${label}</span>
    </div>`;
  }).join('');

  main.innerHTML = `
    <div class="card">
      <div class="sec-title" style="margin-top:0">粘贴导入</div>
      <p class="row-hint mb" style="margin:6px 0 10px">一行一个词，格式随意：
        <span class="dim" style="font-family:ui-monospace,Menlo,monospace">abandon v. 放弃，抛弃</span>
        或 <span class="dim" style="font-family:ui-monospace,Menlo,monospace">abandon 放弃</span>
      </p>
      <textarea class="paste" id="importText" placeholder="abandon v. 放弃，抛弃&#10;ability n. 能力&#10;absolute adj. 绝对的&#10;..."></textarea>
      <button class="btn primary block mt14" data-act="import-run">导入到「${esc(b.name)}」</button>
      <div id="importReport" class="mt14">${lastImportReport || ''}</div>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:2px">
        <div class="grow"><div class="row-label">词表</div>
        <div class="row-hint">${ws.length > 200 ? `只显示前 200 个，共 ${ws.length}` : `共 ${ws.length} 个`}</div></div>
      </div>
      ${ws.length ? `<div class="list">${list}</div>` : `<div class="empty">还没有单词</div>`}
    </div>

    <div class="card">
      <div class="row">
        <div class="grow"><div class="row-label">词库设置</div></div>
      </div>
      <button class="btn ghost block mt14" data-act="book-rename" data-id="${b.id}">重命名</button>
      <button class="btn bad block mt8" data-act="book-del" data-id="${b.id}">删除这个词库</button>
    </div>
  `;

  const ta = $('#importText');
  if (ta && lastImportDraft) ta.value = lastImportDraft;
}

let lastImportDraft = '';

function runImport() {
  const b = bookById(currentBookId);
  if (!b) return;
  const ta = $('#importText');
  const text = ta ? ta.value : '';
  lastImportDraft = text;
  if (!text.trim()) { toast('先把单词粘进来'); return; }

  const existing = new Set(wordsOfBook(b.id).map((w) => wordKey(w.word)));
  const res = parseImport(text, { existingWords: existing });

  if (!res.items.length && !res.problems.length) { toast('没读到任何单词'); return; }

  const now = Date.now();
  for (const it of res.items) {
    state.words.push({
      id: uid('w'),
      bookId: b.id,
      word: it.word,
      pos: it.pos,
      meaning: it.meaning,
      phonetic: it.phonetic,
      createdAt: now,
    });
  }
  save(true);

  const problems = res.problems.slice(0, 30).map((p) =>
    `<div><span class="bad-line">第 ${p.line} 行</span> ${esc(p.reason)} — <span class="dim">${esc(p.text.slice(0, 40))}</span></div>`
  ).join('');

  lastImportReport = `
    <div class="report">
      <div><b>导入 ${res.items.length} 个</b></div>
      ${res.dupInFile ? `<div class="dim">跳过重复（同一份里）${res.dupInFile} 个</div>` : ''}
      ${res.dupExisting ? `<div class="dim">跳过已存在 ${res.dupExisting} 个</div>` : ''}
      ${res.problems.length ? `<div style="margin-top:6px;color:var(--bad)">有问题 ${res.problems.length} 行：</div>${problems}
        ${res.problems.length > 30 ? `<div class="dim">还有 ${res.problems.length - 30} 行没显示</div>` : ''}` : ''}
    </div>`;

  lastImportDraft = '';
  const rep = $('#importReport');
  if (rep) rep.innerHTML = lastImportReport;
  if (ta) ta.value = '';
  toast(`导入 ${res.items.length} 个词`);
  if (res.items.length) render();
}

/* ---------------- 统计页 ---------------- */

function renderStats(main) {
  const s = summarize(state);
  const t = s.today;
  setHeader('统计', `${s.total} 个词`);

  // 近 8 周热力图
  const cells = [];
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 55);
  for (let i = 0; i < 56; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const k = dayKey(d.getTime());
    const rec = state.daily[k];
    const n = rec ? (rec.totalN || 0) : 0;
    const lvl = n >= 40 ? 'l3' : n >= 15 ? 'l2' : n > 0 ? 'l1' : '';
    const future = d.getTime() > Date.now() ? ' future' : '';
    cells.push(`<i class="${lvl}${future}" title="${k} · ${n} 次"></i>`);
  }

  const bookRows = state.books.map((b) => {
    const ws = wordsOfBook(b.id);
    const keys = new Set(ws.map((w) => wordKey(w.word)));
    let m = 0, learned = 0;
    for (const k of keys) {
      const p = state.prog[k];
      if (!p) continue;
      learned++;
      if ((p.stage || 0) >= MASTER_STAGE) m++;
    }
    const pct = keys.size ? Math.round((m / keys.size) * 100) : 0;
    return `<div class="item" style="display:block">
      <div class="row" style="margin:0">
        <div class="grow"><div class="name" style="font-size:14.5px">${esc(b.name)}</div>
        <div class="meta">${keys.size} 词 · 学过 ${learned} · 掌握 ${m}</div></div>
        <span class="chip ${pct >= 60 ? 'ok' : 'accent'}">${pct}%</span>
      </div>
      <div class="bar" style="margin-top:9px"><i style="width:${pct}%"></i></div>
    </div>`;
  }).join('');

  const recent = Object.entries(state.prog)
    .sort((a, b) => (b[1].lastAt || 0) - (a[1].lastAt || 0))
    .slice(0, 8);

  const wordIndex = new Map();
  for (const w of state.words) {
    const k = wordKey(w.word);
    if (!wordIndex.has(k)) wordIndex.set(k, w);
  }

  const recentRows = recent.map(([k, p]) => {
    const w = wordIndex.get(k);
    const name = w ? w.word : k;
    const stage = p.stage || 0;
    return `<div class="item">
      <div class="grow" style="min-width:0">
        <div class="name" style="font-size:14.5px">${esc(name)}</div>
        <div class="meta">${w ? esc(w.meaning.slice(0, 22)) : ''} · ${relDue(p.due || 0)}</div>
      </div>
      <span class="chip ${stage >= MASTER_STAGE ? 'ok' : ''}">${stage >= MASTER_STAGE ? '已掌握' : `第 ${stage} 阶`}</span>
    </div>`;
  }).join('');

  main.innerHTML = `
    <div class="stat-grid">
      <div class="stat"><div class="v">${s.streak}</div><div class="k">天连续打卡</div></div>
      <div class="stat"><div class="v">${t.acc}<span class="small dim">%</span></div><div class="k">今日正确率</div></div>
      <div class="stat"><div class="v">${t.totalN}</div><div class="k">今日学了几次</div></div>
      <div class="stat"><div class="v">${s.masteredPct}<span class="small dim">%</span></div><div class="k">掌握 ${s.mastered}/${s.total}</div></div>
    </div>

    <div class="card">
      <div class="sec-title" style="margin-top:0">最近 8 周</div>
      <div class="cal mt14">${cells.join('')}</div>
      <div class="row" style="margin-top:10px">
        <span class="dim tiny">浅 = 少　深 = 多</span>
        <span class="dim tiny">学习天数 ${Object.keys(state.daily).filter((k) => (state.daily[k].totalN || 0) > 0).length} 天</span>
      </div>
    </div>

    <div class="card">
      <div class="sec-title" style="margin-top:0">进度分布</div>
      <div class="row" style="margin-top:10px">
        <span class="small">未学 <b>${s.fresh}</b></span>
        <span class="small">学习中 <b>${s.learning}</b></span>
        <span class="small">已掌握 <b>${s.mastered}</b></span>
      </div>
      <div class="bar" style="margin-top:10px;height:10px">
        <i style="width:${s.masteredPct}%"></i>
      </div>
    </div>

    ${bookRows ? `<div class="card"><div class="sec-title" style="margin-top:0">按词库</div><div class="list">${bookRows}</div></div>` : ''}

    ${recentRows ? `<div class="card"><div class="sec-title" style="margin-top:0">最近学过</div><div class="list">${recentRows}</div></div>` : ''}
  `;
}

/* ---------------- 设置页 ---------------- */

function renderSettings(main) {
  setHeader('设置', `v${APP_VERSION}`);
  const st = state.settings;

  main.innerHTML = `
    <div class="card">
      <div class="sec-title" style="margin-top:0">每日限额</div>
      <div class="row mt14">
        <div class="grow"><div class="row-label">新词上限</div>
        <div class="row-hint">每天最多学几个新词</div></div>
        <input class="num-input" type="number" min="0" max="200" id="setNew" value="${st.newPerDay}">
      </div>
      <div class="row">
        <div class="grow"><div class="row-label">复习上限</div>
        <div class="row-hint">超出的积压会顺延到明天</div></div>
        <input class="num-input" type="number" min="0" max="2000" id="setReview" value="${st.reviewPerDay}">
      </div>
    </div>

    <div class="card">
      <div class="sec-title" style="margin-top:0">考察形式</div>
      <div class="row mt14">
        <div class="grow"><div class="row-label">递进方式</div>
        <div class="row-hint">默认：新词先自评 → 熟了变四选一 → 再熟变拼写</div></div>
      </div>
      <div class="options mt14">
        ${['auto', 'card', 'choice', 'spell'].map((m) => {
          const label = { auto: '自动递进（推荐）', card: '只做卡片自评', choice: '只做英译中四选一', spell: '只做中文回想拼写' }[m];
          const on = (st.mode || 'auto') === m;
          return `<button class="opt ${on ? 'right' : ''}" data-act="set-mode" data-mode="${m}">
            <span class="key">${on ? '✓' : ''}</span><span>${label}</span></button>`;
        }).join('')}
      </div>
    </div>

    <div class="card">
      <div class="sec-title" style="margin-top:0">数据备份</div>
      <p class="row-hint" style="margin:8px 0 14px">
        数据只存在这台手机里。换手机、清缓存前请导出备份（可以存到 iCloud 或网盘），新手机用「导入」恢复。
      </p>
      <div class="row">
        <div class="grow"><div class="row-label">上次备份</div>
        <div class="row-hint">${fmtDate(state.lastExport)}</div></div>
      </div>
      <button class="btn primary block mt14" data-act="export">导出一份备份</button>
      <button class="btn block mt8" data-act="import-file">从备份文件恢复</button>
      <input type="file" id="fileInput" accept=".json,application/json" hidden>
    </div>

    <div class="card">
      <div class="sec-title" style="margin-top:0">危险操作</div>
      <button class="btn bad block mt14" data-act="clear-all">清空所有数据</button>
      <p class="row-hint" style="margin-top:10px">会删掉全部词库、进度和统计，不可撤销。</p>
    </div>

    <div class="card tight">
      <div class="row">
        <div class="grow"><div class="row-label">离线可用</div>
        <div class="row-hint">${'serviceWorker' in navigator ? '已开启，断网也能背' : '这个浏览器不支持离线缓存'}</div></div>
      </div>
      <div class="row">
        <div class="grow"><div class="row-label">加到主屏</div>
        <div class="row-hint">分享 → 添加到主屏幕，像 App 一样打开</div></div>
      </div>
      <div class="row">
        <div class="grow"><div class="row-label">版本</div>
        <div class="row-hint">v${APP_VERSION} · 间隔阶梯 ${LADDER.join('/')} 天</div></div>
      </div>
    </div>
  `;

  const bind = (id, key, min, max) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
      let v = parseInt(el.value, 10);
      if (!Number.isFinite(v)) v = min;
      v = Math.max(min, Math.min(max, v));
      el.value = v;
      state.settings[key] = v;
      save();
      toast('已保存');
    });
  };
  bind('#setNew', 'newPerDay', 0, 200);
  bind('#setReview', 'reviewPerDay', 0, 2000);
}

/* ---------------- 导入导出 ---------------- */

function exportBackup() {
  const data = JSON.stringify(state, null, 0);
  const stamp = dayKey().replace(/-/g, '');
  const name = `背单词备份-${stamp}.json`;
  const blob = new Blob([data], { type: 'application/json' });

  const finish = () => {
    state.lastExport = Date.now();
    save(true);
    render();
    toast('已导出备份');
  };

  if (navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: 'application/json' })] })) {
    navigator.share({
      files: [new File([blob], name, { type: 'application/json' })],
      title: name,
    }).then(finish).catch(() => fallbackDownload(blob, name, finish));
  } else {
    fallbackDownload(blob, name, finish);
  }
}

function fallbackDownload(blob, name, done) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (done) done();
  }, 300);
}

async function importBackupFile(file) {
  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (e) {
    toast('文件读不出来，可能不是备份文件');
    return;
  }
  if (!parsed || !Array.isArray(parsed.words) || !Array.isArray(parsed.books)) {
    toast('这个文件不像是本应用的备份');
    return;
  }
  const choice = await showModal({
    title: '怎么恢复？',
    body: `备份里有 ${parsed.books.length} 个词库、${parsed.words.length} 个词。\n\n合并：保留现在的，把备份里的加进来\n替换：完全变成备份里的内容（现在的会没）`,
    ok: '合并进来',
    alt: '替换覆盖',
  });
  if (!choice) return;
  if (choice === 'alt') {
    state = Object.assign(blankState(), parsed);
    state.settings = Object.assign({ newPerDay: 20, reviewPerDay: 200, mode: 'auto' }, parsed.settings || {});
    toast('已恢复到备份内容');
  } else {
    state = mergeStates(state, parsed);
    toast('已合并');
  }
  save(true);
  render();
}

/* ---------------- 新建词库 / 示例 ---------------- */

async function newBook() {
  const name = await showModal({
    title: '新建词库',
    body: '起个名字，比如「考研 Unit 1-10」',
    input: `词库 ${state.books.length + 1}`,
    ok: '建好了',
  });
  if (!name) return;
  const clean = String(name).trim().slice(0, 30);
  if (!clean) { toast('名字不能为空'); return; }
  const b = { id: uid('b'), name: clean, on: true, createdAt: Date.now() };
  state.books.push(b);
  save(true);
  currentBookId = b.id;
  view = 'book';
  render();
  toast('建好了，往下粘单词吧');
}

const DEMO = [
  'abandon v. 放弃，抛弃',
  'ability n. 能力，才能',
  'absolute adj. 绝对的，完全的',
  'absorb v. 吸收，吸引',
  'abstract adj. 抽象的',
  'accompany v. 陪伴，伴随',
  'accomplish v. 完成，实现',
  'accurate adj. 准确的，精确的',
  'achieve v. 达到，取得',
  'acquire v. 获得，学到',
  'adapt v. 适应，改编',
  'adequate adj. 足够的，适当的',
  'admire v. 钦佩，欣赏',
  'adopt v. 采用，收养',
  'advance v. 前进，发展',
  'afford v. 买得起，承担得起',
  'aggressive adj. 好斗的，积极的',
  'alter v. 改变，更改',
  'ambitious adj. 有雄心的',
  'analyze v. 分析',
];

function loadDemo() {
  const b = { id: uid('b'), name: '示例词库', on: true, createdAt: Date.now() };
  state.books.push(b);
  const res = parseImport(DEMO.join('\n'), { existingWords: new Set() });
  const now = Date.now();
  for (const it of res.items) {
    state.words.push({
      id: uid('w'), bookId: b.id, word: it.word, pos: it.pos,
      meaning: it.meaning, phonetic: it.phonetic, createdAt: now,
    });
  }
  save(true);
  render();
  toast(`加了 ${res.items.length} 个示例词`);
}

/* ---------------- 事件 ---------------- */

document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('#tabbar button');
  if (tabBtn) {
    view = tabBtn.dataset.tab;
    render();
    return;
  }

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case 'tab':
      view = el.dataset.tab || 'study';
      session = null;
      render();
      break;

    case 'start':
      startSession();
      break;

    case 'reveal':
      if (session && session.phase === 'q') {
        session.revealed = true;
        render();
      }
      break;

    case 'rate': {
      if (!session || session.phase !== 'q') break;
      const item = currentItem();
      const res = el.dataset.res;
      session.phase = 'a';
      applyAnswer(item, res);
      if (res === 'forgot') requeue(item);
      advance();
      break;
    }

    case 'opt': {
      if (!session || session.phase !== 'q') break;
      const item = currentItem();
      const idx = parseInt(el.dataset.idx, 10);
      if (!item.options) break;
      const correct = item.options[idx] === item.meaning;
      session.phase = 'a';
      session.choiceIdx = idx;
      session.lastResult = correct ? 'right' : 'wrong';
      applyAnswer(item, correct ? 'know' : 'forgot');
      if (!correct) requeue(item);
      render();
      setTimeout(() => { if (session && session.phase === 'a') advance(); }, correct ? 700 : 1500);
      break;
    }

    case 'spell-submit': {
      if (!session || session.phase !== 'q') break;
      const item = currentItem();
      const inp = $('#spellInput');
      const val = inp ? inp.value : '';
      if (!val.trim()) { toast('先拼一下试试'); return; }
      const ok = checkSpelling(val, item.word);
      session.phase = 'a';
      session.userInput = val;
      session.lastResult = ok ? 'right' : 'wrong';
      applyAnswer(item, ok ? 'know' : 'forgot');
      if (!ok) requeue(item);
      render();
      if (ok) setTimeout(() => { if (session && session.phase === 'a') advance(); }, 800);
      break;
    }

    case 'spell-giveup': {
      if (!session || session.phase !== 'q') break;
      const item = currentItem();
      session.phase = 'a';
      session.userInput = '';
      session.lastResult = 'wrong';
      applyAnswer(item, 'forgot');
      requeue(item);
      render();
      break;
    }

    case 'cont':
      if (session && session.phase === 'a') advance();
      break;

    case 'end-session':
      endSession();
      break;

    case 'again':
      session = null;
      startSession();
      break;

    case 'new-book':
      newBook();
      break;

    case 'demo':
      loadDemo();
      break;

    case 'open-book':
      currentBookId = el.dataset.id;
      lastImportReport = null;
      lastImportDraft = '';
      view = 'book';
      render();
      break;

    case 'book-toggle': {
      const b = bookById(el.dataset.id);
      if (!b) break;
      const onCount = state.books.filter((x) => x.on !== false).length;
      if (b.on !== false && onCount <= 1) { toast('至少留一个词库参与复习'); break; }
      b.on = b.on === false;
      save();
      render();
      break;
    }

    case 'book-rename': {
      const b = bookById(el.dataset.id);
      if (!b) break;
      const name = await showModal({ title: '重命名', input: b.name, ok: '保存' });
      if (!name) break;
      const clean = String(name).trim().slice(0, 30);
      if (!clean) { toast('名字不能为空'); break; }
      b.name = clean;
      save(true);
      render();
      break;
    }

    case 'book-del': {
      const b = bookById(el.dataset.id);
      if (!b) break;
      const n = wordsOfBook(b.id).length;
      const yes = await modalConfirm({
        title: `删除「${b.name}」？`,
        body: `会删掉这个词库和里面的 ${n} 个词。其他词库的进度不受影响。`,
        ok: '删除', danger: true,
      });
      if (!yes) break;
      state.books = state.books.filter((x) => x.id !== b.id);
      state.words = state.words.filter((w) => w.bookId !== b.id);
      save(true);
      view = 'books';
      currentBookId = null;
      render();
      toast('已删除');
      break;
    }

    case 'import-run':
      runImport();
      break;

    case 'word-info': {
      const w = state.words.find((x) => x.id === el.dataset.id);
      if (!w) break;
      const p = state.prog[el.dataset.key];
      const lines = [];
      if (!p) {
        lines.push('还没学过。');
      } else {
        const days = Math.max(1, Math.round((p.interval || 0) / DAY));
        lines.push(`阶段：第 ${p.stage || 0} 阶（下次间隔约 ${days} 天）`);
        lines.push(`复习了 ${p.reps || 0} 次，忘记 ${p.lapses || 0} 次`);
        lines.push(`下次到期：${relDue(p.due || 0)}（${fmtDate(p.due)}）`);
        lines.push(`熟练系数：${p.ease || 2.5}`);
        if (p.firstAt) lines.push(`第一次学：${fmtDate(p.firstAt)}`);
      }
      await showModal({
        title: w.word + (w.pos ? '  ' + displayPos(w.pos) : ''),
        body: `${w.meaning}${w.phonetic ? '\n' + w.phonetic : ''}\n\n${lines.join('\n')}`,
        ok: '好',
        cancel: '关闭',
      });
      break;
    }

    case 'set-mode':
      state.settings.mode = el.dataset.mode;
      save(true);
      render();
      toast('已切换');
      break;

    case 'export':
      exportBackup();
      break;

    case 'import-file': {
      const fi = $('#fileInput');
      if (fi) fi.click();
      break;
    }

    case 'clear-all': {
      const yes = await modalConfirm({
        title: '清空所有数据？',
        body: '全部词库、进度、统计都会消失，无法撤销。\n如果还没备份，先点取消去备份。',
        ok: '确认清空', danger: true,
      });
      if (!yes) break;
      const yes2 = await modalConfirm({
        title: '真的清空？',
        body: '最后一次确认。',
        ok: '清空', danger: true,
      });
      if (!yes2) break;
      state = blankState();
      save(true);
      session = null;
      view = 'study';
      render();
      toast('已清空');
      break;
    }
  }
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'fileInput') {
    const f = e.target.files && e.target.files[0];
    if (f) importBackupFile(f);
    e.target.value = '';
  }
});

document.addEventListener('keydown', (e) => {
  if (!session || session.phase !== 'q') return;

  // 四选一：按 1-4
  if (currentItem() && currentItem().mode === 'choice' && /^[1-4]$/.test(e.key)) {
    const btn = document.querySelector(`.opt[data-idx="${parseInt(e.key, 10) - 1}"]`);
    if (btn) btn.click();
  }
  // 卡片：空格看释义
  if (currentItem() && currentItem().mode === 'card' && e.code === 'Space') {
    e.preventDefault();
    if (!session.revealed) { session.revealed = true; render(); }
  }
  // 拼写：回车提交
  if (currentItem() && currentItem().mode === 'spell' && e.key === 'Enter') {
    const btn = document.querySelector('[data-act="spell-submit"]');
    if (btn) btn.click();
  }
});

/* ---------------- 启动 ---------------- */

function boot() {
  load();

  if ('storage' in navigator && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW 注册失败', e));
    });
  }

  // 从后台回来时刷新（跨天了要换队列）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (session && session.phase === 'q') { /* 保持不动，别打断 */ }
      else render();
    }
  });
}

boot();

window.__wm = { get state() { return state; }, get session() { return session; } };
