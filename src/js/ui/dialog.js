import { esc, btnSecondary } from './util.js';

// 冊子削除の確認ダイアログ（登録PDFも削除され元に戻せない旨を明示する）
export function renderModal(state) {
  const m = state.modal;
  if (!m) return '';
  if (m.type === 'delete-booklet') {
    return `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
          <h2 id="dlg-title" class="mb-2 text-lg font-semibold">冊子を削除しますか？</h2>
          <p class="mb-1 break-words text-sm font-medium">「${esc(m.name)}」</p>
          <p class="mb-4 text-sm text-slate-700">登録PDFも削除され、この操作は元に戻せません。</p>
          <div class="flex justify-end gap-3">
            <button type="button" class="${btnSecondary}" data-action="cancel-modal">キャンセル</button>
            <button type="button" class="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              data-action="confirm-delete" data-id="${esc(m.id)}">削除する</button>
          </div>
        </div>
      </div>`;
  }
  return '';
}

export function renderToast(state) {
  const t = state.toast;
  if (!t) return '';
  const color = t.type === 'error' ? 'bg-red-600' : t.type === 'success' ? 'bg-emerald-600' : 'bg-slate-800';
  return `
    <div class="fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2" role="status">
      <div class="flex items-start gap-3 rounded-md ${color} px-4 py-3 text-sm text-white shadow-lg">
        <span class="flex-1 break-words">${esc(t.message)}</span>
        <button type="button" class="text-white/80 hover:text-white" data-action="dismiss-toast" aria-label="閉じる">×</button>
      </div>
    </div>`;
}
