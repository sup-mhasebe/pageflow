// 実際の PDF.js と、実際の Canvas（@napi-rs/canvas）を通る統合テスト。
// モックではなく、本物のPDF解析・描画・WebP/JPEGエンコードを行い、生成された画像の画素を検証する。
// fixture は tests/fixtures/make-fixtures.mjs が生成する、小さな合成PDF（実データなし）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/js/pdf-core.js';
import { classifyPdfError } from '../src/js/domain/pdf-errors.js';
import { convertedPageCount } from '../src/js/domain/pdf.js';
import { loadNodeEnv, readFixture, decodeImage, pxOf, near } from './helpers/pdf-env.js';

const loaded = await loadNodeEnv();
const skip = loaded.ok ? false : `実Canvas（@napi-rs/canvas）を読み込めないためスキップ: ${loaded.reason}`;
const { env, napi } = loaded.ok ? loaded : {};
const A4W = 595.28;
const A4H = 841.89;
const A3W = 1190.55;
const quiet = (extra = {}) => ({ ...env, docOptions: { verbosity: 0, ...extra } }); // PDF.js の警告表示を抑える

const openAndConvert = async (name, e = env) => {
  const handle = await core.openDocument(e, readFixture(name));
  try {
    const items = await core.analyzePdf(handle.doc);
    const converted = await core.renderConvertedPages(e, handle.doc, items);
    return { items, converted };
  } finally {
    await core.closeDocument(handle);
  }
};

// ---- 正常なPDF（画像・透明・色空間・シェーディング）----
test('正常PDF：A4と判定され、1240px幅のWebP画像が1枚生成される', { skip }, async () => {
  const { items, converted } = await openAndConvert('image-transparency.pdf');
  assert.deepEqual(items, [{ pageNumber: 1, kind: 'a4', widthMm: 210, heightMm: 297 }]);
  assert.equal(converted.length, 1);
  assert.equal(converted[0].splitSide, 'none');
  assert.equal(converted[0].width, 1240);
  assert.ok(converted[0].height >= 1750 && converted[0].height <= 1758);
  assert.equal(converted[0].imageBlob.type, 'image/webp');
  assert.ok(converted[0].imageBlob.size > 0);
});

test('正常PDF：画像・透明・色空間・シェーディングが実際の描画結果に反映される（画素の検証）', { skip }, async () => {
  const { converted } = await openAndConvert('image-transparency.pdf');
  const img = await decodeImage(napi, converted[0].imageBlob);
  const at = (x, y) => img.at(...pxOf(x, y, A4H, img.width, A4W));
  assert.ok(near(at(10, 10), [230, 230, 230], 12), `背景グレー ${at(10, 10)}`);
  assert.ok(near(at(60, 790), [255, 0, 0], 30), `シェーディング左（赤） ${at(60, 790)}`);
  assert.ok(near(at(535, 790), [255, 255, 0], 30), `シェーディング右（黄） ${at(535, 790)}`);
  assert.ok(near(at(150, 660), [200, 30, 30], 20), `ICCBased画像 ${at(150, 660)}`);
  assert.ok(near(at(310, 660), [255, 255, 0], 40), `ソフトマスク：左は透明（背景の黄） ${at(310, 660)}`);
  assert.ok(near(at(495, 660), [0, 0, 255], 40), `ソフトマスク：右は不透明（青） ${at(495, 660)}`);
  const mid = at(400, 660);
  assert.ok(mid[2] > 60 && mid[2] < 220 && mid[0] > 40, `ソフトマスク：中央は黄と青の中間 ${mid}`);
  assert.ok(near(at(150, 500), [0, 185, 241], 30), `DeviceCMYK画像（シアン） ${at(150, 500)}`);
  assert.ok(near(at(400, 500), [0, 170, 0], 20), `Indexed（パレット）画像 ${at(400, 500)}`);
  assert.ok(near(at(150, 340), [115, 242, 115], 12), `不透明度0.5の緑がグレーの背景に重なる ${at(150, 340)}`);
});

// ---- A3横：中央50%で左→右に分割 ----
test('A3横：A3と判定され、中央50%で左（赤）→右（青）のA4相当2枚に分割される', { skip }, async () => {
  const { items, converted } = await openAndConvert('a3-landscape.pdf');
  assert.deepEqual(items, [{ pageNumber: 1, kind: 'a3', widthMm: 420, heightMm: 297 }]);
  assert.equal(convertedPageCount(items.map((i) => i.kind)), 2);
  assert.deepEqual(converted.map((c) => [c.sourcePdfPage, c.splitSide]), [[1, 'left'], [1, 'right']]);
  assert.ok(converted.every((c) => c.width === 1240 && c.height >= 1750 && c.height <= 1758 && c.imageBlob.type === 'image/webp'));
  const left = await decodeImage(napi, converted[0].imageBlob);
  const right = await decodeImage(napi, converted[1].imageBlob);
  const half = A3W / 2;
  const atL = (x, y) => left.at(...pxOf(x, y, A4H, left.width, half));
  const atR = (x, y) => right.at(...pxOf(x - half, y, A4H, right.width, half)); // 右半分は、ページ上のx座標から半分を引く
  assert.ok(near(atL(20, 20), [255, 0, 0], 12), `左の分割画像は赤 ${atL(20, 20)}`);
  assert.ok(near(atR(A3W - 20, 20), [0, 0, 255], 12), `右の分割画像は青 ${atR(A3W - 20, 20)}`);
  assert.ok(near(atL(300, 660), [200, 30, 30], 25), `左半分のICC画像 ${atL(300, 660)}`);
  assert.ok(near(atR(900, 660), [0, 185, 241], 30), `右半分のCMYK画像 ${atR(900, 660)}`);
  assert.ok(near(atL(250, 400), [255, 128, 128], 14), `左半分の半透明の白（赤の上） ${atL(250, 400)}`);
  assert.ok(near(atR(850, 400), [128, 128, 255], 14), `右半分の半透明の白（青の上） ${atR(850, 400)}`);
  // 分割線：中央の左右で色が入れ替わる（左の画像に青は混ざらない）
  assert.ok(near(left.at(left.width - 3, 10), [255, 0, 0], 12), '左の分割画像の右端も赤（青は混ざらない）');
  assert.ok(near(right.at(2, 10), [0, 0, 255], 12), '右の分割画像の左端も青（赤は混ざらない）');
});

test('A3横：生成済みの分割（precomputed）があれば、同じ画像をそのまま使い、再描画しない', { skip }, async () => {
  const handle = await core.openDocument(env, readFixture('a3-landscape.pdf'));
  try {
    const items = await core.analyzePdf(handle.doc);
    const pair = await core.renderSplitPair(env, handle.doc, 1);
    let canvasCalls = 0;
    const counting = { ...env, createCanvas: (w, h) => (canvasCalls++, env.createCanvas(w, h)) };
    const converted = await core.renderConvertedPages(counting, handle.doc, items, () => {}, new Map([[1, pair]]));
    assert.equal(canvasCalls, 0, '再描画していない');
    assert.equal(converted[0].imageBlob, pair[0].imageBlob);
    assert.equal(converted[1].imageBlob, pair[1].imageBlob);
  } finally {
    await core.closeDocument(handle);
  }
});

test('A3横：全体プレビュー（JPEG）も実際に生成できる', { skip }, async () => {
  const handle = await core.openDocument(env, readFixture('a3-landscape.pdf'));
  try {
    const blob = await core.renderPreviewBlob(env, handle.doc, 1);
    assert.equal(blob.type, 'image/jpeg');
    const img = await decodeImage(napi, blob);
    assert.equal(img.width, 640);
    assert.ok(near(img.at(20, 20), [255, 0, 0], 20) && near(img.at(img.width - 20, 20), [0, 0, 255], 20), '左が赤・右が青');
  } finally {
    await core.closeDocument(handle);
  }
});

// ---- 複数ページ・混在・対象外サイズ ----
test('複数ページ（A4×3）：PDFのページ順に3枚生成される', { skip }, async () => {
  const { converted } = await openAndConvert('multi-a4.pdf');
  assert.deepEqual(converted.map((c) => [c.sourcePdfPage, c.splitSide]), [[1, 'none'], [2, 'none'], [3, 'none']]);
  const colors = [];
  for (const c of converted) colors.push((await decodeImage(napi, c.imageBlob)).at(20, 20));
  assert.ok(near(colors[0], [255, 0, 0], 12) && near(colors[1], [0, 204, 0], 12) && near(colors[2], [0, 0, 255], 12), `赤・緑・青 ${JSON.stringify(colors)}`);
});

test('A4とA3の混在：A4(1) → A3の左・右(2) の順に3枚になる', { skip }, async () => {
  const { items, converted } = await openAndConvert('mixed-a4-a3.pdf');
  assert.deepEqual(items.map((i) => i.kind), ['a4', 'a3']);
  assert.deepEqual(converted.map((c) => [c.sourcePdfPage, c.splitSide]), [[1, 'none'], [2, 'left'], [2, 'right']]);
});

test('対象外のサイズ（A4横）：解析では対象外(kind=null)となり、変換しようとすると拒否する', { skip }, async () => {
  const handle = await core.openDocument(env, readFixture('a4-landscape.pdf'));
  try {
    const items = await core.analyzePdf(handle.doc);
    assert.equal(items[0].kind, null);
    assert.equal(items[0].widthMm, 297);
    await assert.rejects(() => core.renderConvertedPages(env, handle.doc, items), /対象外/);
  } finally {
    await core.closeDocument(handle);
  }
});

// ---- パスワード保護 ----
test('パスワード保護PDF：パスワードなし・誤りは PasswordException（code 1 / 2）→ 「password」に分類される', { skip }, async () => {
  for (const [opts, code] of [[undefined, 1], [{ password: 'wrong' }, 2]]) {
    const e = quiet(opts);
    const err = await core.openDocument(e, readFixture('password-protected.pdf')).catch((x) => x);
    assert.equal(err.name, 'PasswordException');
    assert.equal(err.code, code);
    const info = classifyPdfError(err, 'open');
    assert.equal(info.kind, 'password');
    assert.match(info.message, /パスワード/);
    assert.equal(info.detail.startsWith('PasswordException:'), true);
  }
});

test('パスワード保護PDF：正しいパスワードなら開けて描画でき、fixture自体は正常（暗号化が正しい）', { skip }, async () => {
  const { converted } = await openAndConvert('password-protected.pdf', quiet({ password: 'secret' }));
  const img = await decodeImage(napi, converted[0].imageBlob);
  assert.ok(near(img.at(...pxOf(150, 660, A4H, img.width, A4W)), [200, 30, 30], 20), '暗号化された画像ストリームも正しく復号されて描画される');
});

// ---- 破損PDF ----
for (const name of ['not-a-pdf.pdf', 'garbage.pdf', 'truncated.pdf']) {
  test(`破損PDF（${name}）：InvalidPDFException → 「corrupt」に分類される`, { skip }, async () => {
    const err = await core.openDocument(quiet(), readFixture(name)).catch((x) => x);
    assert.equal(err.name, 'InvalidPDFException');
    const info = classifyPdfError(err, 'open');
    assert.equal(info.kind, 'corrupt');
    assert.match(info.message, /壊れて|読み取れない/);
    assert.match(info.detail, /InvalidPDFException/);
  });
}

// ---- 読み込み成功後のレンダリング失敗 ----
test('レンダリング失敗：読み込み・解析に成功した後に描画で失敗すると「render」に分類される（キャンバスを作れない）', { skip }, async () => {
  const handle = await core.openDocument(quiet(), readFixture('image-transparency.pdf'));
  try {
    const items = await core.analyzePdf(handle.doc); // ここまでは成功
    assert.equal(items[0].kind, 'a4');
    const failing = { ...env, createCanvas: () => { throw new RangeError('Invalid array length'); } };
    const err = await core.renderConvertedPages(failing, handle.doc, items).catch((x) => x);
    assert.equal(err.name, 'RangeError');
    const info = classifyPdfError(err, 'convert');
    assert.equal(info.kind, 'render');
    assert.match(info.message, /画像を生成できませんでした|メモリ/);
    assert.match(info.detail, /RangeError: Invalid array length/);
  } finally {
    await core.closeDocument(handle);
  }
});

test('レンダリング失敗：メモリ不足などで2Dコンテキストを取得できない（null）場合、PDF.js の描画が拒否され「render」に分類される', { skip }, async () => {
  const handle = await core.openDocument(quiet(), readFixture('image-transparency.pdf'));
  const items = await core.analyzePdf(handle.doc);
  const noContext = {
    ...env,
    createCanvas(w, h) {
      const { canvas } = env.createCanvas(w, h);
      return { canvas, ctx: null }; // ブラウザの getContext('2d') が null を返す状況
    },
  };
  const err = await core.renderConvertedPages(noContext, handle.doc, items).catch((x) => x);
  assert.ok(err instanceof Error, 'PDF.jsの描画の失敗が例外として伝わる');
  const info = classifyPdfError(err, 'convert');
  assert.equal(info.kind, 'render');
  assert.ok(info.detail.length > 5, '実際の例外名・内容が技術情報に残る');
  await core.closeDocument(handle);
  assert.equal(handle.task.destroyed, true, '描画に失敗しても、PDF.js のリソースは解放できる');
});

test('PDF.js は描画中のCanvasの例外を吸収して描画を続ける（この挙動に依存して「描画失敗」を判定しない）', { skip }, async () => {
  const handle = await core.openDocument(quiet(), readFixture('image-transparency.pdf'));
  try {
    const items = await core.analyzePdf(handle.doc);
    const flaky = {
      ...env,
      createCanvas(w, h) {
        const { canvas, ctx } = env.createCanvas(w, h);
        const proxy = new Proxy(ctx, {
          get(t, p) {
            const v = Reflect.get(t, p);
            return typeof v === 'function' ? (p === 'save' ? () => { throw new Error('injected'); } : v.bind(t)) : v;
          },
          set: (t, p, v) => Reflect.set(t, p, v),
        });
        return { canvas, ctx: proxy };
      },
    };
    const converted = await core.renderConvertedPages(flaky, handle.doc, items);
    assert.equal(converted.length, 1); // 例外にならず、画像は生成される
  } finally {
    await core.closeDocument(handle);
  }
});

test('レンダリング失敗：画像への変換（エンコード）に失敗すると ImageEncodeError → 「render」に分類される', { skip }, async () => {
  const handle = await core.openDocument(quiet(), readFixture('image-transparency.pdf'));
  try {
    const items = await core.analyzePdf(handle.doc);
    const failing = { ...env, toBlob: async () => { throw new core.ImageEncodeError(); } };
    const err = await core.renderConvertedPages(failing, handle.doc, items).catch((x) => x);
    assert.equal(err.name, 'ImageEncodeError');
    assert.equal(classifyPdfError(err, 'convert').kind, 'render');
  } finally {
    await core.closeDocument(handle);
  }
});

test('A3：全体プレビューだけ失敗（JPEGの生成が不可）でも、左右の分割画像（WebP）は生成できる', { skip }, async () => {
  const jpegFails = { ...env, toBlob: (canvas, type, q) => (type === 'image/jpeg' ? Promise.reject(new core.ImageEncodeError()) : env.toBlob(canvas, type, q)) };
  const handle = await core.openDocument(quiet(), readFixture('a3-landscape.pdf'));
  try {
    await assert.rejects(() => core.renderPreviewBlob(jpegFails, handle.doc, 1), { name: 'ImageEncodeError' });
    const pair = await core.renderSplitPair(jpegFails, handle.doc, 1);
    assert.equal(pair.length, 2);
    assert.deepEqual(pair.map((p) => p.splitSide), ['left', 'right']);
    const left = await decodeImage(napi, pair[0].imageBlob);
    assert.ok(near(left.at(20, 20), [255, 0, 0], 12));
  } finally {
    await core.closeDocument(handle);
  }
});

test('A3：分割画像の生成にも失敗した場合は、分割結果を確認できないため「登録できない」旨を添えて分類される', { skip }, async () => {
  const allFail = { ...env, toBlob: () => Promise.reject(new core.ImageEncodeError()) };
  const handle = await core.openDocument(quiet(), readFixture('a3-landscape.pdf'));
  try {
    const err = await core.renderSplitPair(allFail, handle.doc, 1).catch((x) => x);
    const info = classifyPdfError(err, 'convert', { a3Fallback: true });
    assert.equal(info.kind, 'render');
    assert.match(info.message, /分割結果を確認できず、登録できません/);
  } finally {
    await core.closeDocument(handle);
  }
});

// ---- PDF.js リソースの解放（loading task のライフサイクル）----
function trackingEnv() {
  const tasks = [];
  const wrapped = {
    ...quiet(),
    pdfjs: {
      getDocument(opts) {
        const task = env.pdfjs.getDocument(opts);
        tasks.push(task);
        return task;
      },
    },
  };
  return { e: wrapped, tasks };
}

test('リソース解放：closeDocument で loading task が破棄され、破棄後はページを取得できない', { skip }, async () => {
  const { e, tasks } = trackingEnv();
  const handle = await core.openDocument(e, readFixture('image-transparency.pdf'));
  assert.equal(tasks[0].destroyed, false);
  await core.closeDocument(handle);
  assert.equal(tasks[0].destroyed, true);
  await assert.rejects(async () => handle.doc.getPage(1), { name: 'TypeError' }); // 解放済みのドキュメントは使えない（PDF.jsは同期的に例外を投げる）
});

test('リソース解放：closeDocument は何度呼んでも安全で、2回目以降は何もしない', { skip }, async () => {
  const { e, tasks } = trackingEnv();
  const handle = await core.openDocument(e, readFixture('image-transparency.pdf'));
  let destroyCalls = 0;
  const original = tasks[0].destroy.bind(tasks[0]);
  tasks[0].destroy = () => (destroyCalls++, original());
  await core.closeDocument(handle);
  await core.closeDocument(handle);
  await Promise.all([core.closeDocument(handle), core.closeDocument(handle)]);
  assert.equal(destroyCalls, 1);
  await core.closeDocument(null); // null も安全
});

test('リソース解放：読み込みに失敗（破損・パスワード）しても、loading task が破棄される（workerを残さない）', { skip }, async () => {
  for (const [name, opts] of [['not-a-pdf.pdf', {}], ['garbage.pdf', {}], ['password-protected.pdf', {}], ['password-protected.pdf', { password: 'wrong' }]]) {
    const { e, tasks } = trackingEnv();
    const err = await core.openDocument({ ...e, docOptions: { verbosity: 0, ...opts } }, readFixture(name)).catch((x) => x);
    assert.ok(err instanceof Error || err?.name);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].destroyed, true, `${name} ${JSON.stringify(opts)}`);
  }
});

test('リソース解放：登録の流れ（開く→解析→変換→閉じる）を繰り返しても、すべての loading task が破棄される', { skip }, async () => {
  const { e, tasks } = trackingEnv();
  for (let i = 0; i < 12; i++) {
    const handle = await core.openDocument(e, readFixture(i % 2 ? 'a3-landscape.pdf' : 'image-transparency.pdf'));
    const items = await core.analyzePdf(handle.doc);
    const converted = await core.renderConvertedPages(e, handle.doc, items);
    assert.ok(converted.length >= 1);
    await core.closeDocument(handle);
  }
  assert.equal(tasks.length, 12);
  assert.equal(tasks.every((t) => t.destroyed), true);
});

test('リソース解放：解析・描画の途中で閉じても例外が漏れない（キャンセル相当）', { skip }, async () => {
  const { e, tasks } = trackingEnv();
  const handle = await core.openDocument(e, readFixture('multi-a4.pdf'));
  const items = await core.analyzePdf(handle.doc);
  const pending = core.renderConvertedPages(e, handle.doc, items).catch((x) => x); // 描画を始めてすぐ閉じる
  await core.closeDocument(handle);
  const result = await pending;
  assert.ok(Array.isArray(result) || result instanceof Error || result?.name); // 完了または例外のどちらでも、未処理の拒否にならない
  assert.equal(tasks[0].destroyed, true);
});
