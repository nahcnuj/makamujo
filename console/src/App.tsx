import type { CSSProperties } from "react";
import { CandidateList, MIN_NODE_HEIGHT } from "./components/DistributionTree";

type WeightedCandidates = Record<string, number>;

type Distribution = Record<string, WeightedCandidates>;



import { useEffect, useState } from "react";

export function App() {
  const [dist, setDist] = useState<Distribution>({ "": { "。": 1 } });

  useEffect(() => {
    const base = process.env.NODE_ENV !== 'production' ? 'http://localhost:8777' : 'http://localhost:7777';
    fetch(`${base}/api/distribution`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`status=${res.status}`);
        return res.json();
      })
      .then((json: Distribution) => {
        if (json && typeof json === 'object') {
          setDist(json);
        }
      })
      .catch((err) => {
        console.warn('[WARN]', 'failed to fetch distribution, using sample', err);
      });
  }, []);

  const rootCandidates = dist[""] ?? {};

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">Maka Mujo Console</h1>
        <a
          className="app-link"
          href="https://live.nicovideo.jp/watch/user/14171889"
          target="_blank"
          rel="noreferrer"
        >
          Live
        </a>
      </header>
      <section className="tree-panel">
        <div className="tree-panel-header">
          <div>
            <h2>Distribution Tree</h2>
          </div>
        </div>
        <div className="tree-canvas">
          <CandidateList
            candidates={rootCandidates}
            dist={dist}
            depth={0}
          />
        </div>
      </section>
    </div>
  );
}

export default App;
