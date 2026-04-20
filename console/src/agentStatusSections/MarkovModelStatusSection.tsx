import { MARKOV_MODEL_SECTION_TITLE } from "./constants";
import type { MarkovModelStatusSectionProps } from "./types";
import { AgentStatusSectionCard } from "./AgentStatusSectionCard";

export const MarkovModelStatusSection = ({ markovModelRows }: MarkovModelStatusSectionProps) => {
  return <AgentStatusSectionCard title={MARKOV_MODEL_SECTION_TITLE} rows={markovModelRows} />;
};
