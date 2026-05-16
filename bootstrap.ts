import { installConsoleLogger } from "./lib/consoleLogger";

installConsoleLogger();

// Ensure the main server entrypoint is loaded after the global console has
// been replaced so that all modules and runtime code in this process use the
// production-suppressed console implementation.
import "./index.ts";
