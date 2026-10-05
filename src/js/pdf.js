// ブラウザ側の PDF 処理。PDF.js（Web Worker）と Canvas API を使い、すべてブラウザ内で完結する（外部へは送信しない）。
// 実際の解析・画像生成は pdf-core.js（環境非依存）にあり、ここではブラウザ用の環境（DOMのcanvas等）を渡す。
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as core from './pdf-core.js';

export { ImageEncodeError } from './pdf-core.js';

let envPromise = null;
// PDF.js は初回利用時にだけ読み込む（初期表示を軽くする）
function getEnv() {
  if (!envPromise) {
    envPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return {
        pdfjs,
        createCanvas(width, height) {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new core.ImageEncodeError('キャンバスを作成できませんでした。');
          ctx.fillStyle = '#ffffff'; // PDF.js は透明背景で描画するため、白で塗る
          ctx.fillRect(0, 0, width, height);
          return { canvas, ctx };
        },
        toBlob(canvas, type, quality) {
          return new Promise((resolve, reject) =>
            canvas.toBlob((b) => (b ? resolve(b) : reject(new core.ImageEncodeError())), type, quality),
          );
        },
      };
    });
  }
  return envPromise;
}

// 読み込む。戻り値のハンドル（PDF.jsの loading task を保持）は、使い終わったら必ず closePdf で解放する
export async function openPdf(file) {
  const env = await getEnv();
  const buffer = await file.arrayBuffer();
  // PDF.js はバッファを消費するため、コピーを渡す（元のFileはBlobとして保存に使う）
  return core.openDocument(env, new Uint8Array(buffer.slice(0)));
}

export const closePdf = core.closeDocument;
export const analyzePdf = core.analyzePdf;

// A3全体のプレビュー（画像のObject URL）
export async function renderPreviewUrl(doc, pageNumber) {
  const env = await getEnv();
  return URL.createObjectURL(await core.renderPreviewBlob(env, doc, pageNumber));
}

export async function renderSplitPair(doc, pageNumber) {
  return core.renderSplitPair(await getEnv(), doc, pageNumber);
}

export async function renderConvertedPages(doc, items, onProgress, precomputed) {
  return core.renderConvertedPages(await getEnv(), doc, items, onProgress, precomputed);
}

// 生成した画像をブラウザが実際にデコードできるか（ユーザーが画面で確認できる画像か）
export async function canDecode(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const ok = bmp.width > 0 && bmp.height > 0;
    bmp.close();
    return ok;
  } catch {
    return false;
  }
}
