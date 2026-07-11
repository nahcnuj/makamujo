# architecture/

馬可無序（makamujo）のエンジニアリング向け設計・契約ドキュメント置き場。

既存の [`docs/`](../docs/) はランディングページ用の静的資産専用である。ここに Markdown の設計文書を混ぜない。

## 文書一覧

| ファイル | 内容 |
|----------|------|
| [domain-model-redesign.md](./domain-model-redesign.md) | 配信エージェント BC 再設計（#463 マージ済）。CommentPipeline / silence / Publication |
| [console-domain-model.md](./console-domain-model.md) | **管理コンソール BC**（Access / Status plan）。UI は `console/src`、純関数は `lib/domain/console` |
| [legacy-vs-main-integration.md](./legacy-vs-main-integration.md) | **`legacy` vs `main` 差分整理と取り込み方針**（orphan main、port 済み/未着手） |

## 読み方（実装エージェント向け）

1. 振る舞い変更はしない。観測可能な契約は設計書の characterization / observables 節に従う。
2. **配信エージェント**（#463 済）: `lib/Agent/index.test.ts` と CommentPipeline / `speechable` がゴールデン。
3. **管理コンソール**（継続）: `lib/domain/console/*` の純関数 + 既存 `console/src` / integration テストがゴールデン。
4. `docs/` は静的サイト専用。設計 Markdown は `architecture/` のみ。

## 実装マップ

| 領域 | パス | 状態 |
|------|------|------|
| NGram / Silence / Topic / Scripts | `lib/domain/*` | 済 |
| Publication assemble | `lib/domain/publication/` | 済 |
| AgentSession + services | `lib/application/` | 済 |
| Console access / status plan / SSE frames | `lib/domain/console/` | 済（Basic auth 純関数含む） |
| systemd / make install（main から port） | `Makefile`, `etc/systemd/` | 済 |
| Outer console WS bridge | `composition/consoleOuterWebSocket.ts` | 済 |
| Console UI | `console/src/AgentStatus/` | ファサード維持 |

## 関連

- プロジェクト指示: [`AGENTS.md`](../AGENTS.md)
- 中核実装: [`lib/Agent/index.ts`](../lib/Agent/index.ts)、[`lib/streamState.ts`](../lib/streamState.ts)、[`index.ts`](../index.ts)
