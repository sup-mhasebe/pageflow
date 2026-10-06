import { totalPagesSchema } from '../schemas.js';
import { applyPreset, PRESET_DEFS } from './preset.js';

export const TEMPLATE_ID = 'standard-booklet';

const newId = () => crypto.randomUUID();

function newPage(bookletId, physicalPageNumber) {
  return {
    id: newId(),
    bookletId,
    physicalPageNumber,
    contentId: null,
    contentPageIndex: null,
    pdfAssetId: null,
    renderImageId: null,
  };
}

// 新規冊子を作成する。P1〜PN は、すべて自由に使える通常ページ（固定ページはない）。
// options.preset が true のときだけ、標準構成（表紙・表紙裏・目次・裏表紙裏・裏表紙）を最初にセットする。
export function createBooklet(name, totalPages, options = {}) {
  const now = options.now ?? new Date();
  const iso = now.toISOString();
  const booklet = {
    id: newId(),
    name,
    templateId: TEMPLATE_ID,
    totalPages,
    pageSize: 'A4',
    bindingType: 'saddle-stitch',
    bindingDirection: 'left',
    createdAt: iso,
    updatedAt: iso,
  };
  const pages = [];
  for (let n = 1; n <= totalPages; n++) pages.push(newPage(booklet.id, n));
  const empty = { booklet, contents: [], pages };
  if (!options.preset) return empty;
  const r = applyPreset(empty, PRESET_DEFS.map((d) => d.key));
  return { booklet, contents: r.contents, pages: r.pages };
}

// ページ利用状況（全NP｜コンテンツ｜空き）
export function usage(totalPages, contents, pages) {
  const content = pages.filter((p) => p.contentId).length;
  return { total: totalPages, content, empty: totalPages - content };
}

// 総ページ数の変更の見積もり（実際には変更しない）。確認ダイアログの要否と内容を決めるために使う。
//  - 増加：末尾に空きページを追加するだけ（確認不要）
//  - 減少：削除されるページ（番号 > 新しい総ページ数）にコンテンツまたはPDF割り当てがあれば、確認が必要。
//          その場合、削除されるページに触れるコンテンツは「配置全体」が解除される（一部だけが残る状態を作らない）
export function planResize(state, newTotalPages) {
  const parsed = totalPagesSchema.safeParse(newTotalPages);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0].message };
  const { booklet, contents, pages } = state;
  if (newTotalPages === booklet.totalPages) {
    return { ok: false, reason: '総ページ数が現在の値と同じです。' };
  }
  if (newTotalPages > booklet.totalPages) {
    const added = [];
    for (let n = booklet.totalPages + 1; n <= newTotalPages; n++) added.push(n);
    return { ok: true, direction: 'increase', cutPages: [], occupiedCutPages: [], affected: [], addedPages: added, needsConfirm: false };
  }
  const cut = pages.filter((p) => p.physicalPageNumber > newTotalPages);
  const occupiedCut = cut.filter((p) => p.contentId || p.renderImageId);
  const nameById = new Map(contents.map((c) => [c.id, c.name]));
  const affectedIds = [...new Set(occupiedCut.map((p) => p.contentId).filter(Boolean))];
  const affected = affectedIds
    .map((id) => ({
      contentId: id,
      name: nameById.get(id) ?? '（不明なコンテンツ）',
      pages: pages.filter((p) => p.contentId === id).map((p) => p.physicalPageNumber).sort((a, b) => a - b),
    }))
    .sort((a, b) => a.pages[0] - b.pages[0]);
  return {
    ok: true,
    direction: 'decrease',
    cutPages: cut.map((p) => p.physicalPageNumber),
    occupiedCutPages: occupiedCut.map((p) => p.physicalPageNumber).sort((a, b) => a - b),
    affected,
    addedPages: [],
    needsConfirm: occupiedCut.length > 0,
  };
}

// 総ページ数を変更する。確認が必要なケースかどうかは planResize で判断し、承認後にこの関数を呼ぶ。
// コンテンツ・PDF（PdfAsset／RenderImage）そのものは削除しない。変わるのはページの配置だけ。
export function resizeBooklet(state, newTotalPages, now = new Date()) {
  const plan = planResize(state, newTotalPages);
  if (!plan.ok) return plan;
  const { booklet, pages } = state;
  const unplaceIds = new Set(plan.affected.map((a) => a.contentId));
  let next = pages
    .filter((p) => p.physicalPageNumber <= newTotalPages)
    .map((p) =>
      p.contentId && unplaceIds.has(p.contentId)
        ? { ...p, contentId: null, contentPageIndex: null, pdfAssetId: null, renderImageId: null }
        : p,
    );
  for (const n of plan.addedPages) next.push(newPage(booklet.id, n));
  next = next.sort((a, b) => a.physicalPageNumber - b.physicalPageNumber);
  return {
    ok: true,
    plan,
    booklet: { ...booklet, totalPages: newTotalPages, updatedAt: now.toISOString() },
    pages: next,
    removedPageIds: pages.filter((p) => p.physicalPageNumber > newTotalPages).map((p) => p.id),
  };
}
