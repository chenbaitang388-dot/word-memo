/* ============================================================
   core.js —— 纯逻辑层，不碰 DOM、不碰 localStorage
   （便于用 node 直接跑单元测试）
   ============================================================ */

export const DAY = 86400000;
export const MIN10 = 600000;
export const LADDER = [1, 3, 7, 15, 30]; // 认识 → 1/3/7/15/30 天
export const MASTER_STAGE = 4;           // stage>=4（间隔≥15天）算掌握

/* ---------------- 通用小工具 ---------------- */

/** 只把全角字母/数字转成半角；中文标点（，。；：）保持原样 */
export function toHalfWidth(str) {
  return String(str)
    .replace(/[\uFF21-\uFF3A\uFF41-\uFF5A\uFF10-\uFF19]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ');
}

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

export function wordKey(word) {
  return String(word).trim().toLowerCase().replace(/\s+/g, ' ');
}

export function uid(prefix = 'w') {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/* ---------------- 词性 ---------------- */

const POS_WORDS = ['v', 'n', 'adj', 'adv', 'prep', 'conj', 'pron', 'num',
  'art', 'int', 'vt', 'vi', 'aux', 'abbr', 'pl', 'phr', 'det', 'modal'];
const POS_ALT = POS_WORDS.slice().sort((a, b) => b.length - a.length).join('|');
// 允许 "n." "n./v." "adj./adv." "n. v." 这类连写
const POS_HEAD_RE = new RegExp('^(?:(?:' + POS_ALT + ')\\s*\\.\\s*[\\/、,，|｜]?\\s*)+', 'i');
const POS_FIND_RE = new RegExp('(^|[\\s,，;；])(' + POS_ALT + ')\\s*\\.', 'i');
const PHONETIC_RE = /(\/[^/\n]{1,48}\/|\[[^\]\n]{1,48}\]|（[a-z:/ˈˌ\.\s]{1,40}）)/i;

/** "n./v." 这种 → "n/v"；显示时再补句点 */
function normalizePos(raw) {
  return String(raw)
    .split(/\s+/)
    .map((t) => t.replace(/\./g, '').trim().toLowerCase())
    .filter(Boolean)
    .join('/');
}

export function displayPos(pos) {
  if (!pos) return '';
  return String(pos).split('/').filter(Boolean).map((t) => t + '.').join(' ');
}

/* ---------------- 导入解析 ---------------- */

const WORD_RE = /^[A-Za-z][A-Za-z'’\-]*(?:[ \-][A-Za-z'’\-]+)*$/;

/**
 * 解析一行。成功返回 {word,pos,meaning,phonetic}，失败返回 {error}
 * 支持的写法：
 *   abandon v. 放弃，抛弃
 *   abandon 放弃，抛弃
 *   abandon /əˈbændən/ v. 放弃
 *   give up v. 放弃
 *   1. abandon n. 放任
 *   record n. 记录 v. 录下
 */
export function parseLine(rawLine) {
  let t = toHalfWidth(String(rawLine)).replace(/\u00a0/g, ' ');
  t = t.trim();
  if (!t) return { skipped: true };

  // 去掉行首序号 / 项目符号
  t = t.replace(/^\s*(?:\d+\s*[.)、:：]|[-–—•*·●○])\s+/, '').trim();
  if (!t) return { skipped: true };

  // 找词性标记
  let head = null;
  let tail = null;
  const m = POS_FIND_RE.exec(t);
  if (m) {
    const idx = m.index + m[1].length;
    head = t.slice(0, idx).trim();
    tail = t.slice(idx).trim();
  }

  let phonetic = '';

  if (head !== null) {
    const ph = PHONETIC_RE.exec(head);
    if (ph) {
      phonetic = ph[1].trim();
      head = (head.slice(0, ph.index) + head.slice(ph.index + ph[1].length)).trim();
    }
  } else {
    // 没有词性：先试音标切分，再退回"第一个词"
    const ph = PHONETIC_RE.exec(t);
    if (ph) {
      head = t.slice(0, ph.index).trim();
      phonetic = ph[1].trim();
      tail = t.slice(ph.index + ph[1].length).trim();
    } else {
      const sp = t.search(/\s/);
      if (sp === -1) {
        if (!/[A-Za-z]/.test(t)) return { error: '没找到英文单词' };
        return { error: '缺少中文释义' };
      }
      head = t.slice(0, sp).trim();
      tail = t.slice(sp).trim();
    }
  }

  head = head.replace(/[,，;；:：]+$/, '').trim();
  let pos = '';
  if (tail) {
    const pm = POS_HEAD_RE.exec(tail);
    if (pm) {
      pos = normalizePos(pm[0]);
      tail = tail.slice(pm[0].length);
    }
  }

  let meaning = String(tail || '')
    .replace(/^[\s,，;；:：\-–—=]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!head) return { error: '没找到英文单词' };
  if (!WORD_RE.test(head)) {
    if (!/[A-Za-z]/.test(head)) return { error: '没找到英文单词' };
    if (/[\u4e00-\u9fa5]/.test(head)) return { error: '单词位置出现了中文' };
    head = head.replace(/[^A-Za-z'’\- ]/g, '').trim();
    if (!WORD_RE.test(head)) return { error: '单词格式不认识' };
  }
  if (head.length > 48) return { error: '单词太长（超过 48 字符）' };
  if (!meaning) return { error: '缺少中文释义' };
  if (!/[\u4e00-\u9fa5]/.test(meaning) && !/[A-Za-z]{2}/.test(meaning)) {
    return { error: '缺少中文释义' };
  }

  return {
    word: head,
    pos,
    meaning,
    phonetic,
  };
}

/**
 * 批量解析
 * @param {string} text 粘贴的多行文本
 * @param {object} opts {existingWords:Set<string>} 目标词库里已有的词（小写）
 */
export function parseImport(text, opts = {}) {
  const existing = opts.existingWords || new Set();
  const lines = String(text).split(/\r?\n/);
  const items = [];
  const problems = [];
  const seen = new Map(); // wordKey -> 行号
  let dupInFile = 0;
  let dupExisting = 0;
  let skippedEmpty = 0;

  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const r = parseLine(raw);
    if (r.skipped) { skippedEmpty++; return; }
    if (r.error) {
      if (String(raw).trim()) problems.push({ line: lineNo, text: String(raw).trim(), reason: r.error });
      return;
    }
    const key = wordKey(r.word);
    if (seen.has(key)) { dupInFile++; return; }
    if (existing.has(key)) { dupExisting++; return; }
    seen.set(key, lineNo);
    items.push({ ...r, lineNo });
  });

  return { items, problems, dupInFile, dupExisting, skippedEmpty, totalLines: lines.length };
}

/* ---------------- 记忆调度（SM-2 简化版） ---------------- */

/**
 * @param prev 旧进度（可为 null）
 * @param res  'know' | 'fuzzy' | 'forgot'
 * @param now
 */
export function schedule(prev, res, now = Date.now()) {
  const ease0 = prev && typeof prev.ease === 'number' ? prev.ease : 2.5;
  const stage0 = prev && typeof prev.stage === 'number' ? prev.stage : 0;
  const interval0 = prev && typeof prev.interval === 'number' ? prev.interval : 0;

  let stage = stage0;
  let ease = ease0;
  let interval = interval0;

  if (res === 'forgot') {
    stage = 0;
    ease = Math.max(1.3, +(ease0 - 0.2).toFixed(2));
    interval = MIN10;
  } else if (res === 'fuzzy') {
    stage = Math.max(1, stage0);
    ease = Math.max(1.3, +(ease0 - 0.15).toFixed(2));
    interval = DAY;
  } else {
    stage = stage0 + 1;
    if (stage <= LADDER.length) {
      interval = LADDER[stage - 1] * DAY;
    } else {
      interval = Math.round(Math.max(interval0, LADDER[LADDER.length - 1] * DAY) * ease0);
    }
    ease = Math.min(2.5, +(ease0 + 0.1).toFixed(2));
  }

  const hist = ((prev && prev.hist) || []).slice(-29);
  hist.push([now, res]);

  return {
    stage,
    ease,
    interval,
    due: now + interval,
    reps: ((prev && prev.reps) || 0) + 1,
    lapses: ((prev && prev.lapses) || 0) + (res === 'forgot' ? 1 : 0),
    last: res,
    lastAt: now,
    firstAt: (prev && prev.firstAt) || now,
    hist,
  };
}

export function modeFor(stage, setting = 'auto') {
  if (setting && setting !== 'auto') return setting;
  if (stage <= 1) return 'card';
  if (stage <= 3) return 'choice';
  return 'spell';
}

/* ---------------- 词库 / 队列 ---------------- */

export function studyWords(state) {
  const books = (state.books || []).filter((b) => b.on !== false);
  const on = new Set(books.map((b) => b.id));
  const bookName = new Map((state.books || []).map((b) => [b.id, b.name]));
  const out = [];
  for (const w of state.words || []) {
    if (!on.has(w.bookId)) continue;
    out.push({
      id: w.id,
      key: wordKey(w.word),
      word: w.word,
      pos: w.pos || '',
      meaning: w.meaning,
      phonetic: w.phonetic || '',
      bookId: w.bookId,
      bookName: bookName.get(w.bookId) || '',
    });
  }
  return out;
}

/**
 * 生成今日队列：积压复习优先，新词限额
 */
export function buildQueue(state, now = Date.now()) {
  const list = studyWords(state);
  const d = (state.daily || {})[dayKey(now)] || {};
  const newPerDay = Math.max(0, state.settings && state.settings.newPerDay != null ? state.settings.newPerDay : 20);
  const reviewPerDay = Math.max(0, state.settings && state.settings.reviewPerDay != null ? state.settings.reviewPerDay : 200);
  const newLeft = Math.max(0, newPerDay - (d.newN || 0));
  const revLeft = Math.max(0, reviewPerDay - (d.revN || 0));

  const due = [];
  const fresh = [];
  const seenKey = new Set();
  for (const w of list) {
    if (seenKey.has(w.key)) continue; // 同一个词出现在多个词库里，只取一次
    seenKey.add(w.key);
    const p = (state.prog || {})[w.key];
    if (!p) fresh.push(w);
    else if ((p.due || 0) <= now) due.push(w);
  }
  due.sort((a, b) => ((state.prog[a.key] || {}).due || 0) - ((state.prog[b.key] || {}).due || 0));

  return {
    reviews: due.slice(0, revLeft),
    news: fresh.slice(0, newLeft),
    dueTotal: due.length,
    newTotal: fresh.length,
    backlogReviews: Math.max(0, due.length - revLeft),
    backlogNews: Math.max(0, fresh.length - newLeft),
  };
}

/* ---------------- 出题 ---------------- */

function posTag(pos) {
  return String(pos || '').split('/')[0].trim().toLowerCase();
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export { shuffle };

/**
 * 英译中四选一。干扰项优先：同词性 + 长度接近 → 同词性 → 任意。
 * 干扰项的释义互不重复，且不等于正确答案。
 */
export function buildChoices(target, pool) {
  const answer = target.meaning;
  const byMeaning = new Map();
  for (const c of pool) {
    if (!c || !c.meaning) continue;
    if (wordKey(c.word) === wordKey(target.word)) continue;
    if (c.meaning === answer) continue;
    if (!byMeaning.has(c.meaning)) byMeaning.set(c.meaning, c);
  }
  const all = [...byMeaning.values()];
  const tp = posTag(target.pos);
  const tlen = target.word.length;

  const tier1 = all.filter((c) => tp && posTag(c.pos) === tp && Math.abs(c.word.length - tlen) <= 2);
  const tier2 = all.filter((c) => tp && posTag(c.pos) === tp);
  const tier3 = all;

  const picked = [];
  const used = new Set([answer]);
  const take = (arr) => {
    for (const c of shuffle(arr)) {
      if (picked.length >= 3) return;
      if (used.has(c.meaning)) continue;
      used.add(c.meaning);
      picked.push(c);
    }
  };
  take(tier1);
  take(tier2);
  take(tier3);

  return {
    options: shuffle([answer, ...picked.map((p) => p.meaning)]),
    count: picked.length,
    complete: picked.length === 3,
  };
}

/* ---------------- 拼写 ---------------- */

export function normalizeSpelling(s) {
  return toHalfWidth(String(s || ''))
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function checkSpelling(input, word) {
  return normalizeSpelling(input) === normalizeSpelling(word);
}

/** 提示：每个单词的首字母露出来，其余用 _ 占位。give up → "g _ _ _   u _" */
export function spellHint(word) {
  const w = String(word);
  return w.split('').map((c, i) => {
    if (/[\s\-']/.test(c)) return c;
    if (i === 0) return c;
    const prev = w[i - 1];
    if (prev === ' ' || prev === '-' || prev === "'") return c;
    return '_';
  }).join(' ');
}

/* ---------------- 统计 ---------------- */

export function calcStreak(daily, now = Date.now()) {
  const d = daily || {};
  let streak = 0;
  let cursor = now;
  // 今天没学，从昨天开始算（不打断连续）
  if (!d[dayKey(cursor)] || !(d[dayKey(cursor)].totalN > 0)) {
    cursor -= DAY;
  }
  for (let i = 0; i < 3650; i++) {
    const k = dayKey(cursor);
    const rec = d[k];
    if (rec && rec.totalN > 0) {
      streak++;
      cursor -= DAY;
    } else break;
  }
  return streak;
}

export function todayStats(daily, now = Date.now()) {
  const rec = (daily || {})[dayKey(now)] || { newN: 0, revN: 0, okN: 0, totalN: 0 };
  return {
    newN: rec.newN || 0,
    revN: rec.revN || 0,
    okN: rec.okN || 0,
    totalN: rec.totalN || 0,
    acc: rec.totalN ? Math.round((rec.okN / rec.totalN) * 100) : 0,
  };
}

export function summarize(state, now = Date.now()) {
  const list = studyWords(state);
  const seen = new Set();
  let total = 0, learning = 0, mastered = 0, fresh = 0;
  for (const w of list) {
    if (seen.has(w.key)) continue;
    seen.add(w.key);
    total++;
    const p = (state.prog || {})[w.key];
    if (!p) fresh++;
    else if ((p.stage || 0) >= MASTER_STAGE) mastered++;
    else learning++;
  }
  const q = buildQueue(state, now);
  return {
    total, fresh, learning, mastered,
    masteredPct: total ? Math.round((mastered / total) * 100) : 0,
    dueToday: q.dueTotal,
    newToday: q.newTotal,
    sessionSize: q.reviews.length + q.news.length,
    streak: calcStreak(state.daily, now),
    today: todayStats(state.daily, now),
  };
}

/* ---------------- 导入导出 ---------------- */

export function mergeStates(base, incoming) {
  const out = JSON.parse(JSON.stringify(base || {}));
  out.books = out.books || [];
  out.words = out.words || [];
  out.prog = out.prog || {};
  out.daily = out.daily || {};

  const bookByName = new Map(out.books.map((b) => [b.name, b]));
  const idMap = new Map();
  for (const b of incoming.books || []) {
    let target = bookByName.get(b.name);
    if (!target) {
      target = { ...b, id: uid('b') };
      out.books.push(target);
      bookByName.set(target.name, target);
    }
    idMap.set(b.id, target.id);
  }

  const haveWord = new Set(out.words.map((w) => (w.bookId || '') + '|' + wordKey(w.word)));
  for (const w of incoming.words || []) {
    const bookId = idMap.get(w.bookId) || w.bookId;
    const k = bookId + '|' + wordKey(w.word);
    if (haveWord.has(k)) continue;
    haveWord.add(k);
    out.words.push({ ...w, id: uid('w'), bookId });
  }

  for (const [k, p] of Object.entries(incoming.prog || {})) {
    if (!out.prog[k]) out.prog[k] = p;
    else {
      const a = out.prog[k], b = p;
      if ((b.reps || 0) > (a.reps || 0) || ((b.lastAt || 0) > (a.lastAt || 0))) out.prog[k] = b;
    }
  }

  for (const [k, v] of Object.entries(incoming.daily || {})) {
    const cur = out.daily[k];
    if (!cur) out.daily[k] = v;
    else {
      out.daily[k] = {
        newN: Math.max(cur.newN || 0, v.newN || 0),
        revN: Math.max(cur.revN || 0, v.revN || 0),
        okN: Math.max(cur.okN || 0, v.okN || 0),
        totalN: Math.max(cur.totalN || 0, v.totalN || 0),
      };
    }
  }
  return out;
}
