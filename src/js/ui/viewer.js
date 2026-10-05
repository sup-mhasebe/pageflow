import { esc, circled, btnSecondary } from './util.js';
import { getImageUrl } from '../images.js';
import { buildScreens, screenIndexOf } from '../domain/viewer.js';

// ビューア用の表示モデル（編集データから読み取り専用で作る）。
// .pageflow 読み込み時も同じ形のモデルを渡せるよう、画面（HTML）はこのモデルだけに依存させる。
export function buildViewerModel(current) {
  const { booklet, contents, pages } = current;
  const byId = new Map(contents.map((c) => [c.id, c]));
  return {
    bookletName: booklet.name,
    totalPages: booklet.totalPages,
    pages: pages.map((p) => {
      const c = p.contentId ? byId.get(p.contentId) : null;
      const index = c && c.requiredPages > 1 ? ` ${circled(p.contentPageIndex + 1)}` : '';
      return {
        physicalPageNumber: p.physicalPageNumber,
        contentName: c ? `${c.name}${index}` : '空き',
        imageUrl: getImageUrl(p.renderImageId),
      };
    }),
  };
}

// .pageflow（manifest）から作るビューア用の表示モデル。編集データから作るモデルと同じ形にして、同じ画面部品を使う
export function buildViewerModelFromManifest(manifest, urlByImageFile) {
  return {
    bookletName: manifest.bookletName,
    totalPages: manifest.totalPages,
    pages: manifest.pages.map((p) => ({
      physicalPageNumber: p.pageNo,
      contentName:
        p.contentPageIndex !== null && p.contentPageCount > 1
          ? `${p.contentName} ${circled(p.contentPageIndex)}`
          : p.contentName,
      imageUrl: p.imageFile ? (urlByImageFile.get(p.imageFile) ?? null) : null,
    })),
  };
}

// ページ1枚分。画像があれば誌面を、無ければ「PDF未登録」のプレースホルダーを表示する
function renderPage(page, showInfo) {
  const no = page.physicalPageNumber;
  if (page.imageUrl) {
    const caption = showInfo
      ? `<figcaption class="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-center text-xs text-white" data-page-info>P${no}　${esc(page.contentName)}</figcaption>`
      : '';
    return `<figure class="viewer-page relative m-0 bg-white" data-viewer-page="${no}">
      <img src="${page.imageUrl}" alt="P${no} ${esc(page.contentName)}" class="block h-full w-full select-none object-contain" draggable="false" />
      ${caption}
    </figure>`;
  }
  // プレースホルダーは代替表示そのものなので、ページ情報のON/OFFに関わらず物理ページ番号・コンテンツ名・PDF未登録を表示する
  return `<figure class="viewer-page m-0 bg-slate-100" data-viewer-page="${no}" data-placeholder>
    <div class="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-slate-300 p-2 text-center">
      <span class="text-2xl font-bold">P${no}</span>
      <span class="max-w-full break-words text-sm text-slate-700">${esc(page.contentName)}</span>
      <span class="text-xs text-slate-500">PDF未登録</span>
    </div>
  </figure>`;
}

// viewerState: { pageNo, showInfo, anim } ／ mode: 'spread'（PC）| 'single'（スマートフォン）
export function renderViewer(model, viewerState, mode) {
  const screens = buildScreens(model.totalPages, mode);
  const index = screenIndexOf(screens, viewerState.pageNo);
  const screen = screens[index];
  const byNo = new Map(model.pages.map((p) => [p.physicalPageNumber, p]));
  const atFirst = index === 0;
  const atLast = index === screens.length - 1;
  const animCls = viewerState.anim ? `viewer-anim-${viewerState.anim}` : '';
  const label = screen.map((n) => `P${n}`).join('・');
  const infoOn = viewerState.showInfo;

  return `
    <section class="mx-auto max-w-5xl" aria-label="冊子ビューア" data-viewer data-mode="${mode}">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <button type="button" class="${btnSecondary}" data-action="viewer-prev" ${atFirst ? 'disabled' : ''}>← 前へ</button>
          <span class="min-w-[7rem] text-center text-sm" aria-live="polite">
            <strong data-viewer-position>${index + 1} / ${screens.length}</strong>
            <span class="ml-1 text-xs text-slate-500" data-viewer-label>${label}</span>
          </span>
          <button type="button" class="${btnSecondary}" data-action="viewer-next" ${atLast ? 'disabled' : ''}>次へ →</button>
        </div>
        <button type="button" role="switch" aria-checked="${infoOn}" class="${btnSecondary}" data-action="viewer-toggle-info">
          ページ情報：<strong>${infoOn ? 'ON' : 'OFF'}</strong>
        </button>
      </div>
      <div class="viewer-stage touch-pan-y select-none overflow-hidden rounded-lg bg-slate-200 p-3 sm:p-4" data-viewer-stage data-mode="${mode}">
        <div class="viewer-pages ${animCls}" data-viewer-screen="${index}" data-spread-pages="${screen.length}">
          ${screen.map((n) => renderPage(byNo.get(n), infoOn)).join('')}
        </div>
      </div>
      <p class="mt-2 text-center text-xs text-slate-500">
        <span class="hidden sm:inline">← → キーでもページを移動できます。</span>
        <span class="sm:hidden">左右にスワイプしてページを移動できます。</span>
      </p>
    </section>`;
}
