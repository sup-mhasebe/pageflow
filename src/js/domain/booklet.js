import { totalPagesSchema } from '../schemas.js';

export const TEMPLATE_ID = 'standard-booklet';

const newId = () => crypto.randomUUID();

// 固定ページの位置と名称（標準冊子の固定テンプレート）
export function fixedLayout(totalPages) {
  return [
    { position: 1, name: '表紙' },
    { position: 2, name: '表紙裏' },
    { position: 3, name: '目次' },
    { position: totalPages - 1, name: '裏表紙裏' },
    { position: totalPages, name: '裏表紙' },
  ];
}

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

// 新規冊子を作成し、P1〜PN と固定ページを自動生成する
export function createBooklet(name, totalPages, now = new Date()) {
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
  // 固定ページもContentとして持つ（各1ページ分）
  const layout = fixedLayout(totalPages);
  const contents = layout.map((f) => ({
    id: newId(),
    bookletId: booklet.id,
    name: f.name,
    requiredPages: 1,
    isFixed: true,
  }));
  const pages = [];
  for (let n = 1; n <= totalPages; n++) pages.push(newPage(booklet.id, n));
  layout.forEach((f, i) => {
    pages[f.position - 1].contentId = contents[i].id;
    pages[f.position - 1].contentPageIndex = 0;
  });
  return { booklet, contents, pages };
}

// ページ利用状況（全NP｜固定｜コンテンツ｜空き）
export function usage(totalPages, contents, pages) {
  const fixedIds = new Set(contents.filter((c) => c.isFixed).map((c) => c.id));
  let fixed = 0;
  let content = 0;
  for (const p of pages) {
    if (!p.contentId) continue;
    if (fixedIds.has(p.contentId)) fixed++;
    else content++;
  }
  return { total: totalPages, fixed, content, empty: totalPages - fixed - content };
}

// 総ページ数の変更（Phase 1〜3 は安全側：配置済みデータを自動で動かさない・消さない）
//  - 増加：可能
//  - 減少：削除対象の末尾ページ／新たに固定ページになる位置にユーザー配置が無い場合のみ可能
//  - 固定ページは変更後の末尾に合わせて再配置
export function resizeBooklet(state, newTotalPages, now = new Date()) {
  const parsed = totalPagesSchema.safeParse(newTotalPages);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0].message };

  const { booklet, contents, pages } = state;
  if (newTotalPages === booklet.totalPages) {
    return { ok: false, reason: '総ページ数が現在の値と同じです。' };
  }

  const contentById = new Map(contents.map((c) => [c.id, c]));
  const fixedByName = new Map(contents.filter((c) => c.isFixed).map((c) => [c.name, c]));
  const newLayout = fixedLayout(newTotalPages);
  const newFixedPos = new Set(newLayout.map((f) => f.position));
  const newPosByName = new Map(newLayout.map((f) => [f.name, f.position]));

  // 変更を拒否すべきページ（削除される末尾ページ、または新たに固定ページになる位置）
  const blockedUser = pages.filter((p) => {
    const c = p.contentId && contentById.get(p.contentId);
    if (!c || c.isFixed) return false;
    return p.physicalPageNumber > newTotalPages || newFixedPos.has(p.physicalPageNumber);
  });
  if (blockedUser.length > 0) {
    const nums = blockedUser.map((p) => `P${p.physicalPageNumber}`).join('、');
    const names = [
      ...new Set(blockedUser.map((p) => `「${contentById.get(p.contentId).name}」`)),
    ].join('、');
    return {
      ok: false,
      reason: `${nums} にコンテンツ${names}が配置されているため、総ページ数を変更できません。先に配置を解除してください。`,
    };
  }
  // 位置が変わる固定ページにPDFが登録済みの場合も自動移動しない（Phase 4 以降で扱いを確認）
  const blockedFixed = pages.filter((p) => {
    const c = p.contentId && contentById.get(p.contentId);
    if (!c || !c.isFixed || !p.pdfAssetId) return false;
    return newPosByName.get(c.name) !== p.physicalPageNumber;
  });
  if (blockedFixed.length > 0) {
    return {
      ok: false,
      reason: '位置が変わる固定ページにPDFが登録されているため、総ページ数を変更できません。',
    };
  }

  const byNum = new Map(pages.map((p) => [p.physicalPageNumber, p]));
  const next = [];
  for (let n = 1; n <= newTotalPages; n++) {
    const p = byNum.has(n) ? { ...byNum.get(n) } : newPage(booklet.id, n);
    const c = p.contentId && contentById.get(p.contentId);
    if (c && c.isFixed) {
      // 固定ページは一度外してから新しい位置へ付け直す
      p.contentId = null;
      p.contentPageIndex = null;
    }
    next.push(p);
  }
  for (const f of newLayout) {
    const page = next[f.position - 1];
    page.contentId = fixedByName.get(f.name).id;
    page.contentPageIndex = 0;
  }

  return {
    ok: true,
    booklet: { ...booklet, totalPages: newTotalPages, updatedAt: now.toISOString() },
    pages: next,
    removedPageIds: pages.filter((p) => p.physicalPageNumber > newTotalPages).map((p) => p.id),
  };
}
