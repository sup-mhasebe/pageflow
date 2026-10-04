import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScreens, screenIndexOf, neighborIndex } from '../src/js/domain/viewer.js';
import { renderViewer, buildViewerModel } from '../src/js/ui/viewer.js';
import { createBooklet } from '../src/js/domain/booklet.js';
import { addContent } from '../src/js/domain/content.js';
import { placeContent } from '../src/js/domain/placement.js';

// ---- ページ構成の生成（冊子として開いて読む順。面付順とは別）----
test('8P（見開き）：P1単独 → P2|P3 → P4|P5 → P6|P7 → P8単独（5画面）', () => {
  assert.deepEqual(buildScreens(8), [[1], [2, 3], [4, 5], [6, 7], [8]]);
});

test('12P（見開き）：P1単独 → P2|P3 … P10|P11 → P12単独（7画面）', () => {
  assert.deepEqual(buildScreens(12), [[1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12]]);
});

for (const n of [8, 12, 16, 20, 64]) {
  test(`${n}P（見開き）：P1とPNは単独、間は見開き、全ページが1回ずつ・順番どおり`, () => {
    const s = buildScreens(n);
    assert.deepEqual(s[0], [1]);
    assert.deepEqual(s[s.length - 1], [n]);
    assert.equal(s.length, n / 2 + 1);
    for (const mid of s.slice(1, -1)) {
      assert.equal(mid.length, 2);
      assert.equal(mid[0] % 2, 0); // 見開きの左ページは偶数ページ（左綴じ）
      assert.equal(mid[1], mid[0] + 1);
    }
    assert.deepEqual(s.flat(), Array.from({ length: n }, (_, i) => i + 1));
  });
}

test('1ページ表示（スマートフォン）：P1 → P2 → … → PN', () => {
  assert.deepEqual(buildScreens(8, 'single'), [[1], [2], [3], [4], [5], [6], [7], [8]]);
});

test('画面の検索・移動：範囲外には出ない', () => {
  const s = buildScreens(8);
  assert.equal(screenIndexOf(s, 1), 0);
  assert.equal(screenIndexOf(s, 3), 1);
  assert.equal(screenIndexOf(s, 8), 4);
  assert.equal(screenIndexOf(s, 99), 0);
  assert.equal(neighborIndex(s, 0, 'prev'), 0);
  assert.equal(neighborIndex(s, 4, 'next'), 4);
  assert.equal(neighborIndex(s, 1, 'next'), 2);
  assert.equal(neighborIndex(s, 2, 'prev'), 1);
});

test('モード切替時もページを保てる：1ページ表示のP3 → 見開きでは P2|P3 の画面', () => {
  const spread = buildScreens(8);
  assert.deepEqual(spread[screenIndexOf(spread, 3)], [2, 3]);
  const single = buildScreens(8, 'single');
  assert.deepEqual(single[screenIndexOf(single, 2)], [2]);
});

// ---- 画面（HTML）----
function sampleModel() {
  const set = createBooklet('テスト冊子', 8);
  let state = { ...set, pdfAssets: [], renderImages: [] };
  const added = addContent(state, '特集', '2');
  state = { ...state, contents: [...state.contents, added.content] };
  state = { ...state, pages: placeContent(state, added.content.id, 4).pages };
  const model = buildViewerModel(state);
  // P1(表紙)・P2・P3 には画像がある想定（Object URLの代わりにダミーURL）
  for (const n of [1, 2, 3]) model.pages[n - 1].imageUrl = `blob:dummy-${n}`;
  return model;
}
const view = (pageNo, over = {}) => ({ pageNo, showInfo: true, anim: null, ...over });
const count = (html, re) => (html.match(re) ?? []).length;

test('表示モデル：コンテンツ名（固定ページ名・①②・空き）が入る。編集データは変更されない', () => {
  const set = createBooklet('テスト冊子', 8);
  const state = { ...set, pdfAssets: [], renderImages: [] };
  const before = JSON.stringify(state);
  const model = buildViewerModel(state);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual([1, 2, 3, 7, 8].map((n) => model.pages[n - 1].contentName), ['表紙', '表紙裏', '目次', '裏表紙裏', '裏表紙']);
  assert.equal(model.pages[3].contentName, '空き');
});

test('P1は単独表示（1ページのみ）、P2|P3は見開き（2ページ）、PNは単独', () => {
  const m = sampleModel();
  assert.equal(count(renderViewer(m, view(1), 'spread'), /data-viewer-page=/g), 1);
  const spread = renderViewer(m, view(2), 'spread');
  assert.equal(count(spread, /data-viewer-page=/g), 2);
  assert.match(spread, /data-viewer-page="2"[\s\S]*data-viewer-page="3"/); // 左P2、右P3の順
  const last = renderViewer(m, view(8), 'spread');
  assert.equal(count(last, /data-viewer-page=/g), 1);
  assert.match(last, /data-viewer-page="8"/);
});

test('画像があるページは<img>、無いページはプレースホルダー（P番号・コンテンツ名・PDF未登録）', () => {
  const m = sampleModel();
  const withImg = renderViewer(m, view(2), 'spread');
  assert.equal(count(withImg, /<img /g), 2);
  assert.equal(count(withImg, /data-placeholder/g), 0);
  const noImg = renderViewer(m, view(4), 'spread'); // P4|P5 は画像なし（特集①②）
  assert.equal(count(noImg, /<img /g), 0);
  assert.equal(count(noImg, /data-placeholder/g), 2);
  assert.match(noImg, /P4/);
  assert.match(noImg, /特集 ①/);
  assert.match(noImg, /特集 ②/);
  assert.equal(count(noImg, /PDF未登録/g), 2);
});

test('固定ページのプレースホルダーには固定ページ名を表示する', () => {
  const m = sampleModel();
  const html = renderViewer(m, view(8), 'spread');
  assert.match(html, /裏表紙/);
  assert.match(html, /PDF未登録/);
});

test('ページ情報 ON：画像ページにP番号とコンテンツ名のキャプション／OFF：誌面画像のみ', () => {
  const m = sampleModel();
  const on = renderViewer(m, view(2, { showInfo: true }), 'spread');
  assert.equal(count(on, /data-page-info/g), 2);
  assert.match(on, /P2　表紙裏/);
  assert.match(on, /aria-checked="true"/);
  const off = renderViewer(m, view(2, { showInfo: false }), 'spread');
  assert.equal(count(off, /data-page-info/g), 0);
  assert.equal(count(off, /<img /g), 2);
  assert.match(off, /aria-checked="false"/);
});

test('位置表示（n / 全画面数）と、最初／最後での前へ・次への無効化', () => {
  const m = sampleModel();
  const first = renderViewer(m, view(1), 'spread');
  assert.match(first, /1 \/ 5/);
  assert.match(first, /data-action="viewer-prev" disabled/);
  assert.doesNotMatch(first, /data-action="viewer-next" disabled/);
  const mid = renderViewer(m, view(4), 'spread');
  assert.match(mid, /3 \/ 5/);
  assert.doesNotMatch(mid, /data-action="viewer-prev" disabled/);
  assert.doesNotMatch(mid, /data-action="viewer-next" disabled/);
  const last = renderViewer(m, view(8), 'spread');
  assert.match(last, /5 \/ 5/);
  assert.match(last, /data-action="viewer-next" disabled/);
  assert.doesNotMatch(last, /data-action="viewer-prev" disabled/);
});

test('アニメーション指定のときだけアニメーション用クラスが付く', () => {
  const m = sampleModel();
  assert.match(renderViewer(m, view(2, { anim: 'next' }), 'spread'), /viewer-anim-next/);
  assert.match(renderViewer(m, view(2, { anim: 'prev' }), 'spread'), /viewer-anim-prev/);
  assert.doesNotMatch(renderViewer(m, view(2), 'spread'), /viewer-anim/);
});

test('スマートフォン（1ページ表示）：常に1ページ・位置は n / N', () => {
  const m = sampleModel();
  const html = renderViewer(m, view(3), 'single');
  assert.equal(count(html, /data-viewer-page=/g), 1);
  assert.match(html, /3 \/ 8/);
});

test('冊子名やコンテンツ名のHTMLはエスケープされる', () => {
  const m = sampleModel();
  m.pages[3].contentName = '<img src=x onerror=alert(1)>';
  const html = renderViewer(m, view(4), 'spread');
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
