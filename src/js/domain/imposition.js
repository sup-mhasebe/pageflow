// 中綴じ面付の自動計算（純粋関数）。結果は保存せず、総ページ数Nから都度求める。
//
// 注意：ここでの spreadNo（面付データのページ番号）は、Canvaで作成するA3面付データのページ順であり、
//       冊子の物理ページ番号（P1〜PN＝left/right の値）とは別物。混同しないこと。
//
// 用紙インデックス s（0開始、s < N/4）について：
//   外側：左 = N - 2s     / 右 = 1 + 2s
//   内側：左 = 2 + 2s     / 右 = N - 1 - 2s
// 表示順は各用紙について 外側 → 内側。

export function computeImposition(totalPages) {
  if (!Number.isInteger(totalPages) || totalPages < 4 || totalPages % 4 !== 0) {
    throw new RangeError('総ページ数は4の倍数である必要があります。');
  }
  const sheetCount = totalPages / 4; // 必要なA3用紙枚数
  const spreads = [];
  for (let s = 0; s < sheetCount; s++) {
    spreads.push({
      spreadNo: spreads.length + 1, // 面付データのページ番号（1から連番）
      sheetNo: s + 1,
      side: 'outer',
      left: totalPages - 2 * s,
      right: 1 + 2 * s,
    });
    spreads.push({
      spreadNo: spreads.length + 1,
      sheetNo: s + 1,
      side: 'inner',
      left: 2 + 2 * s,
      right: totalPages - 1 - 2 * s,
    });
  }
  return { totalPages, sheetCount, spreadCount: totalPages / 2, spreads };
}
