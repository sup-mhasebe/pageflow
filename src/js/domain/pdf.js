// PDF登録に関する純粋関数（PDF.js / Canvas / IndexedDB には依存しない）。
// - ページサイズ判定、ページ数の照合、冊子ページへの割り当て（RenderImageとの対応付け）
// - PDFを暗黙的に削除・移動しない：差し替え／解除では必ず呼び出し側が選んだ mode（trash | delete）に従う

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

// 変換後ページ数と必要ページ数の照合
//  - 同数：登録可
//  - 不足：登録可（不足分は「PDF未登録」のまま）
//  - 超過：登録不可（必要ページ数は自動変更しない・追加ページへも配置しない）
export function checkPageCount(converted, required) {
  if (converted > required) {
    return {
      ok: false,
      reason: `PDFの変換後ページ数（${converted}ページ）がコンテンツの必要ページ数（${required}ページ）を超えているため登録できません。必要ページ数は自動では変更されません。`,
    };
  }
  return { ok: true, shortage: required - converted };
}

// 変換後の並び順：元PDFのページ順、A3は 左 → 右
const SIDE_ORDER = { none: 0, left: 0, right: 1 };
export function orderedImages(renderImages, pdfAssetId) {
  return renderImages
    .filter((i) => i.pdfAssetId === pdfAssetId)
    .sort((a, b) => a.sourcePdfPage - b.sourcePdfPage || SIDE_ORDER[a.splitSide] - SIDE_ORDER[b.splitSide]);
}

// 冊子ページの pdfAssetId / renderImageId を「コンテンツの配置位置」と「PDFの生成画像」から導出し直す。
// コンテンツのN番目のページ(contentPageIndex)に、そのPDFのN番目の画像を対応付ける。
export function relinkPages(state) {
  const assets = state.pdfAssets ?? [];
  const images = state.renderImages ?? [];
  const imagesByContent = new Map();
  for (const a of assets) imagesByContent.set(a.contentId, { asset: a, images: orderedImages(images, a.id) });
  return state.pages.map((p) => {
    const entry = p.contentId ? imagesByContent.get(p.contentId) : null;
    const img = entry ? entry.images[p.contentPageIndex] : null;
    const pdfAssetId = img ? entry.asset.id : null;
    const renderImageId = img ? img.id : null;
    if (p.pdfAssetId === pdfAssetId && p.renderImageId === renderImageId) return p;
    return { ...p, pdfAssetId, renderImageId };
  });
}

export function assetOfContent(state, contentId) {
  return (state.pdfAssets ?? []).find((a) => a.contentId === contentId) ?? null;
}

export const hasPdfRef = (page) => !!(page.pdfAssetId || page.renderImageId);

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
export function buildRegistration(state, contentId, { fileName, pdfBlob, converted, replaceMode }, now = new Date()) {
  const content = state.contents.find((c) => c.id === contentId);
  if (!content) return { ok: false, reason: 'コンテンツが見つかりません。' };
  if (!state.pages.some((p) => p.contentId === contentId)) {
    return { ok: false, reason: 'PDFを登録するには、先にコンテンツをページへ配置してください。' };
  }
  const check = checkPageCount(converted.length, content.requiredPages);
  if (!check.ok) return check;

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
  const pages = relinkPages({ ...state, pdfAssets, renderImages });

  return {
    ok: true,
    shortage: check.shortage,
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

// PDF登録解除：PDFとの関連だけ外す。Content と冊子ページへの配置は残す
export function buildUnregister(state, contentId, mode) {
  const existing = assetOfContent(state, contentId);
  if (!existing) return { ok: false, reason: 'このコンテンツにはPDFが登録されていません。' };
  if (!MODES.includes(mode)) return { ok: false, reason: '元PDFの扱い（ゴミ箱へ移動／完全削除）を選択してください。' };
  const removedImageIds = state.renderImages.filter((i) => i.pdfAssetId === existing.id).map((i) => i.id);
  const pdfAssets = state.pdfAssets.filter((a) => a.id !== existing.id);
  const renderImages = state.renderImages.filter((i) => i.pdfAssetId !== existing.id);
  const pages = relinkPages({ ...state, pdfAssets, renderImages });
  return { ok: true, pdfAssets, renderImages, pages, removedImageIds, ...disposal(existing, mode) };
}

export const PDF_IN_USE_MESSAGE =
  'PDFが登録されているページが含まれるためページ数を変更できません。先にPDF登録を解除してください。';
