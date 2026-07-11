# architecture/

馬可無序（makamujo）のエンジニアリング向け設計・契約ドキュメント置き場。

既存の [`docs/`](../docs/) はランディングページ用の静的資産専用である。ここに Markdown の設計文書を混ぜない。

## 文書一覧

| ファイル | 内容 |
|----------|------|
| [**main-target-state.md**](./main-target-state.md) | **`main` のあるべき姿（正）** — レイヤ・ランタイム・運用・品質ゲート |
| [domain-model-redesign.md](./domain-model-redesign.md) | 配信エージェント BC（CommentPipeline / silence / Publication） |
| [console-domain-model.md](./console-domain-model.md) | 管理コンソール BC（Access / Status plan / SSE） |

ブランチ間の一時的な差分メモは置かない（すぐ陳腐化するため）。あるべき構造は常に `main-target-state.md` を更新する。

## 読み方（実装エージェント向け）

1. まず [main-target-state.md](./main-target-state.md) で全体像を固定する。
2. 振る舞い変更はしない、または契約（characterization / observables）を先に更新する。
3. **配信エージェント**: `lib/Agent/index.test.ts` と domain / publication テストがゴールデン。
4. **管理コンソール**: `lib/domain/console/*` + `console/src` / integration がゴールデン。
5. `docs/` は静的サイト専用。設計 Markdown は `architecture/` のみ。

## 実装マップ（要約）

| 領域 | パス | 状態 |
|------|------|------|
| NGram / Silence / Topic / Scripts | `lib/domain/*` | 済 |
| Publication assemble | `lib/domain/publication/` | 済 |
| AgentSession + services | `lib/application/` | 済 |
| Console access / status plan / SSE / Basic auth | `lib/domain/console/`, `lib/consoleBasicAuthPassword.ts` | 済 |
| Outer console WS bridge | `composition/consoleOuterWebSocket.ts` | 済 |
| systemd / make install | `Makefile`, `etc/systemd/` | 済 |
| Console UI | `console/src/AgentStatus/` | ファサード維持 |

詳細と非目標は [main-target-state.md](./main-target-state.md)。

## 関連

- プロジェクト指示: [`AGENTS.md`](../AGENTS.md)
- 中核実装: [`lib/Agent/index.ts`](../lib/Agent/index.ts)、[`lib/streamState.ts`](../lib/streamState.ts)、[`index.ts`](../index.ts)
