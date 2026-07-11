# legacy vs main 取り込み整理

最終更新: 2026-07-11（`feat/port-main-ops-onto-legacy` / PR #466）

## 背景

- **`legacy`**: 運用上「動いていた」時点を基点に、ドメイン分割（`lib/domain` / `composition`）などを積んだ**稼働ブランチ**。
- **`main`**: 履歴が **orphan root**（親なしの `9911059`）から始まる **30 コミット**だけのブランチ。Git 上は `legacy` と**共通祖先が無く**、単純 `git merge` は不適切。
- ツリー上の main root は `0fec672`（別ブランチの deps 更新コミット）と同一。`legacy` 履歴にはそのツリーが存在しない。

### 数の目安

| 指標 | 値 |
|------|-----|
| `main` のみのコミット | 約 30 |
| `legacy` のみのコミット | 約 333 |
| tip 間 diff | 約 208 files / +19k / -7.8k |

## 構造上の最大差

| 領域 | `legacy` | `main` |
|------|----------|--------|
| ドメイン | `lib/domain/*`, `lib/application/*`, `composition/*` | ほぼ無し（モノリシック `index.ts` 等） |
| 設計文書 | `architecture/*` | 無し |
| ニコ生コメントクライアント | **無し**（HTTP でコメントを受ける構成） | `lib/niconamaCommentClient*.ts` 一式（巨大） |
| 起動 | `bin/start` / `bin/stop` | 削除済み。systemd 子サービスのみ |
| デプロイ | Makefile / `etc/systemd` **無し** | `Makefile` + 子 unit 一式 |
| フォーマッタ | 無し | Biome（大規模整形コミット含む） |
| Playwright | `^1.61.1` + bundled Chromium 方針 | `^1.60.0` 寄り |
| コンソール認証 | IP 制限（production） | IP + Basic auth + 起動時パスワード自動生成 |

**main が「うまく動かない」要因候補（推測）**

1. 巨大な niconama クライアント再編 + E2E/CI 周り
2. Biome 一括整形に伴う広い差分
3. 起動系を systemd 子サービスに寄せた結果、ローカル/`bin/start` 前提が壊れた
4. orphan 化により `legacy` 側で直した返信先コメント・ドメイン分割・ゲーム進行保持などが **main に無い**

## main 側コミットの分類（取り込み方針）

### A. 運用・インフラ（積極的に port）

| 元 | 内容 | 方針 |
|----|------|------|
| #419–#424, Makefile | systemd 子サービス、OBS 環境変数 | **legacy 向けに適応して取り込み**（`bin/start` は残す） |
| bin/xorg10, x11vnc-10, journal-makamujo | X/VNC/ログ | **取り込み** |
| bin/obs-studio | flatpak + XDG パス | **取り込み**（legacy の薄いラッパを置換） |

### B. 安定化バグフィックス（port）

| 元 | 内容 | 方針 |
|----|------|------|
| #425, #431 | Chromium lock 掃除 / 接続 retry | **`launchPersistentContext` に port** |
| #429 | upstream SSE 非 2xx を graceful 処理 | **routes/console に port** |
| #426 | Console Basic auth パスワード自動生成 | **ドメイン純関数 + outer server に port** |
| #430 | `[ERROR]`/`[WARN]` プレフィックス | 既に legacy 側で多く使用。必要箇所のみ |

### C. ランディング（port）

| 元 | 内容 | 方針 |
|----|------|------|
| #453, #454 | profile nav 縦並び、X event、adsense | **docs に port + テスト** |

### D. 追加で取り込んだもの（本 PR 追記）

| 元 | 内容 |
|----|------|
| #412 / #433 周辺 | Biome（`biome.json`, `@biomejs/biome`, `format`/`lint` scripts, 実 CI `lint`） |
| hooks / policy | `.githooks/*`, `scripts/install-git-hooks.sh`, `docs/IMPORT_POLICY.md`, `check-no-test-imports` |
| deps patch | hono `4.12.28`, tailwindcss `^4.3.2`, 型・react/tsx の patch 更新（Playwright は 1.61 維持） |

Biome は recommended を基に、legacy ツリーで一括リライトが必要なルール（`noExplicitAny` 等）は off にして CI 緑化。整形は `biome check --write` 済み。

### E. 意図的にまだ取り込まない

| 元 | 理由 |
|----|------|
| `lib/niconamaCommentClient*` 一式 | main 不安定の中核候補。legacy は HTTP 注入で動く。別 PR で要設計 |
| main の Playwright 下げ (`^1.60`) | legacy は bundled Chromium 方針で 1.61 を維持 |
| main の `index.ts` / console モノリス | legacy の domain 分割を捨てることになり本末転倒 |
| main で `bin/start` 削除 | legacy の手動起動・test:bin を壊す |

## 取り込み実施状況（本作業）

1. 本ドキュメント
2. systemd + Makefile + X/VNC/journal/obs-studio ラッパ
3. Chromium lock cleanup + transient retry
4. Console Basic auth 生成・検証（`lib/domain/console/access`）
5. SSE `res.ok` ガード
6. docs ランディング更新 + `docs/index.test.ts`
7. Biome + githooks + IMPORT_POLICY + deps patch（main ツールチェーン）

## マージ時の運用注意（PR #466）

この PR を `main` に入れると **orphan `main` のツリーは稼働 `legacy` 系に置き換わる**。

| 項目 | 内容 |
|------|------|
| コメント | **組み込み niconama クライアントは無い**。HTTP で配信プロセスへコメントを投入する構成を前提にする |
| コンソール auth | production は IP + Basic（user `admin`）。`CONSOLE_BASIC_AUTH_PASSWORD` 固定を推奨。未設定時は `var/console-basic-auth-password` に永続化して再起動で再利用 |
| デプロイ | `sudo make install PREFIX=... BUN_BIN=...`。unit の `@PREFIX@` / `@BUN_BIN@` は install 時に置換 |
| Biome | 導入済み。一括 `noExplicitAny` 等は未強制（段階的に強化する） |
| Chromium | ProcessSingleton 用に lock ファイルのみ掃除（`.ssh` は削除しない）。temp profile は成功時セッション用に残る |

## レビュー指摘への対応（Low 以上）

| 指摘 | 対応 |
|------|------|
| PR が main 置き換えである | 本節・PR 本文で明記 |
| Basic auth が毎回変わる | ファイル永続化 + env 優先 |
| Chromium が `.ssh` を消す | lock ファイルのみに限定 |
| temp dir リーク | 失敗時は削除（成功時は profile 利用のため保持） |
| Biome ゲートが緩い | `format` を `biome format` に分離（`\|\| true` 撤去）。lint ルールは段階的強化 |
| systemd パス固定 | `@PREFIX@` / `@BUN_BIN@` を make で置換 |
| Basic auth テスト薄い | domain + integration に 401/認可テスト追加 |
| CI actions 版 | checkout@v7 / cache@v6 |
| browser CLI 未使用 | `file` / `lang` を env とログに反映 |

## 推奨ワークフロー（今後）

1. **ベースは常に稼働線（旧 legacy / 本 PR 後の main）**
2. 欠落機能（niconama クライアント等）は **domain 契約に沿って別 PR**
3. 動作確認: `bun run typecheck` → `bun run lint` → `bun run test` → `bun run test:integration`
4. Biome の `noExplicitAny` 等を段階的に on にする

## 関連

- [domain-model-redesign.md](./domain-model-redesign.md)
- [console-domain-model.md](./console-domain-model.md)

