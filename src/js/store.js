import * as db from './db.js';
import {
  bookletRecordSchema,
  contentRecordSchema,
  pageRecordSchema,
  pdfAssetMetaSchema,
  renderImageMetaSchema,
  validateNewBooklet,
  bookletNameSchema,
  parseTotalPagesInput,
} from './schemas.js';
import { createBooklet, resizeBooklet } from './domain/booklet.js';
import { addContent, updateContent, deleteContent, sortContents } from './domain/content.js';
import { placeContent, unplaceContent, startPageOf } from './domain/placement.js';
import { assetOfContent, buildRegistration, buildUnregister, checkPageCount, convertedPageCount } from './domain/pdf.js';
import * as pdf from './pdf.js';
import { clearImages, removeImages, setImage } from './images.js';
import { buildScreens, neighborIndex, screenIndexOf } from './domain/viewer.js';

// アプリ状態。画面は state を元に描画し、変更は下記の action 経由で行う
const state = {
  route: { name: 'home' },
  booklets: [],
  invalidCount: 0, // 形式不正で読み込めなかった保存データの件数（削除はしない）
  current: null, // { booklet, contents, pages, pdfAssets, renderImages }（Blob本体は含めない）
  selectedPageNo: null,
  tab: 'compose',
  saveStatus: 'saved', // saving | saved | error
  modal: null,
  toast: null,
  contentDraft: { name: '', requiredPages: '1', errors: {} }, // コンテンツ追加フォームの入力
  // ビューアの表示状態（閲覧用の一時状態。編集データではないためIndexedDBへは保存しない）
  viewer: { pageNo: 1, showInfo: true, anim: null },
  viewerMode: 'spread', // 'spread'（PC・見開き）| 'single'（スマートフォン・1ページ）
};

// 入力中の値を保持する（再描画しても消えないよう state に置くが、通知はしない）
export function setContentDraft(draft) {
  state.contentDraft = draft;
}

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
  // PDF取り込み中のモーダルを閉じる場合は、読み込み済みのPDFとプレビュー画像を破棄する
  if (!modal && state.modal?.type === 'pdf-import') disposeImportSession();
  state.modal = modal;
  notify();
}

export function patchModal(patch) {
  if (!state.modal) return;
  state.modal = { ...state.modal, ...patch };
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

function parseBookletSet(raw, pdfRaw) {
  const booklet = bookletRecordSchema.safeParse(raw.booklet);
  const contents = raw.contents.map((c) => contentRecordSchema.safeParse(c));
  const pages = raw.pages.map((p) => pageRecordSchema.safeParse(p));
  const assets = pdfRaw.assets.map((a) => pdfAssetMetaSchema.safeParse(a));
  const images = pdfRaw.images.map((i) => renderImageMetaSchema.safeParse(i));
  if (
    !booklet.success ||
    [...contents, ...pages, ...assets, ...images].some((r) => !r.success)
  ) {
    return null;
  }
  // IndexedDB はキー順で返すため、表示順（固定→ユーザーコンテンツ作成順）に並べ直す
  return {
    booklet: booklet.data,
    contents: sortContents(contents.map((r) => r.data)),
    pages: pages.map((r) => r.data),
    pdfAssets: assets.map((r) => r.data),
    renderImages: images.map((r) => r.data),
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
  const pdfRaw = await db.loadPdfRecords(id);
  const set = parseBookletSet(raw, pdfRaw);
  if (!set) {
    showToast('この冊子の保存データの形式が不正なため開けません。', 'error');
    return false;
  }
  // 生成画像（RenderImage）を表示用に読み込む。構成画面・面付画面はこの画像を共通利用する
  clearImages();
  for (const img of pdfRaw.images) setImage(img.id, img.imageBlob);
  state.current = set;
  state.selectedPageNo = null;
  state.tab = 'compose';
  state.viewer = { pageNo: 1, showInfo: state.viewer.showInfo, anim: null };
  state.saveStatus = 'saved';
  notify();
  return true;
}

export function closeBooklet() {
  clearImages();
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
  state.current = { ...cur, booklet: result.booklet, pages: result.pages };
  if (state.selectedPageNo > result.booklet.totalPages) state.selectedPageNo = null;
  notify();
  return { ok: true };
}

// 冊子内データ（コンテンツ・ページ・PDF関連）の変更を保存して反映する共通処理
async function commitCurrent({
  contents,
  pages,
  pdfAssets,
  renderImages,
  removedContentIds = [],
  put = {},
  trashAssetIds = [],
  deleteAssetIds = [],
  removedImageIds = [],
}) {
  const cur = state.current;
  const booklet = { ...cur.booklet, updatedAt: new Date().toISOString() };
  await persist({
    booklet,
    contents,
    pages,
    removedContentIds,
    putPdfAssets: put.pdfAsset ? [put.pdfAsset] : [],
    putRenderImages: put.renderImages ?? [],
    trashAssetIds,
    deleteAssetIds,
  });
  // 保存に成功してから、メモリ上の状態と画像キャッシュを更新する
  removeImages(removedImageIds);
  for (const img of put.renderImages ?? []) setImage(img.id, img.imageBlob);
  state.current = {
    booklet,
    contents: sortContents(contents),
    pages,
    pdfAssets: pdfAssets ?? cur.pdfAssets,
    renderImages: renderImages ?? cur.renderImages,
  };
  notify();
}

export async function addContentAction(rawName, rawRequiredPages) {
  const r = addContent(state.current, rawName, rawRequiredPages);
  if (!r.ok) return r;
  await commitCurrent({ contents: [...state.current.contents, r.content], pages: state.current.pages });
  return { ok: true };
}

export async function updateContentAction(id, rawName, rawRequiredPages) {
  const cur = state.current;
  const r = updateContent(cur, id, rawName, rawRequiredPages);
  if (!r.ok) return r;
  await commitCurrent({
    contents: cur.contents.map((c) => (c.id === id ? r.content : c)),
    pages: r.pages,
  });
  return { ok: true };
}

// 削除（配置済みの場合の確認は UI 側で必ず取る）
export async function deleteContentAction(id, mode) {
  const cur = state.current;
  const r = deleteContent(cur, id, mode);
  if (!r.ok) return r;
  await commitCurrent({
    contents: r.contents,
    pages: r.pages,
    pdfAssets: r.pdfAssets,
    renderImages: r.renderImages,
    removedContentIds: [id],
    trashAssetIds: r.trashAssetIds, // PDFをゴミ箱へ移す場合（元PDFのBlobを保持）
    deleteAssetIds: r.deleteAssetIds, // PDFも完全削除する場合
    removedImageIds: r.removedImageIds,
  });
  return { ok: true };
}

// D&Dによる配置・移動。拒否時は何も変更せず理由を返す
export async function placeContentAction(contentId, startNo) {
  const cur = state.current;
  const r = placeContent(cur, contentId, startNo);
  if (!r.ok || r.unchanged) return r;
  await commitCurrent({ contents: cur.contents, pages: r.pages });
  return r;
}

export async function unplaceContentAction(contentId) {
  const cur = state.current;
  const r = unplaceContent(cur, contentId);
  if (!r.ok) return r;
  await commitCurrent({ contents: cur.contents, pages: r.pages });
  return r;
}

export async function deleteBookletAction(id) {
  await db.deleteBookletCascade(id);
  if (state.current?.booklet.id === id) closeBooklet();
  await refreshBooklets();
}

// ---------------------------------------------------------------------------
// PDF登録（コンテンツ単位）。PDFの解析・画像生成はすべてブラウザ内で行い、外部へは送信しない
// ---------------------------------------------------------------------------
let importSession = null; // { token, file, contentId, doc, previewUrls }

function disposeImportSession() {
  if (!importSession) return;
  for (const u of importSession.previewUrls) URL.revokeObjectURL(u);
  importSession.doc?.destroy?.();
  importSession = null;
}

const isCurrentSession = (token) => importSession?.token === token;

// ファイル選択後の解析：サイズ判定→変換後ページ数の照合→A3分割プレビュー生成。登録の確定は confirmPdfImport で行う
export async function startPdfImport(contentId, file) {
  const cur = state.current;
  const content = cur.contents.find((c) => c.id === contentId);
  const start = content ? startPageOf(cur.pages, contentId) : null;
  if (!content || start === null) {
    showToast('PDFを登録するには、先にコンテンツをページへ配置してください。', 'error');
    return;
  }
  disposeImportSession();
  const token = Symbol('pdf-import');
  importSession = { token, file, contentId, doc: null, previewUrls: [] };
  const existing = assetOfContent(cur, contentId);
  state.modal = {
    type: 'pdf-import',
    stage: 'analyzing',
    fileName: file.name,
    contentId,
    contentName: content.name,
    required: content.requiredPages,
    start,
    existingFileName: existing?.originalFileName ?? null,
    replaceMode: null,
  };
  notify();

  try {
    const doc = await pdf.openPdf(file);
    if (!isCurrentSession(token)) {
      doc.destroy();
      return;
    }
    importSession.doc = doc;
    const items = await pdf.analyzePdf(doc);
    const unsupported = items.filter((i) => !i.kind);
    const converted = convertedPageCount(items.filter((i) => i.kind).map((i) => i.kind));
    const count = unsupported.length === 0 ? checkPageCount(converted, content.requiredPages) : null;

    // A3横ページの分割確認用プレビュー（A3全体の画像）。多数ある場合は先頭8ページ分のみ
    const previews = {};
    if (unsupported.length === 0) {
      for (const item of items.filter((i) => i.kind === 'a3').slice(0, 8)) {
        const url = await pdf.renderPreviewUrl(doc, item.pageNumber);
        if (!isCurrentSession(token)) {
          URL.revokeObjectURL(url);
          return;
        }
        importSession.previewUrls.push(url);
        previews[item.pageNumber] = url;
      }
    }
    if (!isCurrentSession(token)) return;
    patchModal({
      stage: 'ready',
      items,
      unsupported,
      converted,
      previews,
      canRegister: !!count?.ok,
      countError: count && !count.ok ? count.reason : null,
      shortage: count?.ok ? count.shortage : 0,
    });
  } catch (e) {
    console.error(e);
    if (isCurrentSession(token)) {
      patchModal({
        stage: 'error',
        message: 'PDFを読み込めませんでした。PDFファイルが破損している、またはパスワードで保護されている可能性があります。',
      });
    }
  }
}

// 登録の確定：表示用画像を生成し、PdfAsset / RenderImage / ページとの対応を1トランザクションで保存する
export async function confirmPdfImport() {
  const m = state.modal;
  const sess = importSession;
  if (!m || m.type !== 'pdf-import' || m.stage !== 'ready' || !sess || !m.canRegister) return;
  if (m.existingFileName && !['trash', 'delete'].includes(m.replaceMode)) {
    showToast('差し替え方法（ゴミ箱へ移動／完全削除）を選択してください。', 'error');
    return;
  }
  patchModal({ stage: 'converting', progress: { done: 0, total: m.converted } });
  try {
    const converted = await pdf.renderConvertedPages(sess.doc, m.items, (done, total) =>
      patchModal({ progress: { done, total } }),
    );
    const cur = state.current;
    const r = buildRegistration(cur, m.contentId, {
      fileName: m.fileName,
      pdfBlob: sess.file.slice(0, sess.file.size, 'application/pdf'),
      converted,
      replaceMode: m.replaceMode,
    });
    if (!r.ok) {
      patchModal({ stage: 'error', message: r.reason });
      return;
    }
    await commitCurrent({
      contents: cur.contents,
      pages: r.pages,
      pdfAssets: r.pdfAssets,
      renderImages: r.renderImages,
      put: r.put,
      trashAssetIds: r.trashAssetIds,
      deleteAssetIds: r.deleteAssetIds,
      removedImageIds: r.removedImageIds,
    });
    setModal(null);
    showToast(
      r.shortage > 0
        ? `PDFを登録しました（不足の${r.shortage}ページは「PDF未登録」のままです）。`
        : 'PDFを登録しました。',
      'success',
    );
  } catch (e) {
    console.error(e);
    patchModal({ stage: 'error', message: 'PDFの変換または保存に失敗しました。' });
  }
}

// PDF登録解除（コンテンツと配置は残し、PDFとの関連だけ外す）。元PDFの扱いはユーザーが選択する
export function askUnregisterPdf(contentId) {
  const cur = state.current;
  const asset = assetOfContent(cur, contentId);
  const content = cur.contents.find((c) => c.id === contentId);
  if (!asset || !content) return;
  setModal({ type: 'unregister-pdf', contentId, contentName: content.name, fileName: asset.originalFileName, mode: null });
}

export async function confirmUnregisterPdf() {
  const m = state.modal;
  if (!m || m.type !== 'unregister-pdf') return;
  const cur = state.current;
  const r = buildUnregister(cur, m.contentId, m.mode);
  if (!r.ok) {
    showToast(r.reason, 'error');
    return;
  }
  await commitCurrent({
    contents: cur.contents,
    pages: r.pages,
    pdfAssets: r.pdfAssets,
    renderImages: r.renderImages,
    trashAssetIds: r.trashAssetIds,
    deleteAssetIds: r.deleteAssetIds,
    removedImageIds: r.removedImageIds,
  });
  setModal(null);
  showToast(m.mode === 'trash' ? 'PDF登録を解除しました（元PDFはゴミ箱へ移動）。' : 'PDF登録を解除しました（元PDFは完全削除）。', 'success');
}

// ---------------------------------------------------------------------------
// 冊子ビューア（閲覧専用）。ここでは state.viewer だけを変更し、編集データ・IndexedDB には触れない
// ---------------------------------------------------------------------------
let animTimer = null;

export function setViewerMode(mode) {
  if (state.viewerMode === mode) return;
  state.viewerMode = mode;
  notify();
}

export function viewerNavigate(direction) {
  if (!state.current) return;
  const screens = buildScreens(state.current.booklet.totalPages, state.viewerMode);
  const index = screenIndexOf(screens, state.viewer.pageNo);
  const next = neighborIndex(screens, index, direction);
  if (next === index) return; // 先頭・末尾では移動しない
  state.viewer = { ...state.viewer, pageNo: screens[next][0], anim: direction };
  notify();
  // アニメーションのクラスは再生後に外す（以降の再描画で再生し直さない）
  clearTimeout(animTimer);
  animTimer = setTimeout(() => {
    state.viewer = { ...state.viewer, anim: null };
  }, 300);
}

export function viewerToggleInfo() {
  state.viewer = { ...state.viewer, showInfo: !state.viewer.showInfo, anim: null };
  notify();
}
