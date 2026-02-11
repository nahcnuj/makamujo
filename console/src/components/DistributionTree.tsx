import type { CSSProperties } from "react";

export type WeightedCandidates = Record<string, number>;
export type Distribution = Record<string, WeightedCandidates>;

export const MAX_DEPTH = 3;
export const MIN_NODE_HEIGHT = 48;
export const WEIGHT_UNIT = 10;
export const ROW_GAP = 8;

export type CandidateLayout = {
  listHeight: number;
  entries: Array<{
    word: string;
    weight: number;
    height: number;
    childLayout?: CandidateLayout;
  }>;
};

const buildLayout = (
  candidates: WeightedCandidates | undefined,
  dist: Distribution,
  depth: number,
): CandidateLayout => {
  const entries = Object.entries(candidates ?? {}).sort(
    ([wordA, weightA], [wordB, weightB]) =>
      weightB - weightA || wordA.localeCompare(wordB, "ja"),
  );

  if (entries.length === 0) {
    return {
      listHeight: MIN_NODE_HEIGHT,
      entries: [],
    };
  }

  const layoutEntries = entries.map(([word, weight]) => {
    const baseHeight = Math.max(MIN_NODE_HEIGHT, weight * WEIGHT_UNIT);
    const nextCandidates = dist[word];
    const canExpand =
      depth + 1 < MAX_DEPTH && nextCandidates && Object.keys(nextCandidates).length > 0;
    const childLayout = canExpand ? buildLayout(nextCandidates, dist, depth + 1) : undefined;
    const height = childLayout ? Math.max(baseHeight, childLayout.listHeight) : baseHeight;

    return {
      word,
      weight,
      height,
      childLayout,
    };
  });

  const totalHeight =
    layoutEntries.reduce((acc, entry) => acc + entry.height, 0) + ROW_GAP * (layoutEntries.length - 1);

  return {
    listHeight: totalHeight,
    entries: layoutEntries,
  };
};

type CandidateListProps = {
  candidates: WeightedCandidates | undefined;
  dist: Distribution;
  depth: number;
  layout?: CandidateLayout;
};

export const CandidateList = ({ candidates, dist, depth, layout }: CandidateListProps) => {
  const resolvedLayout = layout ?? buildLayout(candidates, dist, depth);
  const listStyle: CSSProperties = { height: resolvedLayout.listHeight };
  const emptyStyle: CSSProperties = { height: resolvedLayout.listHeight };

  if (resolvedLayout.entries.length === 0) {
    return (
      <div className="candidate-empty" style={emptyStyle}>
        no candidates
      </div>
    );
  }

  return (
    <div className="candidate-list" style={listStyle} data-depth={depth}>
      {resolvedLayout.entries.map((entry) => (
        <CandidateNode
          key={`${depth}-${entry.word}`}
          word={entry.word}
          weight={entry.weight}
          height={entry.height}
          childLayout={entry.childLayout}
          dist={dist}
          depth={depth}
        />
      ))}
    </div>
  );
};

type CandidateNodeProps = {
  word: string;
  weight: number;
  height: number;
  childLayout?: CandidateLayout;
  dist: Distribution;
  depth: number;
};

const CandidateNode = ({ word, weight, height, childLayout, dist, depth }: CandidateNodeProps) => {
  const nextCandidates = dist[word];
  const canExpand = depth + 1 < MAX_DEPTH && nextCandidates && Object.keys(nextCandidates).length > 0;
  const nodeStyle = { height } as CSSProperties;

  return (
    <div className="candidate-row" style={nodeStyle} data-depth={depth}>
      <div className="candidate-card">
        <div className="candidate-word">{word || "(empty)"}</div>
        <div className="candidate-weight">{weight}</div>
      </div>
      <div className="candidate-children">
        {canExpand ? (
          <CandidateList candidates={nextCandidates} dist={dist} depth={depth + 1} layout={childLayout} />
        ) : (
          <div className="candidate-truncate">{depth + 1 >= MAX_DEPTH ? "depth limit" : "no next"}</div>
        )}
      </div>
    </div>
  );
};
