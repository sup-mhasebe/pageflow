import { esc, btnSecondary, btnPrimary, inputCls, formatRanges, circled } from './util.js';
import { presetStatus } from '../domain/preset.js';
import { pdfInfoRows } from '../domain/content-info.js';
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
  if (m.type === 'preset') return renderPresetDialog(m, state.current);
  if (m.type === 'content-pdf-info') return renderContentPdfInfo(m, state.current);
  if (m.type === 'resize-pages') return m.stage === 'confirm' ? renderResizeConfirm(m) : renderResizeInput(m);
  if (m.type === 'pdf-import') return renderPdfImportModal(m);
  if (m.type === 'unregister-pdf') {
    return `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-scroll-key="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
          <h2 id="dlg-title" class="mb-2 text-lg font-semibold">PDFを削除</h2>
          <p class="mb-1 break-words text-sm font-medium">「${esc(m.contentName)}」／${esc(m.fileName)}</p>
          <p class="mb-3 text-sm text-slate-700">このPDFの素材が削除されます。コンテンツと冊子ページへの配置は残ります。元PDFの扱いを選んでください。</p>
          ${m.assigned > 0 ? `<p class="mb-3 rounded bg-amber-50 p-2 text-sm font-medium text-amber-800" role="alert" data-release-warning>${m.assigned}ページの割り当てが解除されます。</p>` : ''}
          ${modeRadios(m.mode, 'unregister')}
          <div class="mt-4 flex justify-end gap-3">
            <button type="button" class="${btnSecondary}" data-action="cancel-modal">キャンセル</button>
            <button type="button" class="${btnPrimary}" data-action="confirm-unregister-pdf" ${m.mode ? '' : 'disabled'}>削除する</button>
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

const OVERLAY = '<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-scroll-key="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title">';

// 総ページ数の変更：［－］［12］P［＋］（4ずつ増減。直接入力も可）
function renderResizeInput(m) {
  const err = m.error ? `<p class="mt-2 text-xs text-red-600" role="alert">${esc(m.error)}</p>` : '';
  return `${OVERLAY}
      <form data-form="resize-pages" class="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl" novalidate>
        <h2 id="dlg-title" class="mb-3 text-lg font-semibold">総ページ数</h2>
        <div class="flex items-center justify-center gap-2">
          <button type="button" class="${btnSecondary} !px-3 text-lg" data-action="resize-step" data-dir="-1" aria-label="4ページ減らす">－</button>
          <input id="r-total" data-keep-value name="totalPages" type="text" inputmode="numeric" class="${inputCls} !w-24 text-center text-lg" value="${esc(m.value)}" autocomplete="off" aria-label="総ページ数" />
          <span class="text-sm">P</span>
          <button type="button" class="${btnSecondary} !px-3 text-lg" data-action="resize-step" data-dir="1" aria-label="4ページ増やす">＋</button>
        </div>
        <p class="mt-3 text-center text-xs text-slate-500">※4の倍数で設定してください（8P以上）</p>
        ${err}
        <div class="mt-4 flex justify-end gap-3">
          <button type="button" class="${btnSecondary}" data-action="cancel-modal">キャンセル</button>
          <button type="submit" class="${btnPrimary}">変更</button>
        </div>
      </form>
    </div>`;
}

// ページ数の減少で、コンテンツまたはPDFが配置されたページが削除される場合の確認
function renderResizeConfirm(m) {
  const plan = m.plan;
  const list = plan.affected
    .map((a) => `<li class="break-words">「${esc(a.name)}」（${esc(formatRanges(a.pages))}）の配置が解除されます</li>`)
    .join('');
  return `${OVERLAY}
      <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="dlg-title" class="mb-2 text-lg font-semibold">総ページ数を${m.newTotalPages}Pに変更しますか？</h2>
        <p class="mb-2 text-sm text-slate-700">${esc(formatRanges(plan.occupiedCutPages))}にはコンテンツまたはPDFが配置されています。${m.newTotalPages}Pに変更すると、これらのページ配置が解除されます。</p>
        ${list ? `<ul class="mb-2 list-disc space-y-0.5 pl-5 text-sm text-slate-700" data-affected>${list}</ul>` : ''}
        <p class="mb-4 text-sm font-medium text-slate-700">コンテンツと登録済みPDF素材そのものは削除されません。</p>
        <div class="flex justify-end gap-3">
          <button type="button" class="${btnSecondary}" data-action="cancel-modal">キャンセル</button>
          <button type="button" class="inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700" data-action="confirm-resize">変更する</button>
        </div>
      </div>
    </div>`;
}

// 標準構成をセット：項目ごとにチェックして選ぶ。選べない項目はグレーアウトして理由を表示する
function renderPresetDialog(m, cur) {
  const status = presetStatus(cur);
  const selected = new Set(m.selected);
  const rows = status
    .map((s) => {
      const checked = s.selectable && selected.has(s.key);
      const cls = s.selectable ? 'text-slate-800' : 'text-slate-400';
      const note = s.note ? `<span class="block text-xs ${s.selectable ? 'text-indigo-700' : 'text-slate-500'}">${esc(s.note)}</span>` : '';
      return `<li>
        <label class="flex items-start gap-2 rounded px-2 py-1.5 ${s.selectable ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed bg-slate-50'}" data-preset-row="${s.key}" data-status="${s.status}">
          <input id="preset-${s.key}" type="checkbox" class="mt-0.5 h-4 w-4 rounded border-slate-300" data-preset-key="${s.key}" ${checked ? 'checked' : ''} ${s.selectable ? '' : 'disabled'} />
          <span class="min-w-0 flex-1 text-sm ${cls}">
            <span class="flex justify-between gap-2"><span>${esc(s.name)}（1P）</span><span class="shrink-0">→ P${s.position}</span></span>${note}
          </span>
        </label>
      </li>`;
    })
    .join('');
  const none = !status.some((s) => s.selectable && selected.has(s.key));
  return `${OVERLAY}
      <div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="dlg-title" class="mb-1 text-lg font-semibold">標準構成をセット</h2>
        <p class="mb-3 text-xs text-slate-600">セットする項目を選んでください。コンテンツを一覧に追加し、標準の位置へ配置します。すでにあるコンテンツの配置は動かしません。</p>
        <ul class="space-y-1" data-preset-list>${rows}</ul>
        <div class="mt-4 flex justify-end gap-3">
          <button type="button" class="${btnSecondary}" data-action="cancel-modal">キャンセル</button>
          <button type="button" class="${btnPrimary}" data-action="confirm-preset" ${none ? 'disabled' : ''}>選択したコンテンツをセット</button>
        </div>
      </div>
    </div>`;
}

// コンテンツの「…」：画像が割り当て済みのページを、ページ番号の昇順で表示する（確認用。編集操作はない）
function renderContentPdfInfo(m, cur) {
  const c = cur.contents.find((x) => x.id === m.contentId);
  if (!c) return '';
  const rows = pdfInfoRows(c, cur.pages, circled);
  const body = rows.length
    ? `<ul class="space-y-1 text-sm" data-pdf-info-list>${rows.map((r) => `<li class="flex gap-3"><span class="w-10 shrink-0 font-semibold">P${r.pageNo}</span><span class="min-w-0 break-words">${esc(r.label)}</span></li>`).join('')}</ul>`
    : '<p class="text-sm text-slate-600" data-pdf-info-empty>配置されているPDFはありません</p>';
  return `${OVERLAY}
      <div class="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <h2 id="dlg-title" class="mb-3 break-words text-lg font-semibold">PDF配置情報（${esc(c.name)}）</h2>
        ${body}
        <div class="mt-4 flex justify-end">
          <button type="button" class="${btnSecondary}" data-action="cancel-modal">閉じる</button>
        </div>
      </div>
    </div>`;
}
