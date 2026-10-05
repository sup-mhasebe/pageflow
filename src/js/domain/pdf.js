// PDF素材に関する純粋関数（PDF.js / Canvas / IndexedDB には依存しない）。
// - ページサイズ判定、PDF素材（PdfAsset／RenderImage）の登録・削除の組み立て
// - 登録しても冊子ページへは自動で割り当てない（割り当ては assignment.js で、ユーザーが明示的に行う）
// - PDFを暗黙的に削除・移動しない：差し替え／削除では必ず呼び出し側が選んだ mode（trash | delete）に従う

// ISO 216 のサイズ（pt）。A4縦 = 210x297mm、A3横 = 420x297mm
export const A4_PT = { width: 595.28, height: 841.89 };
export const A3_LANDSCAPE_PT = { width: 1190.55, height: 841.89 };
const TOLERANCE = 0.03; // 3%

const near = (value, base) => Math.abs(value - base) / base <= TOLERANCE;

// PDFページのサイズ(pt)から種別を判定する。対象外（A4横・A3縦・その他）は null
export function classifyPageSize(widthPt, heightPt) {
  if (near(widthPt, A4_PT.width) && near(heightPt, A4_PT.height)) return 'a4';
  if (near(widthPt, A3_LANDSCAPE_PT.width) && near(heightPt, A3_LANDSCAPE_PT.height)) return 'a3';
  return null;
}

// 変換後ページ数：A4は1ページ、A3横はA4×2ページ
export function convertedPageCount(kinds) {
  return kinds.reduce((sum, k) => sum + (k === 'a3' ? 2 : 1), 0);
}

// 変換後の並び順：元PDFのページ順、A3は 左 → 右
const SIDE_ORDER = { none: 0, left: 0, right: 1 };
export function orderedImages(renderImages, pdfAssetId) {
  return renderImages
    .filter((i) => i.pdfAssetId === pdfAssetId)
    .sort((a, b) => a.sourcePdfPage - b.sourcePdfPage || SIDE_ORDER[a.splitSide] - SIDE_ORDER[b.splitSide]);
}

export function assetOfContent(state, contentId) {
  return (state.pdfAssets ?? []).find((a) => a.contentId === contentId) ?? null;
}

export const hasPdfRef = (page) => !!(page.pdfAssetId || page.renderImageId);

// そのページの割り当てが、指定したPDFの素材かどうか（pdfAssetId、または素材のIDで判定する）
const usesAsset = (p, assetId, imageIds) => p.pdfAssetId === assetId || (p.renderImageId && imageIds.has(p.renderImageId));
const imageIdsOf = (renderImages, assetId) => new Set(renderImages.filter((i) => i.pdfAssetId === assetId).map((i) => i.id));

// 指定したPDFの割り当てだけを、冊子ページから外す（PDF素材・コンテンツ・配置は変えない）
export function clearAssetRefs(state, assetId) {
  const ids = imageIdsOf(state.renderImages ?? [], assetId);
  return state.pages.map((p) => (usesAsset(p, assetId, ids) ? { ...p, pdfAssetId: null, renderImageId: null } : p));
}

// 指定したPDFの素材が割り当てられているページ数
export function assignedCount(state, assetId) {
  const ids = imageIdsOf(state.renderImages ?? [], assetId);
  return state.pages.filter((p) => p.renderImageId && usesAsset(p, assetId, ids)).length;
}

const newId = () => crypto.randomUUID();
const MODES = ['trash', 'delete'];

// 旧PDFの扱いに応じた削除指示（実際の移動・削除はDB層がトランザクション内で行う）
function disposal(existing, mode) {
  return {
    trashAssetIds: existing && mode === 'trash' ? [existing.id] : [],
    deleteAssetIds: existing && mode === 'delete' ? [existing.id] : [],
  };
}

// PDF登録（新規／差し替え）の結果を組み立てる。
// converted: [{ sourcePdfPage, splitSide, imageBlob, width, height }]（変換後ページ順）
//  - 1コンテンツにつきPDFは1つ。素材の数と必要ページ数は一致していなくてよい
//  - 登録しても冊子ページへは割り当てない。差し替えでは旧PDFの割り当てをすべて解除する
export function buildRegistration(state, contentId, { fileName, pdfBlob, converted, replaceMode }, now = new Date()) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return { ok: false, reason: 'コンテンツが見つかりません。' };
  if (!Array.isArray(converted) || converted.length === 0) return { ok: false, reason: '登録できるページがありません。' };

  const existing = assetOfContent(state, contentId);
  if (existing && !MODES.includes(replaceMode)) {
    return { ok: false, reason: '差し替え方法（ゴミ箱へ移動／完全削除）を選択してください。' };
  }

  const asset = {
    id: newId(),
    bookletId: state.booklet.id,
    contentId,
    originalFileName: fileName,
    pageCount: converted.length,
    importedAt: now.toISOString(),
    status: 'ready',
  };
  const imageMetas = converted.map((c) => ({
    id: newId(),
    pdfAssetId: asset.id,
    sourcePdfPage: c.sourcePdfPage,
    splitSide: c.splitSide,
    width: c.width,
    height: c.height,
  }));
  const removedImageIds = existing
    ? state.renderImages.filter((i) => i.pdfAssetId === existing.id).map((i) => i.id)
    : [];

  const pdfAssets = [...state.pdfAssets.filter((a) => a.id !== existing?.id), asset];
  const renderImages = [...state.renderImages.filter((i) => i.pdfAssetId !== existing?.id), ...imageMetas];
  const releasedPages = existing ? assignedCount(state, existing.id) : 0;
  const pages = existing ? clearAssetRefs(state, existing.id) : state.pages;

  return {
    ok: true,
    materialCount: imageMetas.length,
    releasedPages,
    pdfAssets,
    renderImages,
    pages,
    removedImageIds,
    put: {
      pdfAsset: { ...asset, blob: pdfBlob },
      renderImages: imageMetas.map((m, i) => ({ ...m, imageBlob: converted[i].imageBlob })),
    },
    ...disposal(existing, replaceMode),
  };
}

// PDF削除：PdfAsset・そのRenderImage・それらの割り当てを外す。Content と冊子ページへの配置は残す
export function buildUnregister(state, contentId, mode) {
  const existing = assetOfContent(state, contentId);
  if (!existing) return { ok: false, reason: 'このコンテンツにはPDFが登録されていません。' };
  if (!MODES.includes(mode)) return { ok: false, reason: '元PDFの扱い（ゴミ箱へ移動／完全削除）を選択してください。' };
  const removedImageIds = state.renderImages.filter((i) => i.pdfAssetId === existing.id).map((i) => i.id);
  const pdfAssets = state.pdfAssets.filter((a) => a.id !== existing.id);
  const renderImages = state.renderImages.filter((i) => i.pdfAssetId !== existing.id);
  const releasedPages = assignedCount(state, existing.id);
  const pages = clearAssetRefs(state, existing.id);
  return { ok: true, releasedPages, pdfAssets, renderImages, pages, removedImageIds, ...disposal(existing, mode) };
}
