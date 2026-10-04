import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBooklet, resizeBooklet } from '../src/js/domain/booklet.js';
import { addContent, updateContent, deleteContent } from '../src/js/domain/content.js';
import { placeContent, unplaceContent } from '../src/js/domain/placement.js';
import {
  classifyPageSize,
  convertedPageCount,
  checkPageCount,
  buildRegistration,
  buildUnregister,
  relinkPages,
  orderedImages,
  PDF_IN_USE_MESSAGE,
} from '../src/js/domain/pdf.js';

// ---- 準備：12P冊子（固定 P1/P2/P3/P11/P12）、「特集」3Pを P4〜P6 に配置した状態 ----
function setup(requiredPages = 3, startNo = 4) {
  const set = createBooklet('テスト冊子', 12);
  let state = { ...set, pdfAssets: [], renderImages: [] };
  const added = addContent(state, '特集', String(requiredPages));
  state = { ...state, contents: [...state.contents, added.content] };
  const placed = placeContent(state, added.content.id, startNo);
  assert.equal(placed.ok, true);
  state = { ...state, pages: placed.pages };
  return { state, id: added.content.id };
}

// kinds（'a4' | 'a3'）から、PDF.js 変換後に相当する converted 配列を作る（A3は 左 → 右）
function fakeConverted(kinds) {
  const out = [];
  kinds.forEach((k, i) => {
    const n = i + 1;
    if (k === 'a3') {
      out.push({ sourcePdfPage: n, splitSide: 'left', imageBlob: new Blob([`${n}L`]), width: 1240, height: 1754 });
      out.push({ sourcePdfPage: n, splitSide: 'right', imageBlob: new Blob([`${n}R`]), width: 1240, height: 1754 });
    } else {
      out.push({ sourcePdfPage: n, splitSide: 'none', imageBlob: new Blob([`${n}`]), width: 1240, height: 1754 });
    }
  });
  return out;
}

function register(state, id, kinds, replaceMode) {
  const r = buildRegistration(state, id, {
    fileName: 'sample.pdf',
    pdfBlob: new Blob(['pdf']),
    converted: fakeConverted(kinds),
    replaceMode,
  });
  if (!r.ok) return { r, state };
  return { r, state: { ...state, pages: r.pages, pdfAssets: r.pdfAssets, renderImages: r.renderImages } };
}

// 冊子ページ → 画像（sourcePdfPage + 側）の対応を文字列で返す
const mapping = (state, nums) =>
  nums.map((n) => {
    const p = state.pages.find((x) => x.physicalPageNumber === n);
    const img = state.renderImages.find((i) => i.id === p.renderImageId);
    return img ? `${img.sourcePdfPage}${img.splitSide === 'left' ? 'L' : img.splitSide === 'right' ? 'R' : ''}` : '未登録';
  });

// ---- ページサイズ判定 ----
test('サイズ判定：A4縦はa4、A3横はa3、それ以外は対象外(null)', () => {
  assert.equal(classifyPageSize(595.28, 841.89), 'a4');
  assert.equal(classifyPageSize(594, 842), 'a4'); // 丸め誤差
  assert.equal(classifyPageSize(1190.55, 841.89), 'a3');
  assert.equal(classifyPageSize(1191, 842), 'a3');
  assert.equal(classifyPageSize(841.89, 595.28), null); // A4横
  assert.equal(classifyPageSize(841.89, 1190.55), null); // A3縦
  assert.equal(classifyPageSize(612, 792), null); // Letter
  assert.equal(classifyPageSize(498.9, 708.66), null); // B5
});

test('変換後ページ数：A4は1、A3横は2', () => {
  assert.equal(convertedPageCount(['a4']), 1);
  assert.equal(convertedPageCount(['a4', 'a4', 'a4']), 3);
  assert.equal(convertedPageCount(['a3']), 2);
  assert.equal(convertedPageCount(['a3', 'a3']), 4);
  assert.equal(convertedPageCount(['a4', 'a3']), 3);
});

// ---- ページ数の照合 ----
test('ページ数照合：同数・不足は登録可、超過は不可', () => {
  assert.deepEqual(checkPageCount(3, 3), { ok: true, shortage: 0 });
  assert.deepEqual(checkPageCount(2, 3), { ok: true, shortage: 1 });
  const over = checkPageCount(3, 2);
  assert.equal(over.ok, false);
  assert.match(over.reason, /3ページ/);
});

// ---- 登録 ----
test('A4・1ページ：1Pコンテンツに登録でき、冊子ページへ画像が対応付く', () => {
  const { state, id } = setup(1, 4);
  const { r, state: s } = register(state, id, ['a4']);
  assert.equal(r.ok, true);
  assert.deepEqual(mapping(s, [4]), ['1']);
  assert.equal(s.pages[3].pdfAssetId, s.pdfAssets[0].id);
});

test('A4・複数ページ（必要ページ数と一致）：P4←1, P5←2, P6←3', () => {
  const { state, id } = setup(3, 4);
  const { r, state: s } = register(state, id, ['a4', 'a4', 'a4']);
  assert.equal(r.ok, true);
  assert.equal(r.shortage, 0);
  assert.deepEqual(mapping(s, [4, 5, 6]), ['1', '2', '3']);
  assert.equal(s.pdfAssets[0].pageCount, 3);
});

test('PDFページ数不足：登録でき、不足分(P6)は「PDF未登録」のまま', () => {
  const { state, id } = setup(3, 4);
  const { r, state: s } = register(state, id, ['a4', 'a4']);
  assert.equal(r.ok, true);
  assert.equal(r.shortage, 1);
  assert.deepEqual(mapping(s, [4, 5, 6]), ['1', '2', '未登録']);
  assert.equal(s.pages[5].pdfAssetId, null);
});

test('PDFページ数超過：登録不可。必要ページ数・配置・PDF状態は変わらない', () => {
  const { state, id } = setup(2, 4);
  const before = JSON.stringify(state);
  const { r } = register(state, id, ['a4', 'a4', 'a4']);
  assert.equal(r.ok, false);
  assert.match(r.reason, /超えている/);
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.contents.find((c) => c.id === id).requiredPages, 2);
});

test('A3横・1ページ：A4×2になり、左が先のページ(P4)・右が次のページ(P5)', () => {
  const { state, id } = setup(2, 4);
  const { r, state: s } = register(state, id, ['a3']);
  assert.equal(r.ok, true);
  assert.deepEqual(mapping(s, [4, 5]), ['1L', '1R']);
  assert.equal(s.pdfAssets[0].pageCount, 2);
});

test('A3横・複数ページ：1L,1R,2L,2R の順で連続ページへ', () => {
  const { state, id } = setup(4, 4);
  const { r, state: s } = register(state, id, ['a3', 'a3']);
  assert.equal(r.ok, true);
  assert.deepEqual(mapping(s, [4, 5, 6, 7]), ['1L', '1R', '2L', '2R']);
  assert.deepEqual(
    orderedImages(s.renderImages, s.pdfAssets[0].id).map((i) => `${i.sourcePdfPage}${i.splitSide}`),
    ['1left', '1right', '2left', '2right'],
  );
});

test('A4とA3の混在：A4(1) → A3(2L,2R) の順', () => {
  const { state, id } = setup(3, 4);
  const { state: s } = register(state, id, ['a4', 'a3']);
  assert.deepEqual(mapping(s, [4, 5, 6]), ['1', '2L', '2R']);
});

test('A3分割後のページ数超過：1PコンテンツにA3横1ページ（→2ページ）は登録不可', () => {
  const { state, id } = setup(1, 4);
  const { r } = register(state, id, ['a3']);
  assert.equal(r.ok, false);
  assert.match(r.reason, /2ページ.*1ページ/);
});

test('固定ページ（表紙）にもPDFを登録できる', () => {
  const { state } = setup();
  const cover = state.contents.find((c) => c.name === '表紙');
  const { r, state: s } = register(state, cover.id, ['a4']);
  assert.equal(r.ok, true);
  assert.deepEqual(mapping(s, [1]), ['1']);
});

test('未配置のコンテンツにはPDFを登録できない', () => {
  const { state, id } = setup();
  const un = unplaceContent(state, id);
  const s = { ...state, pages: un.pages };
  assert.equal(buildRegistration(s, id, { fileName: 'a.pdf', pdfBlob: new Blob(['x']), converted: fakeConverted(['a4']) }).ok, false);
});

test('RenderImage／PdfAssetのレコードに必要な項目が揃い、Blobを保持する', () => {
  const { state, id } = setup(2, 4);
  const { r } = register(state, id, ['a3']);
  assert.ok(r.put.pdfAsset.blob instanceof Blob);
  assert.equal(r.put.pdfAsset.contentId, id);
  assert.equal(r.put.pdfAsset.status, 'ready');
  assert.equal(r.put.renderImages.length, 2);
  for (const img of r.put.renderImages) {
    assert.equal(img.pdfAssetId, r.put.pdfAsset.id);
    assert.ok(img.imageBlob instanceof Blob);
    assert.ok(img.width > 0 && img.height > 0);
  }
  // 保存対象のメタ情報（stateに載るもの）にはBlobを含めない
  assert.equal('blob' in r.pdfAssets[0], false);
  assert.equal('imageBlob' in r.renderImages[0], false);
});

// ---- 差し替え ----
test('差し替え：旧PDFの扱い（trash/delete）を選ばないと確定できない', () => {
  const { state, id } = setup(3, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4', 'a4']);
  const { r } = register(s1, id, ['a4', 'a4'], undefined);
  assert.equal(r.ok, false);
  assert.match(r.reason, /差し替え方法/);
  assert.equal(s1.pdfAssets.length, 1); // 旧PDFはそのまま
});

test('差し替え（ゴミ箱へ移動）：旧PdfAssetはtrashAssetIdsに入り、旧画像は置き換わる', () => {
  const { state, id } = setup(3, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4', 'a4']);
  const old = s1.pdfAssets[0];
  const oldImageIds = s1.renderImages.map((i) => i.id);
  const { r, state: s2 } = register(s1, id, ['a4', 'a4'], 'trash');
  assert.equal(r.ok, true);
  assert.deepEqual(r.trashAssetIds, [old.id]);
  assert.deepEqual(r.deleteAssetIds, []);
  assert.deepEqual(r.removedImageIds.sort(), oldImageIds.sort());
  assert.equal(s2.pdfAssets.length, 1);
  assert.notEqual(s2.pdfAssets[0].id, old.id);
  assert.deepEqual(mapping(s2, [4, 5, 6]), ['1', '2', '未登録']);
});

test('差し替え（完全削除）：旧PdfAssetはdeleteAssetIdsに入り、trashには入らない', () => {
  const { state, id } = setup(3, 4);
  const { state: s1 } = register(state, id, ['a4']);
  const old = s1.pdfAssets[0];
  const { r } = register(s1, id, ['a4', 'a4'], 'delete');
  assert.equal(r.ok, true);
  assert.deepEqual(r.deleteAssetIds, [old.id]);
  assert.deepEqual(r.trashAssetIds, []);
});

test('差し替えで超過する場合は拒否し、旧PDFは残る', () => {
  const { state, id } = setup(2, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4']);
  const { r } = register(s1, id, ['a4', 'a4', 'a4'], 'trash');
  assert.equal(r.ok, false);
  assert.equal(s1.pdfAssets.length, 1);
});

// ---- 登録解除 ----
test('PDF登録解除：Contentと配置は残り、PDFとの関連だけ解除される', () => {
  const { state, id } = setup(3, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4', 'a4']);
  const r = buildUnregister(s1, id, 'trash');
  assert.equal(r.ok, true);
  const s2 = { ...s1, pages: r.pages, pdfAssets: r.pdfAssets, renderImages: r.renderImages };
  assert.deepEqual(r.trashAssetIds, [s1.pdfAssets[0].id]);
  assert.equal(s2.pdfAssets.length, 0);
  assert.equal(s2.renderImages.length, 0);
  assert.deepEqual(mapping(s2, [4, 5, 6]), ['未登録', '未登録', '未登録']);
  // 配置（コンテンツとの対応）は残る
  assert.deepEqual(s2.pages.filter((p) => p.contentId === id).map((p) => p.physicalPageNumber), [4, 5, 6]);
  assert.equal(s2.contents.some((c) => c.id === id), true);
});

test('PDF登録解除（完全削除）：deleteAssetIdsに入る。扱いを選ばない場合は拒否', () => {
  const { state, id } = setup(1, 4);
  const { state: s1 } = register(state, id, ['a4']);
  assert.equal(buildUnregister(s1, id, undefined).ok, false);
  const r = buildUnregister(s1, id, 'delete');
  assert.deepEqual(r.deleteAssetIds, [s1.pdfAssets[0].id]);
  assert.deepEqual(r.trashAssetIds, []);
});

// ---- 配置との連動 ----
test('配置解除はPDF登録解除とは別：配置解除でページ対応は外れるがPdfAssetは残り、再配置で画像が戻る', () => {
  const { state, id } = setup(2, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4']);
  const un = unplaceContent(s1, id);
  const s2 = { ...s1, pages: un.pages };
  assert.equal(s2.pdfAssets.length, 1); // PdfAsset は残る
  assert.equal(s2.pages[3].renderImageId, null);
  const re = placeContent(s2, id, 7);
  assert.equal(re.ok, true);
  assert.deepEqual(mapping({ ...s2, pages: re.pages }, [7, 8]), ['1', '2']);
});

test('D&D移動：PDFはコンテンツに付随して新しい位置へ移り、旧位置は未登録に戻る', () => {
  const { state, id } = setup(2, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4']);
  const mv = placeContent(s1, id, 8);
  assert.equal(mv.ok, true);
  const s2 = { ...s1, pages: mv.pages };
  assert.deepEqual(mapping(s2, [4, 5, 8, 9]), ['未登録', '未登録', '1', '2']);
});

test('relinkPages：入力を変更せず、変化が無ければ同じページオブジェクトを返す', () => {
  const { state, id } = setup(2, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4']);
  const again = relinkPages(s1);
  assert.deepEqual(again, s1.pages);
  again.forEach((p, i) => assert.equal(p, s1.pages[i]));
});

// ---- 総ページ数の縮小・コンテンツのページ数減少（PDF登録済みデータを暗黙に消さない）----
test('総ページ数縮小：削除対象ページにPDFがあれば拒否（メッセージ確認）', () => {
  const { state, id } = setup(2, 9); // P9-P10
  const { state: s1 } = register(state, id, ['a4']);
  const r = resizeBooklet(s1, 8);
  assert.equal(r.ok, false);
  assert.equal(r.reason, PDF_IN_USE_MESSAGE);
});

test('総ページ数縮小：PDF登録済みの固定ページ(裏表紙)が再配置される場合は拒否、増加でも拒否', () => {
  const { state } = setup();
  const back = state.contents.find((c) => c.name === '裏表紙');
  const { state: s1 } = register(state, back.id, ['a4']);
  const shrink = resizeBooklet(s1, 8);
  assert.equal(shrink.ok, false);
  assert.equal(shrink.reason, PDF_IN_USE_MESSAGE);
  const grow = resizeBooklet(s1, 16);
  assert.equal(grow.ok, false);
  assert.equal(grow.reason, PDF_IN_USE_MESSAGE);
});

test('総ページ数縮小：影響を受けないページ(表紙P1)のPDFは保持され、縮小できる', () => {
  const { state } = setup();
  const cover = state.contents.find((c) => c.name === '表紙');
  const { state: s1 } = register(state, cover.id, ['a4']);
  const r = resizeBooklet(s1, 8);
  assert.equal(r.ok, true);
  assert.equal(r.pages[0].renderImageId, s1.pages[0].renderImageId);
});

test('コンテンツのページ数減少：解放されるページにPDFがあれば拒否', () => {
  const { state, id } = setup(3, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4', 'a4']);
  const r = updateContent(s1, id, '特集', '2');
  assert.equal(r.ok, false);
  assert.match(r.errors.requiredPages, /PDFが登録されているページ/);
});

test('コンテンツのページ数減少：解放されるページにPDFが無ければ可能（PDFは変更されない）', () => {
  const { state, id } = setup(3, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4']); // P6は未登録
  const r = updateContent(s1, id, '特集', '2');
  assert.equal(r.ok, true);
  assert.deepEqual(mapping({ ...s1, pages: r.pages }, [4, 5, 6]), ['1', '2', '未登録']);
});

test('コンテンツのページ数増加：PDF登録済みでも後続が空いていれば拡張でき、既存PDFは維持される', () => {
  const { state, id } = setup(2, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4']);
  const r = updateContent(s1, id, '特集', '3');
  assert.equal(r.ok, true);
  assert.deepEqual(mapping({ ...s1, pages: r.pages }, [4, 5, 6]), ['1', '2', '未登録']);
});

test('コンテンツ削除（PDFあり）：扱いを選ばない場合は拒否し、何も変更しない', () => {
  const { state, id } = setup(2, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4']);
  const before = JSON.stringify(s1.pages);
  for (const mode of [undefined, null, '', 'cancel']) {
    const r = deleteContent(s1, id, mode);
    assert.equal(r.ok, false);
    assert.match(r.reason, /PDFの扱い/);
  }
  assert.equal(JSON.stringify(s1.pages), before);
});

test('コンテンツ削除（PDFをゴミ箱へ）：Contentと配置は削除、PDFはtrashAssetIdsへ（完全削除ではない）', () => {
  const { state, id } = setup(2, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4']);
  const r = deleteContent(s1, id, 'trash');
  assert.equal(r.ok, true);
  assert.deepEqual(r.trashAssetIds, [s1.pdfAssets[0].id]);
  assert.deepEqual(r.deleteAssetIds, []);
  assert.equal(r.contents.some((c) => c.id === id), false); // Contentは削除
  assert.equal(r.pages.some((p) => p.contentId === id), false); // 配置も削除
  assert.equal(r.pdfAssets.length, 0);
  assert.equal(r.renderImages.length, 0);
  assert.equal(r.pages.some((p) => p.renderImageId || p.pdfAssetId), false);
});

test('コンテンツ削除（PDFも完全削除）：PdfAsset・RenderImageはdeleteAssetIdsへ、trashには入らない', () => {
  const { state, id } = setup(2, 4);
  const { state: s1 } = register(state, id, ['a4', 'a4']);
  const r = deleteContent(s1, id, 'delete');
  assert.equal(r.ok, true);
  assert.deepEqual(r.deleteAssetIds, [s1.pdfAssets[0].id]);
  assert.deepEqual(r.trashAssetIds, []);
  assert.equal(r.contents.some((c) => c.id === id), false);
  assert.equal(r.pages.some((p) => p.contentId === id), false);
  assert.equal(r.removedImageIds.length, 2);
});

test('コンテンツ削除（PDFなし）：mode不要で通常どおり削除できる', () => {
  const { state, id } = setup(2, 4);
  const r = deleteContent(state, id);
  assert.equal(r.ok, true);
  assert.deepEqual(r.trashAssetIds, []);
  assert.deepEqual(r.deleteAssetIds, []);
});

test('コンテンツ削除（PDFあり・未配置）：未配置でもPDFの扱いの選択が必要', () => {
  const { state, id } = setup(2, 4);
  const { state: s1 } = register(state, id, ['a4']);
  const un = unplaceContent(s1, id);
  const s2 = { ...s1, pages: un.pages };
  assert.equal(deleteContent(s2, id).ok, false);
  assert.equal(deleteContent(s2, id, 'trash').ok, true);
});
