# main × legacy 統合仕様（確定）

この文書は `legacy` の変更容易な構造の上に、`origin/main` の **本番観測可能な振る舞い** を載せるときの確定仕様である。  
ブランチ名の履歴比較ではなく、**今の main が満たすべき契約**として読む。

## 1. 採用方針

| 採用元 | 内容 |
|--------|------|
| **legacy** | ドメイン分割（`lib/domain` / `lib/application` / `composition`）、管理コンソールの設計、`bin/start`、Playwright 同梱 Chromium 既定 |
| **main** | 本番コメント本線（プロセス内ニコ生クライアント）、`POST`/`PUT /` のコメント受け口廃止（404）、関連運用スクリプト・e2e 契約 |
| **両方** | systemd / make、Basic auth、Biome、bootstrap による console 抑制 |

## 2. コメント投入（最重要）

`origin/main` の本番は次のとおり。

1. **本線**: 起動後に `NiconamaCommentClient` がニコ生からコメントを取り、`agent.postComments` へ渡す。  
2. **`POST /` / `PUT /` は 404**（外部 HTTP でのコメント列投入は廃止済み）。  
3. `routes/index.ts` に旧ハンドラが残っていても、**Hono 上で 404 が先**なので本番では使わない。

統合後の契約（確定）:

| 経路 | 仕様 |
|------|------|
| ニコ生クライアント | 必須の本番本線。`composition/niconamaCommentIngress` が遅延 start・リトライ・stop |
| `POST /` | **常に 404**（main と同じ） |
| `PUT /` | **常に 404**（main と同じ） |
| コメント反応の検証 | 単体・クライアント lifecycle・（任意）ライブ e2e。HTTP PUT に依存しない |

環境変数（main 互換 + 運用）:

| 変数 | 意味 |
|------|------|
| `NICONAMA_WATCH_URL` | 視聴 URL |
| `NICONAMA_USER_DATA_DIR` | Playwright プロファイル |
| `CHROMIUM_EXECUTABLE_PATH` | 任意。未設定なら同梱 Chromium |
| `NICONAMA_START_DELAY_MS` | 起動遅延（既定 350） |
| `NICONAMA_START_MAX_RETRIES` | リトライ回数。`<1` は起動しない（fatal にしない、CI 用） |
| `NICONAMA_DISABLE=1` | クライアント無効（ローカル・一部テスト） |
| `DEBUG_NICONAMA_COMMENTS=1` | コメント本文ログ |

## 3. 配信状態・公開

- 内部状態は `AgentSession` / サービス層（legacy）。  
- 公開は `assemblePublishedPayload`（legacy）。  
- ニコ生 meta は client の `onMeta` → 正規化・merge → ブロードキャスト。  
- `/api/meta` の GET/POST は維持（main も維持）。

## 4. 管理コンソール

- legacy の domain（access / plan / SSE）+ main 由来の Basic auth・パスワード永続化。  
- production: IP + Basic（user `admin`）。  
- loopback のみのときはパスワードファイルを作らない。

## 5. ブラウザ・Chromium

- 既定は Playwright **同梱**（legacy の修正を正とする）。  
- main の `/usr/bin/chromium` ハードコード既定は **採用しない**。  
- lock 掃除は Singleton* のみ。古い `playwright-*` 一時 dir は起動時掃除。

## 6. 起動・運用

| 項目 | 仕様 |
|------|------|
| 本番 start | `bootstrap.ts`（console 抑制）→ app |
| 手動 | `bin/start` / `bin/stop` あり |
| systemd | `make install` が `@PREFIX@` / `@BUN_BIN@` を置換 |
| 診断スクリプト | main の niconama 調査 scripts は運用用として復元可（アプリ必須ではない） |

## 7. テスト配置

- 単体: 実装の隣 `*.test.ts`  
- 統合: `tests/integration/`  
- e2e: `tests/e2e/`。ルート `POST`/`PUT` は **404 を期待**（main と同じ）。コメント経路は HTTP に依存しない。

## 8. 意図的に採用しない main 側

| 項目 | 理由 |
|------|------|
| God object 一枚岩の `index` 構造 | legacy の変更容易性を捨てる |
| system Chromium 既定 | クラッシュ多発の原因だった |
| 空の unit プレースホルダ | 無意味 |

## 9. 参照実装パス

| 関心 | パス |
|------|------|
| ニコ生配線 | `composition/niconamaCommentIngress.ts` |
| ニコ生本体 | `lib/niconamaCommentClient*.ts` |
| ルート 404 | `index.ts`（`POST`/`PUT /`） |
| 概要 | [overview.md](./overview.md) |
