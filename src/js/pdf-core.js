// PDFの解析・画像生成の中核。ブラウザにも Node（テスト）にも依存しないよう、環境（PDF.js・Canvas）を引数で受け取る。
//   env = {
//     pdfjs,                                  … PDF.js のモジュール（getDocument を持つ）
//     createCanvas(width, height) → { canvas, ctx }   … 白で塗りつぶしたキャンバスを返す
//     toBlob(canvas, type, quality) → Promise<Blob>   … 画像へ変換する（失敗時は ImageEncodeError を投げる）
//     docOptions?                             … getDocument へ渡す追加オプション
//   }
// すべてブラウザ内（またはテストの実行環境内）で完結し、外部へは送信しない。
import { classifyPageSize } from './domain/pdf.js';

// 生成画像の仕様：A4ページ 1240×約1754px（約150dpi）、WebP 品質0.85
//  - 150dpiは画面表示・スマホビューア・面付確認に十分な画質で、1ページ数百KB程度に収まる
//  - WebPが使えないブラウザでは、toBlob が返すPNGをそのまま使う
export const A4_IMAGE_WIDTH_PX = 1240;
export const IMAGE_TYPE = 'image/webp';
export const IMAGE_QUALITY = 0.85;
export const PREVIEW_WIDTH_PX = 640;

// 画像への変換に失敗したときの例外（描画失敗として分類される）
export class ImageEncodeError extends Error {
  constructor(message = '画像の生成に失敗しました。') {
    super(message);
    this.name = 'ImageEncodeError';
  }
}

// ---- 読み込みと解放（PDF.js の loading task のライフサイクル）----
// PDF.js のドキュメントは PDFDocumentLoadingTask が所有する。使い終わったら必ず task.destroy() で解放する
// （解放しないと、PDF.js の Web Worker と展開済みの画像データが残り続ける）。
export async function openDocument(env, bytes) {
  const task = env.pdfjs.getDocument({ data: bytes, ...(env.docOptions ?? {}) });
  try {
    const doc = await task.promise;
    return { task, doc, closed: false };
  } catch (error) {
    await destroyTask(task); // 読み込みに失敗しても、worker を残さない
    throw error;
  }
}

async function destroyTask(task) {
  try {
    await task.destroy();
  } catch {
    // 解放中の例外は無視する（すでに解放済み・解放中など）
  }
}

// 何度呼んでも安全（2回目以降は何もしない）
export async function closeDocument(handle) {
  if (!handle || handle.closed) return;
  handle.closed = true;
  await destroyTask(handle.task);
}

// ---- 解析 ----
// 全ページのサイズを調べ、A4（縦）／A3（横）／対象外に分類する
export async function analyzePdf(doc) {
  const items = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    try {
      const vp = page.getViewport({ scale: 1 }); // 回転を考慮した表示サイズ(pt)
      items.push({
        pageNumber: n,
        kind: classifyPageSize(vp.width, vp.height), // 'a4' | 'a3' | null
        widthMm: Math.round((vp.width / 72) * 25.4),
        heightMm: Math.round((vp.height / 72) * 25.4),
      });
    } finally {
      page.cleanup();
    }
  }
  return items;
}

// ---- 描画 ----
async function renderPageToCanvas(env, doc, pageNumber, targetWidthPx) {
  const page = await doc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: targetWidthPx / base.width });
    const { canvas, ctx } = env.createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas;
  } finally {
    page.cleanup(); // 描画に失敗しても、ページのリソースを残さない
  }
}

// A3分割確認用のプレビュー（A3ページ全体の画像）
export async function renderPreviewBlob(env, doc, pageNumber) {
  const canvas = await renderPageToCanvas(env, doc, pageNumber, PREVIEW_WIDTH_PX);
  return env.toBlob(canvas, 'image/jpeg', 0.8);
}

// A3横の1ページを、幅の中央50%で左右に分割した2枚（左 → 右）にする
export async function renderSplitPair(env, doc, pageNumber) {
  // A3全体を「半分がA4幅」になる解像度で描画し、中央50%で切り出す
  const full = await renderPageToCanvas(env, doc, pageNumber, A4_IMAGE_WIDTH_PX * 2);
  const half = full.width / 2;
  const pieces = [];
  for (const side of ['left', 'right']) {
    const { canvas, ctx } = env.createCanvas(half, full.height);
    ctx.drawImage(full, side === 'left' ? 0 : half, 0, half, full.height, 0, 0, half, full.height);
    pieces.push({
      sourcePdfPage: pageNumber,
      splitSide: side,
      imageBlob: await env.toBlob(canvas, IMAGE_TYPE, IMAGE_QUALITY),
      width: canvas.width,
      height: canvas.height,
    });
  }
  return pieces;
}

// 冊子ページ用の表示画像を生成する。戻り値は変換後ページ順（A3は 左 → 右）。
//  - A4：そのまま1画像
//  - A3横：中央50%で左右に分割し、左を先のページ・右を次のページとする
//  - precomputed：すでに生成済みのA3分割（ページ番号 → [左, 右]）。同じ処理を二重に行わず、そのまま使う
export async function renderConvertedPages(env, doc, items, onProgress = () => {}, precomputed = new Map()) {
  const total = items.reduce((s, i) => s + (i.kind === 'a3' ? 2 : 1), 0);
  const result = [];
  for (const item of items) {
    if (item.kind === 'a4') {
      const canvas = await renderPageToCanvas(env, doc, item.pageNumber, A4_IMAGE_WIDTH_PX);
      result.push({
        sourcePdfPage: item.pageNumber,
        splitSide: 'none',
        imageBlob: await env.toBlob(canvas, IMAGE_TYPE, IMAGE_QUALITY),
        width: canvas.width,
        height: canvas.height,
      });
    } else if (item.kind === 'a3') {
      const pieces = precomputed.get(item.pageNumber) ?? (await renderSplitPair(env, doc, item.pageNumber));
      result.push(...pieces);
    } else {
      throw new Error('対象外のページサイズが含まれています。');
    }
    onProgress(result.length, total);
  }
  return result;
}
