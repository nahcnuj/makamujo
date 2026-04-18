import ConsoleApp from "../../console/src/index.html";
import robotsTxt from "./robots.txt";
import * as agentState from "./api/agent-state";

export const routes = {
  '/console/*': ConsoleApp,
  '/console/robots.txt': robotsTxt,
  '/console/api/agent-state': agentState,
};
