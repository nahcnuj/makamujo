# TODO — 作業タスク管理
このファイルは作業タスクを「MUST / SHOULD」で管理するための公式チェックリストです。AIエージェントはこのファイルを参照し、変更時は `manage_todo_list` ツールで同期してください。

## フォーマット
各タスクは次の形式で記述してください:

- `- [ ] [MUST] タイトル — 簡単な説明`
- `- [ ] [SHOULD] タイトル — 完了済みの表示`

## 現在のチェックリスト

- [x] [MUST] Review issue #195 — 課題内容の確認と実装計画作成
- [ ] [MUST] Reproduce the bug locally — 再現手順の確認とローカル再現 (in-progress)
- [ ] [SHOULD] Implement fix — 実装と単体テストの追加
- [ ] [SHOULD] Add/adjust tests — 既存テストの修正と追加
- [ ] [SHOULD] Run tests and CI checks — テスト実行とCI確認
- [ ] [SHOULD] Update TODO.md and PR description — 作業ログとPR本文の更新

<!-- 対応すべきタスクは以上です。 -->

## 注意
このファイルを編集したら、対応する全てのタスクを `manage_todo_list` ツールに送ってください。
