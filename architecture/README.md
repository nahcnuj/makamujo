# architecture/

馬可無序の設計・契約ドキュメント。

[`docs/`](../docs/) はランディング用静的資産専用。設計 Markdown はここにだけ置く。

## 文書

| ファイル | 内容 |
|----------|------|
| [overview.md](./overview.md) | アーキテクチャ概要（BC・用語・状態所有） |
| [domain-model-redesign.md](./domain-model-redesign.md) | Broadcasting BC |
| [console-domain-model.md](./console-domain-model.md) | Console BC |

## 読み方

1. [overview.md](./overview.md) でコンテキスト地図と用語を押さえる。  
2. 触る BC の詳細契約を読む。  
3. 振る舞い変更はゴールデンを先に更新する。  
4. 純規則は `lib/domain`、Session 操作は `lib/application`、配線は `composition` / host。

## 実装マップ

| 領域 | パス |
|------|------|
| Broadcasting 純規則 | `lib/domain/broadcasting|comments|speech|publication` |
| AgentSession + services | `lib/application/` |
| ファサード | `lib/Agent/` |
| Console 純規則 | `lib/domain/console/` |
| 配線 | `composition/`, `index.ts` |
| 運用 | `Makefile`, `etc/systemd/` |

## 関連

- [`AGENTS.md`](../AGENTS.md)
- [`lib/Agent/index.ts`](../lib/Agent/index.ts)、[`index.ts`](../index.ts)
