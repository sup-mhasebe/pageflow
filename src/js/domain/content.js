import { validateContentInput } from '../schemas.js';
import { checkRange, isPlaced, startPageOf, unplaceContent } from './placement.js';
import { assetOfContent, hasPdfRef, relinkPages, PDF_IN_USE_MESSAGE } from './pdf.js';

// ユーザーコンテンツのID。IndexedDB はキー順で返すため、作成順に並ぶよう時刻プレフィックスを付ける
// 同一ミリ秒に複数作成しても順序が逆転しないよう、前回値より必ず大きくする
let lastStamp = 0;
export function newContentId(now = Date.now()) {
  lastStamp = Math.max(now, lastStamp + 1);
  return `c_${lastStamp.toString(36).padStart(9, '0')}_${crypto.randomUUID()}`;
}

// 表示順：固定コンテンツ（表紙→裏表紙）の後にユーザーコンテンツを作成順で並べる
export const FIXED_ORDER = ['表紙', '表紙裏', '目次', '裏表紙裏', '裏表紙'];
export function sortContents(contents) {
  const rank = (c) => (c.isFixed ? FIXED_ORDER.indexOf(c.name) : FIXED_ORDER.length);
  return [...contents].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function addContent(state, rawName, rawRequiredPages) {
  const v = validateContentInput(rawName, rawRequiredPages);
  if (!v.ok) return { ok: false, errors: v.errors };
  const content = {
    id: newContentId(),
    bookletId: state.booklet.id,
    name: v.data.name,
    requiredPages: v.data.requiredPages,
    isFixed: false,
  };
  return { ok: true, content };
}

// コンテンツ編集。配置済みでP数を増やす場合は後続ページが空いているときのみ拡張する（空きがなければ拒否）。
// 減らす場合は末尾側のページのみ解除する（他のコンテンツは動かさない・再配置しない）。
export function updateContent(state, contentId, rawName, rawRequiredPages) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return { ok: false, errors: { name: 'コンテンツが見つかりません。' } };
  if (content.isFixed) return { ok: false, errors: { name: '固定ページは編集できません。' } };
  const v = validateContentInput(rawName, rawRequiredPages);
  if (!v.ok) return { ok: false, errors: v.errors };

  const { name, requiredPages } = v.data;
  let pages = state.pages;
  if (isPlaced(pages, contentId) && requiredPages !== content.requiredPages) {
    const start = startPageOf(pages, contentId);
    const end = start + requiredPages - 1;
    if (requiredPages < content.requiredPages) {
      // 解放されるページにPDF／生成画像がある場合は拒否する（PDFを暗黙的に削除・解除しない）
      const freed = pages.filter((p) => p.contentId === contentId && p.physicalPageNumber > end);
      if (freed.some(hasPdfRef)) {
        return { ok: false, errors: { requiredPages: PDF_IN_USE_MESSAGE.replace('ページ数を変更できません', 'ページ数を減らせません') } };
      }
      // 減少：開始ページと先頭側の配置は維持し、不要になった末尾側のページだけ解除する
      pages = pages.map((p) =>
        p.contentId === contentId && p.physicalPageNumber > end
          ? { ...p, contentId: null, contentPageIndex: null, pdfAssetId: null, renderImageId: null }
          : p,
      );
    } else {
      const check = checkRange(state, content, start, requiredPages);
      if (!check.ok) return { ok: false, errors: { requiredPages: `ページ数を増やせません。${check.reason}` } };
      pages = pages.map((p) =>
        p.physicalPageNumber >= start && p.physicalPageNumber <= end
          ? { ...p, contentId, contentPageIndex: p.physicalPageNumber - start }
          : p,
      );
      pages = relinkPages({ ...state, pages });
    }
  }
  return { ok: true, content: { ...content, name, requiredPages }, pages };
}

// コンテンツ削除。配置済みなら配置も解除する（呼び出し側で必ずユーザー確認を取ること）。
// 登録済みPDFがある場合は、完全削除せずゴミ箱へ移動する（trashAssetIds で DB 層に指示）。
export function deleteContent(state, contentId) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return { ok: false, reason: 'コンテンツが見つかりません。' };
  if (content.isFixed) return { ok: false, reason: '固定ページは削除できません。' };
  let pages = state.pages;
  if (isPlaced(pages, contentId)) {
    const r = unplaceContent(state, contentId);
    if (!r.ok) return r;
    pages = r.pages;
  }
  const asset = assetOfContent(state, contentId);
  const removedImageIds = asset ? (state.renderImages ?? []).filter((i) => i.pdfAssetId === asset.id).map((i) => i.id) : [];
  return {
    ok: true,
    pages,
    contents: state.contents.filter((c) => c.id !== contentId),
    pdfAssets: (state.pdfAssets ?? []).filter((a) => a.id !== asset?.id),
    renderImages: (state.renderImages ?? []).filter((i) => i.pdfAssetId !== asset?.id),
    removedImageIds,
    trashAssetIds: asset ? [asset.id] : [],
  };
}

// 容量チェック：登録コンテンツの合計ページ数が、固定ページ以外のページ数を超えていないか
export function capacity(state) {
  const fixed = state.contents.filter((c) => c.isFixed).length;
  const available = state.booklet.totalPages - fixed;
  const registered = state.contents.filter((c) => !c.isFixed).reduce((s, c) => s + c.requiredPages, 0);
  return { available, registered, over: registered > available };
}
