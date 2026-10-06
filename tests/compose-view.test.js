import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEPS,
  clampZoom,
  stepZoom,
  cardWidth,
  cardHeight,
  zoomLabel,
  spreadRows,
  fitZoom,
} from '../src/js/domain/compose-view.js';

test('倍率は実用的な範囲（40〜200%）に収まる。不正な値は100%', () => {
  assert.equal(clampZoom(5), ZOOM_MIN);
  assert.equal(clampZoom(1000), ZOOM_MAX);
  assert.equal(clampZoom(87.4), 87);
  assert.equal(clampZoom(NaN), 100);
  assert.equal(clampZoom(undefined), 100);
  assert.equal(zoomLabel(75), '75%');
  assert.equal(zoomLabel(100), '100%');
});

test('［＋］［－］：段階を1つずつ進み、最小・最大で止まる。段階の間の倍率からも隣の段階へ', () => {
  assert.equal(stepZoom(100, 1), 125);
  assert.equal(stepZoom(100, -1), 90);
  assert.equal(stepZoom(ZOOM_MAX, 1), ZOOM_MAX);
  assert.equal(stepZoom(ZOOM_MIN, -1), ZOOM_MIN);
  assert.equal(stepZoom(80, 1), 90); // 全体表示などで段階の間になった場合
  assert.equal(stepZoom(80, -1), 75);
  // すべての段階を順に往復できる
  let z = ZOOM_MIN;
  const up = [z];
  while (z < ZOOM_MAX) up.push((z = stepZoom(z, 1)));
  assert.deepEqual(up, ZOOM_STEPS);
});

test('縦横比：カードの幅だけを倍率で変え、サムネイル（幅−余白）はA4縦比率のまま', () => {
  for (const z of ZOOM_STEPS) {
    const thumbW = cardWidth(z) - 20;
    const thumbH = cardHeight(z) - 72;
    assert.ok(Math.abs(thumbH / thumbW - 297 / 210) < 0.03, `${z}%`);
  }
  assert.ok(cardWidth(200) > cardWidth(100) && cardWidth(100) > cardWidth(50));
});

test('見開きの行（左綴じ）：12P → [1] [2,3] [4,5] [6,7] [8,9] [10,11] [12]', () => {
  assert.deepEqual(spreadRows(12), [[1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12]]);
  assert.deepEqual(spreadRows(8), [[1], [2, 3], [4, 5], [6, 7], [8]]);
  const rows = spreadRows(64);
  assert.deepEqual(rows[0], [1]);
  assert.deepEqual(rows.at(-1), [64]);
  assert.equal(rows.flat().length, 64);
});

test('全体表示：領域に収まる最大の倍率。領域が広いほど大きく、狭ければ小さい', () => {
  const a = fitZoom({ mode: 'list', totalPages: 16, width: 640, height: 800 });
  const b = fitZoom({ mode: 'list', totalPages: 16, width: 640, height: 400 });
  assert.ok(a > b, `${a} > ${b}`);
  assert.ok(a >= ZOOM_MIN && a <= ZOOM_MAX);
  // 収まる最大の倍率：5%大きくすると収まらない
  const fits = (z, mode, n, w, h) => {
    const cw = cardWidth(z);
    const ch = cardHeight(z);
    if (mode === 'list') {
      const cols = Math.max(1, Math.floor((w + 12) / (cw + 12)));
      return Math.ceil(n / cols) * ch + (Math.ceil(n / cols) - 1) * 12 <= h;
    }
    const sw = 2 * cw + 8 + 16;
    const rows = Math.ceil(spreadRows(n).length / Math.max(1, Math.floor((w + 12) / (sw + 12))));
    return sw <= w && rows * (ch + 16) + (rows - 1) * 12 <= h;
  };
  assert.ok(fits(a, 'list', 16, 640, 800));
  if (a < ZOOM_MAX) assert.ok(!fits(a + 5, 'list', 16, 640, 800));
  const s = fitZoom({ mode: 'spread', totalPages: 12, width: 700, height: 700 });
  assert.ok(fits(s, 'spread', 12, 700, 700));
  if (s < ZOOM_MAX) assert.ok(!fits(s + 5, 'spread', 12, 700, 700));
});

test('全体表示：高さに制限が無ければ幅だけで決まる。極端に狭い領域でも最小倍率を下回らない', () => {
  assert.equal(fitZoom({ mode: 'list', totalPages: 8, width: 2000, height: Infinity }), ZOOM_MAX);
  assert.equal(fitZoom({ mode: 'list', totalPages: 64, width: 100, height: 100 }), ZOOM_MIN);
  assert.equal(fitZoom({ mode: 'spread', totalPages: 64, width: 100, height: 100 }), ZOOM_MIN);
});
