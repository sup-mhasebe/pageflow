import '../css/style.css';
import * as store from './store.js';
import { renderHome } from './ui/home.js';
import { renderCreate, renderFixedPreview } from './ui/create.js';
import { renderEditor } from './ui/editor.js';
import { renderModal, renderToast } from './ui/dialog.js';
import { validateNewBooklet } from './schemas.js';

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
