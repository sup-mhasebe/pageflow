import { esc, btnSecondary } from './util.js';
import { renderViewer, buildViewerModelFromManifest } from './viewer.js';

// 読み込んだ .pageflow のビューア画面（編集画面を経由しない閲覧専用）。
// 編集データから開いたビューアと同じ画面部品（renderViewer）を再利用する
export function renderImportedViewer(state) {
  const { manifest, urls, fileName } = state.imported;
  const model = buildViewerModelFromManifest(manifest, urls);
  return `
    <div class="mx-auto max-w-7xl px-4 py-4">
      <header class="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" class="${btnSecondary}" data-action="go-home">← ホームへ</button>
        <h1 class="order-last w-full min-w-0 break-words text-xl font-bold sm:order-none sm:w-auto sm:flex-1 sm:truncate" data-imported-title>${esc(manifest.bookletName)}</h1>
        <span class="rounded bg-slate-200 px-2 py-1 text-xs text-slate-700" title="${esc(fileName)}">ビューア専用データ（閲覧のみ）</span>
      </header>
      ${renderViewer(model, state.viewer, state.viewerMode)}
    </div>`;
}
