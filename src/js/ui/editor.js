import { esc, btnSecondary } from './util.js';
import { usage } from '../domain/booklet.js';
import { capacity } from '../domain/content.js';
import { renderCompose, renderComingSoon } from './compose.js';

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

export function renderEditor(state) {
  const { booklet, contents, pages } = state.current;
  const u = usage(booklet.totalPages, contents, pages);
  const cap = capacity(state.current);
  const warn = cap.over
    ? `<p class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
        容量超過：登録コンテンツの合計が${cap.registered}Pで、固定ページを除く配置可能ページ数（${cap.available}P）を超えています。</p>`
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
  else if (state.tab === 'preview') body = renderComingSoon('冊子プレビュー');
  else body = renderComingSoon('面付シミュレーション');

  return `
    <div class="mx-auto max-w-7xl px-4 py-4">
      <header class="mb-4 space-y-2">
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="${btnSecondary}" data-action="go-home">← 一覧へ</button>
          <h1 class="min-w-0 flex-1 truncate text-xl font-bold">${esc(booklet.name)}</h1>
          <span class="text-sm" aria-live="polite">${SAVE_LABEL[state.saveStatus]}</span>
        </div>
        <p class="text-sm text-slate-600">
          全${u.total}P｜固定${u.fixed}P｜コンテンツ${u.content}P｜空き${u.empty}P
        </p>
        ${warn}
        <nav class="flex border-b border-slate-200" aria-label="編集タブ">${tabs}</nav>
      </header>
      ${body}
    </div>`;
}
