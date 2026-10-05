// 統合テスト用の実行環境：実際の PDF.js（legacy ビルド）と、実際の Canvas（@napi-rs/canvas）を使う。
// モックではなく、本物の描画・画像エンコード（WebP/JPEG）を通る。@napi-rs/canvas は pdfjs-dist の任意依存として導入済み。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PDFJS_PATH = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'pdf');

let cached = null;

// 戻り値：{ ok: true, env, napi, pdfjs } | { ok: false, reason }（Canvasを読み込めない環境ではテストをスキップする）
export async function loadNodeEnv() {
  if (cached) return cached;
  try {
    const pdfjs = await import(pathToFileURL(PDFJS_PATH).href);
    // pnpm では任意依存が pdfjs-dist の隣（実体のパス）にあるため、そこから解決する
    const napi = createRequire(fs.realpathSync(PDFJS_PATH))('@napi-rs/canvas');
    const env = {
      pdfjs,
      createCanvas(width, height) {
        const canvas = napi.createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        return { canvas, ctx };
      },
      async toBlob(canvas, type, quality) {
        const format = type === 'image/jpeg' ? 'jpeg' : 'webp';
        const buf = await canvas.encode(format, Math.round(quality * 100));
        return new Blob([buf], { type });
      },
    };
    cached = { ok: true, env, napi, pdfjs };
  } catch (e) {
    cached = { ok: false, reason: String(e?.message ?? e) };
  }
  return cached;
}

export const readFixture = (name) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));

// 生成された画像（Blob）をデコードし、座標から色を読めるようにする
export async function decodeImage(napi, blob) {
  const img = await napi.loadImage(Buffer.from(await blob.arrayBuffer()));
  const canvas = napi.createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  return {
    width: img.width,
    height: img.height,
    at: (x, y) => {
      const i = (Math.round(y) * img.width + Math.round(x)) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    },
  };
}

// PDF座標（pt）→ 画像の画素座標。widthPx は画像の幅、pageWidthPt は元ページの幅
export const pxOf = (ptX, ptY, pageHeightPt, widthPx, pageWidthPt) => {
  const s = widthPx / pageWidthPt;
  return [ptX * s, (pageHeightPt - ptY) * s];
};

// 色の近似比較（各チャンネルの差が tol 以内）
export const near = (rgb, expected, tol = 28) => expected.every((v, i) => Math.abs(rgb[i] - v) <= tol);
