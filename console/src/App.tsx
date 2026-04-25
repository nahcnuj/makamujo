import { AgentStatus } from "./AgentStatusContainer";
import "./index.css";

export function App() {
  return (
    <div className="w-full h-full max-w-[100svw] mx-auto px-4 py-4 md:p-8 relative z-10">
      <AgentStatus />
    </div>
  );
}

export default App;
