import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooklet } from '../src/js/domain/booklet.js';
import { placeContent, unplaceContent, startPageOf, checkRange } from '../src/js/domain/placement.js';
import { addContent, updateContent, deleteContent, capacity, sortContents } from '../src/js/domain/content.js';

// 12ページ冊子（全ページが自由に使える通常ページ）にコンテンツを登録した状態を作る
function setup(defs = [['特集', 2]]) {
  const state = createBooklet('テスト冊子', 12);
  const ids = [];
  for (const [name, n] of defs) {
    const r = addContent(state, name, String(n));
    assert.equal(r.ok, true);
    state.contents = [...state.contents, r.content];
    ids.push(r.content.id);
  }
  return { state, ids };
}
const occupied = (state, id) =>
  state.pages.filter((p) => p.contentId === id).map((p) => [p.physicalPageNumber, p.contentPageIndex]);
const apply = (state, r) => ({ ...state, pages: r.pages });

test('2PコンテンツをP4へ配置するとP4=①(0)、P5=②(1)を占有する', () => {
  const { state, ids } = setup();
  const r = placeContent(state, ids[0], 4);
  assert.equal(r.ok, true);
  assert.deepEqual(occupied(apply(state, r), ids[0]), [[4, 0], [5, 1]]);
});

test('配置済みのP5だけへ別コンテンツを置けない（上書きしない）', () => {
  const { state, ids } = setup([['特集', 2], ['コラム', 1]]);
  const s1 = apply(state, placeContent(state, ids[0], 4));
  const r = placeContent(s1, ids[1], 5);
  assert.equal(r.ok, false);
  assert.match(r.reason, /P5/);
  assert.deepEqual(occupied(s1, ids[0]), [[4, 0], [5, 1]]);
});

test('連続空き不足（途中に使用中ページがある）場合は拒否し、元のpagesは不変', () => {
  const { state, ids } = setup([['A', 1], ['B', 2]]);
  const s1 = apply(state, placeContent(state, ids[0], 5));
  const before = JSON.stringify(s1.pages);
  const r = placeContent(s1, ids[1], 4); // P4-P5 のうち P5 が使用中
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(s1.pages), before);
});

test('冊子の範囲外・末尾を超える位置への配置は拒否し、P1〜P12は自由に使える', () => {
  const { state, ids } = setup([['特集', 2]]);
  assert.equal(placeContent(state, ids[0], 0).ok, false);
  assert.equal(placeContent(state, ids[0], 13).ok, false);
  assert.equal(placeContent(state, ids[0], 12).ok, false); // P12から2ページは末尾を超える
  assert.match(placeContent(state, ids[0], 12).reason, /最終ページ/);
  for (const start of [1, 2, 3, 10, 11]) assert.equal(placeContent(state, ids[0], start).ok, true, `P${start}`);
});

test('標準構成から作ったコンテンツ（表紙など）も、通常のコンテンツと同じく配置・移動・解除・削除できる', () => {
  const set = createBooklet('テスト冊子', 12, { preset: true });
  const state = { ...set, pdfAssets: [], renderImages: [] };
  const cover = state.contents.find((c) => c.presetKey === 'cover');
  assert.equal(state.pages[0].contentId, cover.id); // P1
  const moved = placeContent(state, cover.id, 5); // P1 → P5（空き）
  assert.equal(moved.ok, true);
  const s1 = apply(state, moved);
  assert.equal(s1.pages[0].contentId, null);
  assert.equal(s1.pages[4].contentId, cover.id);
  const un = unplaceContent(s1, cover.id);
  assert.equal(un.ok, true);
  assert.equal(un.pages.some((p) => p.contentId === cover.id), false);
  const del = deleteContent(s1, cover.id);
  assert.equal(del.ok, true);
  assert.equal(del.contents.some((c) => c.id === cover.id), false);
  // 標準構成の位置（P2＝表紙裏）は、他のコンテンツで使用中なら配置できない（上書きしない）
  const other = addContent(state, '特集', '1');
  const s2 = { ...state, contents: [...state.contents, other.content] };
  const r = placeContent(s2, other.content.id, 2);
  assert.equal(r.ok, false);
  assert.match(r.reason, /表紙裏/);
});

test('移動：空きがあれば移動でき、旧位置は空きになる', () => {
  const { state, ids } = setup();
  const s1 = apply(state, placeContent(state, ids[0], 4));
  const r = placeContent(s1, ids[0], 8);
  assert.equal(r.ok, true);
  const s2 = apply(s1, r);
  assert.deepEqual(occupied(s2, ids[0]), [[8, 0], [9, 1]]);
  assert.equal(s2.pages[3].contentId, null);
  assert.equal(s2.pages[4].contentId, null);
});

test('移動：自分自身の占有ページと重なる位置（1ページずらし）は可能', () => {
  const { state, ids } = setup();
  const s1 = apply(state, placeContent(state, ids[0], 4));
  const r = placeContent(s1, ids[0], 5);
  assert.equal(r.ok, true);
  assert.deepEqual(occupied(apply(s1, r), ids[0]), [[5, 0], [6, 1]]);
});

test('移動：確保できない場合は拒否し、元の配置を維持（別の空き位置を探さない）', () => {
  const { state, ids } = setup([['特集', 2], ['コラム', 1]]);
  let s = apply(state, placeContent(state, ids[0], 4));
  s = apply(s, placeContent(s, ids[1], 7));
  const before = JSON.stringify(s.pages);
  const r = placeContent(s, ids[0], 6); // P6-P7、P7は使用中
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(s.pages), before);
  assert.equal(startPageOf(s.pages, ids[0]), 4);
});

test('同じ位置へのドロップは変更なし', () => {
  const { state, ids } = setup();
  const s1 = apply(state, placeContent(state, ids[0], 4));
  const r = placeContent(s1, ids[0], 4);
  assert.equal(r.ok, true);
  assert.equal(r.unchanged, true);
});

test('配置解除：全占有ページを解除し、コンテンツ自体は残る', () => {
  const { state, ids } = setup();
  const s1 = apply(state, placeContent(state, ids[0], 4));
  const r = unplaceContent(s1, ids[0]);
  assert.equal(r.ok, true);
  assert.deepEqual(occupied(apply(s1, r), ids[0]), []);
  assert.equal(s1.contents.some((c) => c.id === ids[0]), true);
});

test('コンテンツ削除：配置済みなら配置も解除され、Contentが消える', () => {
  const { state, ids } = setup();
  const s1 = apply(state, placeContent(state, ids[0], 4));
  const r = deleteContent(s1, ids[0]);
  assert.equal(r.ok, true);
  assert.equal(r.contents.some((c) => c.id === ids[0]), false);
  assert.equal(r.pages.some((p) => p.contentId === ids[0]), false);
});

test('P数増加：後続が空いていれば拡張、使用中なら拒否', () => {
  const { state, ids } = setup([['特集', 2], ['コラム', 1]]);
  let s = apply(state, placeContent(state, ids[0], 4));
  const ok = updateContent(s, ids[0], '特集', '3');
  assert.equal(ok.ok, true);
  assert.deepEqual(
    ok.pages.filter((p) => p.contentId === ids[0]).map((p) => p.physicalPageNumber),
    [4, 5, 6],
  );
  s = apply(s, placeContent(s, ids[1], 6));
  const ng = updateContent(s, ids[0], '特集', '3');
  assert.equal(ng.ok, false);
  assert.ok(ng.errors.requiredPages);
});

test('P数減少（未配置）：必要ページ数だけ変わる', () => {
  const { state, ids } = setup();
  const r = updateContent(state, ids[0], '特集', '1');
  assert.equal(r.ok, true);
  assert.equal(r.content.requiredPages, 1);
});

test('P数減少（配置済み）：3P→2Pで開始ページと先頭側を維持し、末尾P6のみ空きになる', () => {
  const { state, ids } = setup([['特集', 3], ['コラム', 1]]);
  let s = apply(state, placeContent(state, ids[0], 4)); // P4-P6
  s = apply(s, placeContent(s, ids[1], 7)); // 直後のP7に別コンテンツ
  const r = updateContent(s, ids[0], '特集', '2');
  assert.equal(r.ok, true);
  assert.equal(r.content.requiredPages, 2);
  const after = { ...s, pages: r.pages };
  assert.deepEqual(occupied(after, ids[0]), [[4, 0], [5, 1]]);
  assert.equal(after.pages[5].contentId, null); // P6は空き
  assert.equal(after.pages[5].contentPageIndex, null);
  assert.deepEqual(occupied(after, ids[1]), [[7, 0]]); // 他コンテンツは動かない
});

test('P数減少（配置済み）：3P→1Pでも開始ページは変わらず、他のページに触れない', () => {
  const { state, ids } = setup([['特集', 3]]);
  const s = apply(state, placeContent(state, ids[0], 5)); // P5-P7
  const r = updateContent(s, ids[0], '特集', '1');
  assert.equal(r.ok, true);
  assert.deepEqual(occupied({ ...s, pages: r.pages }, ids[0]), [[5, 0]]);
  // 他のページは変更されない
  const changed = r.pages.filter((p, i) => JSON.stringify(p) !== JSON.stringify(s.pages[i]));
  assert.deepEqual(changed.map((p) => p.physicalPageNumber), [6, 7]);
});

test('D&D：2Pコンテンツの②側をドラッグしてP6へドロップしても、P6=①・P7=②になる', () => {
  const { state, ids } = setup();
  const s1 = apply(state, placeContent(state, ids[0], 4)); // P4-P5
  // UIはどの占有ページをつかんでも contentId と「ドロップ先ページ」だけを渡す
  const r = placeContent(s1, ids[0], 6);
  assert.equal(r.ok, true);
  assert.deepEqual(occupied(apply(s1, r), ids[0]), [[6, 0], [7, 1]]);
});

test('zod：コンテンツ名は必須、必要ページ数は1以上の整数（0.5Pは不可）', () => {
  const { state } = setup([]);
  assert.equal(addContent(state, '', '1').ok, false);
  assert.equal(addContent(state, '特集', '0').ok, false);
  assert.equal(addContent(state, '特集', '0.5').ok, false);
  assert.equal(addContent(state, '特集', '').ok, false);
  assert.equal(addContent(state, '特集', 'abc').ok, false);
  assert.equal(addContent(state, ' 特集 ', '3').content.name, '特集');
});

test('容量チェック：必要ページ数の合計が総ページ数を超える登録で警告', () => {
  const { state } = setup([['A', 8], ['B', 4]]);
  assert.deepEqual(capacity(state), { available: 12, registered: 12, over: false });
  const r = addContent(state, 'C', '1');
  const over = { ...state, contents: [...state.contents, r.content] };
  assert.equal(capacity(over).over, true);
});

test('表示順：配置済みは開始ページ順、未配置はその後ろに作成順', () => {
  const { state, ids } = setup([['A', 1], ['B', 2], ['C', 1], ['D', 1]]);
  let s = state;
  s = apply(s, placeContent(s, ids[2], 3)); // C → P3
  s = apply(s, placeContent(s, ids[1], 8)); // B → P8-P9
  s = apply(s, placeContent(s, ids[0], 11)); // A → P11
  // D は未配置
  const names = sortContents([...s.contents].reverse(), s.pages).map((c) => c.name);
  assert.deepEqual(names, ['C', 'B', 'A', 'D']);
  // 配置を動かすと並びも変わる（A を P1 へ）
  const s2 = apply(s, placeContent(s, ids[0], 1));
  assert.deepEqual(sortContents(s2.contents, s2.pages).map((c) => c.name), ['A', 'C', 'B', 'D']);
});

test('checkRange：範囲外の開始位置を拒否する', () => {
  const { state, ids } = setup();
  const c = state.contents.find((x) => x.id === ids[0]);
  assert.equal(checkRange(state, c, 0).ok, false);
  assert.equal(checkRange(state, c, 13).ok, false);
});
