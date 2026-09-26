# AGENTS.md

このファイルはAIエージェント専用の指示書です。作業前に一読し、コマンドや契約に従ってください。

## 実行環境
- Bun プロジェクト。作業開始時に `bun --version` で利用可否を確認する。使えない場合は実行を繰り返さず、原因（環境初期化不足）を解消してから進める。
- 依存関係は lockfile 準拠の `bun ci` で導入する（`bun install` は lockfile を更新しうるため基本使わない）。
- 環境初期化は `bun run setup`（`bun --version && bun ci && bun run typecheck`）でも可。

## コマンド
| コマンド | 内容 |
|---|---|
| `bun run dev` | 開発サーバー: `bun --hot index.ts --port=8777` |
| `bun run start` | 本番: `NODE_ENV=production bun index.ts --port=7777`（POSIX シェル必需） |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | Biome（`--error-on-warnings .`） |
| `bun run format` | Biome 自動修正（`--write .`） |
| `bun run test` | 単体テスト（lib/src/routes/console/src など）。単発は `bun test <path>` |
| `bun run test:integration` | `bun test tests/integration/` |
| `bun run test:bin` | `tests/bin/*.sh` のシェルテスト（bash 必需） |
| `bun run test:e2e` | Playwright E2E（要 `pretest:e2e`、HTTPS 443） |

その他スクリプト（`browser` / `generate-ogp` / `screenshot:console-agent-status` / `markov` 等）は `package.json` 参照。

### 動作確認の順序
1. `bun run lint`
2. `bun run typecheck`
3. `bun run test`
4. `bun run test:integration`

シェルスクリプト変更は `bun run test:bin`、UI 変更は `bun run test:e2e` も追加する。作業完了はすべてこの確認が通った時点。

### git hooks
- `.githooks/` に pre-commit（`bun run format`）と pre-push（typecheck / unit / integration / e2e）がある。
- ただし `core.hooksPath` は devcontainer 用のパス（`/workspaces/makamujo/.githooks`）に設定されており、手元の環境では hooks が走らないことがある。**チェックは明示的に手動実行する**こと。

## 技術構成（変更前に把握すること）
- サーバーは **Hono + Bun**。単一入口 `index.ts` が配信画面（`routes/`、`src/`）と管理コンソール（`console/`）の両方を serve し、`composition/` が broadcast / agent 配線 / idle speech timer を組み立てる。
- **フロントエンドは React ではない**。`package.json` の `imports` が `react` → `hono/jsx/dom` に、`tsconfig.json` の `jsxImportSource` が `"hono/jsx"` にリマップされている。DOM JSX は関数コンポーネントで書く。
- `automated-gameplay-transmitter` は **npm 依存**（`^0.6.4`）。ソースを改変するなら隣接リポジトリ `~/ghq/github.com/nahcnuj/automated-gameplay-transmitter` を見る。
- ディレクトリ:
  - `lib/domain/**` — 純関数ポリシー / `lib/application/` — アプリ層（例: SpeechQueue） / `lib/Agent/` — 配信エージェント
  - `architecture/` — 設計・契約ドキュメント（索引: `architecture/README.md`）。`docs/` はランディング用静的資産専用で、設計 Markdown はここに置かない
- ドメイン再設計・`MakaMujo` 分割・配信状態ペイロード変更では、先に `architecture/domain-model-redesign.md` の契約（CommentPipeline・沈黙ポリシー・PublishedStreamPayload）を確認し、観測可能な振る舞いを変えないこと。
- 番組情報（視聴者数 / コメント数 / ニコニ広告 / ギフト）は **わんコメではなく番組配信ページ**から読む。`NICONAMA_WATCH_PAGE_URL` が無ければ poller は起動せず、`POST /api/meta` の `niconama` へフォールバックする。

## テスト
- 新規に作成する公開関数には必ず単体テストを作成する。
- テストフレームワークは Bun（`bun:test`、Jest 互換）。`bunfig.toml` で coverage が常時有効（`bun test` はカバレッジ計測つきで若干遅い）。
- 配置: 単体テストは実装と同階層 `*.test.{ts,tsx}` / 統合 `tests/integration/` / E2E `tests/e2e/` / シェル `tests/bin/`。

## コーディングスタイル
- TypeScript strict モード、`noUncheckedIndexedAccess` 有効（配列・レコードの添字アクセスは `undefined` になり得る）。
- 変数宣言は常に `const`。
- 識別子は具体的に付ける。関数・メソッドは動詞始まり、変数は名詞句始まり。
- 型の絞り込みは `as const` / `satisfies T` のみ。`as any as ...` のような二重キャストは禁止。
- コミットメッセージは Conventional Commits。機能ブランチは `main` から、PR でレビュー。
- Biome は `*.test.ts` の linter のみ無効（formatter は有効）。整形は `bun run format` に任せる。

## 環境・運用手順の注意
- Windows では POSIX 表記のスクリプト（`NODE_ENV=...`、bash 呼び出し）がそのまま動かない。WSL / Git Bash を使うか互換性を確認する。
- E2E は HTTPS（ポート 443）を要求し、`pretest:e2e` で Chromium を導入する（CI では `scripts/setup-e2e-tls.sh` も実行）。Playwright 設定は `workers: 1`。
- 生成物（`var/` のログ・TLS、`test-results/`、スクリーンショット）はコミットしない。
- 配信状態を取得できない環境でコンソールのスクリーンショットを撮るには `/console/?agentStateMock=1`（モック表示）を使う。コンソール単体は `CONSOLE_LOOPBACK_ONLY=1 bun index.ts --port=7777` で起動できる。
- スクリーンショットを PR に載せる場合は GitHub の添付機能でアップロードし、GFM 画像記法（`![代替テキスト](URL)`）で Description に埋め込む。貼る前に URL を開いて HTTP エラー（404/403/500）が出ないことと内容表示を確認する。