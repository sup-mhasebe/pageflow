// 左カラムのコンテンツカードに表示する情報（読み取り専用の純粋関数）。
// PDFについては「冊子ページに画像が割り当て済みのページ数」と、素材数を示す（素材そのものは右カラムで管理する）。

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

// PDFの状況：{ assigned, required, hasPdf, materials }
//  assigned = このコンテンツのページに割り当て済みの素材数、materials = PDFから生成された素材数
export function pdfSummary(content, pages, pdfAssets, renderImages = []) {
  const assigned = pages.filter((p) => p.contentId === content.id && p.renderImageId).length;
  const asset = pdfAssets.find((a) => a.contentId === content.id);
  const materials = asset ? renderImages.filter((i) => i.pdfAssetId === asset.id).length : 0;
  return { assigned, required: content.requiredPages, hasPdf: !!asset, materials };
}

// 表示用の文字列（例：「PDF：2/3P」「PDF：未登録」）
export function pdfSummaryLabel(summary) {
  return summary.hasPdf ? `PDF：${summary.assigned}/${summary.required}P` : 'PDF：未登録';
}

// 素材数が必要ページ数と異なるときだけ表示する補足（例：「素材 6ページ」）。同数なら null
export function materialCountLabel(summary) {
  return summary.hasPdf && summary.materials !== summary.required ? `素材 ${summary.materials}ページ` : null;
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
