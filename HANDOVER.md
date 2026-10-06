# PageFlow 引き継ぎ（v0.1 人間受入PASS時点）

次のセッションは、このファイルとリポジトリの現在状態だけで再開できる。会話履歴には依存しない。

## 現在の状態

- ブランチ: `main`（`feature/structure-v2` は main にマージ済み）
- Production: Cloudflare Pages（プロジェクト `pageflow`）、コミット `fc54aeb`。デプロイ完了
- 公開URL: https://pageflow-dyu.pages.dev（Basic認証で保護）
- 段階6Aの判定: PASS（自動テスト）。**PageFlow v0.1 人間受入テスト: PASS（iPhone実機、下記）**
- 公開環境の受入確認: 完了（PC・iPhone実機。下記「公開環境の確認結果」参照）
- 再開時は先に `git status` / `git log --oneline -3` で状態を確認する

## 完了済み工程

| 段階 | 内容 |
|---|---|
| 0〜2 | 構造の再設計（3カラムの構成画面、標準構成 presetKey、Contentの登録・配置など。詳細は `git log`） |
| 3 | PDF素材モデル。PDFAsset／RenderImage、右カラムのPDF素材管理、素材をページへ割り当て |
| 4 | Content識別色、中央ページのD&Dをページswapとして実装 |
| 5 | 中央ビューのズーム（40〜200%）、倍率表示、全体表示、一覧／見開き切替（本書の「段階5」参照） |
| 5b | 冊子プレビュー仕上げ（綴じ辺ガイド、PC左右ナビ／〜1023px下部ナビ） |
| 6A | 最終QA・全体回帰（結果は「段階6Aの結果」参照） |

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

- **段階6B: ドキュメント整理**（README／利用マニュアル／要件・基本設計書。6Aでは未着手）

## テスト・確認

- 単体テスト: `npm test`（245件。段階6A時点で全成功）
- ビルド: `npx vite build`
- 実ブラウザテスト（Playwright + Edge）のスクリプトはリポジトリに入っていない。前セッションの一時フォルダにあるため、再利用できない場合は必要に応じて作り直す
  - 段階5の確認結果: 一覧／見開き／ズーム／全体表示／D&D（Content・swap・PDF素材）／識別色／再描画後の維持／冊子切替時のリセット／390px幅、すべて失敗0
  - 回帰（s0・s2〜s4・sT・e2e系）失敗0。旧形式データの検証（s1・s2legacy）は旧版アプリでのシードが必要で、今回は再現できなかった。永続化処理は変更していないが、段階6の全回帰で確認する
  - 長時間使った同一ブラウザで、390幅への切替時にタブがクラッシュする事象があった。新しいブラウザでは再現せず、テスト環境側の問題と判断（アプリ起因の兆候なし）。段階6で再確認する

- 段階5bの実ブラウザ確認（Playwright+Edge、順次実行）: 33項目すべて成功、コンソールエラー0。1280/1024/900/640/390px、P1・見開き中間・最終P8の綴じ辺、ノド位置、画像比率、ナビ位置不変、キー、スワイプ、情報ON/OFF、.pageflowビューア、編集側プレビューを確認。スクリプトは一時フォルダのためリポジトリには無い（複数ブラウザコンテキストを同時に開くと .pageflow 読み込みが固まる事象あり。1つずつ閉じて順次実行すること）

## 段階6Aの結果（最終QA・全体回帰）

- 単体 245/245、`vite build` 成功。ブラウザ回帰（Playwright+Edge、**1系統ずつ順次実行**、スクリプトは一時フォルダでリポジトリには無い）:
  - Structure（冊子・Content・D&D・swap・識別色・ズーム・一覧/見開き・総ページ数増減）: 44/44
  - PDF（A4複数・A3左右分割・手動/順番割り当て・置換・削除・要求ページ減少・エラーPDF・各段階の不変条件検査）: 52/52
  - Preview・面付・.pageflow・レスポンシブ（1280/1024/900/700/640/390px、キー、スワイプ、赤線、凡例、画像比率、8/12/16P面付、export/import、formatVersion 1、画像は割り当て済みのみ、元PDF・編集状態なし）: 98/98
  - 旧形式データ互換: 20/20（下記）
- 発見・修正した不具合（1件）: PCの見開きモードで P1／最終P単独のとき、綴じ辺の赤線が画像の端ではなく表示枠の端に浮いていた。`.viewer-pages` をページ幅に収める（`width: fit-content; margin-inline: auto`）CSS 3行で修正。見開き中央・390px単ページへの影響なし（再回帰済み）
- s1／s2legacy の結論: 旧版アプリは現在のリポジトリから再現可能（`git archive` で旧コミットをビルド）。s1相当=`main`(3f9a455、固定ページ時代)、s2legacy相当=`fa6c954`(段階2、colorIndex無し)をビルドして永続プロファイルに旧データ（本文3P+PDF、表紙PDF）を作り、現行ビルドで同じプロファイルを開いて確認した。結果: 冊子表示、配置、既存のPDF割り当て（画像ありページ P1,P5〜P7）が維持され、開く・各タブ閲覧・.pageflow書き出しだけではDBが一切書き換わらず、不変条件も満たす。冊子名変更で保存すると、s1のみ `contents` が正規化されて更新される（固定ページ→標準構成のpresetKey付与。仕様どおり）。画像・割り当ては不変。段階5での失敗は並列実行負荷か旧版環境の再現条件によるテスト環境側の問題と判断
- 前回の「390幅切替でタブがクラッシュ」は、順次実行・新規ブラウザでは再現せず（アプリ起因の兆候なし）
- 機密情報チェック: 追跡ファイル64件に実在の顧客名・メール・ローカルパス・APIキー・実PDFなし。PDFは合成フィクスチャのみ（`tests/fixtures`。"secret" は合成パスワードPDFの値）
- 残存リスク:
  - 旧版の中間コミット（段階3・4時点）のデータは未検証（main と 段階2 は検証済み。配布されたのは main のみ）
  - 実機（実iPhone/Android）のスワイプ・タッチD&Dと、実運用規模（大容量PDF・多ページ）は自動テスト対象外。受入テストで確認する
  - E2Eスクリプトがリポジトリに無いため、再実行には作り直しが必要

## スマートフォン見開き対応と実機受入結果（v0.1 人間受入）

- 変更: スマホ幅（〜639px）でも1ページ表示へ切り替えず、見開き構成（P1単独｜P2左・P3右｜…）を縮小して画面幅に収める。`app.js` の自動 single 切替を廃止し、`style.css` に〜639px用の見開きサイズ指定を追加
- iPhone実機での最終確認（ユーザー実施）: 全項目OK
  - .pageflow の読み込み／P1単独表示／P2左｜P3右の見開き／以降の見開き／前へ・次へボタン／左右スワイプ／赤い綴じ辺表示／表示崩れ・横スクロールなし
- 判定: **PageFlow v0.1 人間受入テスト PASS**
- 残存リスク「実機のスワイプ確認」は解消。大容量PDF・多ページの実運用規模は引き続き運用で確認

## 公開環境の確認結果（Cloudflare Pages）

- Production: ブランチ `main`、コミット `fc54aeb`（Dashboardで目視確認）
- Basic認証: `functions/_middleware.js`。`BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` を Production の Secret に登録済み。登録後に再デプロイ済み
  - Secret未設定時は 503（fail-closed）。`/robots.txt` のみ認証対象外（`User-agent: *` / `Disallow: /`）
- 本番確認: 未認証で401とBasic認証ダイアログ、正しい認証情報でPageFlow正常表示、`/robots.txt` は認証なしで表示。PC（シークレットウィンドウ）・iPhone実機とも問題なし
- 提出時もBasic認証は外さない。評価者への認証情報は、公開リポジトリとは別経路で共有する（実値はREADME・HANDOVER・Git履歴に残さない）

## Git運用ルール

- 作業は `main`。pushはユーザーの指示があってから
- force push、Cloudflare Pages への本番デプロイは、ユーザーの明示指示なしに行わない
- stash・WIPコミット・別ブランチでの退避はしない（復帰地点は push 済みコミット）

## 機密情報

- 公開リポジトリに、実在の顧客名・案件名・認証情報・個人情報・社外秘のPDFを含めない
- テスト用のPDF・冊子名は架空のものだけを使う（`tests/fixtures` 参照）
