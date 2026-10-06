// 再描画（innerHTML の作り直し）をまたいで、画面の「見た目の状態」を保つ仕組み。
//  - スクロール位置：data-scroll-key を持つ要素（独立してスクロールする領域）と、画面全体
//  - フォーカスとカーソル位置：id を持つ入力欄
//  - 入力途中の文字：data-keep-value を持つ入力欄（状態から再描画された値が変わっていない場合のみ）
// 状態（store）に基づく通常の更新は、これまでどおりそのまま反映する。

// 再描画の直前に呼ぶ。viewKey は「どの画面か」（画面が変わったときは画面全体のスクロールを復元しない）
export function captureViewState(root, viewKey) {
  const scrolls = new Map();
  for (const el of root.querySelectorAll('[data-scroll-key]')) {
    scrolls.set(el.dataset.scrollKey, { top: el.scrollTop, left: el.scrollLeft });
  }
  let focus = null;
  const a = document.activeElement;
  if (a && a !== document.body && root.contains(a) && a.id) {
    const isText = typeof a.selectionStart === 'number';
    focus = {
      id: a.id,
      start: isText ? a.selectionStart : null,
      end: isText ? a.selectionEnd : null,
      direction: isText ? a.selectionDirection : null,
      // 入力途中の文字（data-keep-value の入力欄だけ）
      keep: a.hasAttribute('data-keep-value') ? { value: a.value, rendered: a.defaultValue } : null,
    };
  }
  // フォーカスのない入力欄でも、入力途中の文字は保持する
  const kept = new Map();
  for (const el of root.querySelectorAll('[data-keep-value][id]')) {
    if (el.value !== el.defaultValue) kept.set(el.id, { value: el.value, rendered: el.defaultValue });
  }
  return { viewKey, scrolls, focus, kept, windowScroll: { x: window.scrollX, y: window.scrollY } };
}

// 再描画の直後に呼ぶ
export function restoreViewState(root, snap, viewKey) {
  if (!snap) return;
  for (const el of root.querySelectorAll('[data-scroll-key]')) {
    const s = snap.scrolls.get(el.dataset.scrollKey);
    if (s) {
      el.scrollTop = s.top;
      el.scrollLeft = s.left;
    }
  }
  // 同じ画面の再描画のときだけ、画面全体のスクロール位置を戻す（画面遷移では従来どおり）
  if (snap.viewKey === viewKey && (window.scrollX !== snap.windowScroll.x || window.scrollY !== snap.windowScroll.y)) {
    window.scrollTo(snap.windowScroll.x, snap.windowScroll.y);
  }
  // 入力途中の文字：再描画で状態から出された値が前回と同じ（＝状態は変わっていない）ときだけ戻す
  for (const [id, k] of snap.kept) {
    const el = root.querySelector(`#${CSS.escape(id)}`);
    if (el && el.hasAttribute('data-keep-value') && el.defaultValue === k.rendered) el.value = k.value;
  }
  const f = snap.focus;
  if (f) {
    const el = root.querySelector(`#${CSS.escape(f.id)}`);
    if (el) {
      el.focus({ preventScroll: true });
      if (f.start !== null && typeof el.setSelectionRange === 'function') {
        try {
          el.setSelectionRange(f.start, f.end, f.direction ?? 'none');
        } catch {
          // type="number" などカーソル位置を設定できない入力欄は何もしない
        }
      }
    }
  }
}
