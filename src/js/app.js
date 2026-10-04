import '../css/style.css';
import * as store from './store.js';
import { renderHome } from './ui/home.js';
import { renderCreate, renderFixedPreview } from './ui/create.js';
import { renderEditor } from './ui/editor.js';
import { renderModal, renderToast } from './ui/dialog.js';
import { validateNewBooklet } from './schemas.js';
import { checkRange, isPlaced } from './domain/placement.js';

const root = document.getElementById('app');

// 新規冊子フォームの入力値（再描画しても入力が消えないよう保持）
let createForm = { name: '', totalPages: '8', errors: {} };

// ---- 描画 ----
function render(state) {
  let body = '';
  if (state.route.name === 'home') body = renderHome(state);
  else if (state.route.name === 'new') body = renderCreate(createForm);
  else if (state.route.name === 'booklet' && state.current) body = renderEditor(state);
  else body = '<p class="p-8 text-center text-sm text-slate-500">読み込み中…</p>';
  root.innerHTML = body + renderModal(state) + renderToast(state);
}
store.subscribe(render);

// ---- ルーティング（ハッシュ。アプリ内の画面遷移用で、冊子の共有URLではない） ----
function parseHash() {
  const h = location.hash.replace(/^#/, '');
  const m = h.match(/^\/booklet\/([^/]+)$/);
  if (m) return { name: 'booklet', id: decodeURIComponent(m[1]) };
  if (h === '/new') return { name: 'new' };
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
      }
      return;
    }
    store.closeBooklet();
    if (r.name === 'new') {
      createForm = { name: '', totalPages: '8', errors: {} };
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
          store.setModal({ type: 'delete-content', id: c.id, name: c.name, placed: isPlaced(pages, c.id), hasPdf });
        }
        break;
      }
      case 'confirm-delete-content': {
        store.setModal(null);
        const r = await store.deleteContentAction(id);
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
        else if (m?.type === 'unregister-pdf') store.patchModal({ mode: el.dataset.mode });
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
        const result = await store.createBookletAction(name, totalPages);
        if (!result.ok) {
          createForm = { name, totalPages, errors: result.errors };
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
      case 'rename': {
        const r = await store.renameBookletAction(String(data.get('name') ?? ''));
        if (!r.ok) store.showToast(r.reason, 'error');
        break;
      }
      case 'resize': {
        const r = await store.resizeBookletAction(String(data.get('totalPages') ?? ''));
        if (!r.ok) store.showToast(r.reason, 'error');
        else store.showToast('総ページ数を変更しました。', 'success');
        break;
      }
    }
  } catch (err) {
    console.error(err);
    store.showToast('操作に失敗しました。', 'error');
  }
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
    await store.startPdfImport(contentId, file);
  } catch (err) {
    console.error(err);
    store.showToast('PDFの読み込みに失敗しました。', 'error');
  }
});

// ---- ドラッグ＆ドロップ（HTML Drag and Drop API）----
// コンテンツ一覧／配置済みページカードをドラッグし、ページカードへドロップして配置・移動する
let draggingContentId = null;
let hoverCard = null;

function clearHover() {
  hoverCard?.classList.remove('ring-emerald-500', 'ring-red-500', 'ring-2');
  hoverCard = null;
}

root.addEventListener('dragstart', (e) => {
  const el = e.target.closest('[data-drag-content]');
  if (!el) return;
  draggingContentId = el.dataset.dragContent;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', draggingContentId);
});

root.addEventListener('dragover', (e) => {
  const card = e.target.closest('[data-drop-page]');
  if (!card || !draggingContentId) return;
  e.preventDefault(); // ドロップを許可（可否の判定はドロップ時に行う）
  if (card !== hoverCard) {
    clearHover();
    hoverCard = card;
    // 配置できるかどうかを枠色で事前に示す（緑=可、赤=不可）
    const st = store.getState().current;
    const content = st.contents.find((c) => c.id === draggingContentId);
    const ok = content && checkRange(st, content, Number(card.dataset.dropPage)).ok;
    card.classList.add('ring-2', ok ? 'ring-emerald-500' : 'ring-red-500');
  }
});

root.addEventListener('dragleave', (e) => {
  if (hoverCard && !hoverCard.contains(e.relatedTarget)) clearHover();
});

root.addEventListener('dragend', () => {
  draggingContentId = null;
  clearHover();
});

root.addEventListener('drop', async (e) => {
  const card = e.target.closest('[data-drop-page]');
  if (!card || !draggingContentId) return;
  e.preventDefault();
  const contentId = draggingContentId;
  draggingContentId = null;
  clearHover();
  try {
    const r = await store.placeContentAction(contentId, Number(card.dataset.dropPage));
    // 拒否時は何も変更せず（元の配置を維持して）警告を出す
    if (!r.ok) store.showToast(r.reason, 'error');
  } catch (err) {
    console.error(err);
    store.showToast('操作に失敗しました。', 'error');
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

// ---- 新規冊子フォームの入力中：エラー表示と固定ページ構成プレビューを更新 ----
root.addEventListener('input', (e) => {
  const form = e.target.closest('form[data-form="create"]');
  if (!form) return;
  const data = new FormData(form);
  const name = String(data.get('name') ?? '');
  const totalPages = String(data.get('totalPages') ?? '');
  if (e.target.name === 'totalPages') {
    form.querySelector('[data-fixed-preview]').innerHTML = renderFixedPreview(totalPages);
    const res = validateNewBooklet('x', totalPages);
    const msg = res.ok ? '' : (res.errors.totalPages ?? '');
    form.querySelector('[data-error-for="totalPages"]').innerHTML = msg
      ? `<p class="mt-1 text-xs text-red-600" role="alert"></p>`
      : '';
    const p = form.querySelector('[data-error-for="totalPages"] p');
    if (p) p.textContent = msg;
  }
  createForm = { ...createForm, name, totalPages };
});

route();
