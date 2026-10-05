import { esc, btnSecondary, btnDanger, btnPrimary, inputCls, circled } from './util.js';
import { placementPages, placementLabel, pdfSummary, pdfSummaryLabel, materialCountLabel } from '../domain/content-info.js';
import { presetStatus } from '../domain/preset.js';
import { assetOfContent } from '../domain/pdf.js';
import { assignmentMap, materialName, materialsOf, pageState, planSequentialAssign, resolveMaterialContentId } from '../domain/assignment.js';
import { getImageUrl } from '../images.js';
import { formatDateTime } from './util.js';

const fieldError = (m) => (m ? `<p class="mt-1 text-xs text-red-600" role="alert">${esc(m)}</p>` : '');

// PDFファイル選択ボタン（label内の非表示input。選択後は app.js が解析モーダルを開く）
const pdfPicker = (contentId, label) =>
  `<label class="${btnSecondary} cursor-pointer focus-within:ring-2 focus-within:ring-indigo-400">${label}
    <input type="file" accept="application/pdf,.pdf" class="sr-only" data-pdf-input data-content-id="${esc(contentId)}" />
  </label>`;

// 標準構成をセットできる項目が残っているか（すべて標準位置に配置済みなら、ボタンは使えない）
function presetAllDone(state) {
  return presetStatus(state).every((x) => x.status === 'placed-standard');
}

// 左カラム：コンテンツ管理（冊子の構造）。PDFのサムネイルは表示せず、割り当て状況だけを示す
function renderContentList(cur, draft) {
  const { contents, pages, pdfAssets } = cur;
  const done = presetAllDone(cur);
  const items = contents
    .map((c) => {
      const nums = placementPages(pages, c.id);
      const placed = nums.length > 0;
      const status = placed
        ? `<span class="text-indigo-700">配置：${esc(placementLabel(nums))}</span>`
        : '<span class="text-slate-500">配置：未配置（ドラッグして配置）</span>';
      const summary = pdfSummary(c, pages, pdfAssets, cur.renderImages);
      const extra = materialCountLabel(summary);
      // 配置の解除（コンテンツ・PDF素材は残り、ページ配置とそのページへの割り当てだけが外れる）
      const unplace = placed
        ? `<button type="button" class="${btnSecondary} !px-2 !py-1 !text-xs" data-action="unplace-content" data-id="${esc(c.id)}">配置を解除</button>`
        : '';
      return `<li class="rounded border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm" draggable="true" data-drag-content="${esc(c.id)}" data-content-card="${esc(c.id)}">
        <div class="flex items-start justify-between gap-2">
          <span class="min-w-0 cursor-grab font-medium [overflow-wrap:anywhere]">${esc(c.name)}</span>
          <span class="shrink-0 text-xs text-slate-600" data-required-pages>${c.requiredPages}P</span>
        </div>
        <div class="mt-1 text-xs" data-placement>${status}</div>
        <div class="text-xs text-slate-600" data-pdf-summary>${esc(pdfSummaryLabel(summary))}${extra ? `<span class="ml-2 text-slate-500" data-material-count>${esc(extra)}</span>` : ''}</div>
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <button type="button" class="${btnSecondary} !px-2 !py-1 !text-xs" data-action="edit-content" data-id="${esc(c.id)}">編集</button>
          <button type="button" class="${btnDanger} !px-2 !py-1 !text-xs" data-action="ask-delete-content" data-id="${esc(c.id)}">削除</button>
          <button type="button" class="${btnSecondary} !px-2 !py-1 !text-xs" data-action="show-content-pdf" data-id="${esc(c.id)}" aria-haspopup="dialog" aria-label="${esc(c.name)}のPDF配置情報" title="PDF配置情報">…</button>
          ${unplace}
        </div>
      </li>`;
    })
    .join('');
  const empty = contents.length === 0
    ? '<p class="rounded border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500" data-empty-contents>コンテンツはまだありません。［標準構成をセット］か、下のフォームから追加してください。</p>'
    : '';
  return `
    <section class="rounded-lg border border-slate-200 bg-white p-4">
      <h2 class="mb-3 text-sm font-semibold">コンテンツ一覧</h2>
      <button type="button" class="${btnSecondary} mb-3 w-full gap-2 !border-indigo-300 !text-indigo-700 hover:!bg-indigo-50" data-action="open-preset" aria-haspopup="dialog" ${done ? 'disabled' : ''}
        title="${done ? '標準構成はすべて標準の位置に配置済みです' : '表紙・表紙裏・目次・裏表紙裏・裏表紙を、標準の位置にまとめてセットします'}">標準構成をセット</button>
      <ul class="space-y-2" data-content-list>${items}</ul>${empty}
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

// 中央カラム：P1〜PNのページカード（素材の割り当て先・コンテンツの配置先）
// 表示は4状態：空き／PDF未登録／素材あり・未割り当て／画像
const STATE_TEXT = { empty: '', 'no-pdf': 'PDF未登録', unassigned: '素材あり・未割り当て' };

function renderPageCards(cur, selectedNo) {
  const { contents, pages } = cur;
  const byId = new Map(contents.map((c) => [c.id, c]));
  const cards = pages
    .map((p) => {
      const c = p.contentId ? byId.get(p.contentId) : null;
      const selected = p.physicalPageNumber === selectedNo;
      const ring = selected ? 'ring-2 ring-indigo-500' : 'ring-1 ring-slate-200';
      const index = c && c.requiredPages > 1 ? ` ${circled(p.contentPageIndex + 1)}` : '';
      const label = c ? `${esc(c.name)}${index}` : '空き';
      // 割り当て済みの画像だけを表示する（素材の並び順などから推測して表示しない）
      const url = getImageUrl(p.renderImageId);
      const st = pageState(cur, p, !!url);
      const thumb =
        st === 'image'
          ? `<img src="${url}" alt="P${p.physicalPageNumber}のページ画像" class="h-full w-full object-contain" draggable="false" />`
          : STATE_TEXT[st];
      const stateCls = st === 'unassigned' ? 'text-amber-700' : 'text-slate-400';
      const bg = c ? 'bg-indigo-50' : 'bg-white border border-dashed border-slate-300';
      const drag = c ? `draggable="true" data-drag-content="${esc(c.id)}"` : '';
      // 割り当ての解除：PCではhover/focus時に表示、タッチ環境では常時表示
      const unassign =
        st === 'image'
          ? `<button type="button" data-action="unassign-page" data-no="${p.physicalPageNumber}" aria-label="P${p.physicalPageNumber}の画像の割り当てを解除"
              class="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-sm text-slate-700 shadow ring-1 ring-slate-300 opacity-0 hover:bg-red-50 hover:text-red-700 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
              title="割り当てを解除">×</button>`
          : '';
      return `
        <li class="group relative">
          <div role="button" tabindex="0" data-action="select-page" data-no="${p.physicalPageNumber}" data-drop-page="${p.physicalPageNumber}" data-page-state="${st}" ${drag}
            class="block w-full cursor-pointer rounded-lg bg-white p-2 text-left shadow-sm ${ring} hover:ring-indigo-300">
            <div class="page-thumb flex items-center justify-center overflow-hidden rounded ${bg} text-xs ${stateCls}" data-page-thumb>${thumb}</div>
            <div class="mt-2 flex items-center justify-between gap-1">
              <span class="text-sm font-semibold">P${p.physicalPageNumber}</span>
            </div>
            <div class="truncate text-xs text-slate-600">${label}</div>
          </div>${unassign}
        </li>`;
    })
    .join('');
  return `<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">${cards}</ul>`;
}

// 右カラム：PDF素材の管理（対象コンテンツの選択・PDFの登録／差し替え／削除・素材の一覧と割り当て）
function renderMaterialItem(img, assignedPage) {
  const url = getImageUrl(img.id);
  const thumb = url
    ? `<img src="${url}" alt="${esc(materialName(img))}のサムネイル" loading="lazy" decoding="async" class="h-full w-full object-contain" draggable="false" />`
    : '';
  const status = assignedPage
    ? `<span class="text-indigo-700" data-material-status>P${assignedPage}に割り当て済み</span>`
    : '<span class="text-slate-500" data-material-status>未割り当て</span>';
  return `<li draggable="true" data-drag-image="${esc(img.id)}" data-material="${esc(img.id)}" data-assigned-page="${assignedPage ?? ''}"
      class="flex cursor-grab items-center gap-3 rounded border ${assignedPage ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white'} p-2">
      <div class="flex h-24 w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-100">${thumb}</div>
      <div class="min-w-0 text-sm"><p class="font-medium" data-material-name>${esc(materialName(img))}</p><p class="text-xs">${status}</p></div>
    </li>`;
}

function renderMaterials(state) {
  const cur = state.current;
  const { contents, pages } = cur;
  const head = '<h2 class="mb-3 text-sm font-semibold">PDF素材</h2>';
  if (contents.length === 0) {
    return `<section class="rounded-lg border border-slate-200 bg-white p-4" data-materials>${head}
      <p class="text-sm text-slate-500" data-materials-empty>コンテンツを追加すると、ここでPDF素材を管理できます。</p></section>`;
  }
  const targetId = resolveMaterialContentId(contents, pages, state.selectedPageNo, state.materialContentId);
  const content = contents.find((c) => c.id === targetId);
  const asset = assetOfContent(cur, targetId);
  const options = contents
    .map((c) => `<option value="${esc(c.id)}" ${c.id === targetId ? 'selected' : ''}>${esc(c.name)}${assetOfContent(cur, c.id) ? '（PDFあり）' : ''}</option>`)
    .join('');
  const select = `<label for="m-content" class="block text-xs text-slate-600">対象コンテンツ</label>
    <select id="m-content" data-material-select class="${inputCls} mb-3">${options}</select>`;

  if (!asset) {
    return `<section class="rounded-lg border border-slate-200 bg-white p-4" data-materials data-material-content="${esc(targetId)}">${head}${select}
      <p class="mb-2 text-xs text-slate-500" data-material-none>「${esc(content.name)}」のPDFは未登録です。</p>
      ${pdfPicker(targetId, '＋ PDFを登録')}</section>`;
  }
  const images = materialsOf(cur, targetId);
  const used = assignmentMap(pages);
  const pdfPages = new Set(images.map((i) => i.sourcePdfPage)).size;
  const plan = planSequentialAssign(cur, targetId);
  const items = images.map((img) => renderMaterialItem(img, used.get(img.id))).join('');
  const menu = state.materialMenuOpen
    ? `<div class="absolute right-0 z-10 mt-1 w-44 rounded-md border border-slate-200 bg-white py-1 shadow-lg" role="menu" data-material-menu-list>
        <label class="block cursor-pointer px-3 py-2 text-sm hover:bg-slate-100 focus-within:bg-slate-100" role="menuitem">PDFを差し替え
          <input type="file" accept="application/pdf,.pdf" class="sr-only" data-pdf-input data-content-id="${esc(targetId)}" />
        </label>
        <button type="button" class="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" role="menuitem" data-action="ask-unregister-pdf" data-id="${esc(targetId)}">PDFを削除</button>
      </div>`
    : '';
  const seqTitle =
    plan.count === 0
      ? '割り当てできる素材、または空きページがありません'
      : `未割り当ての素材を、このコンテンツの空きページへ順に割り当てます（${plan.count}ページ）`;
  return `<section class="rounded-lg border border-slate-200 bg-white p-4" data-materials data-material-content="${esc(targetId)}">${head}${select}
    <div class="mb-3 flex items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="break-all text-sm font-medium" data-material-file>${esc(asset.originalFileName)}</p>
        <p class="text-xs text-slate-500" data-material-count-line>PDF ${pdfPages}ページ／素材 ${images.length}</p>
        <p class="text-xs text-slate-400">登録 ${formatDateTime(asset.importedAt)}</p>
      </div>
      <div class="relative shrink-0" data-material-menu>
        <button type="button" class="${btnSecondary} !px-2 !py-1" data-action="toggle-material-menu" aria-haspopup="menu" aria-expanded="${state.materialMenuOpen}" aria-label="PDFのメニュー">︙</button>${menu}
      </div>
    </div>
    <button type="button" class="${btnSecondary} mb-3 w-full" data-action="assign-sequential" data-id="${esc(targetId)}" ${plan.count === 0 ? 'disabled' : ''}
      title="${seqTitle}">PDFを順番に割り当て</button>
    <ul class="space-y-2" data-material-list>${items}</ul>
    <p class="mt-3 text-xs text-slate-500">素材を、このコンテンツのページカードへドラッグして割り当てます。</p>
  </section>`;
}

export function renderCompose(state) {
  const cur = state.current;
  // lg以上：高さを親（画面の高さ）に合わせ、3カラムがそれぞれ縦スクロールする。lg未満：縦に積んでページ全体でスクロール
  return `
    <div class="grid gap-4 lg:h-full lg:grid-cols-[280px_minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)]" data-compose-grid>
      <aside class="relative min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1" data-scroll-key="compose-left" data-column="left">${renderContentList(cur, state.contentDraft)}</aside>
      <section class="relative min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1" data-scroll-key="compose-center" data-column="center">${renderPageCards(cur, state.selectedPageNo)}</section>
      <aside class="relative min-w-0 space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1" data-scroll-key="compose-right" data-column="right">${renderMaterials(state)}</aside>
    </div>`;
}
