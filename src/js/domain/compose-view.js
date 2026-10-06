// 構成画面・中央ビューの表示設定（一覧／見開き、拡大・縮小）に関する純粋関数。
// 表示設定は画面上の一時状態で、冊子データ（Content配置・PDF割り当て）は変更しない。
import { buildScreens } from './viewer.js';

export const MODES = ['list', 'spread'];
export const ZOOM_MIN = 40;
export const ZOOM_MAX = 200;
export const ZOOM_DEFAULT = 100;
// ［－］［＋］で移動する倍率の段階
export const ZOOM_STEPS = [40, 50, 60, 75, 90, 100, 125, 150, 175, 200];

// ページカードの寸法（100%のとき）。縦横比はA4縦のまま、幅だけを倍率で拡縮する
export const CARD_BASE_W = 150;
export const GAP = 12; // 一覧のカード間隔
const CARD_PAD_X = 20; // 枠(2px×2)＋余白(8px×2)
const CARD_CHROME_Y = 72; // 枠・余白・ページ番号・ラベル
const SPREAD_PAD = 16; // 見開きのまとまりの内側余白(8px×2)
const SPREAD_GAP = 8; // 見開きの左右ページの間隔
const A4_RATIO = 297 / 210;

export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(Number.isFinite(z) ? z : ZOOM_DEFAULT)));
export const cardWidth = (zoom) => Math.round((CARD_BASE_W * clampZoom(zoom)) / 100);
export const cardHeight = (zoom) => Math.round((cardWidth(zoom) - CARD_PAD_X) * A4_RATIO + CARD_CHROME_Y);
export const zoomLabel = (zoom) => `${clampZoom(zoom)}%`;

// ［＋］［－］：現在の倍率の次／前の段階へ（段階の間にある倍率からも、隣の段階へ進む）
export function stepZoom(zoom, direction) {
  const z = clampZoom(zoom);
  if (direction > 0) return ZOOM_STEPS.find((s) => s > z) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < z) ?? ZOOM_MIN;
}

// 見開き表示の行：[[1], [2,3], [4,5], …, [N]]（左綴じ。P1とPNは単独）
export const spreadRows = (totalPages) => buildScreens(totalPages, 'spread');

// ［全体表示］：中央ビューの表示領域（width×height）にページ全体が収まる、最大の倍率（5%刻み）。
// 収まる倍率が無いときは最小倍率。height が Infinity のときは、幅だけで決める
export function fitZoom({ mode, totalPages, width, height }) {
  for (let z = ZOOM_MAX; z >= ZOOM_MIN; z -= 5) {
    const w = cardWidth(z);
    const h = cardHeight(z);
    let needW;
    let needH;
    if (mode === 'spread') {
      // 見開き（P1／P2｜P3／…／PN）のまとまりを、領域の幅に収まる数だけ横に並べる
      const spreads = spreadRows(totalPages).length;
      needW = 2 * w + SPREAD_GAP + SPREAD_PAD;
      const perRow = Math.max(1, Math.floor((width + GAP) / (needW + GAP)));
      const rows = Math.ceil(spreads / perRow);
      needH = rows * (h + SPREAD_PAD) + (rows - 1) * GAP;
    } else {
      const cols = Math.max(1, Math.floor((width + GAP) / (w + GAP)));
      const rows = Math.ceil(totalPages / cols);
      needW = w;
      needH = rows * h + (rows - 1) * GAP;
    }
    if (needW <= width && needH <= height) return z;
  }
  return ZOOM_MIN;
}
