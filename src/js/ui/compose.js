import { esc, btnSecondary, btnDanger, btnPrimary, inputCls, circled } from './util.js';
import { startPageOf } from '../domain/placement.js';
import { getImageUrl } from '../images.js';
import { formatDateTime } from './util.js';

const fieldError = (m) => (m ? `<p class="mt-1 text-xs text-red-600" role="alert">${esc(m)}</p>` : '');

// PDFファイル選択ボタン（label内の非表示input。選択後は app.js が解析モーダルを開く）
const pdfPicker = (contentId, label) =>
  `<label class="${btnSecondary} cursor-pointer focus-within:ring-2 focus-within:ring-indigo-400">${label}
    <input type="file" accept="application/pdf,.pdf" class="sr-only" data-pdf-input data-content-id="${esc(contentId)}" />
  </label>`;

// 配置範囲の表示（例：P4–P5）
function rangeLabel(pages, content) {
  const start = startPageOf(pages, content.id);
  if (start === null) return null;
  return content.requiredPages === 1 ? `P${start}` : `P${start}–P${start + content.requiredPages - 1}`;
}

// 左カラム：コンテンツ一覧・追加
function renderContentList({ contents, pages, pdfAssets }, draft) {
  const items = contents
    .map((c) => {
      if (c.isFixed) {
        return `<li class="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span>${esc(c.name)}</span>
          <span class="text-xs text-slate-500">固定・${c.requiredPages}P</span>
        </li>`;
      }
      const range = rangeLabel(pages, c);
      const status = range
        ? `<span class="text-indigo-700">${range}に配置済み</span>`
        : '<span class="text-slate-500">未配置（ドラッグして配置）</span>';
      const asset = pdfAssets.find((a) => a.contentId === c.id);
      const pdfLine = asset
        ? `<div class="mt-1 break-all text-xs text-slate-600">PDF：${esc(asset.originalFileName)}（${asset.pageCount}/${c.requiredPages}ページ）</div>`
        : '';
      // 未配置のコンテンツにPDFが残っている場合は、ここからPDF登録を解除できる
      const unreg =
        asset && !range
          ? `<button type="button" class="${btnSecondary} !px-2 !py-1 !text-xs" data-action="ask-unregister-pdf" data-id="${esc(c.id)}">PDF登録を解除</button>`
          : '';
      return `<li class="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm" draggable="true" data-drag-content="${esc(c.id)}">
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0 cursor-grab break-words font-medium">${esc(c.name)}</span>
          <span class="shrink-0 text-xs text-slate-600">${c.requiredPages}P</span>
        </div>
        <div class="mt-1 text-xs">${status}</div>${pdfLine}
        <div class="mt-2 flex flex-wrap gap-2">
          ${unreg}
          <button type="button" class="${btnSecondary} !px-2 !py-1 !text-xs" data-action="edit-content" data-id="${esc(c.id)}">編集</button>
          <button type="button" class="${btnDanger} !px-2 !py-1 !text-xs" data-action="ask-delete-content" data-id="${esc(c.id)}">削除</button>
        </div>
      </li>`;
    })
    .join('');
  return `
    <section class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="mb-3 text-sm font-semibold">コンテンツ一覧</h2>
      <ul class="space-y-2">${items}</ul>
      <form data-form="add-content" class="mt-4 space-y-2 border-t border-slate-200 pt-4" novalidate>
        <h3 class="text-xs font-semibold text-slate-600">コンテンツを追加</h3>
        <div>
          <label for="c-name" class="block text-xs text-slate-600">コンテンツ名</label>
          <input id="c-name" name="name" type="text" class="${inputCls}" value="${esc(draft.name)}" autocomplete="off" />
          ${fieldError(draft.errors.name)}
        </div>
        <div>
          <label for="c-pages" class="block text-xs text-slate-600">必要ページ数</label>
          <input id="c-pages" name="requiredPages" type="text" inputmode="numeric" class="${inputCls}" value="${esc(draft.requiredPages)}" autocomplete="off" />
          ${fieldError(draft.errors.requiredPages)}
        </div>
        <button type="submit" class="${btnPrimary}">追加</button>
      </form>
      <p class="mt-3 text-xs text-slate-500">コンテンツをページカードへドラッグして配置します。</p>
    </section>`;
}

// 中央カラム：P1〜PNのページカード（ドロップ先）
function renderPageCards({ contents, pages }, selectedNo) {
  const byId = new Map(contents.map((c) => [c.id, c]));
  const cards = pages
    .map((p) => {
      const c = p.contentId ? byId.get(p.contentId) : null;
      const isUser = c && !c.isFixed;
      const selected = p.physicalPageNumber === selectedNo;
      const ring = selected ? 'ring-2 ring-indigo-500' : 'ring-1 ring-slate-200';
      const index = isUser && c.requiredPages > 1 ? ` ${circled(p.contentPageIndex + 1)}` : '';
      const label = c ? `${esc(c.name)}${index}` : '空き';
      const badge = c?.isFixed
        ? '<span class="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700">固定</span>'
        : '';
      // 生成画像があれば表示（PDFを直接描画せず、登録時に作った画像を共通利用）。無ければ「PDF未登録」
      const url = getImageUrl(p.renderImageId);
      const thumb = url
        ? `<img src="${url}" alt="P${p.physicalPageNumber}のページ画像" class="h-full w-full object-contain" draggable="false" />`
        : 'PDF未登録';
      const bg = isUser
        ? 'bg-indigo-50'
        : c
          ? 'bg-slate-100'
          : 'bg-white border border-dashed border-slate-300';
      const drag = isUser ? `draggable="true" data-drag-content="${esc(c.id)}"` : '';
      return `
        <li>
          <div role="button" tabindex="0" data-action="select-page" data-no="${p.physicalPageNumber}" data-drop-page="${p.physicalPageNumber}" ${drag}
            class="block w-full cursor-pointer rounded-lg bg-white p-2 text-left shadow-sm ${ring} hover:ring-indigo-300">
            <div class="page-thumb flex items-center justify-center overflow-hidden rounded ${bg} text-xs text-slate-400">${thumb}</div>
            <div class="mt-2 flex items-center justify-between gap-1">
              <span class="text-sm font-semibold">P${p.physicalPageNumber}</span>${badge}
            </div>
            <div class="truncate text-xs text-slate-600">${label}</div>
          </div>
        </li>`;
    })
    .join('');
  return `<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">${cards}</ul>`;
}

// 右カラム：選択ページ詳細（コンテンツ情報・配置解除）＋冊子設定
function renderDetail({ booklet, contents, pages, pdfAssets }, selectedNo) {
  let detail = '<p class="text-sm text-slate-500">ページカードを選択すると詳細を表示します。</p>';
  const p = selectedNo ? pages.find((x) => x.physicalPageNumber === selectedNo) : null;
  if (p) {
    const c = p.contentId ? contents.find((x) => x.id === p.contentId) : null;
    const kind = !c ? '空きページ' : c.isFixed ? '固定ページ（削除・配置解除・移動はできません）' : 'コンテンツ配置済み';
    const rows = [
      ['ページ', `<span class="font-semibold">P${p.physicalPageNumber}</span>`],
      ['コンテンツ', c ? esc(c.name) : '-'],
      ['状態', kind],
    ];
    if (c && !c.isFixed) {
      rows.push(['必要ページ数', `${c.requiredPages}P`]);
      rows.push(['配置範囲', rangeLabel(pages, c)]);
      rows.push(['このページ', `${circled(p.contentPageIndex + 1)}（${p.contentPageIndex + 1}/${c.requiredPages}）`]);
    }
    rows.push(['このページのPDF', p.renderImageId ? '登録済み' : 'PDF未登録']);
    const dl = rows
      .map(([k, v]) => `<div class="flex justify-between gap-2"><dt class="shrink-0 whitespace-nowrap text-slate-500">${k}</dt><dd class="min-w-0 text-right">${v}</dd></div>`)
      .join('');
    const asset = c ? pdfAssets.find((a) => a.contentId === c.id) : null;
    const pdfSection = c
      ? `<div class="mt-4 border-t border-slate-200 pt-3">
          <h3 class="mb-2 text-xs font-semibold text-slate-600">PDF（コンテンツ単位）</h3>
          ${
            asset
              ? `<p class="break-all text-sm">${esc(asset.originalFileName)}</p>
                 <p class="mb-2 text-xs text-slate-500">変換後${asset.pageCount}ページ／必要${c.requiredPages}ページ・登録 ${formatDateTime(asset.importedAt)}</p>
                 <div class="flex flex-wrap gap-2">
                   ${pdfPicker(c.id, 'PDFを差し替え')}
                   <button type="button" class="${btnSecondary}" data-action="ask-unregister-pdf" data-id="${esc(c.id)}">PDF登録を解除</button>
                 </div>`
              : `<p class="mb-2 text-xs text-slate-500">PDF未登録</p>${pdfPicker(c.id, 'PDFを登録')}`
          }
        </div>`
      : '';
    const actions =
      c && !c.isFixed
        ? `<div class="mt-3"><button type="button" class="${btnSecondary}" data-action="unplace-content" data-id="${esc(c.id)}">配置を解除</button></div>`
        : '';
    detail = `<dl class="space-y-1 text-sm">${dl}</dl>${actions}${pdfSection}`;
  }
  return `
    <section class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="mb-3 text-sm font-semibold">選択ページ</h2>${detail}
    </section>
    <section class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="mb-3 text-sm font-semibold">冊子設定</h2>
      <form data-form="rename" class="mb-4 space-y-2" novalidate>
        <label for="s-name" class="block text-xs font-medium text-slate-600">冊子名</label>
        <input id="s-name" data-keep-value name="name" type="text" class="${inputCls}" value="${esc(booklet.name)}" autocomplete="off" />
        <button type="submit" class="${btnSecondary}">冊子名を変更</button>
      </form>
      <form data-form="resize" class="mb-4 space-y-2" novalidate>
        <label for="s-total" class="block text-xs font-medium text-slate-600">総ページ数（8以上の4の倍数）</label>
        <input id="s-total" data-keep-value name="totalPages" type="text" inputmode="numeric" class="${inputCls}" value="${booklet.totalPages}" autocomplete="off" />
        <button type="submit" class="${btnSecondary}">総ページ数を変更</button>
        <p class="text-xs text-slate-500">増加は可能です。減少は、削除される末尾ページと新しい固定ページ位置にコンテンツが無い場合のみ可能です。</p>
      </form>
      <button type="button" class="${btnDanger}" data-action="ask-delete" data-id="${esc(booklet.id)}">この冊子を削除</button>
    </section>`;
}

export function renderCompose(state) {
  const cur = state.current;
  return `
    <div class="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
      <aside class="space-y-4">${renderContentList(cur, state.contentDraft)}</aside>
      <section class="min-w-0">${renderPageCards(cur, state.selectedPageNo)}</section>
      <aside class="space-y-4">${renderDetail(cur, state.selectedPageNo)}</aside>
    </div>`;
}
