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

  // 移動：コンテンツ内の相対位置を保ち、各ページの内容一式（順序・割り当て）を新しい位置へ引き継ぐ
  const offset = new Map();
  for (const p of state.pages) {
    if (p.contentId === contentId && currentStart !== null) {
      offset.set(p.physicalPageNumber - currentStart, { contentPageIndex: p.contentPageIndex, pdfAssetId: p.pdfAssetId, renderImageId: p.renderImageId });
    }
  }
  const end = startNo + content.requiredPages - 1;
  const cleared = state.pages.map((p) =>
    p.contentId === contentId ? { ...p, contentId: null, contentPageIndex: null, pdfAssetId: null, renderImageId: null } : p,
  );
  const pages = cleared.map((p) => {
    if (p.physicalPageNumber < startNo || p.physicalPageNumber > end) return p;
    const rel = p.physicalPageNumber - startNo;
    return { ...p, contentId, ...(offset.get(rel) ?? { contentPageIndex: rel }) };
  });
  return { ok: true, pages, moved: currentStart !== null };
}

// ---- ページの入れ替え（swap）----
// 中央ビューで、物理ページを別の物理ページへドラッグしたときの動作。空きページへ自動で逃がさず、ドロップ先と内容一式を交換する。
// 交換するもの：Content・Content内のページ順（contentPageIndex）・割り当て（renderImageId／pdfAssetId）。
// 交換後に、関わるContentの配置が連続した範囲でなくなる場合は拒否する（元の状態を変えない）。
const SWAP_KEYS = ['contentId', 'contentPageIndex', 'pdfAssetId', 'renderImageId'];

export function swapPages(state, fromNo, toNo) {
  const a = state.pages.find((p) => p.physicalPageNumber === fromNo);
  const b = state.pages.find((p) => p.physicalPageNumber === toNo);
  if (!a || !b) return { ok: false, reason: '入れ替え先のページが不正です。' };
  if (a === b || (!a.contentId && !b.contentId)) return { ok: true, pages: state.pages, unchanged: true };
  const pick = (p) => Object.fromEntries(SWAP_KEYS.map((k) => [k, p[k]]));
  const pages = state.pages.map((p) => (p === a ? { ...p, ...pick(b) } : p === b ? { ...p, ...pick(a) } : p));
  for (const id of new Set([a.contentId, b.contentId].filter(Boolean))) {
    const nums = pages.filter((p) => p.contentId === id).map((p) => p.physicalPageNumber).sort((x, y) => x - y);
    const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    if (!contiguous) {
      const c = state.contents.find((x) => x.id === id);
      return { ok: false, reason: `P${fromNo}とP${toNo}を入れ替えると、「${c?.name ?? 'コンテンツ'}」のページが連続しなくなるため入れ替えできません。` };
    }
  }
  return { ok: true, pages };
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
