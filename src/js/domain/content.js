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

// 表示順：配置済みのコンテンツは開始ページ順、未配置のコンテンツはその後ろに作成順（IDの昇順）
export function sortContents(contents, pages = []) {
  const start = new Map();
  for (const p of pages) {
    if (!p.contentId) continue;
    const cur = start.get(p.contentId);
    if (cur === undefined || p.physicalPageNumber < cur) start.set(p.contentId, p.physicalPageNumber);
  }
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return [...contents].sort((a, b) => {
    const sa = start.get(a.id);
    const sb = start.get(b.id);
    if (sa !== undefined && sb !== undefined) return sa - sb || byId(a, b);
    if (sa !== undefined) return -1;
    if (sb !== undefined) return 1;
    return byId(a, b);
  });
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
// 登録済みPDFがある場合は、PDFの扱い mode（'trash'＝ゴミ箱へ移す／'delete'＝完全削除）をユーザーに選ばせる。
// 選択なしにPDFを自動でゴミ箱へ移したり削除したりしない（mode 未指定は拒否）。
// どちらの mode でも Content と冊子ページへの配置は削除する。
export function deleteContent(state, contentId, mode) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return { ok: false, reason: 'コンテンツが見つかりません。' };
  const existing = assetOfContent(state, contentId);
  if (existing && mode !== 'trash' && mode !== 'delete') {
    return { ok: false, reason: 'PDFの扱い（ゴミ箱へ移す／完全削除）を選択してください。' };
  }
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
    trashAssetIds: asset && mode === 'trash' ? [asset.id] : [],
    deleteAssetIds: asset && mode === 'delete' ? [asset.id] : [],
  };
}

// 容量チェック：登録コンテンツの必要ページ数の合計が、総ページ数を超えていないか
export function capacity(state) {
  const available = state.booklet.totalPages;
  const registered = state.contents.reduce((s, c) => s + c.requiredPages, 0);
  return { available, registered, over: registered > available };
}
