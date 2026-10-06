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
import { createBooklet, planResize, resizeBooklet } from './domain/booklet.js';
import { normalizeContent, presetStatus, applyPreset } from './domain/preset.js';
import { addContent, updateContent, deleteContent, sortContents } from './domain/content.js';
import { placeContent, unplaceContent, startPageOf, swapPages } from './domain/placement.js';
import { assetOfContent, assignedCount, buildRegistration, buildUnregister, convertedPageCount } from './domain/pdf.js';
import { assignImage, assignSequentially, planSequentialAssign, repairAssignments, resolveMaterialContentId, unassignPage } from './domain/assignment.js';
import * as pdf from './pdf.js';
import { classifyPdfError, describeError } from './domain/pdf-errors.js';
import { clearImages, removeImages, setImage } from './images.js';
import { buildScreens, neighborIndex, screenIndexOf } from './domain/viewer.js';
import { MODES, ZOOM_DEFAULT, clampZoom, stepZoom } from './domain/compose-view.js';
import { createPackage, readPackage, safeFileName } from './pageflow-file.js';

const initialComposeView = () => ({ mode: 'list', zoom: ZOOM_DEFAULT });

// アプリ状態。画面は state を元に描画し、変更は下記の action 経由で行う
const state = {
  route: { name: 'home' },
  booklets: [],
  invalidCount: 0, // 形式不正で読み込めなかった保存データの件数（削除はしない）
  current: null, // { booklet, contents, pages, pdfAssets, renderImages }（Blob本体は含めない）
  selectedPageNo: null,
  materialContentId: null, // 右カラム（PDF素材）の対象コンテンツ。画面上の一時状態で、保存しない
  materialMenuOpen: false, // 右カラムの［︙］メニュー
  composeView: initialComposeView(), // 中央ビューの表示（一覧／見開き・倍率）。画面上の一時状態で、冊子データには保存しない
  tab: 'compose',
  saveStatus: 'saved', // saving | saved | error
  modal: null,
  toast: null,
  contentDraft: { name: '', requiredPages: '1', errors: {} }, // コンテンツ追加フォームの入力
  nameEdit: null, // 冊子名のインライン編集中：{ draft, error }
  focusRequest: null, // 再描画後にフォーカスして全選択する入力欄のid（一度だけ使う）
  // ビューアの表示状態（閲覧用の一時状態。編集データではないためIndexedDBへは保存しない）
  viewer: { pageNo: 1, showInfo: true, anim: null },
  viewerMode: 'spread', // 'spread'（PC・見開き）| 'single'（スマートフォン・1ページ）
  // 読み込んだ .pageflow（閲覧専用・セッション限り）。編集用Bookletとは別に保持し、IndexedDBへは保存しない
  imported: null, // { fileName, manifest, urls: Map<imageFile, objectURL> }
  importing: false,
  importError: null, // 読み込みに失敗した理由（ホーム画面に表示）
  exporting: false,
};

// 入力中の値を保持する（再描画しても消えないよう state に置くが、通知はしない）
export function setContentDraft(draft) {
  state.contentDraft = draft;
}

// ---- 冊子名のインライン編集（Enterで確定、Escで取り消し。保存は既存の自動保存と同じ）----
export function startNameEdit() {
  if (!state.current) return;
  state.nameEdit = { draft: state.current.booklet.name, error: null };
  state.focusRequest = 'h-name';
  notify();
}

export function setNameDraft(value) {
  if (state.nameEdit) state.nameEdit.draft = value; // 入力中は再描画しない
}

export function cancelNameEdit() {
  state.nameEdit = null;
  notify();
}

// 確定。検証エラーのときは編集状態を保ち、入力欄の下に表示する
export async function commitNameEdit(rawName) {
  if (!state.nameEdit) return;
  const r = await renameBookletAction(rawName);
  if (!r.ok) {
    state.nameEdit = { draft: rawName, error: r.reason };
    state.focusRequest = 'h-name';
    notify();
    return;
  }
  state.nameEdit = null;
  notify();
}

// 入力欄の中身を変えずに、保持している文字だけ更新する（再描画しない）
export function setModalField(name, value) {
  if (state.modal) state.modal[name] = value;
}

export function takeFocusRequest() {
  const id = state.focusRequest;
  state.focusRequest = null;
  return id;
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
  clearTimeout(toastTimer); // 手動で閉じたあとに、古いタイマーが再描画を起こさないようにする
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
  // 旧バージョンの固定ページ（isFixed）は通常コンテンツとして扱う（保存済みデータは壊さず、次の保存時に更新される）。
  // IndexedDB はキー順で返すため、表示順（配置済みは開始ページ順、未配置は作成順）に並べ直す
  const contentList = contents.map((r) => normalizeContent(r.data));
  const rawPages = pages.map((r) => r.data);
  const pdfAssets = assets.map((r) => r.data);
  const renderImages = images.map((r) => r.data);
  // 割り当て（Page.renderImageId）はユーザーが決めたものとしてそのまま使う。
  // 整合しない割り当て（別コンテンツの素材・重複・コンテンツなしのページ）だけを外し、並び替えや再計算はしない
  const fixed = repairAssignments({ contents: contentList, pages: rawPages, pdfAssets, renderImages });
  if (fixed.removed > 0) console.warn(`[PageFlow] 整合しない割り当てを${fixed.removed}件解除しました。`);
  return {
    booklet: booklet.data,
    contents: sortContents(contentList, fixed.pages),
    pages: fixed.pages,
    pdfAssets,
    renderImages,
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
  state.materialContentId = null;
  state.materialMenuOpen = false;
  state.composeView = initialComposeView(); // 別の冊子の表示状態（見開き・拡大率）は引き継がない
  state.tab = 'compose';
  state.viewer = { pageNo: 1, showInfo: state.viewer.showInfo, anim: null };
  state.saveStatus = 'saved';
  notify();
  return true;
}

export function closeBooklet() {
  clearImages();
  // 取り込み画面を開いたまま画面遷移した場合も、PDF.js のリソースを解放してモーダルを閉じる
  disposeImportSession();
  if (state.modal?.type === 'pdf-import') state.modal = null;
  state.current = null;
  state.nameEdit = null;
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

// ページを選択する。コンテンツが配置されたページなら、右カラム（PDF素材）の対象もそのコンテンツへ切り替える
export function selectPage(no) {
  state.selectedPageNo = no;
  const page = state.current?.pages.find((p) => p.physicalPageNumber === no);
  if (page?.contentId) state.materialContentId = page.contentId;
  state.materialMenuOpen = false;
  notify();
}

// 中央ビューの表示モード（一覧／見開き）と倍率。冊子データ（配置・割り当て）には触れない
export function setComposeMode(mode) {
  if (!MODES.includes(mode) || state.composeView.mode === mode) return;
  state.composeView = { ...state.composeView, mode };
  notify();
}

export function setComposeZoom(zoom) {
  const z = clampZoom(zoom);
  if (state.composeView.zoom === z) return;
  state.composeView = { ...state.composeView, zoom: z };
  notify();
}

export const stepComposeZoom = (direction) => setComposeZoom(stepZoom(state.composeView.zoom, direction));

// 右カラムの対象コンテンツをドロップダウンで切り替える
export function setMaterialContent(contentId) {
  state.materialContentId = contentId || null;
  state.materialMenuOpen = false;
  notify();
}

export function toggleMaterialMenu(open) {
  const next = open ?? !state.materialMenuOpen;
  if (state.materialMenuOpen === next) return;
  state.materialMenuOpen = next;
  notify();
}

// 新規冊子の作成。成功時は新しい冊子IDを返す
// withPreset が true のときは、標準構成（表紙・表紙裏・目次・裏表紙裏・裏表紙）を最初にセットする
export async function createBookletAction(rawName, rawTotalPages, withPreset = false) {
  const result = validateNewBooklet(rawName, rawTotalPages);
  if (!result.ok) return { ok: false, errors: result.errors };
  const set = createBooklet(result.data.name, result.data.totalPages, { preset: withPreset });
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

// 総ページ数の変更の見積もり（確認ダイアログの要否と内容）。何も変更しない
export function planResizeAction(rawTotalPages) {
  const parsed = parseTotalPagesInput(rawTotalPages);
  if (!parsed.success) return { ok: false, reason: parsed.error.issues[0].message };
  return { ...planResize(state.current, parsed.data), newTotalPages: parsed.data };
}

// 総ページ数の変更。コンテンツ・PDF素材は削除せず、ページの配置だけが変わる
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
  // 右カラムの対象が「先頭のコンテンツ」などの暗黙の指定のときは、変更前の対象に固定する
  // （配置の変更で並び順が変わっても、操作中のコンテンツから対象が勝手に切り替わらないようにする）
  if (!state.materialContentId) {
    state.materialContentId = resolveMaterialContentId(cur.contents, cur.pages, state.selectedPageNo, null);
  }
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
    contents: sortContents(contents, pages),
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

// ---- 標準構成のセット（既存の冊子にも使える）----
export function openPresetDialog() {
  if (!state.current) return;
  // 既定では、選べる項目をすべてチェックしておく
  const selected = presetStatus(state.current).filter((s) => s.selectable).map((s) => s.key);
  setModal({ type: 'preset', selected });
}

export function togglePresetKey(key, checked) {
  const m = state.modal;
  if (!m || m.type !== 'preset') return;
  const set = new Set(m.selected);
  if (checked) set.add(key);
  else set.delete(key);
  patchModal({ selected: [...set] });
}

// 選択した項目を、1回の保存でセットする。標準位置が使えない項目は、既存の配置を動かさずスキップして理由を返す
export async function confirmPreset() {
  const m = state.modal;
  if (!m || m.type !== 'preset') return;
  const cur = state.current;
  const r = applyPreset(cur, m.selected);
  if (r.applied.length > 0) {
    await commitCurrent({ contents: r.contents, pages: r.pages });
  }
  setModal(null);
  const skipped = r.skipped.length ? `（${r.skipped.map((x) => `${x.name}：${x.reason}`).join('、')}はスキップしました）` : '';
  if (r.applied.length === 0) {
    showToast(`標準構成はセットされませんでした。${skipped}`, 'error');
  } else {
    showToast(`標準構成を${r.applied.length}件セットしました。${skipped}`, r.skipped.length ? 'info' : 'success');
  }
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

// 中央ビューのページ同士の入れ替え（swap）。拒否時は何も変更せず理由を返す
export async function swapPagesAction(fromNo, toNo) {
  const cur = state.current;
  const r = swapPages(cur, fromNo, toNo);
  if (!r.ok || r.unchanged) return r;
  await commitCurrent({ contents: cur.contents, pages: r.pages });
  return r;
}

export const canSwapPages = (fromNo, toNo) => swapPages(state.current, fromNo, toNo).ok;

export async function unplaceContentAction(contentId) {
  const cur = state.current;
  const r = unplaceContent(cur, contentId);
  if (!r.ok) return r;
  state.materialContentId = contentId; // 配置を解除しても、素材は右カラムで引き続き確認できる
  await commitCurrent({ contents: cur.contents, pages: r.pages });
  return r;
}

// ---- PDF素材の割り当て（ユーザーが明示的に行う）----
// 素材を指定ページへ割り当てる（別ページ割り当て済みなら移動、割り当て済みページなら確認なしで置き換え）
export async function assignImageAction(imageId, pageNo) {
  const cur = state.current;
  const r = assignImage(cur, imageId, pageNo);
  if (!r.ok || r.unchanged) return r;
  await commitCurrent({ contents: cur.contents, pages: r.pages });
  return r;
}

// ページの割り当てだけを解除する（素材・PDF・コンテンツ・配置は残す）
export async function unassignPageAction(pageNo) {
  const cur = state.current;
  const r = unassignPage(cur, pageNo);
  if (!r.ok) return r;
  await commitCurrent({ contents: cur.contents, pages: r.pages });
  return r;
}

// ［PDFを順番に割り当て］：ユーザーがボタンを押したときだけ行う
export async function assignSequentialAction(contentId) {
  const cur = state.current;
  const r = assignSequentially(cur, contentId);
  if (!r.ok) return r;
  await commitCurrent({ contents: cur.contents, pages: r.pages });
  showToast(`${r.count}ページを割り当てました`, 'success');
  return r;
}

export const sequentialPlan = (contentId) => planSequentialAssign(state.current, contentId);

export async function deleteBookletAction(id) {
  await db.deleteBookletCascade(id);
  if (state.current?.booklet.id === id) closeBooklet();
  await refreshBooklets();
}

// ---------------------------------------------------------------------------
// PDF登録（コンテンツ単位）。PDFの解析・画像生成はすべてブラウザ内で行い、外部へは送信しない
// ---------------------------------------------------------------------------
let importSession = null; // { token, file, contentId, handle, urls, precomputed }

// PDF.js のリソース（loading task と Web Worker、展開済みの画像データ）だけを解放する。何度呼んでも安全。
// 画像の生成が済んだ後や、失敗した後に、すぐ使う。解放の完了は待たない（失敗しても無視する）。
function releaseHandle(sess) {
  const handle = sess.handle;
  sess.handle = null;
  if (handle) void pdf.closePdf(handle);
}

// 取り込みセッションの後片付け：PDF.js のリソースと、プレビュー用のObject URLをすべて解放する。
// キャンセル・登録完了・エラー終了・PDF差し替え・画面遷移のすべてで使う。何度呼んでも安全。
function disposeImportSession() {
  const sess = importSession;
  if (!sess) return;
  importSession = null;
  for (const u of sess.urls) URL.revokeObjectURL(u);
  releaseHandle(sess);
}

const isCurrentSession = (token) => importSession?.token === token;

// 失敗を原因ごとに分類して表示し、PDF.js のリソースを解放する。
// 実際の例外名・内容は、コンソールと画面の「技術情報」に残す。キャンセル済みの取り込みの例外は無視する。
function failImport(token, error, stage, context) {
  if (!isCurrentSession(token)) return;
  const info = classifyPdfError(error, stage, context);
  const d = describeError(error);
  console.error('[PageFlow][PDF]', { kind: info.kind, stage, name: d.name, message: d.message, code: d.code, stack: d.stack });
  patchModal({ stage: 'error', kind: info.kind, title: info.title, message: info.message, detail: info.detail });
  disposeImportSession();
}

// ファイル選択後の解析：サイズ判定→変換後ページ数の照合→A3分割プレビュー生成。登録の確定は confirmPdfImport で行う
//  - A3の全体プレビューだけが失敗した場合は、左右の分割画像を生成して見せる（確認できれば登録できる）。
//    分割画像も生成できない、または表示できない場合は、登録できない（何も保存しない）。
export async function startPdfImport(contentId, file) {
  const cur = state.current;
  const content = cur.contents.find((c) => c.id === contentId);
  const start = content ? startPageOf(cur.pages, contentId) : null;
  if (!content) {
    showToast('PDFを登録するコンテンツが見つかりません。', 'error');
    return;
  }
  disposeImportSession();
  const token = Symbol('pdf-import');
  importSession = { token, file, contentId, handle: null, urls: [], precomputed: new Map() };
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
    existingAssigned: existing ? assignedCount(cur, existing.id) : 0, // 差し替えで解除される割り当てページ数
    replaceMode: null,
  };
  notify();

  let stage = 'open';
  let inFallback = false;
  let handle = null;
  try {
    handle = await pdf.openPdf(file);
    if (!isCurrentSession(token)) {
      await pdf.closePdf(handle); // 読み込み中にキャンセルされた
      return;
    }
    importSession.handle = handle;
    stage = 'analyze';
    const items = await pdf.analyzePdf(handle.doc);
    const unsupported = items.filter((i) => !i.kind);
    const converted = convertedPageCount(items.filter((i) => i.kind).map((i) => i.kind));

    // A3横ページの分割確認用プレビュー（A3全体の画像）。多数ある場合は先頭8ページ分のみ
    const previews = {};
    const fallbacks = {}; // 全体プレビューを作れなかったA3ページの、左右の分割サムネイル
    if (unsupported.length === 0) {
      for (const item of items.filter((i) => i.kind === 'a3').slice(0, 8)) {
        const n = item.pageNumber;
        stage = 'preview';
        let url = null;
        try {
          url = await pdf.renderPreviewUrl(handle.doc, n);
        } catch (previewError) {
          if (!isCurrentSession(token)) return;
          console.warn('[PageFlow][PDF] A3の全体プレビューを生成できませんでした。左右の分割画像の生成を試みます。', describeError(previewError));
        }
        if (!isCurrentSession(token)) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (url) {
          importSession.urls.push(url);
          previews[n] = url;
          continue;
        }
        // フォールバック：左右の分割画像を生成し、ブラウザが実際に表示できることを確かめてからユーザーに見せる
        stage = 'convert';
        inFallback = true;
        const pieces = await pdf.renderSplitPair(handle.doc, n);
        for (const p of pieces) {
          if (!(await pdf.canDecode(p.imageBlob))) throw new pdf.ImageEncodeError('生成した分割画像を表示できませんでした。');
        }
        if (!isCurrentSession(token)) return;
        importSession.precomputed.set(n, pieces); // 登録の確定時に、同じ画像をそのまま使う（二重に生成しない）
        const left = URL.createObjectURL(pieces[0].imageBlob);
        const right = URL.createObjectURL(pieces[1].imageBlob);
        importSession.urls.push(left, right);
        fallbacks[n] = { left, right };
        inFallback = false;
      }
    }
    if (!isCurrentSession(token)) return;
    patchModal({
      stage: 'ready',
      items,
      unsupported,
      converted,
      previews,
      fallbacks,
      canRegister: unsupported.length === 0 && items.length > 0,
    });
  } catch (e) {
    if (handle && !isCurrentSession(token)) await pdf.closePdf(handle); // キャンセル後の例外でも、確実に解放する
    failImport(token, e, stage, { a3Fallback: inFallback });
  }
}

// 登録の確定：表示用画像を生成し、PdfAsset / RenderImage / ページとの対応を1トランザクションで保存する。
// 画像の生成が済んだ時点で、PDF.js のリソースを解放する（以降はPDF.jsを使わない）。
export async function confirmPdfImport() {
  const m = state.modal;
  const sess = importSession;
  if (!m || m.type !== 'pdf-import' || m.stage !== 'ready' || !sess || !m.canRegister) return;
  if (m.existingFileName && !['trash', 'delete'].includes(m.replaceMode)) {
    showToast('差し替え方法（ゴミ箱へ移動／完全削除）を選択してください。', 'error');
    return;
  }
  const token = sess.token;
  patchModal({ stage: 'converting', progress: { done: 0, total: m.converted } });
  let stage = 'convert';
  try {
    const converted = await pdf.renderConvertedPages(
      sess.handle.doc,
      m.items,
      (done, total) => patchModal({ progress: { done, total } }),
      sess.precomputed,
    );
    releaseHandle(sess); // 画像の生成が済んだら、PDF.js のリソースをすぐ解放する
    stage = 'save';
    const cur = state.current;
    const r = buildRegistration(cur, m.contentId, {
      fileName: m.fileName,
      pdfBlob: sess.file.slice(0, sess.file.size, 'application/pdf'),
      converted,
      replaceMode: m.replaceMode,
    });
    if (!r.ok) {
      patchModal({ stage: 'error', kind: 'unknown', title: '登録できませんでした', message: r.reason, detail: '' });
      disposeImportSession();
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
    setModal(null); // 取り込みセッションを解放する
    // 登録しても自動では割り当てない。右カラムから割り当てる
    const released = r.releasedPages > 0 ? `旧PDFの${r.releasedPages}ページ分の割り当てを解除しました。` : '';
    showToast(`PDFを登録しました（素材${r.materialCount}ページ）。${released}右カラムから、ページへ割り当ててください。`, 'success');
  } catch (e) {
    failImport(token, e, stage);
  }
}

// PDF削除（PdfAsset・素材・割り当てを外す。コンテンツと配置は残す）。元PDFの扱いはユーザーが選択する
export function askUnregisterPdf(contentId) {
  const cur = state.current;
  const asset = assetOfContent(cur, contentId);
  const content = cur.contents.find((c) => c.id === contentId);
  if (!asset || !content) return;
  state.materialMenuOpen = false;
  setModal({ type: 'unregister-pdf', contentId, contentName: content.name, fileName: asset.originalFileName, assigned: assignedCount(cur, asset.id), mode: null });
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
  showToast(m.mode === 'trash' ? 'PDFを削除しました（元PDFはゴミ箱へ移動）。' : 'PDFを削除しました（元PDFは完全削除）。', 'success');
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

// 現在ビューアで表示している冊子の総ページ数（編集データから開いた場合／.pageflow から開いた場合）
function viewerTotalPages() {
  if (state.route.name === 'view') return state.imported?.manifest.totalPages ?? null;
  return state.current?.booklet.totalPages ?? null;
}

export function viewerNavigate(direction) {
  const total = viewerTotalPages();
  if (!total) return;
  const screens = buildScreens(total, state.viewerMode);
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

// ---------------------------------------------------------------------------
// ビューア用データ（.pageflow）の書き出し／読み込み。すべてブラウザ内で完結し、外部へは送信しない
// ---------------------------------------------------------------------------
function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// 編集中の冊子から .pageflow を生成してダウンロードする（元PDF・ゴミ箱・編集情報は含めない）
export async function exportViewerData() {
  const cur = state.current;
  if (!cur || state.exporting) return;
  state.exporting = true;
  notify();
  try {
    const { images } = await db.loadPdfRecords(cur.booklet.id);
    const map = new Map();
    for (const img of images) {
      map.set(img.id, { bytes: new Uint8Array(await img.imageBlob.arrayBuffer()), type: img.imageBlob.type });
    }
    const { bytes, manifest } = createPackage(cur, map);
    const fileName = safeFileName(cur.booklet.name);
    downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), fileName);
    const withImage = manifest.pages.filter((p) => p.imageFile).length;
    showToast(`ビューア用データを書き出しました：${fileName}（画像あり ${withImage}/${manifest.totalPages}ページ）`, 'success');
  } catch (e) {
    console.error(e);
    showToast('ビューア用データの書き出しに失敗しました。', 'error');
  } finally {
    state.exporting = false;
    notify();
  }
}

export function disposeImported() {
  if (!state.imported) return;
  for (const u of state.imported.urls.values()) URL.revokeObjectURL(u);
  state.imported = null;
}

export function dismissImportError() {
  state.importError = null;
  notify();
}

// .pageflow を読み込み、検証に成功したらビューア用に保持する。読み込んだデータは編集用Bookletとして登録しない
export async function importViewerData(file) {
  state.importError = null;
  state.importing = true;
  notify();
  try {
    const result = readPackage(new Uint8Array(await file.arrayBuffer()), file.name);
    if (!result.ok) {
      state.importError = `「${file.name}」を読み込めませんでした。${result.reason}`;
      return false;
    }
    disposeImported();
    const urls = new Map();
    for (const [imageFile, img] of result.images) {
      urls.set(imageFile, URL.createObjectURL(new Blob([img.bytes], { type: img.type })));
    }
    state.imported = { fileName: file.name, manifest: result.manifest, urls };
    state.viewer = { ...state.viewer, pageNo: 1, anim: null };
    return true;
  } catch (e) {
    console.error(e);
    state.importError = `「${file.name}」を読み込めませんでした。ファイルを読み取れないか、形式が正しくありません。`;
    return false;
  } finally {
    state.importing = false;
    notify();
  }
}
