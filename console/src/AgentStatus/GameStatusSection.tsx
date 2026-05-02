import { AgentStatusSectionCard } from "./AgentStatusSectionCard";
import type { AgentStatusRow } from "./types";

type GameStatusSectionProps = {
  title: string;
  gameRows: AgentStatusRow[];
};

export const GameStatusSection = ({ title, gameRows }: GameStatusSectionProps) => {
  return <AgentStatusSectionCard title={title} rows={gameRows} />;
};
