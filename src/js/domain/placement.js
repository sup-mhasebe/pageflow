// コンテンツ配置の純粋関数。入力を書き換えず、新しい配列を返す。
// 原則：連続空きが確保できない場合は拒否し、既存の配置を勝手に動かさない・上書きしない。
// PDFはコンテンツ単位で登録されており、冊子ページとの対応は配置位置から導出し直す（relinkPages）。
import { relinkPages } from './pdf.js';

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
      if (other?.isFixed) {
        return { ok: false, reason: `P${n}は固定ページ（${other.name}）のため配置できません。` };
      }
      return { ok: false, reason: `P${n}は「${other?.name ?? '別のコンテンツ'}」が使用中のため配置できません。` };
    }
  }
  return { ok: true };
}

// 配置・移動。成功時は新しい pages を返す。失敗時は pages を変更しない
export function placeContent(state, contentId, startNo) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return { ok: false, reason: 'コンテンツが見つかりません。' };
  if (content.isFixed) return { ok: false, reason: '固定ページは配置・移動できません。' };

  const check = checkRange(state, content, startNo);
  if (!check.ok) return check;

  const currentStart = startPageOf(state.pages, contentId);
  if (currentStart === startNo) return { ok: true, pages: state.pages, unchanged: true };

  const end = startNo + content.requiredPages - 1;
  const pages = state.pages.map((p) => {
    if (p.contentId === contentId) return { ...p, contentId: null, contentPageIndex: null, pdfAssetId: null, renderImageId: null };
    return p;
  });
  const next = pages.map((p) =>
    p.physicalPageNumber >= startNo && p.physicalPageNumber <= end
      ? { ...p, contentId, contentPageIndex: p.physicalPageNumber - startNo }
      : p,
  );
  // 登録済みPDFはコンテンツに付随して移動する（新しい配置位置へ対応付け直す）
  return { ok: true, pages: relinkPages({ ...state, pages: next }), moved: currentStart !== null };
}

// 配置解除：コンテンツが占有する全ページを解除する（コンテンツ自体は残す）
export function unplaceContent(state, contentId) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return { ok: false, reason: 'コンテンツが見つかりません。' };
  if (content.isFixed) return { ok: false, reason: '固定ページは配置解除できません。' };
  if (!isPlaced(state.pages, contentId)) return { ok: false, reason: 'このコンテンツは配置されていません。' };
  // 配置解除：冊子ページとの対応のみ外す。登録済みPDF（PdfAsset）はコンテンツに残る
  const pages = state.pages.map((p) =>
    p.contentId === contentId
      ? { ...p, contentId: null, contentPageIndex: null, pdfAssetId: null, renderImageId: null }
      : p,
  );
  return { ok: true, pages };
}
