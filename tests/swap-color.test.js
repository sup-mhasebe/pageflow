import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooklet } from '../src/js/domain/booklet.js';
import { addContent, updateContent, deleteContent } from '../src/js/domain/content.js';
import { placeContent, swapPages } from '../src/js/domain/placement.js';
import { buildRegistration } from '../src/js/domain/pdf.js';
import { assignSequentially, findIntegrityIssues } from '../src/js/domain/assignment.js';
import { PALETTE, PRESET_COLOR, contentColor, colorIndexOf, nextColorIndex } from '../src/js/domain/content-color.js';
import { contentRecordSchema } from '../src/js/schemas.js';

// ---- 準備 ----
function base(total = 16, preset = false) {
  const set = createBooklet('テスト', total, { preset });
  return { ...set, pdfAssets: [], renderImages: [] };
}
function withContent(state, name, n, start) {
  const a = addContent(state, name, String(n));
  assert.equal(a.ok, true);
  let s = { ...state, contents: [...state.contents, a.content] };
  if (start) {
    const r = placeContent(s, a.content.id, start);
    assert.equal(r.ok, true);
    s = { ...s, pages: r.pages };
  }
  return { state: s, id: a.content.id };
}
const at = (s, no) => s.pages.find((p) => p.physicalPageNumber === no);
// 各ページを「Content名＋ページ順」で表す（空きは '-'）
const layout = (s, nums) =>
  nums.map((n) => {
    const p = at(s, n);
    const c = s.contents.find((x) => x.id === p.contentId);
    return c ? `${c.name}${p.contentPageIndex + 1}` : '-';
  });
function register(state, contentId, n) {
  const converted = Array.from({ length: n }, (_, i) => ({ sourcePdfPage: i + 1, splitSide: 'none', imageBlob: new Blob([String(i)]), width: 1240, height: 1754 }));
  const r = buildRegistration(state, contentId, { fileName: 'a.pdf', pdfBlob: new Blob(['x']), converted });
  return { ...state, pages: r.pages, pdfAssets: r.pdfAssets, renderImages: r.renderImages };
}
const seq = (s, id) => ({ ...s, pages: assignSequentially(s, id).pages });
const imgName = (s, no) => {
  const p = at(s, no);
  return s.renderImages.find((i) => i.id === p.renderImageId)?.sourcePdfPage ?? null;
};

// ================= Contentの識別色 =================
test('標準構成は presetKey によりグレー。改名しても維持され、同名の通常Contentはグレーにならない', () => {
  const s = base(12, true);
  assert.equal(s.contents.length, 5);
  for (const c of s.contents) assert.deepEqual(contentColor(s.contents, c), PRESET_COLOR);
  const renamed = { ...s.contents[0], name: '自由な名前' };
  assert.deepEqual(contentColor(s.contents, renamed), PRESET_COLOR);
  const { state, id } = withContent(s, '表紙', 1);
  const normal = state.contents.find((c) => c.id === id);
  assert.notDeepEqual(contentColor(state.contents, normal), PRESET_COLOR);
});

test('通常Contentは作成順に色が割り当てられ、保存される colorIndex から安定して決まる', () => {
  let s = base();
  const ids = [];
  for (const n of ['a', 'b', 'c']) {
    const r = withContent(s, n, 1);
    s = r.state;
    ids.push(r.id);
  }
  assert.deepEqual(s.contents.map((c) => c.colorIndex), [0, 1, 2]);
  const keyOf = (id) => contentColor(s.contents, s.contents.find((c) => c.id === id)).key;
  const before = ids.map(keyOf);
  assert.equal(new Set(before).size, 3);
  // 順序を入れ替えても、先頭を削除しても、残りのContentの色は変わらない
  s = { ...s, contents: [...s.contents].reverse() };
  assert.deepEqual(ids.map(keyOf), before);
  const d = deleteContent(s, ids[0]);
  s = { ...s, contents: d.contents };
  assert.deepEqual([keyOf(ids[1]), keyOf(ids[2])], before.slice(1));
  // 削除で空いた番号は再利用しない
  assert.equal(nextColorIndex(s.contents), 3);
});

test('色はパレットを一巡して繰り返す。パレットの各色は互いに異なる', () => {
  assert.equal(new Set(PALETTE.map((p) => p.bg)).size, PALETTE.length);
  assert.equal(new Set(PALETTE.map((p) => p.key)).size, PALETTE.length);
  let s = base();
  for (let i = 0; i < PALETTE.length + 2; i++) s = withContent(s, `c${i}`, 1).state;
  const last = s.contents[s.contents.length - 1];
  assert.equal(contentColor(s.contents, last).key, PALETTE[(PALETTE.length + 1) % PALETTE.length].key);
});

test('旧データ（colorIndexなし）は、作成順（IDの昇順）から導出する。保存データは書き換えない', () => {
  const legacy = [
    { id: 'c_000000b_x', bookletId: 'b', name: '後', requiredPages: 1 },
    { id: 'c_000000a_x', bookletId: 'b', name: '先', requiredPages: 1 },
    { id: 'p', bookletId: 'b', name: '目次', requiredPages: 1, presetKey: 'toc' },
  ];
  assert.equal(colorIndexOf(legacy, legacy[1]), 0);
  assert.equal(colorIndexOf(legacy, legacy[0]), 1);
  assert.equal(colorIndexOf(legacy, legacy[2]), null);
  assert.equal(legacy[0].colorIndex, undefined);
  assert.equal(contentRecordSchema.safeParse(legacy[0]).success, true); // colorIndex が無くても読み込める
  assert.equal(contentRecordSchema.safeParse({ ...legacy[0], colorIndex: 3 }).success, true);
  assert.equal(nextColorIndex(legacy), 2);
});

test('Contentが無い（空きページ）は色なし', () => {
  assert.equal(contentColor([], null), null);
});

// ================= ページの入れ替え（swap） =================
test('同じ複数ページContent内：P4=特集①/素材A, P5=特集②/素材B → 入れ替え後 P4=特集②/素材B, P5=特集①/素材A', () => {
  const r0 = withContent(base(), '特集', 2, 4);
  let state = seq(register(r0.state, r0.id, 2), r0.id);
  assert.deepEqual([imgName(state, 4), imgName(state, 5)], [1, 2]);
  const r = swapPages(state, 4, 5);
  assert.equal(r.ok, true);
  const s2 = { ...state, pages: r.pages };
  assert.deepEqual(layout(s2, [4, 5]), ['特集2', '特集1']);
  assert.deepEqual([imgName(s2, 4), imgName(s2, 5)], [2, 1]);
  assert.equal(at(s2, 4).pdfAssetId, s2.pdfAssets[0].id);
  assert.deepEqual(findIntegrityIssues(s2), []);
});

test('1P Content ↔ 1P Content：Contentと割り当て済みRenderImageを含む内容一式を交換する', () => {
  const ra = withContent(base(), 'A', 1, 4);
  const rb = withContent(ra.state, 'B', 1, 9);
  let state = seq(register(rb.state, ra.id, 1), ra.id);
  state = seq(register(state, rb.id, 2), rb.id);
  const imgA = at(state, 4).renderImageId;
  const imgB = at(state, 9).renderImageId;
  const sw = swapPages(state, 4, 9);
  assert.equal(sw.ok, true);
  const s2 = { ...state, pages: sw.pages };
  assert.equal(at(s2, 4).contentId, rb.id);
  assert.equal(at(s2, 4).renderImageId, imgB);
  assert.equal(at(s2, 9).contentId, ra.id);
  assert.equal(at(s2, 9).renderImageId, imgA);
  assert.deepEqual(findIntegrityIssues(s2), []);
});

test('1P Content ↔ 空きページ：Contentが移動し、元のページは空きになる（割り当ても一緒に移る）', () => {
  const r0 = withContent(base(), 'A', 1, 4);
  const state = seq(register(r0.state, r0.id, 1), r0.id);
  const img = at(state, 4).renderImageId;
  const sw = swapPages(state, 4, 12);
  assert.equal(sw.ok, true);
  const s2 = { ...state, pages: sw.pages };
  assert.equal(at(s2, 12).contentId, r0.id);
  assert.equal(at(s2, 12).renderImageId, img);
  assert.equal(at(s2, 4).contentId, null);
  assert.equal(at(s2, 4).renderImageId, null);
  assert.equal(at(s2, 4).pdfAssetId, null);
  // 空きページ側からドロップ（逆方向）でも同じ結果
  assert.deepEqual(swapPages(state, 12, 4).pages.map((p) => p.contentId), sw.pages.map((p) => p.contentId));
});

test('拒否：3P Contentの1ページを別Contentまたは空きページと入れ替えて分断される場合。元の状態を維持', () => {
  const r0 = withContent(base(), '特集', 3, 4);
  const state = withContent(r0.state, '別', 1, 9).state;
  for (const [from, to] of [[4, 9], [5, 9], [6, 9], [4, 12], [5, 12], [6, 7], [5, 3]]) {
    const before = JSON.stringify(state.pages);
    const r = swapPages(state, from, to);
    assert.equal(r.ok, false, `P${from}↔P${to}`);
    assert.match(r.reason, /特集/);
    assert.equal(JSON.stringify(state.pages), before);
  }
});

test('許可：結果として連続になる入れ替え（2P Contentの末尾ページを前の空きページへ、など）', () => {
  const { state } = withContent(base(), '二枚', 2, 4);
  const r = swapPages(state, 5, 3); // P3=二枚②, P4=二枚①, P5=空き
  assert.equal(r.ok, true);
  const s2 = { ...state, pages: r.pages };
  assert.deepEqual(layout(s2, [3, 4, 5]), ['二枚2', '二枚1', '-']);
  assert.deepEqual(findIntegrityIssues(s2), []);
});

test('2P Contentの1ページと1P Contentの入れ替え：分断されるなら拒否、連続を保つ組み合わせは許可', () => {
  const r0 = withContent(base(), '二枚', 2, 4);
  const state = withContent(r0.state, '一枚', 1, 6).state;
  assert.equal(swapPages(state, 5, 6).ok, false); // 二枚が P4,P6 に分断される
  assert.equal(swapPages(state, 4, 6).ok, true); // 二枚が P5,P6、一枚が P4
});

test('空きページ同士・自分自身へのドロップは何も変えない', () => {
  const { state } = withContent(base(), 'A', 1, 4);
  assert.equal(swapPages(state, 1, 2).unchanged, true);
  assert.equal(swapPages(state, 4, 4).unchanged, true);
  assert.equal(swapPages(state, 4, 99).ok, false);
});

test('入れ替え後に、移動・ページ数の増減をしても、ページ順と割り当てが保たれる', () => {
  const r0 = withContent(base(), '特集', 3, 4);
  const id = r0.id;
  let state = seq(register(r0.state, id, 3), id); // P4=1, P5=2, P6=3
  state = { ...state, pages: swapPages(state, 4, 6).pages }; // P4=特集3/素材3, P5=特集2/素材2, P6=特集1/素材1
  assert.deepEqual(layout(state, [4, 5, 6]), ['特集3', '特集2', '特集1']);
  // Contentを移動：相対位置を保って、順序と割り当てを引き継ぐ
  const mv = placeContent(state, id, 9);
  const s2 = { ...state, pages: mv.pages };
  assert.deepEqual(layout(s2, [9, 10, 11]), ['特集3', '特集2', '特集1']);
  assert.deepEqual([imgName(s2, 9), imgName(s2, 10), imgName(s2, 11)], [3, 2, 1]);
  assert.deepEqual(findIntegrityIssues(s2), []);
  // 3P→2P：先頭側の2ページが残り、順序は 0..n-1 に詰め直される。末尾の割り当ては解除
  const sh = updateContent(s2, id, '特集', '2');
  const s3 = { ...s2, pages: sh.pages, contents: s2.contents.map((c) => (c.id === id ? sh.content : c)) };
  assert.deepEqual(layout(s3, [9, 10, 11]), ['特集2', '特集1', '-']);
  assert.deepEqual([imgName(s3, 9), imgName(s3, 10), imgName(s3, 11)], [3, 2, null]);
  assert.deepEqual(findIntegrityIssues(s3), []);
  // 2P→3P：既存ページの順序は変えず、新しいページに続きの順序が付く
  const gr = updateContent(s3, id, '特集', '3');
  const s4 = { ...s3, pages: gr.pages };
  assert.deepEqual(layout(s4, [9, 10, 11]), ['特集2', '特集1', '特集3']);
});
