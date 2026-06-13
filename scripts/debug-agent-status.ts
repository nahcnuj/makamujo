import {
  createAgentStatusRows,
  createAgentStatusSections,
} from "../console/src/AgentStatus";
import { cloneAgentStateResponseMockFixture } from "../tests/fixtures/agentStateResponseMock";

(async () => {
  try {
    const state = cloneAgentStateResponseMockFixture();
    const rows = createAgentStatusRows(state as Record<string, unknown>);
    console.log("ROWS:\n", JSON.stringify(rows, null, 2));
    const sections = createAgentStatusSections(
      state as Record<string, unknown>,
    );
    console.log("SECTIONS:\n", JSON.stringify(sections, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
