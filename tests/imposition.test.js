import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeImposition } from '../src/js/domain/imposition.js';

// 期待値：[面付データページ番号, 用紙番号, 面, 左, 右]
const EXPECTED = {
  8: [
    [1, 1, 'outer', 8, 1],
    [2, 1, 'inner', 2, 7],
    [3, 2, 'outer', 6, 3],
    [4, 2, 'inner', 4, 5],
  ],
  12: [
    [1, 1, 'outer', 12, 1],
    [2, 1, 'inner', 2, 11],
    [3, 2, 'outer', 10, 3],
    [4, 2, 'inner', 4, 9],
    [5, 3, 'outer', 8, 5],
    [6, 3, 'inner', 6, 7],
  ],
  16: [
    [1, 1, 'outer', 16, 1],
    [2, 1, 'inner', 2, 15],
    [3, 2, 'outer', 14, 3],
    [4, 2, 'inner', 4, 13],
    [5, 3, 'outer', 12, 5],
    [6, 3, 'inner', 6, 11],
    [7, 4, 'outer', 10, 7],
    [8, 4, 'inner', 8, 9],
  ],
};

for (const [n, rows] of Object.entries(EXPECTED)) {
  test(`${n}P：面付結果が期待値どおり（外側→内側の順）`, () => {
    const imp = computeImposition(Number(n));
    const actual = imp.spreads.map((s) => [s.spreadNo, s.sheetNo, s.side, s.left, s.right]);
    assert.deepEqual(actual, rows);
  });
}

test('8P：1ページ目 P8|P1 / 2ページ目 P2|P7 / 3ページ目 P6|P3 / 4ページ目 P4|P5', () => {
  const text = computeImposition(8).spreads.map((s) => `${s.spreadNo}:P${s.left}|P${s.right}`);
  assert.deepEqual(text, ['1:P8|P1', '2:P2|P7', '3:P6|P3', '4:P4|P5']);
});

for (const n of [8, 12, 16, 20, 24, 64]) {
  test(`${n}P：全ページが1回ずつ登場し、重複・欠落がない`, () => {
    const imp = computeImposition(n);
    const all = imp.spreads.flatMap((s) => [s.left, s.right]);
    assert.equal(all.length, n);
    assert.equal(new Set(all).size, n); // 重複なし
    const sorted = [...all].sort((a, b) => a - b);
    assert.deepEqual(sorted, Array.from({ length: n }, (_, i) => i + 1)); // 欠落なし（P1〜PN）
  });

  test(`${n}P：面付データページ数は N/2、必要用紙枚数は N/4`, () => {
    const imp = computeImposition(n);
    assert.equal(imp.spreads.length, n / 2);
    assert.equal(imp.spreadCount, n / 2);
    assert.equal(imp.sheetCount, n / 4);
    assert.equal(new Set(imp.spreads.map((s) => s.sheetNo)).size, n / 4);
  });

  test(`${n}P：面付データページ番号は1からの連番、各用紙は外側→内側の順`, () => {
    const imp = computeImposition(n);
    imp.spreads.forEach((s, i) => {
      assert.equal(s.spreadNo, i + 1);
      assert.equal(s.side, i % 2 === 0 ? 'outer' : 'inner');
      assert.equal(s.sheetNo, Math.floor(i / 2) + 1);
    });
  });

  test(`${n}P：すべての面で左右ページ番号の和が N+1 になる（中綴じの性質）`, () => {
    for (const s of computeImposition(n).spreads) assert.equal(s.left + s.right, n + 1);
  });
}

test('4の倍数以外・不正値は拒否する', () => {
  for (const bad of [0, 3, 6, 10, -4, 8.5, NaN]) assert.throws(() => computeImposition(bad), RangeError);
});
