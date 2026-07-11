# architecture/

馬可無序の設計メモ置き場。

[`docs/`](../docs/) はサイト用の静的ファイル専用。設計用の Markdown はここにだけ置く。

## 文書

| ファイル | 内容 |
|----------|------|
| [overview.md](./overview.md) | 全体の分かれ方・用語・状態の持ち方 |
| [integration-spec.md](./integration-spec.md) | main×legacy 統合の確定仕様（コメント経路など） |
| [domain-model-redesign.md](./domain-model-redesign.md) | 配信エージェントの詳細 |
| [console-domain-model.md](./console-domain-model.md) | 管理コンソールの詳細 |

## 読み方

1. [overview.md](./overview.md) で全体像と用語を読む。  
2. 直す機能の詳細設計を読む。  
3. 動きを変えるときは、基準になるテストを先に直す。  
4. 規則は `lib/domain`、状態をいじる処理は `lib/application`、つなぎは `composition` や `index.ts`。

## コードの対応

| 領域 | パス |
|------|------|
| 配信の規則 | `lib/domain/broadcasting` など |
| 内部状態とサービス | `lib/application/` |
| エージェント入口 | `lib/Agent/` |
| コンソールの規則 | `lib/domain/console/` |
| 配線 | `composition/`, `index.ts` |
| 起動・サービス | `Makefile`, `etc/systemd/` |

## 関連

- [`AGENTS.md`](../AGENTS.md)
- [`lib/Agent/index.ts`](../lib/Agent/index.ts)、[`index.ts`](../index.ts)
