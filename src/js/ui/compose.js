import { esc, btnSecondary, btnDanger, btnPrimary, inputCls } from './util.js';

// 左カラム：コンテンツ一覧（Phase 1 は固定コンテンツの表示のみ）
function renderContentList({ contents }) {
  const fixed = contents
    .filter((c) => c.isFixed)
    .map(
      (c) => `<li class="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <span>${esc(c.name)}</span>
        <span class="text-xs text-slate-500">固定・${c.requiredPages}P</span>
      </li>`,
    )
    .join('');
  return `
    <section class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="mb-3 text-sm font-semibold">コンテンツ一覧</h2>
      <ul class="space-y-2">${fixed}</ul>
      <p class="mt-3 text-xs text-slate-500">コンテンツの追加は次のPhaseで実装します。</p>
    </section>`;
}

// 中央カラム：P1〜PNのページカード
function renderPageCards({ contents, pages }, selectedNo) {
  const byId = new Map(contents.map((c) => [c.id, c]));
  const cards = pages
    .map((p) => {
      const c = p.contentId ? byId.get(p.contentId) : null;
      const selected = p.physicalPageNumber === selectedNo;
      const ring = selected ? 'ring-2 ring-indigo-500' : 'ring-1 ring-slate-200';
      const label = c ? esc(c.name) : '空き';
      const badge = c?.isFixed
        ? '<span class="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700">固定</span>'
        : '';
      const pdf = p.pdfAssetId ? 'PDF登録済み' : 'PDF未登録';
      const bg = c ? 'bg-slate-100' : 'bg-white border border-dashed border-slate-300';
      return `
        <li>
          <button type="button" data-action="select-page" data-no="${p.physicalPageNumber}"
            class="block w-full rounded-lg bg-white p-2 text-left shadow-sm ${ring} hover:ring-indigo-300">
            <div class="page-thumb flex items-center justify-center rounded ${bg} text-xs text-slate-400">${pdf}</div>
            <div class="mt-2 flex items-center justify-between gap-1">
              <span class="text-sm font-semibold">P${p.physicalPageNumber}</span>${badge}
            </div>
            <div class="truncate text-xs text-slate-600">${label}</div>
          </button>
        </li>`;
    })
    .join('');
  return `<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">${cards}</ul>`;
}

// 右カラム：選択ページ詳細＋冊子設定
function renderDetail({ booklet, contents, pages }, selectedNo) {
  let detail = '<p class="text-sm text-slate-500">ページカードを選択すると詳細を表示します。</p>';
  if (selectedNo) {
    const p = pages.find((x) => x.physicalPageNumber === selectedNo);
    if (p) {
      const c = p.contentId ? contents.find((x) => x.id === p.contentId) : null;
      const kind = !c ? '空きページ' : c.isFixed ? '固定ページ（削除・配置解除・移動はできません）' : 'コンテンツ配置済み';
      detail = `
        <dl class="space-y-1 text-sm">
          <div class="flex justify-between"><dt class="text-slate-500">ページ</dt><dd class="font-semibold">P${p.physicalPageNumber}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-500">コンテンツ</dt><dd>${c ? esc(c.name) : '-'}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-500">状態</dt><dd class="text-right">${kind}</dd></div>
          <div class="flex justify-between"><dt class="text-slate-500">PDF</dt><dd>${p.pdfAssetId ? '登録済み' : 'PDF未登録'}</dd></div>
        </dl>`;
    }
  }
  return `
    <section class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="mb-3 text-sm font-semibold">選択ページ</h2>${detail}
    </section>
    <section class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="mb-3 text-sm font-semibold">冊子設定</h2>
      <form data-form="rename" class="mb-4 space-y-2" novalidate>
        <label for="s-name" class="block text-xs font-medium text-slate-600">冊子名</label>
        <input id="s-name" name="name" type="text" class="${inputCls}" value="${esc(booklet.name)}" autocomplete="off" />
        <button type="submit" class="${btnSecondary}">冊子名を変更</button>
      </form>
      <form data-form="resize" class="mb-4 space-y-2" novalidate>
        <label for="s-total" class="block text-xs font-medium text-slate-600">総ページ数（8以上の4の倍数）</label>
        <input id="s-total" name="totalPages" type="text" inputmode="numeric" class="${inputCls}" value="${booklet.totalPages}" autocomplete="off" />
        <button type="submit" class="${btnSecondary}">総ページ数を変更</button>
        <p class="text-xs text-slate-500">増加は可能です。減少は、削除される末尾ページと新しい固定ページ位置にコンテンツが無い場合のみ可能です。</p>
      </form>
      <button type="button" class="${btnDanger}" data-action="ask-delete" data-id="${esc(booklet.id)}">この冊子を削除</button>
    </section>`;
}

export function renderCompose(state) {
  const cur = state.current;
  return `
    <div class="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
      <aside class="space-y-4">${renderContentList(cur)}</aside>
      <section class="min-w-0">${renderPageCards(cur, state.selectedPageNo)}</section>
      <aside class="space-y-4">${renderDetail(cur, state.selectedPageNo)}</aside>
    </div>`;
}

// 未実装タブの案内（Phase 1 では冊子プレビュー・面付は準備中）
export function renderComingSoon(title) {
  return `<div class="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
    ${esc(title)}は準備中です。</div>`;
}

export { btnPrimary };
