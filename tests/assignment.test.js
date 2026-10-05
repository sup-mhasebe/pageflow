import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooklet } from '../src/js/domain/booklet.js';
import { addContent, updateContent } from '../src/js/domain/content.js';
import { placeContent, unplaceContent } from '../src/js/domain/placement.js';
import { buildRegistration, buildUnregister } from '../src/js/domain/pdf.js';
import {
  materialName,
  materialsOf,
  checkAssign,
  assignImage,
  unassignPage,
  planSequentialAssign,
  assignSequentially,
  findIntegrityIssues,
  repairAssignments,
  pageState,
  resolveMaterialContentId,
} from '../src/js/domain/assignment.js';

// ---- 準備：16P冊子（標準構成なし）。「特集」3PをP4〜P6、「対談」2PをP9〜P10に配置 ----
function setup() {
  const set = createBooklet('テスト冊子', 16, { preset: false });
  let state = { ...set, pdfAssets: [], renderImages: [] };
  const ids = {};
  for (const [name, n, start] of [['特集', 3, 4], ['対談', 2, 9]]) {
    const a = addContent(state, name, String(n));
    state = { ...state, contents: [...state.contents, a.content] };
    state = { ...state, pages: placeContent(state, a.content.id, start).pages };
    ids[name] = a.content.id;
  }
  return { state, ids };
}

const converted = (kinds) => {
  const out = [];
  kinds.forEach((k, i) => {
    const n = i + 1;
    if (k === 'a3') {
      out.push({ sourcePdfPage: n, splitSide: 'left', imageBlob: new Blob(['L']), width: 1240, height: 1754 });
      out.push({ sourcePdfPage: n, splitSide: 'right', imageBlob: new Blob(['R']), width: 1240, height: 1754 });
    } else out.push({ sourcePdfPage: n, splitSide: 'none', imageBlob: new Blob(['A']), width: 1240, height: 1754 });
  });
  return out;
};

// PDFを登録する（割り当てはしない）
function registerPdf(state, contentId, kinds) {
  const r = buildRegistration(state, contentId, { fileName: 'a.pdf', pdfBlob: new Blob(['x']), converted: converted(kinds) });
  assert.equal(r.ok, true);
  return { ...state, pages: r.pages, pdfAssets: r.pdfAssets, renderImages: r.renderImages };
}

const imgs = (state, contentId) => materialsOf(state, contentId);
// 割り当て操作を適用した新しい状態を返す
const assign = (state, imageId, no) => {
  const r = assignImage(state, imageId, no);
  assert.equal(r.ok, true);
  return { ...state, pages: r.pages };
};
const seq = (state, contentId) => ({ ...state, pages: assignSequentially(state, contentId).pages });
const at = (state, no) => state.pages.find((p) => p.physicalPageNumber === no);
// 各ページの割り当てを「素材の名称」で返す
const names = (state, nums) =>
  nums.map((n) => {
    const p = at(state, n);
    const img = state.renderImages.find((i) => i.id === p.renderImageId);
    return img ? materialName(img) : null;
  });

test('素材の名称：「1ページ」「2ページ（左）」「2ページ（右）」', () => {
  assert.equal(materialName({ sourcePdfPage: 1, splitSide: 'none' }), '1ページ');
  assert.equal(materialName({ sourcePdfPage: 2, splitSide: 'left' }), '2ページ（左）');
  assert.equal(materialName({ sourcePdfPage: 2, splitSide: 'right' }), '2ページ（右）');
});

test('複数ページPDFは、ページごとに独立した素材になる（A3は左→右の2素材）', () => {
  const { state, ids } = setup();
  const s = registerPdf(state, ids['特集'], ['a4', 'a3', 'a4']);
  assert.deepEqual(imgs(s, ids['特集']).map(materialName), ['1ページ', '2ページ（左）', '2ページ（右）', '3ページ']);
  assert.equal(new Set(imgs(s, ids['特集']).map((i) => i.id)).size, 4);
  assert.equal(s.pages.some((p) => p.renderImageId), false); // 自動では割り当てない
});

// ---- 手動の割り当て ----
test('割り当て：そのPDFのコンテンツのページへ割り当てられる。pdfAssetIdも保存される', () => {
  const { state, ids } = setup();
  const s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']);
  const [m1, , m3] = imgs(s, ids['特集']);
  const r = assignImage(s, m3.id, 4); // 順番とは無関係に、3ページ目の素材をP4へ
  assert.equal(r.ok, true);
  assert.equal(at({ ...s, pages: r.pages }, 4).renderImageId, m3.id);
  assert.equal(at({ ...s, pages: r.pages }, 4).pdfAssetId, s.pdfAssets[0].id);
  assert.equal(m1.id !== m3.id, true);
});

test('割り当ての拒否：別コンテンツのページ・空きページ。何も変更しない', () => {
  const { state, ids } = setup();
  const s = registerPdf(state, ids['特集'], ['a4', 'a4']);
  const m = imgs(s, ids['特集'])[0];
  const other = checkAssign(s, m.id, 9); // 「対談」のページ
  assert.equal(other.ok, false);
  assert.match(other.reason, /対談/);
  const empty = checkAssign(s, m.id, 1); // 空きページ
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /空きページ/);
  const before = JSON.stringify(s.pages);
  assert.equal(assignImage(s, m.id, 9).ok, false);
  assert.equal(assignImage(s, m.id, 1).ok, false);
  assert.equal(JSON.stringify(s.pages), before);
  assert.equal(checkAssign(s, m.id, 6).ok, true); // 自分のコンテンツの最後のページ
  assert.equal(checkAssign(s, 'nothing', 4).ok, false);
});

test('1素材は最大1ページ：割り当て済みの素材を同じコンテンツの別ページへ置くと、コピーではなく移動', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4']);
  const [m1] = imgs(s, ids['特集']);
  s = assign(s, m1.id, 4);
  const r = assignImage(s, m1.id, 6);
  assert.equal(r.ok, true);
  assert.equal(r.moved, true);
  const s2 = { ...s, pages: r.pages };
  assert.equal(at(s2, 4).renderImageId, null); // 元のページは空く
  assert.equal(at(s2, 6).renderImageId, m1.id);
  assert.equal(s2.pages.filter((p) => p.renderImageId === m1.id).length, 1);
});

test('割り当て済みページへのドロップ：確認なしで置き換え、古い素材は削除されず未割り当てへ戻る', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4']);
  const [m1, m2] = imgs(s, ids['特集']);
  s = assign(s, m1.id, 4);
  const r = assignImage(s, m2.id, 4);
  assert.equal(r.ok, true);
  assert.equal(r.replaced, true);
  const s2 = { ...s, pages: r.pages };
  assert.equal(at(s2, 4).renderImageId, m2.id);
  assert.equal(s2.renderImages.some((i) => i.id === m1.id), true); // 素材そのものは残る
  assert.equal(s2.pages.some((p) => p.renderImageId === m1.id), false); // 未割り当て
});

test('同じ素材を同じページへ：変更なし', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4']);
  const [m1] = imgs(s, ids['特集']);
  s = assign(s, m1.id, 4);
  const r = assignImage(s, m1.id, 4);
  assert.equal(r.unchanged, true);
  assert.equal(r.pages, s.pages);
});

test('割り当て解除：そのページの割り当てだけが外れ、素材・PDF・コンテンツ・配置は残る', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4']);
  const [m1, m2] = imgs(s, ids['特集']);
  s = assign(assign(s, m1.id, 4), m2.id, 5);
  const r = unassignPage(s, 4);
  assert.equal(r.ok, true);
  const s2 = { ...s, pages: r.pages };
  assert.equal(at(s2, 4).renderImageId, null);
  assert.equal(at(s2, 4).pdfAssetId, null);
  assert.equal(at(s2, 4).contentId, ids['特集']); // 配置は残る
  assert.equal(at(s2, 5).renderImageId, m2.id); // 他のページは変わらない
  assert.equal(s2.pdfAssets.length, 1);
  assert.equal(s2.renderImages.length, 2);
  assert.equal(unassignPage(s2, 4).ok, false); // すでに空
});

// ---- 順番に割り当て ----
test('順番に割り当て：未割り当て素材をPDF順に、未割り当てページを物理ページ番号順に割り当てる（A3は左→右）', () => {
  const { state, ids } = setup();
  const s = registerPdf(state, ids['特集'], ['a4', 'a3']); // 1ページ, 2ページ（左）, 2ページ（右）
  const plan = planSequentialAssign(s, ids['特集']);
  assert.equal(plan.count, 3);
  assert.deepEqual(plan.targets, [4, 5, 6]);
  const r = assignSequentially(s, ids['特集']);
  assert.equal(r.count, 3);
  assert.deepEqual(names({ ...s, pages: r.pages }, [4, 5, 6]), ['1ページ', '2ページ（左）', '2ページ（右）']);
});

test('順番に割り当て：既存の割り当ては上書きせず、残りの素材を残りのページへ。余った素材は未割り当てのまま', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4', 'a4', 'a4']); // 素材5つ・ページ3つ
  const m = imgs(s, ids['特集']);
  s = assign(s, m[2].id, 5); // P5 に「3ページ」を手動で割り当て済み
  const r = assignSequentially(s, ids['特集']);
  assert.equal(r.count, 2); // P4, P6 の2ページ
  const s2 = { ...s, pages: r.pages };
  // 未割り当て素材（1,2,4,5ページ）のうち先頭2つ（1,2）が、空きページP4,P6へ
  assert.deepEqual(names(s2, [4, 5, 6]), ['1ページ', '3ページ', '2ページ']);
  assert.equal(s2.pages.filter((p) => p.renderImageId).length, 3);
  assert.equal(s2.renderImages.length, 5); // 余った素材も保持
});

test('順番に割り当て：割り当て先／素材が0なら実行できない（ボタンを無効にする条件）', () => {
  const { state, ids } = setup();
  assert.equal(planSequentialAssign(state, ids['特集']).count, 0); // PDFなし
  assert.equal(assignSequentially(state, ids['特集']).ok, false);
  let s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']);
  s = { ...s, pages: assignSequentially(s, ids['特集']).pages };
  assert.equal(planSequentialAssign(s, ids['特集']).count, 0); // すべて割り当て済み
  const un = unplaceContent(state, ids['対談']);
  const s2 = registerPdf({ ...state, pages: un.pages }, ids['対談'], ['a4']);
  assert.equal(planSequentialAssign(s2, ids['対談']).count, 0); // 未配置（割り当て先なし）
});

test('順番に割り当て：他のコンテンツの素材・ページは対象外', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']);
  s = registerPdf(s, ids['対談'], ['a4', 'a4']);
  const r = assignSequentially(s, ids['対談']);
  assert.equal(r.count, 2);
  const s2 = { ...s, pages: r.pages };
  assert.deepEqual(names(s2, [9, 10]), ['1ページ', '2ページ']);
  assert.equal([4, 5, 6].some((n) => at(s2, n).renderImageId), false);
  assert.deepEqual(findIntegrityIssues(s2), []);
});

// ---- 配置・PDFの変更との関係 ----
test('Contentの配置解除：そのContentの割り当てだけ解除され、PdfAsset・RenderImage・Contentは残る', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']);
  s = registerPdf(s, ids['対談'], ['a4', 'a4']);
  s = seq(seq(s, ids['特集']), ids['対談']);
  const un = unplaceContent(s, ids['特集']);
  const s2 = { ...s, pages: un.pages };
  assert.equal(s2.pages.some((p) => p.contentId === ids['特集']), false);
  assert.equal([4, 5, 6].some((n) => at(s2, n).renderImageId), false);
  assert.equal(s2.pdfAssets.length, 2);
  assert.equal(s2.renderImages.length, 5);
  assert.equal(s2.contents.some((c) => c.id === ids['特集']), true);
  assert.deepEqual(names(s2, [9, 10]), ['1ページ', '2ページ']); // 他のコンテンツは変わらない
});

test('PDF削除：PdfAsset・素材・割り当てが外れ、Contentと配置は残る', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4']);
  s = { ...s, pages: assignSequentially(s, ids['特集']).pages };
  const r = buildUnregister(s, ids['特集'], 'delete');
  assert.equal(r.ok, true);
  assert.equal(r.releasedPages, 2);
  assert.equal(r.pdfAssets.length, 0);
  assert.equal(r.renderImages.length, 0);
  assert.equal(r.pages.some((p) => p.renderImageId || p.pdfAssetId), false);
  assert.deepEqual(r.pages.filter((p) => p.contentId === ids['特集']).map((p) => p.physicalPageNumber), [4, 5, 6]);
});

// ---- 4つの表示状態 ----
test('ページの状態：空き／PDF未登録／素材あり・未割り当て／画像。他コンテンツの素材だけでは「素材あり」にならない', () => {
  const { state, ids } = setup();
  assert.equal(pageState(state, at(state, 1)), 'empty');
  assert.equal(pageState(state, at(state, 4)), 'no-pdf');
  let s = registerPdf(state, ids['対談'], ['a4', 'a4']); // 「対談」だけにPDFがある
  assert.equal(pageState(s, at(s, 4)), 'no-pdf'); // 「特集」のページは、他コンテンツの素材があっても「PDF未登録」
  assert.equal(pageState(s, at(s, 9)), 'unassigned');
  assert.equal(pageState(s, at(s, 1)), 'empty');
  s = { ...s, pages: assignSequentially(s, ids['対談']).pages };
  assert.equal(pageState(s, at(s, 9)), 'image');
  assert.equal(pageState(s, at(s, 10)), 'image');
});

// ---- 右カラムの対象コンテンツ ----
test('対象コンテンツ：選んだもの → 選択ページのコンテンツ → 先頭。削除済みの指定は無視', () => {
  const { state, ids } = setup();
  const { contents, pages } = state;
  assert.equal(resolveMaterialContentId(contents, pages, 9, null), ids['対談']);
  assert.equal(resolveMaterialContentId(contents, pages, 9, ids['特集']), ids['特集']);
  assert.equal(resolveMaterialContentId(contents, pages, 1, null), contents[0].id); // 空きページ選択中は先頭
  assert.equal(resolveMaterialContentId(contents, pages, null, 'deleted'), contents[0].id);
  assert.equal(resolveMaterialContentId([], pages, null, null), null);
});

// ---- データ整合性 ----
test('整合性：正しいデータには違反がない。規則1〜4の違反を検出できる', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4']);
  s = registerPdf(s, ids['対談'], ['a4']);
  s = { ...s, pages: assignSequentially(s, ids['特集']).pages };
  assert.deepEqual(findIntegrityIssues(s), []);
  const mine = imgs(s, ids['特集']);
  const theirs = imgs(s, ids['対談'])[0];
  const swap = (no, patch) => ({ ...s, pages: s.pages.map((p) => (p.physicalPageNumber === no ? { ...p, ...patch } : p)) });
  assert.equal(findIntegrityIssues(swap(5, { renderImageId: theirs.id }))[0].rule, 1); // 別コンテンツの素材
  assert.equal(findIntegrityIssues(swap(6, { renderImageId: mine[0].id })).some((x) => x.rule === 2), true); // 同じ素材が2ページ
  assert.equal(findIntegrityIssues(swap(2, { renderImageId: mine[0].id })).some((x) => x.rule === 4), true); // コンテンツなしのページ
  assert.equal(findIntegrityIssues({ ...s, pages: s.pages.map((p) => (p.physicalPageNumber === 5 ? { ...p, contentId: null, contentPageIndex: null } : p)) }).some((x) => x.rule === 3), true); // 連続でない配置
});

test('すべての操作（割り当て・移動・置換・解除・配置移動・差し替え）のあとも整合性が保たれる', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a3', 'a4']);
  s = registerPdf(s, ids['対談'], ['a4', 'a4']);
  const step = (next) => {
    s = { ...s, ...next };
    assert.deepEqual(findIntegrityIssues(s), []);
  };
  step({ pages: assignSequentially(s, ids['特集']).pages });
  const m = imgs(s, ids['特集']);
  step({ pages: assignImage(s, m[3].id, 4).pages }); // 置換
  step({ pages: assignImage(s, m[3].id, 6).pages }); // 移動
  step({ pages: unassignPage(s, 5).pages });
  step({ pages: placeContent(s, ids['特集'], 12).pages }); // 配置移動
  step({ pages: assignSequentially(s, ids['対談']).pages });
  const rep = buildRegistration(s, ids['対談'], { fileName: 'b.pdf', pdfBlob: new Blob(['y']), converted: converted(['a4']), replaceMode: 'trash' });
  step({ pages: rep.pages, pdfAssets: rep.pdfAssets, renderImages: rep.renderImages });
});

test('読み込み時の修復：正常な割り当て（旧バージョンで登録・割り当て済みのもの）は1つも変更しない', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']);
  // 旧バージョンは登録時に、PDFの並び順どおりに割り当てていた
  s = { ...s, pages: assignSequentially(s, ids['特集']).pages };
  const fixed = repairAssignments(s);
  assert.equal(fixed.removed, 0);
  assert.equal(fixed.pages, s.pages);
});

test('読み込み時の修復：整合しない割り当てだけを外す（別コンテンツ・重複・コンテンツなし）。素材やPDFは変えない', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4']);
  s = registerPdf(s, ids['対談'], ['a4']);
  const mine = imgs(s, ids['特集']);
  const theirs = imgs(s, ids['対談'])[0];
  const put = (no, renderImageId, pdfAssetId) => ({ pageNo: no, renderImageId, pdfAssetId });
  const bad = [put(4, mine[0].id, s.pdfAssets[0].id), put(5, mine[0].id, s.pdfAssets[0].id), put(6, theirs.id, s.pdfAssets[1].id), put(2, mine[1].id, s.pdfAssets[0].id)];
  const pages = s.pages.map((p) => {
    const b = bad.find((x) => x.pageNo === p.physicalPageNumber);
    return b ? { ...p, renderImageId: b.renderImageId, pdfAssetId: b.pdfAssetId } : p;
  });
  const fixed = repairAssignments({ ...s, pages });
  assert.equal(fixed.removed, 3);
  const s2 = { ...s, pages: fixed.pages };
  assert.equal(at(s2, 4).renderImageId, mine[0].id); // 最初の1つは残す
  assert.equal(at(s2, 5).renderImageId, null);
  assert.equal(at(s2, 6).renderImageId, null);
  assert.equal(at(s2, 2).renderImageId, null);
  assert.deepEqual(findIntegrityIssues(s2), []);
});

// ---- Content.requiredPages を減らす：割り当て済みのページが解放されても拒否しない ----
// 結果を適用した新しい状態を返す（素材・PdfAssetは updateContent の対象外＝そのまま残る）
function shrink(state, contentId, name, pages) {
  const r = updateContent(state, contentId, name, String(pages));
  assert.equal(r.ok, true);
  return { ...state, contents: state.contents.map((c) => (c.id === contentId ? r.content : c)), pages: r.pages };
}
const assignedIds = (state) => state.pages.filter((p) => p.renderImageId).map((p) => p.renderImageId);

test('3P→2P（末尾に割り当てなし）：開始ページと先頭の割り当ては維持され、末尾は空きになる', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']);
  const m = imgs(s, ids['特集']);
  s = assign(assign(s, m[0].id, 4), m[1].id, 5); // P6 は未割り当て
  const s2 = shrink(s, ids['特集'], '特集', 2);
  assert.equal(at(s2, 4).renderImageId, m[0].id);
  assert.equal(at(s2, 5).renderImageId, m[1].id);
  assert.equal(at(s2, 6).contentId, null); // 解放
  assert.equal(pageState(s2, at(s2, 6)), 'empty');
  assert.deepEqual(findIntegrityIssues(s2), []);
});

test('3P→2P（末尾に割り当てあり）：事前の解除なしで減らせる。末尾の割り当てだけ解除され、素材は未割り当てで残る', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']);
  s = seq(s, ids['特集']);
  const m = imgs(s, ids['特集']); // P4=A, P5=B, P6=C
  const s2 = shrink(s, ids['特集'], '特集', 2);
  assert.deepEqual(names(s2, [4, 5, 6]), ['1ページ', '2ページ', null]);
  assert.equal(at(s2, 6).contentId, null);
  assert.equal(at(s2, 6).pdfAssetId, null);
  assert.equal(at(s2, 4).contentPageIndex, 0);
  assert.equal(at(s2, 5).contentPageIndex, 1);
  // 解放されたページの素材Cは削除されず、未割り当て素材として残る
  assert.equal(s2.renderImages.some((i) => i.id === m[2].id), true);
  assert.equal(assignedIds(s2).includes(m[2].id), false);
  assert.equal(planSequentialAssign(s2, ids['特集']).sources.map((i) => i.id).join(), m[2].id);
  assert.deepEqual(findIntegrityIssues(s2), []);
});

test('3P→1P（解放される2ページの双方に割り当てあり）：先頭だけ残り、2つの素材は未割り当てで残る', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']);
  s = seq(s, ids['特集']);
  const m = imgs(s, ids['特集']);
  const s2 = shrink(s, ids['特集'], '特集', 1);
  assert.deepEqual(names(s2, [4, 5, 6]), ['1ページ', null, null]);
  assert.equal(s2.pages.filter((p) => p.contentId === ids['特集']).length, 1);
  assert.equal(s2.renderImages.length, 3);
  assert.deepEqual(planSequentialAssign(s2, ids['特集']).sources.map((i) => i.id), [m[1].id, m[2].id]);
  assert.equal(planSequentialAssign(s2, ids['特集']).count, 0); // 割り当て先ページは無い
  assert.deepEqual(findIntegrityIssues(s2), []);
});

test('残るページの割り当てが維持される：PDF順と異なる手動の割り当ても保たれる', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']);
  const m = imgs(s, ids['特集']);
  s = assign(assign(assign(s, m[2].id, 4), m[0].id, 5), m[1].id, 6);
  const s2 = shrink(s, ids['特集'], '特集', 2);
  assert.deepEqual(names(s2, [4, 5, 6]), ['3ページ', '1ページ', null]);
  assert.equal(at(s2, 4).pdfAssetId, s2.pdfAssets[0].id);
});

test('PdfAssetと素材は維持される（個数・ID・メタ情報が変わらない）', () => {
  const { state, ids } = setup();
  let s = seq(registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']), ids['特集']);
  const s2 = shrink(s, ids['特集'], '特集', 1);
  assert.equal(s2.pdfAssets, s.pdfAssets);
  assert.equal(s2.renderImages, s.renderImages);
});

test('減らしたあとに増やしても、解除された割り当ては自動では戻らない', () => {
  const { state, ids } = setup();
  let s = seq(registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']), ids['特集']);
  s = shrink(s, ids['特集'], '特集', 2);
  const s2 = shrink(s, ids['特集'], '特集', 3);
  assert.deepEqual(names(s2, [4, 5, 6]), ['1ページ', '2ページ', null]);
  assert.equal(pageState(s2, at(s2, 6)), 'unassigned'); // 素材は残っているので「素材あり・未割り当て」
});

test('他コンテンツの割り当てには影響しない', () => {
  const { state, ids } = setup();
  let s = registerPdf(state, ids['特集'], ['a4', 'a4', 'a4']);
  s = registerPdf(s, ids['対談'], ['a4', 'a4']);
  s = seq(seq(s, ids['特集']), ids['対談']);
  const s2 = shrink(s, ids['特集'], '特集', 1);
  assert.deepEqual(names(s2, [9, 10]), ['1ページ', '2ページ']);
});
