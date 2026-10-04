import { esc, btnPrimary, btnSecondary, inputCls } from './util.js';
import { fixedLayout } from '../domain/booklet.js';
import { parseTotalPagesInput } from '../schemas.js';

// 総ページ数に応じた固定ページ構成のプレビュー（不正な値のときは案内文）
export function renderFixedPreview(rawTotalPages) {
  const parsed = parseTotalPagesInput(rawTotalPages);
  if (!parsed.success) {
    return '<p class="text-sm text-slate-500">有効な総ページ数（8以上の4の倍数）を入力すると、固定ページ構成を表示します。</p>';
  }
  const rows = fixedLayout(parsed.data)
    .map((f) => `<li class="flex justify-between"><span>P${f.position}</span><span>${esc(f.name)}</span></li>`)
    .join('');
  return `<ul class="max-w-xs space-y-1 text-sm">${rows}</ul>`;
}

export function renderCreate(form) {
  const err = (m) => (m ? `<p class="mt-1 text-xs text-red-600" role="alert">${esc(m)}</p>` : '');
  return `
    <div class="mx-auto max-w-2xl px-4 py-8">
      <h1 class="mb-6 text-2xl font-bold">新しい冊子を作成</h1>
      <form data-form="create" class="space-y-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm" novalidate>
        <div>
          <label for="f-name" class="mb-1 block text-sm font-medium">冊子名</label>
          <input id="f-name" name="name" type="text" class="${inputCls}" value="${esc(form.name)}" maxlength="200" autocomplete="off" />
          <div data-error-for="name">${err(form.errors.name)}</div>
        </div>
        <div>
          <label for="f-total" class="mb-1 block text-sm font-medium">総ページ数</label>
          <input id="f-total" name="totalPages" type="text" inputmode="numeric" class="${inputCls}" value="${esc(form.totalPages)}" autocomplete="off" />
          <p class="mt-1 text-xs text-slate-500">8以上の4の倍数で指定してください。</p>
          <div data-error-for="totalPages">${err(form.errors.totalPages)}</div>
        </div>
        <div>
          <p class="mb-1 text-sm font-medium">テンプレート</p>
          <p class="text-sm text-slate-700">標準冊子（固定）</p>
          <p class="text-xs text-slate-500">A4縦／左綴じ／中綴じ</p>
        </div>
        <div>
          <p class="mb-1 text-sm font-medium">固定ページ構成</p>
          <div data-fixed-preview>${renderFixedPreview(form.totalPages)}</div>
        </div>
        <div class="flex flex-wrap gap-3">
          <button type="submit" class="${btnPrimary}">作成する</button>
          <button type="button" class="${btnSecondary}" data-action="go-home">キャンセル</button>
        </div>
      </form>
    </div>`;
}
