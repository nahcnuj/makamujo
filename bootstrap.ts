import { installConsoleLogger } from "./lib/consoleLogger";

// Install production-aware console before loading the app graph so [DEBUG]
// is suppressed consistently when NODE_ENV=production.
installConsoleLogger();

import "./index.ts";
