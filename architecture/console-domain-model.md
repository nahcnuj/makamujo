# 管理コンソール境界: ドメインモデルと変更容易性

| 項目 | 内容 |
|------|------|
| **Status** | Implemented (initial slice) |
| **Branch** | `legacy` 上の継続リファクタ |
| **Constraint** | 観測可能な振る舞いを変えない |

> `docs/` は静的サイト資産専用。本ドキュメントは `architecture/` に置く。

## 背景

配信エージェント本体（`MakaMujo` / Publication）は #463 でドメイン分割済み。  
**管理コンソール**は当時の対象外だったが、次の複雑さが残る。

- 外側 TLS + IP 許可リスト + ループバックプロキシ（`console/index.ts`）
- 配信公開ペイロードの **表示計画**（`createAgentStatusRows` / `agentStatusUtils`）
- 放送 API への SSE/HTTP プロキシ（`lib/console-proxy.ts`）

## 境界づけられたコンテキスト

```mermaid
flowchart LR
  subgraph Broadcasting["Broadcasting BC（#463 済）"]
    Pub["PublishedStreamPayload"]
  end
  subgraph Console["Console BC"]
    Access["Access / Redirect"]
    Proxy["Loopback Proxy"]
    View["Agent Status View Plan"]
  end
  Pub -->|GET/SSE /api/meta| Proxy
  Proxy --> View
  Access --> Proxy
```

| BC | 責務 | 配置 |
|----|------|------|
| Console Access | 拒否時リダイレクト、IP 制限フラグ、hop-by-hop ヘッダ除去、Basic auth 純関数 | `lib/domain/console/access.ts` |
| Console Basic auth store | env / ファイル永続化 / 初回生成（ホスト I/O） | `lib/consoleBasicAuthPassword.ts` |
| Agent Status Presentation | 行の有無・表示文言（純関数） | `lib/domain/console/agentStatusPlan.ts` |
| Console UI | JSX / レイアウト | `console/src/AgentStatus/*` |
| Console Host | TLS・プロキシ・WebSocket ブリッジ | `console/index.ts` |

## ユビキタス言語（Console）

| 用語 | 意味 |
|------|------|
| 外側サーバ | :443 TLS、AllowedIP 検査後にループバックへ転送 |
| ループバックコンソール | 127.0.0.1 の Hono ルート本体 |
| 配信指標行 | niconama meta + commentCount の表示ブロック |
| 発話不可インジケータ | canSpeak=false 時の「（コメントしてね）」 |
| 表示可能履歴 | speech 正規化可能かつ nGram≥1 または nodes あり |

## 契約（振る舞い維持）

1. **Access**: `/console/*` 拒否 → 303 watch URL、それ以外 → 308 `/console/`。IP 制限は production のみ。
2. **Loopback headers**: Connection 列挙トークンを含む hop-by-hop と Host/Origin/Referer を削除。
3. **Status rows order**: metrics → game → n-gram → history|reply → speech（`planAgentStatusRows` と `createAgentStatusRows` が同じ順序）。

## 実装マップ

| 領域 | パス |
|------|------|
| Access pure | `lib/domain/console/access.ts` |
| Status plan pure | `lib/domain/console/agentStatusPlan.ts` |
| Host (wiring only) | `console/index.ts` は `startConsoleServer` のみ公開。access 純関数は re-export しない |
| UI re-export formatters | `console/src/AgentStatus/agentStatusUtils.tsx`（表示用の既存 import 互換） |
| 公開ペイロード型 | `lib/domain/publication/types.ts` ↔ `console/.../types.ts`（文書で整合） |

## 追加スライス（実装済）

| 領域 | パス |
|------|------|
| SSE 境界 / 完全フレーム抽出 | `lib/domain/console/sseFrames.ts` |
| 外側 WS ブリッジ | `composition/consoleOuterWebSocket.ts` |
| プロキシ本体 | `lib/console-proxy.ts`（純関数を利用） |

## 今後（任意）

- 外側 `fetch` ハンドラ全体を composition へ移し、`console/index.ts` を配線のみにする
- AGT 更新は不要（コンソールは HTTP/SSE クライアント）

## 検証

```
bun run typecheck
bun run test
bun run test:integration
```
