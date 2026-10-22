import assert from 'node:assert/strict';
import {
  parseLine, parseImport, schedule, buildQueue, buildChoices, modeFor,
  checkSpelling, spellHint, calcStreak, summarize, mergeStates, dayKey,
  DAY, MIN10, LADDER, wordKey, displayPos,
} from '../src/core.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function group(n) { console.log('\n' + n); }

/* ---------------- 解析 ---------------- */
group('导入解析');

t('标准写法：abandon v. 放弃，抛弃', () => {
  const r = parseLine('abandon v. 放弃，抛弃');
  assert.equal(r.word, 'abandon');
  assert.equal(r.pos, 'v');
  assert.equal(r.meaning, '放弃，抛弃');
});

t('无词性：abandon 放弃', () => {
  const r = parseLine('abandon 放弃，抛弃');
  assert.equal(r.word, 'abandon');
  assert.equal(r.pos, '');
  assert.equal(r.meaning, '放弃，抛弃');
});

t('带音标：abandon /əˈbændən/ v. 放弃', () => {
  const r = parseLine('abandon /əˈbændən/ v. 放弃');
  assert.equal(r.word, 'abandon');
  assert.equal(r.pos, 'v');
  assert.equal(r.meaning, '放弃');
  assert.ok(r.phonetic.includes('ˈbæn'));
});

t('带序号：12. abandon n. 放任', () => {
  const r = parseLine('12. abandon n. 放任');
  assert.equal(r.word, 'abandon');
  assert.equal(r.pos, 'n');
  assert.equal(r.meaning, '放任');
});

t('词组：give up v. 放弃', () => {
  const r = parseLine('give up v. 放弃');
  assert.equal(r.word, 'give up');
  assert.equal(r.meaning, '放弃');
});

t('一行两个词性：record n. 记录 v. 录下', () => {
  const r = parseLine('record n./v. 记录，录下');
  assert.equal(r.word, 'record');
  assert.equal(r.pos, 'n/v', 'pos=' + r.pos);
  assert.equal(displayPos(r.pos), 'n. v.');
});

t('adj./adv. 多词性连写', () => {
  const r = parseLine('fast adj./adv. 快的');
  assert.equal(r.word, 'fast');
  assert.equal(r.pos, 'adj/adv');
  assert.equal(r.meaning, '快的');
});

t('全角：ａｂａｎｄｏｎ v. 放弃', () => {
  const r = parseLine('ａｂａｎｄｏｎ v. 放弃');
  assert.equal(r.word, 'abandon');
});

t('连字符：well-known adj. 著名的', () => {
  const r = parseLine('well-known adj. 著名的');
  assert.equal(r.word, 'well-known');
});

t('空行跳过', () => {
  assert.equal(parseLine('   ').skipped, true);
  assert.equal(parseLine('').skipped, true);
});

t('只有单词 → 缺释义', () => {
  assert.equal(parseLine('abandon').error, '缺少中文释义');
});

t('纯中文 → 报错', () => {
  assert.ok(parseLine('放弃 抛弃').error);
});

t('纯数字 → 报错', () => {
  assert.ok(parseLine('12345').error);
});

t('有词性没释义 → 报错', () => {
  assert.equal(parseLine('abandon v.').error, '缺少中文释义');
});

t('批量：去重 + 报告问题行', () => {
  const r = parseImport(
    ['abandon v. 放弃', 'abandon n. 放任', 'apple n. 苹果', '', 'zzz', 'banana n. 香蕉'].join('\n'),
    { existingWords: new Set(['banana']) }
  );
  assert.equal(r.items.length, 2, JSON.stringify(r.items.map(i => i.word)));
  assert.equal(r.dupInFile, 1);
  assert.equal(r.dupExisting, 1);
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].line, 5);
});

/* ---------------- 调度 ---------------- */
group('记忆调度');

t('认识：1 → 3 → 7 → 15 → 30 天', () => {
  let p = null;
  const days = [];
  let now = 0;
  for (let i = 0; i < 5; i++) {
    p = schedule(p, 'know', now);
    days.push(Math.round(p.interval / DAY));
  }
  assert.deepEqual(days, LADDER);
});

t('不认识：10 分钟后，stage 归零，ease 下降', () => {
  let p = schedule(null, 'know', 0);
  p = schedule(p, 'know', 0);
  assert.equal(p.stage, 2);
  const q = schedule(p, 'forgot', 1000);
  assert.equal(q.interval, MIN10);
  assert.equal(q.stage, 0);
  assert.ok(q.ease < p.ease);
  assert.equal(q.lapses, 1);
});

t('模糊：约 1 天，stage 至少为 1', () => {
  const p = schedule(null, 'fuzzy', 0);
  assert.equal(Math.round(p.interval / DAY), 1);
  assert.equal(p.stage, 1);
});

t('ease 有下限 1.3、上限 2.5', () => {
  let p = null;
  for (let i = 0; i < 10; i++) p = schedule(p, 'forgot', 0);
  assert.equal(p.ease, 1.3);
  let q = null;
  for (let i = 0; i < 20; i++) q = schedule(q, 'know', 0);
  assert.ok(q.ease <= 2.5);
});

t('30 天以后继续增长而不是卡住', () => {
  let p = null, now = 0;
  for (let i = 0; i < 7; i++) p = schedule(p, 'know', now);
  assert.ok(p.interval > 30 * DAY, 'interval=' + p.interval / DAY);
});

t('进度历史最多存 30 条', () => {
  let p = null;
  for (let i = 0; i < 60; i++) p = schedule(p, 'know', i);
  assert.ok(p.hist.length <= 30);
});

group('考察形式递进');
t('stage 决定形式', () => {
  assert.equal(modeFor(0), 'card');
  assert.equal(modeFor(1), 'card');
  assert.equal(modeFor(2), 'choice');
  assert.equal(modeFor(3), 'choice');
  assert.equal(modeFor(4), 'spell');
  assert.equal(modeFor(9), 'spell');
  assert.equal(modeFor(0, 'spell'), 'spell');
});

/* ---------------- 队列 ---------------- */
group('今日队列');

function mkState(extra = {}) {
  return {
    books: [{ id: 'b1', name: '考研', on: true }],
    words: [],
    prog: {},
    daily: {},
    settings: { newPerDay: 3, reviewPerDay: 2, mode: 'auto' },
    ...extra,
  };
}
function addWords(state, n, from = 1) {
  for (let i = from; i < from + n; i++) {
    state.words.push({ id: 'w' + i, bookId: 'b1', word: 'word' + i, pos: 'n', meaning: '意思' + i });
  }
  return state;
}

t('新词受每日上限限制', () => {
  const s = addWords(mkState(), 10);
  const q = buildQueue(s, 0);
  assert.equal(q.news.length, 3);
  assert.equal(q.backlogNews, 7);
});

t('已学过的新词额度会扣减', () => {
  const s = addWords(mkState(), 10);
  s.daily[dayKey(0)] = { newN: 2, revN: 0, okN: 0, totalN: 0 };
  const q = buildQueue(s, 0);
  assert.equal(q.news.length, 1);
});

t('到期复习优先，且受复习上限限制', () => {
  const s = addWords(mkState(), 6);
  for (let i = 1; i <= 4; i++) s.prog[wordKey('word' + i)] = { stage: 1, due: -1000 * i, ease: 2.5, interval: DAY, reps: 1 };
  const q = buildQueue(s, 0);
  assert.equal(q.reviews.length, 2);
  assert.equal(q.reviews[0].word, 'word4'); // 最早到期
  assert.equal(q.backlogReviews, 2);
});

t('未到期的词不进复习队列', () => {
  const s = addWords(mkState(), 2);
  s.prog[wordKey('word1')] = { stage: 1, due: 10 * DAY, ease: 2.5, interval: DAY, reps: 1 };
  const q = buildQueue(s, 0);
  assert.equal(q.reviews.length, 0);
});

t('关掉的词库不参与', () => {
  const s = addWords(mkState(), 3);
  s.books[0].on = false;
  const q = buildQueue(s, 0);
  assert.equal(q.news.length, 0);
});

t('同一个词在两个词库只出现一次', () => {
  const s = mkState({ books: [{ id: 'b1', name: 'A', on: true }, { id: 'b2', name: 'B', on: true }] });
  s.words.push({ id: 'x1', bookId: 'b1', word: 'abandon', pos: 'v', meaning: '放弃' });
  s.words.push({ id: 'x2', bookId: 'b2', word: 'Abandon', pos: 'v', meaning: '放弃' });
  assert.equal(buildQueue(s, 0).news.length, 1);
});

/* ---------------- 四选一 ---------------- */
group('四选一');

const pool = [
  { word: 'abandon', pos: 'v', meaning: '放弃' },
  { word: 'accept', pos: 'v', meaning: '接受' },
  { word: 'achieve', pos: 'v', meaning: '实现' },
  { word: 'admire', pos: 'v', meaning: '钦佩' },
  { word: 'apple', pos: 'n', meaning: '苹果' },
  { word: 'absolute', pos: 'adj', meaning: '绝对的' },
];

t('优先同词性同长度，凑满 4 个选项', () => {
  const r = buildChoices(pool[0], pool);
  assert.equal(r.options.length, 4);
  assert.ok(r.options.includes('放弃'));
  assert.equal(new Set(r.options).size, 4);
  assert.equal(r.complete, true);
});

t('词库太小也能出题（降级，选项不足 4 个）', () => {
  const tiny = [{ word: 'abandon', pos: 'v', meaning: '放弃' }, { word: 'apple', pos: 'n', meaning: '苹果' }];
  const r = buildChoices(tiny[0], tiny);
  assert.ok(r.options.length >= 2);
  assert.equal(r.options.includes('放弃'), true);
  assert.equal(r.complete, false);
});

t('干扰项不会跟正确答案一样', () => {
  const dup = [...pool, { word: 'quit', pos: 'v', meaning: '放弃' }];
  const r = buildChoices(pool[0], dup);
  assert.equal(r.options.filter(o => o === '放弃').length, 1);
});

t('选项每次顺序会变（打乱）', () => {
  const orders = new Set();
  for (let i = 0; i < 30; i++) orders.add(buildChoices(pool[0], pool).options.join('|'));
  assert.ok(orders.size > 1);
});

/* ---------------- 拼写 ---------------- */
group('拼写模式');

t('大小写 / 空格 / 全角都不影响判对', () => {
  assert.ok(checkSpelling('Abandon', 'abandon'));
  assert.ok(checkSpelling(' abandon ', 'abandon'));
  assert.ok(checkSpelling('ａｂａｎｄｏｎ', 'abandon'));
  assert.ok(checkSpelling('give  up', 'give up'));
  assert.ok(!checkSpelling('abandan', 'abandon'));
});

t('提示：首字母 + 下划线', () => {
  assert.equal(spellHint('give up'), 'g _ _ _   u _');
});

/* ---------------- 统计 ---------------- */
group('统计');

t('连续打卡：今天没学也算上昨天', () => {
  const now = 10 * DAY;
  const daily = {
    [dayKey(now - DAY)]: { totalN: 5 },
    [dayKey(now - 2 * DAY)]: { totalN: 5 },
    [dayKey(now - 3 * DAY)]: { totalN: 5 },
  };
  assert.equal(calcStreak(daily, now), 3);
});

t('断一天就断签', () => {
  const now = 10 * DAY;
  const daily = {
    [dayKey(now)]: { totalN: 1 },
    [dayKey(now - 2 * DAY)]: { totalN: 5 },
  };
  assert.equal(calcStreak(daily, now), 1);
});

t('汇总：掌握 / 学习中 / 未学', () => {
  const s = addWords(mkState(), 4);
  s.prog[wordKey('word1')] = { stage: 5, due: DAY, ease: 2.5, interval: 30 * DAY, reps: 5 };
  s.prog[wordKey('word2')] = { stage: 2, due: 0, ease: 2.5, interval: 3 * DAY, reps: 2 };
  const sum = summarize(s, 0);
  assert.equal(sum.total, 4);
  assert.equal(sum.mastered, 1);
  assert.equal(sum.learning, 1);
  assert.equal(sum.fresh, 2);
  assert.equal(sum.masteredPct, 25);
});

/* ---------------- 合并 ---------------- */
group('备份合并');

t('同名词库合并，不重复加词，进度取更完整的', () => {
  const a = addWords(mkState(), 2);
  a.books = [{ id: 'b1', name: '考研', on: true }];
  const b = {
    books: [{ id: 'b9', name: '考研', on: true }],
    words: [
      { id: 'z1', bookId: 'b9', word: 'word1', pos: 'n', meaning: '意思1' },
      { id: 'z2', bookId: 'b9', word: 'newone', pos: 'n', meaning: '新词' },
    ],
    prog: { word1: { reps: 9, lastAt: 5, stage: 3 } },
    daily: {},
  };
  const m = mergeStates(a, b);
  assert.equal(m.books.length, 1);
  assert.equal(m.words.length, 3, JSON.stringify(m.words.map(w => w.word)));
  assert.equal(m.prog.word1.reps, 9, '应保留更完整的进度');
});

console.log(`\n${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
