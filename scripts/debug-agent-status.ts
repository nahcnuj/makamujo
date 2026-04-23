import { createMockAgentStateResponse, createAgentStatusRows, createAgentStatusSections } from "../console/src/AgentStatus";

(async () => {
  try {
    const state = createMockAgentStateResponse();
    const rows = createAgentStatusRows(state as any);
    console.log("ROWS:\n", JSON.stringify(rows, null, 2));
    const sections = createAgentStatusSections(state as any);
    console.log("SECTIONS:\n", JSON.stringify(sections, null, 2));
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
