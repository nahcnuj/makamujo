import { AgentStatusSectionCard } from "./AgentStatusSectionCard";
import type { AgentStatusRow } from "./AgentStatusSectionCard";

export const MARKOV_MODEL_SECTION_TITLE = "マルコフ連鎖モデルの状態";

type MarkovModelStatusSectionProps = {
  markovModelRows: AgentStatusRow[]
};

export const MarkovModelStatusSection = ({ markovModelRows }: MarkovModelStatusSectionProps) => {
  return <AgentStatusSectionCard title={MARKOV_MODEL_SECTION_TITLE} rows={markovModelRows} />;
};
