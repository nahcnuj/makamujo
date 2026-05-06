# TODO — 作業タスク管理
このファイルは作業タスクを「MUST / SHOULD」で管理するための公式チェックリストです。AIエージェントはこのファイルを参照し、変更時は `manage_todo_list` ツールで同期してください。

## フォーマット
各タスクは次の形式で記述してください:

- `- [ ] [MUST] タイトル — 簡単な説明`
- `- [ ] [SHOULD] タイトル — 完了済みの表示`

## 現在のチェックリスト
以下のタスクはリポジトリ内での作業チェックリストです。完了済みはチェック済みになっています。

- [ ] [MUST] Run E2E Playwright test to verify fix — Pending; Playwright browser run not executed in this session.
- [ ] [MUST] Update PR with patch and summary — Pending: prepare PR comment with explanation.
- [ ] [MUST] Commit changes and open PR for branch `225-管理コンソール-これまでの発話の改善` — Pending: create PR with description and attach screenshots if needed.
- [ ] [SHOULD] Propose AGT library enhancement — create an issue requesting generation trace (node path) or API to return nodes visited during generation.

## 注意
このファイルを編集したら、対応する全てのタスクを `manage_todo_list` ツールに送ってください。
