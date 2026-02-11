import type { CSSProperties } from "react";
import { CandidateList, MIN_NODE_HEIGHT } from "./components/DistributionTree";

type WeightedCandidates = Record<string, number>;

type Distribution = Record<string, WeightedCandidates>;

const sampleDistribution: Distribution = {
  "": {
    "こんにちは": 12,
    "ねえ": 6,
    "今日は": 9,
    "配信": 4,
    "さて": 7,
    "それで": 3,
  },
  "こんにちは": {
    "みんな": 8,
    "今日は": 5,
    "配信": 2,
  },
  "ねえ": {
    "みんな": 4,
    "聞いて": 6,
  },
  "今日は": {
    "天気": 5,
    "配信": 7,
    "ゲーム": 3,
  },
  "配信": {
    "始める": 8,
    "する": 5,
  },
  "さて": {
    "本題": 6,
    "次": 3,
  },
  "それで": {
    "ね": 4,
    "続き": 5,
  },
  "みんな": {
    "元気": 6,
    "集まって": 4,
  },
  "聞いて": {
    "ほしい": 5,
    "くれる": 2,
  },
  "天気": {
    "いい": 4,
    "悪い": 2,
  },
  "ゲーム": {
    "やる": 6,
    "始める": 4,
  },
  "始める": {
    "よ": 7,
    "ぞ": 3,
  },
  "本題": {
    "に": 5,
    "へ": 2,
  },
  "次": {
    "は": 4,
    "に": 3,
  },
  "元気": {
    "です": 6,
    "かな": 2,
  },
  "集まって": {
    "くれて": 4,
    "ありがとう": 3,
  },
  "いい": {
    "ね": 5,
  },
  "やる": {
    "よ": 6,
  },
  "よ": {
    "。": 8,
  },
  "ぞ": {
    "。": 5,
  },
  "。": {
    "": 1,
  },
};

export function App() {
  const rootCandidates = sampleDistribution[""] ?? {};

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-eyebrow">MarkovChainModel Console</p>
          <h1 className="app-title">Distribution Explorer</h1>
          <p className="app-subtitle">
            initial word candidates ('' key) から3階層までを表示
          </p>
        </div>
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
            <p>weight proportional height, depth capped at 3</p>
          </div>
          <div className="tree-panel-meta">
            <span>root candidates: {Object.keys(rootCandidates).length}</span>
            <span>min height: {MIN_NODE_HEIGHT}px</span>
          </div>
        </div>
        <div className="tree-canvas">
          <CandidateList
            candidates={rootCandidates}
            dist={sampleDistribution}
            depth={0}
          />
        </div>
      </section>
    </div>
  );
}

export default App;
