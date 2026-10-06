import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPdfError, describeError, ERROR_KINDS } from '../src/js/domain/pdf-errors.js';

const err = (name, message, extra = {}) => Object.assign(new Error(message), { name, ...extra });

test('分類は6種類：password / corrupt / render / storage / environment / unknown', () => {
  assert.deepEqual([...ERROR_KINDS].sort(), ['corrupt', 'environment', 'password', 'render', 'storage', 'unknown']);
});

test('パスワード保護：PasswordException は、どの段階でも「password」', () => {
  for (const stage of ['open', 'analyze', 'preview', 'convert', 'save']) {
    const info = classifyPdfError(err('PasswordException', 'No password given', { code: 1 }), stage);
    assert.equal(info.kind, 'password', stage);
    assert.match(info.message, /パスワード/);
  }
});

test('破損：InvalidPDFException・FormatError・構造エラーのメッセージは、読み込み・解析段階で「corrupt」', () => {
  for (const e of [err('InvalidPDFException', 'Invalid PDF structure.'), err('FormatError', 'bad xref'), err('MissingPDFException', 'Missing PDF'), err('Error', 'Invalid or corrupted PDF file.')]) {
    assert.equal(classifyPdfError(e, 'open').kind, 'corrupt', e.name);
  }
  // ページ情報を取り出せない（解析段階）は、原因が何であれページ構造の問題として「corrupt」
  assert.equal(classifyPdfError(err('Error', 'something unexpected'), 'analyze').kind, 'corrupt');
});

test('描画失敗：プレビュー・変換段階の失敗は、メモリ不足や画像生成の失敗を含めて「render」', () => {
  for (const stage of ['preview', 'convert']) {
    for (const e of [err('RangeError', 'Invalid array length'), err('ImageEncodeError', '画像の生成に失敗しました。'), err('Error', 'canvas failure'), err('Error', 'whatever')]) {
      assert.equal(classifyPdfError(e, stage).kind, 'render', `${stage}: ${e.name}`);
    }
  }
});

test('保存容量：QuotaExceededError は「storage」。保存段階のその他は「unknown」（画像系の失敗は「render」）', () => {
  assert.equal(classifyPdfError(err('QuotaExceededError', 'The quota has been exceeded.'), 'save').kind, 'storage');
  assert.equal(classifyPdfError(err('Error', 'Storage quota reached'), 'save').kind, 'storage');
  assert.equal(classifyPdfError(err('AbortError', 'transaction aborted'), 'save').kind, 'unknown');
  assert.equal(classifyPdfError(err('ImageEncodeError', 'x'), 'save').kind, 'render');
});

test('環境：PDF.js のworker・モジュールの読み込み失敗（古いキャッシュとの食い違いなど）は「environment」', () => {
  for (const m of ['The API version "6.3.289" does not match the Worker version "6.0.1".', 'Setting up fake worker failed: "x".', 'Failed to fetch dynamically imported module: http://x/pdf.worker.js']) {
    const info = classifyPdfError(err('Error', m), 'open');
    assert.equal(info.kind, 'environment', m);
    assert.match(info.message, /Ctrl\+F5/);
  }
});

test('その他：どれにも当てはまらない例外は「unknown」。技術情報を添えるよう案内する', () => {
  const info = classifyPdfError(err('TypeError', 'x is not a function'), 'open');
  assert.equal(info.kind, 'unknown');
  assert.match(info.message, /技術情報/);
});

test('実際の例外名・内容は detail に残る（「例外名: メッセージ」）。個人情報（ファイル名など）は含まない', () => {
  const info = classifyPdfError(err('InvalidPDFException', 'Invalid PDF structure.'), 'open');
  assert.equal(info.detail, 'InvalidPDFException: Invalid PDF structure.');
  assert.equal(info.name, 'InvalidPDFException');
  assert.equal(info.rawMessage, 'Invalid PDF structure.');
  assert.equal(info.stage, 'open');
  assert.doesNotMatch(JSON.stringify(info), /\.pdf/i);
});

test('すべての分類に、原因が分かる見出しと文言がある。「PDFを読み込めませんでした」だけの一括表示ではない', () => {
  const messages = new Set();
  const titles = new Set();
  for (const [e, stage] of [
    [err('PasswordException', 'x', { code: 1 }), 'open'],
    [err('InvalidPDFException', 'x'), 'open'],
    [err('RangeError', 'x'), 'convert'],
    [err('QuotaExceededError', 'x'), 'save'],
    [err('Error', 'does not match the Worker version'), 'open'],
    [err('TypeError', 'x'), 'open'],
  ]) {
    const info = classifyPdfError(e, stage);
    assert.ok(info.title.length > 0 && info.message.length > 20);
    messages.add(info.message);
    titles.add(info.title);
  }
  assert.equal(messages.size, 6);
  assert.equal(titles.size, 6);
  assert.equal([...messages].some((m) => m === 'PDFを読み込めませんでした。'), false);
});

test('A3：分割結果を確認できない場合の文言（描画失敗のときだけ追記する）', () => {
  const e = err('ImageEncodeError', 'x');
  assert.match(classifyPdfError(e, 'convert', { a3Fallback: true }).message, /分割結果を確認できず、登録できません/);
  assert.doesNotMatch(classifyPdfError(e, 'convert').message, /分割結果を確認できず/);
  assert.doesNotMatch(classifyPdfError(err('PasswordException', 'x', { code: 1 }), 'open', { a3Fallback: true }).message, /分割結果/);
});

test('Errorではない値が投げられても扱える（文字列・null・undefined）', () => {
  for (const v of ['oops', null, undefined, 42, { message: 'plain object' }]) {
    const info = classifyPdfError(v, 'open');
    assert.ok(ERROR_KINDS.includes(info.kind));
    assert.equal(typeof info.detail, 'string');
  }
  assert.deepEqual(describeError('oops'), { name: 'string', message: 'oops', stack: '', code: undefined });
});
