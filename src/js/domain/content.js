import { validateContentInput } from '../schemas.js';
import { checkRange, isPlaced, startPageOf, unplaceContent } from './placement.js';

// ユーザーコンテンツのID。IndexedDB はキー順で返すため、作成順に並ぶよう時刻プレフィックスを付ける
export function newContentId(now = Date.now()) {
  return `c_${now.toString(36).padStart(9, '0')}_${crypto.randomUUID()}`;
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
      // 減少：開始ページと先頭側の配置は維持し、不要になった末尾側のページだけ解除する
      pages = pages.map((p) =>
        p.contentId === contentId && p.physicalPageNumber > end
          ? { ...p, contentId: null, contentPageIndex: null }
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
    }
  }
  return { ok: true, content: { ...content, name, requiredPages }, pages };
}

// コンテンツ削除。配置済みなら配置も解除する（呼び出し側で必ずユーザー確認を取ること）
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
  return { ok: true, pages, contents: state.contents.filter((c) => c.id !== contentId) };
}

// 容量チェック：登録コンテンツの合計ページ数が、固定ページ以外のページ数を超えていないか
export function capacity(state) {
  const fixed = state.contents.filter((c) => c.isFixed).length;
  const available = state.booklet.totalPages - fixed;
  const registered = state.contents.filter((c) => !c.isFixed).reduce((s, c) => s + c.requiredPages, 0);
  return { available, registered, over: registered > available };
}
