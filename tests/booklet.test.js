import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooklet, resizeBooklet, planResize, usage } from '../src/js/domain/booklet.js';
import { validateNewBooklet, parseTotalPagesInput, contentRecordSchema, bookletRecordSchema } from '../src/js/schemas.js';
import { placeContent } from '../src/js/domain/placement.js';
import { addContent } from '../src/js/domain/content.js';

const withPdf = (set) => ({ ...set, pdfAssets: [], renderImages: [] });
// 空の冊子に、コンテンツを指定ページへ配置した状態を作る
function placed(total, defs) {
  let state = withPdf(createBooklet('テスト冊子', total));
  const ids = {};
  for (const [name, n, start] of defs) {
    const a = addContent(state, name, String(n));
    state = { ...state, contents: [...state.contents, a.content] };
    const r = placeContent(state, a.content.id, start);
    assert.equal(r.ok, true, `${name}→P${start}`);
    state = { ...state, pages: r.pages };
    ids[name] = a.content.id;
  }
  return { state, ids };
}

// ---- 新規冊子 ----
test('新規冊子は、全ページが自由に使える空きページで作成される（固定ページはない）', () => {
  const set = createBooklet('テスト冊子', 8);
  assert.equal(set.pages.length, 8);
  assert.deepEqual(set.pages.map((p) => p.physicalPageNumber), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(set.contents.length, 0);
  assert.equal(set.pages.every((p) => p.contentId === null && p.renderImageId === null), true);
});

test('標準構成を最初にセットした冊子：8Pなら P1/P2/P3/P7/P8 に表紙・表紙裏・目次・裏表紙裏・裏表紙', () => {
  const set = createBooklet('テスト冊子', 8, { preset: true });
  const nameAt = (n) => set.contents.find((c) => c.id === set.pages[n - 1].contentId)?.name ?? null;
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(nameAt), ['表紙', '表紙裏', '目次', null, null, null, '裏表紙裏', '裏表紙']);
  assert.deepEqual(set.contents.map((c) => c.presetKey), ['cover', 'coverBack', 'toc', 'backCoverInner', 'backCover']);
  assert.equal(set.contents.every((c) => c.isFixed === false && c.requiredPages === 1), true);
});

test('標準構成の位置は総ページ数に合わせる（16P：P15=裏表紙裏、P16=裏表紙）', () => {
  const set = createBooklet('テスト冊子', 16, { preset: true });
  const keyAt = (n) => set.contents.find((c) => c.id === set.pages[n - 1].contentId)?.presetKey;
  assert.deepEqual([1, 2, 3, 15, 16].map(keyAt), ['cover', 'coverBack', 'toc', 'backCoverInner', 'backCover']);
});

test('利用状況：8P・標準構成なら コンテンツ5P・空き3P（固定の項目はない）', () => {
  const set = createBooklet('テスト冊子', 8, { preset: true });
  assert.deepEqual(usage(8, set.contents, set.pages), { total: 8, content: 5, empty: 3 });
  const empty = createBooklet('テスト冊子', 8);
  assert.deepEqual(usage(8, empty.contents, empty.pages), { total: 8, content: 0, empty: 8 });
});

// ---- zod ----
test('zod：総ページ数は8以上の4の倍数のみ有効（上限は設けない）', () => {
  for (const ok of ['8', '12', '16', '64', '100', '128', '4000']) assert.equal(parseTotalPagesInput(ok).success, true, ok);
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

test('テンプレートIDは standard-booklet。別のtemplateIdで保存済みの冊子データも検証を通る', () => {
  const { booklet } = createBooklet('テスト冊子', 8);
  assert.equal(booklet.templateId, 'standard-booklet');
  assert.equal(bookletRecordSchema.safeParse({ ...booklet, templateId: 'saved-by-earlier-build' }).success, true);
});

test('zod：旧バージョンの固定コンテンツ（isFixed: true）も、新しい標準構成のコンテンツ（presetKey付き）も検証を通る', () => {
  const base = { id: 'c1', bookletId: 'b1', name: '表紙', requiredPages: 1 };
  assert.equal(contentRecordSchema.safeParse({ ...base, isFixed: true }).success, true);
  assert.equal(contentRecordSchema.safeParse({ ...base, isFixed: false, presetKey: 'cover' }).success, true);
  assert.equal(contentRecordSchema.safeParse(base).success, true); // isFixed なし
  assert.equal(contentRecordSchema.safeParse({ ...base, presetKey: 'unknown' }).success, false);
});

// ---- 総ページ数の変更 ----
test('増加：末尾に空きページを追加するだけ。確認は不要で、既存の配置は動かない', () => {
  const { state, ids } = placed(12, [['特集', 3, 4]]);
  const plan = planResize(state, 16);
  assert.equal(plan.ok, true);
  assert.equal(plan.needsConfirm, false);
  assert.deepEqual(plan.addedPages, [13, 14, 15, 16]);
  const r = resizeBooklet(state, 16);
  assert.equal(r.ok, true);
  assert.equal(r.pages.length, 16);
  assert.deepEqual(r.pages.slice(12).map((p) => [p.physicalPageNumber, p.contentId]), [[13, null], [14, null], [15, null], [16, null]]);
  assert.deepEqual(r.pages.slice(0, 12).map((p) => p.id), state.pages.map((p) => p.id)); // 既存のページはそのまま
  assert.equal(r.pages[3].contentId, ids['特集']);
  assert.deepEqual(r.removedPageIds, []);
  assert.equal(r.booklet.totalPages, 16);
});

test('減少：削除されるページが空きなら確認不要。コンテンツは動かない', () => {
  const { state, ids } = placed(12, [['特集', 3, 4]]);
  const plan = planResize(state, 8);
  assert.equal(plan.needsConfirm, false);
  assert.deepEqual(plan.cutPages, [9, 10, 11, 12]);
  const r = resizeBooklet(state, 8);
  assert.equal(r.ok, true);
  assert.equal(r.pages.length, 8);
  assert.equal(r.removedPageIds.length, 4);
  assert.equal(r.pages[3].contentId, ids['特集']);
});

test('減少：削除されるページにコンテンツがあれば確認が必要。その配置だけが解除され、コンテンツは残る', () => {
  const { state, ids } = placed(12, [['特集', 2, 9], ['コラム', 1, 4]]);
  const plan = planResize(state, 8);
  assert.equal(plan.ok, true);
  assert.equal(plan.needsConfirm, true);
  assert.deepEqual(plan.occupiedCutPages, [9, 10]);
  assert.deepEqual(plan.affected, [{ contentId: ids['特集'], name: '特集', pages: [9, 10] }]);
  const r = resizeBooklet(state, 8);
  assert.equal(r.ok, true);
  assert.equal(r.pages.some((p) => p.contentId === ids['特集']), false); // 配置は解除
  assert.equal(r.pages[3].contentId, ids['コラム']); // 削除されないページのコンテンツは動かない
  assert.equal(state.contents.length, 2); // コンテンツ自体は削除されない（入力の state は変更されない）
});

test('減少：コンテンツの一部だけが切れる場合は、そのコンテンツの配置全体を解除する（一部だけ残さない）', () => {
  const { state, ids } = placed(12, [['特集', 3, 8]]); // P8-P10。12→8で P9・P10 が切れる
  const plan = planResize(state, 8);
  assert.equal(plan.needsConfirm, true);
  assert.deepEqual(plan.affected, [{ contentId: ids['特集'], name: '特集', pages: [8, 9, 10] }]);
  const r = resizeBooklet(state, 8);
  assert.equal(r.pages.some((p) => p.contentId === ids['特集']), false); // P8 も解除される
  assert.equal(r.pages[7].contentId, null);
  assert.equal(r.pages[7].contentPageIndex, null);
});

test('減少：割り当て済みのPDF画像も、切れるページ上のものは割り当てが外れる（素材のRenderImageは別管理で残る）', () => {
  const { state, ids } = placed(12, [['特集', 2, 9]]);
  const pages = state.pages.map((p) => (p.contentId === ids['特集'] ? { ...p, pdfAssetId: 'a1', renderImageId: `img${p.physicalPageNumber}` } : p));
  const s = { ...state, pages, pdfAssets: [{ id: 'a1' }], renderImages: [{ id: 'img9' }, { id: 'img10' }] };
  const plan = planResize(s, 8);
  assert.equal(plan.needsConfirm, true);
  const r = resizeBooklet(s, 8);
  assert.equal(r.pages.some((p) => p.renderImageId || p.pdfAssetId), false);
  assert.equal(s.renderImages.length, 2); // 素材（RenderImage）の配列は変更されない
});

test('総ページ数の不正な変更は拒否する（4・4の倍数でない値・同じ値）', () => {
  const { state } = placed(12, []);
  for (const bad of [4, 6, 10, 0, -8, 8.5, NaN]) assert.equal(planResize(state, bad).ok, false, String(bad));
  assert.equal(resizeBooklet(state, 12).ok, false);
  assert.match(planResize(state, 12).reason, /同じ/);
});

test('上限は設けない：64P・128P・1000P への増加も可能', () => {
  const { state } = placed(12, []);
  for (const n of [64, 128, 1000]) {
    const r = resizeBooklet(state, n);
    assert.equal(r.ok, true, `${n}P`);
    assert.equal(r.pages.length, n);
  }
});
