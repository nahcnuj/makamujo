# TODO — 作業タスク管理
このファイルは作業タスクを「MUST / SHOULD」で管理するための公式チェックリストです。AIエージェントはこのファイルを参照し、変更時は `manage_todo_list` ツールで同期してください。

## フォーマット
各タスクは次の形式で記述してください:

- `- [ ] [MUST] タイトル — 簡単な説明`
- `- [ ] [SHOULD] タイトル — 完了済みの表示`

## 現在のチェックリスト
以下のタスクはリポジトリ内での作業チェックリストです。完了済みはチェック済みになっています。

- [x] [MUST] Fetch issue #202 and summarize — Retrieved issue content and inspected the issue.
- [x] [MUST] Analyze repository for affected code — Inspected `lib/Agent/index.ts` and `lib/TTS` implementations.
- [x] [SHOULD] Propose or implement fix — Implemented a small fix to reset the prompt flag on TTS failure; further verification recommended.

- [x] [MUST] Add unit test for TTS failure reset — Added/updated tests to verify queued prompt behavior and TTS failure handling.

- [x] [MUST] Install Bun in container — Installed Bun to `~/.bun` and added to PATH for this session.
- [x] [MUST] Run `bun ci` to install dependencies — Completed (no dependency changes).
- [x] [MUST] Run typecheck and unit tests — Completed; all tests passing.

<!-- 対応すべきタスクは以上です。 -->

## 注意
このファイルを編集したら、対応する全てのタスクを `manage_todo_list` ツールに送ってください。
