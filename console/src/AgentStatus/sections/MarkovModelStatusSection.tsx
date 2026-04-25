import type { AgentStatusRow } from "./AgentStatusSectionCard";
import { AgentStatusSectionCard } from "./AgentStatusSectionCard";

export const MARKOV_MODEL_SECTION_TITLE = "マルコフ連鎖モデルの状態";

export const MarkovModelStatusSection = ({ markovModelRows }: { markovModelRows: AgentStatusRow[] }) => {
    return <AgentStatusSectionCard title={MARKOV_MODEL_SECTION_TITLE} rows={markovModelRows} />;
};
