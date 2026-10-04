import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import {
  createPackage,
  readPackage,
  safeFileName,
  manifestSchema,
  FORMAT_VERSION,
  LIMITS,
} from '../src/js/pageflow-file.js';
import { createBooklet } from '../src/js/domain/booklet.js';
import { addContent } from '../src/js/domain/content.js';
import { placeContent } from '../src/js/domain/placement.js';
import { buildRegistration } from '../src/js/domain/pdf.js';
import { buildViewerModel, buildViewerModelFromManifest, renderViewer } from '../src/js/ui/viewer.js';
import { setImage, clearImages } from '../src/js/images.js';

// ---- 準備：12P冊子。表紙に1P、特集(2P, P4-P5)に2ページのPDFを登録。他はPDF未登録 ----
const WEBP = (tag) => new Uint8Array([...strToU8('RIFF'), 0, 0, 0, 0, ...strToU8('WEBP'), ...strToU8(tag)]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup() {
  const set = createBooklet('テスト冊子', 12);
  let state = { ...set, pdfAssets: [], renderImages: [] };
  const a = addContent(state, '特集', '2');
  state = { ...state, contents: [...state.contents, a.content] };
  state = { ...state, pages: placeContent(state, a.content.id, 4).pages };
  const images = new Map();
  const reg = (contentId, n) => {
    const converted = Array.from({ length: n }, (_, i) => ({
      sourcePdfPage: i + 1,
      splitSide: 'none',
      imageBlob: new Blob([`img-${contentId.slice(0, 4)}-${i}`]),
      width: 1240,
      height: 1754,
    }));
    const r = buildRegistration(state, contentId, { fileName: 'secret-original.pdf', pdfBlob: new Blob(['%PDF-secret']), converted });
    assert.equal(r.ok, true);
    state = { ...state, pages: r.pages, pdfAssets: r.pdfAssets, renderImages: r.renderImages };
    r.put.renderImages.forEach((img, i) => images.set(img.id, { bytes: WEBP(`${contentId.slice(0, 4)}${i}`), type: 'image/webp' }));
  };
  reg(state.contents.find((c) => c.name === '表紙').id, 1);
  reg(a.content.id, 2);
  return { state, images };
}

const unzip = (bytes) => unzipSync(bytes);
const manifestOf = (bytes) => JSON.parse(strFromU8(unzip(bytes)['manifest.json']));
const zip = (files) => zipSync(files);
const goodManifest = () => ({
  formatVersion: 1,
  bookletName: 'テスト',
  totalPages: 8,
  bindingDirection: 'left',
  pages: Array.from({ length: 8 }, (_, i) => ({ pageNo: i + 1, contentName: `P${i + 1}`, contentPageIndex: null, contentPageCount: null, imageFile: null })),
});
const pkg = (manifest, extra = {}) => zip({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...extra });
const read = (bytes, name = 'x.pageflow') => readPackage(bytes, name);

// ---- 書き出し ----
test('.pageflowは1ファイル（ZIP）で、manifest.jsonとpages/配下の画像だけを含む', () => {
  const { state, images } = setup();
  const { bytes } = createPackage(state, images);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 0);
  assert.equal(bytes[0], 0x50); // 'PK'
  const names = Object.keys(unzip(bytes)).sort();
  assert.deepEqual(names, ['manifest.json', 'pages/page-001.webp', 'pages/page-004.webp', 'pages/page-005.webp']);
});

test('manifest：formatVersion=1、冊子名・総ページ数・綴じ方向、ページ数が正しい', () => {
  const { state, images } = setup();
  const m = manifestOf(createPackage(state, images).bytes);
  assert.equal(m.formatVersion, 1);
  assert.equal(FORMAT_VERSION, 1);
  assert.equal(m.bookletName, 'テスト冊子');
  assert.equal(m.totalPages, 12);
  assert.equal(m.bindingDirection, 'left');
  assert.equal(m.pages.length, 12);
  assert.deepEqual(m.pages.map((p) => p.pageNo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(manifestSchema.safeParse(m).success, true);
});

test('manifest：PDF登録済みページは画像ファイル、未登録ページはimageFile=null', () => {
  const { state, images } = setup();
  const m = manifestOf(createPackage(state, images).bytes);
  const f = Object.fromEntries(m.pages.map((p) => [p.pageNo, p.imageFile]));
  assert.equal(f[1], 'pages/page-001.webp');
  assert.equal(f[4], 'pages/page-004.webp');
  assert.equal(f[5], 'pages/page-005.webp');
  for (const n of [2, 3, 6, 7, 8, 9, 10, 11, 12]) assert.equal(f[n], null, `P${n}`);
});

test('manifest：コンテンツ名（固定ページ名・空き）と複数ページコンテンツの何ページ目か', () => {
  const { state, images } = setup();
  const m = manifestOf(createPackage(state, images).bytes);
  const byNo = Object.fromEntries(m.pages.map((p) => [p.pageNo, p]));
  assert.deepEqual([1, 2, 3, 11, 12].map((n) => byNo[n].contentName), ['表紙', '表紙裏', '目次', '裏表紙裏', '裏表紙']);
  assert.equal(byNo[6].contentName, '空き');
  assert.deepEqual([byNo[4].contentName, byNo[4].contentPageIndex, byNo[4].contentPageCount], ['特集', 1, 2]);
  assert.deepEqual([byNo[5].contentName, byNo[5].contentPageIndex, byNo[5].contentPageCount], ['特集', 2, 2]);
  assert.deepEqual([byNo[1].contentPageIndex, byNo[1].contentPageCount], [null, null]);
});

test('画像はRenderImageのBlobをそのまま格納する（再エンコードしない）', () => {
  const { state, images } = setup();
  const files = unzip(createPackage(state, images).bytes);
  const p4 = state.pages[3];
  assert.deepEqual(files['pages/page-004.webp'], images.get(p4.renderImageId).bytes);
});

test('PNGにフォールバックした画像は実際のMIMEに合った拡張子(.png)になる', () => {
  const { state, images } = setup();
  const p1 = state.pages[0];
  images.set(p1.renderImageId, { bytes: PNG, type: 'image/png' });
  const { bytes, manifest } = createPackage(state, images);
  assert.ok(unzip(bytes)['pages/page-001.png']);
  assert.equal(manifest.pages[0].imageFile, 'pages/page-001.png');
  assert.equal(read(bytes).ok, true);
});

test('元PDF・TrashPdf・編集用データが含まれない', () => {
  const { state, images } = setup();
  const { bytes } = createPackage(state, images);
  const files = unzip(bytes);
  for (const [name, data] of Object.entries(files)) {
    assert.match(name, /^(manifest\.json|pages\/page-\d{3}\.(webp|png|jpg))$/);
    const text = strFromU8(data);
    assert.doesNotMatch(text, /%PDF-secret/); // 元PDFのBlob
    assert.doesNotMatch(text, /secret-original/); // 元PDFのファイル名
  }
  assert.equal(Object.keys(files).some((n) => /\.pdf$/i.test(n) || /trash/i.test(n)), false);
  // manifest のキーは表示に必要な最小限のみ（編集用のID・必要ページ数・PDF関連・日時などを含めない）
  const m = manifestOf(bytes);
  assert.deepEqual(Object.keys(m).sort(), ['bindingDirection', 'bookletName', 'formatVersion', 'pages', 'totalPages']);
  for (const p of m.pages) assert.deepEqual(Object.keys(p).sort(), ['contentName', 'contentPageCount', 'contentPageIndex', 'imageFile', 'pageNo']);
  const json = JSON.stringify(m);
  for (const key of ['bookletId', 'contentId', 'requiredPages', 'isFixed', 'pdfAsset', 'renderImage', 'blob', 'createdAt', 'updatedAt', 'templateId']) {
    assert.equal(json.includes(key), false, key);
  }
});

test('PDF未登録の冊子でも書き出せる（全ページimageFile=null）', () => {
  const set = createBooklet('空の冊子', 8);
  const { bytes } = createPackage({ ...set, pdfAssets: [], renderImages: [] }, new Map());
  assert.deepEqual(Object.keys(unzip(bytes)), ['manifest.json']);
  assert.equal(manifestOf(bytes).pages.every((p) => p.imageFile === null), true);
});

// ---- ファイル名 ----
test('ファイル名：冊子名から安全な .pageflow 名を作る', () => {
  assert.equal(safeFileName('demo-booklet'), 'demo-booklet.pageflow');
  assert.equal(safeFileName('社内報 2026春号'), '社内報 2026春号.pageflow');
  assert.equal(safeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j.pageflow');
  assert.equal(safeFileName('  ..test..  '), 'test.pageflow');
  assert.equal(safeFileName('...'), 'booklet.pageflow');
  assert.equal(safeFileName(''), 'booklet.pageflow');
  assert.equal(safeFileName('CON'), 'booklet-CON.pageflow');
  assert.equal(safeFileName('a\u0000b\nc'), 'a_b_c.pageflow');
  assert.ok(safeFileName('あ'.repeat(200)).length <= 80 + '.pageflow'.length);
});

// ---- 読み込み（正常系）----
test('書き出したファイルをそのまま読み込める（画像・manifestが一致）', () => {
  const { state, images } = setup();
  const { bytes, manifest } = createPackage(state, images);
  const r = read(bytes, 'テスト冊子.pageflow');
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest, manifest);
  assert.equal(r.images.size, 3);
  assert.equal(r.images.get('pages/page-004.webp').type, 'image/webp');
  assert.deepEqual(r.images.get('pages/page-004.webp').bytes, images.get(state.pages[3].renderImageId).bytes);
});

test('拡張子の大文字小文字は区別しない', () => {
  const { state, images } = setup();
  assert.equal(read(createPackage(state, images).bytes, 'BOOK.PageFlow').ok, true);
});

test('編集データから開いたビューアと、.pageflowから開いたビューアが同じ表示になる', () => {
  const { state, images } = setup();
  const { bytes } = createPackage(state, images);
  const r = read(bytes);
  const urls = new Map([...r.images.keys()].map((f) => [f, `blob:${f}`]));
  const imported = buildViewerModelFromManifest(r.manifest, urls);
  // 編集データ側は、アプリと同様に生成画像をキャッシュ（Object URL）へ読み込んでからモデルを作る
  for (const [id, img] of images) setImage(id, new Blob([img.bytes], { type: img.type }));
  const edited = buildViewerModel(state);
  clearImages();
  // 画像URLの値は異なるため、有無とコンテンツ名・並びを比較する
  const norm = (m) => m.pages.map((p) => [p.physicalPageNumber, p.contentName, !!p.imageUrl]);
  assert.deepEqual(norm(imported), norm(edited));
  assert.equal(imported.totalPages, edited.totalPages);
  assert.equal(imported.bookletName, edited.bookletName);
  // 同じ画面部品で描画でき、見開きの構成（P2|P3）も同じ
  const html = renderViewer(imported, { pageNo: 4, showInfo: true, anim: null }, 'spread');
  assert.match(html, /data-viewer-page="4"[\s\S]*data-viewer-page="5"/);
  assert.match(html, /特集 ①/);
  assert.match(html, /特集 ②/);
});

test('manifestの文字列はHTMLとして挿入されない（エスケープ）', () => {
  const m = goodManifest();
  m.bookletName = '<img src=x onerror=alert(1)>';
  m.pages[3].contentName = '<script>alert(1)</script>';
  const r = read(pkg(m));
  assert.equal(r.ok, true);
  const model = buildViewerModelFromManifest(r.manifest, new Map());
  const html = renderViewer(model, { pageNo: 4, showInfo: true, anim: null }, 'spread');
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

// ---- 読み込み（異常系）----
const reason = (r) => (r.ok ? null : r.reason);

test('拡張子が .pageflow でないファイルを拒否する', () => {
  const { state, images } = setup();
  const { bytes } = createPackage(state, images);
  assert.match(reason(read(bytes, 'book.zip')), /拡張子/);
  assert.match(reason(read(bytes, 'book')), /拡張子/);
  assert.match(reason(read(bytes, 'book.pageflow.txt')), /拡張子/);
});

test('空ファイル・壊れたファイル（ZIPではない／途中で切れたZIP）を拒否し、例外を投げない', () => {
  assert.equal(read(new Uint8Array(0)).ok, false);
  assert.match(reason(read(strToU8('これはZIPではありません'))), /ZIP/);
  assert.match(reason(read(new Uint8Array([1, 2, 3, 4, 5]))), /ZIP/);
  const { state, images } = setup();
  const { bytes } = createPackage(state, images);
  assert.equal(read(bytes.slice(0, Math.floor(bytes.length / 2))).ok, false); // 途中で切れた
  const broken = bytes.slice();
  for (let i = 40; i < 120; i++) broken[i] ^= 0xff; // 中身を破壊
  assert.doesNotThrow(() => read(broken));
});

test('ランダムなデータを大量に与えても、例外を投げず拒否する', () => {
  for (let i = 0; i < 200; i++) {
    const bytes = new Uint8Array(1 + (i % 300)).map((_, k) => (k * 31 + i * 17) % 256);
    if (i % 2) { bytes[0] = 0x50; bytes[1] = 0x4b; }
    assert.doesNotThrow(() => read(bytes));
    assert.equal(read(bytes).ok, false);
  }
});

test('ZIPだがmanifest.jsonがないファイルを拒否する', () => {
  const r = read(zip({ 'pages/page-001.webp': WEBP('a'), 'readme.txt': strToU8('hi') }));
  assert.match(reason(r), /manifest\.json が見つかりません/);
});

test('manifest.jsonがJSONとして不正なファイルを拒否する', () => {
  assert.match(reason(read(zip({ 'manifest.json': strToU8('{ not json') }))), /JSON/);
  assert.match(reason(read(zip({ 'manifest.json': strToU8('[1,2]') }))), /形式が不正/);
  assert.match(reason(read(zip({ 'manifest.json': strToU8('null') }))), /形式が不正/);
});

test('非対応のformatVersionを拒否する（バージョンを明示）', () => {
  for (const v of [2, 0, 99]) {
    const m = { ...goodManifest(), formatVersion: v };
    assert.match(reason(read(pkg(m))), new RegExp(`非対応のバージョン.*${v}`));
  }
  const m = goodManifest();
  delete m.formatVersion;
  assert.match(reason(read(pkg(m))), /formatVersion がありません/);
  assert.match(reason(read(pkg({ ...goodManifest(), formatVersion: '1' }))), /formatVersion がありません/);
});

test('manifestの不正値をzodで拒否する', () => {
  const bad = (mutate, expectRe) => {
    const m = goodManifest();
    mutate(m);
    const r = read(pkg(m));
    assert.equal(r.ok, false, JSON.stringify(mutate.toString()));
    if (expectRe) assert.match(reason(r), expectRe);
  };
  bad((m) => { m.totalPages = 6; m.pages = m.pages.slice(0, 6); }, /totalPages/); // 4の倍数でも8以上でもない
  bad((m) => { m.totalPages = 4; m.pages = m.pages.slice(0, 4); }, /totalPages/);
  bad((m) => { m.totalPages = '8'; }, /totalPages/);
  bad((m) => { m.totalPages = 10; }, /totalPages|pages/);
  bad((m) => { m.pages = m.pages.slice(0, 7); }, /pages/); // 件数不一致
  bad((m) => { m.pages.push({ ...m.pages[0], pageNo: 9 }); }, /pages/);
  bad((m) => { m.bookletName = ''; }, /bookletName/);
  bad((m) => { m.bookletName = 'あ'.repeat(101); }, /bookletName/);
  bad((m) => { m.bookletName = 123; }, /bookletName/);
  bad((m) => { m.bindingDirection = 'right'; }, /bindingDirection/);
  bad((m) => { delete m.bindingDirection; }, /bindingDirection/);
  bad((m) => { m.pages = 'x'; }, /pages/);
  bad((m) => { m.pages[2].pageNo = 5; }, /pageNo/); // 連番でない
  bad((m) => { m.pages[1].pageNo = 1; }, /pageNo/); // 重複
  bad((m) => { m.pages[0].pageNo = 0; }, /pageNo/);
  bad((m) => { m.pages[0].pageNo = 1.5; }, /pageNo/);
  bad((m) => { m.pages[0].pageNo = '1'; }, /pageNo/);
  bad((m) => { m.pages[0].contentName = ''; }, /contentName/);
  bad((m) => { m.pages[0].contentName = null; }, /contentName/);
  bad((m) => { m.pages[0].contentPageIndex = 3; m.pages[0].contentPageCount = 2; }, /contentPageIndex/);
  bad((m) => { m.pages[0].contentPageIndex = 1; m.pages[0].contentPageCount = null; }, /contentPageIndex/);
  bad((m) => { m.pages[0].imageFile = undefined; delete m.pages[0].imageFile; }, /imageFile/);
});

test('imageFileの不正なパス（パス traversal・pages/外・拡張子違い・巨大な名前）を拒否する', () => {
  for (const f of ['../evil.webp', 'pages/../evil.webp', '/etc/passwd', 'evil.webp', 'pages/a/b.webp', 'pages/page-001.exe', 'pages/page-001.svg', 'pages/ page.webp', `pages/${'a'.repeat(200)}.webp`, 'pages\\x.webp', 'pages/x.webp\u0000']) {
    const m = goodManifest();
    m.pages[0].imageFile = f;
    assert.equal(read(pkg(m, { [f]: WEBP('x') })).ok, false, f);
  }
});

test('manifestが参照する画像が存在しない場合を拒否する', () => {
  const m = goodManifest();
  m.pages[2].imageFile = 'pages/page-003.webp';
  const r = read(pkg(m)); // 画像ファイルを入れない
  assert.match(reason(r), /P3.*page-003\.webp.*見つかりません/);
});

test('同じ画像を複数ページが参照している場合を拒否する', () => {
  const m = goodManifest();
  m.pages[0].imageFile = 'pages/page-001.webp';
  m.pages[1].imageFile = 'pages/page-001.webp';
  assert.match(reason(read(pkg(m, { 'pages/page-001.webp': WEBP('a') }))), /複数のページ/);
});

test('画像の中身が拡張子と一致しない（画像ではない）場合を拒否する', () => {
  const m = goodManifest();
  m.pages[0].imageFile = 'pages/page-001.webp';
  assert.match(reason(read(pkg(m, { 'pages/page-001.webp': strToU8('<html><script>alert(1)</script></html>') }))), /画像として不正/);
  assert.match(reason(read(pkg(m, { 'pages/page-001.webp': PNG }))), /画像として不正/); // PNGをwebp扱い
});

test('展開後サイズの上限：画像が大きすぎる／エントリが多すぎるファイルを展開前に拒否する', () => {
  const m = goodManifest();
  m.pages[0].imageFile = 'pages/page-001.webp';
  const big = new Uint8Array(LIMITS.imageBytes + 1024); // ゼロ埋め（圧縮するとごく小さい）
  big.set(WEBP('big'));
  const bomb = pkg(m, { 'pages/page-001.webp': [big, { level: 9 }] });
  assert.ok(bomb.length < 1024 * 1024); // 圧縮後は小さい＝ZIP爆弾の形
  assert.match(reason(read(bomb)), /大きすぎ/);

  const many = { 'manifest.json': strToU8(JSON.stringify(goodManifest())) };
  for (let i = 0; i < LIMITS.entries + 5; i++) many[`pages/x-${i}.webp`] = new Uint8Array(1);
  assert.match(reason(read(zip(many))), /エントリ数/);
});

test('余分なファイル（ZIP内のpages/外）は読み込まれず、無視される', () => {
  const r = read(pkg(goodManifest(), { 'evil.exe': strToU8('MZ'), 'x/y.txt': strToU8('hi') }));
  assert.equal(r.ok, true);
  assert.equal(r.images.size, 0);
});
