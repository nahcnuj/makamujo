# architecture/

馬可無序（makamujo）のエンジニアリング向け設計・契約ドキュメント置き場。

既存の [`docs/`](../docs/) はランディングページ用の静的資産専用である。ここに Markdown の設計文書を混ぜない。

## 文書一覧

| ファイル | 内容 |
|----------|------|
| [**main-target-state.md**](./main-target-state.md) | **システムのあるべき姿（正）** — BC・ユビキタス言語・状態所有・契約 |
| [domain-model-redesign.md](./domain-model-redesign.md) | Broadcasting BC（CommentPipeline / silence / Publication） |
| [console-domain-model.md](./console-domain-model.md) | Console BC（Access / Status plan / SSE） |

ブランチ間の差分メモは置かない。モデルが変わったら **main-target-state.md と該当 BC 文書** を更新する。

## 読み方（実装・エージェント）

1. [main-target-state.md](./main-target-state.md) で **コンテキスト地図と用語・状態所有** を固定する。  
2. 触る境界の詳細契約（Broadcasting / Console）を読む。  
3. 振る舞い変更はゴールデン（characterization）を先に更新する。  
4. 配置は BC に従う: 純規則は `lib/domain`、Session 操作は `lib/application`、配線は `composition` / host。  
5. `docs/` に設計 Markdown を置かない。

## 実装マップ（要約）

| 領域 | パス | 備考 |
|------|------|------|
| Broadcasting 純規則 | `lib/domain/broadcasting|comments|speech|publication` | 副作用なし |
| AgentSession + services | `lib/application/` | 状態所有 |
| ファサード | `lib/Agent/` | AgentLike 互換 |
| Console 純規則 | `lib/domain/console/` | Access / plan / SSE frames |
| Console 秘密のホスト I/O | `lib/consoleBasicAuthPassword.ts` | ドメイン規則ではない |
| 配線 | `composition/`, `index.ts` | 規則を書かない |
| 運用アダプタ | `Makefile`, `etc/systemd/` | モデルの外側 |

## 関連

- プロジェクト指示: [`AGENTS.md`](../AGENTS.md)
- 中核実装: [`lib/Agent/index.ts`](../lib/Agent/index.ts)、[`lib/streamState.ts`](../lib/streamState.ts)、[`index.ts`](../index.ts)
