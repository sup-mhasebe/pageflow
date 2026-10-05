// PDF素材（RenderImage）と冊子ページの「割り当て」に関する純粋関数。
// Page.renderImageId は、ユーザーが明示的に決めた割り当てとして保存する。
// 素材の並び順などから推測して自動で付け替えることはしない（順番割り当ては、ユーザーがボタンを押したときだけ）。
import { assetOfContent, orderedImages } from './pdf.js';

// 素材の名称：「2ページ」「2ページ（左）」「2ページ（右）」
export function materialName(image) {
  const side = image.splitSide === 'left' ? '（左）' : image.splitSide === 'right' ? '（右）' : '';
  return `${image.sourcePdfPage}ページ${side}`;
}

// コンテンツのPDF素材（PDF順。A3分割は左→右）。PDFが無ければ空配列
export function materialsOf(state, contentId) {
  const asset = assetOfContent(state, contentId);
  return asset ? orderedImages(state.renderImages ?? [], asset.id) : [];
}

// 素材ID → 割り当て先ページ（物理ページ番号）
export function assignmentMap(pages) {
  const map = new Map();
  for (const p of pages) if (p.renderImageId) map.set(p.renderImageId, p.physicalPageNumber);
  return map;
}

// 素材を、指定ページへ割り当てられるか
//  - 割り当て可能：その素材が属するPDFのコンテンツが配置されているページ
//  - 拒否：別コンテンツのページ、コンテンツが配置されていない空きページ
export function checkAssign(state, imageId, pageNo) {
  const image = (state.renderImages ?? []).find((i) => i.id === imageId);
  if (!image) return { ok: false, reason: 'PDF素材が見つかりません。' };
  const asset = (state.pdfAssets ?? []).find((a) => a.id === image.pdfAssetId);
  if (!asset) return { ok: false, reason: 'PDF素材が見つかりません。' };
  const page = state.pages.find((p) => p.physicalPageNumber === pageNo);
  if (!page) return { ok: false, reason: '割り当て先のページが不正です。' };
  if (!page.contentId) return { ok: false, reason: `P${pageNo}はコンテンツが配置されていない空きページのため、割り当てできません。` };
  if (page.contentId !== asset.contentId) {
    const owner = state.contents.find((c) => c.id === asset.contentId);
    const there = state.contents.find((c) => c.id === page.contentId);
    return {
      ok: false,
      reason: `P${pageNo}は「${there?.name ?? '別のコンテンツ'}」のページです。この素材は「${owner?.name ?? '別のコンテンツ'}」のページにだけ割り当てできます。`,
    };
  }
  return { ok: true };
}

// 素材を、指定ページへ割り当てる。
//  - 1素材は最大1ページ：すでに別ページへ割り当て済みなら、コピーではなく移動する
//  - 割り当て済みのページへ別の素材を置いた場合は、確認なしで置き換える（古い素材は削除せず、未割り当てへ戻る）
export function assignImage(state, imageId, pageNo) {
  const check = checkAssign(state, imageId, pageNo);
  if (!check.ok) return check;
  const image = state.renderImages.find((i) => i.id === imageId);
  const target = state.pages.find((p) => p.physicalPageNumber === pageNo);
  if (target.renderImageId === imageId) return { ok: true, pages: state.pages, unchanged: true };
  const moved = state.pages.some((p) => p.renderImageId === imageId);
  const replaced = !!target.renderImageId;
  const pages = state.pages.map((p) => {
    if (p.physicalPageNumber === pageNo) return { ...p, pdfAssetId: image.pdfAssetId, renderImageId: imageId };
    if (p.renderImageId === imageId) return { ...p, pdfAssetId: null, renderImageId: null };
    return p;
  });
  return { ok: true, pages, moved, replaced };
}

// ページの割り当てだけを解除する（素材・PDF・コンテンツ・配置は残す）
export function unassignPage(state, pageNo) {
  const target = state.pages.find((p) => p.physicalPageNumber === pageNo);
  if (!target) return { ok: false, reason: '対象のページが見つかりません。' };
  if (!target.renderImageId) return { ok: false, reason: 'このページには割り当てがありません。' };
  const pages = state.pages.map((p) => (p === target ? { ...p, pdfAssetId: null, renderImageId: null } : p));
  return { ok: true, pages };
}

// ［PDFを順番に割り当て］の見積もり
//  - 割り当て元：そのPDFの未割り当て素材（PDF順。A3分割は左→右）
//  - 割り当て先：そのコンテンツが配置されているページのうち、未割り当てのページ（物理ページ番号順）
export function planSequentialAssign(state, contentId) {
  const used = assignmentMap(state.pages);
  const sources = materialsOf(state, contentId).filter((i) => !used.has(i.id));
  const targets = state.pages
    .filter((p) => p.contentId === contentId && !p.renderImageId)
    .map((p) => p.physicalPageNumber)
    .sort((a, b) => a - b);
  return { sources, targets, count: Math.min(sources.length, targets.length) };
}

// ［PDFを順番に割り当て］：既存の割り当ては上書きしない。余った素材は未割り当てのまま残す
export function assignSequentially(state, contentId) {
  const plan = planSequentialAssign(state, contentId);
  if (plan.count === 0) return { ok: false, reason: '割り当てできる素材または空きページがありません。' };
  const asset = assetOfContent(state, contentId);
  const byPage = new Map();
  for (let i = 0; i < plan.count; i++) byPage.set(plan.targets[i], plan.sources[i].id);
  const pages = state.pages.map((p) =>
    byPage.has(p.physicalPageNumber) ? { ...p, pdfAssetId: asset.id, renderImageId: byPage.get(p.physicalPageNumber) } : p,
  );
  return { ok: true, pages, count: plan.count };
}

// データ整合性の検査（違反の一覧を返す。空配列なら整合している）
//  1. 割り当て済みの素材は、そのページのコンテンツに属するPDFの素材であること
//  2. 1つの素材が、同時に複数のページへ割り当てられていないこと
//  3. コンテンツの配置は、必要ページ数分の連続したページであること
//  4. 素材が割り当てられているページには、コンテンツが存在すること
export function findIntegrityIssues(state) {
  const issues = [];
  const assetById = new Map((state.pdfAssets ?? []).map((a) => [a.id, a]));
  const imageById = new Map((state.renderImages ?? []).map((i) => [i.id, i]));
  const contentById = new Map(state.contents.map((c) => [c.id, c]));
  const seen = new Map();
  for (const p of state.pages) {
    if (!p.renderImageId) continue;
    const no = p.physicalPageNumber;
    const image = imageById.get(p.renderImageId);
    const asset = image ? assetById.get(image.pdfAssetId) : null;
    if (!p.contentId || !contentById.has(p.contentId)) issues.push({ rule: 4, pageNo: no, reason: 'コンテンツのないページに素材が割り当てられています。' });
    else if (!asset || asset.contentId !== p.contentId) issues.push({ rule: 1, pageNo: no, reason: '別コンテンツ（または存在しない）の素材が割り当てられています。' });
    if (seen.has(p.renderImageId)) issues.push({ rule: 2, pageNo: no, reason: `同じ素材がP${seen.get(p.renderImageId)}にも割り当てられています。` });
    else seen.set(p.renderImageId, no);
  }
  for (const c of state.contents) {
    const nums = state.pages.filter((p) => p.contentId === c.id).map((p) => p.physicalPageNumber).sort((a, b) => a - b);
    if (nums.length === 0) continue;
    const contiguous = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
    if (!contiguous || nums.length !== c.requiredPages) issues.push({ rule: 3, pageNo: nums[0], reason: `「${c.name}」の配置が、必要ページ数分の連続したページではありません。` });
  }
  return issues;
}

// 読み込み時の修復：整合しない割り当て（規則1・2・4）だけを外す。素材・PDF・コンテンツは変えない。
// 正常なデータ（旧バージョンで登録・割り当て済みのものを含む）は、1つも変更しない。
export function repairAssignments(state) {
  const assetById = new Map((state.pdfAssets ?? []).map((a) => [a.id, a]));
  const imageById = new Map((state.renderImages ?? []).map((i) => [i.id, i]));
  const seen = new Set();
  let removed = 0;
  const pages = state.pages.map((p) => {
    if (!p.renderImageId && !p.pdfAssetId) return p;
    const image = p.renderImageId ? imageById.get(p.renderImageId) : null;
    const asset = image ? assetById.get(image.pdfAssetId) : null;
    const valid = !!p.contentId && !!asset && asset.contentId === p.contentId && !seen.has(p.renderImageId);
    if (valid) {
      seen.add(p.renderImageId);
      return p.pdfAssetId === asset.id ? p : { ...p, pdfAssetId: asset.id };
    }
    removed++;
    return { ...p, pdfAssetId: null, renderImageId: null };
  });
  return { pages: removed > 0 ? pages : state.pages, removed };
}

// 右カラム（PDF素材）の対象コンテンツ：ユーザーが選んだもの → 選択中のページのコンテンツ → 先頭のコンテンツ
export function resolveMaterialContentId(contents, pages, selectedPageNo, preferredId) {
  if (preferredId && contents.some((c) => c.id === preferredId)) return preferredId;
  const sel = pages.find((p) => p.physicalPageNumber === selectedPageNo);
  if (sel?.contentId && contents.some((c) => c.id === sel.contentId)) return sel.contentId;
  return contents[0]?.id ?? null;
}

// ページの表示状態：empty（空き）| no-pdf（PDF未登録）| unassigned（素材あり・未割り当て）| image（画像）
// 「素材あり・未割り当て」は、そのページのコンテンツにPDFが登録されている場合だけ。他コンテンツの素材の有無は関係しない
export function pageState(state, page, hasImageUrl = true) {
  if (!page.contentId) return 'empty';
  if (page.renderImageId && hasImageUrl) return 'image';
  return assetOfContent(state, page.contentId) ? 'unassigned' : 'no-pdf';
}
