// PDFの取り込みで起きる例外を、原因ごとに分類する（ブラウザ・PDF.jsに依存しない純粋関数）。
// ユーザーには原因を判断できる文言を、開発者には実際の例外名・内容（detail）を渡す。
//
// stage（どの段階で失敗したか）
//   open     … PDF.js へ読み込む
//   analyze  … 全ページのサイズを調べる
//   preview  … A3全体のプレビュー画像を作る
//   convert  … 冊子ページ用の画像を作る（A3の左右分割を含む）
//   save     … IndexedDB へ保存する

// 例外の名前・メッセージ・スタックを取り出す（Errorでない値が投げられても扱えるようにする）
export function describeError(error) {
  if (error && typeof error === 'object') {
    return {
      name: String(error.name ?? error.constructor?.name ?? 'Error'),
      message: String(error.message ?? ''),
      stack: typeof error.stack === 'string' ? error.stack : '',
      code: error.code,
    };
  }
  return { name: typeof error, message: String(error), stack: '', code: undefined };
}

const CORRUPT_NAMES = new Set(['InvalidPDFException', 'FormatError', 'MissingPDFException', 'ResponseException', 'UnexpectedResponseException']);
const CORRUPT_MESSAGE = /invalid pdf|not a pdf|pdf header|xref|trailer|missing pdf|bad xref|invalid or corrupted/i;
// 描画・画像生成の失敗（メモリ不足、キャンバスの上限、画像のエンコード失敗など）
const RENDER_NAMES = new Set(['ImageEncodeError', 'RangeError', 'RenderingCancelledException']);
const RENDER_MESSAGE = /out of memory|allocation failed|invalid array length|canvas|bitmap|encode|画像の生成/i;
// PDF.js のモジュール／worker の読み込み問題（古いキャッシュとの食い違いなど）
const ENV_MESSAGE = /does not match the worker version|setting up fake worker|failed to fetch dynamically imported module|importing a module script failed|worker.*(failed|error)/i;

const KINDS = {
  password: {
    title: 'パスワードで保護されたPDFです',
    message:
      'このPDFはパスワードで保護されているため、PageFlowでは読み込めません。パスワードを解除したPDFを書き出し直してから、もう一度登録してください。',
  },
  corrupt: {
    title: 'PDFを読み取れませんでした',
    message:
      'PDFファイルが壊れているか、PDFとして読み取れない形式です。元のデータからPDFを書き出し直して、もう一度お試しください。',
  },
  render: {
    title: 'ページ画像を生成できませんでした',
    message:
      'PDFは読み込めましたが、ページの画像を生成できませんでした。画像が大きすぎる、またはブラウザのメモリが不足している可能性があります。ほかのタブを閉じる、またはページを再読み込みしてから、もう一度お試しください。',
  },
  storage: {
    title: 'ブラウザに保存できませんでした',
    message:
      'ブラウザの保存容量が足りない可能性があります。不要な冊子やPDFを削除するか、ブラウザの保存領域の設定を確認してから、もう一度お試しください。',
  },
  environment: {
    title: 'PDF処理の準備に失敗しました',
    message:
      'PDFを処理するための部品を読み込めませんでした。ページを再読み込み（Ctrl+F5）してから、もう一度お試しください。',
  },
  unknown: {
    title: '予期しないエラーが発生しました',
    message:
      'PDFの処理中に予期しないエラーが発生しました。もう一度お試しください。改善しない場合は、下の「技術情報」を添えてお知らせください。',
  },
};

export const ERROR_KINDS = Object.keys(KINDS);

// 分類する。戻り値：{ kind, title, message, detail, name, rawMessage, stage }
//  - detail は「例外名: メッセージ」（画面の「技術情報」とコンソールに出す。ファイル名など個人情報は含めない）
//  - context.a3Fallback が true のときは、A3の分割結果を確認できないため登録できない旨を添える
export function classifyPdfError(error, stage, context = {}) {
  const e = describeError(error);
  const text = `${e.name} ${e.message}`;
  let kind = 'unknown';

  if (e.name === 'PasswordException') {
    kind = 'password';
  } else if (e.name === 'QuotaExceededError' || /quota/i.test(text)) {
    kind = 'storage';
  } else if (ENV_MESSAGE.test(text)) {
    kind = 'environment';
  } else if (stage === 'open' || stage === 'analyze') {
    if (CORRUPT_NAMES.has(e.name) || CORRUPT_MESSAGE.test(text)) kind = 'corrupt';
    else if (stage === 'analyze') kind = 'corrupt'; // ページ情報を取り出せない＝ページ構造が壊れている
  } else if (stage === 'preview' || stage === 'convert') {
    kind = 'render'; // 読み込みに成功した後の描画・画像生成の失敗は、すべて「描画失敗」
  } else if (stage === 'save') {
    kind = RENDER_NAMES.has(e.name) || RENDER_MESSAGE.test(text) ? 'render' : 'unknown';
  }

  const base = KINDS[kind];
  const extra =
    context.a3Fallback && kind === 'render'
      ? ' A3の全体プレビューも、左右の分割画像も生成できなかったため、分割結果を確認できず、登録できません。'
      : '';
  return {
    kind,
    stage,
    title: base.title,
    message: `${base.message}${extra}`,
    detail: `${e.name}: ${e.message}`.trim(),
    name: e.name,
    rawMessage: e.message,
  };
}
