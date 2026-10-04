import { esc, btnSecondary, btnPrimary, inputCls } from './util.js';
import { modeRadios, renderPdfImportModal } from './pdf-import-modal.js';

// 冊子削除の確認ダイアログ（登録PDFも削除され元に戻せない旨を明示する）
export function renderModal(state) {
  const m = state.modal;
  if (!m) return '';
  if (m.type === 'delete-booklet') {
    return `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-scroll-key="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
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
  if (m.type === 'delete-content') {
    // 配置済みの場合は、配置も解除されることを明示して確認する
    const msg = m.placed
      ? 'このコンテンツは冊子に配置されています。削除すると配置も解除されます。削除しますか？'
      : 'このコンテンツを削除しますか？';
    // PDF登録済みのコンテンツは、PDFの扱いを選ぶまで削除できない
    const pdfNote = m.hasPdf
      ? `<p class="mb-2 text-sm text-slate-700">このコンテンツにはPDFが登録されています。PDFの扱いを選んでください。</p>${modeRadios(m.mode, 'content')}<div class="mb-4"></div>`
      : '';
    return `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-scroll-key="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
          <h2 id="dlg-title" class="mb-2 text-lg font-semibold">コンテンツを削除</h2>
          <p class="mb-1 break-words text-sm font-medium">「${esc(m.name)}」</p>
          <p class="mb-3 text-sm text-slate-700">${msg}</p>${pdfNote}
          <div class="flex justify-end gap-3">
            <button type="button" class="${btnSecondary}" data-action="cancel-modal">キャンセル</button>
            <button type="button" class="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              data-action="confirm-delete-content" data-id="${esc(m.id)}" ${m.hasPdf && !m.mode ? 'disabled' : ''}>削除する</button>
          </div>
        </div>
      </div>`;
  }
  if (m.type === 'pdf-import') return renderPdfImportModal(m);
  if (m.type === 'unregister-pdf') {
    return `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-scroll-key="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
          <h2 id="dlg-title" class="mb-2 text-lg font-semibold">PDF登録を解除</h2>
          <p class="mb-1 break-words text-sm font-medium">「${esc(m.contentName)}」／${esc(m.fileName)}</p>
          <p class="mb-3 text-sm text-slate-700">コンテンツと冊子ページへの配置は残り、PDFとの関連だけが解除されます。元PDFの扱いを選んでください。</p>
          ${modeRadios(m.mode, 'unregister')}
          <div class="mt-4 flex justify-end gap-3">
            <button type="button" class="${btnSecondary}" data-action="cancel-modal">キャンセル</button>
            <button type="button" class="${btnPrimary}" data-action="confirm-unregister-pdf" ${m.mode ? '' : 'disabled'}>解除する</button>
          </div>
        </div>
      </div>`;
  }
  if (m.type === 'edit-content') {
    const err = (e) => (e ? `<p class="mt-1 text-xs text-red-600" role="alert">${esc(e)}</p>` : '');
    return `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-scroll-key="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <form data-form="edit-content" data-id="${esc(m.id)}" class="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl" novalidate>
          <h2 id="dlg-title" class="text-lg font-semibold">コンテンツを編集</h2>
          <div>
            <label for="e-name" class="block text-sm font-medium">コンテンツ名</label>
            <input id="e-name" data-keep-value name="name" type="text" class="${inputCls}" value="${esc(m.name)}" autocomplete="off" />
            ${err(m.errors?.name)}
          </div>
          <div>
            <label for="e-pages" class="block text-sm font-medium">必要ページ数</label>
            <input id="e-pages" data-keep-value name="requiredPages" type="text" inputmode="numeric" class="${inputCls}" value="${esc(m.requiredPages)}" autocomplete="off" />
            ${err(m.errors?.requiredPages)}
          </div>
          <div class="flex justify-end gap-3">
            <button type="button" class="${btnSecondary}" data-action="cancel-modal">キャンセル</button>
            <button type="submit" class="${btnPrimary}">保存</button>
          </div>
        </form>
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
