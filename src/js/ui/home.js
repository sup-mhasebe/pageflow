import { esc, formatDateTime, btnPrimary, btnSecondary, btnDanger, iconBook } from './util.js';

function bookletCard(b) {
  return `
    <li class="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h3 class="flex items-start gap-2 text-base font-semibold">
          ${iconBook('mt-0.5 h-5 w-5 shrink-0 text-indigo-600')}
          <span class="min-w-0 [overflow-wrap:anywhere]">${esc(b.name)}</span>
        </h3>
        <p class="mt-1 text-sm text-slate-600">総ページ数：${b.totalPages}P</p>
        <p class="text-xs text-slate-500">更新：${formatDateTime(b.updatedAt)}</p>
      </div>
      <div class="mt-auto flex flex-wrap gap-2">
        <button type="button" class="${btnPrimary}" data-action="open-booklet" data-id="${esc(b.id)}">編集</button>
        <button type="button" class="${btnSecondary}" data-action="open-viewer" data-id="${esc(b.id)}">ビューア</button>
        <button type="button" class="${btnDanger}" data-action="ask-delete" data-id="${esc(b.id)}">削除</button>
      </div>
    </li>`;
}

export function renderHome(state) {
  const cards = state.booklets.map(bookletCard).join('');
  const empty = `<p class="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
      保存済みの冊子はまだありません。［新しい冊子を作成］から始めてください。</p>`;
  const importError = state.importError
    ? `<div class="mb-4 flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800" role="alert" data-import-error>
        <p class="flex-1 break-words">${esc(state.importError)}</p>
        <button type="button" class="text-red-700 hover:text-red-900" data-action="dismiss-import-error" aria-label="閉じる">×</button>
      </div>`
    : '';
  const invalid =
    state.invalidCount > 0
      ? `<p class="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          形式が不正で読み込めない保存データが ${state.invalidCount} 件あります（データは削除していません）。</p>`
      : '';
  return `
    <div class="mx-auto max-w-5xl px-4 py-8">
      <header class="mb-8">
        <h1 class="text-3xl font-bold tracking-tight text-indigo-700">PageFlow</h1>
        <p class="mt-1 text-sm text-slate-600">冊子制作・面付シミュレーター</p>
      </header>
      <div class="mb-6 flex flex-wrap gap-3">
        <button type="button" class="${btnPrimary}" data-action="go-new">新しい冊子を作成</button>
        <!-- accept は指定しない：iOS Safari などで未知の拡張子 (.pageflow) を指定すると選択できなくなることがあるため。拡張子は読み込み時に検証する -->
        <label class="${btnSecondary} cursor-pointer focus-within:ring-2 focus-within:ring-indigo-400 ${state.importing ? 'pointer-events-none opacity-50' : ''}">
          ${state.importing ? '読み込み中…' : 'ビューア用データを読み込む'}
          <input type="file" class="sr-only" data-pageflow-input ${state.importing ? 'disabled' : ''} />
        </label>
      </div>
      ${importError}${invalid}
      <h2 class="mb-3 text-lg font-semibold">保存済みの冊子</h2>
      ${
        state.booklets.length === 0
          ? empty
          : `<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${cards}</ul>`
      }
    </div>`;
}
