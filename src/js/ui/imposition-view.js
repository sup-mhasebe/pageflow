import { esc, circled } from './util.js';
import { computeImposition } from '../domain/imposition.js';
import { getImageUrl } from '../images.js';

// 冊子ページ（物理ページ番号）の表示情報：コンテンツ名とPDF状態
function pageInfo({ contents, pages }, no) {
  const p = pages.find((x) => x.physicalPageNumber === no);
  const c = p?.contentId ? contents.find((x) => x.id === p.contentId) : null;
  let name = '空き';
  if (c) {
    const idx = !c.isFixed && c.requiredPages > 1 ? ` ${circled(p.contentPageIndex + 1)}` : '';
    name = `${c.name}${idx}`;
  }
  return { name, isEmpty: !c, isFixed: !!c?.isFixed, imageUrl: getImageUrl(p?.renderImageId) };
}

// A3の片側（左ページ／右ページ）
function half(label, no, info) {
  // 生成画像があれば画像を表示（構成画面と同じ画像）。無ければページ情報のプレースホルダー
  if (info.imageUrl) {
    return `
      <div class="relative min-w-0 bg-white">
        <img src="${info.imageUrl}" alt="P${no} ${esc(info.name)}" class="h-full w-full object-contain" />
        <div class="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center text-xs text-white">
          ${label}｜P${no} ${esc(info.name)}
        </div>
      </div>`;
  }
  const bg = info.isEmpty ? 'bg-white border border-dashed border-slate-300' : info.isFixed ? 'bg-slate-100' : 'bg-indigo-50';
  return `
    <div class="flex min-w-0 flex-col items-center justify-center gap-1 p-2 text-center ${bg}">
      <span class="text-[11px] text-slate-500">${label}</span>
      <span class="text-xl font-bold sm:text-2xl">P${no}</span>
      <span class="max-w-full break-words text-xs text-slate-700 sm:text-sm">${esc(info.name)}</span>
      <span class="text-[10px] text-slate-400">PDF未登録</span>
    </div>`;
}

export function renderImposition(state) {
  const cur = state.current;
  const imp = computeImposition(cur.booklet.totalPages);
  const cards = imp.spreads
    .map((s) => {
      const side = s.side === 'outer' ? '外側' : '内側';
      const sideCls = s.side === 'outer' ? 'bg-indigo-600 text-white' : 'bg-emerald-600 text-white';
      return `
        <li class="rounded-lg border border-slate-200 bg-white p-3 shadow-sm" data-spread="${s.spreadNo}">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <h3 class="text-base font-semibold">面付データ ${s.spreadNo}ページ目</h3>
            <span class="rounded px-2 py-0.5 text-xs font-medium ${sideCls}">用紙${s.sheetNo}・${side}</span>
          </div>
          <div class="grid grid-cols-2 divide-x divide-slate-300 overflow-hidden rounded border border-slate-300" style="aspect-ratio: 420 / 297">
            ${half('左ページ', s.left, pageInfo(cur, s.left))}
            ${half('右ページ', s.right, pageInfo(cur, s.right))}
          </div>
          <p class="mt-2 text-center text-sm font-semibold" data-spread-label>P${s.left} | P${s.right}</p>
        </li>`;
    })
    .join('');

  return `
    <div class="mx-auto max-w-2xl space-y-4">
      <section class="rounded-lg border border-slate-200 bg-white p-4">
        <h2 class="text-base font-semibold">面付シミュレーション（中綴じ）</h2>
        <dl class="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div><dt class="text-slate-500">必要なA3用紙</dt><dd class="font-semibold" data-sheet-count>${imp.sheetCount}枚</dd></div>
          <div><dt class="text-slate-500">面付データのページ数</dt><dd class="font-semibold" data-spread-count>${imp.spreadCount}ページ</dd></div>
        </dl>
        <p class="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">
          「面付データ n ページ目」は、Canvaで作成するA3面付データのページ順です。冊子のページ番号（P1、P2…）とは別のものです。
        </p>
      </section>
      <ol class="space-y-4">${cards}</ol>
    </div>`;
}
