// Contentの識別色。目的は装飾ではなく「どのページがどのContentに属するか」を一目で分かるようにすること。
// - 標準構成（presetKey を持つContent）は、名前ではなく presetKey で判定し、常にニュートラルなグレー
// - 通常のContentは、作成順に淡い色を順に割り当てる。作成時に colorIndex を保存するため、
//   並び替え・削除・再読み込みをしても同じContentは同じ色のまま（旧データは作成順＝IDの昇順で導出し、保存データは書き換えない）
export const PRESET_COLOR = { key: 'preset', bg: '#eceff3', border: '#aab2bd' };

// 淡い色（文字・PDF画像の視認性を損なわない）。隣り合う色が識別できるよう、色相を離して並べている
export const PALETTE = [
  { key: 'blue', bg: '#dbeafe', border: '#7fb0f5' },
  { key: 'amber', bg: '#fdf0c4', border: '#e8be4a' },
  { key: 'rose', bg: '#fde0e6', border: '#f08ca3' },
  { key: 'green', bg: '#d8f5df', border: '#6fcf8b' },
  { key: 'violet', bg: '#e6e0fb', border: '#a995ee' },
  { key: 'orange', bg: '#fde3cc', border: '#f2a266' },
  { key: 'teal', bg: '#cdf1ee', border: '#52c7bc' },
  { key: 'fuchsia', bg: '#f8dcf6', border: '#dd8ad6' },
];

// 通常Contentの色番号。colorIndex があればそれ、無い旧データは「colorIndexの無い通常Content」の中での作成順（IDの昇順）
export function colorIndexOf(contents, content) {
  if (content.presetKey) return null;
  if (Number.isInteger(content.colorIndex)) return content.colorIndex;
  const legacy = contents.filter((c) => !c.presetKey && !Number.isInteger(c.colorIndex)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return Math.max(0, legacy.findIndex((c) => c.id === content.id));
}

// 新しく作るContentの色番号（既存の最大＋1。削除されて空いた番号は再利用しない）
export function nextColorIndex(contents) {
  let max = -1;
  for (const c of contents) {
    if (c.presetKey) continue;
    max = Math.max(max, colorIndexOf(contents, c));
  }
  return max + 1;
}

// 表示色 { key, bg, border }。Contentが無い（空きページ）場合は null
export function contentColor(contents, content) {
  if (!content) return null;
  const idx = colorIndexOf(contents, content);
  return idx === null ? PRESET_COLOR : PALETTE[idx % PALETTE.length];
}
