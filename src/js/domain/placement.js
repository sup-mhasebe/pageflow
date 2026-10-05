// コンテンツ配置の純粋関数。入力を書き換えず、新しい配列を返す。
// 原則：連続空きが確保できない場合は拒否し、既存の配置を勝手に動かさない・上書きしない。
// PDFの割り当て（Page.renderImageId）はユーザーが決めたもの。配置を動かしても、並び順から再計算はしない。

const pageMap = (pages) => new Map(pages.map((p) => [p.physicalPageNumber, p]));

// コンテンツの先頭ページ番号（未配置なら null）
export function startPageOf(pages, contentId) {
  const nums = pages.filter((p) => p.contentId === contentId).map((p) => p.physicalPageNumber);
  return nums.length > 0 ? Math.min(...nums) : null;
}

export function isPlaced(pages, contentId) {
  return pages.some((p) => p.contentId === contentId);
}

// startNo から requiredPages 分の連続ページを、このコンテンツが確保できるか判定する
// （このコンテンツ自身が占有しているページは空きとして扱う＝移動・拡張に対応）
export function checkRange(state, content, startNo, requiredPages = content.requiredPages) {
  const { booklet, contents, pages } = state;
  const total = booklet.totalPages;
  if (!Number.isInteger(startNo) || startNo < 1 || startNo > total) {
    return { ok: false, reason: '配置先のページが不正です。' };
  }
  const end = startNo + requiredPages - 1;
  if (end > total) {
    return {
      ok: false,
      reason: `P${startNo}から${requiredPages}ページ分は冊子の最終ページ（P${total}）を超えるため配置できません。`,
    };
  }
  const byNo = pageMap(pages);
  const byId = new Map(contents.map((c) => [c.id, c]));
  for (let n = startNo; n <= end; n++) {
    const p = byNo.get(n);
    if (p?.contentId && p.contentId !== content.id) {
      const other = byId.get(p.contentId);
      return { ok: false, reason: `P${n}は「${other?.name ?? '別のコンテンツ'}」が使用中のため配置できません。` };
    }
  }
  return { ok: true };
}

// 配置・移動。成功時は新しい pages を返す。失敗時は pages を変更しない
export function placeContent(state, contentId, startNo) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return { ok: false, reason: 'コンテンツが見つかりません。' };
  const check = checkRange(state, content, startNo);
  if (!check.ok) return check;

  const currentStart = startPageOf(state.pages, contentId);
  if (currentStart === startNo) return { ok: true, pages: state.pages, unchanged: true };

  const end = startNo + content.requiredPages - 1;
  // 移動：コンテンツ内の何ページ目か（contentPageIndex）ごとに、割り当て済みの素材を新しい位置へ引き継ぐ
  const carried = new Map();
  for (const p of state.pages) {
    if (p.contentId === contentId && p.renderImageId) carried.set(p.contentPageIndex, { pdfAssetId: p.pdfAssetId, renderImageId: p.renderImageId });
  }
  const cleared = state.pages.map((p) =>
    p.contentId === contentId ? { ...p, contentId: null, contentPageIndex: null, pdfAssetId: null, renderImageId: null } : p,
  );
  const pages = cleared.map((p) => {
    if (p.physicalPageNumber < startNo || p.physicalPageNumber > end) return p;
    const index = p.physicalPageNumber - startNo;
    return { ...p, contentId, contentPageIndex: index, ...(carried.get(index) ?? {}) };
  });
  return { ok: true, pages, moved: currentStart !== null };
}

// 配置解除：コンテンツが占有する全ページを解除する（コンテンツ自体は残す）
export function unplaceContent(state, contentId) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return { ok: false, reason: 'コンテンツが見つかりません。' };
  if (!isPlaced(state.pages, contentId)) return { ok: false, reason: 'このコンテンツは配置されていません。' };
  // 配置解除：ページ配置とそのページへの割り当てだけを外す。Content・PdfAsset・RenderImage は残る
  const pages = state.pages.map((p) =>
    p.contentId === contentId
      ? { ...p, contentId: null, contentPageIndex: null, pdfAssetId: null, renderImageId: null }
      : p,
  );
  return { ok: true, pages };
}
