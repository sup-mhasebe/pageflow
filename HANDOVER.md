# PageFlow 引き継ぎ（段階5b完了時点）

次のセッションは、このファイルとリポジトリの現在状態だけで再開できる。会話履歴には依存しない。

## 現在の状態

- ブランチ: `feature/structure-v2`
- 段階5b実装コミット: HEAD（**未push**）
- 段階5コミット `617b729` と HANDOVER.md コミット `eba2c73` は push 済み（`origin/feature/structure-v2` = `eba2c73`）
- main の基準: `3f9a455`（`origin/main` も同じ。mainは変更しない）
- 再開時は先に `git status` / `git log --oneline -3` で状態を確認する

## 完了済み工程

| 段階 | 内容 |
|---|---|
| 0〜2 | 構造の再設計（3カラムの構成画面、標準構成 presetKey、Contentの登録・配置など。詳細は `git log`） |
| 3 | PDF素材モデル。PDFAsset／RenderImage、右カラムのPDF素材管理、素材をページへ割り当て |
| 4 | Content識別色、中央ページのD&Dをページswapとして実装 |
| 5 | 中央ビューのズーム（40〜200%）、倍率表示、全体表示、一覧／見開き切替（本書の「段階5」参照） |
| 5b | 冊子プレビュー仕上げ（綴じ辺ガイド、PC左右ナビ／〜1023px下部ナビ） |

### 段階5bで入ったもの

- 綴じ辺ガイド（左綴じ）: `src/js/ui/viewer.js` の `renderViewer` が `<span class="viewer-spine" data-spine="left|right|center">` を重ねる（約2px、`#b5484a`、画像寸法に影響しない）
  - 見開き=中央1本、単ページ=奇数左辺／偶数右辺（P1左、最終Pn右）。ページ情報ON/OFFと独立に常時表示。説明「赤線：綴じ辺（左綴じ）」はON時のみ
  - `.pageflow` ビューアも同じ `renderViewer` を共有（formatVersion・manifest仕様は変更なし）
- ページ送り: 1024px以上は左右固定ナビ（`.viewer-layout` のグリッド列幅固定で、単ページ／見開きでも位置不変）。1023px以下とスマホは下部ナビ。位置表示は上部バー。キー・スワイプは従来どおり
- 見開き／1ページの切替しきい値は従来どおり 639px（640〜1023pxは見開き＋下部ナビ）

### 段階5で入ったもの

- `src/js/domain/compose-view.js`: 倍率・全体表示・見開き行の純粋関数（`fitZoom`、`spreadRows` ほか）
- `src/js/store.js`: `state.composeView = { mode: 'list'|'spread', zoom }`。画面上の一時状態で、冊子データには保存しない
  - 別の冊子を開く（`openBooklet`）と、一覧・100%に戻す
- `src/js/ui/compose.js`: ページカードを `renderPageCard` に共通化（一覧・見開きで同じカード）。`<ul>/<li>` は `<div data-page-wrap>` に変更済み
- `src/js/app.js`: `compose-mode`／`zoom-in`／`zoom-out`／`zoom-fit` の各アクション
- 見開き（左綴じ）: P1は右ページ単独、P2左｜P3右、P4左｜P5右…、最終が偶数ページなら左ページ単独。空白側は物理ページではないためドロップ先にしない

## 主要データモデルと不変条件

保存先は IndexedDB。型は `src/js/schemas.js`（zod）。

- Booklet: `id` / `name` / `totalPages`
- Content: `id` / `name` / `requiredPages` / `presetKey?`（標準構成のみ）/ `colorIndex?`
- Page: `physicalPageNumber` / `contentId` / `contentPageIndex` / `pdfAssetId` / `renderImageId`
- PDFAsset: `contentId` に紐づく。`pageCount` はA3分割後（A4換算）のページ数
- RenderImage: `pdfAssetId` / `sourcePdfPage` / `splitSide`（none|left|right）

不変条件:

- Content は連続したページに配置される（`requiredPages` 分、`contentPageIndex` は 0 始まりで連続）
- ページの `renderImageId` / `pdfAssetId` は、そのページの Content の素材だけを指す（別Contentの素材は割り当てない）
- 一覧・見開き・面付・ビューアは、同じ RenderImage を共通利用する
- 表示設定（composeView）は冊子データを変更しない
- 識別色: `presetKey` を持つ標準構成はグレー。通常Contentは淡い8色を `colorIndex` で安定割り当て。左Contentカードと中央ページで同じ色
- 色はページ枠・背景・ラベルで示し、PDF画像には色を重ねない

## D&Dルール（一覧・見開きで共通）

- Contentの全体移動: 左のContentカードから、中央のページへドロップ
- 中央ページ同士: **ページswap**
  - 同一Content内のページ入れ替え可
  - 1P Content同士の入れ替え可
  - 1P Content と空きページの移動可
  - Contentの連続性を壊すswapは拒否し、何も変更せず理由を警告する（別の空きページへも動かさない）
  - swap時は Content・`contentPageIndex`・`renderImageId`・`pdfAssetId` の整合性を維持する
- PDF素材: 右カラムの素材を、そのContentのページへドロップして割り当て。他Contentのページへは拒否
- ドロップ可否は枠色で事前表示（緑=可／赤=不可）

## 未実装の工程

- **段階6: 最終回帰・ドキュメント**（全系統回帰、README／ドキュメント整備。mainへのマージ判断はこの後）
- ※ 段階5・5bは完了済み。残りは上記のみ

## テスト・確認

- 単体テスト: `npm test`（245件。段階5b時点で全成功）
- ビルド: `npx vite build`
- 実ブラウザテスト（Playwright + Edge）のスクリプトはリポジトリに入っていない。前セッションの一時フォルダにあるため、再利用できない場合は必要に応じて作り直す
  - 段階5の確認結果: 一覧／見開き／ズーム／全体表示／D&D（Content・swap・PDF素材）／識別色／再描画後の維持／冊子切替時のリセット／390px幅、すべて失敗0
  - 回帰（s0・s2〜s4・sT・e2e系）失敗0。旧形式データの検証（s1・s2legacy）は旧版アプリでのシードが必要で、今回は再現できなかった。永続化処理は変更していないが、段階6の全回帰で確認する
  - 長時間使った同一ブラウザで、390幅への切替時にタブがクラッシュする事象があった。新しいブラウザでは再現せず、テスト環境側の問題と判断（アプリ起因の兆候なし）。段階6で再確認する

- 段階5bの実ブラウザ確認（Playwright+Edge、順次実行）: 33項目すべて成功、コンソールエラー0。1280/1024/900/640/390px、P1・見開き中間・最終P8の綴じ辺、ノド位置、画像比率、ナビ位置不変、キー、スワイプ、情報ON/OFF、.pageflowビューア、編集側プレビューを確認。スクリプトは一時フォルダのためリポジトリには無い（複数ブラウザコンテキストを同時に開くと .pageflow 読み込みが固まる事象あり。1つずつ閉じて順次実行すること）

## Git運用ルール

- 作業ブランチは `feature/structure-v2`。工程ごとにコミットし、pushはユーザーの指示があってから
- **push待ち: 段階5bコミット（HEAD）**
- main へのマージ、force push、Cloudflare Pages への本番デプロイは、ユーザーの明示指示なしに行わない
- stash・WIPコミット・別ブランチでの退避はしない（復帰地点は push 済みコミット）

## 機密情報

- 公開リポジトリに、実在の顧客名・案件名・認証情報・個人情報・社外秘のPDFを含めない
- テスト用のPDF・冊子名は架空のものだけを使う（`tests/fixtures` 参照）
