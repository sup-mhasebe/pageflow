import { z } from 'zod';

// 総ページ数の下限（v0.1の仕様：8ページ以上の4の倍数。上限は設けない）
export const MIN_TOTAL_PAGES = 8;

export const bookletNameSchema = z
  .string({ error: '冊子名を入力してください' })
  .trim()
  .min(1, '冊子名を入力してください')
  .max(100, '冊子名は100文字以内で入力してください');

export const totalPagesSchema = z
  .number({ error: '総ページ数を数値で入力してください' })
  .int('総ページ数は整数で入力してください')
  .min(
    MIN_TOTAL_PAGES,
    `総ページ数は${MIN_TOTAL_PAGES}以上で指定してください`,
  )
  .refine((n) => n % 4 === 0, '総ページ数は4の倍数で指定してください');

export const newBookletSchema = z.object({
  name: bookletNameSchema,
  totalPages: totalPagesSchema,
});

// フォームの文字列入力を数値へ変換して検証する（空欄はNaN扱いで数値エラーにする）
export function parseTotalPagesInput(raw) {
  const text = String(raw ?? '').trim();
  const value = text === '' ? NaN : Number(text);
  return totalPagesSchema.safeParse(value);
}

// 新規冊子フォームの検証。項目ごとに最初のエラーメッセージを返す
export function validateNewBooklet(rawName, rawTotalPages) {
  const errors = {};
  const name = bookletNameSchema.safeParse(rawName);
  if (!name.success) errors.name = name.error.issues[0].message;
  const total = parseTotalPagesInput(rawTotalPages);
  if (!total.success) errors.totalPages = total.error.issues[0].message;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { name: name.data, totalPages: total.data } };
}

// ---- コンテンツ登録（名称＋必要ページ数）----
export const contentNameSchema = z
  .string({ error: 'コンテンツ名を入力してください' })
  .trim()
  .min(1, 'コンテンツ名を入力してください')
  .max(100, 'コンテンツ名は100文字以内で入力してください');

export const requiredPagesSchema = z
  .number({ error: '必要ページ数を数値で入力してください' })
  .int('必要ページ数は整数で入力してください（0.5Pには対応していません）')
  .min(1, '必要ページ数は1以上で指定してください');

export function parseRequiredPagesInput(raw) {
  const text = String(raw ?? '').trim();
  const value = text === '' ? NaN : Number(text);
  return requiredPagesSchema.safeParse(value);
}

// コンテンツ入力フォームの検証。項目ごとに最初のエラーメッセージを返す
export function validateContentInput(rawName, rawRequiredPages) {
  const errors = {};
  const name = contentNameSchema.safeParse(rawName);
  if (!name.success) errors.name = name.error.issues[0].message;
  const pages = parseRequiredPagesInput(rawRequiredPages);
  if (!pages.success) errors.requiredPages = pages.error.issues[0].message;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { name: name.data, requiredPages: pages.data } };
}

// ---- IndexedDB から読み出したレコードの形式検証 ----
const nullableId = z.string().nullable();

export const bookletRecordSchema = z.object({
  id: z.string(),
  name: bookletNameSchema,
  templateId: z.string(),
  totalPages: totalPagesSchema,
  pageSize: z.literal('A4'),
  bindingType: z.literal('saddle-stitch'),
  bindingDirection: z.literal('left'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// 標準構成から作ったコンテンツの識別キー（名前の変更や同名のコンテンツと区別するため）
export const PRESET_KEYS = ['cover', 'coverBack', 'toc', 'backCoverInner', 'backCover'];

// isFixed は旧バージョンの項目（固定ページ）。読み込み時に通常コンテンツとして扱い、新規保存では false を書く
export const contentRecordSchema = z.object({
  id: z.string(),
  bookletId: z.string(),
  name: z.string().min(1),
  requiredPages: z.number().int().min(1),
  isFixed: z.boolean().optional(),
  presetKey: z.enum(PRESET_KEYS).optional(),
});

export const pageRecordSchema = z.object({
  id: z.string(),
  bookletId: z.string(),
  physicalPageNumber: z.number().int().min(1),
  contentId: nullableId,
  contentPageIndex: z.number().int().min(0).nullable(),
  pdfAssetId: nullableId,
  renderImageId: nullableId,
});

// PdfAsset／RenderImage のメタ情報（Blob本体は別管理のため検証対象外）
export const pdfAssetMetaSchema = z.object({
  id: z.string(),
  bookletId: z.string(),
  contentId: z.string(),
  originalFileName: z.string(),
  pageCount: z.number().int().min(1), // A3分割後（A4換算）のページ数
  importedAt: z.string(),
  status: z.literal('ready'),
});

export const renderImageMetaSchema = z.object({
  id: z.string(),
  pdfAssetId: z.string(),
  sourcePdfPage: z.number().int().min(1),
  splitSide: z.enum(['none', 'left', 'right']),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
