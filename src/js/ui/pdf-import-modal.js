import { esc, btnSecondary, btnPrimary } from './util.js';

// 旧PDF／元PDFの扱いの選択（どちらも選ばない限り確定できない＝黙って消さない）
export function modeRadios(mode, kind) {
  const labels = {
    replace: ['旧PDFをゴミ箱へ移動して差し替える', '旧PDFを完全削除して差し替える'],
    unregister: ['元PDFをゴミ箱へ移動する', '元PDFを完全削除する'],
    content: ['PDFをゴミ箱へ移してコンテンツを削除', 'PDFも完全削除してコンテンツを削除'],
  };
  const label = labels[kind];
  const row = (value, text) => `
    <label class="flex cursor-pointer items-start gap-2 text-sm">
      <input type="radio" name="pdf-mode-${kind}" class="mt-0.5" data-action="set-pdf-mode" data-mode="${value}" ${mode === value ? 'checked' : ''} />
      <span>${text}</span>
    </label>`;
  return `<div class="space-y-2" role="radiogroup">${row('trash', label[0])}${row('delete', label[1])}</div>`;
}

const KIND_LABEL = { a4: 'A4', a3: 'A3横 → A4×2（左→右）' };

const alertBox = (cls, text) => `<p class="rounded p-3 text-sm ${cls}" role="alert">${esc(text)}</p>`;

// A3分割確認：A3全体のプレビュー＋中央の分割線。左が先の素材、右が次の素材（割り当ては登録後に右カラムで行う）
function renderA3Section(m) {
  const a3 = m.items.filter((i) => i.kind === 'a3');
  if (a3.length === 0) return '';
  const target = (n, side) => `素材「${n}ページ（${side}）」`;
  const rows = a3
    .map((i) => {
      const url = m.previews[i.pageNumber];
      const fb = m.fallbacks?.[i.pageNumber];
      // 全体プレビューを作れなかったページ：左右の分割結果（実際に生成した画像）を見せて確認してもらう
      const fallbackBody = fb
        ? `<p class="mb-1 rounded bg-amber-50 p-2 text-xs text-amber-800" data-preview-failed>全体プレビューを表示できませんでした。左右に分割した結果を確認してください。</p>
           <div class="grid grid-cols-2 gap-2" data-split-thumbs>
             <figure class="m-0 overflow-hidden rounded border border-slate-300"><img src="${fb.left}" alt="左側の分割画像" class="block w-full" /><figcaption class="bg-slate-100 px-2 py-1 text-center text-xs">左側 → ${target(i.pageNumber, '左')}</figcaption></figure>
             <figure class="m-0 overflow-hidden rounded border border-slate-300"><img src="${fb.right}" alt="右側の分割画像" class="block w-full" /><figcaption class="bg-slate-100 px-2 py-1 text-center text-xs">右側 → ${target(i.pageNumber, '右')}</figcaption></figure>
           </div>`
        : null;
      const body = fallbackBody
        ? fallbackBody
        : url
        ? `<div class="relative overflow-hidden rounded border border-slate-300">
            <img src="${url}" alt="A3ページ全体のプレビュー" class="block w-full" />
            <div class="pointer-events-none absolute inset-y-0 left-1/2 w-0 border-l-2 border-dashed border-red-500" data-split-line></div>
            <span class="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">左 → ${target(i.pageNumber, '左')}</span>
            <span class="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">右 → ${target(i.pageNumber, '右')}</span>
          </div>`
        : '<p class="text-xs text-slate-500">（プレビューは先頭8ページ分のみ表示します）</p>';
      return `<li data-a3-preview="${i.pageNumber}"><p class="mb-1 text-xs text-slate-600">PDF ${i.pageNumber}ページ目</p>${body}</li>`;
    })
    .join('');
  return `<section class="mt-4" aria-label="A3分割の確認">
      <h3 class="mb-2 text-sm font-semibold">A3の分割確認（中央50%で左右に分割します）</h3>
      <ul class="space-y-3">${rows}</ul>
    </section>`;
}

// 登録される素材の一覧。登録しても冊子ページへは自動で割り当てない（登録後に右カラムで割り当てる）
function renderMaterialList(m) {
  const names = [];
  for (const i of m.items) {
    if (i.kind === 'a3') names.push(`${i.pageNumber}ページ（左）`, `${i.pageNumber}ページ（右）`);
    else names.push(`${i.pageNumber}ページ`);
  }
  const li = names.map((n) => `<li>${esc(n)}</li>`).join('');
  return `<section class="mt-4"><h3 class="mb-1 text-sm font-semibold">登録される素材（${names.length}）</h3>
    <ul class="grid grid-cols-3 gap-x-4 text-xs text-slate-700" data-mapping>${li}</ul>
    <p class="mt-2 text-xs text-slate-500">登録しても、ページへは自動で割り当てません。登録後に右カラムから割り当ててください。</p></section>`;
}

// PDF登録モーダル：解析結果、A3分割プレビュー、ページ対応表、差し替え方法を表示して確認を取る
export function renderPdfImportModal(m) {
  const cancel = `<button type="button" class="${btnSecondary}" data-action="cancel-modal">キャンセル</button>`;
  const frame = (inner, footer) => `
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" data-scroll-key="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
      <div class="my-4 w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl">
        <h2 id="dlg-title" class="mb-1 text-lg font-semibold">PDFを登録</h2>
        <p class="mb-3 break-all text-sm text-slate-600">コンテンツ「${esc(m.contentName)}」（必要${m.required}ページ）／${esc(m.fileName)}</p>
        ${inner}
        <div class="mt-4 flex justify-end gap-3">${footer}</div>
      </div>
    </div>`;

  if (m.stage === 'analyzing') {
    return frame('<p class="text-sm text-slate-600" role="status">PDFを解析しています…（ブラウザ内で処理します）</p>', cancel);
  }
  if (m.stage === 'converting') {
    return frame(
      `<p class="text-sm text-slate-600" role="status">表示用の画像を生成しています… ${m.progress.done}/${m.progress.total}ページ</p>`,
      '',
    );
  }
  if (m.stage === 'error') {
    // 原因ごとの見出しと文言。実際の例外名・内容は「技術情報」に出す（個人情報は含めない）
    const title = m.title ? `<p class="mb-1 text-sm font-semibold text-red-800" data-error-title>${esc(m.title)}</p>` : '';
    const detail = m.detail
      ? `<details class="mt-2 text-xs text-slate-600"><summary class="cursor-pointer">技術情報</summary><pre class="mt-1 whitespace-pre-wrap break-all rounded bg-slate-100 p-2" data-error-detail>${esc(m.detail)}</pre></details>`
      : '';
    return frame(
      `<div class="rounded bg-red-50 p-3 text-sm text-red-700" role="alert" data-error-kind="${esc(m.kind ?? 'unknown')}">${title}<p>${esc(m.message)}</p></div>${detail}`,
      cancel,
    );
  }

  // stage === 'ready'
  const alerts = [];
  if (m.unsupported.length > 0) {
    const list = m.unsupported.map((i) => `${i.pageNumber}ページ目（${i.widthMm}×${i.heightMm}mm）`).join('、');
    alerts.push(
      alertBox('bg-red-50 text-red-700', `対応していないページサイズが含まれているため登録できません：${list}。対応サイズは A4縦 と A3横 です。`),
    );
  }

  const pageRows = m.items
    .map(
      (i) =>
        `<li>PDF ${i.pageNumber}ページ目：${i.kind ? KIND_LABEL[i.kind] : `<span class="text-red-600">対象外（${i.widthMm}×${i.heightMm}mm）</span>`}</li>`,
    )
    .join('');
  const hasA3 = m.items.some((i) => i.kind === 'a3');

  const replace = m.existingFileName
    ? `<section class="mt-4 rounded border border-slate-200 p-3">
        <h3 class="mb-1 text-sm font-semibold">差し替え</h3>
        <p class="mb-2 break-all text-xs text-slate-600">登録済みのPDF「${esc(m.existingFileName)}」を差し替えます。旧PDFの扱いを選んでください。</p>
        ${m.existingAssigned > 0 ? `<p class="mb-2 rounded bg-amber-50 p-2 text-sm font-medium text-amber-800" role="alert" data-release-warning>${m.existingAssigned}ページの割り当てが解除されます。</p>` : ''}
        <p class="mb-2 text-xs text-slate-500">新しいPDFは自動では割り当てません。必要なら登録後に［PDFを順番に割り当て］を押してください。</p>
        ${modeRadios(m.replaceMode, 'replace')}
      </section>`
    : '';

  const needMode = m.existingFileName && !m.replaceMode;
  const confirmLabel = hasA3 ? 'A3の分割内容を確認して登録する' : 'この内容で登録する';
  const footer = `${cancel}<button type="button" class="${btnPrimary}" data-action="confirm-pdf-import" ${m.canRegister && !needMode ? '' : 'disabled'}>${confirmLabel}</button>`;
  const converted = m.unsupported.length ? '-' : m.converted;
  return frame(
    `${alerts.join('<div class="h-2"></div>')}
     <p class="mt-3 text-sm">PDF ${m.items.length}ページ → 変換後 <strong data-converted-count>${converted}</strong> ページ（A3横はA4×2に分割）</p>
     <ul class="mt-1 space-y-0.5 text-xs text-slate-600">${pageRows}</ul>
     ${renderA3Section(m)}${m.canRegister ? renderMaterialList(m) : ''}${replace}`,
    footer,
  );
}
