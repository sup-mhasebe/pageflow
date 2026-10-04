// PDF.js と Canvas による PDF の解析・画像生成。すべてブラウザ内で完結し、外部へは送信しない。
import { classifyPageSize } from './domain/pdf.js';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// 生成画像の仕様：A4ページ 1240×約1754px（約150dpi）、WebP 品質0.85
//  - 150dpiは画面表示・スマホビューア・面付確認に十分な画質で、1ページ数百KB程度に収まる
//  - WebPが使えないブラウザでは、toBlob が返すPNGをそのまま使う
export const A4_IMAGE_WIDTH_PX = 1240;
export const IMAGE_TYPE = 'image/webp';
export const IMAGE_QUALITY = 0.85;
const PREVIEW_WIDTH_PX = 640;

let pdfjsPromise = null;
// PDF.js は初回利用時にだけ読み込む（初期表示を軽くする）
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(file) {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  // PDF.js はバッファを消費するため、コピーを渡す（元のFileはBlobとして保存に使う）
  return pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
}

// 全ページのサイズを調べ、A4（縦）／A3（横）／対象外に分類する
export async function analyzePdf(doc) {
  const items = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 }); // 回転を考慮した表示サイズ(pt)
    items.push({
      pageNumber: n,
      kind: classifyPageSize(vp.width, vp.height), // 'a4' | 'a3' | null
      widthMm: Math.round((vp.width / 72) * 25.4),
      heightMm: Math.round((vp.height / 72) * 25.4),
    });
    page.cleanup();
  }
  return items;
}

function newCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // PDF.js は透明背景で描画するため、白で塗る
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

const toBlob = (canvas, type, quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の生成に失敗しました。'))), type, quality),
  );

async function renderPageToCanvas(doc, pageNumber, targetWidthPx) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: targetWidthPx / base.width });
  const { canvas, ctx } = newCanvas(Math.round(viewport.width), Math.round(viewport.height));
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return canvas;
}

// A3分割確認用のプレビュー（A3ページ全体の画像のObject URL）
export async function renderPreviewUrl(doc, pageNumber) {
  const canvas = await renderPageToCanvas(doc, pageNumber, PREVIEW_WIDTH_PX);
  const blob = await toBlob(canvas, 'image/jpeg', 0.8);
  return URL.createObjectURL(blob);
}

// 冊子ページ用の表示画像を生成する。戻り値は変換後ページ順（A3は 左 → 右）。
//  - A4：そのまま1画像
//  - A3横：幅の中央50%で左右に分割し、左を先のページ・右を次のページとする
export async function renderConvertedPages(doc, items, onProgress = () => {}) {
  const total = items.reduce((s, i) => s + (i.kind === 'a3' ? 2 : 1), 0);
  const result = [];
  for (const item of items) {
    if (item.kind === 'a4') {
      const canvas = await renderPageToCanvas(doc, item.pageNumber, A4_IMAGE_WIDTH_PX);
      result.push({
        sourcePdfPage: item.pageNumber,
        splitSide: 'none',
        imageBlob: await toBlob(canvas, IMAGE_TYPE, IMAGE_QUALITY),
        width: canvas.width,
        height: canvas.height,
      });
    } else if (item.kind === 'a3') {
      // A3全体を「半分がA4幅」になる解像度で描画し、中央50%で切り出す
      const full = await renderPageToCanvas(doc, item.pageNumber, A4_IMAGE_WIDTH_PX * 2);
      const half = full.width / 2;
      for (const side of ['left', 'right']) {
        const { canvas, ctx } = newCanvas(half, full.height);
        ctx.drawImage(full, side === 'left' ? 0 : half, 0, half, full.height, 0, 0, half, full.height);
        result.push({
          sourcePdfPage: item.pageNumber,
          splitSide: side,
          imageBlob: await toBlob(canvas, IMAGE_TYPE, IMAGE_QUALITY),
          width: canvas.width,
          height: canvas.height,
        });
        onProgress(result.length, total);
      }
      continue;
    } else {
      throw new Error('対象外のページサイズが含まれています。');
    }
    onProgress(result.length, total);
  }
  return result;
}
