import * as db from './db.js';
import {
  bookletRecordSchema,
  contentRecordSchema,
  pageRecordSchema,
  validateNewBooklet,
  bookletNameSchema,
  parseTotalPagesInput,
} from './schemas.js';
import { createBooklet, resizeBooklet } from './domain/booklet.js';

// アプリ状態。画面は state を元に描画し、変更は下記の action 経由で行う
const state = {
  route: { name: 'home' },
  booklets: [],
  invalidCount: 0, // 形式不正で読み込めなかった保存データの件数（削除はしない）
  current: null, // { booklet, contents, pages }
  selectedPageNo: null,
  tab: 'compose',
  saveStatus: 'saved', // saving | saved | error
  modal: null,
  toast: null,
};

const listeners = new Set();
export const getState = () => state;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) fn(state);
}

let toastTimer = null;
export function showToast(message, type = 'info') {
  state.toast = { message, type };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    notify();
  }, 6000);
  notify();
}

export function dismissToast() {
  state.toast = null;
  notify();
}

export function setModal(modal) {
  state.modal = modal;
  notify();
}

// 保存処理の共通ラッパー（「保存中…／✓ 保存済み」の表示を切り替える）
async function persist(payload) {
  state.saveStatus = 'saving';
  notify();
  try {
    await db.saveBookletRecords(payload);
    state.saveStatus = 'saved';
  } catch (e) {
    state.saveStatus = 'error';
    showToast('保存に失敗しました。ブラウザの設定（プライベートモード等）を確認してください。', 'error');
    throw e;
  } finally {
    notify();
  }
}

function parseBookletSet(raw) {
  const booklet = bookletRecordSchema.safeParse(raw.booklet);
  const contents = raw.contents.map((c) => contentRecordSchema.safeParse(c));
  const pages = raw.pages.map((p) => pageRecordSchema.safeParse(p));
  if (!booklet.success || contents.some((r) => !r.success) || pages.some((r) => !r.success)) {
    return null;
  }
  // IndexedDB はキー（UUID）順で返すため、固定コンテンツを表紙→裏表紙の順に並べ直す
  const order = ['表紙', '表紙裏', '目次', '裏表紙裏', '裏表紙'];
  const rank = (c) => (c.isFixed ? order.indexOf(c.name) : order.length);
  return {
    booklet: booklet.data,
    contents: contents.map((r) => r.data).sort((a, b) => rank(a) - rank(b)),
    pages: pages.map((r) => r.data),
  };
}

export async function refreshBooklets() {
  const records = await db.listBookletRecords();
  const valid = [];
  let invalid = 0;
  for (const r of records) {
    const parsed = bookletRecordSchema.safeParse(r);
    if (parsed.success) valid.push(parsed.data);
    else invalid++;
  }
  valid.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  state.booklets = valid;
  state.invalidCount = invalid;
  notify();
}

export async function openBooklet(id) {
  const raw = await db.loadBookletRecords(id);
  if (!raw) return false;
  const set = parseBookletSet(raw);
  if (!set) {
    showToast('この冊子の保存データの形式が不正なため開けません。', 'error');
    return false;
  }
  state.current = set;
  state.selectedPageNo = null;
  state.tab = 'compose';
  state.saveStatus = 'saved';
  notify();
  return true;
}

export function closeBooklet() {
  state.current = null;
  state.selectedPageNo = null;
  notify();
}

export function setRoute(route) {
  state.route = route;
  notify();
}

export function setTab(tab) {
  state.tab = tab;
  notify();
}

export function selectPage(no) {
  state.selectedPageNo = no;
  notify();
}

// 新規冊子の作成。成功時は新しい冊子IDを返す
export async function createBookletAction(rawName, rawTotalPages) {
  const result = validateNewBooklet(rawName, rawTotalPages);
  if (!result.ok) return { ok: false, errors: result.errors };
  const set = createBooklet(result.data.name, result.data.totalPages);
  await persist(set);
  return { ok: true, id: set.booklet.id };
}

export async function renameBookletAction(rawName) {
  const parsed = bookletNameSchema.safeParse(rawName);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0].message };
  const cur = state.current;
  if (parsed.data === cur.booklet.name) return { ok: true };
  const booklet = { ...cur.booklet, name: parsed.data, updatedAt: new Date().toISOString() };
  await persist({ booklet, contents: cur.contents, pages: cur.pages });
  state.current = { ...cur, booklet };
  notify();
  return { ok: true };
}

export async function resizeBookletAction(rawTotalPages) {
  const parsed = parseTotalPagesInput(rawTotalPages);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0].message };
  const cur = state.current;
  const result = resizeBooklet(cur, parsed.data);
  if (!result.ok) return result;
  await persist({
    booklet: result.booklet,
    contents: cur.contents,
    pages: result.pages,
    removedPageIds: result.removedPageIds,
  });
  state.current = { booklet: result.booklet, contents: cur.contents, pages: result.pages };
  if (state.selectedPageNo > result.booklet.totalPages) state.selectedPageNo = null;
  notify();
  return { ok: true };
}

export async function deleteBookletAction(id) {
  await db.deleteBookletCascade(id);
  if (state.current?.booklet.id === id) closeBooklet();
  await refreshBooklets();
}
