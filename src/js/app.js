import '../css/style.css';
import * as store from './store.js';
import { renderHome } from './ui/home.js';
import { renderCreate, renderPresetPreview } from './ui/create.js';
import { renderEditor } from './ui/editor.js';
import { renderImportedViewer } from './ui/imported-viewer.js';
import { renderModal, renderToast } from './ui/dialog.js';
import { validateNewBooklet } from './schemas.js';
import { checkRange, isPlaced } from './domain/placement.js';
import { checkAssign } from './domain/assignment.js';
import { captureViewState, restoreViewState } from './ui/view-state.js';

const root = document.getElementById('app');

// 新規冊子フォームの入力値（再描画しても入力が消えないよう保持）
let createForm = { name: '', totalPages: '8', preset: true, errors: {} };

// ---- 描画 ----
// ドラッグ中に画面を作り直すと、ドラッグ元の要素が消えてドラッグが中断される（トーストの自動消去・保存完了の通知など）。
// そのため、ドラッグ中の再描画は保留し、ドラッグが終わってから1回だけ行う。
let draggingContentId = null; // コンテンツ（左カラム／配置済みページ）をドラッグ中
let draggingImageId = null; // 右カラムのPDF素材をドラッグ中
let draggingPageNo = null; // 中央ビューのページをドラッグ中（ドロップ先のページと入れ替える）
let renderDeferred = false;
const isDragging = () => !!(draggingContentId || draggingImageId || draggingPageNo);
function flushRender() {
  if (!renderDeferred) return;
  renderDeferred = false;
  render(store.getState());
}

function render(state) {
  if (isDragging()) {
    renderDeferred = true;
    return;
  }
  let body = '';
  if (state.route.name === 'home') body = renderHome(state);
  else if (state.route.name === 'new') body = renderCreate(createForm);
  else if (state.route.name === 'booklet' && state.current) body = renderEditor(state);
  else if (state.route.name === 'view' && state.imported) body = renderImportedViewer(state);
  else body = '<p class="p-8 text-center text-sm text-slate-500">読み込み中…</p>';
  // 再描画をまたいで、スクロール位置・フォーカス・入力途中の文字を保つ
  const viewKey = `${state.route.name}:${state.route.id ?? ''}:${state.tab}`;
  const snap = captureViewState(root, lastViewKey === viewKey ? viewKey : null);
  root.innerHTML = body + renderModal(state) + renderToast(state);
  restoreViewState(root, snap, viewKey);
  lastViewKey = viewKey;
  // 編集開始などで要求された入力欄にフォーカスして全選択する（一度だけ）
  const focusId = store.takeFocusRequest();
  if (focusId) {
    const el = root.querySelector(`#${CSS.escape(focusId)}`);
    if (el) {
      el.focus();
      if (typeof el.select === 'function') el.select();
    }
  }
}
let lastViewKey = null;
store.subscribe(render);

// ---- ルーティング（ハッシュ。アプリ内の画面遷移用で、冊子の共有URLではない） ----
function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const m = h.match(/^\/booklet\/([^/]+?)(\/viewer)?$/);
  if (m) return { name: 'booklet', id: decodeURIComponent(m[1]), viewer: !!m[2] };
  if (h === '/new') return { name: 'new' };
  if (h === '/view') return { name: 'view' }; // 読み込んだ .pageflow のビューア（閲覧専用）
  return { name: 'home' };
}

async function route() {
  const r = parseHash();
  try {
    if (r.name === 'booklet') {
      store.setRoute(r);
      const ok = await store.openBooklet(r.id);
      if (!ok) {
        store.showToast('指定された冊子が見つかりません。', 'error');
        location.hash = '#/';
        return;
      }
      if (r.viewer) store.setTab('preview'); // 一覧の［ビューア］から：冊子プレビュー（ビューア）を開く
      return;
    }
    store.closeBooklet();
    if (r.name !== 'view') store.disposeImported(); // 読み込んだビューア用データはセッション限り。画面を離れたら破棄する
    if (r.name === 'view') {
      if (!store.getState().imported) {
        // 再読み込みや直接アクセスでは .pageflow の内容が残っていない
        store.showToast('ビューア用データが読み込まれていません。ホームから .pageflow を読み込んでください。', 'error');
        location.hash = '#/';
        return;
      }
      store.setRoute(r);
    } else if (r.name === 'new') {
      createForm = { name: '', totalPages: '8', preset: true, errors: {} };
      store.setRoute(r);
    } else {
      await store.refreshBooklets();
      store.setRoute(r);
    }
  } catch (e) {
    console.error(e);
    store.setRoute({ name: 'home' });
    store.showToast('データの読み込みに失敗しました。', 'error');
  }
}
window.addEventListener('hashchange', route);

const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};

// ---- クリック操作 ----
root.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, no, tab } = el.dataset;
  try {
    switch (action) {
      case 'go-new':
        go('#/new');
        break;
      case 'go-home':
        go('#/');
        break;
      case 'open-booklet':
        go(`#/booklet/${encodeURIComponent(id)}`);
        break;
      case 'export-pageflow':
        await store.exportViewerData();
        break;
      case 'dismiss-import-error':
        store.dismissImportError();
        break;
      case 'open-preset':
        store.openPresetDialog();
        break;
      case 'confirm-preset':
        await store.confirmPreset();
        break;
      case 'show-content-pdf':
        store.setModal({ type: 'content-pdf-info', contentId: id });
        break;
      case 'edit-name':
        store.startNameEdit();
        break;
      case 'cancel-name-edit':
        store.cancelNameEdit();
        break;
      case 'open-resize': {
        const total = store.getState().current.booklet.totalPages;
        store.setModal({ type: 'resize-pages', stage: 'input', value: String(total), error: null });
        break;
      }
      case 'resize-step': {
        // 4ずつ増減する（4の倍数でない入力は、次／前の4の倍数へ）。8未満にはしない
        const st = store.getState();
        const base = Number.parseInt(st.modal?.value, 10);
        const cur = Number.isFinite(base) ? base : st.current.booklet.totalPages;
        const dir = Number(el.dataset.dir);
        const next = dir > 0 ? Math.floor(cur / 4) * 4 + 4 : Math.ceil(cur / 4) * 4 - 4;
        store.patchModal({ value: String(Math.max(8, next)), error: null });
        break;
      }
      case 'confirm-resize': {
        const m = store.getState().modal;
        const r = await store.resizeBookletAction(String(m.newTotalPages));
        if (!r.ok) {
          store.patchModal({ stage: 'input', value: String(m.newTotalPages), error: r.reason });
          break;
        }
        store.setModal(null);
        store.showToast(`総ページ数を${m.newTotalPages}Pに変更しました。`, 'success');
        break;
      }
      case 'open-viewer':
        go(`#/booklet/${encodeURIComponent(id)}/viewer`);
        break;
      case 'viewer-prev':
        store.viewerNavigate('prev');
        break;
      case 'viewer-next':
        store.viewerNavigate('next');
        break;
      case 'viewer-toggle-info':
        store.viewerToggleInfo();
        break;
      case 'select-page':
        store.selectPage(Number(no));
        break;
      case 'set-tab':
        store.setTab(tab);
        break;
      case 'ask-delete': {
        const st = store.getState();
        const b = st.booklets.find((x) => x.id === id) ?? (st.current?.booklet.id === id ? st.current.booklet : null);
        if (b) store.setModal({ type: 'delete-booklet', id: b.id, name: b.name });
        break;
      }
      case 'cancel-modal':
        store.setModal(null);
        break;
      case 'confirm-delete': {
        store.setModal(null);
        await store.deleteBookletAction(id);
        if (parseHash().name === 'booklet') location.hash = '#/';
        store.showToast('冊子を削除しました。', 'success');
        break;
      }
      case 'dismiss-toast':
        store.dismissToast();
        break;
      case 'edit-content': {
        const c = store.getState().current.contents.find((x) => x.id === id);
        if (c) {
          store.setModal({ type: 'edit-content', id: c.id, name: c.name, requiredPages: String(c.requiredPages), errors: {} });
        }
        break;
      }
      case 'ask-delete-content': {
        const { contents, pages } = store.getState().current;
        const c = contents.find((x) => x.id === id);
        if (c) {
          const hasPdf = store.getState().current.pdfAssets.some((a) => a.contentId === c.id);
          store.setModal({ type: 'delete-content', id: c.id, name: c.name, placed: isPlaced(pages, c.id), hasPdf, mode: null });
        }
        break;
      }
      case 'confirm-delete-content': {
        const m = store.getState().modal;
        const mode = m?.mode; // PDF登録済みの場合にユーザーが選んだ扱い
        store.setModal(null);
        const r = await store.deleteContentAction(id, mode);
        if (!r.ok) store.showToast(r.reason, 'error');
        else store.showToast('コンテンツを削除しました。', 'success');
        break;
      }
      case 'ask-unregister-pdf':
        store.askUnregisterPdf(id);
        break;
      case 'confirm-unregister-pdf':
        await store.confirmUnregisterPdf();
        break;
      case 'set-pdf-mode': {
        // 差し替え／登録解除時の「旧PDF・元PDFの扱い」の選択
        const m = store.getState().modal;
        if (m?.type === 'pdf-import') store.patchModal({ replaceMode: el.dataset.mode });
        else if (m?.type === 'unregister-pdf' || m?.type === 'delete-content') store.patchModal({ mode: el.dataset.mode });
        break;
      }
      case 'confirm-pdf-import':
        await store.confirmPdfImport();
        break;
      case 'unplace-content': {
        const r = await store.unplaceContentAction(id);
        if (!r.ok) store.showToast(r.reason, 'error');
        break;
      }
      case 'toggle-material-menu':
        store.toggleMaterialMenu();
        break;
      case 'assign-sequential': {
        const r = await store.assignSequentialAction(id);
        if (!r.ok) store.showToast(r.reason, 'error');
        break;
      }
      case 'unassign-page': {
        const r = await store.unassignPageAction(Number(no));
        if (!r.ok) store.showToast(r.reason, 'error');
        break;
      }
    }
  } catch (err) {
    console.error(err);
    store.showToast('操作に失敗しました。', 'error');
  }
});

// ---- フォーム送信 ----
root.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form);
  try {
    switch (form.dataset.form) {
      case 'create': {
        const name = String(data.get('name') ?? '');
        const totalPages = String(data.get('totalPages') ?? '');
        const preset = data.get('preset') === 'on';
        const result = await store.createBookletAction(name, totalPages, preset);
        if (!result.ok) {
          createForm = { name, totalPages, preset, errors: result.errors };
          render(store.getState());
          break;
        }
        location.hash = `#/booklet/${encodeURIComponent(result.id)}`;
        break;
      }
      case 'add-content': {
        const name = String(data.get('name') ?? '');
        const requiredPages = String(data.get('requiredPages') ?? '');
        const r = await store.addContentAction(name, requiredPages);
        if (!r.ok) {
          store.setContentDraft({ name, requiredPages, errors: r.errors });
        } else {
          store.setContentDraft({ name: '', requiredPages: '1', errors: {} });
        }
        render(store.getState());
        break;
      }
      case 'edit-content': {
        const name = String(data.get('name') ?? '');
        const requiredPages = String(data.get('requiredPages') ?? '');
        const id = form.dataset.id;
        const r = await store.updateContentAction(id, name, requiredPages);
        if (!r.ok) store.setModal({ type: 'edit-content', id, name, requiredPages, errors: r.errors });
        else store.setModal(null);
        break;
      }
      case 'rename-booklet':
        await store.commitNameEdit(String(data.get('name') ?? ''));
        break;
      case 'resize-pages': {
        // 見積もり→（配置済みのページが削除される場合のみ）確認→変更
        const raw = String(data.get('totalPages') ?? '');
        const plan = store.planResizeAction(raw);
        if (!plan.ok) {
          store.patchModal({ value: raw, error: plan.reason });
          break;
        }
        if (plan.needsConfirm) {
          store.patchModal({ stage: 'confirm', plan, newTotalPages: plan.newTotalPages, error: null });
          break;
        }
        const r = await store.resizeBookletAction(raw);
        if (!r.ok) {
          store.patchModal({ value: raw, error: r.reason });
          break;
        }
        store.setModal(null);
        store.showToast(`総ページ数を${plan.newTotalPages}Pに変更しました。`, 'success');
        break;
      }
    }
  } catch (err) {
    console.error(err);
    store.showToast('操作に失敗しました。', 'error');
  }
});

// ---- 冊子ビューア：キーボード（← →）、スワイプ（Pointer Events）、画面幅によるモード切替 ----
function viewerActive() {
  const st = store.getState();
  if (st.modal) return false;
  if (st.route.name === 'view') return !!st.imported;
  return st.route.name === 'booklet' && !!st.current && st.tab === 'preview';
}

document.addEventListener('keydown', (e) => {
  if (!viewerActive() || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return; // 入力中は奪わない
  e.preventDefault();
  store.viewerNavigate(e.key === 'ArrowRight' ? 'next' : 'prev');
});

// スワイプ：左へスワイプ＝次へ、右へスワイプ＝前へ（マウスのドラッグは対象外）
const SWIPE_MIN_PX = 50;
let swipe = null;
root.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' || !e.target.closest('[data-viewer-stage]')) return;
  swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', (e) => {
  if (!swipe || e.pointerId !== swipe.id) return;
  const dx = e.clientX - swipe.x;
  const dy = e.clientY - swipe.y;
  swipe = null;
  if (!viewerActive()) return;
  if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
    store.viewerNavigate(dx < 0 ? 'next' : 'prev');
  }
});
window.addEventListener('pointercancel', () => {
  swipe = null;
});

// スマートフォン幅（〜639px）は1ページ表示、それ以上は見開き表示
const compactQuery = window.matchMedia('(max-width: 639px)');
const syncViewerMode = () => store.setViewerMode(compactQuery.matches ? 'single' : 'spread');
compactQuery.addEventListener('change', syncViewerMode);
syncViewerMode();

// ---- ビューア用データ（.pageflow）の選択：標準の <input type="file"> と File API のみを使用 ----
root.addEventListener('change', async (e) => {
  const input = e.target.closest('input[data-pageflow-input]');
  if (!input) return;
  const file = input.files?.[0];
  input.value = ''; // 同じファイルを再選択できるようにする
  if (!file) return;
  const ok = await store.importViewerData(file);
  if (ok) location.hash = '#/view'; // 編集画面を経由せず、ビューアを直接開く
});

// ---- 右カラム（PDF素材）の対象コンテンツの切り替え ----
root.addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-material-select]');
  if (sel) store.setMaterialContent(sel.value);
});

// ［︙］メニューは、メニューの外をクリックしたら閉じる
document.addEventListener('click', (e) => {
  if (store.getState().materialMenuOpen && !e.target.closest('[data-material-menu]')) store.toggleMaterialMenu(false);
});

// ---- 標準構成ポップアップのチェックボックス ----
root.addEventListener('change', (e) => {
  const box = e.target.closest('input[data-preset-key]');
  if (box) store.togglePresetKey(box.dataset.presetKey, box.checked);
});

// ---- PDFファイル選択：解析モーダルを開く（PDFはブラウザ内で処理し、外部へ送信しない）----
root.addEventListener('change', async (e) => {
  const input = e.target.closest('input[data-pdf-input]');
  if (!input) return;
  const file = input.files?.[0];
  const contentId = input.dataset.contentId;
  input.value = ''; // 同じファイルを再選択できるようにする
  if (!file) return;
  try {
    store.toggleMaterialMenu(false);
    await store.startPdfImport(contentId, file);
  } catch (err) {
    console.error(err);
    store.showToast('PDFの読み込みに失敗しました。', 'error');
  }
});

// ---- ドラッグ＆ドロップ（HTML Drag and Drop API）----
// コンテンツ一覧／配置済みページカードをドラッグし、ページカードへドロップして配置・移動する
let hoverCard = null;

function clearHover() {
  hoverCard?.classList.remove('ring-emerald-500', 'ring-red-500', 'ring-2');
  hoverCard = null;
}

root.addEventListener('dragstart', (e) => {
  const mat = e.target.closest('[data-drag-image]');
  if (mat) {
    draggingImageId = mat.dataset.dragImage;
    draggingContentId = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggingImageId);
    return;
  }
  const pg = e.target.closest('[data-drag-page]');
  if (pg) {
    draggingPageNo = Number(pg.dataset.dragPage);
    draggingContentId = null;
    draggingImageId = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `page:${draggingPageNo}`);
    return;
  }
  const el = e.target.closest('[data-drag-content]');
  if (!el) return;
  draggingContentId = el.dataset.dragContent;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggingContentId);
});

root.addEventListener('dragover', (e) => {
  const card = e.target.closest('[data-drop-page]');
  if (!card || (!draggingContentId && !draggingImageId && !draggingPageNo)) return;
  e.preventDefault(); // ドロップを許可（可否の判定はドロップ時に行う）
  if (card !== hoverCard) {
    clearHover();
    hoverCard = card;
    // 配置・割り当てできるかどうかを枠色で事前に示す（緑=可、赤=不可）
    const st = store.getState().current;
    let ok;
    if (draggingPageNo) {
      // 入れ替えできるか（自分自身の上は何も起きない）
      const to = Number(card.dataset.dropPage);
      if (to === draggingPageNo) {
        hoverCard = card;
        return;
      }
      ok = store.canSwapPages(draggingPageNo, to);
    } else if (draggingImageId) {
      ok = checkAssign(st, draggingImageId, Number(card.dataset.dropPage)).ok;
    } else {
      const content = st.contents.find((c) => c.id === draggingContentId);
      ok = content && checkRange(st, content, Number(card.dataset.dropPage)).ok;
    }
    card.classList.add('ring-2', ok ? 'ring-emerald-500' : 'ring-red-500');
  }
});

root.addEventListener('dragleave', (e) => {
  if (hoverCard && !hoverCard.contains(e.relatedTarget)) clearHover();
});

root.addEventListener('dragend', () => {
  draggingContentId = null;
  draggingImageId = null;
  draggingPageNo = null;
  clearHover();
  flushRender();
});

root.addEventListener('drop', async (e) => {
  const card = e.target.closest('[data-drop-page]');
  if (!card || (!draggingContentId && !draggingImageId && !draggingPageNo)) return;
  e.preventDefault();
  const contentId = draggingContentId;
  const imageId = draggingImageId;
  const fromPage = draggingPageNo;
  draggingContentId = null;
  draggingImageId = null;
  draggingPageNo = null;
  clearHover();
  flushRender();
  try {
    if (fromPage) {
      // ページ同士の入れ替え。拒否時は何も変更せず（別の空きページへも動かさず）理由を警告する
      const r = await store.swapPagesAction(fromPage, Number(card.dataset.dropPage));
      if (!r.ok) store.showToast(r.reason, 'error');
      return;
    }
    if (imageId) {
      // PDF素材の割り当て。拒否時は何も変更せず、理由を警告する
      const r = await store.assignImageAction(imageId, Number(card.dataset.dropPage));
      if (!r.ok) store.showToast(r.reason, 'error');
      return;
    }
    const r = await store.placeContentAction(contentId, Number(card.dataset.dropPage));
    // 拒否時は何も変更せず（元の配置を維持して）警告を出す
    if (!r.ok) store.showToast(r.reason, 'error');
  } catch (err) {
    console.error(err);
    store.showToast('操作に失敗しました。', 'error');
  }
});

// 冊子名のインライン編集：Escで取り消し（Enterはフォーム送信で確定）
root.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.id === 'h-name') {
    e.preventDefault();
    store.cancelNameEdit();
  }
});

// キーボードでもページカードを選択できるようにする
root.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('[data-action="select-page"]');
  if (!card || card !== e.target) return;
  e.preventDefault();
  store.selectPage(Number(card.dataset.no));
});

// ---- 冊子名の編集中・総ページ数ポップアップの入力中：値を状態へ控える（再描画はしない） ----
root.addEventListener('input', (e) => {
  if (e.target.id === 'h-name') store.setNameDraft(e.target.value);
  else if (e.target.id === 'r-total') store.setModalField('value', e.target.value);
});

// ---- コンテンツ追加フォームの入力中：値を保持（再描画で消えないように） ----
root.addEventListener('input', (e) => {
  const addForm = e.target.closest('form[data-form="add-content"]');
  if (addForm) {
    const d = new FormData(addForm);
    store.setContentDraft({
      name: String(d.get('name') ?? ''),
      requiredPages: String(d.get('requiredPages') ?? ''),
      errors: store.getState().contentDraft.errors,
    });
    return;
  }
});

// ---- 新規冊子フォームの入力中：エラー表示と標準構成のプレビューを更新 ----
root.addEventListener('input', (e) => {
  const form = e.target.closest('form[data-form="create"]');
  if (!form) return;
  const data = new FormData(form);
  const name = String(data.get('name') ?? '');
  const totalPages = String(data.get('totalPages') ?? '');
  const preset = data.get('preset') === 'on';
  if (e.target.name === 'totalPages' || e.target.name === 'preset') {
    form.querySelector('[data-preset-preview]').innerHTML = renderPresetPreview(totalPages, preset);
  }
  if (e.target.name === 'totalPages') {
    const res = validateNewBooklet('x', totalPages);
    const msg = res.ok ? '' : (res.errors.totalPages ?? '');
    form.querySelector('[data-error-for="totalPages"]').innerHTML = msg
      ? `<p class="mt-1 text-xs text-red-600" role="alert"></p>`
      : '';
    const p = form.querySelector('[data-error-for="totalPages"] p');
    if (p) p.textContent = msg;
  }
  createForm = { ...createForm, name, totalPages, preset };
});

route();
