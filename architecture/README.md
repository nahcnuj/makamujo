# architecture/

馬可無序の設計メモ置き場。

[`docs/`](../docs/) はサイト用の静的ファイル専用。設計用の Markdown はここにだけ置く。

## 文書

| ファイル | 内容 |
|----------|------|
| [overview.md](./overview.md) | 全体像・用語・コメント経路・配置 |
| [domain-model-redesign.md](./domain-model-redesign.md) | 配信エージェントの詳細 |
| [console-domain-model.md](./console-domain-model.md) | 管理コンソールの詳細 |

## 読み方

1. [overview.md](./overview.md) で全体とコメント契約を読む。  
2. 直す機能の詳細設計を読む。  
3. 動きを変えるときは基準テストを先に直す。  
4. 規則は `lib/domain`、状態操作は `lib/application`、つなぎは `composition` や `index.ts`。

## コードの対応

| 領域 | パス |
|------|------|
| 配信の規則 | `lib/domain/**` |
| 内部状態とサービス | `lib/application/` |
| エージェント入口 | `lib/Agent/` |
| ニコ生コメント | `lib/niconamaCommentClient*`、`composition/niconamaCommentIngress.ts` |
| コンソールの規則 | `lib/domain/console/` |
| 配線 | `composition/`, `index.ts` |
| 起動・サービス | `Makefile`, `etc/systemd/` |

## 関連

- [`AGENTS.md`](../AGENTS.md)
- [`lib/Agent/index.ts`](../lib/Agent/index.ts)、[`index.ts`](../index.ts)
