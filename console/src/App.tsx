import { AgentStatus } from "./AgentStatus";
import "./index.css";

export function App() {
  return (
    <div className="w-full h-full max-w-[100svw] mx-auto px-4 py-4 md:p-8 text-center relative z-10 grid grid-rows-[auto_minmax(0,1fr)] gap-4">
      <h1 className="text-5xl font-bold my-4 leading-tight">
        <a href="https://live.nicovideo.jp/watch/user/14171889" target="_blank">
          馬可無序
        </a>
      </h1>
      <AgentStatus />
    </div>
  );
}

export default App;
