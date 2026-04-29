# TODO — 作業タスク管理
このファイルは作業タスクを「MUST / SHOULD」で管理するための公式チェックリストです。AIエージェントはこのファイルを参照し、変更時は `manage_todo_list` ツールで同期してください。

## フォーマット
各タスクは次の形式で記述してください:

- `- [ ] [MUST] タイトル — 簡単な説明`
- `- [ ] [SHOULD] タイトル — 完了済みの表示`

## 現在のチェックリスト
以下のタスクはリポジトリ内での作業チェックリストです。完了済みはチェック済みになっています。

- [x] [MUST] Cache Playwright browsers in CI — Added restore/save cache steps to `.github/workflows/ci.yml` for `~/.cache/ms-playwright` to speed up E2E runs.
- [x] [MUST] Sync `manage_todo_list` — Recorded progress and updated statuses via the `manage_todo_list` tool.

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

## REBASE — sync `fix/issue-210` with `main` (Issue #217)

- [ ] [MUST] Ensure working tree is clean — verify no uncommitted changes
- [ ] [MUST] Fetch remote and update `main` — `git fetch` and `git pull --rebase`
- [ ] [MUST] Rebase `fix/issue-210` onto `origin/main` — resolve conflicts if any
- [ ] [SHOULD] Run tests locally — `bun run test` (recommended)
- [ ] [MUST] Push `fix/issue-210` with `--force-with-lease` after rebase


## ISSUE-211 — Console streaming proxy

このセクションは Issue #211 の対応進捗を示します。AIエージェントはこのファイルと `manage_todo_list` を同期します。

- [x] [MUST] Fix console proxy streaming — SSE cancel handlers and rewrap streams
- [x] [MUST] Add E2E tests for SSE/WS proxy — validate SSE headers and WS upgrades
- [ ] [MUST] Commit & push fixes (trigger CI) — push changes to the feature branch
- [ ] [MUST] Monitor CI until green — watch the e2e job and confirm passing
- [ ] [SHOULD] Gather CI artifacts on failure — download `test-results` and `var/test-logs`
- [x] [SHOULD] Add debug logging for streams — added logs to routes/console/index.ts


## 注意
このファイルを編集したら、対応する全てのタスクを `manage_todo_list` ツールに送ってください。
