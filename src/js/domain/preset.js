// 標準構成プリセット（表紙・表紙裏・目次・裏表紙裏・裏表紙）の純粋関数。
// 固定ページの概念は廃止済み。標準構成は「必要なものだけ、空きのあるページへ、まとめてセットする」機能。
// 原則：既存の配置を勝手に動かさない・上書きしない。標準位置が使えない項目はスキップして理由を返す。
import { newContentId } from './content.js';

// 標準構成の定義（位置は総ページ数 n から決まる）
export const PRESET_DEFS = [
  { key: 'cover', name: '表紙', position: () => 1 },
  { key: 'coverBack', name: '表紙裏', position: () => 2 },
  { key: 'toc', name: '目次', position: () => 3 },
  { key: 'backCoverInner', name: '裏表紙裏', position: (n) => n - 1 },
  { key: 'backCover', name: '裏表紙', position: (n) => n },
];

const KEY_BY_NAME = Object.fromEntries(PRESET_DEFS.map((d) => [d.name, d.key]));

// 標準構成の位置と名称の一覧（新規作成画面のプレビュー用）
export function presetLayout(totalPages) {
  return PRESET_DEFS.map((d) => ({ key: d.key, name: d.name, position: d.position(totalPages) }));
}

// 保存データの読み込み時に、旧バージョンの「固定ページ」コンテンツを通常コンテンツとして扱う。
//  - isFixed は false にする（旧バージョンで開いても検証を通るよう、項目自体は残す）
//  - 標準構成と同じ名前の固定コンテンツには presetKey を付ける（確定的な対応：名前→キー）
export function normalizeContent(c) {
  const out = { ...c, isFixed: false };
  if (c.isFixed && !c.presetKey && KEY_BY_NAME[c.name]) out.presetKey = KEY_BY_NAME[c.name];
  return out;
}

const pageStart = (pages, contentId) => {
  const nums = pages.filter((p) => p.contentId === contentId).map((p) => p.physicalPageNumber);
  return nums.length > 0 ? Math.min(...nums) : null;
};

// 項目ごとの状態。state: { booklet, contents, pages }
//  available        … 標準位置が空き。コンテンツを作って配置できる
//  existing-unplaced… 標準構成のコンテンツは存在するが未配置で、標準位置が空き。既存コンテンツを配置できる
//  placed-standard  … 標準位置に配置済み（選択不可）
//  placed-elsewhere … 別の位置に配置済み（選択不可。勝手に移動しない）
//  blocked          … 標準位置が別のコンテンツで使用中（選択不可）
export function presetStatus(state) {
  const { booklet, contents, pages } = state;
  const n = booklet.totalPages;
  const byNo = new Map(pages.map((p) => [p.physicalPageNumber, p]));
  const nameById = new Map(contents.map((c) => [c.id, c.name]));
  return PRESET_DEFS.map((d) => {
    const position = d.position(n);
    const existing = contents.find((c) => c.presetKey === d.key) ?? null;
    const base = { key: d.key, name: d.name, position, contentId: existing?.id ?? null };
    if (existing) {
      const start = pageStart(pages, existing.id);
      if (start === position) return { ...base, status: 'placed-standard', selectable: false, note: '配置済み' };
      if (start !== null) {
        return { ...base, status: 'placed-elsewhere', selectable: false, note: `P${start} に配置済み` };
      }
    }
    const occupant = byNo.get(position)?.contentId;
    if (occupant) {
      return {
        ...base,
        status: 'blocked',
        selectable: false,
        note: `P${position} は「${nameById.get(occupant) ?? '別のコンテンツ'}」が使用中`,
      };
    }
    if (!byNo.has(position)) {
      return { ...base, status: 'blocked', selectable: false, note: `P${position} がありません` };
    }
    return existing
      ? { ...base, status: 'existing-unplaced', selectable: true, note: '既存のコンテンツを配置' }
      : { ...base, status: 'available', selectable: true, note: '' };
  });
}

// 選択した項目を、1回の更新（全か無か）でセットする。選べない項目はスキップして理由を返す。
// 戻り値：{ ok, contents, pages, applied: [{key,name,position,created}], skipped: [{key,name,reason}] }
export function applyPreset(state, keys) {
  const wanted = new Set(keys);
  const status = presetStatus(state);
  let contents = state.contents;
  let pages = state.pages;
  const applied = [];
  const skipped = [];
  for (const s of status) {
    if (!wanted.has(s.key)) continue;
    if (!s.selectable) {
      skipped.push({ key: s.key, name: s.name, reason: s.note || '配置できません' });
      continue;
    }
    let contentId = s.contentId;
    const created = !contentId;
    if (created) {
      contentId = newContentId();
      contents = [
        ...contents,
        { id: contentId, bookletId: state.booklet.id, name: s.name, requiredPages: 1, isFixed: false, presetKey: s.key },
      ];
    }
    pages = pages.map((p) => (p.physicalPageNumber === s.position ? { ...p, contentId, contentPageIndex: 0 } : p));
    applied.push({ key: s.key, name: s.name, position: s.position, created });
  }
  return { ok: true, contents, pages, applied, skipped };
}
