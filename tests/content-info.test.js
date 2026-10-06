import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placementPages, placementLabel, pdfSummary, pdfSummaryLabel, materialCountLabel, pdfInfoRows } from '../src/js/domain/content-info.js';
import { circled } from '../src/js/ui/util.js';

const page = (no, contentId = null, idx = null, img = null) => ({
  id: `p${no}`,
  bookletId: 'b',
  physicalPageNumber: no,
  contentId,
  contentPageIndex: idx,
  pdfAssetId: img ? 'a1' : null,
  renderImageId: img,
});

test('配置ページは昇順で返る。未配置は空', () => {
  const pages = [page(6, 'c1', 2), page(4, 'c1', 0), page(5, 'c1', 1), page(7, 'c2', 0), page(8)];
  assert.deepEqual(placementPages(pages, 'c1'), [4, 5, 6]);
  assert.deepEqual(placementPages(pages, 'c2'), [7]);
  assert.deepEqual(placementPages(pages, 'none'), []);
});

test('配置の表記：少数は「P4, P5, P6」、多数は範囲、未配置は「未配置」', () => {
  assert.equal(placementLabel([]), '未配置');
  assert.equal(placementLabel([4]), 'P4');
  assert.equal(placementLabel([4, 5, 6]), 'P4, P5, P6');
  assert.equal(placementLabel([4, 5, 6, 7, 8, 9]), 'P4, P5, P6, P7, P8, P9'); // 6件まではそのまま
  assert.equal(placementLabel([4, 5, 6, 7, 8, 9, 10]), 'P4〜P10');
  assert.equal(placementLabel(Array.from({ length: 59 }, (_, i) => i + 4)), 'P4〜P62');
});

test('PDFの状況：割り当て済みページ数／必要ページ数。素材が無ければ「未登録」', () => {
  const content = { id: 'c1', requiredPages: 3 };
  const pages = [page(4, 'c1', 0, 'i1'), page(5, 'c1', 1, 'i2'), page(6, 'c1', 2, null), page(7, 'c2', 0, 'i9')];
  const withPdf = pdfSummary(content, pages, [{ id: 'a1', contentId: 'c1' }]);
  assert.deepEqual(withPdf, { assigned: 2, required: 3, hasPdf: true, materials: 0 });
  assert.equal(pdfSummaryLabel(withPdf), 'PDF：2/3P');
  const without = pdfSummary(content, pages.map((p) => ({ ...p, renderImageId: null })), []);
  assert.equal(pdfSummaryLabel(without), 'PDF：未登録');
});

test('PDFの状況：PDFがあっても未配置なら 0/必要ページ数', () => {
  const content = { id: 'c1', requiredPages: 2 };
  const s = pdfSummary(content, [page(1), page(2)], [{ id: 'a1', contentId: 'c1' }]);
  assert.equal(pdfSummaryLabel(s), 'PDF：0/2P');
});

test('「…」の配置情報：画像が割り当てられたページだけを、ページ番号の昇順で。複数ページなら①②付き', () => {
  const content = { id: 'c1', name: '特集記事', requiredPages: 3 };
  const pages = [page(6, 'c1', 2, 'i3'), page(4, 'c1', 0, 'i1'), page(5, 'c1', 1, null), page(8, 'c1', 3, 'i4')];
  assert.deepEqual(pdfInfoRows(content, pages, circled), [
    { pageNo: 4, label: '特集記事①' },
    { pageNo: 6, label: '特集記事③' },
    { pageNo: 8, label: '特集記事④' },
  ]);
  const single = { id: 'c2', name: '表紙', requiredPages: 1 };
  assert.deepEqual(pdfInfoRows(single, [page(1, 'c2', 0, 'x')], circled), [{ pageNo: 1, label: '表紙' }]);
});

test('「…」の配置情報：PDFが割り当てられていなければ空（「配置されているPDFはありません」を表示する）', () => {
  const content = { id: 'c1', name: '特集記事', requiredPages: 2 };
  assert.deepEqual(pdfInfoRows(content, [page(4, 'c1', 0), page(5, 'c1', 1)], circled), []);
});

test('素材数の補足：素材数が必要ページ数と異なるときだけ「素材 Nページ」を併記する', () => {
  const content = { id: 'c1', requiredPages: 3 };
  const pages = [page(4, 'c1', 0, 'i1'), page(5, 'c1', 1, 'i2'), page(6, 'c1', 2, null)];
  const images = (n) => Array.from({ length: n }, (_, i) => ({ id: `i${i + 1}`, pdfAssetId: 'a1' }));
  const assets = [{ id: 'a1', contentId: 'c1' }];
  const six = pdfSummary(content, pages, assets, images(6));
  assert.equal(six.materials, 6);
  assert.equal(pdfSummaryLabel(six), 'PDF：2/3P');
  assert.equal(materialCountLabel(six), '素材 6ページ');
  assert.equal(materialCountLabel(pdfSummary(content, pages, assets, images(3))), null); // 同数なら併記しない
  assert.equal(materialCountLabel(pdfSummary(content, pages, [], [])), null); // PDFなし
});
