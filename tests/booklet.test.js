import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooklet, resizeBooklet, usage, fixedLayout } from '../src/js/domain/booklet.js';
import { validateNewBooklet, parseTotalPagesInput } from '../src/js/schemas.js';

const fixedNos = (set) => {
  const ids = new Set(set.contents.filter((c) => c.isFixed).map((c) => c.id));
  return set.pages.filter((p) => ids.has(p.contentId)).map((p) => p.physicalPageNumber);
};

test('8ページ指定で P1〜P8 が生成され、P1/P2/P3/P7/P8 が固定ページになる', () => {
  const set = createBooklet('テスト冊子', 8);
  assert.equal(set.pages.length, 8);
  assert.deepEqual(set.pages.map((p) => p.physicalPageNumber), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(fixedNos(set), [1, 2, 3, 7, 8]);
  const nameAt = (n) => set.contents.find((c) => c.id === set.pages[n - 1].contentId).name;
  assert.deepEqual([1, 2, 3, 7, 8].map(nameAt), ['表紙', '表紙裏', '目次', '裏表紙裏', '裏表紙']);
});

test('利用状況：8ページなら 固定5P・コンテンツ0P・空き3P', () => {
  const set = createBooklet('テスト冊子', 8);
  assert.deepEqual(usage(8, set.contents, set.pages), { total: 8, fixed: 5, content: 0, empty: 3 });
});

test('zod：総ページ数は8以上の4の倍数のみ有効', () => {
  for (const ok of ['8', '12', '16', '100']) assert.equal(parseTotalPagesInput(ok).success, true, ok);
  for (const ng of ['4', '0', '6', '10', '9', '-8', '8.5', '', 'abc']) {
    assert.equal(parseTotalPagesInput(ng).success, false, ng);
  }
});

test('zod：冊子名は空・空白のみを拒否し、前後空白を除去する', () => {
  assert.equal(validateNewBooklet('', '8').ok, false);
  assert.equal(validateNewBooklet('   ', '8').ok, false);
  const r = validateNewBooklet('  春号  ', '8');
  assert.equal(r.ok, true);
  assert.equal(r.data.name, '春号');
});

test('ページ数増加：固定ページが新しい末尾へ移り、旧位置は空きになる', () => {
  const set = createBooklet('テスト冊子', 8);
  const r = resizeBooklet(set, 12);
  assert.equal(r.ok, true);
  assert.equal(r.pages.length, 12);
  const next = { ...set, booklet: r.booklet, pages: r.pages };
  assert.deepEqual(fixedNos(next), [1, 2, 3, 11, 12]);
  assert.equal(r.pages[6].contentId, null); // 旧P7
  assert.equal(r.pages[7].contentId, null); // 旧P8
});

test('ページ数減少：末尾に配置が無ければ可能、固定ページは新しい末尾へ', () => {
  const set = createBooklet('テスト冊子', 12);
  const r = resizeBooklet(set, 8);
  assert.equal(r.ok, true);
  assert.equal(r.pages.length, 8);
  assert.equal(r.removedPageIds.length, 4);
  assert.deepEqual(fixedNos({ ...set, pages: r.pages }), [1, 2, 3, 7, 8]);
});

test('ページ数減少：削除対象や新固定位置にユーザー配置があれば拒否し、元データは変更しない', () => {
  const set = createBooklet('テスト冊子', 12);
  const content = { id: 'c1', bookletId: set.booklet.id, name: '特集', requiredPages: 1, isFixed: false };
  set.contents.push(content);
  set.pages[8].contentId = 'c1'; // P9
  set.pages[8].contentPageIndex = 0;
  const before = JSON.stringify(set);
  const r = resizeBooklet(set, 8);
  assert.equal(r.ok, false);
  assert.match(r.reason, /P9/);
  assert.equal(JSON.stringify(set), before);
});

test('ページ数を4にする変更は拒否する', () => {
  const set = createBooklet('テスト冊子', 8);
  assert.equal(resizeBooklet(set, 4).ok, false);
});

test('固定ページ構成は総ページ数の末尾に合わせる', () => {
  assert.deepEqual(fixedLayout(16).map((f) => f.position), [1, 2, 3, 15, 16]);
});
