# TODO — 作業タスク管理
このファイルは作業タスクを「MUST / SHOULD」で管理するための公式チェックリストです。AIエージェントはこのファイルを参照し、変更時は `manage_todo_list` ツールで同期してください。

## フォーマット
各タスクは次の形式で記述してください:

- `- [ ] [MUST] タイトル — 簡単な説明`
- `- [ ] [SHOULD] タイトル — 完了済みの表示`

## 現在のチェックリスト

- [x] [MUST] AgentStatus: single export — Ensure `console/src/AgentStatus.tsx` exports only one public component (`AgentStatus`).
- [ ] [SHOULD] Scan console components — Find other `console/src` files that export multiple public components.
- [x] [SHOULD] Run tsc & tests — Run typecheck and test suites to verify changes.

<!-- 対応すべきタスクは以上です。 -->

## 注意
このファイルを編集したら、対応する全てのタスクを `manage_todo_list` ツールに送ってください。
