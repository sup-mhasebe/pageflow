// 冊子ビューアの画面（ページ組み）を生成する純粋関数。
// これは「冊子として開いて読むときのページ順」であり、面付（A3面付データのページ順）とは別物。

// 左綴じの見開き表示（PC）：P1単独 → P2|P3 → P4|P5 → … → PN単独
//   8P:  [1] [2,3] [4,5] [6,7] [8]
//   12P: [1] [2,3] [4,5] [6,7] [8,9] [10,11] [12]
// 1ページ表示（スマートフォン）：P1 → P2 → … → PN（1ページ中心）
export function buildScreens(totalPages, mode = 'spread') {
  if (!Number.isInteger(totalPages) || totalPages < 2) throw new RangeError('総ページ数が不正です。');
  if (mode === 'single') return Array.from({ length: totalPages }, (_, i) => [i + 1]);
  const screens = [[1]];
  for (let p = 2; p + 1 <= totalPages - 1; p += 2) screens.push([p, p + 1]);
  screens.push([totalPages]);
  return screens;
}

// 指定ページを含む画面のインデックス（見つからなければ先頭）
export function screenIndexOf(screens, pageNo) {
  const i = screens.findIndex((s) => s.includes(pageNo));
  return i === -1 ? 0 : i;
}

// 前へ／次へ移動後の画面インデックス（範囲外には出ない）
export function neighborIndex(screens, index, direction) {
  const next = direction === 'next' ? index + 1 : index - 1;
  return Math.min(Math.max(next, 0), screens.length - 1);
}
