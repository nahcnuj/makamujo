import { AgentStatusSectionCard } from "./AgentStatusSectionCard";
import type { AgentStatusRow } from "./types";

export const MARKOV_MODEL_SECTION_TITLE = "マルコフ連鎖モデル";

type MarkovModelStatusSectionProps = {
  markovModelRows: AgentStatusRow[];
};

export const MarkovModelStatusSection = ({ markovModelRows }: MarkovModelStatusSectionProps) => {
  const nGramRow = markovModelRows.find((row) => row.label === "生成N-gram");
  const rows = markovModelRows.filter((row) => row.label !== "生成N-gram");

  return (
    <AgentStatusSectionCard
      title={MARKOV_MODEL_SECTION_TITLE}
      titleRightElement={nGramRow?.value ?? undefined}
      rows={rows}
    />
  );
};
