// HTMLエスケープ（ユーザー入力の冊子名などを innerHTML へ入れる前に必ず通す）
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 丸数字（①②…）。21以上は (n) 表記
export const circled = (n) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`);

export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const btnPrimary =
  'inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50';
export const btnSecondary =
  'inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:cursor-not-allowed disabled:opacity-50';
export const btnDanger =
  'inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400 disabled:cursor-not-allowed disabled:opacity-50';
export const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

// ページ番号の配列を範囲表記にする（例：[9,10,12] → "P9〜P10、P12"）
export function formatRanges(nums) {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `P${sorted[i]}〜P${sorted[j]}` : `P${sorted[i]}`);
    i = j + 1;
  }
  return out.join('、');
}

// 線画アイコン（絵文字ではなくインラインSVG。色は文字色に合わせる）
const svg = (path, cls) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="${cls}" aria-hidden="true" focusable="false">${path}</svg>`;

// 見開きの本
export const iconBook = (cls = 'h-5 w-5') =>
  svg('<path d="M12 6.5C10.4 5.3 8.2 4.8 4 4.8v13c4.2 0 6.4.5 8 1.7 1.6-1.2 3.8-1.7 8-1.7v-13c-4.2 0-6.4.5-8 1.7Z"/><path d="M12 6.5v13"/>', cls);
// 鉛筆（編集）
export const iconPencil = (cls = 'h-4 w-4') =>
  svg('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="m14.5 7.5 3 3"/>', cls);
// 下向きの山括弧
export const iconChevronDown = (cls = 'h-4 w-4') => svg('<path d="m6 9 6 6 6-6"/>', cls);
