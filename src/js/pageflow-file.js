// ビューア用 .pageflow ファイルの生成・読み込み（ブラウザ内で完結。外部へは送信しない）。
//
// .pageflow = ZIP形式の1ファイル（拡張子のみ .pageflow）
//   manifest.json            … ビューアの表示に必要な最小限の情報
//   pages/page-001.webp …    … 生成済みのページ画像（PDF登録時に生成したRenderImageをそのまま格納）
// 元PDF・TrashPdf・コンテンツ編集情報・編集履歴などの編集用データは含めない。
//
// 外部から受け取るファイルとして扱い、展開前後にサイズ・構造・画像の中身を検証する。
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { z } from 'zod';
import { bookletNameSchema, totalPagesSchema } from './schemas.js';

export const FORMAT_VERSION = 1;
export const EXTENSION = '.pageflow';
export const MANIFEST_NAME = 'manifest.json';

// 想定外に大きいファイル（ZIP爆弾など）を展開前に弾くための上限
export const LIMITS = {
  fileBytes: 300 * 1024 * 1024, // .pageflow ファイル全体
  entries: 2000, // ZIP内のエントリ数
  manifestBytes: 1024 * 1024, // manifest.json（展開後）
  imageBytes: 30 * 1024 * 1024, // 画像1枚（展開後）
  totalBytes: 400 * 1024 * 1024, // 展開後の合計
};

// 画像の種類 ↔ 拡張子 ↔ ファイル先頭のシグネチャ（拡張子と中身の不一致を検出する）
const IMAGE_KINDS = {
  webp: { type: 'image/webp', test: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP' },
  png: { type: 'image/png', test: (b) => b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' },
  jpg: { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};
const EXT_BY_TYPE = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

function ascii(bytes, start, length) {
  let s = '';
  for (let i = start; i < start + length && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

// ---- manifest のスキーマ（zod）----
const imageFileSchema = z
  .string()
  .regex(/^pages\/[A-Za-z0-9._-]{1,100}\.(webp|png|jpg)$/, 'imageFile は pages/ 配下の webp/png/jpg ファイルを指定してください');

const pageEntrySchema = z.object({
  pageNo: z.number().int().min(1),
  contentName: z.string().min(1).max(200),
  contentPageIndex: z.number().int().min(1).nullable(), // 複数ページコンテンツの何ページ目か（①②）
  contentPageCount: z.number().int().min(1).nullable(), // そのコンテンツの必要ページ数
  imageFile: imageFileSchema.nullable(), // 画像未登録のページは null（ビューアで「PDF未登録」を表示）
});

export const manifestSchema = z
  .object({
    formatVersion: z.literal(FORMAT_VERSION),
    bookletName: bookletNameSchema,
    totalPages: totalPagesSchema,
    bindingDirection: z.literal('left'),
    pages: z.array(pageEntrySchema),
  })
  .superRefine((m, ctx) => {
    if (m.pages.length !== m.totalPages) {
      ctx.addIssue({ code: 'custom', path: ['pages'], message: `pages の件数（${m.pages.length}）が totalPages（${m.totalPages}）と一致しません` });
      return;
    }
    const seenImages = new Set();
    m.pages.forEach((p, i) => {
      if (p.pageNo !== i + 1) {
        ctx.addIssue({ code: 'custom', path: ['pages', i, 'pageNo'], message: `pageNo は 1 から順に連番である必要があります（期待値 ${i + 1}）` });
      }
      if (p.contentPageIndex !== null && (p.contentPageCount === null || p.contentPageIndex > p.contentPageCount)) {
        ctx.addIssue({ code: 'custom', path: ['pages', i, 'contentPageIndex'], message: 'contentPageIndex が contentPageCount の範囲外です' });
      }
      if (p.imageFile) {
        if (seenImages.has(p.imageFile)) {
          ctx.addIssue({ code: 'custom', path: ['pages', i, 'imageFile'], message: `同じ画像ファイル（${p.imageFile}）が複数のページから参照されています` });
        }
        seenImages.add(p.imageFile);
      }
    });
  });

// ---- ファイル名 ----
// OSで使えない文字・予約名・先頭末尾のドット／空白を安全な文字列に置き換える
export function safeFileName(bookletName) {
  let base = String(bookletName ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|[. ]+$/g, '');
  if (base.length > 80) base = base.slice(0, 80).trimEnd();
  if (base === '' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(base)) base = `booklet${base ? `-${base}` : ''}`;
  return `${base}${EXTENSION}`;
}

// ---- 書き出し ----
// 表示用の最小限の情報だけを manifest にする（編集用データはコピーしない）
export function buildManifest(current, imageFileByPageNo) {
  const { booklet, contents, pages } = current;
  const byId = new Map(contents.map((c) => [c.id, c]));
  const sorted = [...pages].sort((a, b) => a.physicalPageNumber - b.physicalPageNumber);
  return {
    formatVersion: FORMAT_VERSION,
    bookletName: booklet.name,
    totalPages: booklet.totalPages,
    bindingDirection: booklet.bindingDirection,
    pages: sorted.map((p) => {
      const c = p.contentId ? byId.get(p.contentId) : null;
      const multi = c && c.requiredPages > 1;
      return {
        pageNo: p.physicalPageNumber,
        contentName: c ? c.name : '空き',
        contentPageIndex: multi ? p.contentPageIndex + 1 : null,
        contentPageCount: multi ? c.requiredPages : null,
        imageFile: imageFileByPageNo.get(p.physicalPageNumber) ?? null,
      };
    }),
  };
}

// images: Map<renderImageId, { bytes: Uint8Array, type: string }>
// 戻り値：.pageflow（ZIP）のバイト列と manifest。画像は再エンコードせず、生成済みのBlobをそのまま格納する
export function createPackage(current, images) {
  const files = {};
  const imageFileByPageNo = new Map();
  for (const p of current.pages) {
    const img = p.renderImageId ? images.get(p.renderImageId) : null;
    if (!img) continue;
    const ext = EXT_BY_TYPE[img.type];
    if (!ext) throw new Error(`対応していない画像形式です（${img.type || '不明'}）`);
    const file = `pages/page-${String(p.physicalPageNumber).padStart(3, '0')}.${ext}`;
    imageFileByPageNo.set(p.physicalPageNumber, file);
    files[file] = [img.bytes, { level: 0 }]; // WebP等は既に圧縮済みのため無圧縮で格納
  }
  const manifest = buildManifest(current, imageFileByPageNo);
  files[MANIFEST_NAME] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];
  return { bytes: zipSync(files), manifest };
}

// ---- 読み込み・検証 ----
const fail = (reason) => ({ ok: false, reason });

function describeIssue(issue) {
  const path = issue.path.length ? issue.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${p}`)).join('').replace(/^\./, '') : 'manifest';
  return `${path}：${issue.message}`;
}

// bytes: .pageflow ファイルの内容、fileName: 元のファイル名（拡張子の検証用）
// 戻り値：{ ok:true, manifest, images: Map<imageFile, { bytes, type }> } | { ok:false, reason }
export function readPackage(bytes, fileName) {
  if (!String(fileName ?? '').toLowerCase().endsWith(EXTENSION)) {
    return fail(`拡張子が ${EXTENSION} ではないため読み込めません。`);
  }
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return fail('ファイルが空です。');
  if (bytes.length > LIMITS.fileBytes) return fail('ファイルが大きすぎるため読み込めません。');
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return fail('ビューア用データの形式（ZIP）ではありません。ファイルが壊れている可能性があります。');

  // 展開前にエントリ数・サイズを検査し、必要なファイル（manifest.json と pages/）だけを展開する
  let violation = null;
  let count = 0;
  let total = 0;
  let files;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > LIMITS.entries) violation ??= 'ファイル内のエントリ数が多すぎます。';
        else if (total > LIMITS.totalBytes) violation ??= '展開後のサイズが大きすぎます。';
        else if (f.name === MANIFEST_NAME && f.originalSize > LIMITS.manifestBytes) violation ??= 'manifest.json が大きすぎます。';
        else if (f.name.startsWith('pages/') && f.originalSize > LIMITS.imageBytes) violation ??= `画像ファイル（${f.name}）が大きすぎます。`;
        if (violation) return false;
        return f.name === MANIFEST_NAME || f.name.startsWith('pages/');
      },
    });
  } catch {
    return fail('ZIPとして展開できませんでした。ファイルが壊れている可能性があります。');
  }
  if (violation) return fail(violation);

  const manifestBytes = files[MANIFEST_NAME];
  if (!manifestBytes) return fail(`${MANIFEST_NAME} が見つかりません。PageFlowのビューア用データではない可能性があります。`);

  let raw;
  try {
    raw = JSON.parse(strFromU8(manifestBytes));
  } catch {
    return fail(`${MANIFEST_NAME} を読み取れませんでした（JSONの形式が不正です）。`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return fail(`${MANIFEST_NAME} の形式が不正です。`);
  if (raw.formatVersion !== FORMAT_VERSION) {
    return fail(
      typeof raw.formatVersion === 'number'
        ? `非対応のバージョン（formatVersion: ${raw.formatVersion}）です。このPageFlowは formatVersion ${FORMAT_VERSION} のみ対応しています。`
        : `${MANIFEST_NAME} に formatVersion がありません。`,
    );
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return fail(`${MANIFEST_NAME} の内容が不正です。${describeIssue(parsed.error.issues[0])}`);
  const manifest = parsed.data;

  // manifest が参照する画像が実在し、拡張子と中身が一致することを確認する
  const images = new Map();
  for (const p of manifest.pages) {
    if (!p.imageFile) continue;
    const data = Object.hasOwn(files, p.imageFile) ? files[p.imageFile] : undefined;
    if (!data) return fail(`P${p.pageNo} の画像ファイル（${p.imageFile}）がファイル内に見つかりません。`);
    const kind = IMAGE_KINDS[p.imageFile.split('.').pop()];
    if (!kind.test(data)) return fail(`P${p.pageNo} の画像ファイル（${p.imageFile}）が画像として不正です。`);
    images.set(p.imageFile, { bytes: data, type: kind.type });
  }
  return { ok: true, manifest, images };
}
