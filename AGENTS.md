# AGENTS.md

## 目的
このファイルはAIエージェント専用の指示書です。
あなたが作業を始める前に参照し、正確に作業できるようにプロジェクトのコンテキストやルールを提供します。

## プロジェクト構造
- `/bin` - 実行可能ファイル
- `/console` - 配信管理コンソールアプリ（別プロジェクト）
- `/lib` - アプリから利用するライブラリ
- `/routes` - 配信画面アプリが持つAPIコントローラー
- `/scripts` - 小物スクリプト
- `/src` - 配信画面アプリのフロントエンド（React）
- `/tests` - テストコード（単体テストを除く）

その他のディレクトリは人間向けで、あなたが参照する必要はありません。

## 利用できるコマンド
このプロジェクトはBunを利用しています。
- 依存関係のインストール: `bun install`
- 開発サーバー起動: `bun run dev`
- テスト実行: `bun run test`
- E2Eテスト実行: `bun run test:e2e`

その他、package.jsonのscriptsに書かれているスクリプトが実行できます。

## Agent実行時の注意点
- `bun` 実行で詰まるケースが多いため、作業開始時に `bun --version` で利用可否を確認する
  - `bun` が使えない場合は実行を繰り返さず、まず原因（環境初期化不足）を解消する
- 依存関係未インストールで `bun run test` に進まないよう、最初に `bun ci`（lockfile準拠で更新せず、CIと同じ手順）を実行する
- スクリーンショットを撮る前に日本語フォントをインストールする（例: `sudo apt-get update && sudo apt-get install -y fonts-noto-cjk`）
- スクリプトを実行して得られた成果物（スクリーンショットなど）はリポジトリにコミットしない
- スクリーンショットはGitHubにアップロードしてURLを取得し、PRのDescription（本文）にGFM画像記法（`![代替テキスト](URL)`）で埋め込む。変更する場合は古い画像を新しいURLで置き換える
  - GitHubへのアップロードは、PRのDescription編集欄やコメント欄の添付ファイル機能（ドラッグ＆ドロップまたはファイル選択）を使う
- 配信状態を取得できない環境で管理コンソールのスクリーンショットを撮る場合は、`/console/?agentStateMock=1` を利用してモック表示する
- OCRでスクリーンショット確認する場合は、次の順で再現する
  1. `bun run screenshot:console-agent-status --output /tmp/makamujo/console-agent-status-mock.png`
  2. `bun run screenshot:annotate-ocr --input /tmp/makamujo/console-agent-status-mock.png --output /tmp/makamujo/console-agent-status-mock-annotated.png`
  3. OCR結果に `馬可無序` / `配信エージェント状態モックを表示中` / `配信エージェント状態モック` が含まれることを確認する
  - `screenshot:annotate-ocr` 実行に `tesseract` と `convert`（ImageMagick）が必要。Debian/Ubuntu系では `sudo apt-get install -y tesseract-ocr tesseract-ocr-jpn imagemagick` でインストール可能
- 検証コマンドは次の順で実行する
  1. `bun run typecheck`
  2. `bun run test`
  3. `bun run test:integration`
- 作業完了は、CIのcheckがすべて通っていることを確認して判断する
- シェルスクリプトの挙動確認が必要な変更では `bun run test:bin` も実行する

## コーディングスタイル
- TypeScript strict モードを使用
- 変数宣言は常に `const` を使用
- React は関数コンポーネント優先
- 識別子の名称は、それを見ただけで意味が十分に理解できるように、なるべく具体的に付けます
- 識別子の最初の単語はその性質によって以下の品詞の単語で始めること
  - 関数・メソッド: 動詞
  - 変数: 名詞句
- Use only `as const` or `satisfies T` for narrowing types

## バージョン管理
- コミットメッセージは Conventional Commit 形式

## テストガイドライン
- 新規に作成する関数には必ず単体テストを作成
  - exportしない関数にはテストを書かなくて構いません
- テストフレームワークはBun（Jest互換）
- コミット前に必ずテストを実行し、すべて成功すること
- テストファイルの配置
  - ユニットテスト: 実装ファイルと同階層に `.test.{ts,tsx}`
  - 統合テスト: `/tests/integration`ディレクトリ
  - E2Eテスト: `/tests/e2e`ディレクトリ

## 開発ワークフロー
- `main`ブランチから機能ブランチを作成
- プルリクエストでコードレビュー
- 新規機能にはドキュメント(JSDoc)を更新
