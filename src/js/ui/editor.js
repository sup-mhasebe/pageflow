import { esc, btnSecondary, inputCls, iconPencil, iconChevronDown } from './util.js';
import { usage } from '../domain/booklet.js';
import { capacity } from '../domain/content.js';
import { renderCompose } from './compose.js';
import { renderImposition } from './imposition-view.js';
import { renderViewer, buildViewerModel } from './viewer.js';

const TABS = [
  { key: 'compose', label: '構成' },
  { key: 'preview', label: '冊子プレビュー' },
  { key: 'imposition', label: '面付' },
];

const SAVE_LABEL = {
  saving: '<span class="text-amber-600">保存中…</span>',
  saved: '<span class="text-emerald-600">✓ 保存済み</span>',
  error: '<span class="text-red-600">保存エラー</span>',
};

// 冊子名：通常はクリックで編集に入る。編集中は入力欄（Enterで確定、Escで取り消し）
function renderNameField(name, edit) {
  if (!edit) {
    return `<button type="button" class="group flex max-w-full items-center gap-2 rounded px-1 text-left text-xl font-bold hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        data-action="edit-name" title="クリックして冊子名を編集">
        <span class="min-w-0 break-words sm:truncate" data-booklet-name>${esc(name)}</span>
        <span class="shrink-0 text-slate-400 group-hover:text-indigo-600">${iconPencil('h-4 w-4')}<span class="sr-only">冊子名を編集</span></span>
      </button>`;
  }
  const err = edit.error ? `<p class="mt-1 text-xs text-red-600" role="alert">${esc(edit.error)}</p>` : '';
  return `<form data-form="rename-booklet" class="w-full max-w-xl" novalidate>
      <div class="flex items-center gap-2">
        <input id="h-name" data-keep-value name="name" type="text" class="${inputCls} text-base font-semibold" value="${esc(edit.draft)}" autocomplete="off" aria-label="冊子名" />
        <button type="submit" class="${btnSecondary}" aria-label="冊子名を保存">保存</button>
        <button type="button" class="${btnSecondary}" data-action="cancel-name-edit" aria-label="編集を取り消す">取消</button>
      </div>${err}
    </form>`;
}

export function renderEditor(state) {
  const { booklet, contents, pages } = state.current;
  const u = usage(booklet.totalPages, contents, pages);
  const cap = capacity(state.current);
  const warn = cap.over
    ? `<p class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
        容量超過：登録コンテンツの必要ページ数の合計が${cap.registered}Pで、総ページ数（${cap.available}P）を超えています。</p>`
    : '';

  const tabs = TABS.map((t) => {
    const active = state.tab === t.key;
    const cls = active
      ? 'border-indigo-600 text-indigo-700'
      : 'border-transparent text-slate-600 hover:text-slate-900';
    return `<button type="button" data-action="set-tab" data-tab="${t.key}"
      class="border-b-2 px-4 py-2 text-sm font-medium ${cls}">${t.label}</button>`;
  }).join('');

  let body;
  if (state.tab === 'compose') body = renderCompose(state);
  else if (state.tab === 'preview') body = renderViewer(buildViewerModel(state.current), state.viewer, state.viewerMode);
  else body = renderImposition(state);

  // 構成タブ（lg以上）：ヘッダー・タブは固定し、本文の3カラムがそれぞれスクロールする
  const fit = state.tab === 'compose';
  return `
    <div class="mx-auto max-w-7xl px-4 py-4 ${fit ? 'lg:flex lg:h-dvh lg:flex-col' : ''}">
      <header class="mb-4 space-y-2 ${fit ? 'lg:shrink-0' : ''}">
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="${btnSecondary}" data-action="go-home">← 一覧へ</button>
          <div class="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">${renderNameField(booklet.name, state.nameEdit)}</div>
          <button type="button" class="${btnSecondary} gap-1" data-action="open-resize" aria-haspopup="dialog" title="総ページ数を変更">
            <span data-total-pages>全${u.total}P</span>${iconChevronDown('h-4 w-4')}
          </button>
          <button type="button" class="${btnSecondary}" data-action="export-pageflow" ${state.exporting ? 'disabled' : ''}>
            ${state.exporting ? '書き出し中…' : 'ビューア用データを書き出す'}
          </button>
          <span class="text-sm" aria-live="polite">${SAVE_LABEL[state.saveStatus]}</span>
        </div>
        <p class="text-sm text-slate-600">
          コンテンツ${u.content}P｜空き${u.empty}P
        </p>
        ${warn}
        <nav class="flex border-b border-slate-200" aria-label="編集タブ">${tabs}</nav>
      </header>
      <div class="${fit ? 'lg:min-h-0 lg:flex-1' : ''}">${body}</div>
    </div>`;
}
