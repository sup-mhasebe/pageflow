import { z } from 'zod';

// 総ページ数の下限。4ページでは固定ページ（目次と裏表紙裏）が重なるため8から
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
    `総ページ数は${MIN_TOTAL_PAGES}以上で指定してください（4ページでは固定ページが重なるため指定できません）`,
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

export const contentRecordSchema = z.object({
  id: z.string(),
  bookletId: z.string(),
  name: z.string().min(1),
  requiredPages: z.number().int().min(1),
  isFixed: z.boolean(),
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
