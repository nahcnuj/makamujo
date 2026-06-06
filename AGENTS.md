# AGENTS.md

## Copilot instructions
This file serves as the primary repository-specific instruction source for GitHub Copilot and related agents.
Do not modify `.github/copilot-instructions.md`; keep that reference file unchanged and maintain any existing symlink behavior.

### Required checks before commit
- `bun run typecheck`
- `bun run test`
- `bun run test:integration`
- `bun run test:e2e`
- If a pre-push hook runs and fails, inspect the hook execution log to understand the failure.

> Note: This repository does not currently define a `test:unit` npm script in `package.json`.
> The CI uses `bun run test` as the unit test suite.

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
- 単一のテストファイルを実行: `bun test path/to/file.test.ts`
- 単一の E2E テストを実行: `bun run test:e2e tests/e2e/your-test-file.test.ts`
- TypeScriptスクリプトを実行: `bun ./path/to/script.ts`

その他、package.jsonのscriptsに書かれているスクリプトが実行できます。

## Agent実行時の注意点
- `bun` 実行で詰まるケースが多いため、作業開始時に `bun --version` で利用可否を確認する
  - `bun` が使えない場合は実行を繰り返さず、まず原因（環境初期化不足）を解消する
- 依存関係未インストールで `bun run test` に進まないよう、最初に `bun ci`（lockfile準拠で更新せず、CIと同じ手順）を実行する
- スクリーンショットを撮る前に日本語フォントをインストールする（例: `sudo apt-get update && sudo apt-get install -y fonts-noto-cjk`）
- スクリプトを実行して得られた成果物（スクリーンショットなど）はリポジトリにコミットしない
- スクリーンショットはGitHubにアップロードしてURLを取得し、PRのDescription（本文）にGFM画像記法（`![代替テキスト](URL)`）で埋め込む。変更する場合は古い画像を新しいURLで置き換える
  - GitHubへのアップロードは、PRのDescription編集欄やコメント欄の添付ファイル機能（ドラッグ＆ドロップまたはファイル選択）を使う
  - 作業完了前に、貼り付けた画像URLを必ず取得して開き、HTTPエラー（404/403/500 など）が出ないことと画像内容が想定どおり表示されることを確認する
  - 貼り付けた画像URLをOCR確認する場合は、次を実行して想定文言が検出されることを確認する
    1. `mkdir -p /tmp/makamujo`
    2. `TIMESTAMP=$(date +%Y%m%d%H%M%S)` で実値を作り、同じ `TIMESTAMP` を後続手順で使い回す
    3. `BASE_NAME="console-agent-status-from-url-${TIMESTAMP}"`
    4. `curl -fsSL "https://github.com/user-attachments/files/{ATTACHMENT_ID}/{UPLOADED_FILENAME}" -o "/tmp/makamujo/${BASE_NAME}.png"`（`{ATTACHMENT_ID}` と `{UPLOADED_FILENAME}` は実際の値に置き換える）
    5. `bun run screenshot:annotate-ocr --input "/tmp/makamujo/${BASE_NAME}.png" --output "/tmp/makamujo/${BASE_NAME}-annotated.png"`
    6. OCR結果に `馬可無序` / `配信エージェント状態モックを表示中` / `配信エージェント状態モック` が含まれることを確認する
- 配信状態を取得できない環境で管理コンソールのスクリーンショットを撮る場合は、`/console/?agentStateMock=1` を利用してモック表示する
- OCRでスクリーンショット確認する場合は、次の順で再現する
  1. `bun run screenshot:console-agent-status --output /tmp/makamujo/console-agent-status-mock.png`
  2. `bun run screenshot:annotate-ocr --input /tmp/makamujo/console-agent-status-mock.png --output /tmp/makamujo/console-agent-status-mock-annotated.png`
  3. OCR結果に `馬可無序` / `配信エージェント状態モックを表示中` / `配信エージェント状態モック` が含まれることを確認する
  - `screenshot:annotate-ocr` 実行に `tesseract` と `convert`（ImageMagick）が必要。Debian/Ubuntu系では `sudo apt-get install -y tesseract-ocr tesseract-ocr-jpn imagemagick` でインストール可能
- 動作確認は次の順に実行する
  1. `bun run typecheck`
  2. `bun run test`
  3. `bun run test:integration`
- 作業完了はすべての動作確認が正常終了したことによって判断する
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
  - OK: `{ x: 'y' } as const`
  - OK: ` 'xyz' satisfies ``x${string}`` `
  - NG: `JSON.parse(x) as any as { x: string }`

## バージョン管理
- コミットメッセージは Conventional Commit 形式

## テストガイドライン
- 新規に作成する公開関数には必ず単体テストを作成する
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

## エージェントの禁止事項
- **Git `--no-verify` の禁止:** Copilot や自動化エージェントは、`git commit` および `git push` に `--no-verify` を付与してフックを回避することを禁止します。エージェントがコミットやプッシュを行う際は、必ずフックを通すようにしてください。
- **承認が必要な場合:** フックを無効化する必要がある正当な理由がある場合は、人間のレビュアーを指名して明示的な承認を得た上で、手動で操作してください。エージェントが自動的にフラグを付与することは許可されません。


## 補足: マルチルートワークスペースとWindows環境
- このリポジトリはマルチルートワークスペースで開かれている場合があります。主要なフォルダ:
  - `makamujo/` — 配信管理アプリ（このファイルのプロジェクト）
  - `automated-gameplay-transmitter/` — ライブラリ兼サブプロジェクト。エージェントは [automated-gameplay-transmitter/package.json](automated-gameplay-transmitter/package.json) を参照してビルド/公開スクリプト（`bun run build.ts` 等）を確認してください。
- Windows上での注意:
  - package.json の一部スクリプトは POSIX シェル構文（例: `NODE_ENV=production ...` や `bash` を直接呼ぶもの）を前提としています。PowerShell や cmd.exe では動作しないことがあるため、WSL もしくは Git Bash を使用するか、スクリプト実行前に互換性を確認してください。
  - `test:bin` や `pretest:e2e` などはシェル依存です。Windowsで実行する必要がある場合は WSL/Git Bash を使うか、CI 環境での実行を検討してください。
