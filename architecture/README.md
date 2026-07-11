# architecture/

馬可無序（makamujo）のエンジニアリング向け設計・契約ドキュメント置き場。

既存の [`docs/`](../docs/) はランディングページ用の静的資産専用である。ここに Markdown の設計文書を混ぜない。

## 文書一覧

| ファイル | 内容 |
|----------|------|
| [domain-model-redesign.md](./domain-model-redesign.md) | `legacy` 向けドメインモデル駆動再設計（正本）。ユビキタス言語、境界づけられたコンテキスト、CommentPipeline / silence / Publication 契約、Phase A/B/C の PR Plan |

## 読み方（実装エージェント向け）

1. 振る舞い変更はしない。観測可能な契約は設計書の characterization / observables 節に従う。
2. 実装は **Phase A から**（契約文書 → 回帰テスト → 純関数 → Publication → composition 薄型化）。
3. `CommentApplicationService` 等の大きな分割は Phase B。Phase A 完了後に必要性を判断してよい（浅いモジュール化での停止も正当）。
4. コード変更時は既存の `lib/Agent/index.test.ts` と設計書の CommentPipeline / `speechable` 順序アルゴリズムをゴールデンとする。

## 関連

- プロジェクト指示: [`AGENTS.md`](../AGENTS.md)
- 中核実装: [`lib/Agent/index.ts`](../lib/Agent/index.ts)、[`lib/streamState.ts`](../lib/streamState.ts)、[`index.ts`](../index.ts)
