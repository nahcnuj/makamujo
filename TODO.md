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

- [x] [MUST] Create DevContainer files (`.devcontainer/Dockerfile` and `.devcontainer/devcontainer.json`) — Added Debian 12 base image, installed Bun, configured features for Git and GitHub CLI, and set workspace mount.
- [x] [MUST] Copy `package.json` and `bun.lock*` into image for build caching — `Dockerfile` copies `package.json` and `bun.lock*`.
- [x] [MUST] Run `bun ci` after container creation — `devcontainer.json` has `postCreateCommand` set to `bun ci`.
- [x] [MUST] Mount local repository root into container workspace folder — `devcontainer.json` sets `workspaceMount` to bind the local repo into `/workspace`.

<!-- 対応すべきタスクは以上です。 -->

## Current Work (added by automated agent)

- [x] [MUST] Analyze failing e2e console WS proxy test — Located failing E2E test and inspected proxy code.
- [x] [MUST] Reproduce failing test and collect logs — Reproduced integration behavior locally and collected logs.
- [x] [MUST] Implement fix in console WS proxy bridging — Added HTTP /api/meta fallback on upstream WS error in routes/console/index.ts.
- [ ] [MUST] Run E2E Playwright test to verify fix — Pending; Playwright browser run not executed in this session.
- [ ] [MUST] Update PR with patch and summary — Pending: prepare PR comment with explanation.

- [x] [MUST] Fix OBS browser syntax error — Tightened navigation detection in `src/catchAll.ts` to avoid serving `index.html` for module/file requests (fixes syntax error in old OBS browser).

- [x] [MUST] Fix console SSE reconnect handling — Allow EventSource to auto-reconnect and avoid forcing immediate closure on transient SSE errors.- [x] [MUST] Bypass management console IP restriction in development mode — Allow `bun run dev` to access the management console without the production-only IP allowlist.- [x] [SHOULD] Add regression test for SSE EventSource error handling — Verify console status error only appears when the stream is fully closed.
- [x] [MUST] Refactor AgentStatus component — Reorganize `console/src/AgentStatus/index.tsx` and split AgentStatus logic into reusable submodules.

- [x] [MUST] Issue #225: 管理コンソール - これまでの発話の改善 — 読了、テスト追加、実装（単語ごとにカード表示、非マルコフ文言の除去）を行いました。
- [ ] [MUST] Commit changes and open PR for branch `225-管理コンソール-これまでの発話の改善` — Pending: create PR with description and attach screenshots if needed.
 - [ ] [SHOULD] Propose AGT library enhancement — create an issue requesting generation trace (node path) or API to return nodes visited during generation.

## 注意
このファイルを編集したら、対応する全てのタスクを `manage_todo_list` ツールに送ってください。
