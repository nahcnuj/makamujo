# legacy vs main 取り込み整理

最終更新: 2026-07-11（`legacy` 上での取り込み作業）

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

### D. 意図的にまだ取り込まない

| 元 | 理由 |
|----|------|
| `lib/niconamaCommentClient*` 一式 | main 不安定の中核候補。legacy は HTTP 注入で動く。別 PR で要設計 |
| Biome 一括 (#412, #433) | 差分が巨大でレビュー不能。必要なら独立タスク |
| main 側 deps の全面追従 | hono/playwright の下げ上げを含む。動作確認後に段階的に |
| main の `index.ts` / console モノリス | legacy の domain 分割を捨てることになり本末転倒 |
| main で `bin/start` 削除 | legacy の手動起動・test:bin を壊す |

## 取り込み実施状況（本作業）

1. 本ドキュメント
2. systemd + Makefile + X/VNC/journal/obs-studio ラッパ
3. Chromium lock cleanup + transient retry
4. Console Basic auth 生成・検証（`lib/domain/console/access`）
5. SSE `res.ok` ガード
6. docs ランディング更新 + `docs/index.test.ts`

## 推奨ワークフロー（今後）

1. **ベースは常に `legacy`**
2. main から欲しい変更は **パッチ単位で port**（cherry-pick は SHA 無関係のため不可に近い）
3. niconama クライアントを戻す場合は、先に `architecture/domain-model-redesign.md` の契約に沿った差し込み設計を書く
4. 動作確認: `bun run typecheck` → `bun run test` → `bun run test:integration`
5. 将来 `main` をレガシー履歴に戻すなら、orphan を捨てて `legacy` を `main` に fast-forward / force する運用を検討（要合意）

## 関連

- [domain-model-redesign.md](./domain-model-redesign.md)
- [console-domain-model.md](./console-domain-model.md)
