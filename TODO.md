# TODO — 作業タスク管理
このファイルは作業タスクを「MUST / SHOULD」で管理するための公式チェックリストです。AIエージェントはこのファイルを参照し、変更時は `manage_todo_list` ツールで同期してください。

## フォーマット
各タスクは次の形式で記述してください:

- `- [ ] [MUST] タイトル — 簡単な説明`
- `- [ ] [SHOULD] タイトル — 完了済みの表示`

## 現在のチェックリスト

- [x] Create `agentStateService.ts` (constants + URL helper)
- [x] Create `hooks/useAgentState.ts` (fetch + state; WS-backed)
- [x] Create `hooks/useAgentStateWebSocket.ts` (websocket logic) — merged into `useAgentState.ts`
- [x] Refactor `AgentStatusContainer.tsx` to use hooks/service
- [x] Update tests to import helpers from `hooks/useAgentState.ts`
- [x] Run typecheck and tests
- [x] Remove production mock helpers and move mocks to fixtures
- [ ] Refactor `useAgentState` API to return `{ state, setState }` or use `useReducer`
このファイルを編集したら、対応する全てのタスクを `manage_todo_list` ツールに送ってください。
