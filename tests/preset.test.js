import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooklet } from '../src/js/domain/booklet.js';
import { presetStatus, applyPreset, normalizeContent, presetLayout, PRESET_DEFS } from '../src/js/domain/preset.js';
import { addContent } from '../src/js/domain/content.js';
import { placeContent, unplaceContent } from '../src/js/domain/placement.js';

const ALL = PRESET_DEFS.map((d) => d.key);
const empty = (n = 12) => createBooklet('テスト冊子', n);
const statusOf = (state) => Object.fromEntries(presetStatus(state).map((s) => [s.key, s.status]));
const keyAt = (state, no) => {
  const p = state.pages.find((x) => x.physicalPageNumber === no);
  return state.contents.find((c) => c.id === p.contentId)?.presetKey ?? (p.contentId ? '(other)' : null);
};

test('標準構成の位置：総ページ数に合わせる', () => {
  assert.deepEqual(presetLayout(12).map((f) => f.position), [1, 2, 3, 11, 12]);
  assert.deepEqual(presetLayout(8).map((f) => f.position), [1, 2, 3, 7, 8]);
  assert.deepEqual(presetLayout(64).map((f) => f.position), [1, 2, 3, 63, 64]);
});

test('空の冊子：5項目すべて「available」（選択可）', () => {
  const s = presetStatus(empty());
  assert.equal(s.every((x) => x.status === 'available' && x.selectable), true);
});

test('全項目をセット：コンテンツが追加され、標準位置へ1ページずつ配置される', () => {
  const state = empty();
  const r = applyPreset(state, ALL);
  assert.equal(r.ok, true);
  assert.equal(r.applied.length, 5);
  assert.equal(r.skipped.length, 0);
  assert.deepEqual([1, 2, 3, 11, 12].map((n) => keyAt({ ...state, contents: r.contents, pages: r.pages }, n)), ALL);
  assert.equal(r.contents.every((c) => c.requiredPages === 1 && c.isFixed === false), true);
  assert.equal(state.contents.length, 0); // 入力は変更しない
});

test('必要なものだけ選んでセットできる（表紙と目次だけ）', () => {
  const state = empty();
  const r = applyPreset(state, ['cover', 'toc']);
  const s = { ...state, contents: r.contents, pages: r.pages };
  assert.deepEqual([1, 2, 3, 11, 12].map((n) => keyAt(s, n)), ['cover', null, 'toc', null, null]);
  assert.equal(r.contents.length, 2);
});

test('標準位置に配置済みの項目は「placed-standard」（選択不可）。セット済みの項目を再度選んでも変更しない', () => {
  const state = empty();
  const r = applyPreset(state, ALL);
  const s = { ...state, contents: r.contents, pages: r.pages };
  assert.deepEqual(Object.values(statusOf(s)), Array(5).fill('placed-standard'));
  assert.equal(presetStatus(s).some((x) => x.selectable), false);
  const again = applyPreset(s, ALL);
  assert.equal(again.applied.length, 0);
  assert.equal(again.skipped.length, 5);
  assert.equal(again.contents.length, 5); // 重複して作らない
  assert.deepEqual(again.pages, s.pages);
});

test('標準位置が別のコンテンツで使用中の項目は「blocked」。上書きせずスキップし、理由を返す', () => {
  const state = empty();
  const a = addContent(state, '特集', '1');
  const s0 = { ...state, contents: [a.content] };
  const placedA = placeContent(s0, a.content.id, 1); // P1 を使用
  const s1 = { ...s0, pages: placedA.pages };
  const st = presetStatus(s1).find((x) => x.key === 'cover');
  assert.equal(st.status, 'blocked');
  assert.match(st.note, /P1.*特集/);
  const r = applyPreset(s1, ALL);
  assert.deepEqual(r.skipped.map((x) => x.key), ['cover']);
  assert.match(r.skipped[0].reason, /特集/);
  assert.equal(r.applied.length, 4);
  // 既存の配置（P1=特集）は動かない
  assert.equal(r.pages[0].contentId, a.content.id);
});

test('標準構成のコンテンツが未配置なら「existing-unplaced」。既存のコンテンツを標準位置へ配置し、重複して作らない', () => {
  const state = empty();
  const r1 = applyPreset(state, ['toc']);
  const s1 = { ...state, contents: r1.contents, pages: r1.pages };
  const tocId = r1.contents[0].id;
  const un = unplaceContent(s1, tocId);
  const s2 = { ...s1, pages: un.pages };
  assert.equal(statusOf(s2).toc, 'existing-unplaced');
  const r2 = applyPreset(s2, ['toc']);
  assert.equal(r2.applied[0].created, false);
  assert.equal(r2.contents.length, 1);
  assert.equal(r2.pages[2].contentId, tocId); // P3
});

test('別の位置に配置済みの項目は「placed-elsewhere」（選択不可）。勝手に移動しない', () => {
  const state = empty();
  const r1 = applyPreset(state, ['cover']);
  const s1 = { ...state, contents: r1.contents, pages: r1.pages };
  const moved = placeContent(s1, r1.contents[0].id, 5); // 表紙を P5 へ
  const s2 = { ...s1, pages: moved.pages };
  const st = presetStatus(s2).find((x) => x.key === 'cover');
  assert.equal(st.status, 'placed-elsewhere');
  assert.match(st.note, /P5/);
  assert.equal(st.selectable, false);
  const r2 = applyPreset(s2, ['cover']);
  assert.equal(r2.applied.length, 0);
  assert.equal(r2.pages[4].contentId, r1.contents[0].id); // P5 のまま
  assert.equal(r2.pages[0].contentId, null); // P1 には配置しない
});

test('名前が同じでも、presetKey のない通常コンテンツは標準構成として扱わない（改名にも影響されない）', () => {
  const state = empty();
  const a = addContent(state, '表紙', '1'); // ユーザーが作った「表紙」
  const s = { ...state, contents: [a.content] };
  assert.equal(statusOf(s).cover, 'available'); // 標準の表紙は別にセットできる
  const r = applyPreset(s, ['cover']);
  assert.equal(r.contents.length, 2);
  // 改名しても presetKey で識別できる
  const renamed = r.contents.map((c) => (c.presetKey === 'cover' ? { ...c, name: '表紙（春号）' } : c));
  const s2 = { ...s, contents: renamed, pages: r.pages };
  assert.equal(statusOf(s2).cover, 'placed-standard');
});

test('旧バージョンの固定コンテンツ：通常コンテンツになり、標準構成と同じ名前には presetKey が付く', () => {
  const legacy = [
    { id: 'a', bookletId: 'b', name: '表紙', requiredPages: 1, isFixed: true },
    { id: 'b', bookletId: 'b', name: '表紙裏', requiredPages: 1, isFixed: true },
    { id: 'c', bookletId: 'b', name: '目次', requiredPages: 1, isFixed: true },
    { id: 'd', bookletId: 'b', name: '裏表紙裏', requiredPages: 1, isFixed: true },
    { id: 'e', bookletId: 'b', name: '裏表紙', requiredPages: 1, isFixed: true },
    { id: 'f', bookletId: 'b', name: '特集', requiredPages: 3, isFixed: false },
    { id: 'g', bookletId: 'b', name: '独自名の固定', requiredPages: 1, isFixed: true },
  ].map(normalizeContent);
  assert.deepEqual(legacy.map((c) => c.presetKey), ['cover', 'coverBack', 'toc', 'backCoverInner', 'backCover', undefined, undefined]);
  assert.equal(legacy.every((c) => c.isFixed === false), true);
  // 名前・必要ページ数・ID は変わらない
  assert.deepEqual(legacy.map((c) => [c.id, c.name, c.requiredPages]), [['a', '表紙', 1], ['b', '表紙裏', 1], ['c', '目次', 1], ['d', '裏表紙裏', 1], ['e', '裏表紙', 1], ['f', '特集', 3], ['g', '独自名の固定', 1]]);
  // すでに presetKey のあるコンテンツは上書きしない
  assert.equal(normalizeContent({ id: 'x', bookletId: 'b', name: '改名後', requiredPages: 1, isFixed: true, presetKey: 'toc' }).presetKey, 'toc');
  // 正規化は冪等
  assert.deepEqual(legacy.map(normalizeContent), legacy);
});

test('旧データの標準位置（P1/P2/P3/P11/P12）に配置されていた固定コンテンツは、正規化後は「placed-standard」と判定される', () => {
  const set = createBooklet('旧形式', 12, { preset: true });
  // 旧バージョンの保存形式（isFixed: true、presetKeyなし）を再現
  const legacyContents = set.contents.map(({ presetKey, ...c }) => ({ ...c, isFixed: true }));
  const normalized = legacyContents.map(normalizeContent);
  const st = presetStatus({ booklet: set.booklet, contents: normalized, pages: set.pages });
  assert.equal(st.every((x) => x.status === 'placed-standard'), true);
});
