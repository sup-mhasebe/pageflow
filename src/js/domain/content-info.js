// 左カラムのコンテンツカードに表示する情報（読み取り専用の純粋関数）。
// PDFについては「冊子ページに画像が割り当て済みのページ数」だけを数える（PDF素材の管理は後続の段階で作り替える）。

// コンテンツが配置されているページ番号（昇順）
export function placementPages(pages, contentId) {
  return pages
    .filter((p) => p.contentId === contentId)
    .map((p) => p.physicalPageNumber)
    .sort((a, b) => a - b);
}

// 配置の表記：少数なら「P4, P5, P6」、多数なら範囲「P4〜P12」、未配置なら「未配置」
export function placementLabel(nums, listLimit = 6) {
  if (nums.length === 0) return '未配置';
  if (nums.length <= listLimit) return nums.map((n) => `P${n}`).join(', ');
  const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return contiguous ? `P${nums[0]}〜P${nums[nums.length - 1]}` : `${nums.slice(0, listLimit).map((n) => `P${n}`).join(', ')} ほか${nums.length - listLimit}ページ`;
}

// PDFの状況：{ assigned, required, hasPdf }。assigned = 画像が割り当て済みのページ数
export function pdfSummary(content, pages, pdfAssets) {
  const assigned = pages.filter((p) => p.contentId === content.id && p.renderImageId).length;
  return { assigned, required: content.requiredPages, hasPdf: pdfAssets.some((a) => a.contentId === content.id) };
}

// 表示用の文字列（例：「PDF：2/3P」「PDF：未登録」）
export function pdfSummaryLabel(summary) {
  return summary.hasPdf ? `PDF：${summary.assigned}/${summary.required}P` : 'PDF：未登録';
}

// 「…」ポップアップに表示する、画像が割り当てられたページの一覧（ページ番号の昇順）
// 例：[{ pageNo: 4, label: '特集記事①' }, …]
export function pdfInfoRows(content, pages, circled) {
  return pages
    .filter((p) => p.contentId === content.id && p.renderImageId)
    .sort((a, b) => a.physicalPageNumber - b.physicalPageNumber)
    .map((p) => ({
      pageNo: p.physicalPageNumber,
      label: `${content.name}${content.requiredPages > 1 ? circled(p.contentPageIndex + 1) : ''}`,
    }));
}
